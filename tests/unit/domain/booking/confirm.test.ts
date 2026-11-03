import type { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { validateBookingRequest } from '@/domain/booking/confirm';
import type { BusyInterval } from '@/domain/booking/appointment';
import type { OpeningInterval } from '@/domain/catalog/salon';
import type { ServiceSnapshot } from '@/domain/catalog/service';
import type { RawContact } from '@/domain/contact/contact';
import { localDateOf } from '@/domain/shared/time';
import { at, busy, interval, MADRID, NOW, POLICY } from '../availability/_fixtures';

/**
 * FR-011 and FR-034: the server re-checks **everything** the interface already
 * checked. Nothing arriving from the client is taken on trust, not even that
 * the start sits on the grid.
 */

const CORTE: ServiceSnapshot = {
  serviceId: '00000000-0000-4000-8000-000000000011',
  name: 'Corte',
  durationMinutes: 30,
  priceCents: 1800,
};

const COLOR: ServiceSnapshot = { ...CORTE, name: 'Color', durationMinutes: 90, priceCents: 5500 };

const GOOD_CONTACT: RawContact = {
  name: 'Ana López',
  phone: '600 11 22 33',
  email: 'Ana@Example.com',
};

type Options = {
  requestedStart?: Temporal.Instant;
  service?: ServiceSnapshot;
  contact?: RawContact;
  openingIntervals?: OpeningInterval[];
  isClosed?: boolean;
  confirmed?: BusyInterval[];
  now?: Temporal.Instant;
};

function validate(options: Options = {}) {
  const requestedStart = options.requestedStart ?? at('2026-09-18', '11:30');

  return validateBookingRequest({
    requestedStart,
    // The salon's calendar date of the requested start, as the Route Handler
    // derives it rather than taking the client's word for it.
    date: localDateOf(requestedStart, MADRID),
    services: [options.service ?? CORTE],
    contact: options.contact ?? GOOD_CONTACT,
    openingIntervals: options.openingIntervals ?? [interval(5, '10:00', '20:00')],
    isClosed: options.isClosed ?? false,
    confirmedAppointments: options.confirmed ?? [],
    now: options.now ?? NOW,
    policy: POLICY,
    timezone: MADRID,
  });
}

function rejection(options: Options = {}) {
  const result = validate(options);
  if (result.ok) throw new Error('expected a rejection');
  return result.error;
}

describe('a booking that passes every check', () => {
  it('returns the slot with the contact already normalised', () => {
    const result = validate();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.startsAt.equals(at('2026-09-18', '11:30'))).toBe(true);
    expect(result.value.endsAt.equals(at('2026-09-18', '12:00'))).toBe(true);
    expect(result.value.contact.normalizedPhone).toBe('+34600112233');
    expect(result.value.contact.normalizedEmail).toBe('ana@example.com');
    // What the client typed survives: it is what the owner reads out on the phone.
    expect(result.value.contact.phone).toBe('600 11 22 33');
    expect(result.value.contact.name).toBe('Ana López');
  });

  it('derives the end from the snapshot duration, not from the catalogue', () => {
    const result = validate({ service: COLOR, requestedStart: at('2026-09-18', '11:30') });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.endsAt.equals(at('2026-09-18', '13:00'))).toBe(true);
  });
});

describe('SLOT_TAKEN (BR-001)', () => {
  it('rejects a start that overlaps a confirmed appointment', () => {
    expect(rejection({ confirmed: [busy('2026-09-18', '11:00', '12:00')] })).toEqual({
      kind: 'SLOT_TAKEN',
    });
  });

  it('accepts a start that begins exactly when another ends (BR-013)', () => {
    expect(validate({ confirmed: [busy('2026-09-18', '10:00', '11:30')] }).ok).toBe(true);
  });

  it('rejects a long service that would swallow a later appointment', () => {
    expect(
      rejection({
        service: COLOR,
        requestedStart: at('2026-09-18', '11:30'),
        confirmed: [busy('2026-09-18', '12:30', '13:00')],
      }),
    ).toEqual({ kind: 'SLOT_TAKEN' });
  });
});

describe('TOO_LATE_TO_BOOK (BR-003)', () => {
  it('rejects a start less than two hours away and says the earliest one', () => {
    const error = rejection({
      requestedStart: at('2026-09-15', '11:00'),
      now: at('2026-09-15', '10:00'),
      openingIntervals: [interval(2, '10:00', '20:00')],
    });

    expect(error.kind).toBe('TOO_LATE_TO_BOOK');
    if (error.kind !== 'TOO_LATE_TO_BOOK') throw new Error('unreachable');
    expect(error.earliestStart.equals(at('2026-09-15', '12:00'))).toBe(true);
  });

  it('accepts a start exactly on the two hour boundary', () => {
    const result = validate({
      requestedStart: at('2026-09-15', '12:00'),
      now: at('2026-09-15', '10:00'),
      openingIntervals: [interval(2, '10:00', '20:00')],
    });

    expect(result.ok).toBe(true);
  });
});

describe('OUTSIDE_OPENING_HOURS (FR-003a, BR-002)', () => {
  it('rejects a start on a closed day', () => {
    expect(rejection({ isClosed: true })).toEqual({ kind: 'OUTSIDE_OPENING_HOURS' });
  });

  it('rejects a start before the salon opens', () => {
    expect(rejection({ requestedStart: at('2026-09-18', '09:30') })).toEqual({
      kind: 'OUTSIDE_OPENING_HOURS',
    });
  });

  it('rejects a service that would finish after closing', () => {
    expect(rejection({ service: COLOR, requestedStart: at('2026-09-18', '19:00') })).toEqual({
      kind: 'OUTSIDE_OPENING_HOURS',
    });
  });

  it('rejects a service that would cross the midday close', () => {
    expect(
      rejection({
        service: COLOR,
        requestedStart: at('2026-09-19', '13:00'),
        openingIntervals: [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')],
      }),
    ).toEqual({ kind: 'OUTSIDE_OPENING_HOURS' });
  });

  it('rejects a start inside the midday close itself', () => {
    expect(
      rejection({
        requestedStart: at('2026-09-19', '15:00'),
        openingIntervals: [interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00')],
      }),
    ).toEqual({ kind: 'OUTSIDE_OPENING_HOURS' });
  });
});

describe('BEYOND_HORIZON (BR-011) — only a tampered request produces this', () => {
  it('rejects a start past day 60 and says where the horizon ends', () => {
    const error = rejection({ requestedStart: at('2026-11-20', '11:30') });

    expect(error.kind).toBe('BEYOND_HORIZON');
    if (error.kind !== 'BEYOND_HORIZON') throw new Error('unreachable');
    expect(error.horizonEnd.toString()).toBe('2026-11-14');
  });
});

describe('NOT_ON_GRID (FR-004) — only a tampered request produces this', () => {
  it('rejects a start off the 30 minute grid', () => {
    expect(rejection({ requestedStart: at('2026-09-18', '11:07') })).toEqual({
      kind: 'NOT_ON_GRID',
    });
  });

  it('rejects a start on the grid of seconds but not of minutes', () => {
    expect(
      rejection({ requestedStart: at('2026-09-18', '11:30').add({ seconds: 30 }) }),
    ).toEqual({ kind: 'NOT_ON_GRID' });
  });
});

describe('INVALID_CONTACT (FR-009)', () => {
  it('names the offending field so the form can point at it', () => {
    const error = rejection({ contact: { ...GOOD_CONTACT, phone: '12345' } });

    expect(error.kind).toBe('INVALID_CONTACT');
    if (error.kind !== 'INVALID_CONTACT') throw new Error('unreachable');
    expect(error.fields).toEqual([{ field: 'customer.phone', code: 'INVALID_PHONE' }]);
  });

  it('reports every offending field at once, not one per round trip', () => {
    const error = rejection({ contact: { name: '', phone: '12345', email: 'nope' } });

    expect(error.kind).toBe('INVALID_CONTACT');
    if (error.kind !== 'INVALID_CONTACT') throw new Error('unreachable');
    expect(error.fields.map((field) => field.field)).toEqual([
      'customer.name',
      'customer.phone',
      'customer.email',
    ]);
  });

  it('rejects a name longer than 100 characters', () => {
    const error = rejection({ contact: { ...GOOD_CONTACT, name: 'a'.repeat(101) } });

    expect(error.kind).toBe('INVALID_CONTACT');
  });
});

describe('which rejection wins when more than one applies', () => {
  it('reports the slot before the contact: fixing a phone for a lost hour is wasted work', () => {
    const error = rejection({
      confirmed: [busy('2026-09-18', '11:00', '12:00')],
      contact: { ...GOOD_CONTACT, phone: '12345' },
    });

    expect(error.kind).toBe('SLOT_TAKEN');
  });
});
