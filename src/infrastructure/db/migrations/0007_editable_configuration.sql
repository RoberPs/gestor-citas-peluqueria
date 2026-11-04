-- 0007 — configuration the owner edits (002, D-022, FR-045).
--
-- What 001 loaded once and only read becomes data the owner saves. The rules a
-- save must keep are imposed here, not only in the form: the domain decides and
-- explains, the database makes it true whatever writes (data-model.md).

-- D-022: the two parameters that open up, on the one salon row. The defaults
-- are exactly 001's DEFAULT_BOOKING_POLICY, so no instance changes behaviour by
-- migrating: it only becomes editable. The rest of the policy — horizon, range,
-- grid, three per contact, retention — stays in code.
ALTER TABLE salon
  ADD COLUMN minimum_lead_time_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN cancellation_deadline_hours integer NOT NULL DEFAULT 24;

-- FR-054: 0 to 48 hours of lead time and 0 to 72 of deadline, in whole hours.
ALTER TABLE salon
  ADD CONSTRAINT salon_lead_time_range CHECK (minimum_lead_time_minutes BETWEEN 0 AND 2880),
  ADD CONSTRAINT salon_lead_time_whole_hours CHECK (minimum_lead_time_minutes % 60 = 0),
  ADD CONSTRAINT salon_cancellation_deadline_range CHECK (cancellation_deadline_hours BETWEEN 0 AND 72);

-- FR-045: two stretches of the same weekday never overlap. `starts_at <
-- ends_at` holds since 0001. PostgreSQL has no range over `time`, so one is
-- declared; the half-open '[)' lets a midday close start where the morning
-- ends. If an instance's data already overlaps, the migration fails here, as
-- a whole, rather than half way.
CREATE TYPE timerange AS RANGE (subtype = time);

ALTER TABLE opening_interval ADD CONSTRAINT opening_interval_no_overlap
  EXCLUDE USING gist (weekday WITH =, timerange(starts_at, ends_at, '[)') WITH &&);
