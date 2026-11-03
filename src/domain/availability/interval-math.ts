import { Temporal } from '@js-temporal/polyfill';
import type { BusyInterval } from '../booking/appointment';

/**
 * The feature's interval arithmetic, in one place (002, D-019, D-020).
 *
 * Appointments and unavailable periods are both stretches of the one chair's
 * time, and whether two of them collide is decided here and nowhere else. The
 * slots of a day, CLOSED against FULL and, later, the free time of the owner's
 * agenda are all built on these two functions.
 */

/** Half-open comparison: touching at an endpoint is not overlapping (BR-013). */
export function overlaps(a: BusyInterval, b: BusyInterval): boolean {
  return (
    Temporal.Instant.compare(a.startsAt, b.endsAt) < 0 &&
    Temporal.Instant.compare(b.startsAt, a.endsAt) < 0
  );
}

function byStart(a: BusyInterval, b: BusyInterval): number {
  return Temporal.Instant.compare(a.startsAt, b.startsAt);
}

function later(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) >= 0 ? a : b;
}

/**
 * What is left of `base` once every stretch of `cut` is taken away, in
 * chronological order. `cut` may overlap itself; nothing is assumed sorted.
 */
export function subtractIntervals(
  base: readonly BusyInterval[],
  cut: readonly BusyInterval[],
): readonly BusyInterval[] {
  const holes = [...cut].sort(byStart);
  const left: BusyInterval[] = [];

  for (const stretch of [...base].sort(byStart)) {
    let cursor = stretch.startsAt;

    for (const hole of holes) {
      if (Temporal.Instant.compare(cursor, stretch.endsAt) >= 0) break;
      if (!overlaps({ startsAt: cursor, endsAt: stretch.endsAt }, hole)) continue;

      if (Temporal.Instant.compare(hole.startsAt, cursor) > 0) {
        left.push({ startsAt: cursor, endsAt: hole.startsAt });
      }
      cursor = later(cursor, hole.endsAt);
    }

    if (Temporal.Instant.compare(cursor, stretch.endsAt) < 0) {
      left.push({ startsAt: cursor, endsAt: stretch.endsAt });
    }
  }

  return left;
}
