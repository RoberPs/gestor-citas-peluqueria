import 'dotenv/config';
import { writeConfiguration } from './configuration';

/**
 * The salon as shown to the client in a demo: the real business, with the
 * data that is still being agreed on left provisional.
 *
 * - Every service takes 30 minutes: the barber has not set durations yet, and
 *   bookings keep going every half hour.
 * - No service has a price until they are agreed with the client: the screen
 *   says "Precio a consultar en el salón" (feature 005).
 * - A client may book several services in one appointment: "Corte de pelo"
 *   and "Diseño y corte de barba" make one appointment of 1 h.
 * - No holidays: real ones are added once the salon gives them.
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
].map((service) => ({ ...service, minutes: 30, cents: null }));

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
  holidays: [],
});
console.log('Seeded the demo: Peluquería de Caballeros Niza, four services, no holidays.');
