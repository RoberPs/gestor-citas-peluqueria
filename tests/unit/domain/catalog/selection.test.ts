import { describe, expect, it } from 'vitest';
import type { OpeningInterval, Weekday, WeeklySchedule } from '@/domain/catalog/salon';
import type { Service, ServiceSnapshot } from '@/domain/catalog/service';
import { fitsOpeningHours, selectServices, totalPriceOf } from '@/domain/catalog/selection';
import { interval } from '../availability/_fixtures';

/**
 * Which services go into an appointment, in what order and for how long
 * (D-003). A business rule, so it lives in the domain and nowhere else: the
 * screen only shows what this returns.
 */

const CORTE: Service = {
  id: '00000000-0000-4000-8000-000000000011',
  name: 'Corte',
  durationMinutes: 30,
  priceCents: 1800,
  isActive: true,
  displayOrder: 1,
};

const PEINADO: Service = {
  id: '00000000-0000-4000-8000-000000000013',
  name: 'Peinado',
  durationMinutes: 45,
  priceCents: 2500,
  isActive: true,
  displayOrder: 3,
};

const LAVADO: Service = {
  id: '00000000-0000-4000-8000-000000000014',
  name: 'Lavado',
  durationMinutes: 30,
  priceCents: null,
  isActive: true,
  displayOrder: 4,
};

const RETIRED: Service = {
  id: '00000000-0000-4000-8000-000000000019',
  name: 'Retirado',
  durationMinutes: 60,
  priceCents: 3000,
  isActive: false,
  displayOrder: 9,
};

const CATALOGUE = [CORTE, PEINADO, LAVADO, RETIRED];

describe('selectServices', () => {
  it('turns one id into a selection of one', () => {
    const result = selectServices(CATALOGUE, [CORTE.id]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.services.map((service) => service.serviceId)).toEqual([CORTE.id]);
    expect(result.value.durationMinutes).toBe(30);
  });

  it('puts the services in catalogue order, whatever order they came in (FR-006)', () => {
    const result = selectServices(CATALOGUE, [PEINADO.id, CORTE.id]);

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.services.map((service) => service.name)).toEqual(['Corte', 'Peinado']);
  });

  it('lasts the sum of its services (FR-007)', () => {
    const result = selectServices(CATALOGUE, [CORTE.id, PEINADO.id, LAVADO.id]);

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.durationMinutes).toBe(30 + 45 + 30);
  });

  it('refuses an empty selection (FR-004)', () => {
    expect(selectServices(CATALOGUE, [])).toEqual({ ok: false, error: { kind: 'EMPTY' } });
  });

  it('refuses the same service twice (FR-003)', () => {
    expect(selectServices(CATALOGUE, [CORTE.id, CORTE.id])).toEqual({
      ok: false,
      error: { kind: 'DUPLICATE' },
    });
  });

  it('refuses a service that does not exist, naming it (FR-015)', () => {
    const missing = '00000000-0000-4000-8000-0000000000ff';

    expect(selectServices(CATALOGUE, [CORTE.id, missing])).toEqual({
      ok: false,
      error: { kind: 'UNKNOWN_SERVICE', serviceIds: [missing] },
    });
  });

  it('refuses a service that is no longer offered, naming it', () => {
    expect(selectServices(CATALOGUE, [RETIRED.id, CORTE.id])).toEqual({
      ok: false,
      error: { kind: 'UNKNOWN_SERVICE', serviceIds: [RETIRED.id] },
    });
  });

  it('freezes name, duration and price into each snapshot, no price included', () => {
    const result = selectServices(CATALOGUE, [LAVADO.id, CORTE.id]);

    if (!result.ok) throw new Error('unreachable');
    expect(result.value.services).toEqual([
      { serviceId: CORTE.id, name: 'Corte', durationMinutes: 30, priceCents: 1800 },
      { serviceId: LAVADO.id, name: 'Lavado', durationMinutes: 30, priceCents: null },
    ]);
  });
});

function schedule(...stretches: OpeningInterval[]): WeeklySchedule {
  const byDay = new Map<Weekday, OpeningInterval[]>();
  for (const stretch of stretches) {
    byDay.set(stretch.weekday, [...(byDay.get(stretch.weekday) ?? []), stretch]);
  }
  return byDay;
}

describe('fitsOpeningHours (FR-010, D-007)', () => {
  const SATURDAY_SPLIT = schedule(interval(6, '10:00', '14:00'), interval(6, '16:00', '20:00'));

  it('fits when some stretch of the week is as long as the selection', () => {
    expect(fitsOpeningHours(240, SATURDAY_SPLIT)).toBe(true);
  });

  it('fits when one stretch is longer, even if others are shorter', () => {
    expect(
      fitsOpeningHours(300, schedule(interval(1, '10:00', '12:00'), interval(2, '10:00', '20:00'))),
    ).toBe(true);
  });

  it('does not fit when every stretch is shorter: no day will ever have room', () => {
    expect(fitsOpeningHours(270, SATURDAY_SPLIT)).toBe(false);
  });

  it('does not fit a salon with no opening hours at all', () => {
    expect(fitsOpeningHours(30, schedule())).toBe(false);
  });
});

describe('totalPriceOf (FR-020)', () => {
  const priced = (cents: number): ServiceSnapshot => ({
    serviceId: `s${cents}`,
    name: 'Con precio',
    durationMinutes: 30,
    priceCents: cents,
  });
  const unpriced: ServiceSnapshot = {
    serviceId: 'sin',
    name: 'Sin precio',
    durationMinutes: 30,
    priceCents: null,
  };

  it('adds the prices when every service has one', () => {
    expect(totalPriceOf([priced(1800), priced(2500)])).toEqual({ kind: 'ALL_PRICED', cents: 4300 });
  });

  it('has no price when none of them has one', () => {
    expect(totalPriceOf([unpriced])).toEqual({ kind: 'NONE_PRICED' });
  });

  it('adds what is known and says the rest is unknown when they mix', () => {
    expect(totalPriceOf([priced(1800), unpriced])).toEqual({
      kind: 'PARTIALLY_PRICED',
      knownCents: 1800,
    });
  });

  it('gives a single service without price no price, not a partial one', () => {
    expect(totalPriceOf([unpriced]).kind).toBe('NONE_PRICED');
  });
});
