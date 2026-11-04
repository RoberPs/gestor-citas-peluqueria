'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { container } from '@/app/_lib/container';
import { resolveClientIp } from '@/infrastructure/config/env';
import { rateLimiter } from '@/infrastructure/security/rate-limiter';
import { messages, withPhone } from '@/messages/es-ES';
import type { BookingFormState } from './form-state';

/**
 * Confirming from the screen.
 *
 * It goes through the same use case as `POST /api/appointments`, so there is
 * one decision about a booking and not two. What the form adds is the part an
 * API cannot do: keeping the valid fields on screen while the client fixes the
 * wrong one (FR-009 edge case), without ever putting a name, a phone or an
 * email in a URL where the access log would keep it (FR-036).
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

export async function submitBooking(
  _previous: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const contact = {
    name: text(formData, 'name'),
    phone: text(formData, 'phone'),
    email: text(formData, 'email'),
  };
  // 004, FR-001: a ticked checkbox posts its value; an unticked one, nothing.
  const emailConsent = formData.get('emailConsent') !== null;
  const values = { ...contact, emailConsent };

  const { salon } = await container().config.load();

  const clientIp = resolveClientIp({
    forwardedFor: (await headers()).get('x-forwarded-for'),
    remoteAddress: null,
  });
  const { allowed } = await rateLimiter().check('BOOKING_CONFIRMATION', clientIp);
  if (!allowed) {
    return {
      fieldErrors: {},
      summaryError: {
        message: messages.errors.tooManyBookings.message,
        nextAction: withPhone(messages.errors.tooManyBookings.nextAction, salon.phone),
      },
      values,
    };
  }

  const serviceIds = text(formData, 'serviceIds');
  const result = await container().confirmBooking({
    serviceIds: serviceIds === '' ? [] : serviceIds.split(','),
    startsAt: text(formData, 'startsAt'),
    contact,
    emailConsent,
  });

  if (result.ok) {
    // 004, D-003: the first attempt of the email runs once the answer has
    // gone, so the client never waits for the provider (FR-010).
    const { notificationId } = result.value;
    if (notificationId !== null) after(() => container().sendConfirmation(notificationId));

    // POST-Redirect-GET (D-010): what follows is a GET, so reloading the
    // confirmation cannot create a second appointment.
    redirect(`/cita/${result.value.token}?nueva=1`);
  }

  const failure = result.error;

  if (failure.kind === 'CONTACT_LIMIT_REACHED') {
    return {
      fieldErrors: {},
      summaryError: {
        message: messages.errors.contactLimitReached.message,
        nextAction: withPhone(messages.errors.contactLimitReached.nextAction, salon.phone),
      },
      values,
    };
  }

  if (failure.kind === 'SERVICE_UNAVAILABLE') {
    // A service went out of the catalogue while the form was being filled in
    // (FR-015). Like a lost hour, the screen is drawn again so the client
    // decides on what is really on offer, with what they typed kept.
    revalidatePath('/reservar');
    return { fieldErrors: {}, summaryError: messages.errors.serviceUnavailable, values };
  }

  if (failure.kind !== 'REJECTED') {
    return { fieldErrors: {}, summaryError: messages.booking.missingSlot, values };
  }

  if (failure.rejection.kind === 'INVALID_CONTACT') {
    const fieldErrors: Partial<Record<'name' | 'phone' | 'email', string>> = {};
    for (const field of failure.rejection.fields) {
      const key = field.field.replace('customer.', '') as 'name' | 'phone' | 'email';
      fieldErrors[key] = messages.errors.contactField[field.code];
    }

    return { fieldErrors, summaryError: messages.errors.invalidContact, values };
  }

  const summaryError =
    failure.rejection.kind === 'SLOT_TAKEN'
      ? messages.errors.slotTaken
      : failure.rejection.kind === 'TOO_LATE_TO_BOOK'
        ? messages.errors.tooLateToBook
        : messages.errors.outsideOpeningHours;

  // The hour is no longer bookable, and on desktop the hours and days are on
  // screen beside the form: they are recomputed in this same response, so the
  // hour that was just lost is never offered again (003, Principio VI). What
  // was typed is client state and survives the refresh.
  revalidatePath('/reservar');

  return { fieldErrors: {}, summaryError, values };
}
