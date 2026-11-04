import type { Temporal } from '@js-temporal/polyfill';
import type {
  Appointment,
  AppointmentId,
  BusyInterval,
  CancellationActor,
} from '@/domain/booking/appointment';
import type {
  SalonConfiguration,
  UnavailablePeriod,
  UnavailablePeriodId,
} from '@/domain/catalog/salon';
import type { NonEmptyServiceList } from '@/domain/catalog/selection';
import type { Service } from '@/domain/catalog/service';
import type { NormalizedEmail, NormalizedPhone, ValidatedContact } from '@/domain/contact/contact';
import type {
  Channel,
  ChannelConsent,
  ConsentEndReason,
  NotificationId,
  PendingNotification,
  SkipReason,
} from '@/domain/notifications/consent';
import type { ConfirmationContent } from '@/domain/notifications/confirmation-content';
import type { ConfirmationDelivery } from '@/domain/notifications/owner-marker';
import type { LockoutState } from '@/domain/owner/account';
import type { ResolutionPlan } from '@/domain/owner/conflict';
import type { BookingListCursor, BookingListQuery } from '@/domain/owner/booking-list';
import type { Result } from '@/domain/shared/result';

/**
 * The ports the domain does not know about.
 *
 * The domain is handed data that has already been loaded; it never goes looking
 * for any. That is what lets it stay pure and testable without infrastructure.
 */

/**
 * An appointment as the owner reads it (004, D-011): with what became of its
 * confirmation by email, read in the same query.
 */
export type AppointmentWithDelivery = Appointment & { readonly confirmationDelivery: ConfirmationDelivery };

export type NewAppointment = {
  readonly id: AppointmentId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  /** In catalogue order: the order is kept as each row's position. */
  readonly services: NonEmptyServiceList;
  readonly contact: ValidatedContact;
  readonly tokenHash: Uint8Array;
  readonly createdAt: Temporal.Instant;
  /**
   * 004, D-001: the client asked for the confirmation by email. The consent
   * and the pending notification are written in the same transaction as the
   * appointment, or not at all.
   */
  readonly emailConfirmation?: {
    readonly unsubscribeTokenHash: Uint8Array;
    readonly notificationId: NotificationId;
    /** The two tokens, sealed (D-002). Never the clear ones. */
    readonly sealedTokens: Uint8Array;
  };
};

export interface AppointmentRepository {
  findByTokenHash(hash: Uint8Array): Promise<Appointment | null>;

  /** The owner's way in (002): by id, with all its services. */
  findById(id: AppointmentId): Promise<Appointment | null>;

  /** D-003: ONE query for the whole horizon. Sustains SC-005 and FR-005b. */
  findConfirmedInWindow(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<readonly BusyInterval[]>;

  /**
   * BR-014 / FR-013: counts that phone's confirmed future appointments and that
   * email's **separately**. It returns the two counts, not their union: the rule
   * is `byPhone >= 3 || byEmail >= 3`, not `count(phone OR email) >= 3`.
   * A `WHERE phone = $1 OR email = $2` would implement a stricter rule than the
   * specified one, rejecting someone who has reached neither limit.
   */
  countFutureByContact(
    phone: NormalizedPhone,
    /** `null` counts nothing: an appointment without email takes no email quota. */
    email: NormalizedEmail | null,
    now: Temporal.Instant,
    /** When editing: the appointment does not count against its own new contact (FR-075). */
    excluding?: AppointmentId,
  ): Promise<{ readonly byPhone: number; readonly byEmail: number }>;

  /**
   * The appointments that touch `[from, to)`, each with all its services, in
   * ONE query (002, FR-014, D-027): the owner's agenda reads a day through
   * here. Cancelled ones only when asked for (FR-015).
   */
  findInWindow(
    from: Temporal.Instant,
    to: Temporal.Instant,
    options: { readonly includeCancelled: boolean },
  ): Promise<readonly AppointmentWithDelivery[]>;

  /**
   * Inserts the appointment and its services in one transaction (005, D-011),
   * with its email consent and pending confirmation when it carries them (004).
   * Translates the 23P01 violation of the EXCLUDE constraint into
   * `SLOT_TAKEN`, which is how FR-012 becomes observable without leaking
   * database detail upwards.
   */
  insert(appointment: NewAppointment): Promise<Result<Appointment, 'SLOT_TAKEN'>>;

  /** FR-025, BR-006: atomic. On failure the original appointment is untouched. */
  updateSchedule(
    id: AppointmentId,
    start: Temporal.Instant,
    end: Temporal.Instant,
  ): Promise<Result<Appointment, 'SLOT_TAKEN'>>;

  /** Writes who cancelled in the same UPDATE as the status (002, FR-040a). */
  cancel(
    id: AppointmentId,
    at: Temporal.Instant,
    by: CancellationActor,
  ): Promise<Result<Appointment, 'ALREADY_CANCELLED'>>;
}

export interface SalonConfigRepository {
  /**
   * The configuration as it is **now**: read on every call, never cached, so
   * that what the owner saves rules at once (002, FR-056, D-021). Read-only:
   * writing it is a separate port no client use case depends on.
   */
  load(): Promise<SalonConfiguration>;

  /**
   * Every service, retired ones included, in display order (002, D-035): an
   * edited appointment keeps a retired service in its catalogue place.
   */
  loadCatalogue(): Promise<readonly Service[]>;
}

/** The owner's blocked time (002, D-019). Never cached: a new period rules at once (FR-056). */
export interface UnavailablePeriodRepository {
  /**
   * The periods that touch `[from, to)`, in order, found through the index on
   * their range (D-027). One query for the whole window, never one per day.
   */
  findOverlapping(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<readonly UnavailablePeriod[]>;

  findById(id: UnavailablePeriodId): Promise<UnavailablePeriod | null>;

  insert(period: UnavailablePeriod): Promise<UnavailablePeriod>;

  /** `null` when there is no such period. The reason is kept (FR-019). */
  shorten(
    id: UnavailablePeriodId,
    startsAt: Temporal.Instant,
    endsAt: Temporal.Instant,
  ): Promise<UnavailablePeriod | null>;

  /** Whether there was one to delete. */
  delete(id: UnavailablePeriodId): Promise<boolean>;
}

/** What `applyPlan` wrote: the appointment or the period the owner asked for. */
export type AppliedPlan =
  | { readonly kind: 'APPOINTMENT'; readonly appointment: Appointment }
  | { readonly kind: 'PERIOD'; readonly period: UnavailablePeriod };

/** The owner's changes, applied as plans (002, D-023). */
export interface OwnerAppointmentWriter {
  /**
   * FR-037: the whole plan in ONE transaction, or nothing. It detects again,
   * inside the transaction, what is in the way of the intent and compares its
   * fingerprint with `expectedStateToken`; if what the owner saw is no longer
   * what there is, nothing is applied (FR-038, D-024). A 23P01 of the EXCLUDE
   * constraint means the same thing and is answered the same way. The plan's
   * cancellations are written with `cancelled_by = OWNER` (FR-040a).
   */
  applyPlan(plan: ResolutionPlan, expectedStateToken: string): Promise<Result<AppliedPlan, 'STATE_CHANGED'>>;
}

/**
 * The hash behind a conflict's `stateToken` (002, D-024). A port because the
 * domain computes the token and `node:crypto` is out of its reach.
 */
export type StateHasher = (input: string) => string;

/** The owner's password (002, D-016). Implemented with scrypt; nothing here logs. */
export interface PasswordHasher {
  /** `scrypt$N$r$p$salt$hash`: the parameters travel with the hash. */
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
  /**
   * A verification against a fixed decoy with the same parameters, for when
   * there is no account or it is locked: the answer must not come back faster
   * and give that away (D-017).
   */
  verifyDecoy(password: string): Promise<void>;
}

export type OwnerAccountRecord = {
  readonly id: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly lockout: LockoutState;
};

/** The one staff account (002, FR-001). It holds nothing about any client. */
export interface OwnerAccountRepository {
  findByUsername(username: string): Promise<OwnerAccountRecord | null>;
  findById(id: string): Promise<OwnerAccountRecord | null>;
  saveLockout(id: string, state: LockoutState): Promise<void>;
  updatePassword(id: string, encoded: string, at: Temporal.Instant): Promise<void>;
  /**
   * FR-003: provisioning, outside the application. Replaces whatever account
   * there was — and with it, by cascade, every session — in one transaction.
   * Returns whether there was one.
   */
  replace(account: {
    readonly id: string;
    readonly username: string;
    readonly passwordHash: string;
    readonly at: Temporal.Instant;
  }): Promise<{ readonly replaced: boolean }>;
}

export type OwnerSession = {
  readonly id: string;
  readonly accountId: string;
  readonly lastSeenAt: Temporal.Instant;
};

/**
 * The owner's live sessions (002, D-015). Found by the SHA-256 of the cookie,
 * never by the token itself. Whether one is still alive is the domain's call
 * (`isSessionAlive`), not this port's.
 */
export interface OwnerSessionRepository {
  create(session: {
    readonly id: string;
    readonly accountId: string;
    readonly tokenHash: Uint8Array;
    readonly at: Temporal.Instant;
  }): Promise<void>;
  findByTokenHash(hash: Uint8Array): Promise<OwnerSession | null>;
  touch(id: string, at: Temporal.Instant): Promise<void>;
  /** FR-006: signing out deletes the row; nothing marks it. Idempotent. */
  deleteByTokenHash(hash: Uint8Array): Promise<void>;
  deleteAllExcept(accountId: string, keepHash: Uint8Array): Promise<void>;
  /** The retention sweep's tidying: rows idle since before `cutoff`. */
  deleteIdleSince(cutoff: Temporal.Instant): Promise<number>;
}

export type BookingListPage = {
  /** At most `pageSize`, each with all its services, origin, who cancelled and its confirmation (004). */
  readonly rows: readonly AppointmentWithDelivery[];
  /** The cursor of the next page; `null` when there is none. */
  readonly next: BookingListCursor | null;
};

/** The owner's bookings list (002, Historia 10). */
export interface BookingListReader {
  /**
   * ONE query for a page, services included, with `LIMIT pageSize + 1` to know
   * whether there is a next page without counting them all (FR-066, D-033).
   * It turns a query the domain has already decided into SQL; it decides
   * nothing itself.
   */
  readPage(query: BookingListQuery): Promise<BookingListPage>;
}

export interface TokenGenerator {
  /** D-005: 32 bytes from a CSPRNG. Returns the clear token and its SHA-256. */
  generate(): { readonly token: string; readonly hash: Uint8Array };
  hash(token: string): Uint8Array;
}

export type RateLimitBucket = 'APPOINTMENT_LOOKUP' | 'BOOKING_CONFIRMATION';

export interface RateLimiter {
  /**
   * FR-040: the IP becomes a key through an HMAC and is not kept beyond the
   * window. The result deliberately carries no remaining-attempts count and no
   * retry time: whoever opens a link must not be able to deduce that a limit
   * exists at all (FR-038, D-006). If it returned those, someone would put them
   * in a header and the indistinguishability would be gone.
   */
  check(bucket: RateLimitBucket, clientIp: string): Promise<{ readonly allowed: boolean }>;
}

/** The two tokens an email carries, while its notification is pending (004, D-002). */
export type NotificationTokens = {
  readonly management: string;
  readonly unsubscribe: string;
};

/** AES-256-GCM with `NOTIFICATION_SEAL_KEY` (004, D-002). */
export interface TokenSealer {
  seal(tokens: NotificationTokens): Uint8Array;
  /** `null` for anything that is not exactly what was sealed with this key. */
  open(sealed: Uint8Array): NotificationTokens | null;
}

/** An email ready to leave, written by the infrastructure from the domain's data. */
export type OutgoingEmail = {
  readonly channel: 'EMAIL';
  readonly to: string;
  /** The display name in front of the configured sender address: the salon's. */
  readonly fromName: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
};

/**
 * Puts the domain's data of a confirmation into words, with its two links
 * (004, D-008). The wording and the links are the infrastructure's business.
 */
export type ConfirmationEmailRenderer = (
  content: ConfirmationContent,
  tokens: NotificationTokens,
) => Pick<OutgoingEmail, 'subject' | 'html' | 'text' | 'headers'>;

/** The provider, behind a port (004, D-005). */
export interface Notifier {
  /**
   * `TRANSIENT` is worth another try; `PERMANENT` is not (D-006). Neither
   * carries the provider's words, which may repeat the address.
   * `idempotencyKey` makes a repeated send harmless (D-004).
   */
  send(message: OutgoingEmail, idempotencyKey: string): Promise<Result<void, 'TRANSIENT' | 'PERMANENT'>>;
}

/** Which channels are switched on (004, D-005). */
export interface ChannelSettings {
  enabledChannels(): ReadonlySet<Channel>;
}

/** What a locked notification is given to: itself and what it needs to decide. */
export type NotificationWork = {
  readonly notification: PendingNotification;
  /** As it is now, with all its services (FR-008). */
  readonly appointment: Appointment;
  readonly consent: ChannelConsent | null;
  /** `null` when they cannot be opened: the email cannot be written. */
  readonly tokens: NotificationTokens | null;
};

/**
 * What `fn` tells the repository to write: a final state, or the next
 * attempt. `attempted` is whether the provider was called, which is what the
 * attempt count counts (FR-019).
 */
export type NotificationOutcome =
  | { readonly status: 'SENT'; readonly attempted: true }
  | { readonly status: 'FAILED'; readonly attempted: boolean }
  | { readonly status: 'NOT_SENT'; readonly attempted: false; readonly reason: SkipReason }
  | { readonly status: 'PENDING'; readonly attempted: true; readonly nextAttemptAt: Temporal.Instant };

export interface NotificationRepository {
  /**
   * One pending notification, locked with `FOR UPDATE SKIP LOCKED` for the
   * whole of `fn` (D-003). `fn` is not called when it is not pending or is
   * locked by someone else; the result is then `null`.
   */
  withOne(
    id: NotificationId,
    at: Temporal.Instant,
    fn: (work: NotificationWork) => Promise<NotificationOutcome>,
  ): Promise<NotificationOutcome | null>;

  /**
   * Up to `limit` pending notifications whose next attempt has come, one
   * transaction each, skipping any another process holds.
   */
  withDue(
    now: Temporal.Instant,
    limit: number,
    fn: (work: NotificationWork) => Promise<NotificationOutcome>,
  ): Promise<readonly NotificationOutcome[]>;
}

export interface ConsentRepository {
  /** Only for appointments whose personal data is still there (FR-018). */
  findByUnsubscribeTokenHash(hash: Uint8Array): Promise<ChannelConsent | null>;
  findForAppointment(appointmentId: AppointmentId, channel: Channel): Promise<ChannelConsent | null>;
  /** Ends it if it is live; an ended one keeps its first end (FR-016). */
  end(
    appointmentId: AppointmentId,
    channel: Channel,
    reason: ConsentEndReason,
    at: Temporal.Instant,
  ): Promise<void>;
}
