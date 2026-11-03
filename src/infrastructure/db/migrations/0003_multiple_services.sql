-- 0003 — one or more services per appointment, and an optional price (005).
--
-- The whole file runs in the one transaction `migrate` opens per migration:
-- either every appointment comes out with its service row, or none of this
-- happened.

-- D-001: one row per service of an appointment, each with the snapshot frozen
-- at booking time (FR-014). The exclusion constraint does not change: ends_at
-- is already the start plus the total duration.
CREATE TABLE appointment_service (
  appointment_id    uuid     NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
  -- Catalogue order at booking time (FR-006).
  position          smallint NOT NULL,
  -- RESTRICT, as before on appointment: a service an appointment references
  -- cannot be deleted from under it.
  service_id        uuid     NOT NULL REFERENCES service (id) ON DELETE RESTRICT,
  name              text     NOT NULL,
  duration_minutes  integer  NOT NULL,
  -- NULL is "no price" (FR-018), never 0.
  price_cents       integer,
  PRIMARY KEY (appointment_id, position),
  CONSTRAINT appointment_service_position_from_one CHECK (position >= 1),
  CONSTRAINT appointment_service_positive_duration CHECK (duration_minutes > 0),
  CONSTRAINT appointment_service_price_positive CHECK (price_cents IS NULL OR price_cents > 0)
);

-- FR-003: a service appears at most once in an appointment, enforced here and
-- not only by the application.
CREATE UNIQUE INDEX appointment_service_unique_service_idx
    ON appointment_service (appointment_id, service_id);

-- FR-021: every appointment booked before 005 becomes an appointment of one
-- service, with the snapshot it already had. A 0 meant "not agreed yet" and
-- becomes the NULL that says so (D-002).
INSERT INTO appointment_service
  (appointment_id, position, service_id, name, duration_minutes, price_cents)
SELECT id, 1, service_id, service_name, service_duration_minutes,
       NULLIF(service_price_cents, 0)
  FROM appointment;

ALTER TABLE appointment
  DROP COLUMN service_id,
  DROP COLUMN service_name,
  DROP COLUMN service_duration_minutes,
  DROP COLUMN service_price_cents;

-- D-002: the catalogue price becomes optional, and a price, when there is one,
-- is more than zero.
ALTER TABLE service DROP CONSTRAINT service_non_negative_price;
ALTER TABLE service ALTER COLUMN price_cents DROP NOT NULL;
UPDATE service SET price_cents = NULL WHERE price_cents = 0;
ALTER TABLE service ADD CONSTRAINT service_price_positive
  CHECK (price_cents IS NULL OR price_cents > 0);
