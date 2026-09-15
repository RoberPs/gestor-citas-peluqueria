import { Temporal } from '@js-temporal/polyfill';
import type { OpeningInterval } from '../catalog/salon';

/**
 * Candidate starts on a fixed grid, anchored to the hour, walking **each
 * opening stretch separately** (FR-004, BR-012).
 *
 * Walking the stretches separately is the whole point. A grid laid over the
 * day as a whole would happily propose 13:00 on a Saturday that closes at
 * 14:00, and the 90 minute service booked there would run into the close.
 * Here 13:00 belongs to the morning stretch and is judged against its end.
 */

export type CandidateStart = {
  readonly start: Temporal.PlainTime;
  /** The end of the stretch this candidate belongs to, and must finish inside. */
  readonly intervalEnd: Temporal.PlainTime;
};

function minutesOf(time: Temporal.PlainTime): number {
  return time.hour * 60 + time.minute;
}

function timeFromMinutes(minutes: number): Temporal.PlainTime {
  return new Temporal.PlainTime(Math.floor(minutes / 60), minutes % 60);
}

export function generateCandidateStarts(
  openingIntervals: readonly OpeningInterval[],
  gridMinutes: number,
): readonly CandidateStart[] {
  const ordered = [...openingIntervals].sort((a, b) =>
    Temporal.PlainTime.compare(a.startsAt, b.startsAt),
  );

  const candidates: CandidateStart[] = [];

  for (const interval of ordered) {
    const end = minutesOf(interval.endsAt);
    // Anchored to the hour: a stretch opening at 10:15 starts the grid at 10:30.
    let minutes = Math.ceil(minutesOf(interval.startsAt) / gridMinutes) * gridMinutes;

    while (minutes < end) {
      candidates.push({ start: timeFromMinutes(minutes), intervalEnd: interval.endsAt });
      minutes += gridMinutes;
    }
  }

  return candidates;
}
