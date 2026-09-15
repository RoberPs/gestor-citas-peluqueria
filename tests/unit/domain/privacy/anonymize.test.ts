import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/booking/appointment';
import { anonymize, isDueForAnonymization } from '@/domain/privacy/anonymize';
import { at, MADRID } from '../availability/_fixtures';

/**
 * BR-018: the twelve month deletion anonymises rather than removes. The person
 * goes, the occupancy stays, and the link dies in the same act.
 */

const RETENTION_MONTHS = 12;

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'b2e9c0de',
    status: 'CONFIRMED',
    startsAt: at('2026-09-18', '11:30'),
    endsAt: at('2026-09-18', '12:00'),
    service: { serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 },
    customer: { name: 'Ana López', phone: '600112233', email: 'ana@example.com' },
    createdAt: at('2026-09-15', '10:00'),
    cancelledAt: null,
    anonymizedAt: null,
    ...overrides,
  };
}

describe('anonymize — what goes', () => {
  it('drops the whole customer, not one field of it', () => {
    const result = anonymize(appointment(), at('2027-09-18', '03:30'));

    expect(result.customer).toBeNull();
  });

  it('records when it happened', () => {
    const when = at('2027-09-18', '03:30');

    expect(anonymize(appointment(), when).anonymizedAt.equals(when)).toBe(true);
  });

  it('leaves the original value untouched', () => {
    const original = appointment();

    anonymize(original, at('2027-09-18', '03:30'));

    expect(original.customer).not.toBeNull();
    expect(original.anonymizedAt).toBeNull();
  });
});

describe('anonymize — what stays (FR-035a)', () => {
  it('keeps the service snapshot, so the occupancy history stays readable', () => {
    const original = appointment();

    const result = anonymize(original, at('2027-09-18', '03:30'));

    expect(result.service).toEqual(original.service);
  });

  it('keeps the slot and the status', () => {
    const original = appointment({ status: 'CANCELLED', cancelledAt: at('2026-09-17', '09:00') });

    const result = anonymize(original, at('2027-09-18', '03:30'));

    expect(result.startsAt.equals(original.startsAt)).toBe(true);
    expect(result.endsAt.equals(original.endsAt)).toBe(true);
    expect(result.status).toBe('CANCELLED');
    expect(result.cancelledAt?.equals(original.cancelledAt ?? original.startsAt)).toBe(true);
  });

  it('keeps the internal identifier, which is what traces reference', () => {
    expect(anonymize(appointment(), at('2027-09-18', '03:30')).id).toBe('b2e9c0de');
  });

  it('keeps the moment it was created', () => {
    const original = appointment();

    expect(
      anonymize(original, at('2027-09-18', '03:30')).createdAt.equals(original.createdAt),
    ).toBe(true);
  });
});

describe('isDueForAnonymization — the twelve month boundary', () => {
  it('is not due the day before twelve months have passed', () => {
    const now = at('2027-09-17', '03:30');

    expect(isDueForAnonymization(appointment(), now, RETENTION_MONTHS, MADRID)).toBe(false);
  });

  it('is not due one second before the boundary', () => {
    const now = at('2027-09-18', '11:30').subtract({ seconds: 1 });

    expect(isDueForAnonymization(appointment(), now, RETENTION_MONTHS, MADRID)).toBe(false);
  });

  it('is due exactly at twelve months', () => {
    const now = at('2027-09-18', '11:30');

    expect(isDueForAnonymization(appointment(), now, RETENTION_MONTHS, MADRID)).toBe(true);
  });

  it('is due well after', () => {
    const now = at('2028-01-01', '03:30');

    expect(isDueForAnonymization(appointment(), now, RETENTION_MONTHS, MADRID)).toBe(true);
  });

  it('is not due for an appointment still in the future', () => {
    const now = at('2026-09-16', '03:30');

    expect(isDueForAnonymization(appointment(), now, RETENTION_MONTHS, MADRID)).toBe(false);
  });

  it('is never due twice: an already anonymised appointment is done', () => {
    const done = appointment({ customer: null, anonymizedAt: at('2027-09-18', '03:30') });

    expect(isDueForAnonymization(done, at('2028-01-01', '03:30'), RETENTION_MONTHS, MADRID)).toBe(
      false,
    );
  });

  it('counts calendar months rather than a fixed number of days', () => {
    // A February appointment is due on the following February, whatever the
    // leap year does to the day count in between.
    const february = appointment({
      startsAt: at('2028-02-29', '11:30'),
      endsAt: at('2028-02-29', '12:00'),
    });

    expect(isDueForAnonymization(february, at('2029-02-27', '03:30'), 12, MADRID)).toBe(false);
    expect(isDueForAnonymization(february, at('2029-03-01', '03:30'), 12, MADRID)).toBe(true);
  });
});
