---

description: "Lista de tareas de la 004-notifications"
---

# Tasks: Email de confirmación al reservar

**Input**: Documentos de diseño en `/specs/004-notifications/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obligatorios. El CLAUDE.md y el Principio II exigen TDD: cada test se escribe
primero y se ve fallar antes de escribir el código que lo pone en verde.

**Organization**: por historia de usuario, en orden de prioridad (US1 → US2 → US3).
Ninguna historia se fusiona a `main` sola: la feature entra entera, porque US1 sin la
baja (US2) ni los reintentos y el registro completo (US3) no cumple el Principio IV
(research D-013).

## Format: `[ID] [P?] [Story] Descripción`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia a la que pertenece (US1, US2, US3)

## Path Conventions

Proyecto único: `src/`, `tests/`, `scripts/`, `db/` en la raíz (plan.md). Los
identificadores, rutas y nombres de test van en inglés; el resto, en español.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: variables, scripts y el proveedor de email falso que usan todos los tests

- [X] T001 Añadir a `.env.example` `NOTIFICATIONS_EMAIL`, `NOTIFICATIONS_SMS`, `EMAIL_API_KEY`, `EMAIL_API_BASE_URL`, `EMAIL_FROM`, `EMAIL_REPLY_TO` y `NOTIFICATION_SEAL_KEY`, cada una con su comentario (valores y significado como en quickstart.md; `NOTIFICATIONS_EMAIL=off` por defecto)
- [X] T002 Añadir a `package.json` los scripts `notifications:dispatch` (`tsx scripts/dispatch-notifications.ts`) y `email:fake` (`tsx scripts/fake-email-provider.ts`)
- [X] T003 [P] Crear el proveedor de email falso en `tests/support/fake-email-provider.ts`: un servidor `node:http` que imita `POST /emails` de Resend (comprueba `Authorization: Bearer`, guarda en memoria cuerpo y cabeceras con la `Idempotency-Key`, responde `200 {id}` y el mismo `id` si la clave se repite), expone `GET /__messages` y `DELETE /__messages`, y tiene los modos `ok`, `fail` (`503`), `reject` (`422`), `hang` (no responde) y `echo` (`422` con un cuerpo que repite la dirección), que se cambian con `POST /__mode`. Cada mensaje guarda el instante en que llegó
- [X] T004 [P] Crear el comando `scripts/fake-email-provider.ts`, que arranca el falso en el puerto 4010 (`--fail` y `--reject` fijan el modo) e imprime de cada email recibido el asunto y las líneas de los enlaces, nunca el destinatario
- [X] T005 Arrancar el proveedor falso en `tests/e2e/global-setup.ts` y pasar en `webServer.env` de `playwright.config.ts` `NOTIFICATIONS_EMAIL=on`, `EMAIL_API_BASE_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` y una `NOTIFICATION_SEAL_KEY` fija de test: la suite e2e entera corre con el canal encendido (research D-013). Añadir el helper `tests/e2e/helpers/email.ts` (`readMessages`, `clearMessages`, `setMode`, `linksIn(message)`)
- [X] T006 Dar a las suites de integración y contrato el mismo proveedor falso: un helper `tests/integration/helpers/fake-email.ts` que lo arranca en un puerto libre por archivo y fija las variables de email antes de leer `env()` (con `resetEnvCache`). `NOTIFICATIONS_EMAIL=off` por defecto en `tests/integration/helpers/load-env.ts`, para que las suites existentes no cambien

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tablas, dominio, puertos, cifrado, configuración de canales, adaptador del proveedor y render del email

**⚠️ CRITICAL**: ninguna historia empieza antes de cerrar esta fase

### Tests (escribir primero y verlos fallar)

- [X] T007 [P] Test de la migración en `tests/integration/db/migration-0008.test.ts`: existen las dos tablas y los tipos; `notification` rechaza `sealed_tokens` o `next_attempt_at` fuera de `PENDING`, un `NOT_SENT` sin `skip_reason` y un segundo `(appointment_id, channel, kind)`; `channel_consent` rechaza `ended_at` sin `end_reason` y un hash que no tenga 32 bytes; las citas cargadas con el esquema de la 0007 no cambian
- [X] T008 [P] Tests unitarios de `decideDelivery` y `nextAttemptAt` en `tests/unit/domain/notifications/delivery.test.ts`: el orden de reglas de data-model.md (anonimizada → `SKIP(PERSONAL_DATA_DELETED)`, cancelada → `SKIP(APPOINTMENT_CANCELLED)`, sin consentimiento o terminado → `SKIP(CONSENT_ENDED)`, `now ≥ createdAt + 1 h` → `EXPIRED`, si no → `SEND`); la confirmación de una cita ya cancelada nunca es `SEND` (Principio II); el calendario devuelve el primero de los momentos a 1, 3, 7, 15, 30 y 45 min de la reserva que aún no ha pasado, y `null` después del de los 45 min
- [X] T009 [P] Tests unitarios de `revokeConsent` en `tests/unit/domain/notifications/consent.test.ts`: termina un consentimiento vigente con motivo e instante; uno ya terminado devuelve `ALREADY_ENDED` sin cambiar su primer final
- [X] T010 [P] Tests unitarios de `confirmationContent` en `tests/unit/domain/notifications/confirmation-content.test.ts`: nombre del salón, día de la semana y horas de inicio y fin en `Europe/Madrid`, una cita en el día de un cambio de hora, cada servicio con precio o `null`, el total de la 005 (todos con precio, ninguno, mixto), el plazo de cancelación en horas de `BookingPolicy`, y ni teléfono ni email en el resultado
- [X] T011 [P] Tests unitarios de `TokenSealer` en `tests/unit/infrastructure/token-sealer.test.ts`: ida y vuelta de `{ management, unsubscribe }`; un byte cambiado, un valor truncado u otra clave abren a `null`; dos sellados de los mismos tokens son distintos (IV aleatorio)
- [X] T012 [P] Tests unitarios de la configuración de avisos en `tests/unit/infrastructure/env-notifications.test.ts`: `NOTIFICATIONS_EMAIL=on` sin `EMAIL_API_KEY`, `EMAIL_FROM` o una `NOTIFICATION_SEAL_KEY` base64 de 32 bytes lanza un error que nombra la variable; `NOTIFICATIONS_SMS=on` lanza error (en esta feature sólo se admite `off`); con `off` no hace falta ninguna; `enabledChannels()` refleja los interruptores
- [X] T013 [P] Tests unitarios de la clasificación de errores del proveedor en `tests/unit/infrastructure/resend-notifier-classify.test.ts`: error de red, *timeout*, `429` y `5xx` → `TRANSIENT`; cualquier otro `4xx` → `PERMANENT`; el error devuelto nunca lleva el cuerpo de la respuesta
- [X] T014 [P] Test de integración del adaptador de Resend contra el falso en `tests/integration/infrastructure/resend-notifier.test.ts`: envía `from` como `{salón} <EMAIL_FROM>`, `reply_to` sólo si está configurado, `subject`, `html`, `text`, `Idempotency-Key` y las cabeceras `List-Unsubscribe` y `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; `fail` → `TRANSIENT`, `reject` → `PERMANENT`, `hang` → `TRANSIENT` tras el *timeout* de 10 s (acortado en el test)
- [X] T015 [P] Tests unitarios del render del email en `tests/unit/infrastructure/confirmation-email.test.ts`: formato del asunto de contracts/ui-and-email.md; las secciones del cuerpo en orden; fechas con palabras; «Precio a consultar en el salón» y el total mixto; el enlace de gestión y el de baja con texto descriptivo; la parte de texto plano con el mismo contenido; HTML con `lang="es"`, sin `<img>` y sin parámetros de rastreo; el teléfono y el email del cliente no aparecen en ningún sitio
- [X] T016 [P] Test unitario en `tests/unit/messages/notifications.test.ts` que compara cada texto de contracts/ui-and-email.md con `src/messages/es-ES.ts`
- [X] T017 [P] Ampliar `tests/unit/infrastructure/logger-redaction.test.ts` con `to`, `subject`, `html`, `text` y `sealedTokens`, en el primer nivel y anidados

### Implementation

- [X] T018 Escribir `src/infrastructure/db/migrations/0008_notifications.sql` tal como data-model.md (tipos, `channel_consent`, `notification`, CHECKs, índices únicos y parciales), en una transacción
- [X] T019 Añadir `channelConsent` y `notification` con sus tipos a `src/infrastructure/db/schema.ts`
- [X] T020 [P] Implementar `ChannelConsent`, `revokeConsent` y los tipos comunes (`Channel`, `NotificationKind`, `ConsentEndReason`, `SkipReason`, `PendingNotification`) en `src/domain/notifications/consent.ts`
- [X] T021 [P] Implementar `decideDelivery` y `nextAttemptAt` en `src/domain/notifications/delivery.ts` (depende de T020)
- [X] T022 [P] Implementar `confirmationContent` en `src/domain/notifications/confirmation-content.ts`, reutilizando `deriveView` (`src/domain/booking/derive-view.ts`) y el total de la 005 de `src/domain/catalog/selection.ts`
- [X] T023 Añadir a `src/application/ports/index.ts`: `OutgoingEmail`, `Notifier`, `ChannelSettings`, `NotificationRepository` (`withOne`, `withDue`), `ConsentRepository`, `TokenSealer` y `NewAppointment.emailConfirmation`, con los contratos de data-model.md
- [X] T024 [P] Implementar `src/infrastructure/security/token-sealer.ts` (AES-256-GCM con `node:crypto`, IV‖tag‖cifrado; `open` devuelve `null` ante cualquier fallo)
- [X] T025 Añadir las variables de avisos y su validación a `src/infrastructure/config/env.ts`, y `unsubscribeLink(token)` junto a `managementLink`
- [X] T026 [P] Implementar `src/infrastructure/notifications/channel-settings.ts` a partir de `env()`
- [X] T027 Implementar `src/infrastructure/notifications/resend-notifier.ts` con `fetch`, `AbortSignal.timeout(10_000)`, `EMAIL_API_BASE_URL` configurable, la clasificación de errores de research D-006 y sin el cuerpo de la respuesta en ningún resultado ni log
- [X] T028 Añadir a `src/messages/es-ES.ts` los textos de contracts/ui-and-email.md (formulario, pantalla de confirmación, pantalla de la cita, página de baja, marca de la dueña y email)
- [X] T029 Implementar `src/infrastructure/notifications/confirmation-email.ts`: `renderConfirmationEmail(content, links) → { subject, html, text, headers }` a partir de `confirmationContent` y los textos
- [X] T030 Añadir `to`, `subject`, `html`, `text` y `sealedTokens` a las rutas redactadas de `src/infrastructure/logging/logger.ts`
- [X] T031 Control, con `npm run lint` y `npm run check:layers` en verde: unitarios, integración y contrato pasan con `NOTIFICATIONS_EMAIL=off` sin cambiar el comportamiento de la 001, la 002, la 003 ni la 005; la suite e2e de esas features pasa con `on`, con la casilla presente y desmarcada (research D-013)

**Checkpoint**: base lista; las historias pueden empezar

---

## Phase 3: User Story 1 - Recibir la confirmación por email al reservar (Priority: P1) 🎯 MVP

**Goal**: el cliente que marca la casilla recibe un único email con los datos de su cita, su enlace de gestión y su vía de baja

**Independent Test**: con el canal encendido y el proveedor falso, reservar marcando la casilla y comprobar que llega un único email cuyo enlace abre esa cita; sin la casilla o con una cita a mano, no llega nada

### Tests for User Story 1 (escribir primero y verlos fallar)

- [X] T032 [P] [US1] Ampliar `tests/integration/use-cases/confirm-booking.test.ts`: con consentimiento y el canal encendido, una sola llamada deja la cita, sus servicios, una fila `channel_consent` con `granted_at` = ahora y un hash de baja, y un envío `PENDING` con tokens sellados; si `EXCLUDE` rechaza la hora, no queda ninguno; con `emailConsent: false` o el canal apagado, ni consentimiento ni envío; el resultado lleva `notificationId` sólo cuando se creó uno
- [X] T033 [P] [US1] Crear `tests/integration/use-cases/dispatch-notifications.test.ts` con `dispatchOne`: el falso recibe un email cuyo enlace de gestión tiene un token cuyo hash es el `token_hash` de la cita, y cuyo enlace de baja tiene un token cuyo hash es el del consentimiento; el envío queda `SENT`, con `attempts = 1` y `sealed_tokens` y `next_attempt_at` a `NULL`; una segunda llamada no envía nada
- [X] T034 [P] [US1] Ampliar `tests/integration/use-cases/view-appointment.test.ts`: `emailNotifications.active` es `true` con consentimiento vigente y `false` sin él
- [X] T035 [P] [US1] Ampliar `tests/contract/appointments-create.test.ts` (`emailConsent` aceptado, opcional, `false` por defecto; un tipo erróneo → `400`) y `tests/contract/appointment-detail.test.ts` (`emailNotifications.active` presente) contra `http-api.yaml` 2.2.0
- [X] T036 [P] [US1] Crear `tests/e2e/us12-confirmation-email.spec.ts`: la casilla está desmarcada, con etiqueta y ayuda; al reservar con ella, la pantalla de confirmación nombra la dirección y sigue ofreciendo el enlace; el falso tiene un email con día, horas, servicios, total, dirección, teléfono y enlaces, sin el teléfono ni el email del cliente, y **llega en menos de 10 s desde la reserva sin lanzar el cron** (SC-001); su enlace de gestión abre la cita; al reservar sin ella, el texto de la 001 y ningún email; la casilla conserva su estado tras un error en otro campo; una cita a mano con email no envía nada; axe en el formulario y en la pantalla de confirmación
- [X] T037 [P] [US1] Ampliar `tests/e2e/performance.spec.ts`: el límite de 2 s (SC-002 de la 004, SC-004 de la 001) con la casilla marcada, también con el falso en modo `hang`

### Implementation for User Story 1

- [X] T038 [US1] Ampliar `insert` en `src/infrastructure/db/appointment-repository.ts` para escribir `channel_consent` y `notification` en la misma transacción cuando llega `emailConfirmation`
- [X] T039 [US1] Ampliar `src/application/use-cases/confirm-booking.ts`: entrada `emailConsent`, `ChannelSettings`, un segundo token de `TokenGenerator` para la baja, `TokenSealer.seal` y `notificationId` en `ConfirmedBooking`; actualizar el comentario que dice que v1 no envía nada
- [X] T040 [US1] Implementar `withOne(id, fn)` en `src/infrastructure/db/notification-repository.ts`: una transacción, `SELECT … FOR UPDATE SKIP LOCKED` de una fila `PENDING` con su cita (y servicios) y su consentimiento en una consulta, tokens abiertos con el sellador; escribe lo que devuelve `fn` (estado final con `sealed_tokens = NULL`, o el siguiente intento)
- [X] T041 [US1] Implementar `dispatchOne(id)` en `src/application/use-cases/dispatch-notifications.ts`: `decideDelivery` → con `SEND`, `confirmationContent` + render + `Notifier.send(message, id)`; `TRANSIENT` → `nextAttemptAt` o `FAILED`; `PERMANENT` → `FAILED`; `SKIP` → `NOT_SENT` con su motivo; `EXPIRED` → `FAILED`; registra sólo id del envío, id de la cita, estado e intento
- [X] T042 [US1] Cablear `Notifier`, `ChannelSettings`, `TokenSealer`, los repositorios de envíos y consentimientos y `dispatchOne` en `src/app/_lib/container.ts`
- [X] T043 [US1] Leer `emailConsent` en `src/app/(booking)/reservar/actions.ts` y conservarlo en `src/app/(booking)/reservar/form-state.ts`; tras una reserva correcta, programar `after(() => container().dispatchOne(id))` antes del `redirect`
- [X] T044 [US1] Aceptar `emailConsent` con Zod en `src/app/api/appointments/route.ts` y programar `after(dispatchOne)` del mismo modo
- [X] T045 [US1] Añadir la casilla y su ayuda a `src/components/booking-form.tsx`, que sólo se muestra cuando `src/app/(booking)/reservar/page.tsx` indica que el canal de email está encendido
- [X] T046 [US1] Devolver `emailNotifications.active` desde `src/application/use-cases/view-appointment.ts` (el consentimiento se lee en la misma consulta que la cita o con una búsqueda por índice) y serializarlo en `src/app/api/appointments/[token]/route.ts` con `src/app/api/_lib/serializers.ts`
- [X] T047 [US1] Mostrar en `src/app/cita/[token]/page.tsx` el texto de FR-013 cuando hay `nueva=1` y consentimiento vigente, con la dirección del cliente; si no, `saveLinkWarning`
- [X] T048 [US1] Actualizar `specs/001-client-appointment-booking/contracts/http-api.yaml` a la 2.2.0 con `emailConsent` y `emailNotifications` (contracts/http-api-changes.md)

**Checkpoint**: US1 funciona y se prueba sola; todavía no se fusiona (ver Organization)

---

## Phase 4: User Story 2 - Darse de baja del email (Priority: P2)

**Goal**: el cliente se da de baja de los emails de su cita desde el email o desde la pantalla de la cita, sin que la cita cambie

**Independent Test**: desde un email recibido, abrir la vía de baja, confirmar y comprobar que la cita sigue confirmada y el consentimiento queda terminado con su fecha; abrirla sin confirmar no da de baja

### Tests for User Story 2 (escribir primero y verlos fallar)

- [X] T049 [P] [US2] Crear `tests/integration/use-cases/revoke-email-consent.test.ts`: por token de baja y por token de gestión, termina el consentimiento con `UNSUBSCRIBED` y el instante actual; una segunda llamada es inocua y conserva el primer final; funciona con una cita cancelada o pasada; la fila de la cita no cambia; un token inexistente, malformado o de una cita anonimizada → `NOT_FOUND`; un envío `PENDING` acaba después en `NOT_SENT(CONSENT_ENDED)` con `dispatchOne`
- [X] T050 [P] [US2] Crear `tests/contract/unsubscribe.test.ts` y `tests/contract/email-consent.test.ts`: `204` con la baja hecha y ya hecha, `404` con el mismo cuerpo neutro que `GET /api/appointments/{token}`, también al pasar el límite `APPOINTMENT_LOOKUP` (nunca `429`, FR-038 de la 001), y el cuerpo de RFC 8058 aceptado
- [X] T051 [P] [US2] Crear `tests/e2e/us13-unsubscribe.spec.ts`: desde el enlace de baja del email, la página nombra el salón y muestra el botón, y recargarla deja el consentimiento vigente; confirmar muestra «Te has dado de baja» con `role="status"`; volver a abrirla muestra «Ya te habías dado de baja»; la página no muestra datos de la cita; desde la pantalla de la cita, «Dejar de recibir emails» funciona sin JavaScript y la sección desaparece; un token inválido muestra la pantalla neutra; axe a 360, 768 y 1280

### Implementation for User Story 2

- [X] T052 [P] [US2] Implementar `src/infrastructure/db/consent-repository.ts`: `findByUnsubscribeTokenHash` (sólo citas no anonimizadas), `findForAppointment` y `end` (un `UPDATE … WHERE ended_at IS NULL`)
- [X] T053 [US2] Implementar `src/application/use-cases/revoke-email-consent.ts` con `byUnsubscribeToken` y `byManagementToken`, que deciden con `revokeConsent`, y cablear los dos en `src/app/_lib/container.ts`
- [X] T054 [US2] Crear `src/app/baja/[token]/page.tsx` y `src/app/baja/[token]/actions.ts`: el GET muestra el estado inicial o el de ya hecha, la server action da de baja y muestra el estado de hecha; límite `APPOINTMENT_LOOKUP`; token inválido → la pantalla neutra de `src/app/cita/[token]/not-found.tsx`; sólo la maqueta `.page`
- [X] T055 [P] [US2] Crear `src/app/api/unsubscribe/[token]/route.ts` (`POST`, RFC 8058) sobre `byUnsubscribeToken`
- [X] T056 [P] [US2] Crear `src/app/api/appointments/[token]/email-consent/revocation/route.ts` (`POST`) sobre `byManagementToken`
- [X] T057 [US2] Crear `src/components/email-consent-section.tsx` y usarlo en `src/app/cita/[token]/page.tsx`, con la acción de baja en `src/app/cita/[token]/actions.ts`
- [X] T058 [US2] Añadir las dos rutas a `specs/001-client-appointment-booking/contracts/http-api.yaml` 2.2.0

**Checkpoint**: US1 y US2 funcionan juntas y cada una se prueba sola

---

## Phase 5: User Story 3 - El envío nunca pone en riesgo la reserva (Priority: P3)

**Goal**: los envíos que fallan se reintentan durante 1 hora sin afectar a la reserva, nunca se duplican, se descartan si ya no deben salir, y la dueña ve los que fallaron

**Independent Test**: con el proveedor falso caído, reservar con la casilla; la reserva responde como siempre, el envío queda pendiente y sale una sola vez al volver dentro del plazo, o queda fallido y marcado en la agenda si no vuelve

### Tests for User Story 3 (escribir primero y verlos fallar)

- [X] T059 [P] [US3] Ampliar `tests/integration/use-cases/dispatch-notifications.test.ts` con `dispatchDue` y un reloj fijo: un `TRANSIENT` deja el envío `PENDING` con `next_attempt_at` en el calendario; si el proveedor vuelve dentro de la hora, un solo `SENT`; si sigue fallando tras el intento de los 45 min, `FAILED` sin tokens; `PERMANENT` → `FAILED` al momento; cancelada antes de enviarse → `NOT_SENT(APPOINTMENT_CANCELLED)`; reprogramada por el cliente antes de enviarse → el email lleva la hora nueva; una fila que aún no toca no se procesa; **reprogramar o cancelar, por el cliente o por la dueña, nunca crea una segunda fila `notification`** (FR-009)
- [X] T060 [P] [US3] Crear `tests/integration/concurrency/concurrent-dispatch.test.ts`: `dispatchOne` y `dispatchDue` sobre la misma fila a la vez → el falso recibe exactamente un email; una `Idempotency-Key` repetida tras un corte simulado entre la aceptación y la actualización → sigue siendo un email
- [X] T061 [P] [US3] Ampliar `tests/integration/use-cases/edit-appointment-as-owner.test.ts`: cambiar o quitar el email de una cita online termina su consentimiento con `EMAIL_CHANGED` en la misma transacción, y su confirmación pendiente acaba en `NOT_SENT(CONSENT_ENDED)`; editar servicios o el teléfono deja el consentimiento vigente
- [X] T062 [P] [US3] Ampliar `tests/integration/use-cases/purge-expired-personal-data.test.ts`: el barrido nocturno y el borrado de una cita también ponen a `NULL` `unsubscribe_token_hash` y convierten un envío `PENDING` en `NOT_SENT(PERSONAL_DATA_DELETED)` sin tokens, en una sentencia; después el token de baja da `NOT_FOUND`
- [X] T063 [P] [US3] Ampliar `tests/integration/logging/no-pii.test.ts`: una reserva y su envío completos, con el falso en modo `echo`, no registran ni nombre, ni teléfono, ni email, ni asunto, ni cuerpo, ni tokens
- [X] T064 [P] [US3] Crear `tests/unit/domain/notifications/owner-marker.test.ts` para `needsConfirmationCall`: sólo online, confirmada, no terminada y `FAILED`; cancelada, pasada, a mano, `OTHER` o sin confirmación → sin marca
- [X] T065 [P] [US3] Ampliar `tests/contract/owner/agenda.test.ts` y `tests/contract/owner/reservas.test.ts`: `confirmationEmailFailed` presente en cada cita, `true` sólo en el caso de FR-020a, contra `owner-api.yaml` 1.3.0
- [X] T066 [P] [US3] Ampliar `tests/integration/performance/agenda-performance.test.ts` y `tests/integration/performance/booking-list-performance.test.ts`: sigue siendo una consulta por día y por página con envíos presentes
- [X] T067 [P] [US3] Crear `tests/e2e/us14-delivery-failure.spec.ts`: con el falso en modo `fail`, la reserva y su pantalla de confirmación se comportan como siempre; en modo `reject`, la agenda y el listado de la dueña muestran «Confirmación por email no enviada» con icono, texto y un enlace `tel:`; tras cancelar la cita, la marca desaparece; axe en las dos pantallas de la dueña

### Implementation for User Story 3

- [X] T068 [US3] Implementar `withDue(now, limit, fn)` en `src/infrastructure/db/notification-repository.ts` con el índice parcial sobre `next_attempt_at` y `SKIP LOCKED`, una fila por transacción
- [X] T069 [US3] Implementar `dispatchDue(now)` en `src/application/use-cases/dispatch-notifications.ts` con el mismo camino de decisión que `dispatchOne`, devolviendo recuentos por estado final
- [X] T070 [US3] Crear `scripts/dispatch-notifications.ts`: ejecuta `dispatchDue` con el reloj del sistema, registra sólo recuentos e ids y termina con un código distinto de cero ante un error inesperado (como `scripts/retention-purge.ts`)
- [X] T071 [US3] Terminar el consentimiento de email con `EMAIL_CHANGED` en `src/infrastructure/db/owner-appointment-writer.ts` cuando una edición cambia o quita el email, dentro de la transacción de `applyPlan`
- [X] T072 [US3] Reescribir `anonymizeDueBefore` y `anonymizeOne` en `src/infrastructure/db/appointment-repository.ts` como una sentencia con CTE sobre `appointment`, `channel_consent` y `notification` (research D-012)
- [X] T073 [P] [US3] Implementar `needsConfirmationCall` en `src/domain/notifications/owner-marker.ts`
- [X] T074 [US3] Añadir el `LEFT JOIN` a la confirmación por email y `confirmationDelivery` a `findInWindow` en `src/infrastructure/db/appointment-repository.ts` y a `readPage` en `src/infrastructure/db/booking-list-reader.ts`, y el campo a la lectura de `Appointment` de la dueña
- [X] T075 [US3] Decidir la marca en `src/application/use-cases/get-agenda-day.ts` y `src/application/use-cases/list-bookings.ts` con `needsConfirmationCall`, y serializar `confirmationEmailFailed` en `src/app/api/gestion/_lib/serializers.ts`
- [X] T076 [US3] Mostrar la marca con icono, texto, enlace `tel:` y ayuda en `src/components/owner/timeline.tsx` y `src/components/owner/booking-list.tsx`
- [X] T077 [US3] Actualizar `specs/002-salon-management/contracts/owner-api.yaml` a la 1.3.0 con `confirmationEmailFailed`

**Checkpoint**: las tres historias funcionan juntas; la feature está lista para el cierre

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: documentos que cambian, puesta en producción y validación final

- [X] T078 [P] Actualizar `CLAUDE.md`: v1 envía por email la confirmación de la reserva (sin SMS); la base de datos guarda sólo el hash del enlace de gestión, más el token sellado mientras su confirmación está pendiente (research D-002); el contrato vivo del cliente es el 2.2.0; los scripts nuevos `notifications:dispatch` y `email:fake`
- [X] T079 [P] Actualizar `specs/001-client-appointment-booking/spec.md`: FR-015, Assumption 5, Assumption 8 y la entrada de *Out of Scope* sobre el mensaje de confirmación, cada una remitiendo a la 004
- [X] T080 [P] Actualizar `specs/002-salon-management/spec.md`: «v1 sigue sin enviar SMS ni email a nadie» vale para lo que hace la dueña, no para la reserva online; la agenda y el listado muestran la marca de confirmación fallida (004, FR-020a)
- [X] T081 [P] Completar la puesta en producción de `specs/004-notifications/quickstart.md` con el contrato de encargado, el plazo de conservación del proveedor y **cómo se borra en él un envío concreto y en qué plazo** (research D-012); añadir a `specs/001-client-appointment-booking/quickstart.md` la entrada de cron junto a la de la purga y el segundo paso del borrado a petición (borrar el envío en el proveedor), remitiendo a la sección «Borrado de datos a petición» de la 004. No se envía a clientes reales hasta que esté escrito (Principio III)
- [X] T082 [P] Actualizar `README.md` (tabla de features, qué hace la app, checks) y marcar el paso 7 en `docs/roadmap.md` con su resultado y las decisiones de la sesión de clarificación del 2026-11-04
- [X] T083 Revisar el código nuevo (`src/domain/notifications`, `src/infrastructure/notifications`, `src/app/baja`, `scripts/dispatch-notifications.ts`) en busca de cualquier log con datos de contacto o tokens; ni código muerto, ni comentado, ni TODOs
- [X] T084 Ejecutar `npm run test:all`, `npm run lint` y `npm run check:layers`; todo en verde y sin tests saltados
- [X] T085 Hacer la validación manual de `specs/004-notifications/quickstart.md` con la dueña del producto y anotar el resultado en `docs/roadmap.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias
- **Foundational (Phase 2)**: depende de Setup; bloquea todas las historias
- **US1 (Phase 3)**: depende de Foundational
- **US2 (Phase 4)**: depende de Foundational; su e2e necesita un email enviado (US1), pero sus tests de integración y contrato crean el consentimiento directamente
- **US3 (Phase 5)**: depende de Foundational y de `withOne`/`dispatchOne` (T040, T041) de US1
- **Polish (Phase 6)**: depende de las tres historias

### Within Each Phase

- Los tests van primero y deben fallar antes de implementar
- Migración y esquema → dominio → puertos → adaptadores → casos de uso → rutas y pantallas → contrato YAML
- T018 antes que T019; T020 antes que T021; T023 antes que T024–T029; T038–T041 antes que T042–T047; T052 antes que T053; T068 antes que T069–T070; T073 y T074 antes que T075

### Parallel Opportunities

- Setup: T003 y T004
- Foundational: todos los tests T007–T017; después T020, T022, T024 y T026
- US1: T032–T037
- US2: T049–T051; después T055 y T056
- US3: T059–T067; T073 en paralelo con T068
- Polish: T078–T082

---

## Parallel Example: User Story 1

```bash
# Tests de US1, a la vez:
Task: "Ampliar confirm-booking.test.ts con consentimiento, envío y transacción (T032)"
Task: "Crear dispatch-notifications.test.ts con dispatchOne (T033)"
Task: "Ampliar los tests de contrato appointments-create y appointment-detail (T035)"
Task: "Crear us12-confirmation-email.spec.ts (T036)"
```

## Parallel Example: User Story 3

```bash
Task: "dispatchDue con reloj fijo (T059)"
Task: "concurrent-dispatch.test.ts (T060)"
Task: "EMAIL_CHANGED al editar (T061)"
Task: "Purga con un envío pendiente (T062)"
Task: "owner-marker.test.ts (T064)"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 y Phase 2, con el control de T031 en verde
2. Phase 3: US1
3. **Parar y validar**: reservar con el proveedor falso y leer el email
4. No se fusiona todavía: faltan la baja y la fiabilidad (Principio IV)

### Incremental Delivery

1. Setup + Foundational → base lista
2. US1 → email de confirmación
3. US2 → baja desde el email y desde la cita
4. US3 → reintentos, descarte, purga y marca de la dueña
5. Polish → documentos, prueba manual con la dueña y PR a `main`

---

## Notes

- [P] = archivos distintos y sin dependencias pendientes
- Cada commit sigue Conventional Commits; el primero de cada historia es el `test:` que falla
- Canal en las suites (research D-013): la suite e2e corre entera con `NOTIFICATIONS_EMAIL=on`; unitarios, integración y contrato corren con `off`, salvo los archivos que arrancan el proveedor falso
- Nada de datos personales, contenido ni tokens en los logs: los tests de T017 y T063 son la red
