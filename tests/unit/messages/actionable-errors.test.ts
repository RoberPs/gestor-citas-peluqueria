import { describe, expect, it } from 'vitest';
import { messages, withPhone } from '@/messages/es-ES';

/**
 * SC-012: **100 %** of error messages say what to do next.
 *
 * A one-off read of the catalogue would satisfy that today and rot by the
 * second copy-edit, so the rule is checked mechanically instead. Anything
 * shaped like an error — anything with a `message` — must come with a
 * `nextAction`, and the shape is what the test looks for rather than a list of
 * keys somebody has to remember to extend.
 */

type Entry = { path: string; value: Record<string, unknown> };

/** Every object in the catalogue that carries a `message`. */
function errorLikeEntries(node: unknown, path = 'messages'): Entry[] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return [];

  const record = node as Record<string, unknown>;
  const nested = Object.entries(record).flatMap(([key, value]) =>
    errorLikeEntries(value, `${path}.${key}`),
  );

  return typeof record['message'] === 'string' ? [{ path, value: record }, ...nested] : nested;
}

const entries = errorLikeEntries(messages);

describe('every error message says what to do next (SC-012)', () => {
  it('finds the error messages at all, so an empty pass cannot look like a green one', () => {
    expect(entries.length).toBeGreaterThanOrEqual(8);
  });

  it.each(entries.map((entry) => [entry.path, entry] as const))(
    '%s carries a nextAction',
    (_path, entry) => {
      expect(typeof entry.value['nextAction']).toBe('string');
      expect(String(entry.value['nextAction']).trim().length).toBeGreaterThan(0);
    },
  );

  it.each(entries.map((entry) => [entry.path, entry] as const))(
    '%s tells the client to do something rather than restating the problem',
    (_path, entry) => {
      const nextAction = String(entry.value['nextAction']);

      // An instruction in Spanish starts from a verb the client can act on.
      expect(nextAction).toMatch(
        /\b(vuelve|elige|corrige|cancela|llama|puedes|revisa|prueba|escribe|ve)\b/i,
      );
    },
  );

  it.each(entries.map((entry) => [entry.path, entry] as const))(
    '%s ends its message as a sentence',
    (_path, entry) => {
      expect(String(entry.value['message']).trim()).toMatch(/[.!?]$/);
      expect(String(entry.value['nextAction']).trim()).toMatch(/[.!?]$/);
    },
  );
});

describe('the reasons an action is unavailable (FR-028)', () => {
  const reasons = Object.entries(messages.appointment.unavailable);

  it.each(reasons)('%s offers the salon phone as the way out', (_kind, template) => {
    const filled = withPhone(template, '911 23 45 67');

    expect(filled).toContain('911 23 45 67');
    expect(filled).not.toContain('{phone}');
  });

  it.each(reasons)('%s explains rather than merely refusing', (_kind, template) => {
    expect(template.length).toBeGreaterThan(40);
    expect(template).toMatch(/porque|así que|y no|ya (está|ha)|faltan/i);
  });
});

describe('the placeholder is always filled in', () => {
  it('leaves no {phone} behind in any message that carries one', () => {
    const withPlaceholder = JSON.stringify(messages).match(/\{phone\}/g) ?? [];

    // The placeholder exists on purpose; what must never happen is a message
    // reaching a client with it still in place, so every template that has one
    // is filled through `withPhone`.
    expect(withPlaceholder.length).toBeGreaterThan(0);
    expect(withPhone(JSON.stringify(messages), '911 23 45 67')).not.toContain('{phone}');
  });
});
