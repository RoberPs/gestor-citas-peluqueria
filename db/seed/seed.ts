import 'dotenv/config';
import { Temporal } from '@js-temporal/polyfill';
import { writeConfiguration } from './configuration';

/**
 * Preloaded configuration (FR-007): the salon, its weekly opening stretches,
 * its closures and its catalogue. Not optional — without it the booking screen
 * has nothing to offer.
 *
 * The values are chosen so the acceptance scenarios of the spec can be walked
 * through by hand, exactly as quickstart.md describes them.
 *
 * This is the fixture the tests rely on: names, ids and durations are what the
 * suites check against. Data to show a client lives in `demo.ts`.
 */

const SALON_ID = '00000000-0000-4000-8000-000000000001';

const SERVICES = [
  { id: '00000000-0000-4000-8000-000000000011', name: 'Corte', minutes: 30, cents: 1800, order: 1 },
  { id: '00000000-0000-4000-8000-000000000012', name: 'Color', minutes: 90, cents: 5500, order: 2 },
  {
    id: '00000000-0000-4000-8000-000000000013',
    name: 'Peinado',
    minutes: 45,
    cents: 2500,
    order: 3,
  },
] as const;

/**
 * Monday to Friday one stretch; Saturday with a midday close; Sunday nothing.
 * Saturday is what makes Historia 1 escenario 3 reproducible, and Sunday is the
 * closed day that must never be reported as full.
 */
const OPENING = [
  { weekday: 1, from: '10:00', to: '20:00' },
  { weekday: 2, from: '10:00', to: '20:00' },
  { weekday: 3, from: '10:00', to: '20:00' },
  { weekday: 4, from: '10:00', to: '20:00' },
  { weekday: 5, from: '10:00', to: '20:00' },
  { weekday: 6, from: '10:00', to: '14:00' },
  { weekday: 6, from: '16:00', to: '20:00' },
] as const;

const CLOSURE_ID = '00000000-0000-4000-8000-000000000031';

/**
 * A holiday inside the first 14 day range, so the grid always shows a CLOSED
 * day that is not a Sunday — the two states must be visibly the same to the
 * client and distinct from FULL.
 */
export function closureDate(timezone: string): string {
  const today = Temporal.Now.zonedDateTimeISO(timezone).toPlainDate();
  const candidate = today.add({ days: 7 });
  // Sunday is closed anyway; a closure there would prove nothing.
  return (candidate.dayOfWeek === 7 ? candidate.add({ days: 1 }) : candidate).toString();
}

export async function seed(connectionString: string, timezone: string): Promise<void> {
  await writeConfiguration(connectionString, timezone, {
    salon: {
      id: SALON_ID,
      name: 'Peluquería Aurora',
      address: 'Calle Mayor 14, Madrid',
      phone: '911 23 45 67',
    },
    opening: OPENING,
    services: SERVICES,
    closures: [{ id: CLOSURE_ID, date: closureDate(timezone), reason: 'Festivo local' }],
  });
}

export const SEED_IDS = {
  salon: SALON_ID,
  corte: SERVICES[0].id,
  color: SERVICES[1].id,
  peinado: SERVICES[2].id,
  closure: CLOSURE_ID,
} as const;

if (process.argv[1]?.endsWith('seed.ts') === true) {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString === '') {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  await seed(connectionString, process.env['SALON_TIMEZONE'] ?? 'Europe/Madrid');
  console.log('Seeded: salon, opening hours, three services and one closure.');
}
