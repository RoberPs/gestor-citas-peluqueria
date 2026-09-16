# Tasks: Gestión del salón (cara a la dueña) v1

**Input**: Design documents from `/specs/002-salon-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: SE INCLUYEN Y NO SON OPCIONALES. `CLAUDE.md` y el Principio II de la constitución imponen TDD: primero un test que falla. En cada fase, las tareas de test preceden a las de implementación y deben estar en rojo antes de escribir el código que las pone en verde.

**Organization**: las tareas se agrupan por historia de usuario. Cada fase es un incremento entregable y verificable por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: la historia a la que pertenece la tarea (US1 … US9)
- Toda descripción lleva la ruta exacta del archivo

## Path Conventions

Proyecto único con arquitectura hexagonal, heredado de `001-client-appointment-booking`: `src/domain`, `src/application`, `src/infrastructure`, `src/app`, `src/components`, `tests/`. Las rutas de abajo son las reales del repositorio.

**Nota sobre el middleware**: [plan.md](./plan.md) lo sitúa en `src/app/middleware.ts`. Next.js sólo reconoce el middleware en `src/middleware.ts` (junto a `app/`, no dentro). Las tareas usan la ruta válida.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dejar el proyecto listo para la feature. Sin lógica de negocio.

- [ ] T001 Elevar el mínimo declarado de `next` a `^15.2.3` en `package.json`, verificar con `npm ls next` que el lockfile resuelve 15.2.3 o superior y actualizar `package-lock.json` (D-018, CVE-2025-29927)
- [ ] T002 [P] Añadir el script `owner:provision` (`tsx scripts/provision-owner.ts`) a `package.json`, junto a `db:seed`
- [ ] T003 [P] Documentar `OWNER_USERNAME` y `OWNER_INITIAL_PASSWORD` en `.env.example`, con la nota de que son de un solo uso y no las lee la aplicación en marcha
- [ ] T004 [P] Parametrizar `tests/contract/helpers/openapi.ts` para que acepte la ruta del contrato en vez de tenerla empotrada, sin duplicar el ayudante (D-028)
- [ ] T005 [P] Actualizar las rutas de tests en `vitest.config.ts` / `package.json` para que `tests/unit/domain/owner/`, `tests/integration/security/` y `tests/integration/concurrency/` entren en las suites correspondientes

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, tipos de dominio y migración de lo que la 001 dejó escrito. Toca código existente y ninguna historia puede construirse encima hasta que esté verde.

**⚠️ CRITICAL**: ninguna historia empieza hasta que esta fase esté completa y `npm run test:all` en verde.

### Tests de la fase fundacional ⚠️ (escribir primero, deben fallar)

- [ ] T006 [P] Test de regresión de la migración 0004 en `tests/integration/db/migration-0004-closures.test.ts`: carga cierres, migra y comprueba que los periodos resultantes cubren exactamente los mismos días, incluido uno en la semana del cambio de hora (data-model.md, "Migración desde `closure`")
- [ ] T007 [P] Test de restricciones nuevas en `tests/integration/db/constraints.test.ts` (ampliar): `CHECK (ends_at > starts_at)` de `unavailable_period`, `EXCLUDE` de `opening_interval`, `CHECK` de rangos de `salon`, `CHECK` de `service`
- [ ] T008 [P] Test de la restricción `appointment_anonymization_is_atomic` reescrita en `tests/integration/db/constraints.test.ts`: cita manual sin email válida, cita manual con `token_hash` rechazada, cita online sin `token_hash` rechazada, anonimizada a medias rechazada (D-026)
- [ ] T009 [P] Test unitario de resta de intervalos en `tests/unit/domain/availability/interval-math.test.ts`: apertura menos ocupados, media abierta `[)`, resultado vacío, solapes parciales y anidados
- [ ] T010 [P] Test unitario en `tests/unit/domain/availability/compute-day.test.ts` (ampliar): los periodos no disponibles entran como ocupados y ningún inicio los pisa (FR-020, BR-002)
- [ ] T011 [P] Test unitario en `tests/unit/domain/availability/compute-range.test.ts` (ampliar): `CLOSED` cuando los periodos cubren toda la apertura, `FULL` cuando queda apertura sin cubrir (D-020)
- [ ] T012 [P] Test unitario en `tests/unit/domain/contact/contact.test.ts` (ampliar): email ausente (`null` o cadena vacía) es contacto válido; nombre y teléfono siguen siendo obligatorios (FR-024, FR-031)
- [ ] T013 [P] Test de integración `tests/integration/use-cases/config-propagation.test.ts`: cambiar un parámetro y comprobar que la siguiente consulta de disponibilidad ya lo usa, sin reiniciar el proceso, contando consultas para que un caché reintroducido lo ponga en rojo (D-021, FR-056)

### Migraciones y esquema

- [ ] T014 Escribir a mano `src/infrastructure/db/migrations/0003_owner_account_and_session.sql`: `owner_account` con su índice único de fila única, `owner_session` con `token_hash` único y `ON DELETE CASCADE`, sin ninguna columna de IP ni de dispositivo (FR-009)
- [ ] T015 Escribir a mano `src/infrastructure/db/migrations/0004_unavailable_period.sql`: crear la tabla, el `CHECK (ends_at > starts_at)`, el índice GiST sobre `tstzrange(starts_at, ends_at, '[)')`, convertir los cierres a instantes en la zona del salón y eliminar `closure` (D-019, D-027)
- [ ] T016 Escribir a mano `src/infrastructure/db/migrations/0005_appointment_origin.sql`: enum `appointment_origin`, columna `origin NOT NULL` con `ONLINE` para lo existente, y reescritura de `appointment_anonymization_is_atomic` (D-026)
- [ ] T017 Escribir a mano `src/infrastructure/db/migrations/0006_editable_configuration.sql`: columnas de política en `salon` con sus `CHECK` de rango y de horas completas, tipo `timerange` y `EXCLUDE` de `opening_interval`, y `CHECK` de `service` (D-022, FR-045, FR-053)
- [ ] T018 Actualizar `src/infrastructure/db/schema.ts`: tablas `owner_account`, `owner_session` y `unavailable_period`, columnas nuevas de `salon` y `appointment`, y retirada de `closure`

### Dominio: lo que cambia de la 001

- [ ] T019 [P] Crear `src/domain/availability/interval-math.ts` con la resta de intervalos, en un solo sitio y con la media abierta `[)` de BR-013 (D-019, D-020)
- [ ] T020 Sustituir `Closure` por `UnavailablePeriod` en `src/domain/catalog/salon.ts` y exponer los dos campos de política que ahora vienen de la base (D-019, D-022)
- [ ] T021 Generalizar `src/domain/availability/compute-day.ts`: `isClosed: boolean` → `unavailablePeriods`, concatenando citas y periodos **antes** de la única comprobación de solape (contracts/domain-api.md)
- [ ] T022 Generalizar `src/domain/availability/compute-range.ts` con la regla `CLOSED`/`FULL` de D-020, apoyándose en `interval-math.ts`
- [ ] T023 [P] Hacer opcional el email en `src/domain/contact/contact.ts`: `CustomerContact.email: string | null` y `validateContact` tratando la ausencia como válida (D-026)
- [ ] T024 Propagar el email opcional por los llamantes que el compilador señale en `src/domain/booking/`, `src/application/use-cases/` y `src/components/`, sin cambiar ningún comportamiento de la cara del cliente

### Infraestructura y puertos

- [ ] T025 Declarar los puertos nuevos en `src/application/ports/index.ts`: `PasswordHasher`, `OwnerAccountRepository`, `OwnerSessionRepository`, `UnavailablePeriodRepository`, `SalonConfigWriter`, `OwnerAppointmentWriter` (contracts/domain-api.md)
- [ ] T026 Retirar el caché de proceso de `src/infrastructure/db/salon-config-repository.ts`, leer la política de la fila `salon` y borrar el comentario que dejó de ser cierto (D-021, D-022)
- [ ] T027 [P] Implementar `src/infrastructure/db/unavailable-period-repository.ts` con `findOverlapping` apoyada en el índice GiST, `insert`, `shorten` y `delete`
- [ ] T028 Añadir `origin` y el email opcional a `src/infrastructure/db/appointment-repository.ts`, y una consulta de las citas de un día con filtro de canceladas (FR-015, D-027)
- [ ] T029 [P] Cargar los festivos como `unavailable_period` de día completo y añadir la comida de un martes en `db/seed/seed.ts`; retirar toda referencia a `closure`
- [ ] T030 [P] Crear el bloque `owner` de textos en `src/messages/es-ES.ts`, con los mensajes comunes de carga, éxito y error accionable (FR-059)
- [ ] T031 Registrar los repositorios y puertos nuevos en `src/app/_lib/container.ts`

**Checkpoint**: `npm run test:all` en verde con los cierres migrados y la configuración leída en vivo. Las historias pueden empezar.

---

## Phase 3: User Story 1 - Entrar en la gestión del salón (Priority: P1) 🎯 MVP

**Goal**: la dueña entra con usuario y contraseña; sin credencial válida ninguna pantalla ni respuesta de gestión revela un solo dato.

**Independent Test**: dos navegaciones —una con credencial válida y otra sin ella— más el barrido de todas las rutas de gestión sin cookie (SC-001).

### Tests de la Historia 1 ⚠️ (escribir primero, deben fallar)

- [ ] T032 [P] [US1] Test unitario del bloqueo en `tests/unit/domain/owner/account.test.ts`: cinco fallos en quince minutos bloquean, la ventana caduca, un acceso correcto durante el bloqueo **no** lo levanta (D-017)
- [ ] T033 [P] [US1] Test unitario de la sesión en `tests/unit/domain/owner/session.test.ts`: viva dentro de 12 h, caducada fuera, `shouldTouchSession` sólo cada 5 min, todo sobre reloj inyectado (D-015)
- [ ] T034 [P] [US1] Test unitario de `scrypt` en `tests/unit/infrastructure/password.test.ts`: formato `scrypt$N$r$p$salt$hash`, verificación correcta e incorrecta, comparación en tiempo constante, rechazo por debajo de 12 caracteres (D-016)
- [ ] T035 [P] [US1] Test de barrido de acceso en `tests/integration/security/access-sweep.test.ts`: enumera **desde el enrutador** todas las rutas de `/gestion` y `/api/gestion` y exige que ninguna, sin cookie, devuelva contenido de gestión (SC-001, D-018, D-029)
- [ ] T036 [P] [US1] Test de indistinguibilidad en `tests/integration/security/sign-in-indistinguishability.test.ts`: código, cuerpo y cabeceras idénticos para usuario inexistente, contraseña incorrecta y cuenta bloqueada, sin `Retry-After` (FR-008, FR-009, D-017)
- [ ] T037 [P] [US1] Test de contrato en `tests/contract/owner/sesion.test.ts` para `POST /gestion/sesion`, `DELETE /gestion/sesion` y `PUT /gestion/cuenta/contrasena` contra `contracts/owner-api.yaml`
- [ ] T038 [P] [US1] Test de integración del caso de uso en `tests/integration/use-cases/sign-in-owner.test.ts` contra PostgreSQL real: contador a cero al acertar, bloqueo persistido entre reinicios simulados
- [ ] T039 [P] [US1] Test de que la contraseña no llega a los logs en `tests/integration/logging/no-pii.test.ts` (ampliar) (FR-010)
- [ ] T040 [P] [US1] E2E en `tests/e2e/us1-access.spec.ts`: acceso válido, acceso sin sesión, mensaje idéntico en los dos fallos, cierre de sesión con Atrás del navegador, más `@axe-core/playwright` sobre el formulario de acceso

### Implementación de la Historia 1

- [ ] T041 [P] [US1] Implementar `src/domain/owner/account.ts`: `LOCKOUT_POLICY`, `evaluateLockout` y `registerFailure`, puras sobre el reloj inyectado
- [ ] T042 [P] [US1] Implementar `src/domain/owner/session.ts`: `SESSION_IDLE_TIMEOUT_HOURS`, `SESSION_TOUCH_INTERVAL_MINUTES`, `isSessionAlive` y `shouldTouchSession`
- [ ] T043 [P] [US1] Implementar `src/infrastructure/security/password.ts` con `scrypt` (`N=2^17, r=8, p=1`, sal de 16 B, `maxmem` elevado), `verify` con `timingSafeEqual` y `verifyDecoy` contra un hash señuelo fijo (D-016, D-017)
- [ ] T044 [P] [US1] Implementar `src/infrastructure/security/session-token.ts`: 32 bytes de CSPRNG y su hash SHA-256, siguiendo el patrón de `token.ts` (D-005, D-015)
- [ ] T045 [US1] Implementar `src/infrastructure/db/owner-account-repository.ts` y `src/infrastructure/db/owner-session-repository.ts` sobre los puertos de T025
- [ ] T046 [US1] Implementar `src/application/use-cases/sign-in-owner.ts`: deriva siempre un hash —señuelo si el usuario no existe o la cuenta está bloqueada— y devuelve `Result` con un único modo de fallo indistinguible (FR-008, FR-009)
- [ ] T047 [P] [US1] Implementar `src/application/use-cases/sign-out-owner.ts`, que **borra** la fila de sesión (FR-006)
- [ ] T048 [P] [US1] Implementar `src/application/use-cases/change-owner-password.ts`: acredita la contraseña actual, exige 12 caracteres y avanza `password_changed_at` (FR-004)
- [ ] T049 [US1] Implementar `src/application/use-cases/authorize-owner-session.ts`: el guardián que resuelve la sesión, refresca `last_seen_at` como mucho cada 5 min y aborta si no hay sesión viva (FR-002, FR-007)
- [ ] T050 [US1] Implementar el envoltorio `requireOwnerSession()` en `src/app/api/gestion/_lib/require-owner-session.ts`, que **todo** handler y toda pantalla de gestión usará (D-018)
- [ ] T051 [US1] Implementar `src/app/api/gestion/sesion/route.ts` (`POST` y `DELETE`) con validación Zod y la cookie `__Host-owner_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sin `Max-Age`)
- [ ] T052 [P] [US1] Implementar `src/app/api/gestion/cuenta/contrasena/route.ts` (`PUT`)
- [ ] T053 [P] [US1] Implementar `src/middleware.ts` que **sólo redirige** a `/gestion/acceso` y no autoriza nada (D-018)
- [ ] T054 [P] [US1] Implementar la pantalla `src/app/gestion/acceso/page.tsx`: formulario accesible a 360 px, mensaje de error único y la indicación de qué hacer si se olvida la contraseña, sin detalles operativos (FR-005)
- [ ] T055 [P] [US1] Implementar la pantalla `src/app/gestion/cuenta/page.tsx` con el cambio de contraseña y el cierre de sesión
- [ ] T056 [P] [US1] Implementar `scripts/provision-owner.ts`: lee el entorno, rechaza contraseñas cortas, avisa cuando sobrescribe, cierra todas las sesiones vivas y no registra la contraseña en ningún log (quickstart.md)
- [ ] T057 [P] [US1] Borrar las sesiones caducadas en `scripts/retention-purge.ts` (data-model.md, "Limpieza")
- [ ] T058 [US1] Añadir los textos de acceso, cuenta y errores de sesión al bloque `owner` de `src/messages/es-ES.ts`

**Checkpoint**: la frontera de acceso está establecida y el barrido de SC-001 pasa. Las historias 2 a 9 pueden construirse encima.

---

## Phase 4: User Story 2 - Ver la agenda del día (Priority: P1)

**Goal**: la dueña ve su día como una línea temporal navegable con citas, periodos y tiempo libre.

**Independent Test**: con citas ya existentes, abrir la agenda y comprobar que las muestra y que la navegación entre días funciona.

### Tests de la Historia 2 ⚠️

- [ ] T059 [P] [US2] Test unitario en `tests/unit/domain/owner/agenda.test.ts`: `entries` ordenadas y sin `FREE` solapado, cita y periodo sí pueden solaparse, `isClosed` según D-020, distinción "sin citas" vs "cerrado" (FR-011, FR-017)
- [ ] T060 [P] [US2] Test unitario de `isPastSlot` en `tests/unit/domain/owner/agenda.test.ts`: el corte es la **hora de fin**; una cita en curso no es pasado (FR-016, BR-009)
- [ ] T061 [P] [US2] Test de contrato en `tests/contract/owner/agenda.test.ts` para `GET /gestion/agenda`
- [ ] T062 [P] [US2] Test de rendimiento en `tests/integration/performance/agenda-performance.test.ts`: número **fijo** de consultas al abrir un día, igual con la base vacía que con las 10.000 citas de `db:seed:history` (SC-010, D-027)
- [ ] T063 [P] [US2] E2E en `tests/e2e/us2-agenda.spec.ts`: tres citas en orden, origen por texto e icono, periodo con su motivo, atajo de hoy, día pasado de sólo lectura, día vacío, más axe

### Implementación de la Historia 2

- [ ] T064 [US2] Implementar `src/domain/owner/agenda.ts`: `buildAgendaDay` e `isPastSlot`, funciones puras apoyadas en `interval-math.ts` (contracts/domain-api.md)
- [ ] T065 [US2] Implementar `src/application/use-cases/get-agenda-day.ts`: tres consultas de coste acotado y el filtro de canceladas según lo que la dueña pidió (FR-015, D-027)
- [ ] T066 [US2] Implementar `src/app/api/gestion/agenda/route.ts` (`GET`) con el guardián de T050, devolviendo la línea temporal completa en una sola respuesta
- [ ] T067 [P] [US2] Implementar `src/components/owner/timeline.tsx` como **lista** semántica, no rejilla absoluta: recorrible con teclado y legible con lector de pantalla (Principio VII)
- [ ] T068 [US2] Implementar la pantalla `src/app/gestion/agenda/page.tsx` con la navegación a cualquier fecha y el atajo de hoy (FR-012)
- [ ] T069 [P] [US2] Añadir a `src/messages/es-ES.ts` los textos de origen de la cita, estado, estado vacío "sin citas" y "cerrado" (FR-013, FR-017)
- [ ] T070 [P] [US2] Extender la redacción de Pino en `src/infrastructure/logging/logger.ts` a los cuerpos de agenda y conflicto, que llevan nombre y teléfono (FR-057)

**Checkpoint**: la agenda sustituye al papel. Historias 1 y 2 funcionan por separado.

---

## Phase 5: User Story 3 - Bloquear y liberar ratos (Priority: P1)

**Goal**: la dueña bloquea un rato o unas vacaciones y los huecos desaparecen para el cliente; al eliminarlo, vuelven.

**Independent Test**: crear un periodo, comprobar en la página pública que los huecos desaparecen, eliminarlo y comprobar que vuelven.

### Tests de la Historia 3 ⚠️

- [ ] T071 [P] [US3] Test de contrato en `tests/contract/owner/periodos.test.ts` para `GET`/`POST /gestion/periodos` y `PATCH`/`DELETE /gestion/periodos/{id}`
- [ ] T072 [P] [US3] Test de integración en `tests/integration/use-cases/manage-unavailable-periods.test.ts`: crear, acortar, eliminar, rechazo de `fin <= inicio` y rechazo de granularidad distinta de 15 min (FR-018, FR-019, FR-023)
- [ ] T073 [P] [US3] Test de integración en `tests/integration/use-cases/get-availability.test.ts` (ampliar): un periodo creado desaparece de la disponibilidad en la consulta siguiente y unas vacaciones se ven `CLOSED`, no `FULL` (SC-003, D-020)
- [ ] T074 [P] [US3] Test de que el motivo **nunca** cruza hacia el cliente en `tests/contract/availability.test.ts` (ampliar) (FR-021, BR-002)
- [ ] T075 [P] [US3] Test de integración del solape parcial en `tests/integration/use-cases/manage-unavailable-periods.test.ts`: un minuto de intersección con una cita confirmada lista la cita y exige confirmación, y **no cancela ninguna** (FR-022, clarificación 2026-09-16)
- [ ] T076 [P] [US3] E2E en `tests/e2e/us3-periods.spec.ts`: bloquear la comida, comprobar en `/` que los inicios desaparecen, eliminarlo y verlos volver, más axe

### Implementación de la Historia 3

- [ ] T077 [US3] Implementar `src/application/use-cases/manage-unavailable-periods.ts`: crear, acortar y eliminar, listando las citas solapadas y exigiendo acuse antes de guardar (FR-022)
- [ ] T078 [P] [US3] Implementar `src/app/api/gestion/periodos/route.ts` (`GET`, `POST`) con validación Zod y el guardián
- [ ] T079 [P] [US3] Implementar `src/app/api/gestion/periodos/[id]/route.ts` (`PATCH`, `DELETE`)
- [ ] T080 [P] [US3] Implementar `src/components/owner/period-form.tsx` con la rejilla de 15 minutos y el motivo interno opcional
- [ ] T081 [US3] Integrar la creación y el borrado de periodos en `src/app/gestion/agenda/page.tsx`, desde la propia línea temporal
- [ ] T082 [P] [US3] Añadir los textos de periodos y de la lista de citas afectadas a `src/messages/es-ES.ts`

**Checkpoint**: el hueco fantasma más frecuente queda resuelto y se nota en la cara del cliente sin reiniciar nada.

---

## Phase 6: User Story 4 - Apuntar una cita a mano (Priority: P1)

**Goal**: la dueña apunta desde la agenda a quien entra sin cita, con las exenciones que le corresponden y sin las que no.

**Independent Test**: crear una cita a mano en un hueco libre y comprobar que aparece en la agenda y que el hueco deja de ofrecerse en la página pública.

### Tests de la Historia 4 ⚠️

- [ ] T083 [P] [US4] Test unitario en `tests/unit/domain/owner/manual-booking.test.ts`, caso por caso de la tabla de D-025: bloquea el pasado, bloquea el cuarto contacto, bloquea la granularidad; **no** objeta antelación, horizonte ni plazo; **avisa** fuera de horario
- [ ] T084 [P] [US4] Test unitario en `tests/unit/domain/owner/conflict.test.ts`: `detectConflicts` con la media abierta `[)`, un minuto de intersección es conflicto, y cada `Conflict` lleva lo necesario para nombrarlo (FR-033, SC-005)
- [ ] T085 [P] [US4] Test de contrato en `tests/contract/owner/citas.test.ts` para `POST /gestion/citas`, incluida la respuesta de conflicto
- [ ] T086 [P] [US4] Test de integración en `tests/integration/use-cases/create-manual-appointment.test.ts`: cita sin email válida, sin nombre o sin teléfono rechazada, cuarta cita del contacto rechazada, sin `token_hash` y con `origin = 'OWNER'`, duración tomada del servicio elegido en el instante de guardar aunque la petición llegue con otra (FR-024, FR-026, FR-027, FR-029)
- [ ] T087 [P] [US4] Test de regresión del origen permanente en `tests/integration/use-cases/create-manual-appointment.test.ts`: reprogramar una cita manual la deja manual (FR-025)
- [ ] T088 [P] [US4] E2E en `tests/e2e/us4-manual-booking.spec.ts`: los seis escenarios de la historia, incluido el aviso de fuera de horario, más axe y la medición de SC-002

### Implementación de la Historia 4

- [ ] T089 [US4] Implementar `src/domain/owner/manual-booking.ts`: `planManualBooking` devolviendo `Result<ManualBookingPlan, ManualBookingBlocker>` con los avisos **dentro** del éxito (D-025)
- [ ] T090 [US4] Implementar `detectConflicts` en `src/domain/owner/conflict.ts`, reutilizando la función `overlaps` existente (contracts/domain-api.md)
- [ ] T091 [US4] Implementar `src/application/use-cases/create-manual-appointment.ts`, apoyándose en el recuento por contacto ya existente y sin tocarlo (D-026)
- [ ] T092 [US4] Implementar `src/app/api/gestion/citas/route.ts` (`POST`) con validación Zod y el guardián
- [ ] T093 [P] [US4] Implementar `src/components/owner/manual-booking-form.tsx`: servicio, hora en rejilla de 15 min, nombre y teléfono obligatorios, email opcional, en cuatro toques desde la agenda (SC-002)
- [ ] T094 [US4] Enganchar el formulario a los huecos de `src/app/gestion/agenda/page.tsx`
- [ ] T095 [P] [US4] Añadir los textos de cita manual, avisos y bloqueos a `src/messages/es-ES.ts`

**Checkpoint**: la agenda pasa a ser fiable y los huecos que se ofrecen online son reales.

---

## Phase 7: User Story 5 - Mover o cancelar una cita desde la agenda (Priority: P1)

**Goal**: la dueña reprograma o cancela cualquier cita, online o manual, desde la agenda.

**Independent Test**: mover una cita a otra hora libre y cancelar otra, comprobando el efecto en la agenda y en la disponibilidad pública.

### Tests de la Historia 5 ⚠️

- [ ] T096 [P] [US5] Test de contrato en `tests/contract/owner/citas-cambios.test.ts` para `POST /gestion/citas/{id}/reprogramacion` y `POST /gestion/citas/{id}/cancelacion`
- [ ] T097 [P] [US5] Test de integración en `tests/integration/use-cases/reschedule-appointment-as-owner.test.ts`: conserva servicio, datos y **enlace de gestión vivo** (FR-039, FR-041)
- [ ] T098 [P] [US5] Test de integración en `tests/integration/use-cases/cancel-appointment-as-owner.test.ts`: la dueña cancela dentro del plazo vedado al cliente, y una cita cancelada no se reactiva ni se mueve (FR-042, BR-007, BR-008)
- [ ] T099 [P] [US5] Test de integración de que ni crear ni mover al pasado es posible, con una cita **en curso** que sí se mueve, en `tests/integration/use-cases/reschedule-appointment-as-owner.test.ts` (FR-030, BR-009)
- [ ] T100 [P] [US5] E2E en `tests/e2e/us5-manage.spec.ts`: mover, cancelar con confirmación explícita que nombra la cita, y el recordatorio de FR-043 con el teléfono a la vista, más axe

### Implementación de la Historia 5

- [ ] T101 [P] [US5] Implementar `src/application/use-cases/reschedule-appointment-as-owner.ts`
- [ ] T102 [P] [US5] Implementar `src/application/use-cases/cancel-appointment-as-owner.ts`
- [ ] T103 [P] [US5] Implementar `src/app/api/gestion/citas/[id]/reprogramacion/route.ts` (`POST`)
- [ ] T104 [P] [US5] Implementar `src/app/api/gestion/citas/[id]/cancelacion/route.ts` (`POST`)
- [ ] T105 [US5] Añadir a `src/app/gestion/agenda/page.tsx` las acciones de mover y cancelar, con confirmación explícita que nombra la cita concreta (FR-040)
- [ ] T106 [P] [US5] Añadir el aviso de "el cliente no recibe ningún aviso" con su teléfono a `src/messages/es-ES.ts` y a la pantalla (FR-043)

**Checkpoint**: todo cambio de última hora se resuelve dentro de la app.

---

## Phase 8: User Story 6 - Resolver un conflicto a la vista (Priority: P1)

**Goal**: el sistema nombra lo que estorba, deja decidir a la dueña y aplica la resolución y el cambio como una sola operación indivisible.

**Independent Test**: intentar crear una cita solapada, comprobar que el aviso nombra la cita en conflicto, que rechazarlo no cambia nada y que resolverlo aplica ambos cambios juntos.

**Depende de**: US4 (`detectConflicts`) y US5 (las mutaciones sobre las que se monta el protocolo de dos pasos).

### Tests de la Historia 6 ⚠️

- [ ] T107 [P] [US6] Test unitario en `tests/unit/domain/owner/conflict.test.ts`: `buildResolutionPlan` devuelve `UNRESOLVED_CONFLICT` si queda una cita sin resolver, `UNKNOWN_TARGET` y `SHORTENING_DOES_NOT_FIT`; **no existe entrada que signifique "mantener ambas"** (FR-034, FR-035)
- [ ] T108 [P] [US6] Test unitario de `computeStateToken` en `tests/unit/domain/owner/conflict.test.ts`: determinista, estable frente al orden y sensible a cualquier cambio (D-024)
- [ ] T109 [P] [US6] Test de integración de atomicidad en `tests/integration/use-cases/resolution-atomicity.test.ts`: provoca un fallo a mitad del plan y comprueba que **ni la cita en conflicto queda cancelada ni la nueva creada** (FR-037, SC-006)
- [ ] T110 [P] [US6] Test de concurrencia real en `tests/integration/concurrency/concurrent-conflict.test.ts`: dos confirmaciones solapadas en dos conexiones; exactamente una prospera y la otra recibe el conflicto **recalculado**, nunca un solape guardado (FR-038, SC-004, D-029)
- [ ] T111 [P] [US6] Test de integración de que una violación `23P01` se traduce a `STATE_CHANGED` en `tests/integration/db/constraints.test.ts` (D-024)
- [ ] T112 [P] [US6] Test de contrato del protocolo de dos pasos en `tests/contract/owner/conflicto.test.ts`: el primer paso es de sólo lectura y el segundo exige `stateToken` y `Resolution`
- [ ] T113 [P] [US6] E2E en `tests/e2e/us6-conflict.spec.ts`: los seis escenarios, más axe sobre el `dialog` modal con foco atrapado, devuelto al abridor y conflicto anunciado en `aria-live` (Principio VII)

### Implementación de la Historia 6

- [ ] T114 [US6] Completar `src/domain/owner/conflict.ts` con `computeStateToken` —con el `hash` inyectado como puerto— y `buildResolutionPlan` con sus tres modos de fallo tipados
- [ ] T115 [US6] Implementar `src/infrastructure/db/owner-appointment-writer.ts`: `applyPlan` que re-detecta el conflicto **dentro** de la transacción, compara el `stateToken` y aplica el plan entero o nada (D-023, D-024)
- [ ] T116 [US6] Integrar el protocolo de dos pasos en los handlers de `src/app/api/gestion/citas/`, `citas/[id]/reprogramacion/` y `periodos/`
- [ ] T117 [US6] Implementar `src/components/owner/conflict-dialog.tsx`: `dialog` modal accesible que nombra cada elemento en conflicto y ofrece **sólo** salidas explícitas (FR-033, FR-034)
- [ ] T118 [P] [US6] Añadir los textos del diálogo de conflicto a `src/messages/es-ES.ts`, con el nombre del cliente en pantalla y **nunca** en el log (FR-057)

**Checkpoint**: las seis historias P1 están completas. La feature es usable de punta a punta; SC-004, SC-005 y SC-006 se cumplen.

---

## Phase 9: User Story 7 - Ajustar horario y ausencias (Priority: P2)

**Goal**: la dueña edita los tramos de apertura de cada día de la semana y los huecos del cliente se ajustan solos.

**Independent Test**: editar el horario de un día de la semana y comprobar en la página pública que los huecos de ese día cambian en consecuencia.

### Tests de la Historia 7 ⚠️

- [ ] T119 [P] [US7] Test unitario en `tests/unit/domain/catalog/schedule-edit.test.ts`: `END_NOT_AFTER_START` y `OVERLAPPING_STRETCHES` con índice, lista vacía válida como día cerrado (FR-045, FR-046)
- [ ] T120 [P] [US7] Test unitario de `appointmentsOutsideSchedule` en `tests/unit/domain/catalog/schedule-edit.test.ts`: lista las citas que no caben y **no** las cancela ni impide el cambio (FR-047, BR-004)
- [ ] T121 [P] [US7] Test de contrato en `tests/contract/owner/horario.test.ts` para `GET /gestion/horario` y `PUT /gestion/horario/{weekday}`
- [ ] T122 [P] [US7] Test de integración en `tests/integration/use-cases/update-weekly-schedule.test.ts`: el reemplazo del día es transaccional, el parón de mediodía impide servicios a caballo entre tramos y reducir el horario deja las citas intactas (US7-1, US7-3)
- [ ] T123 [P] [US7] E2E en `tests/e2e/us7-schedule.spec.ts`: los cinco escenarios, más axe

### Implementación de la Historia 7

- [ ] T124 [US7] Implementar `src/domain/catalog/schedule-edit.ts`: `validateDaySchedule` y `appointmentsOutsideSchedule`
- [ ] T125 [US7] Implementar `replaceDaySchedule` en `src/infrastructure/db/salon-config-writer.ts`, borrando e insertando en una sola transacción
- [ ] T126 [US7] Implementar `src/application/use-cases/update-weekly-schedule.ts`, devolviendo la lista de citas que quedan fuera antes de guardar
- [ ] T127 [P] [US7] Implementar `src/app/api/gestion/horario/route.ts` (`GET`) y `src/app/api/gestion/horario/[weekday]/route.ts` (`PUT`)
- [ ] T128 [P] [US7] Implementar `src/components/owner/schedule-editor.tsx` con varios tramos por día y errores que dicen cuál y dónde
- [ ] T129 [US7] Implementar la pantalla `src/app/gestion/horario/page.tsx` (SC-012: sin ayuda ni documentación, al primer intento)
- [ ] T130 [P] [US7] Añadir los textos de horario y de rechazo de tramos a `src/messages/es-ES.ts`

**Checkpoint**: el horario deja de ser dato de arranque.

---

## Phase 10: User Story 8 - Mantener el catálogo de servicios (Priority: P2)

**Goal**: la dueña añade, corrige, reordena, retira y reactiva servicios sin tocar ninguna cita existente.

**Independent Test**: añadir un servicio y comprobar que es seleccionable de inmediato en la página pública y que sus huecos se calculan con la duración indicada.

### Tests de la Historia 8 ⚠️

- [ ] T131 [P] [US8] Test unitario en `tests/unit/domain/catalog/service-edit.test.ts`: `EMPTY_NAME`, `NON_POSITIVE_DURATION`, `NEGATIVE_PRICE` y `canRetireService` con `LAST_ACTIVE_SERVICE` (FR-051, FR-053)
- [ ] T132 [P] [US8] Test de contrato en `tests/contract/owner/servicios.test.ts` para `GET`/`POST /gestion/servicios`, `PATCH /gestion/servicios/{id}` (incluido que acepta y persiste un `displayOrder` nuevo, FR-049) y `PUT /gestion/servicios/{id}/activo`
- [ ] T133 [P] [US8] Test de regresión en `tests/integration/use-cases/config-change-preserves-appointments.test.ts` (ampliar): retirar un servicio deja el 100 % de sus citas futuras intactas en fecha, hora, duración, precio y estado (SC-008, BR-003)
- [ ] T134 [P] [US8] Test de regresión del snapshot congelado: cambiar la duración de 45 a 60 min no toca las citas ya confirmadas (FR-052, US8-5)
- [ ] T135 [P] [US8] Test de integración de la retirada concurrente en `tests/integration/use-cases/manage-services.test.ts`: dos retiradas simultáneas no dejan el catálogo vacío, porque el recuento va **dentro** de la transacción (FR-051)
- [ ] T136 [P] [US8] Test unitario en `tests/unit/domain/booking/confirm.test.ts` (ampliar): `SERVICE_UNAVAILABLE` cuando el servicio se retiró mientras el cliente rellenaba, sin dejar la cita a medias (US8-6)
- [ ] T137 [P] [US8] E2E en `tests/e2e/us8-services.spec.ts`: los seis escenarios —incluido SC-007, servicio nuevo seleccionable de inmediato—, más axe

### Implementación de la Historia 8

- [ ] T138 [P] [US8] Implementar `src/domain/catalog/service-edit.ts`: `validateService` y `canRetireService`
- [ ] T139 [US8] Añadir `SERVICE_UNAVAILABLE` a `ConfirmBookingError` en `src/domain/booking/confirm.ts` y comprobar el catálogo activo **en el instante de confirmar**
- [ ] T140 [US8] Propagar el modo de fallo nuevo por `src/application/use-cases/confirm-booking.ts`, `src/app/reservar/` y `src/app/api/appointments/route.ts`
- [ ] T141 [US8] Implementar `createService`, `updateService` y `setServiceActive` en `src/infrastructure/db/salon-config-writer.ts`, con el recuento de activos dentro de la misma transacción
- [ ] T142 [US8] Implementar `src/application/use-cases/manage-services.ts`
- [ ] T143 [P] [US8] Implementar `src/app/api/gestion/servicios/route.ts`, `src/app/api/gestion/servicios/[id]/route.ts` y `src/app/api/gestion/servicios/[id]/activo/route.ts`
- [ ] T144 [P] [US8] Implementar `src/components/owner/service-list.tsx` con el orden de presentación editable
- [ ] T145 [US8] Implementar la pantalla `src/app/gestion/servicios/page.tsx`
- [ ] T146 [P] [US8] Añadir los textos de catálogo, incluido el de "el salón se quedaría sin nada que reservar", a `src/messages/es-ES.ts`

**Checkpoint**: el catálogo es editable en vivo y ninguna cita existente se ve afectada.

---

## Phase 11: User Story 9 - Ajustar los parámetros de reserva (Priority: P2)

**Goal**: la dueña edita la antelación mínima y el plazo de cancelación dentro de sus rangos, y rigen desde la siguiente acción del cliente.

**Independent Test**: cambiar la antelación mínima y comprobar que un intento de reserva por debajo del nuevo valor se rechaza.

### Tests de la Historia 9 ⚠️

- [ ] T147 [P] [US9] Test unitario en `tests/unit/domain/catalog/booking-params.test.ts`: `BOOKING_PARAMETER_LIMITS` como único origen, y el error **lleva los límites dentro** (FR-054)
- [ ] T148 [P] [US9] Test de contrato en `tests/contract/owner/parametros.test.ts` para `GET` y `PUT /gestion/parametros`, comprobando que la respuesta expone los límites del dominio
- [ ] T149 [P] [US9] Test de integración en `tests/integration/use-cases/update-booking-parameters.test.ts`: subir la antelación rige en la consulta siguiente; endurecer el plazo saca de plazo a una cita que estaba dentro, sin deshacer ninguna cancelación ya hecha (FR-055, BR-006, SC-009, US9-2, US9-3)
- [ ] T150 [P] [US9] E2E en `tests/e2e/us9-parameters.spec.ts`: los cuatro escenarios, con el mensaje de rango que no reescribe los límites, más axe

### Implementación de la Historia 9

- [ ] T151 [US9] Implementar `src/domain/catalog/booking-params.ts`: `BOOKING_PARAMETER_LIMITS` y `validateBookingParameters`
- [ ] T152 [US9] Implementar `updateBookingParameters` en `src/infrastructure/db/salon-config-writer.ts`
- [ ] T153 [US9] Implementar `src/application/use-cases/update-booking-parameters.ts`
- [ ] T154 [US9] Implementar `src/app/api/gestion/parametros/route.ts` (`GET`, `PUT`), sirviendo los límites desde el dominio
- [ ] T155 [US9] Implementar la pantalla `src/app/gestion/parametros/page.tsx`, que **recibe** los límites y no los reescribe (Principio I)
- [ ] T156 [P] [US9] Añadir los textos de parámetros a `src/messages/es-ES.ts`

**Checkpoint**: las nueve historias están completas.

---

## Phase 12: Polish & Cross-Cutting Concerns

- [ ] T157 [P] Auditoría de accesibilidad de las seis pantallas y del diálogo de conflicto en `tests/e2e/accessibility.spec.ts` (ampliar), sin ninguna incidencia AA y operable íntegramente con teclado (SC-011)
- [ ] T158 [P] Barrido manual de PII en los logs siguiendo `quickstart.md`, y ampliación de `tests/integration/logging/no-pii.test.ts` con los cuerpos de agenda y conflicto (FR-057)
- [ ] T159 [P] Revisar que ningún texto de gestión vive fuera de `src/messages/es-ES.ts` con un test en `tests/unit/messages/actionable-errors.test.ts` (ampliar)
- [ ] T160 [P] Actualizar `CLAUDE.md`: los cierres pasan a periodos no disponibles, la configuración deja de ser precargada y aparece `owner:provision`
- [ ] T161 [P] Actualizar `specs/README.md` con el estado de la feature 002
- [ ] T162 Verificar el despliegue según `quickstart.md`: aprovisionar, retirar `OWNER_INITIAL_PASSWORD` del entorno y comprobar que la cookie `__Host-` exige HTTPS
- [ ] T163 Ejecutar `npm run test:all`, `npm run lint` y `npm run check:layers` en verde, con cero tests saltados
- [ ] T164 Recorrer los 18 pasos de la comprobación rápida de `quickstart.md` a mano

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de la Fase 1. **Bloquea todas las historias.**
- **US1 (Fase 3)**: depende de la Fase 2. **Bloquea US2 … US9**, porque entrega `requireOwnerSession()`, sin el cual ninguna pantalla ni handler de gestión puede existir sin filtrar datos (FR-002).
- **US2**: depende de US1. Es la historia que crea `src/app/gestion/agenda/page.tsx` (T068). US3, US4 y US5
  se integran **dentro** de esa página, así que no pueden cerrarse hasta que T068 exista.
- **US3**: depende de US1. Su dominio, casos de uso, rutas y componente (T077-T080) son independientes de
  US2, pero **T081 requiere que T068 (US2) exista**: integra la creación y el borrado de periodos en la
  propia línea temporal.
- **US7, US8, US9**: dependen de US1 y son independientes entre sí y de US2 — tienen pantalla propia
  (`horario/page.tsx`, `servicios/page.tsx`, `parametros/page.tsx`) y no tocan `agenda/page.tsx`.
- **US4**: depende de US1. Su dominio, casos de uso y ruta (T089-T092) son independientes de US2, pero
  **T094 requiere que T068 (US2) exista**: engancha el formulario a los huecos de la línea temporal.
- **US5**: depende de US1 y de US2 (T068), por la misma razón: **T105 requiere que T068 exista**, porque
  añade las acciones de mover y cancelar a la propia línea temporal.
- **US6**: depende de US4 (`detectConflicts`) y de US5 (las mutaciones sobre las que monta el protocolo de dos pasos). Es la única dependencia entre historias que no se puede evitar: el protocolo de conflicto no tiene sentido sin una mutación que proteger.
- **Polish (Fase 12)**: depende de todas las historias que se quieran entregar.

### Within Each User Story

- Los tests se escriben primero y **deben fallar** antes de implementar. TDD no es negociable.
- Dominio → puertos → infraestructura → casos de uso → handlers → pantallas.
- Los textos de `src/messages/es-ES.ts` se tocan al final de cada historia, porque es un archivo compartido y varias tareas `[P]` chocarían en él.

### Parallel Opportunities

- Fase 1: T002, T003, T004 y T005 en paralelo.
- Fase 2: los ocho tests T006–T013 en paralelo; después las cuatro migraciones **en serie**, por orden.
- En cada historia, todos los tests marcados `[P]` se escriben a la vez.
- Con equipo: una vez cerrada US1, US7, US8 y US9 pueden repartirse entre personas distintas de inmediato.
  El dominio, los casos de uso, las rutas y los componentes de US3, US4 y US5 también pueden avanzar en
  paralelo desde el principio, pero T081, T094 y T105 —las tareas que tocan `agenda/page.tsx`— quedan
  bloqueadas hasta que T068 (US2) esté hecho.

---

## Parallel Example: User Story 1

```bash
# Los tests de la Historia 1, todos a la vez:
Task: "Test unitario del bloqueo en tests/unit/domain/owner/account.test.ts"
Task: "Test unitario de la sesión en tests/unit/domain/owner/session.test.ts"
Task: "Test de scrypt en tests/unit/infrastructure/password.test.ts"
Task: "Barrido de acceso en tests/integration/security/access-sweep.test.ts"
Task: "Indistinguibilidad en tests/integration/security/sign-in-indistinguishability.test.ts"

# Y después, el dominio puro y los adaptadores, que no se pisan:
Task: "Implementar src/domain/owner/account.ts"
Task: "Implementar src/domain/owner/session.ts"
Task: "Implementar src/infrastructure/security/password.ts"
Task: "Implementar src/infrastructure/security/session-token.ts"
```

---

## Implementation Strategy

### MVP First

El MVP de esta feature **no es una sola historia**: es US1 más US2. Un acceso privado que no enseña nada no sustituye al papel, y una agenda sin frontera de acceso viola FR-002. El corte mínimo desplegable es:

1. Fase 1: Setup
2. Fase 2: Foundational (crítica — bloquea todo)
3. Fase 3: US1 — la frontera de acceso, con el barrido de SC-001 en verde
4. Fase 4: US2 — la agenda del día
5. **PARAR Y VALIDAR**: la dueña ve su día y nadie más lo ve.

### Incremental Delivery

1. Setup + Foundational → los cierres migrados y la configuración editable en vivo
2. US1 + US2 → MVP desplegable
3. US3 → el hueco fantasma resuelto
4. US4 + US5 + US6 → la gestión manual completa, con la garantía de no-superposición intacta
5. US7 + US8 + US9 → la autonomía de configuración
6. Fase 12 → pulido y validación final

### Riesgos a vigilar

- **La Fase 2 toca código en verde de la 001.** Cada línea de la tabla "Lo que esta feature modifica de la 001" de [plan.md](./plan.md) es trabajo de migración con su test de regresión, no un ajuste de paso.
- **La migración 0004 es la única que convierte datos y la única que borra una tabla.** Su test es innegociable.
- **La migración 0006 impone el `EXCLUDE` de `opening_interval` sobre datos ya cargados.** Si falla, falla ahí y no a medio camino: es el comportamiento correcto.
- **El diálogo de conflicto es el punto de mayor riesgo de PII en logs** y el de mayor riesgo de trampa de foco. Recibe atención doble: T070, T118, T113 y T158.

---

## Notes

- Las tareas `[P]` tocan archivos distintos y no dependen de nada pendiente.
- Toda función pública de dominio devuelve `Result<T, E>` con sus fallos tipados. Sin excepciones para flujo de control.
- Código, identificadores y commits en inglés; textos de producto en español, todos en `src/messages/es-ES.ts`.
- Commit por tarea o por grupo lógico, en Conventional Commits.
- Nada de código muerto, comentado ni TODOs en `main`. Cero tests saltados.
