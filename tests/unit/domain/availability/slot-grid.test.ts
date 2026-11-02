import { describe, expect, it } from 'vitest';
import { generateCandidateStarts } from '@/domain/availability/slot-grid';
import { interval } from './_fixtures';

/**
 * FR-004 / BR-012: candidate starts every 30 minutes, anchored to the hour,
 * walking **each opening stretch separately**.
 *
 * Walking the stretches separately is what stops a 90 minute service being
 * offered at 13:00 on a day that closes at 14:00 — the candidate simply never
 * belongs to a stretch that can hold it.
 */

function starts(candidates: readonly { start: { toString(): string } }[]): readonly string[] {
  return candidates.map((candidate) => candidate.start.toString().slice(0, 5));
}

describe('generateCandidateStarts', () => {
  it('walks a single stretch on the half hour, up to but not including the close', () => {
    const candidates = generateCandidateStarts([interval(5, '10:00', '12:00')], 30);

    expect(starts(candidates)).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });

  it('walks each stretch separately and keeps the gap empty', () => {
    const candidates = generateCandidateStarts(
      [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')],
      30,
    );

    const list = starts(candidates);

    expect(list).toContain('13:30');
    expect(list).toContain('16:00');
    // Nothing between the two stretches: the midday close is the absence of a
    // stretch, not a stretch of its own.
    expect(list.filter((time) => time >= '14:00' && time < '16:00')).toEqual([]);
  });

  it('carries the end of the stretch each candidate belongs to', () => {
    const candidates = generateCandidateStarts(
      [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')],
      30,
    );

    const oneOClock = candidates.find((c) => c.start.toString().startsWith('13:00'));
    const four = candidates.find((c) => c.start.toString().startsWith('16:00'));

    expect(oneOClock?.intervalEnd.toString().slice(0, 5)).toBe('14:00');
    expect(four?.intervalEnd.toString().slice(0, 5)).toBe('20:00');
  });

  it('anchors to the hour even when the stretch opens off the grid', () => {
    const candidates = generateCandidateStarts([interval(3, '10:15', '12:00')], 30);

    // 10:15 is not on the grid; the first candidate is 10:30, not 10:15.
    expect(starts(candidates)).toEqual(['10:30', '11:00', '11:30']);
  });

  it('returns nothing for a weekday with no stretches: a closed day', () => {
    expect(generateCandidateStarts([], 30)).toEqual([]);
  });

  it('returns nothing for a stretch shorter than one grid step off the grid', () => {
    expect(generateCandidateStarts([interval(3, '10:05', '10:25')], 30)).toEqual([]);
  });

  it('honours a different grid size without re-anchoring', () => {
    const candidates = generateCandidateStarts([interval(5, '10:00', '11:00')], 15);

    expect(starts(candidates)).toEqual(['10:00', '10:15', '10:30', '10:45']);
  });

  it('keeps the candidates of the two stretches in chronological order', () => {
    const candidates = generateCandidateStarts(
      [interval(6, '16:00', '20:00'), interval(6, '10:00', '14:00')],
      30,
    );

    const list = starts(candidates);
    expect([...list]).toEqual([...list].sort());
  });
});
