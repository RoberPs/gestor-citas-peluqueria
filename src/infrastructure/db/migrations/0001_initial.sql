-- 0001 — configuration tables and the appointment table.
--
-- btree_gist first: without it the exclusion constraint of 0002 cannot mix the
-- equality operator with the range overlap operator, and the migration fails
-- with "type gist does not exist".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- FR-030: exactly two persisted states. COMPLETED is derived from the clock
-- when the appointment is read (FR-031) and is deliberately absent here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM ('CONFIRMED', 'CANCELLED');
  END IF;
END
$$;

-- The single establishment of this instance (asunción 11).
CREATE TABLE salon (
  id        uuid PRIMARY KEY,
  name      text NOT NULL,
  address   text NOT NULL,
  phone     text NOT NULL,
  -- IANA timezone. Salon configuration, not a system constant (asunción 9).
  timezone  text NOT NULL
);

-- Exactly one row, always. Enforced rather than assumed.
CREATE UNIQUE INDEX salon_single_row_idx ON salon ((true));

-- One opening stretch of one weekday, as wall time (FR-007a).
-- A weekday with no row is a closed day.
CREATE TABLE opening_interval (
  id         uuid     PRIMARY KEY,
  weekday    smallint NOT NULL,
  starts_at  time     NOT NULL,
  ends_at    time     NOT NULL,
  CONSTRAINT opening_interval_weekday_iso CHECK (weekday BETWEEN 1 AND 7),
  -- No stretch crosses midnight.
  CONSTRAINT opening_interval_positive CHECK (starts_at < ends_at)
);

-- A whole day closed by a holiday or an absence. The reason is internal and
-- never reaches a client response: the client sees "closed", never why.
CREATE TABLE closure (
  id      uuid PRIMARY KEY,
  date    date NOT NULL UNIQUE,
  reason  text NOT NULL
);

CREATE TABLE service (
  id                uuid    PRIMARY KEY,
  name              text    NOT NULL,
  duration_minutes  integer NOT NULL,
  -- Cents as an integer, never a float. Informative: v1 charges nothing.
  price_cents       integer NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  display_order     integer NOT NULL,
  CONSTRAINT service_positive_duration CHECK (duration_minutes > 0),
  CONSTRAINT service_non_negative_price CHECK (price_cents >= 0)
);

-- The only table this feature writes.
CREATE TABLE appointment (
  id                        uuid               PRIMARY KEY,
  status                    appointment_status NOT NULL,
  starts_at                 timestamptz        NOT NULL,
  ends_at                   timestamptz        NOT NULL,

  -- Kept for rescheduling to the same service; RESTRICT so a service cannot be
  -- deleted out from under an appointment that references it.
  service_id                uuid        NOT NULL REFERENCES service (id) ON DELETE RESTRICT,
  -- Snapshot frozen at booking time (FR-016, D-011).
  service_name              text        NOT NULL,
  service_duration_minutes  integer     NOT NULL,
  service_price_cents       integer     NOT NULL,

  -- The three personal fields and their canonical forms. All NULL once
  -- anonymised, and only all together (constraint in 0002).
  customer_name             text,
  customer_phone            text,
  customer_email            text,
  customer_phone_normalized text,
  customer_email_normalized text,

  -- sha256 of the management token (D-005). A database dump hands out no
  -- usable links. NULL once anonymised: the link stops resolving.
  token_hash                bytea,

  created_at                timestamptz NOT NULL DEFAULT now(),
  cancelled_at              timestamptz,
  anonymized_at             timestamptz
);
