/**
 * The return type of every public domain function.
 *
 * Expected failures are values, not exceptions: `E` enumerates them in the type,
 * so a failure mode that is not in the type does not exist, and the compiler
 * forces the caller to deal with the ones that are (Principio I).
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
