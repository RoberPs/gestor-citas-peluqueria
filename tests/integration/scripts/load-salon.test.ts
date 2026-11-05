import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { holidayId, loadSalon, parseSalonFile } from '../../../scripts/load-salon';
import { closeTestDb, ensureSchema, testPool, truncateAll } from '../helpers/test-db';

/**
 * `load-salon`, the salon's data in production while US7–US9 are missing
 * (roadmap, decisión 2026-11-04 «Producción · Alcance»). It reads a JSON file
 * and writes the salon, its weekly hours, its catalogue and its holidays, and
 * it never touches a period the owner blocked from the agenda.
 */

const connectionString = process.env['DATABASE_URL_TEST'] ?? '';
const TIMEZONE = 'Europe/Madrid';
const EXAMPLE = path.resolve(import.meta.dirname, '../../../deploy/salon.example.json');

const CORTE = '00000000-0000-4000-8000-000000000021';
const BARBA = '00000000-0000-4000-8000-000000000023';

function file(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    salon: { name: 'Peluquería de prueba', address: 'Calle Mayor 1', phone: '600 00 00 00' },
    policy: { minimumLeadTimeHours: 2, cancellationDeadlineHours: 24 },
    opening: [
      { weekday: 1, from: '10:00', to: '14:00' },
      { weekday: 1, from: '17:00', to: '20:00' },
      { weekday: 6, from: '10:00', to: '14:00' },
    ],
    services: [
      { id: CORTE, name: 'Corte de pelo', minutes: 30, priceCents: null },
      { id: BARBA, name: 'Barba', minutes: 30, priceCents: 1200 },
    ],
    holidays: [{ date: '2026-12-25', reason: 'Navidad' }],
    ...overrides,
  });
}

function parsed(text: string) {
  const outcome = parseSalonFile(text);
  if (!outcome.ok) throw new Error(`expected a valid file: ${outcome.error.join('; ')}`);
  return outcome.value;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await truncateAll();
  await closeTestDb();
});

describe('parseSalonFile', () => {
  it('reads the file into a configuration, services ordered as listed', () => {
    const configuration = parsed(file());

    expect(configuration.salon.name).toBe('Peluquería de prueba');
    expect(configuration.policy).toEqual({ minimumLeadTimeMinutes: 120, cancellationDeadlineHours: 24 });
    expect(configuration.services).toEqual([
      { id: CORTE, name: 'Corte de pelo', minutes: 30, cents: null, order: 1 },
      { id: BARBA, name: 'Barba', minutes: 30, cents: 1200, order: 2 },
    ]);
    expect(configuration.holidays).toEqual([
      { id: holidayId('2026-12-25'), date: '2026-12-25', reason: 'Navidad' },
    ]);
  });

  it('accepts the example shipped in deploy/, which is the demo salon', async () => {
    const configuration = parsed(await readFile(EXAMPLE, 'utf8'));

    expect(configuration.salon.name).toBe('Peluquería de Caballeros Niza');
    expect(configuration.services).toHaveLength(4);
  });

  it.each([
    ['a price of 0, which is never a price (005)', { services: [{ id: CORTE, name: 'Corte', minutes: 30, priceCents: 0 }] }, 'services.0.priceCents'],
    ['a weekday outside 1–7', { opening: [{ weekday: 0, from: '10:00', to: '14:00' }] }, 'opening.0.weekday'],
    ['a time that is not HH:MM', { opening: [{ weekday: 1, from: '10h', to: '14:00' }] }, 'opening.0.from'],
    ['a service without an id', { services: [{ name: 'Corte', minutes: 30, priceCents: null }] }, 'services.0.id'],
    ['an empty catalogue', { services: [] }, 'services'],
    ['a date that is not a date', { holidays: [{ date: '25/12/2026', reason: 'Navidad' }] }, 'holidays.0.date'],
    ['an unknown key, likely a typo', { horario: [] }, 'horario'],
  ])('refuses %s, naming where', (_label, overrides, where) => {
    const outcome = parseSalonFile(file(overrides));

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.join('\n')).toContain(where);
  });

  it('refuses the same service twice', () => {
    const outcome = parseSalonFile(
      file({
        services: [
          { id: CORTE, name: 'Corte', minutes: 30, priceCents: null },
          { id: CORTE, name: 'Otra vez', minutes: 30, priceCents: null },
        ],
      }),
    );

    expect(outcome.ok).toBe(false);
  });

  it('refuses what is not JSON', () => {
    expect(parseSalonFile('{ salon: ').ok).toBe(false);
  });
});

describe('loadSalon', () => {
  it('writes the salon, its hours, its catalogue, its policy and its holidays', async () => {
    await loadSalon(connectionString, TIMEZONE, parsed(file()));

    const salon = await testPool().query(
      'SELECT name, minimum_lead_time_minutes, cancellation_deadline_hours FROM salon',
    );
    expect(salon.rows).toEqual([
      { name: 'Peluquería de prueba', minimum_lead_time_minutes: 120, cancellation_deadline_hours: 24 },
    ]);
    expect((await testPool().query('SELECT 1 FROM opening_interval')).rowCount).toBe(3);
    const holiday = await testPool().query<{ starts: string; ends: string }>(
      `SELECT to_char(starts_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS starts,
              to_char(ends_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS ends
         FROM unavailable_period`,
    );
    expect(holiday.rows).toEqual([{ starts: '2026-12-25 00:00', ends: '2026-12-26 00:00' }]);
  });

  it('keeps every period the owner blocked', async () => {
    await loadSalon(connectionString, TIMEZONE, parsed(file()));
    await testPool().query(
      `INSERT INTO unavailable_period (id, starts_at, ends_at, reason)
       VALUES ('00000000-0000-4000-8000-0000000000aa', '2026-12-01T09:00Z', '2026-12-01T11:00Z', 'Médico')`,
    );

    await loadSalon(connectionString, TIMEZONE, parsed(file({ holidays: [] })));

    const periods = await testPool().query('SELECT reason FROM unavailable_period ORDER BY reason');
    expect(periods.rows).toEqual([{ reason: 'Médico' }, { reason: 'Navidad' }]);
  });

  it('can be run again: the same holiday is not added twice', async () => {
    await loadSalon(connectionString, TIMEZONE, parsed(file()));
    await loadSalon(connectionString, TIMEZONE, parsed(file()));

    expect((await testPool().query('SELECT 1 FROM unavailable_period')).rowCount).toBe(1);
  });

  it('deactivates a service that leaves the file, without deleting it', async () => {
    await loadSalon(connectionString, TIMEZONE, parsed(file()));

    await loadSalon(
      connectionString,
      TIMEZONE,
      parsed(file({ services: [{ id: CORTE, name: 'Corte de pelo', minutes: 45, priceCents: 1500 }] })),
    );

    const services = await testPool().query(
      'SELECT id, duration_minutes, price_cents, is_active FROM service ORDER BY display_order, id',
    );
    expect(services.rows).toEqual([
      { id: CORTE, duration_minutes: 45, price_cents: 1500, is_active: true },
      { id: BARBA, duration_minutes: 30, price_cents: 1200, is_active: false },
    ]);
  });

  it('writes nothing at all when the database refuses part of it', async () => {
    await loadSalon(connectionString, TIMEZONE, parsed(file()));

    // Two stretches of one Monday that overlap: 0007 refuses them.
    const overlapping = parsed(
      file({
        salon: { name: 'Otro nombre', address: 'Calle Mayor 1', phone: '600 00 00 00' },
        opening: [
          { weekday: 1, from: '10:00', to: '14:00' },
          { weekday: 1, from: '13:00', to: '20:00' },
        ],
      }),
    );

    await expect(loadSalon(connectionString, TIMEZONE, overlapping)).rejects.toThrow();
    expect((await testPool().query('SELECT name FROM salon')).rows).toEqual([{ name: 'Peluquería de prueba' }]);
  });
});
