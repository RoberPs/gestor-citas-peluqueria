-- 0004 — the owner's account and her sessions (002, FR-001, D-015, D-017).
--
-- Neither table holds anything about a client, and neither has a column for an
-- IP address or a device: the sign-in lock is per account, never per origin
-- (FR-009). Recovery is out of scope (FR-005), so there is no recovery email,
-- question or reset token waiting for a flow that does not exist.

-- FR-001: one staff account. Zero rows is an instance not yet provisioned, in
-- which every sign-in fails with the neutral answer (FR-003, FR-008).
CREATE TABLE owner_account (
  id                       uuid        PRIMARY KEY,
  username                 text        NOT NULL,
  -- `scrypt$N$r$p$salt$hash`: the parameters travel with the hash (D-016).
  password_hash            text        NOT NULL,
  password_changed_at      timestamptz NOT NULL,
  failed_attempts          integer     NOT NULL DEFAULT 0,
  first_failed_attempt_at  timestamptz,
  locked_until             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_account_failed_attempts_non_negative CHECK (failed_attempts >= 0),
  -- The count and the start of its window cannot disagree (data-model.md).
  CONSTRAINT owner_account_failure_window_consistency
    CHECK ((failed_attempts = 0) = (first_failed_attempt_at IS NULL))
);

CREATE UNIQUE INDEX owner_account_single_row_idx ON owner_account ((true));

-- D-015: one row per live session. Only the SHA-256 of the cookie's 32 bytes is
-- kept, so a dump of the database hands out no usable session. Signing out
-- deletes the row; idleness is a comparison on last_seen_at, not a state.
CREATE TABLE owner_session (
  id            uuid        PRIMARY KEY,
  account_id    uuid        NOT NULL REFERENCES owner_account (id) ON DELETE CASCADE,
  token_hash    bytea       NOT NULL,
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL
);

CREATE UNIQUE INDEX owner_session_token_hash_idx ON owner_session (token_hash);

-- The retention sweep deletes the idle ones (data-model.md, "Limpieza").
CREATE INDEX owner_session_last_seen_at_idx ON owner_session (last_seen_at);
