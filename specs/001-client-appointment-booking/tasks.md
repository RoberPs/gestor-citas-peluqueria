---
description: "Task list for feature 001-client-appointment-booking"
---

# Tasks: Reserva de citas de peluquería (cara al cliente) v1

**Input**: Design documents from `/specs/001-client-appointment-booking/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-api.yaml](./contracts/http-api.yaml), [contracts/domain-api.md](./contracts/domain-api.md), [quickstart.md](./quickstart.md)

**Tests**: **INCLUIDOS Y OBLIGATORIOS.** El Principio II de la constitución declara el TDD no negociable: debe existir un test que falla antes de escribir código de producción. Cada tarea de implementación va precedida de su test.

**Organization**: las tareas se agrupan por historia de usuario para poder implementarlas y probarlas de forma independiente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: historia de usuario a la que pertenece (US1…US6)
- Toda descripción incluye la ruta exacta del archivo

## Path Conventions

Proyecto único Next.js con arquitectura hexagonal (plan.md → *Structure Decision*):

- `src/domain/` — TypeScript puro, sin framework ni base de datos
- `src/application/` — puertos y casos de uso
- `src/infrastructure/` — adaptadores (Drizzle, Pino, crypto, reloj)
- `src/app/` — App Router: pantallas y Route Handlers
- `src/components/`, `src/messages/`
- `tests/unit/`, `tests/integration/`, `tests/contract/`, `tests/e2e/`
- `db/seed/`, `scripts/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dejar el repositorio listo para que el primer test pueda fallar.

- [X] T001 Inicializar el proyecto Next.js 15 + React 19 + TypeScript 5.7 creando `package.json`, `next.config.ts` y `tsconfig.json` con `strict: true`, `noUncheckedIndexedAccess: true` y alias `@/*` → `src/*`, e instalar las dependencias de ejecución —`@js-temporal/polyfill`, `drizzle-orm`, `drizzle-kit`, `pg`, `zod@3` y `pino`— y las de desarrollo que las tareas T004-T008 dan por instaladas: `typescript`, `tsx`, `eslint`, `prettier`, `dependency-cruiser`, `vitest`, `@playwright/test` y `@axe-core/playwright`
- [X] T002 [P] Crear `docker-compose.yml` con los servicios `db` y `db-test` (PostgreSQL 16, puertos distintos, volúmenes separados)
- [X] T003 [P] Crear `.env.example` sin valores (`DATABASE_URL`, `DATABASE_URL_TEST`, `SALON_TIMEZONE`, `RATE_LIMIT_SECRET`, `TRUSTED_PROXY_IPS`, `PUBLIC_BASE_URL`) y `.gitignore` con `.env`, `node_modules`, `.next`
- [X] T004 [P] Configurar ESLint y Prettier en `eslint.config.mjs` y `.prettierrc` con las reglas de TypeScript estricto del proyecto
- [X] T005 [P] Configurar la verificación de la frontera de capas en `.dependency-cruiser.cjs`: falla si cualquier archivo de `src/domain` importa `react`, `next`, `drizzle-orm`, `pg` o `src/infrastructure`
- [X] T006 [P] Configurar Vitest en `vitest.config.ts` (unitarios), `vitest.integration.config.ts` y `vitest.contract.config.ts` (ambos contra `DATABASE_URL_TEST`)
- [X] T007 [P] Configurar Playwright en `playwright.config.ts` con viewport de 360 px y `@axe-core/playwright` instalado
- [X] T008 Añadir a `package.json` los scripts `dev`, `db:migrate`, `db:seed`, `db:seed:history`, `test`, `test:integration`, `test:contract`, `test:e2e`, `test:all`, `lint`, `check:layers` y `retention:purge`
- [X] T009 [P] Crear `src/messages/es-ES.ts` con la estructura vacía del catálogo de textos (único lugar donde vivirán los textos de interfaz)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: dominio compartido, esquema de base de datos con sus garantías, puertos y adaptadores que todas las historias necesitan.

**⚠️ CRITICAL**: ninguna historia de usuario puede empezar hasta terminar esta fase.

### Núcleo del dominio compartido

- [X] T010 [P] Escribir el test unitario de `Result<T, E>` y sus constructores en `tests/unit/domain/shared/result.test.ts`
- [X] T011 Implementar `Result<T, E>`, `ok()` y `err()` en `src/domain/shared/result.ts`
- [X] T012 [P] Escribir el test unitario de `SalonTime` en `tests/unit/domain/shared/time.test.ts`: conversión instante ↔ hora de pared del salón, suma de minutos reales atravesando el cambio de horario de octubre, y formateo `HH:mm`
- [X] T013 Implementar `SalonTime` sobre `Temporal.ZonedDateTime` en `src/domain/shared/time.ts` y declarar el puerto `Clock` en `src/domain/shared/clock.ts`
- [X] T014 [P] Declarar los tipos de configuración del dominio en `src/domain/catalog/service.ts` (`Service`, `ServiceSnapshot`) y `src/domain/catalog/salon.ts` (`Salon`, `OpeningInterval`, `Closure`, `WeeklySchedule`, `SalonConfiguration`, `BookingPolicy` con antelación 2 h, plazo 24 h, horizonte 60 días, rango 14 días, rejilla 30 min)
- [X] T015 [P] Escribir el test unitario de formato de contacto en `tests/unit/domain/contact/contact.test.ts`: móvil y fijo españoles, prefijo `+34`/`0034` opcional, espacios/guiones/puntos tolerados, normalización a E.164, email en minúsculas, nombre de 1 a 100 caracteres, y los tres casos de rechazo
- [X] T016 Implementar `normalizePhone`, `normalizeEmail` y `validateName` en `src/domain/contact/contact.ts`
- [X] T017 [P] Declarar los tipos `Appointment`, `AppointmentStatus`, `AppointmentView`, `CustomerContact`, `BusyInterval`, `Slot`, `RangeDay` y `DayStatus` en `src/domain/booking/appointment.ts` según data-model.md

### Base de datos y sus garantías

- [X] T018 Implementar el runner de migraciones SQL a mano en `scripts/migrate.ts`, que aplica en orden los archivos de `src/infrastructure/db/migrations/`
- [X] T019 Implementar el harness de tests contra PostgreSQL real en `tests/integration/helpers/test-db.ts`: aplica migraciones sobre `db-test` y trunca las tablas entre tests. **No es ejecutable hasta T022**, que es cuando existen las migraciones que aplica; se da por válido al cerrar T022. El orden TDD se conserva igual: T020 escribe el test de restricciones y falla antes de T021-T022
- [X] T020 Escribir el test de integración de las restricciones de tabla en `tests/integration/db/constraints.test.ts`: dos citas `CONFIRMED` solapadas fallan con `23P01`, dos consecutivas `[)` entran, `appointment_positive_duration`, `appointment_cancelled_consistency` y `appointment_anonymization_is_atomic` rechazan sus estados inválidos
- [X] T021 Escribir la migración `src/infrastructure/db/migrations/0001_initial.sql`: `CREATE EXTENSION btree_gist`, enum `appointment_status`, tablas `salon` (con restricción de fila única), `opening_interval`, `closure`, `service` y `appointment`
- [X] T022 Escribir la migración `src/infrastructure/db/migrations/0002_constraints_and_indexes.sql` con las cuatro restricciones y los cinco índices parciales de data-model.md
- [X] T023 Definir el esquema Drizzle de las cinco tablas en `src/infrastructure/db/schema.ts` y el pool de conexión en `src/infrastructure/db/client.ts`
- [X] T024 [P] Implementar el seed de configuración en `db/seed/seed.ts`: salón con `Europe/Madrid`, horario L–V 10:00–20:00, sábado 10:00–14:00 y 16:00–20:00, domingo sin tramos, servicios Corte (30 min, 1800), Color (90 min, 5500) y Peinado (45 min, 2500), y un cierre dentro de los próximos 14 días

### Puertos y adaptadores

- [X] T025 [P] Declarar los puertos `AppointmentRepository`, `SalonConfigRepository`, `TokenGenerator` y `RateLimiter` en `src/application/ports/index.ts` con las firmas de contracts/domain-api.md
- [X] T026 [P] Escribir el test unitario de redacción de PII en `tests/unit/infrastructure/logger-redaction.test.ts`: una traza de error que reciba `name`, `phone`, `email` y el token no los emite en ningún campo de la salida
- [X] T027 Implementar el logger Pino con `redact` sobre esas cuatro claves en `src/infrastructure/logging/logger.ts`
- [X] T028 [P] Escribir el test unitario del generador de tokens en `tests/unit/infrastructure/token.test.ts`: 43 caracteres base64url, alfabeto `[A-Za-z0-9_-]`, hash SHA-256 estable de 32 bytes, y 10.000 generaciones sin colisión
- [X] T029 Implementar `generate()` y `hash()` con `crypto.randomBytes` en `src/infrastructure/security/token.ts`
- [X] T030 [P] Escribir el test unitario del limitador en `tests/unit/infrastructure/rate-limiter.test.ts`: ventana deslizante de 30/10 min y 5/h + 15/24 h, clave por HMAC no reversible, expiración al cerrar la ventana, que `check()` devuelve sólo `allowed`, y que el contador **agregado** de rechazos por bucket sube sin registrar ninguna clave ni IP (FR-040)
- [X] T031 Implementar el limitador en memoria con HMAC-SHA256 en `src/infrastructure/security/rate-limiter.ts`, más el contador agregado de rechazos por bucket que exige FR-040. El secreto se lee de `RATE_LIMIT_SECRET` y es **fijo durante la vida del proceso**: no se rota en caliente, porque rotarlo reasignaría las claves y reiniciaría en silencio todas las ventanas vivas, que es justo lo que un abusador querría. Se rota reiniciando el proceso. Al vivir en memoria, **exige un solo worker de aplicación por salón**: el despliegue debe garantizarlo
- [X] T032 [P] Implementar el reloj del sistema en `src/infrastructure/time/system-clock.ts`
- [X] T033 [P] Escribir el test de integración del repositorio de citas en `tests/integration/repositories/appointment-repository.test.ts`, cubriendo los seis métodos del puerto y la traducción de `23P01` a `SLOT_TAKEN`
- [X] T034 Implementar `src/infrastructure/db/appointment-repository.ts` y `src/infrastructure/db/salon-config-repository.ts` (este último con caché en memoria de la configuración)

### Frontera HTTP y presentación base

- [X] T035 Implementar la lectura y validación de variables de entorno con Zod en `src/infrastructure/config/env.ts`, incluida la resolución de la IP del cliente desde `X-Forwarded-For` sólo si la petición viene de `TRUSTED_PROXY_IPS`, y `PUBLIC_BASE_URL`, que es la base con la que se construye el **enlace de gestión absoluto** que el cliente debe guardar (FR-015): tiene que ser absoluto porque su única entrega es la pantalla de confirmación
- [X] T036 Implementar los helpers de respuesta HTTP en `src/app/api/_lib/responses.ts`: forma común `Error` con `code`, `message` y `nextAction` obligatorio, y la respuesta neutra `APPOINTMENT_NOT_FOUND` con cuerpo y cabeceras idénticos
- [X] T037 Crear el layout raíz y los estilos base mobile-first a 360 px con contraste AA en `src/app/layout.tsx` y `src/app/globals.css`

**Checkpoint**: base lista — las historias de usuario pueden empezar.

---

## Phase 3: User Story 1 - Ver huecos realmente libres (Priority: P1) 🎯 MVP

**Goal**: el cliente ve el catálogo, elige un servicio, ve el estado de 14 días y los huecos del día seleccionado. Todo hueco mostrado es reservable de verdad.

**Independent Test**: con el seed cargado y un conjunto de citas precargadas, abrir la pantalla y comprobar, para cada hora mostrada y cada hora omitida, que la decisión es correcta — sin reservar nada.

### Tests for User Story 1 ⚠️

> **Escribir estos tests PRIMERO y comprobar que FALLAN antes de implementar.**

- [X] T038 [P] [US1] Test unitario de la rejilla de inicios en `tests/unit/domain/availability/slot-grid.test.ts`: 30 minutos anclados a la hora en punto, recorriendo cada tramo por separado (FR-004)
- [X] T039 [P] [US1] Test unitario de `computeDaySlots` en `tests/unit/domain/availability/compute-day.test.ts`, cubriendo los escenarios 1–5 de la Historia 1, el cierre de mediodía (las 13:00 no se ofrecen para 90 min), el solape semiabierto de BR-013, el horizonte de BR-011 y `currentAppointmentStart` de FR-027
- [X] T040 [P] [US1] Test unitario de `computeRangeDays` en `tests/unit/domain/availability/compute-range.test.ts`: `CLOSED` nunca se confunde con `FULL`, recorte del último rango al día 60, recálculo al cambiar de servicio y cambio de horario estacional dentro del horizonte
- [X] T041 [P] [US1] Test unitario de `findNextAvailableDate` en `tests/unit/domain/availability/next-available.test.ts`: salto a un día de un rango posterior, rango entero sin disponibilidad, y `null` al agotar el horizonte
- [X] T042 [P] [US1] Test de integración del caso de uso en `tests/integration/use-cases/get-availability.test.ts`: la carga de un rango dispara **una sola** consulta de citas (espía sobre el pool), y el tiempo no se degrada con 10.000 citas pasadas (SC-005)
- [X] T043 [P] [US1] Test de contrato de `GET /api/services` en `tests/contract/services.test.ts` contra `contracts/http-api.yaml`
- [X] T044 [P] [US1] Test de contrato de `GET /api/availability` en `tests/contract/availability.test.ts`: forma de `AvailabilityResponse`, `canGoBack`/`canGoForward` en los extremos, y `400` para servicio inexistente o rango fuera de límites
- [X] T045 [P] [US1] Test e2e de la Historia 1 con axe en `tests/e2e/us1-availability.spec.ts`: recorrido de los diez escenarios de aceptación a 360 px, sin violaciones WCAG 2.2 AA

### Implementation for User Story 1

- [X] T046 [US1] Implementar la generación de inicios candidatos en `src/domain/availability/slot-grid.ts`
- [X] T047 [US1] Implementar `computeDaySlots` con las cuatro condiciones de FR-003 en `src/domain/availability/compute-day.ts`
- [X] T048 [US1] Implementar `computeRangeDays` en `src/domain/availability/compute-range.ts`
- [X] T049 [US1] Implementar `findNextAvailableDate` en `src/domain/availability/next-available.ts`
- [X] T050 [P] [US1] Implementar el caso de uso `listServices` en `src/application/use-cases/list-services.ts`
- [X] T051 [US1] Implementar el caso de uso `getAvailability` en `src/application/use-cases/get-availability.ts`, cargando el horizonte completo con una sola llamada a `findConfirmedInWindow`
- [X] T052 [P] [US1] Implementar el Route Handler `GET /api/services` en `src/app/api/services/route.ts`
- [X] T053 [US1] Implementar el Route Handler `GET /api/availability` en `src/app/api/availability/route.ts`, validando `serviceId`, `rangeStart` y `selectedDate` con Zod
- [X] T054 [P] [US1] Implementar el componente de catálogo en `src/components/service-picker.tsx` con nombre, duración y precio de cada servicio
- [X] T055 [P] [US1] Implementar la rejilla de días en `src/components/day-range-picker.tsx` según D-014: botones semánticos, estado por texto + icono (`—`, `×`, `•`) + color, `aria-disabled` enfocable en cerrados y llenos, `aria-current="date"` en el seleccionado
- [X] T056 [P] [US1] Implementar la lista de huecos en `src/components/slot-list.tsx` con región `aria-live="polite"` y el aviso de día sin disponibilidad con salto al siguiente día
- [X] T057 [US1] Implementar la pantalla de reserva en `src/app/page.tsx`, renderizada en servidor y conservando el servicio seleccionado al cambiar de día o de rango
- [X] T058 [US1] Añadir los textos de la Historia 1 en `src/messages/es-ES.ts`, incluido el aviso de que las horas son las del salón (FR-033)

**Checkpoint**: US1 funciona y se puede probar sola. El cliente ya puede consultar disponibilidad sin llamar.

---

## Phase 4: User Story 2 - Confirmar la cita (Priority: P1)

**Goal**: el cliente rellena tres datos y confirma; el hueco queda reservado y deja de ofrecerse.

**Independent Test**: sobre disponibilidad precargada, elegir un hueco, rellenar los tres campos, confirmar y verificar que la cita existe y que el hueco ya no se ofrece.

### Tests for User Story 2 ⚠️

- [X] T059 [P] [US2] Test unitario de `validateBookingRequest` en `tests/unit/domain/booking/confirm.test.ts`, cubriendo los seis modos de `BookingRejection`, incluidos `BEYOND_HORIZON` y `NOT_ON_GRID` que sólo llegan de una petición manipulada
- [X] T060 [P] [US2] Test de integración de `confirmBooking` en `tests/integration/use-cases/confirm-booking.test.ts`: revalidación en el instante de confirmar (FR-011), rechazo de la cuarta cita futura del mismo teléfono o del mismo email por separado (BR-014), aceptación del caso de 2 citas por teléfono más 2 por email distintas —donde ningún contacto alcanza el límite y la unión sí— y dos transacciones concurrentes sobre el mismo hueco de las que exactamente una prospera (FR-012)
- [X] T061 [P] [US2] Test de contrato de `POST /api/appointments` en `tests/contract/appointments-create.test.ts`: `303` con `Location`, `400` con `ValidationError` por campo, `409` con `SlotConflictError` incluyendo la disponibilidad actualizada, `422` por límite de citas y `429` por límite de IP
- [X] T062 [P] [US2] Test e2e de la Historia 2 con axe en `tests/e2e/us2-booking.spec.ts`: los seis escenarios de aceptación, incluido el teléfono inválido que no pierde el resto de lo escrito, y registro informativo de la duración del recorrido completo servicio → confirmación como referencia de SC-001 (< 90 s), sin convertirla en aserción: el objetivo es de usuario y una aserción de tiempo aquí sería frágil

### Implementation for User Story 2

- [X] T063 [US2] Implementar `validateBookingRequest` en `src/domain/booking/confirm.ts`, devolviendo el contacto ya normalizado en `ValidatedBooking`
- [X] T064 [US2] Implementar el caso de uso `confirmBooking` en `src/application/use-cases/confirm-booking.ts`: revalida contra el dominio, consulta `countFutureByContact`, genera el token e inserta traduciendo `SLOT_TAKEN` a la respuesta con disponibilidad actualizada
- [X] T065 [US2] Implementar el Route Handler `POST /api/appointments` en `src/app/api/appointments/route.ts`: esquema Zod que delega el formato de teléfono y email al dominio vía `refine` (D-009), límite de IP `BOOKING_CONFIRMATION`, y respuesta `303` a `/cita/{token}?nueva=1`
- [X] T066 [P] [US2] Implementar el formulario en `src/components/booking-form.tsx`: exactamente tres campos, errores asociados con `aria-describedby`, región `aria-live` para el resumen de errores y conservación de los valores válidos
- [X] T067 [US2] Implementar la pantalla de datos en `src/app/reservar/page.tsx` con el resumen previo a confirmar —servicio, día, hora, duración y plazo de cancelación— exigido por FR-010
- [X] T068 [US2] Añadir los textos de la Historia 2 en `src/messages/es-ES.ts`, incluidos los mensajes de hueco ocupado, límite de citas y límite de IP con el teléfono del salón

**Checkpoint**: US1 + US2 funcionan. El cliente ya reserva sin llamar.

---

## Phase 5: User Story 3 - Recibir la confirmación en pantalla (Priority: P1)

**Goal**: tras confirmar, el cliente ve una pantalla inequívoca con su cita, los datos del salón y el enlace de gestión, y recargarla no crea una segunda cita.

**Independent Test**: completar una reserva y verificar que la pantalla resultante contiene servicio, fecha, hora, duración, plazo de cancelación, datos del salón y el enlace de gestión.

### Tests for User Story 3 ⚠️

- [X] T069 [P] [US3] Test unitario de `deriveView` en `tests/unit/domain/booking/derive-view.test.ts`: `COMPLETED` se deriva del reloj y nunca se persiste, con el límite exacto en `endsAt`
- [X] T070 [P] [US3] Test de integración de `viewAppointment` en `tests/integration/use-cases/view-appointment.test.ts`: resuelve por hash del token y devuelve el snapshot del servicio, no el catálogo actual
- [X] T071 [P] [US3] Test de contrato de `GET /api/appointments/{token}` en `tests/contract/appointment-detail.test.ts` contra el esquema `AppointmentDetail`
- [X] T072 [P] [US3] Test e2e de la Historia 3 con axe en `tests/e2e/us3-confirmation.spec.ts`: los tres escenarios, incluida la recarga que no crea una segunda cita

### Implementation for User Story 3

- [X] T073 [US3] Implementar `deriveView` en `src/domain/booking/derive-view.ts`
- [X] T074 [US3] Implementar el caso de uso `viewAppointment` en `src/application/use-cases/view-appointment.ts`
- [X] T075 [US3] Implementar el Route Handler `GET /api/appointments/[token]` en `src/app/api/appointments/[token]/route.ts`
- [X] T076 [US3] Implementar la pantalla de la cita en `src/app/cita/[token]/page.tsx` con los datos del salón y, cuando llega `?nueva=1`, el aviso destacado de guardar el enlace como única vía de acceso (FR-015)
- [X] T077 [US3] Añadir los textos de la Historia 3 en `src/messages/es-ES.ts`, incluido el aviso de guardado del enlace

**Checkpoint**: las tres historias P1 están completas. La feature ya entrega su valor principal.

---

## Phase 6: User Story 4 - Consultar la cita más tarde (Priority: P2)

**Goal**: el cliente abre su enlace y ve su cita y su estado; un enlace que no resuelve responde siempre lo mismo.

**Independent Test**: crear una cita, abrir su enlace y verificar que muestra esa cita y su estado; probar además un enlace inventado y comprobar el mensaje neutro.

### Tests for User Story 4 ⚠️

- [X] T078 [P] [US4] Test de contrato de la respuesta neutra en `tests/contract/neutral-not-found.test.ts`: los cinco casos de FR-019 y FR-038 devuelven **cuerpo y cabeceras idénticos**, sin `429` ni cabeceras de límite
- [X] T079 [P] [US4] Test unitario de `canCancel` y `canReschedule` en `tests/unit/domain/booking/modification-rules.test.ts`: `TOO_LATE` con su `deadline`, `ALREADY_CANCELLED` y `ALREADY_COMPLETED`, incluido el límite exacto de las 24 h
- [X] T080 [P] [US4] Test e2e de la Historia 4 con axe en `tests/e2e/us4-view.spec.ts`: los cinco escenarios, incluidos los estados cancelada y completada en sólo lectura

### Implementation for User Story 4

- [X] T081 [US4] Implementar `canCancel` y `canReschedule` en `src/domain/booking/modification-rules.ts`
- [X] T082 [US4] Ampliar `src/application/use-cases/view-appointment.ts` para devolver `view`, `canCancel`, `canReschedule` y `unavailableReason` derivado del error del dominio, nunca de un `if` de interfaz
- [X] T083 [US4] Aplicar en `src/app/api/appointments/[token]/route.ts` el límite `APPOINTMENT_LOOKUP` y la respuesta neutra de D-006, ejecutando **siempre** la consulta —incluso con el token malformado— para no abrir un canal temporal
- [X] T084 [US4] Ampliar `src/app/cita/[token]/page.tsx` con las tres vistas —confirmada, cancelada y completada—, las acciones deshabilitadas con su motivo y el teléfono del salón, y el acceso a reservar una cita nueva
- [X] T085 [US4] Implementar la pantalla de enlace no válido en `src/app/cita/[token]/not-found.tsx` con el mensaje neutro y el enlace a la pantalla de reservas
- [X] T086 [US4] Añadir los textos de la Historia 4 en `src/messages/es-ES.ts`, incluido el mensaje neutro y los motivos de acción no disponible

**Checkpoint**: US1–US4 funcionan de forma independiente.

---

## Phase 7: User Story 5 - Cancelar la cita (Priority: P2)

**Goal**: el cliente cancela desde su enlace y el hueco vuelve a estar disponible al momento.

**Independent Test**: crear una cita, cancelarla desde su enlace y comprobar que el hueco reaparece en la pantalla de reservas.

### Tests for User Story 5 ⚠️

- [X] T087 [P] [US5] Test unitario de las reglas de cancelación en `tests/unit/domain/booking/cancel.test.ts`: cancelación dentro de plazo, rechazo pasado el plazo de 24 h, rechazo de una cita ya cancelada y de una cita pasada
- [X] T088 [P] [US5] Test de integración de `cancelAppointment` en `tests/integration/use-cases/cancel-appointment.test.ts`: el hueco queda libre en la misma transacción y la segunda cancelación se rechaza con `ALREADY_CANCELLED`
- [X] T089 [P] [US5] Test de contrato de `POST /api/appointments/{token}/cancellation` en `tests/contract/cancellation.test.ts`: `200` con la cita actualizada, `409` en los tres casos bloqueantes y `404` neutro
- [X] T090 [P] [US5] Test e2e de la Historia 5 con axe en `tests/e2e/us5-cancel.spec.ts`: los cinco escenarios, incluido el hueco liberado que otro cliente puede reservar

### Implementation for User Story 5

- [X] T091 [US5] Implementar la transición a cancelada en `src/domain/booking/cancel.ts`, reutilizando `canCancel`
- [X] T092 [US5] Implementar el caso de uso `cancelAppointment` en `src/application/use-cases/cancel-appointment.ts`
- [X] T093 [US5] Implementar el Route Handler `POST /api/appointments/[token]/cancellation` en `src/app/api/appointments/[token]/cancellation/route.ts`, exigiendo `confirmed: true` en el cuerpo
- [X] T094 [US5] Implementar el diálogo de confirmación explícita en `src/components/cancel-dialog.tsx` y enlazarlo desde `src/app/cita/[token]/page.tsx`
- [X] T095 [US5] Añadir los textos de la Historia 5 en `src/messages/es-ES.ts`, incluido el mensaje de fuera de plazo con el teléfono del salón

**Checkpoint**: US1–US5 funcionan de forma independiente.

---

## Phase 8: User Story 6 - Reprogramar la cita (Priority: P3)

**Goal**: el cliente mueve su cita a otro hueco del mismo servicio sin perderla y conservando su enlace.

**Independent Test**: crear una cita, reprogramarla a otro hueco libre y comprobar que el hueco antiguo queda libre, el nuevo ocupado y el enlace es el mismo.

### Tests for User Story 6 ⚠️

- [X] T096 [P] [US6] Test unitario de `applyReschedule` en `tests/unit/domain/booking/reschedule.test.ts`: `UNCHANGED` al elegir la propia hora, `MOVED` conservando `id` y token, el hueco propio no cuenta como ocupado, y la duración usada es la congelada en el snapshot
- [X] T097 [P] [US6] Test de integración de `rescheduleAppointment` en `tests/integration/use-cases/reschedule-appointment.test.ts`: si el hueco nuevo se ocupa entre medias, la transacción revierte y la cita original queda intacta en su hora original (FR-025, BR-006)
- [X] T098 [P] [US6] Test de contrato de `GET /api/appointments/{token}/availability` y `POST /api/appointments/{token}/reschedule` en `tests/contract/reschedule.test.ts`, incluidos `isCurrentAppointment: true` y `unchanged: true`
- [X] T099 [P] [US6] Test e2e de la Historia 6 con axe en `tests/e2e/us6-reschedule.spec.ts`: los seis escenarios, incluido que el enlace no cambia

### Implementation for User Story 6

- [X] T100 [US6] Implementar `applyReschedule` en `src/domain/booking/reschedule.ts`
- [X] T101 [US6] Implementar el caso de uso `rescheduleAppointment` en `src/application/use-cases/reschedule-appointment.ts`, con `updateSchedule` dentro de una transacción
- [X] T102 [P] [US6] Implementar el Route Handler `GET /api/appointments/[token]/availability` en `src/app/api/appointments/[token]/availability/route.ts`, forzando el servicio de la cita y marcando su hueco actual
- [X] T103 [US6] Implementar el Route Handler `POST /api/appointments/[token]/reschedule` en `src/app/api/appointments/[token]/reschedule/route.ts`
- [X] T104 [US6] Implementar la pantalla de reprogramación en `src/app/cita/[token]/reprogramar/page.tsx`, reutilizando `day-range-picker.tsx` y `slot-list.tsx` sin permitir cambiar de servicio
- [X] T105 [US6] Añadir los textos de la Historia 6 en `src/messages/es-ES.ts`, incluidos «tu hora actual» y el aviso de cambio sin efecto

**Checkpoint**: las seis historias están completas.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: retención, privacidad, rendimiento, accesibilidad y cierre de la feature.

- [X] T106 [P] Test unitario de anonimización en `tests/unit/domain/privacy/anonymize.test.ts`: qué se borra y qué se conserva, e `isDueForAnonymization` en el límite de los 12 meses
- [X] T107 Implementar `anonymize` e `isDueForAnonymization` en `src/domain/privacy/anonymize.ts`, con `AnonymizedAppointment` haciendo imposible el estado intermedio
- [X] T108 [P] Test de integración de la purga en `tests/integration/use-cases/purge-expired-personal-data.test.ts`: tras la purga el enlace deja de resolver con el mensaje neutro y la fila conserva servicio, franja y estado (FR-035a). Cubre además el **borrado a petición** con el que el plan levanta la condición del Principio III: `--appointment <uuid>` sobre una cita reciente y no vencida borra los tres campos personales, sus formas normalizadas y `token_hash` en la misma sentencia, conservando franja, estado y snapshot; y `--dry-run` no escribe nada, verificado comparando la fila antes y después
- [X] T109 Implementar el caso de uso en `src/application/use-cases/purge-expired-personal-data.ts` y el comando `scripts/retention-purge.ts` con `--dry-run` y `--appointment <uuid>`
- [X] T110 [P] Test de integración de ausencia de PII en `tests/integration/logging/no-pii.test.ts`: una reserva con éxito y una reserva fallida no dejan nombre, teléfono, email ni token en la salida del logger
- [X] T111 [P] Implementar el seed de histórico en `db/seed/history.ts` y verificar SC-005 **de extremo a extremo** sobre `GET /api/availability` con y sin 10.000 citas pasadas, incluyendo el coste HTTP y de serialización. La invariancia del caso de uso y el recuento de consultas ya los cubre T042; esta tarea añade la medición sobre el endpoint real y el seed que la alimenta
- [X] T112 [P] Verificar y ajustar el presupuesto de JavaScript de la ruta de reserva a ≤ 120 KB comprimidos **y medir la respuesta percibida de SC-004**: recorrido de las cinco pantallas en Playwright con throttling de 4G y CPU de gama media, comprobando que ninguna acción del flujo supera los 2 s. Ambas mediciones quedan registradas en `docs/performance-budget.md`. El presupuesto de JavaScript es un proxy del objetivo, no el objetivo: SC-004 y el Principio VIII exigen la medición del tiempo
- [X] T113 [P] Crear `docker-compose.prod.yml` con el **proxy inverso que termina TLS**, con HSTS y las cabeceras de seguridad que el plan da por supuestas en el Principio V (`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, CSP), y documentar en `specs/001-client-appointment-booking/quickstart.md` tanto esa terminación como la entrada de cron diaria de las 03:30 que ejecuta `npm run retention:purge`
- [X] T114 Revisar `src/messages/es-ES.ts` para garantizar que el 100 % de los mensajes de error indican una acción concreta a continuación (SC-012)
- [X] T115 Pasada de accesibilidad a 360 px en `tests/e2e/accessibility.spec.ts` sobre las cinco rutas de cara al cliente —`/`, `/reservar`, `/cita/[token]` en sus tres vistas (recién creada con `?nueva=1`, cancelada y completada), `/cita/[token]/reprogramar` y la pantalla de enlace no válido—: axe sin violaciones AA, recorrido completo por teclado con foco visible y áreas táctiles ≥ 44 × 44 px
- [X] T116 [P] Crear el workflow de CI en `.github/workflows/ci.yml` que ejecuta `lint`, `check:layers` y `test:all` y bloquea el merge si alguno falla
- [X] T118 [P] Test de integración de la prevalencia de la cita sobre la configuración en `tests/integration/use-cases/config-change-preserves-appointments.test.ts` (FR-007b, FR-007c, BR-016b; requiere US1 y US4 cerradas). Tres comprobaciones, con una cita `CONFIRMED` precargada el jueves a las 11:00: **(a)** al añadir un `closure` en esa fecha, la cita conserva `status = 'CONFIRMED'`, `cancelled_at IS NULL` y `token_hash`, y `viewAppointment` la sigue devolviendo íntegra con su snapshot; **(b)** al retirar el `opening_interval` que la contiene, `computeRangeDays` marca el día como `CLOSED` y `computeDaySlots` no ofrece ningún inicio, pero `findConfirmedInWindow` **sigue devolviéndola como ocupada**, de modo que si el tramo se restaura ningún otro cliente puede reservar encima; **(c)** ninguna de las dos recargas de configuración ejecuta `UPDATE` ni `DELETE` sobre `appointment` — se compara el recuento de filas y el estado antes y después. **No lleva tarea de implementación asociada**: el diseño ya lo garantiza —configuración y citas son tablas distintas y la disponibilidad es derivada—, y esta tarea existe para que deje de estarlo sin que nadie se entere. El Principio II exige test rojo antes de **código de producción nuevo**; aquí no lo hay.
- [X] T117 Ejecutar el recorrido manual completo de `specs/001-client-appointment-booking/quickstart.md` y dejar `npm run test:all`, `npm run lint` y `npm run check:layers` en verde, sin tests saltados

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de la Fase 1. **BLOQUEA todas las historias.**
- **US1 (Fase 3)**, **US2 (Fase 4)**, **US3 (Fase 5)**, **US4 (Fase 6)**, **US5 (Fase 7)**, **US6 (Fase 8)**: dependen de la Fase 2.
- **Polish (Fase 9)**: depende de las historias que se quieran entregar.
- **T118** se añadió tras el análisis de consistencia y va al final de la Fase 9, antes de T117: necesita US1 y US4 cerradas. La numeración no contigua es deliberada, para no renumerar el resto.

### User Story Dependencies

- **US1 (P1)**: sin dependencias de otras historias. Es el MVP.
- **US2 (P1)**: independiente en implementación; su escenario 5 (hueco ocupado) devuelve la disponibilidad de US1, así que se prueba mejor con US1 presente.
- **US3 (P1)**: depende funcionalmente de US2 para que exista una cita que confirmar.
- **US4 (P2)**: reutiliza la pantalla y el caso de uso de US3 (D-010); si US3 está hecha, US4 la amplía.
- **US5 (P2)**: depende de US4 para la pantalla desde la que se cancela.
- **US6 (P3)**: depende de US4 para la pantalla y de US1 para los componentes de disponibilidad.

### Dentro de cada historia

1. Los tests se escriben y **fallan** antes de implementar.
2. Dominio → casos de uso → Route Handlers → componentes → pantalla → textos.
3. El e2e se escribe con el resto de tests y pasa al cerrar la historia.

### Conflictos de archivo a vigilar

- `src/messages/es-ES.ts` lo tocan T009, T058, T068, T077, T086, T095, T105 y T114: **nunca en paralelo**.
- `src/app/cita/[token]/page.tsx` lo tocan T076, T084 y T094: secuencial.
- `src/app/api/appointments/[token]/route.ts` lo tocan T075 y T083: secuencial.
- `src/application/use-cases/view-appointment.ts` lo tocan T074 y T082: secuencial.
- `package.json` lo tocan T001 y T008: secuencial.

---

## Parallel Example: User Story 1

```bash
# 1) Todos los tests de US1 a la vez (deben fallar):
Task: "Test unitario de la rejilla en tests/unit/domain/availability/slot-grid.test.ts"
Task: "Test unitario de computeDaySlots en tests/unit/domain/availability/compute-day.test.ts"
Task: "Test unitario de computeRangeDays en tests/unit/domain/availability/compute-range.test.ts"
Task: "Test unitario de findNextAvailableDate en tests/unit/domain/availability/next-available.test.ts"
Task: "Test de integración de getAvailability en tests/integration/use-cases/get-availability.test.ts"
Task: "Test de contrato de GET /api/services en tests/contract/services.test.ts"
Task: "Test de contrato de GET /api/availability en tests/contract/availability.test.ts"
Task: "Test e2e de la Historia 1 en tests/e2e/us1-availability.spec.ts"

# 2) Tras implementar el dominio (T046–T049), los tres componentes a la vez:
Task: "ServicePicker en src/components/service-picker.tsx"
Task: "DayRangePicker en src/components/day-range-picker.tsx"
Task: "SlotList en src/components/slot-list.tsx"
```

---

## Implementation Strategy

### MVP primero (sólo User Story 1)

1. Fase 1: Setup (T001–T009).
2. Fase 2: Foundational (T010–T037) — **crítica, bloquea todo**.
3. Fase 3: User Story 1 (T038–T058).
4. **PARAR Y VALIDAR**: el cliente consulta disponibilidad real sin llamar. Ya entrega valor.

### Entrega incremental

1. Setup + Foundational → base lista.
2. + US1 → consulta de disponibilidad (**MVP**).
3. + US2 → reserva sin llamar.
4. + US3 → confirmación y enlace de gestión. **Aquí la feature es utilizable de punta a punta.**
5. + US4 → consulta posterior de la cita.
6. + US5 → cancelación con liberación inmediata del hueco.
7. + US6 → reprogramación.
8. + Polish → retención, rendimiento, accesibilidad y CI.

### Estrategia con varios desarrolladores

1. El equipo completa Setup + Foundational en conjunto.
2. Después: A toma US1, B toma US2+US3, C prepara la Fase 9 (retención y CI, que no dependen de las historias).
3. US4, US5 y US6 se reparten cuando US3 esté cerrada, respetando que las tres tocan `src/app/cita/[token]/page.tsx`.

---

## Notes

- **TDD no negociable** (Principio II): ninguna tarea de implementación empieza sin su test rojo. Cero tests saltados en `main`.
- Una regla de negocio existe en un solo sitio: el dominio. La interfaz puede anticipar el resultado, nunca decidirlo.
- `npm run check:layers` debe pasar después de cada tarea que toque `src/domain`.
- Todos los tests inyectan un `Clock` fijo: ninguno depende de la hora a la que se ejecuta la suite.
- Nombre, teléfono y email nunca entran en logs, trazas ni analítica.
- Commits en Conventional Commits, en inglés, una feature por rama.
