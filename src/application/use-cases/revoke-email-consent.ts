import { revokeConsent, type ChannelConsent } from '@/domain/notifications/consent';
import type { Clock } from '@/domain/shared/clock';
import { err, ok, type Result } from '@/domain/shared/result';
import type { AppointmentRepository, ConsentRepository, SalonConfigRepository, TokenGenerator } from '../ports';

/**
 * Unsubscribing from the confirmation emails of one appointment (004,
 * Historia 2): from the email, with its own token, or from the appointment
 * screen, with the management link (FR-016, FR-017).
 *
 * It ends the consent and nothing else. The appointment, its other channels
 * and other appointments with the same address are untouched. Doing it twice
 * is harmless: the first end stands.
 *
 * Every way a token can fail — unknown, malformed, of an anonymised
 * appointment — is one `NOT_FOUND`, so the caller answers them all alike
 * (FR-018).
 */

export type RevocationOutcome = 'UNSUBSCRIBED' | 'ALREADY_ENDED' | 'NO_CONSENT';

export function createRevokeEmailConsent(deps: {
  readonly config: SalonConfigRepository;
  readonly appointments: AppointmentRepository;
  readonly consents: ConsentRepository;
  readonly tokens: TokenGenerator;
  readonly clock: Clock;
}) {
  async function end(consent: ChannelConsent | null): Promise<RevocationOutcome> {
    if (consent === null) return 'NO_CONSENT';
    const now = deps.clock.now();
    const revoked = revokeConsent(consent, 'UNSUBSCRIBED', now);
    if (!revoked.ok) return 'ALREADY_ENDED';

    await deps.consents.end(consent.appointmentId, consent.channel, 'UNSUBSCRIBED', now);
    return 'UNSUBSCRIBED';
  }

  /** The hash is computed for any string, so every token takes the same path (D-006 of 001). */
  function byUnsubscribeHash(token: string): Promise<ChannelConsent | null> {
    return deps.consents.findByUnsubscribeTokenHash(deps.tokens.hash(token));
  }

  return {
    /**
     * The unsubscribe page before its button: the salon it names and whether
     * it is already done (FR-015). Opening the page ends nothing.
     */
    async inspect(
      token: string,
    ): Promise<Result<{ readonly salonName: string; readonly alreadyEnded: boolean }, 'NOT_FOUND'>> {
      const consent = await byUnsubscribeHash(token);
      if (consent === null) return err('NOT_FOUND');
      const { salon } = await deps.config.load();
      return ok({ salonName: salon.name, alreadyEnded: consent.ended !== null });
    },

    /** From the email: the page's button and the mail client's one click. */
    async byUnsubscribeToken(token: string): Promise<Result<RevocationOutcome, 'NOT_FOUND'>> {
      const consent = await byUnsubscribeHash(token);
      if (consent === null) return err('NOT_FOUND');
      return ok(await end(consent));
    },

    /** From the appointment screen (FR-017). An appointment without a consent has nothing to end. */
    async byManagementToken(token: string): Promise<Result<RevocationOutcome, 'NOT_FOUND'>> {
      const appointment = await deps.appointments.findByTokenHash(deps.tokens.hash(token));
      if (appointment === null) return err('NOT_FOUND');
      return ok(await end(await deps.consents.findForAppointment(appointment.id, 'EMAIL')));
    },
  };
}
