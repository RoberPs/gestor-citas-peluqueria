import { container } from '@/app/_lib/container';
import { messages } from '@/messages/es-ES';
import { jsonError, jsonOk } from '../../_lib/responses';
import {
  createPeriodSchema,
  invalidPeriod,
  malformedPeriod,
  periodWindowSchema,
} from '../_lib/period-params';
import { requireOwnerSession } from '../_lib/require-owner-session';
import { conflictDto, periodDto } from '../_lib/serializers';

export const dynamic = 'force-dynamic';

/** The periods that touch a window (002, Historia 3). */
export async function GET(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const query = periodWindowSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return jsonError(400, malformedPeriod);

  const result = await container().unavailablePeriods.list({ from: query.data.desde, to: query.data.hasta });
  if (!result.ok) return jsonError(400, malformedPeriod);

  const { periods, timezone } = result.value;
  return jsonOk({ periods: periods.map((period) => periodDto(period, timezone)) });
}

/**
 * Blocking time (FR-018). Over confirmed appointments it answers 409 naming
 * them, and saves only once they are all acknowledged with the same
 * `stateToken` (FR-022, D-024).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const body = createPeriodSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(422, malformedPeriod);

  const result = await container().unavailablePeriods.create({
    startsAt: body.data.startsAt,
    endsAt: body.data.endsAt,
    reason: body.data.reason,
    stateToken: body.data.stateToken,
    acknowledgeAppointments: body.data.resolution?.acknowledgeAppointments,
  });

  if (result.ok) return jsonOk(periodDto(result.value.period, result.value.timezone), 201);
  if (result.error.kind === 'INVALID') return jsonError(422, invalidPeriod(result.error));

  const { conflicts, stateToken, timezone } = result.error;
  return jsonOk(
    {
      code: 'CONFLICT',
      ...messages.owner.errors.periodConflict,
      conflicts: conflicts.map((conflict) => conflictDto(conflict, timezone)),
      stateToken,
    },
    409,
  );
}
