import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { writeConfiguration, type SalonConfiguration } from '../db/seed/configuration';
import { err, ok, type Result } from '../src/domain/shared/result';

/**
 * `load-salon` — the salon's data in production while the owner cannot edit it
 * from the app yet (002, US7–US9; roadmap, decisión 2026-11-04).
 *
 *   node cli/load-salon.mjs salon.json             writes it
 *   node cli/load-salon.mjs - < salon.json         the same, from standard input
 *   node cli/load-salon.mjs salon.json --dry-run   only checks the file
 *
 * It writes the salon, its two booking parameters, its weekly hours, its
 * catalogue and its holidays, all in one transaction. Unlike `db:seed:demo` it
 * keeps every period the owner blocked from the agenda: holidays are added or
 * updated by date, and one is released from the agenda like any other period.
 * A service that leaves the file is deactivated, never deleted, because
 * appointments keep pointing at it. `deploy/salon.example.json` is the format.
 */

const SALON_ID = '00000000-0000-4000-8000-000000000001';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = z.string().trim().min(1, 'cannot be empty');

const schema = z
  .object({
    salon: z.object({ name: text, address: text, phone: text }).strict(),
    policy: z
      .object({
        minimumLeadTimeHours: z.number().int().min(0),
        cancellationDeadlineHours: z.number().int().min(0),
      })
      .strict()
      .optional(),
    opening: z.array(
      z
        .object({
          weekday: z.number().int().min(1, '1 is Monday').max(7, '7 is Sunday'),
          from: z.string().regex(TIME, 'must be HH:MM'),
          to: z.string().regex(TIME, 'must be HH:MM'),
        })
        .strict(),
    ),
    services: z
      .array(
        z
          .object({
            id: z.string().uuid('must be a UUID, and stay the same for the life of the service'),
            name: text,
            minutes: z.number().int().positive(),
            priceCents: z
              .number()
              .int()
              .positive('must be positive, or null for «Precio a consultar en el salón»')
              .nullable(),
          })
          .strict(),
      )
      .min(1, 'the catalogue needs at least one service'),
    holidays: z
      .array(z.object({ date: z.string().regex(DATE, 'must be YYYY-MM-DD'), reason: text }).strict())
      .default([]),
  })
  .strict()
  .superRefine((file, context) => {
    const ids = file.services.map((service) => service.id);
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) {
        context.addIssue({ code: 'custom', path: ['services', index, 'id'], message: 'repeats another service' });
      }
    });
  });

/**
 * The id of the period a holiday becomes: derived from its date, so loading
 * the same file twice updates the holiday instead of adding it again.
 */
export function holidayId(date: string): string {
  const hex = createHash('sha256').update(`holiday:${date}`).digest('hex');
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function parseSalonFile(contents: string): Result<SalonConfiguration, readonly string[]> {
  let json: unknown;
  try {
    json = JSON.parse(contents);
  } catch {
    return err(['the file is not valid JSON']);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(file)'}: ${issue.message}`));
  }

  const file = parsed.data;
  return ok({
    salon: { id: SALON_ID, ...file.salon },
    ...(file.policy === undefined
      ? {}
      : {
          policy: {
            minimumLeadTimeMinutes: file.policy.minimumLeadTimeHours * 60,
            cancellationDeadlineHours: file.policy.cancellationDeadlineHours,
          },
        }),
    opening: file.opening,
    services: file.services.map((service, index) => ({
      id: service.id,
      name: service.name,
      minutes: service.minutes,
      cents: service.priceCents,
      order: index + 1,
    })),
    holidays: file.holidays.map((holiday) => ({ id: holidayId(holiday.date), ...holiday })),
  });
}

export async function loadSalon(
  connectionString: string,
  timezone: string,
  configuration: SalonConfiguration,
): Promise<void> {
  await writeConfiguration(connectionString, timezone, configuration, { unavailablePeriods: 'keep' });
}

async function readInput(source: string): Promise<string> {
  if (source !== '-') return readFile(source, 'utf8');

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

const isCli = process.argv[1] !== undefined && path.basename(process.argv[1]).startsWith('load-salon');

if (isCli) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const source = argv.find((arg) => arg !== '--dry-run');

  if (source === undefined) {
    console.error('Usage: load-salon <file.json | -> [--dry-run]');
    process.exit(1);
  }

  const outcome = parseSalonFile(await readInput(source));
  if (!outcome.ok) {
    console.error('The salon file is not valid:');
    for (const problem of outcome.error) console.error(`  ${problem}`);
    process.exit(1);
  }

  const configuration = outcome.value;
  const summary =
    `${configuration.salon.name}: ${configuration.opening.length} opening stretch(es), ` +
    `${configuration.services.length} service(s), ${configuration.holidays.length} holiday(s).`;

  if (dryRun) {
    console.log(`The file is valid. ${summary} Nothing written (--dry-run).`);
    process.exit(0);
  }

  const connectionString = process.env['DATABASE_URL'] ?? '';
  if (connectionString === '') {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  await loadSalon(connectionString, process.env['SALON_TIMEZONE'] ?? 'Europe/Madrid', configuration);
  console.log(`Loaded ${summary} The periods blocked from the agenda are untouched.`);
}
