import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle's view of the schema. The migrations in `migrations/` are the source
 * of truth (D-008); this file types the queries against them.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const appointmentStatus = pgEnum('appointment_status', ['CONFIRMED', 'CANCELLED']);

export const salon = pgTable('salon', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  phone: text('phone').notNull(),
  timezone: text('timezone').notNull(),
});

export const openingInterval = pgTable('opening_interval', {
  id: uuid('id').primaryKey(),
  weekday: smallint('weekday').notNull(),
  startsAt: time('starts_at').notNull(),
  endsAt: time('ends_at').notNull(),
});

export const closure = pgTable('closure', {
  id: uuid('id').primaryKey(),
  date: date('date', { mode: 'string' }).notNull(),
  /** Internal. Never leaves the database: the client sees "closed", never why. */
  reason: text('reason').notNull(),
});

export const service = pgTable('service', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  /** `NULL` is "no price" (FR-018), never 0. */
  priceCents: integer('price_cents'),
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull(),
});

export const appointment = pgTable('appointment', {
  id: uuid('id').primaryKey(),
  status: appointmentStatus('status').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),

  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  customerEmail: text('customer_email'),
  customerPhoneNormalized: text('customer_phone_normalized'),
  customerEmailNormalized: text('customer_email_normalized'),

  tokenHash: bytea('token_hash'),

  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
  anonymizedAt: timestamp('anonymized_at', { withTimezone: true, mode: 'date' }),
});

/** One row per service of an appointment, with its snapshot (005, D-001). */
export const appointmentService = pgTable('appointment_service', {
  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointment.id, { onDelete: 'cascade' }),
  position: smallint('position').notNull(),
  serviceId: uuid('service_id')
    .notNull()
    .references(() => service.id),
  name: text('name').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  priceCents: integer('price_cents'),
});

export const schema = { salon, openingInterval, closure, service, appointment, appointmentService };
