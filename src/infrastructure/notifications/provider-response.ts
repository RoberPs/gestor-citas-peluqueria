/**
 * What the email adapters share about a provider's answer (004, D-006).
 */

export const PROVIDER_TIMEOUT_MS = 10_000;

/** D-006: `null` when accepted. */
export function classifyStatus(status: number): 'TRANSIENT' | 'PERMANENT' | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429 || status >= 500) return 'TRANSIENT';
  return 'PERMANENT';
}
