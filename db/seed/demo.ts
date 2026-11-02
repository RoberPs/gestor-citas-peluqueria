import 'dotenv/config';
import { writeConfiguration } from './configuration';

/**
 * The salon as shown to the client in a demo: the real business, with the
 * data that is still being agreed on left provisional.
 *
 * - Every service takes 30 minutes: the barber has not set durations yet, and
 *   bookings keep going every half hour.
 * - Prices are 0 until they are agreed with the client. They become optional
 *   in feature 005; until then the screen shows "0,00 €".
 * - No closures: real holidays are added once the salon gives them.
 *
 * Tests never use this data; their fixture is `seed.ts`. Running either script
 * switches the database to it.
 */

const SALON_ID = '00000000-0000-4000-8000-000000000001';

const SERVICES = [
  { id: '00000000-0000-4000-8000-000000000021', name: 'Corte de pelo', order: 1 },
  { id: '00000000-0000-4000-8000-000000000022', name: 'Afeitado clásico', order: 2 },
  { id: '00000000-0000-4000-8000-000000000023', name: 'Diseño y corte de barba', order: 3 },
  {
    id: '00000000-0000-4000-8000-000000000024',
    name: 'Diseño y corte de perilla o bigote',
    order: 4,
  },
].map((service) => ({ ...service, minutes: 30, cents: 0 }));

/** Monday to Friday 10:00–14:00 and 17:00–20:00; Saturday 10:00–14:00. */
const OPENING = [1, 2, 3, 4, 5]
  .flatMap((weekday) => [
    { weekday, from: '10:00', to: '14:00' },
    { weekday, from: '17:00', to: '20:00' },
  ])
  .concat([{ weekday: 6, from: '10:00', to: '14:00' }]);

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

await writeConfiguration(connectionString, process.env['SALON_TIMEZONE'] ?? 'Europe/Madrid', {
  salon: {
    id: SALON_ID,
    name: 'Peluquería de Caballeros Niza',
    address: 'Calle Miguel Ángel, 15, 28932 Móstoles',
    phone: '619 97 88 55',
  },
  opening: OPENING,
  services: SERVICES,
  closures: [],
});
console.log('Seeded the demo: Peluquería de Caballeros Niza, four services, no closures.');
