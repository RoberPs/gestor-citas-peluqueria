import { describe, expect, it } from 'vitest';
import { priceLabel } from '@/app/_lib/format';

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
