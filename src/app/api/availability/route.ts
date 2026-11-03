import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { messages } from '@/messages/es-ES';
import { jsonError, jsonOk } from '../_lib/responses';
import { availabilityResponse } from '../_lib/serializers';

export const dynamic = 'force-dynamic';

/**
 * Zod checks the **shape** of the query; the domain decides everything else
 * (D-009). "Is this date inside the horizon" is a business rule, so it is
 * answered once, in the use case, and not restated here.
 */
const querySchema = z.object({
  // `?serviceIds=a,b`. Empty is a shape the domain answers (EMPTY), not a
  // malformed request; the repeated ones are dropped here, as the contract says.
  serviceIds: z
    .string()
    .transform((value) => (value === '' ? [] : [...new Set(value.split(','))]))
    .pipe(z.array(z.string().uuid())),
  rangeStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  selectedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    serviceIds: url.searchParams.get('serviceIds') ?? undefined,
    rangeStart: url.searchParams.get('rangeStart') ?? undefined,
    selectedDate: url.searchParams.get('selectedDate') ?? undefined,
  });

  if (!parsed.success) {
    // A malformed service id and an unknown one are the same thing to a client:
    // the service they asked for is not on offer.
    const problem = parsed.error.issues[0]?.path[0] === 'serviceIds' ? 'unknownService' : 'rangeOutOfBounds';
    return jsonError(400, { code: 'INVALID_REQUEST', ...messages.errors[problem] });
  }

  const result = await container().getAvailability(parsed.data);

  if (!result.ok) {
    switch (result.error.kind) {
      case 'EMPTY_SELECTION':
        return jsonError(400, { code: 'EMPTY_SELECTION', ...messages.errors.emptySelection });
      case 'UNKNOWN_SERVICE':
      case 'DUPLICATE_SERVICE':
        return jsonError(400, { code: 'UNKNOWN_SERVICE', ...messages.errors.unknownService });
      case 'RANGE_OUT_OF_BOUNDS':
        return jsonError(400, { code: 'RANGE_OUT_OF_BOUNDS', ...messages.errors.rangeOutOfBounds });
    }
  }

  return jsonOk(availabilityResponse(result.value));
}
