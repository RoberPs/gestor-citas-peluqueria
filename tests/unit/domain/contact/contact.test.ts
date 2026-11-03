import { describe, expect, it } from 'vitest';
import {
  normalizeEmail,
  normalizePhone,
  searchableName,
  validateContact,
  validateName,
} from '@/domain/contact/contact';

/** Unwraps a success, failing loudly instead of silently returning undefined. */
function value<T, E>(result: { ok: true; value: T } | { ok: false; error: E }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('normalizePhone', () => {
  it('accepts a Spanish mobile and normalizes it to E.164', () => {
    expect(value(normalizePhone('600112233'))).toBe('+34600112233');
  });

  it.each([
    ['600112233', '+34600112233'],
    ['700112233', '+34700112233'],
    ['812345678', '+34812345678'],
    ['912345678', '+34912345678'],
  ])('accepts %s, a number starting with 6, 7, 8 or 9', (raw, expected) => {
    expect(value(normalizePhone(raw))).toBe(expected);
  });

  it.each([
    ['+34600112233'],
    ['0034600112233'],
    ['+34 600 11 22 33'],
    ['0034-600-11-22-33'],
  ])('accepts the optional +34 / 0034 prefix in %s', (raw) => {
    expect(value(normalizePhone(raw))).toBe('+34600112233');
  });

  it.each([
    ['600 11 22 33'],
    ['600-11-22-33'],
    ['600.11.22.33'],
    ['  600 112 233  '],
    ['600 11-22.33'],
  ])('tolerates spaces, dashes and dots in %s and strips them', (raw) => {
    expect(value(normalizePhone(raw))).toBe('+34600112233');
  });

  it.each([
    ['500112233', 'starts with a digit Spain does not assign'],
    ['60011223', 'eight digits'],
    ['6001122334', 'ten digits'],
    ['', 'empty'],
    ['   ', 'only whitespace'],
    ['+33600112233', 'a foreign prefix'],
    ['600 11 22 3a', 'a letter among the digits'],
  ])('rejects %s (%s)', (raw) => {
    const result = normalizePhone(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('INVALID_PHONE');
  });
});

describe('normalizeEmail', () => {
  it('lowercases the address', () => {
    expect(value(normalizeEmail('Ana.Lopez@Example.COM'))).toBe('ana.lopez@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(value(normalizeEmail('  ana@example.com  '))).toBe('ana@example.com');
  });

  it('accepts a plus-addressed mailbox', () => {
    expect(value(normalizeEmail('ana+citas@example.com'))).toBe('ana+citas@example.com');
  });

  it.each([
    ['ana@'],
    ['@example.com'],
    ['ana example.com'],
    ['ana@example'],
    ['ana@@example.com'],
    [''],
    ['ana@exam ple.com'],
  ])('rejects %s', (raw) => {
    const result = normalizeEmail(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('INVALID_EMAIL');
  });
});

describe('validateName', () => {
  it('accepts a one character name', () => {
    expect(value(validateName('A'))).toBe('A');
  });

  it('accepts a name of exactly 100 characters', () => {
    const name = 'a'.repeat(100);

    expect(value(validateName(name))).toBe(name);
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(value(validateName('  Ana López  '))).toBe('Ana López');
  });

  it.each([[''], ['   '], ['a'.repeat(101)]])('rejects %s', (raw) => {
    const result = validateName(raw);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe('INVALID_NAME');
  });
});

describe('validateContact — who needs an email (002, FR-024, D-026)', () => {
  const contact = { name: 'Ana López', phone: '600 11 22 33' };

  it('requires it for an online booking, exactly as in 001 (FR-008)', () => {
    const result = validateContact({ ...contact, email: '' }, { email: 'REQUIRED' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual([{ field: 'customer.email', code: 'INVALID_EMAIL' }]);
  });

  it.each([[''], ['   '], [null]])(
    'treats %j as no email when it is optional: a valid contact without one',
    (email) => {
      const result = value(validateContact({ ...contact, email }, { email: 'OPTIONAL' }));

      expect(result.email).toBeNull();
      expect(result.normalizedEmail).toBeNull();
      expect(result.normalizedPhone).toBe('+34600112233');
    },
  );

  it('still checks the format of an optional email that is there (FR-031)', () => {
    const result = validateContact({ ...contact, email: 'ana@' }, { email: 'OPTIONAL' });

    expect(result.ok).toBe(false);
  });

  it('keeps name and phone compulsory whatever the email rule (BR-011)', () => {
    const result = validateContact({ name: ' ', phone: '123', email: null }, { email: 'OPTIONAL' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.map((error) => error.field)).toEqual(['customer.name', 'customer.phone']);
  });
});

describe('searchableName — how a name is compared (002, FR-069, D-036)', () => {
  it.each([
    ['José  NÚÑEZ', 'jose nunez'],
    ['  María Jesús ', 'maria jesus'],
    ['Begoña Güell', 'begona guell'],
    ['Çelik', 'celik'],
    ['ana lópez', 'ana lopez'],
  ])('turns %j into %j', (raw, expected) => {
    expect(searchableName(raw)).toBe(expected);
  });

  it('is what validateContact keeps alongside the name as typed', () => {
    const result = value(
      validateContact(
        { name: 'José Núñez', phone: '600112233', email: 'jose@example.com' },
        { email: 'REQUIRED' },
      ),
    );

    expect(result.name).toBe('José Núñez');
    expect(result.searchName).toBe('jose nunez');
  });
});
