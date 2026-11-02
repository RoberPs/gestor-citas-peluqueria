import { messages } from '@/messages/es-ES';

/**
 * The shape of every error this API returns.
 *
 * `nextAction` is required, not optional: SC-012 asks that 100 % of error
 * messages say what to do next, and a type that allows leaving it out is a type
 * that will eventually have it left out.
 */
export type ApiError = {
  readonly code: string;
  readonly message: string;
  readonly nextAction: string;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
} as const;

export function jsonOk<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function jsonError(status: number, error: ApiError): Response {
  return jsonOk(error, status);
}

export function jsonErrorWith<T extends object>(
  status: number,
  error: ApiError,
  extra: T,
): Response {
  return jsonOk({ ...error, ...extra }, status);
}

/**
 * The neutral answer (FR-019, FR-038, D-006).
 *
 * One function for all five cases, so they cannot drift apart: same status,
 * same body, same headers. No `429`, no `Retry-After`, no `X-RateLimit-*` —
 * any of those would tell whoever is probing links at random that the system
 * distinguishes between their attempts, which is exactly what FR-038 forbids.
 */
export function neutralNotFound(): Response {
  return jsonError(404, {
    code: 'APPOINTMENT_NOT_FOUND',
    ...messages.errors.appointmentNotFound,
  });
}
