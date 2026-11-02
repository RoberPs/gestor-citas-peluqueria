-- 0002 — the guarantees.
--
-- Everything below turns a business rule into an invariant the database
-- imposes, so that no future programming error can break it quietly.

-- BR-001 / SC-002 / FR-012: overlapping is IMPOSSIBLE, not unlikely.
-- The half-open range '[)' is what BR-013 needs: an appointment may start
-- exactly when the previous one ends. The WHERE clause is what makes BR-005
-- work: a cancelled appointment stops holding its slot the moment it is
-- cancelled, with no extra process and without deleting the row.
ALTER TABLE appointment ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'CONFIRMED');

-- BR-002: the slot is coherent.
ALTER TABLE appointment ADD CONSTRAINT appointment_positive_duration
  CHECK (ends_at > starts_at);

-- FR-030: the status and the cancellation moment cannot disagree.
ALTER TABLE appointment ADD CONSTRAINT appointment_cancelled_consistency
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

-- BR-018: anonymisation is all or nothing. There is no half-anonymised
-- appointment with a working link, and none with a dead link that kept the
-- phone number.
ALTER TABLE appointment ADD CONSTRAINT appointment_anonymization_is_atomic
  CHECK (
    (anonymized_at IS NULL
      AND customer_name IS NOT NULL AND customer_phone IS NOT NULL
      AND customer_email IS NOT NULL AND token_hash IS NOT NULL)
    OR
    (anonymized_at IS NOT NULL
      AND customer_name IS NULL AND customer_phone IS NULL
      AND customer_email IS NULL AND customer_phone_normalized IS NULL
      AND customer_email_normalized IS NULL AND token_hash IS NULL)
  );

-- All five indexes are PARTIAL. That is what sustains SC-005: the availability
-- index holds only confirmed appointments, so its size is bounded by the
-- business — one chair — and not by how long the salon has been open.

-- D-003 / SC-005: the past history does not take part in the availability query.
CREATE INDEX appointment_confirmed_starts_at_idx
    ON appointment (starts_at) WHERE status = 'CONFIRMED';

-- D-005: link resolution in O(1), and a hash belongs to at most one appointment.
CREATE UNIQUE INDEX appointment_token_hash_idx
    ON appointment (token_hash) WHERE token_hash IS NOT NULL;

-- BR-014: counting future appointments per contact, on the canonical form.
CREATE INDEX appointment_phone_future_idx
    ON appointment (customer_phone_normalized, starts_at) WHERE status = 'CONFIRMED';
CREATE INDEX appointment_email_future_idx
    ON appointment (customer_email_normalized, starts_at) WHERE status = 'CONFIRMED';

-- D-012: the retention sweep only ever looks at rows it has not processed.
CREATE INDEX appointment_retention_idx
    ON appointment (starts_at) WHERE anonymized_at IS NULL;
