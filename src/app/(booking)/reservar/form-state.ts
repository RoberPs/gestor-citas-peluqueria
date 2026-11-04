/**
 * The state the booking form carries between attempts.
 *
 * It lives here and not beside the action because a `'use server'` module may
 * only export async functions: a plain constant exported from one arrives as
 * `undefined` on the client, and the form then renders against nothing.
 */
export type BookingFormState = {
  readonly fieldErrors: Readonly<Partial<Record<'name' | 'phone' | 'email', string>>>;
  readonly summaryError: { readonly message: string; readonly nextAction: string } | null;
  /** What the client typed, so nothing they got right is lost — the checkbox too (004). */
  readonly values: {
    readonly name: string;
    readonly phone: string;
    readonly email: string;
    readonly emailConsent: boolean;
  };
};

export const emptyBookingFormState: BookingFormState = {
  fieldErrors: {},
  summaryError: null,
  values: { name: '', phone: '', email: '', emailConsent: false },
};
