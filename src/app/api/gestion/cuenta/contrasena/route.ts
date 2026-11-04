import { z } from 'zod';
import { container } from '@/app/_lib/container';
import { MIN_PASSWORD_LENGTH } from '@/domain/owner/account';
import { messages, withMin } from '@/messages/es-ES';
import { jsonError } from '../../../_lib/responses';
import { requireOwnerSession } from '../../_lib/require-owner-session';

export const dynamic = 'force-dynamic';

/**
 * The shape only. Twelve characters is the domain's rule (D-016), checked by
 * the use case so the answer can say so; Zod does not restate it.
 */
const bodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(1).max(200),
  })
  .strict();

/** Changing the password from inside the session (FR-004). */
export async function PUT(request: Request): Promise<Response> {
  const session = await requireOwnerSession(request);
  if (!session.ok) return session.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, { code: 'BAD_REQUEST', ...messages.owner.errors.badRequest });
  }

  const result = await container().changeOwnerPassword(session.value, {
    current: parsed.data.currentPassword,
    next: parsed.data.newPassword,
  });

  if (result.ok) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

  if (result.error === 'TOO_SHORT') {
    const { message, nextAction } = messages.owner.errors.passwordTooShort;
    return jsonError(422, {
      code: 'PASSWORD_TOO_SHORT',
      message,
      nextAction: withMin(nextAction, MIN_PASSWORD_LENGTH),
    });
  }

  return jsonError(422, { code: 'WRONG_CURRENT_PASSWORD', ...messages.owner.errors.wrongCurrentPassword });
}
