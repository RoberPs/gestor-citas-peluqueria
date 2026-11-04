import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BOOKING_POLICY, type Salon } from '@/domain/catalog/salon';
import { confirmationContent } from '@/domain/notifications/confirmation-content';
import { appointment } from './_fixtures';

/**
 * 004, FR-006 and FR-007: the data of the email, not its text. Days and hours
 * in the salon's zone, every service with its price or none, the total by the
 * rule of 005, and nothing personal but the name.
 */

const SALON: Salon = {
  name: 'Peluquería de Caballeros Niza',
  address: 'Calle Niza 12, Madrid',
  phone: '910 11 22 33',
  timezone: 'Europe/Madrid',
};

function contentOf(overrides: Parameters<typeof appointment>[0] = {}, policy = DEFAULT_BOOKING_POLICY) {
  const result = confirmationContent(appointment(overrides), SALON, policy);
  if (!result.ok) throw new Error(`no content: ${result.error}`);
  return result.value;
}

describe('confirmationContent', () => {
  it('names the salon with its address and phone', () => {
    expect(contentOf().salon).toEqual({
      name: SALON.name,
      address: SALON.address,
      phone: SALON.phone,
    });
  });

  it('carries the client name, and only the name', () => {
    const content = contentOf();
    expect(content.customerName).toBe('Ana López');
    const serialised = JSON.stringify(content);
    expect(serialised).not.toContain('600112233');
    expect(serialised).not.toContain('ana@example.com');
  });

  it('gives the day, its weekday and the hours in the salon zone (FR-025)', () => {
    const content = contentOf();
    expect(content.date.toString()).toBe('2026-11-13');
    expect(content.weekday).toBe(5);
    expect(content.startTime).toBe('11:30');
    expect(content.endTime).toBe('12:30');
  });

  it('keeps the wall time across a change of hour: the last Sunday of October', () => {
    // 2026-10-25 02:00 in Madrid goes back to 01:00. 09:30 local is 08:30Z.
    const content = contentOf({
      startsAt: Temporal.Instant.from('2026-10-25T08:30:00Z'),
      endsAt: Temporal.Instant.from('2026-10-25T09:00:00Z'),
    });
    expect(content.date.toString()).toBe('2026-10-25');
    expect(content.weekday).toBe(7);
    expect(content.startTime).toBe('09:30');
    expect(content.endTime).toBe('10:00');
  });

  it('lists every service with its price, or none, in order', () => {
    const content = contentOf({
      services: [
        { serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: 1800 },
        { serviceId: 's3', name: 'Barba', durationMinutes: 15, priceCents: null },
      ],
    });
    expect(content.services).toEqual([
      { name: 'Corte', priceCents: 1800 },
      { name: 'Barba', priceCents: null },
    ]);
  });

  it.each([
    [[1800, 800], { kind: 'ALL_PRICED', cents: 2600 }],
    [[null, null], { kind: 'NONE_PRICED' }],
    [[1800, null], { kind: 'PARTIALLY_PRICED', knownCents: 1800 }],
  ] as const)('totals %j as the screen does (005)', (prices, total) => {
    const content = contentOf({
      services: [
        { serviceId: 's1', name: 'Corte', durationMinutes: 30, priceCents: prices[0] },
        { serviceId: 's2', name: 'Lavado', durationMinutes: 30, priceCents: prices[1] },
      ],
    });
    expect(content.total).toEqual(total);
  });

  it('carries the cancellation deadline of the policy, in hours', () => {
    expect(contentOf({}, { ...DEFAULT_BOOKING_POLICY, cancellationDeadlineHours: 48 }).cancellationDeadlineHours).toBe(48);
  });

  it('has nothing to say about an anonymised appointment', () => {
    expect(confirmationContent(appointment({ customer: null }), SALON, DEFAULT_BOOKING_POLICY)).toEqual({
      ok: false,
      error: 'NO_CUSTOMER',
    });
  });
});
