-- 0005 — unavailable periods replace whole-day closures (002, D-019).
--
-- One concept for a lunch hour, a holiday and three weeks away: a half-open
-- range of instants with an optional internal reason. The whole file runs in
-- the one transaction `migrate` opens per migration: either every closure comes
-- out as a period and `closure` is gone, or none of this happened.

CREATE TABLE unavailable_period (
  id          uuid        PRIMARY KEY,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  -- Internal. It never leaves towards the client (FR-021, BR-002).
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- FR-023. And no other constraint: two periods that overlap are harmless,
  -- and forcing the owner to merge them would buy nothing (D-019).
  CONSTRAINT unavailable_period_positive_length CHECK (ends_at > starts_at)
);

-- D-027: the question that matters is "which periods touch this window", and a
-- three-week period that began a fortnight ago is found by its range, not by
-- its start. Same half-open '[)' as the appointments' exclusion constraint.
CREATE INDEX unavailable_period_range_idx
    ON unavailable_period USING gist (tstzrange(starts_at, ends_at, '[)'));

-- Each closure becomes 00:00 to 00:00 of the next day in the salon's zone, so
-- the day the clocks change keeps its 23 or 25 real hours. With closures and no
-- salon the zone is NULL, the NOT NULL above refuses the row and the migration
-- stops here rather than guessing a zone.
INSERT INTO unavailable_period (id, starts_at, ends_at, reason, created_at)
SELECT closure.id,
       closure.date::timestamp AT TIME ZONE (SELECT timezone FROM salon),
       (closure.date + 1)::timestamp AT TIME ZONE (SELECT timezone FROM salon),
       closure.reason,
       now()
  FROM closure;

DROP TABLE closure;
