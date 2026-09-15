import { err, ok, type Result } from '../shared/result';

/**
 * The only implementation of the contact format rules (FR-009).
 *
 * Zod calls into here from the HTTP boundary through `refine` (D-009), and the
 * form reuses it for immediate feedback without ever being authoritative
 * (FR-034). "A valid Spanish phone number" is a business rule, not a transport
 * check, so it lives in the domain and nowhere else (Principio I).
 */

declare const phoneBrand: unique symbol;
declare const emailBrand: unique symbol;
declare const nameBrand: unique symbol;

/** E.164, e.g. `+34600112233`. The canonical form the BR-014 count works on. */
export type NormalizedPhone = string & { readonly [phoneBrand]: true };
/** Lowercase and trimmed. */
export type NormalizedEmail = string & { readonly [emailBrand]: true };
export type CustomerName = string & { readonly [nameBrand]: true };

export type ContactField = 'customer.name' | 'customer.phone' | 'customer.email';

export type ContactFieldError = {
  readonly field: ContactField;
  readonly code: 'INVALID_NAME' | 'INVALID_PHONE' | 'INVALID_EMAIL';
};

/** What arrives from the client, before any of it is trusted. */
export type RawContact = {
  readonly name: string;
  readonly phone: string;
  readonly email: string;
};

/** What the domain hands back once every field has been checked. */
export type ValidatedContact = {
  readonly name: CustomerName;
  readonly phone: string;
  readonly normalizedPhone: NormalizedPhone;
  readonly email: string;
  readonly normalizedEmail: NormalizedEmail;
};

export const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

/** Spanish mobile or landline: nine digits starting with 6, 7, 8 or 9 (asunción 8). */
const PHONE_PATTERN = /^(?:\+34|0034)?([6-9]\d{8})$/;
const PHONE_SEPARATORS = /[\s.-]/g;

/**
 * Syntactic check only. v1 sends nothing, so an address is never verified as
 * reachable — claiming otherwise would be a promise the product does not keep.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function normalizePhone(raw: string): Result<NormalizedPhone, 'INVALID_PHONE'> {
  const match = PHONE_PATTERN.exec(raw.replace(PHONE_SEPARATORS, ''));
  const digits = match?.[1];

  return digits === undefined ? err('INVALID_PHONE') : ok(`+34${digits}` as NormalizedPhone);
}

export function normalizeEmail(raw: string): Result<NormalizedEmail, 'INVALID_EMAIL'> {
  const trimmed = raw.trim().toLowerCase();

  if (trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(trimmed)) {
    return err('INVALID_EMAIL');
  }

  return ok(trimmed as NormalizedEmail);
}

export function validateName(raw: string): Result<CustomerName, 'INVALID_NAME'> {
  const trimmed = raw.trim();

  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
    return err('INVALID_NAME');
  }

  return ok(trimmed as CustomerName);
}

/**
 * Validates the three fields together, reporting **every** offending field at
 * once so the client corrects the form in one pass instead of one field per
 * round trip.
 */
export function validateContact(
  raw: RawContact,
): Result<ValidatedContact, readonly ContactFieldError[]> {
  const name = validateName(raw.name);
  const phone = normalizePhone(raw.phone);
  const email = normalizeEmail(raw.email);

  const errors: ContactFieldError[] = [];
  if (!name.ok) errors.push({ field: 'customer.name', code: name.error });
  if (!phone.ok) errors.push({ field: 'customer.phone', code: phone.error });
  if (!email.ok) errors.push({ field: 'customer.email', code: email.error });

  if (!name.ok || !phone.ok || !email.ok) return err(errors);

  return ok({
    name: name.value,
    phone: raw.phone.trim(),
    normalizedPhone: phone.value,
    email: raw.email.trim(),
    normalizedEmail: email.value,
  });
}
