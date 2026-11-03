'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
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
  const values = {
    name: text(formData, 'name'),
    phone: text(formData, 'phone'),
    email: text(formData, 'email'),
  };

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
    contact: values,
  });

  if (result.ok) {
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
