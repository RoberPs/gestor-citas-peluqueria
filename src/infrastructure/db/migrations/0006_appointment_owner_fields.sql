-- 0006 — what the owner's side needs on every appointment (002).
--
-- Where it came from, who cancelled it, its name as the bookings list searches
-- it, and an email and a link that may now be missing. One transaction, as
-- every migration: no appointment comes out half carried over.

-- D-026, FR-025: online or written by hand, and never changed afterwards. The
-- default is ONLINE because every appointment before 002 was, and so is every
-- one 001 writes; one written by hand that forgot to say so has no link and is
-- refused below, by the link rule, rather than passing as online.
CREATE TYPE appointment_origin AS ENUM ('ONLINE', 'OWNER');
ALTER TABLE appointment ADD COLUMN origin appointment_origin NOT NULL DEFAULT 'ONLINE';

-- D-032, FR-040a: who cancelled it. Before 002 the client's link was the only
-- way to cancel, so every existing cancellation is the client's.
CREATE TYPE appointment_actor AS ENUM ('CUSTOMER', 'OWNER');
ALTER TABLE appointment ADD COLUMN cancelled_by appointment_actor;
UPDATE appointment SET cancelled_by = 'CUSTOMER' WHERE status = 'CANCELLED';

-- Status, moment and author of a cancellation cannot disagree: a confirmed
-- appointment has neither, a cancelled one has both (BR-019).
ALTER TABLE appointment ADD CONSTRAINT appointment_cancelled_by_consistency
  CHECK ((status = 'CANCELLED') = (cancelled_by IS NOT NULL));

-- D-036, FR-069: the name as the bookings list compares it — decomposed, with
-- the combining marks U+0300–U+036F taken off, lower case and single spaces.
-- It is `searchableName` of the domain written in SQL; a test holds the two to
-- the same answer. Generated, so it follows the name everywhere: on insert, on
-- an edit and to NULL when the name is anonymised, with no code to forget it.
-- After the marks go a Spanish name is plain ASCII, so `lower` is safe under
-- any collation.
ALTER TABLE appointment ADD COLUMN customer_name_search text
  GENERATED ALWAYS AS (
    btrim(regexp_replace(
      lower(regexp_replace(normalize(customer_name, NFD), '[\u0300-\u036f]', '', 'g')),
      '\s+', ' ', 'g'))
  ) STORED;

-- D-026: the email may be missing from an appointment written by hand
-- (FR-024), and only an online booking has a management link (FR-026). The
-- guarantee of 0002 stays whole: there is no half-anonymised appointment, and
-- now no manual one with a link either.
ALTER TABLE appointment DROP CONSTRAINT appointment_anonymization_is_atomic;
ALTER TABLE appointment ADD CONSTRAINT appointment_anonymization_is_atomic
  CHECK (
    (anonymized_at IS NULL
      AND customer_name IS NOT NULL
      AND customer_phone IS NOT NULL
      AND (customer_email IS NOT NULL) = (customer_email_normalized IS NOT NULL)
      AND (token_hash IS NOT NULL) = (origin = 'ONLINE'))
    OR
    (anonymized_at IS NOT NULL
      AND customer_name IS NULL AND customer_phone IS NULL
      AND customer_email IS NULL AND customer_phone_normalized IS NULL
      AND customer_email_normalized IS NULL AND token_hash IS NULL)
  );

-- D-033: the bookings list. The default order with "Confirmadas" is already
-- served by the partial appointment_confirmed_starts_at_idx; these two serve
-- "Canceladas" and "Todas", and the order by booking time, by cursor.
CREATE INDEX appointment_starts_at_id_idx ON appointment (starts_at, id);
CREATE INDEX appointment_created_at_id_idx ON appointment (created_at DESC, id DESC);
