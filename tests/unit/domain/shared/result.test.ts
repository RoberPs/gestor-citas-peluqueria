import { describe, expect, it } from 'vitest';
import { err, ok, type Result } from '@/domain/shared/result';

describe('Result', () => {
  it('ok() carries the value and reports success', () => {
    const result = ok(42);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toBe(42);
  });

  it('err() carries the typed failure and reports failure', () => {
    const result = err({ kind: 'SLOT_TAKEN' } as const);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'SLOT_TAKEN' });
  });

  it('ok(undefined) models a success that carries nothing', () => {
    const result: Result<void, 'NOPE'> = ok(undefined);

    expect(result.ok).toBe(true);
  });

  it('narrows to the value branch once ok is checked', () => {
    const results: readonly Result<number, string>[] = [ok(1), err('boom'), ok(3)];

    const values = results.filter((r) => r.ok).map((r) => r.value);
    const errors = results.filter((r) => !r.ok).map((r) => r.error);

    expect(values).toEqual([1, 3]);
    expect(errors).toEqual(['boom']);
  });
});
