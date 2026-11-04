# Implementation Plan: Email de confirmación al reservar

**Branch**: `004-notifications` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-notifications/spec.md`

## Summary

El cliente que reserva online y marca la casilla recibe un email de confirmación con
los datos de su cita, su enlace de gestión y una vía de baja. Es el primer mensaje que
envía la app, y con él se aplica el Principio IV: consentimiento por canal, baja,
registro sin contenido y un envío que nunca toca la cita. La dueña ve en la agenda y en
el listado las citas cuya confirmación falló, para llamar al cliente.

Seis decisiones lo sostienen ([research.md](./research.md)):

1. **Bandeja de salida en la misma transacción** que la cita: consentimiento y envío
   pendiente se guardan con ella o no se guardan (D-001).
2. **Los enlaces viajan cifrados** en la fila pendiente y se borran al terminar,
   porque la base de datos sólo tiene el hash del token de gestión (D-002).
3. **Primer intento con `after()`** justo tras responder, y **reintentos por cron**
   cada minuto durante 1 hora, con bloqueo `SKIP LOCKED` (D-003).
4. **Resend por HTTP** con clave de idempotencia, detrás de un puerto `Notifier`; el
   SMS es un canal apagado sin adaptador (D-004, D-005).
5. **El dominio decide** si sale un email, cuándo se reintenta, qué datos lleva y si la
   dueña ve la marca; la infraestructura sólo lo pinta (D-008).
6. **Consentimiento por cita** con su propio token de baja; la baja es una página con
   botón más la baja de un clic del gestor de correo (D-007, D-009).

## Technical Context

**Language/Version**: TypeScript 5.7 (`strict`, `noUncheckedIndexedAccess`), Node.js 22 LTS

**Primary Dependencies**: Next.js 15 (App Router, `after()` de `next/server`) + React 19, Drizzle ORM + `pg`, Zod 3, Pino, `@js-temporal/polyfill`. `node:crypto` para AES-256-GCM y SHA-256. Resend por su API HTTP con `fetch`. **Sin dependencias nuevas.**

**Storage**: PostgreSQL 16. Una migración nueva escrita a mano, `0008_notifications.sql`: tablas `channel_consent` y `notification`, sus tipos, restricciones e índices ([data-model.md](./data-model.md)).

**Testing**: Vitest (unitarios de dominio y de render del email; integración contra `db-test` con un proveedor de email falso; contrato contra `http-api.yaml` 2.2.0 y `owner-api.yaml` 1.3.0). Playwright + axe en `mobile-360`, `tablet-768` y `desktop-1280`, con el proveedor falso arrancado en el `globalSetup`.

**Target Platform**: El servidor de la 001 (Docker Compose detrás de Caddy) más una entrada de cron por minuto.

**Project Type**: Aplicación web renderizada en servidor (la de la 001).

**Performance Goals**: La reserva sigue < 2 s con la casilla marcada y el proveedor lento o caído (SC-002). El 95 % de las confirmaciones llegan al proveedor en < 1 min (SC-001). La agenda y el listado siguen siendo una consulta (002/D-027).

**Constraints**:
- El envío nunca forma parte de la transacción de reserva ni de su respuesta (FR-010).
- Ninguna tabla nueva con datos personales; ningún log con nombre, teléfono, email, contenido o tokens (FR-020, FR-022).
- Funciona sin JavaScript (003/D-003): la casilla, la baja y «Dejar de recibir emails» son formularios.
- Sólo los anchos de la 003.
- Textos en `src/messages/es-ES.ts`.
- Con `NOTIFICATIONS_EMAIL=off`, la app se comporta exactamente como antes.

**Scale/Scope**: 1 migración, 1 módulo de dominio nuevo, 5 puertos nuevos y 2 que cambian, 2 casos de uso nuevos y 4 que cambian, 1 comando, 2 rutas de API nuevas y 3 que cambian, 2 pantallas nuevas o con sección nueva y 3 que cambian, 2 contratos y 1 proveedor falso para tests. Unos 300 emails al mes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento |
|---|---|
| I. Capas | ✅ `src/domain/notifications` decide envío, reintento, contenido y marca (D-008), sin importar Next, `pg` ni `node:crypto`. El adaptador de Resend, el cifrado y el render del email están en `infrastructure`. `check:layers` lo verifica. |
| II. Testing | ✅ Tests antes del código en cada historia (D-013). Cubre el caso límite del principio adaptado a este aviso: la confirmación de una cita ya cancelada no se envía. Proveedor falso para probar el adaptador real; e2e de cada flujo. |
| III. Datos personales | ✅ Ningún dato personal nuevo; `notification` y `channel_consent` sólo guardan ids, estados, momentos y hashes. La anonimización alcanza a la vía de baja y a los envíos pendientes en la misma sentencia (D-012). El nombre y el email sólo salen hacia el proveedor (FR-023), que es encargado del tratamiento; su copia se conserva el mínimo posible y el borrado a petición incluye borrarla allí, con un procedimiento escrito (D-012). |
| IV. Comunicaciones | ✅ Se aplica por primera vez. Consentimiento propio por canal, con fecha y revocable (D-007). Sin contenido comercial (FR-007). Vía de baja en cada email, con baja de un clic (D-009). Sin consentimiento no se envía (`decideDelivery`). Registro con cita, canal, estado y momento, sin contenido (data-model). Un fallo no toca la cita (D-001). |
| V. Seguridad | ✅ Token de baja de 32 bytes con sólo su hash en la base. Tokens de gestión cifrados con AES-256-GCM mientras el envío está pendiente y borrados después (D-002). `emailConsent` validado con Zod. Rutas con token con el límite por IP de la 001. Clave de cifrado y de API fuera del repositorio. |
| VI. Experiencia de usuario | ✅ La casilla no añade pasos. Mensajes claros en confirmación, cita y baja. La baja pide confirmación. La dueña recibe una indicación accionable (llamar) cuando el email falla. |
| VII. Accesibilidad | ✅ Casilla con `<label>` y ayuda por `aria-describedby`; estados con texto e icono y `role="status"`; la marca de la dueña con texto. Email semántico con versión de texto plano. axe en los tres tamaños. |
| VIII. Rendimiento | ✅ El envío fuera del camino de la reserva. La disponibilidad no lee las tablas nuevas. La marca de la dueña sale en la misma consulta con un `LEFT JOIN` único (D-011). |

**Post-design re-check**: sin cambios. Ninguna desviación de la constitución.

**Cambio de una decisión del CLAUDE.md** (no de la constitución): «la BD guarda sólo
su hash» pasa a admitir el token cifrado mientras su confirmación está pendiente
(D-002). Y «v1 no envía SMS ni email» deja de ser cierto para la reserva online. Los
dos se actualizan al cerrar la feature.

## Project Structure

### Documentation (this feature)

```text
specs/004-notifications/
├── plan.md              # Este archivo
├── research.md          # D-001 a D-013
├── data-model.md        # channel_consent, notification, tipos y puertos
├── quickstart.md        # Validación automática, manual y puesta en producción
├── contracts/
│   ├── http-api-changes.md   # Cliente 2.2.0 y gestión 1.3.0
│   └── ui-and-email.md       # Casilla, pantallas, baja, marca y email
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── domain/
│   └── notifications/                 # Nuevo
│       ├── consent.ts                 # ChannelConsent, revokeConsent
│       ├── delivery.ts                # decideDelivery, nextAttemptAt
│       ├── confirmation-content.ts    # confirmationContent (usa deriveView y el total de la 005)
│       └── owner-marker.ts            # needsConfirmationCall
├── application/
│   ├── ports/index.ts                 # NewAppointment.emailConfirmation; Notifier, ChannelSettings,
│   │                                  # NotificationRepository, ConsentRepository, TokenSealer
│   └── use-cases/
│       ├── confirm-booking.ts         # emailConsent; tokens de baja y sellado; devuelve notificationId
│       ├── dispatch-notifications.ts  # Nuevo: dispatchOne(id) y dispatchDue(now)
│       ├── revoke-email-consent.ts    # Nuevo: por token de baja y por token de gestión
│       ├── view-appointment.ts        # emailNotifications.active
│       ├── get-agenda-day.ts          # confirmationEmailFailed
│       ├── list-bookings.ts           # confirmationEmailFailed
│       └── purge-expired-personal-data.ts   # sin cambios de lógica; el puerto hace más
├── infrastructure/
│   ├── config/env.ts                  # NOTIFICATIONS_EMAIL/SMS, EMAIL_*, NOTIFICATION_SEAL_KEY
│   ├── db/
│   │   ├── migrations/0008_notifications.sql   # Nueva
│   │   ├── schema.ts                  # channelConsent, notification
│   │   ├── appointment-repository.ts  # insert con consentimiento y envío; LEFT JOIN en findInWindow;
│   │   │                              # anonimización con CTE
│   │   ├── booking-list-reader.ts     # LEFT JOIN
│   │   ├── owner-appointment-writer.ts  # EMAIL_CHANGED al editar el email
│   │   ├── notification-repository.ts # Nuevo: FOR UPDATE SKIP LOCKED
│   │   └── consent-repository.ts      # Nuevo
│   ├── notifications/                 # Nuevo
│   │   ├── resend-notifier.ts         # fetch, Idempotency-Key, TRANSIENT/PERMANENT, sin cuerpo de error
│   │   ├── confirmation-email.ts      # asunto, texto y HTML desde confirmationContent
│   │   └── channel-settings.ts
│   ├── security/token-sealer.ts       # Nuevo: AES-256-GCM
│   └── logging/logger.ts              # + to, subject, html, text, sealedTokens
├── app/
│   ├── _lib/container.ts              # cablea lo nuevo
│   ├── (booking)/reservar/actions.ts  # emailConsent; after(dispatchOne)
│   ├── (booking)/reservar/page.tsx    # pasa si el canal está encendido
│   ├── api/appointments/route.ts      # emailConsent; after(dispatchOne)
│   ├── api/appointments/[token]/route.ts               # emailNotifications
│   ├── api/appointments/[token]/email-consent/revocation/route.ts   # Nuevo
│   ├── api/unsubscribe/[token]/route.ts                # Nuevo (RFC 8058)
│   ├── api/gestion/_lib/serializers.ts                 # confirmationEmailFailed
│   ├── baja/[token]/page.tsx          # Nuevo
│   ├── baja/[token]/actions.ts        # Nuevo
│   ├── cita/[token]/page.tsx          # aviso de confirmación; sección de email
│   └── cita/[token]/actions.ts        # dejar de recibir emails
├── components/
│   ├── booking-form.tsx               # casilla emailConsent
│   ├── email-consent-section.tsx      # Nuevo: pantalla de la cita
│   └── owner/{timeline,booking-list}.tsx   # marca «Confirmación por email no enviada»
└── messages/es-ES.ts                  # textos de contracts/ui-and-email.md

scripts/
├── dispatch-notifications.ts          # Nuevo: npm run notifications:dispatch
└── fake-email-provider.ts             # Nuevo: npm run email:fake (usa tests/support)

tests/
├── support/fake-email-provider.ts     # Nuevo: imita POST /emails; --fail y --reject
├── unit/domain/notifications/*.test.ts
├── unit/infrastructure/{confirmation-email,token-sealer,resend-notifier-classify}.test.ts
├── unit/messages/notifications.test.ts
├── integration/db/migration-0008.test.ts
├── integration/use-cases/{confirm-booking,dispatch-notifications,revoke-email-consent,
│                          purge-expired-personal-data,edit-appointment-as-owner}.test.ts
├── integration/concurrency/concurrent-dispatch.test.ts
├── integration/infrastructure/resend-notifier.test.ts
├── integration/logging/no-pii.test.ts             # + casos del envío
├── contract/{appointments-create,appointment-detail,email-consent,unsubscribe}.test.ts
├── contract/owner/{agenda,reservas}.test.ts
└── e2e/{us12-confirmation-email,us13-unsubscribe,us14-delivery-failure}.spec.ts

specs/001-client-appointment-booking/contracts/http-api.yaml   # 2.2.0
specs/002-salon-management/contracts/owner-api.yaml           # 1.3.0
.env.example, playwright.config.ts, package.json               # variables, proveedor falso, scripts
```

**Structure Decision**: el proyecto único de la 001 con sus cuatro capas. Un módulo de
dominio nuevo (`notifications/`), un directorio de infraestructura nuevo
(`notifications/`), dos rutas de página (`/baja`) y un comando, como el de la purga. Los
e2e se numeran a continuación de los de la 002 (`us12`–`us14`) para no confundirse con
sus historias.

## Orden de trabajo

1. **Base**: migración 0008, dominio (`delivery`, `consent`, `confirmation-content`),
   puertos, cifrado, configuración de canales, adaptador de Resend, render del email
   (con su vía de baja) y proveedor falso. Con `NOTIFICATIONS_EMAIL=off` toda la suite
   anterior sigue en verde.
2. **US1**: casilla, transacción de D-001 con el token de baja, primer intento con
   `after()` y pantalla de confirmación.
3. **US2**: página `/baja`, baja de un clic, sección de la cita y su API.
4. **US3**: comando de despacho y cron, reintentos y plazo, `SKIP` por cancelación o
   email cambiado, anonimización con CTE, marca de la dueña y contrato 1.3.0.
5. **Cierre**: contratos en sus archivos, `.env.example`, quickstart de producción,
   README, roadmap (paso 7), CLAUDE.md y las partes de la 001 y la 002 que cambian
   (Dependencies de la spec).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Un email duplicado tras un corte entre «el proveedor lo aceptó» y «lo anotamos». | `Idempotency-Key` con el id del envío (D-004), bloqueo `SKIP LOCKED` y el índice único `(appointment_id, channel, kind)`. Test de dos despachos a la vez. |
| El texto de error del proveedor lleva la dirección a un log. | El adaptador no propaga el cuerpo de error (D-006); test de integración con un proveedor falso que la devuelve. |
| El token cifrado sobrevive a un estado final. | `CHECK` en la tabla (D-002) y test de integración por cada estado final. |
| `after()` no se ejecuta (proceso que cae justo después). | El cron por minuto lo recoge; el envío ya existe como fila (D-001). |
| El proveedor no permite borrar un envío concreto a petición. | El procedimiento se escribe con lo que ofrezca de verdad al contratarlo (API o petición por contrato, con plazo), y su conservación en el mínimo es el tope (D-012). Se comprueba antes de enviar a clientes reales. |
| El cron no está instalado en producción y nada se reintenta. | Paso del quickstart de producción. El primer intento no depende de él. |
| El límite de 2 s (SC-002 de la 004, SC-004 de la 001) ya va justo en `performance.spec.ts`. | El envío no está en el camino de la reserva; se mide con la casilla marcada antes y después. |
| Resend cambia su plan gratuito o su región de la UE no está disponible. | Adaptador detrás de un puerto; Brevo como alternativa documentada (D-004). |
| El salón no tiene dominio y la verificación se retrasa. | La dirección es configuración: se puede salir con el dominio de la app (clarificación del 2026-11-04). |

## Complexity Tracking

Sin violaciones de la constitución que justificar.
