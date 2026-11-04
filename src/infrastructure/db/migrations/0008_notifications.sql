-- 0008 — the booking confirmation email (004, data-model.md).
--
-- Two tables, and neither holds personal data (Principio III): ids, channels,
-- states, moments, reasons and hashes. The address is the appointment's, and
-- nothing here copies it. What a row may hold in each state is imposed here,
-- so it holds whatever writes. `scripts/migrate.ts` runs it in one transaction.

CREATE TYPE notification_channel AS ENUM ('EMAIL', 'SMS');
CREATE TYPE notification_kind AS ENUM ('BOOKING_CONFIRMATION');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_SENT');
CREATE TYPE notification_skip_reason AS ENUM
  ('CONSENT_ENDED', 'APPOINTMENT_CANCELLED', 'PERSONAL_DATA_DELETED');
CREATE TYPE consent_end_reason AS ENUM ('UNSUBSCRIBED', 'EMAIL_CHANGED');

-- D-007: one consent per appointment and channel. No row and an ended row mean
-- the same to the dispatch: nothing is sent.
CREATE TABLE channel_consent (
  appointment_id         uuid                 NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
  channel                notification_channel NOT NULL,
  granted_at             timestamptz          NOT NULL,
  ended_at               timestamptz,
  end_reason             consent_end_reason,
  -- SHA-256 of the unsubscribe token, as for the management link (FR-024).
  -- NULL once the appointment is anonymised (FR-021).
  unsubscribe_token_hash bytea,

  PRIMARY KEY (appointment_id, channel),
  CONSTRAINT channel_consent_end_has_reason CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CONSTRAINT channel_consent_hash_length
    CHECK (unsubscribe_token_hash IS NULL OR octet_length(unsubscribe_token_hash) = 32)
);

CREATE UNIQUE INDEX channel_consent_unsubscribe_token_hash_key
  ON channel_consent (unsubscribe_token_hash)
  WHERE unsubscribe_token_hash IS NOT NULL;

-- FR-019: every notification the app tries to send, and its record. No column
-- for the recipient, the subject or the body (FR-020).
CREATE TABLE notification (
  -- Also the provider's Idempotency-Key (D-004).
  id              uuid                     PRIMARY KEY,
  appointment_id  uuid                     NOT NULL REFERENCES appointment (id) ON DELETE CASCADE,
  channel         notification_channel     NOT NULL,
  kind            notification_kind        NOT NULL,
  status          notification_status      NOT NULL,
  skip_reason     notification_skip_reason,
  attempts        smallint                 NOT NULL DEFAULT 0,
  -- The hour of retries counts from here (FR-011).
  created_at      timestamptz              NOT NULL,
  next_attempt_at timestamptz,
  updated_at      timestamptz              NOT NULL,
  -- D-002: the management and unsubscribe tokens, AES-256-GCM, while pending.
  sealed_tokens   bytea,

  -- FR-012: an appointment never has two confirmations by email.
  CONSTRAINT notification_one_per_kind UNIQUE (appointment_id, channel, kind),
  CONSTRAINT notification_pending_has_next_attempt
    CHECK ((status = 'PENDING') = (next_attempt_at IS NOT NULL)),
  -- D-002: no sealed token outlives a final state.
  CONSTRAINT notification_pending_has_tokens
    CHECK ((status = 'PENDING') = (sealed_tokens IS NOT NULL)),
  CONSTRAINT notification_not_sent_has_reason
    CHECK ((status = 'NOT_SENT') = (skip_reason IS NOT NULL))
);

-- The dispatch reads only what is due (D-003).
CREATE INDEX notification_due_idx ON notification (next_attempt_at) WHERE status = 'PENDING';
