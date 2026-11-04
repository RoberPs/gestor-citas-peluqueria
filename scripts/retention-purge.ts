import 'dotenv/config';
import { Pool } from 'pg';
import { createPurgeExpiredPersonalData } from '../src/application/use-cases/purge-expired-personal-data';
import { SESSION_IDLE_TIMEOUT_HOURS } from '../src/domain/owner/session';
import { createPersonalDataPurge } from '../src/infrastructure/db/appointment-repository';
import { createOwnerSessionRepository } from '../src/infrastructure/db/owner-session-repository';
import { createSalonConfigRepository } from '../src/infrastructure/db/salon-config-repository';
import { systemClock } from '../src/infrastructure/time/system-clock';

/**
 * The retention command (D-012).
 *
 * A cron entry runs it nightly at 03:30 salon time. It is the **only**
 * background process this feature has: the completed state is worked out from
 * the clock when an appointment is read, and needs none.
 *
 *   npm run retention:purge                      the nightly sweep
 *   npm run retention:purge -- --dry-run         what it would do, without doing it
 *   npm run retention:purge -- --appointment ID  one appointment, on request
 *
 * The last form is what lets the owner answer a client who asks for their data
 * to be deleted, from day one, while the screen for it waits for a later
 * feature.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArguments(argv: readonly string[]): {
  dryRun: boolean;
  appointmentId: string | undefined;
} {
  const dryRun = argv.includes('--dry-run');

  const flag = argv.indexOf('--appointment');
  if (flag === -1) return { dryRun, appointmentId: undefined };

  const value = argv[flag + 1];
  if (value === undefined || !UUID.test(value)) {
    throw new Error('--appointment needs the appointment id, as a UUID.');
  }

  return { dryRun, appointmentId: value };
}

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const { dryRun, appointmentId } = parseArguments(process.argv.slice(2));
const pool = new Pool({ connectionString, max: 2 });

try {
  const purge = createPurgeExpiredPersonalData({
    config: createSalonConfigRepository(() => pool),
    purge: createPersonalDataPurge(() => pool),
    clock: systemClock,
  });

  const outcome = await purge({ dryRun, appointmentId });

  // The count and the cutoff, and nothing else. Naming the appointments here
  // would put in a log exactly what the command exists to remove.
  const scope = appointmentId === undefined ? `older than ${outcome.cutoff}` : 'requested by id';
  const verb = outcome.dryRun ? 'would anonymise' : 'anonymised';

  console.log(`${verb} ${outcome.affected} appointment(s) ${scope}.`);

  // Tidying, not correctness: an idle session is already refused on read
  // (002, data-model.md, "Limpieza"). Only the nightly sweep does it.
  if (!dryRun && appointmentId === undefined) {
    const cutoff = systemClock.now().subtract({ hours: SESSION_IDLE_TIMEOUT_HOURS });
    const removed = await createOwnerSessionRepository(() => pool).deleteIdleSince(cutoff);
    console.log(`deleted ${removed} idle owner session(s).`);
  }
} finally {
  await pool.end();
}
