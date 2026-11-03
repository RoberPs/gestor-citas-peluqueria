import { describe, expect, it } from 'vitest';
import { durationLabel, priceLabel, totalPriceLabel } from '@/app/_lib/format';

/**
 * How amounts read on screen. Money is an integer everywhere else; this is the
 * one place it becomes text, so this is where "no price" must never turn into
 * "0,00 €" (FR-019, SC-005).
 */

describe('priceLabel', () => {
  it('writes cents as euros with a decimal comma', () => {
    expect(priceLabel(1800)).toBe('18,00 €');
  });

  it('says the price is asked at the salon when there is none (FR-019)', () => {
    expect(priceLabel(null)).toBe('Precio a consultar en el salón');
  });
});

describe('durationLabel (D-009)', () => {
  it('keeps minutes under an hour as minutes', () => {
    expect(durationLabel(30)).toBe('30 min');
  });

  it('says a whole hour as an hour', () => {
    expect(durationLabel(60)).toBe('1 h');
  });

  it('writes hours and minutes, as a person would say them', () => {
    expect(durationLabel(75)).toBe('1 h 15 min');
    expect(durationLabel(195)).toBe('3 h 15 min');
  });
});

describe('totalPriceLabel (FR-020)', () => {
  it('writes the sum when every service has a price', () => {
    expect(totalPriceLabel({ kind: 'ALL_PRICED', cents: 1800 })).toBe('18,00 €');
  });

  it('asks at the salon when none has a price', () => {
    expect(totalPriceLabel({ kind: 'NONE_PRICED' })).toBe('Precio a consultar en el salón');
  });

  it('adds what is known and says the rest is asked at the salon', () => {
    expect(totalPriceLabel({ kind: 'PARTIALLY_PRICED', knownCents: 1800 })).toBe(
      '18,00 € + precio a consultar en el salón',
    );
  });
});
