# Data Model: Email de confirmación al reservar

**Feature**: `004-notifications` | **Date**: 2026-11-04

Ninguna tabla nueva guarda datos personales (Principio III). La cita no cambia de
columnas.

## Base de datos

### Tipos nuevos

```sql
CREATE TYPE notification_channel AS ENUM ('EMAIL', 'SMS');
CREATE TYPE notification_kind    AS ENUM ('BOOKING_CONFIRMATION');
CREATE TYPE notification_status  AS ENUM ('PENDING', 'SENT', 'FAILED', 'NOT_SENT');
CREATE TYPE notification_skip_reason AS ENUM
  ('CONSENT_ENDED', 'APPOINTMENT_CANCELLED', 'PERSONAL_DATA_DELETED');
CREATE TYPE consent_end_reason   AS ENUM ('UNSUBSCRIBED', 'EMAIL_CHANGED');
```

### `channel_consent` (nueva)

El consentimiento de una cita para un canal (FR-002, FR-003, D-007).

| Columna | Tipo | Notas |
|---|---|---|
| `appointment_id` | `uuid` | FK a `appointment`, `ON DELETE CASCADE`. |
| `channel` | `notification_channel` | |
| `granted_at` | `timestamptz NOT NULL` | Momento de la reserva. |
| `ended_at` | `timestamptz` | Baja o cambio de email. |
| `end_reason` | `consent_end_reason` | |
| `unsubscribe_token_hash` | `bytea` | SHA-256 de 32 bytes. `NULL` tras anonimizar. |

- **PK** `(appointment_id, channel)`.
- **Único** `unsubscribe_token_hash` (parcial, `WHERE unsubscribe_token_hash IS NOT NULL`).
- `CHECK ((ended_at IS NULL) = (end_reason IS NULL))`.
- `CHECK (octet_length(unsubscribe_token_hash) = 32)` cuando no es `NULL`.

### `notification` (nueva)

Cada aviso que la app intenta mandar, y su registro (FR-019, FR-020, D-001, D-002).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | También la `Idempotency-Key` del proveedor (D-004). |
| `appointment_id` | `uuid NOT NULL` | FK a `appointment`, `ON DELETE CASCADE`. |
| `channel` | `notification_channel NOT NULL` | |
| `kind` | `notification_kind NOT NULL` | |
| `status` | `notification_status NOT NULL` | `PENDING` al crearse. |
| `skip_reason` | `notification_skip_reason` | Sólo con `NOT_SENT`. |
| `attempts` | `smallint NOT NULL DEFAULT 0` | |
| `created_at` | `timestamptz NOT NULL` | El plazo de 1 h cuenta desde aquí. |
| `next_attempt_at` | `timestamptz` | Sólo con `PENDING`. |
| `updated_at` | `timestamptz NOT NULL` | Último cambio de estado. |
| `sealed_tokens` | `bytea` | AES-256-GCM de los tokens de gestión y de baja. Sólo con `PENDING`. |

- **Único** `(appointment_id, channel, kind)`: una cita no tiene dos confirmaciones
  por email (FR-012).
- `CHECK ((status = 'PENDING') = (next_attempt_at IS NOT NULL))`.
- `CHECK ((status = 'PENDING') = (sealed_tokens IS NOT NULL))`: ningún token cifrado
  sobrevive a un estado final (D-002).
- `CHECK ((status = 'NOT_SENT') = (skip_reason IS NOT NULL))`.
- **Índice** parcial `(next_attempt_at) WHERE status = 'PENDING'` para el despacho.
- No hay columna de destinatario, asunto ni cuerpo (FR-020).
- `created_at`, `updated_at` y `attempts` son el registro que pide FR-019: cuándo se
  creó, cuándo cambió de estado por última vez y cuántas veces se intentó.

### Transiciones de `notification.status`

```text
PENDING ──(proveedor acepta)──────────────────────────▶ SENT
PENDING ──(TRANSIENT, queda plazo)──▶ PENDING (attempts+1, next_attempt_at)
PENDING ──(TRANSIENT sin plazo | PERMANENT)──────────▶ FAILED
PENDING ──(decideDelivery = SKIP)────────────────────▶ NOT_SENT (skip_reason)
PENDING ──(anonimización)────────────────────────────▶ NOT_SENT (PERSONAL_DATA_DELETED)
```

Los tres estados finales no cambian más.

### `appointment` (sin cambios de columnas)

La anonimización (`anonymizeDueBefore`, `anonymizeOne`) pasa a ser una sentencia con CTE
que, sobre las citas que anonimiza, también:

- pone a `NULL` `channel_consent.unsubscribe_token_hash`;
- pasa sus envíos `PENDING` a `NOT_SENT` con `PERSONAL_DATA_DELETED`, sin
  `sealed_tokens` ni `next_attempt_at` (FR-021, D-012).

### Migración `0008_notifications.sql`

Tipos, las dos tablas, sus restricciones e índices. No toca datos existentes: ninguna
cita anterior tiene consentimiento, y ninguna recibe un email.

## Dominio (`src/domain/notifications/`)

### Tipos

```ts
type Channel = 'EMAIL' | 'SMS';
type NotificationKind = 'BOOKING_CONFIRMATION';
type ConsentEndReason = 'UNSUBSCRIBED' | 'EMAIL_CHANGED';
type SkipReason = 'CONSENT_ENDED' | 'APPOINTMENT_CANCELLED' | 'PERSONAL_DATA_DELETED';

type ChannelConsent = {
  appointmentId: AppointmentId;
  channel: Channel;
  grantedAt: Temporal.Instant;
  ended: { at: Temporal.Instant; reason: ConsentEndReason } | null;
};

type PendingNotification = {
  id: NotificationId;
  appointmentId: AppointmentId;
  channel: Channel;
  kind: NotificationKind;
  attempts: number;
  createdAt: Temporal.Instant;
};
```

### Funciones (todas devuelven `Result` o un valor total, sin excepciones)

| Función | Qué decide | Requisitos |
|---|---|---|
| `decideDelivery({ appointment, consent, notification, now })` | `SEND`, `SKIP(reason)` o `EXPIRED` | FR-005, FR-008, FR-009, FR-011 |
| `nextAttemptAt(createdAt, now)` | El primero de los momentos a 1, 3, 7, 15, 30 y 45 min de la reserva que aún no ha pasado, o `null` si no queda ninguno antes de la hora | FR-011 |
| `confirmationContent(appointment, salon, policy)` | Datos del email: salón, día, horas locales, servicios, total, plazo | FR-006, FR-007 |
| `revokeConsent(consent, reason, now)` | Consentimiento terminado; `ALREADY_ENDED` si ya lo estaba (inocuo) | FR-016 |
| `needsConfirmationCall(appointment, delivery, now)` | Si la dueña ve la marca | FR-020a |

`decideDelivery`, por orden:

1. Cita anonimizada → `SKIP(PERSONAL_DATA_DELETED)`.
2. Cita cancelada → `SKIP(APPOINTMENT_CANCELLED)`.
3. Sin consentimiento vigente para el canal → `SKIP(CONSENT_ENDED)`.
4. `now ≥ createdAt + 1 h` → `EXPIRED` (pasa a `FAILED`).
5. En otro caso → `SEND`.

### `Appointment` leída por la dueña (cambia)

`findInWindow` y `readPage` añaden `confirmationDelivery: 'FAILED' | 'OTHER' | null`:
`null` sin confirmación por email, `FAILED` si falló, `OTHER` en cualquier otro estado.

## Puertos (`src/application/ports/index.ts`)

| Puerto | Cambio |
|---|---|
| `NewAppointment` | Gana `emailConfirmation?: { unsubscribeTokenHash; notificationId; sealedTokens }`. `insert` escribe cita, servicios, consentimiento y envío en una transacción. |
| `Notifier` (nuevo) | `send(message: OutgoingEmail, idempotencyKey: string): Promise<Result<void, 'TRANSIENT' \| 'PERMANENT'>>`. |
| `ChannelSettings` (nuevo) | `enabledChannels(): ReadonlySet<Channel>`. |
| `NotificationRepository` (nuevo) | `withDue(now, limit, fn)` y `withOne(id, fn)`: bloquean con `FOR UPDATE SKIP LOCKED` y dan a `fn` el envío, su cita, su consentimiento y los tokens descifrados; `fn` devuelve el estado final o el siguiente intento. |
| `ConsentRepository` (nuevo) | `findByUnsubscribeTokenHash`, `findForAppointment`, `end(appointmentId, channel, reason, at)`. |
| `TokenSealer` (nuevo) | `seal(tokens): Uint8Array`, `open(bytes): tokens \| null`. AES-256-GCM con `NOTIFICATION_SEAL_KEY`. |
| `OwnerAppointmentWriter.applyPlan` | Si la edición cambia o quita el email, termina el consentimiento con `EMAIL_CHANGED` en la misma transacción (FR-008). |

## Reglas que no cambian

- La cita sigue guardando sólo nombre, teléfono y email (Principio III).
- La disponibilidad sigue siendo una consulta (001/D-003); no lee las tablas nuevas.
- Las citas a mano no tienen enlace, y por eso tampoco confirmación (002, FR-026).
- El límite de 3 citas futuras por teléfono o email no cambia.
