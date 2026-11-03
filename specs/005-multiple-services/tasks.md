---

description: "Lista de tareas de varios servicios por cita y precio opcional"
---

# Tasks: Varios servicios por cita y precio opcional

**Input**: Design documents from `/specs/005-multiple-services/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/http-api-changes.md](./contracts/http-api-changes.md), [contracts/ui-booking.md](./contracts/ui-booking.md), [quickstart.md](./quickstart.md)

**Tests**: obligatorios. El proyecto exige TDD (CLAUDE.md, Principio II): primero los
tests, que deben fallar, y después la implementación.

**Organization**: tareas agrupadas por historia de usuario. La fase 2 es un refactor sin
cambio visible que deja el modelo listo para las tres historias.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia a la que pertenece (US1, US2, US3).

## Path Conventions

Proyecto único: `src/`, `tests/`, `db/` y `scripts/` en la raíz. Rutas según
[plan.md](./plan.md).

## Reglas comunes a todas las tareas

- **Las reglas viven en el dominio**: selección, orden, duración total, precio total y
  «cabe en el horario» (D-003, D-007). Los componentes sólo pintan lo que reciben.
- **Funciones públicas del dominio** devuelven `Result<T, E>` con sus fallos tipados.
- **Textos** en `src/messages/es-ES.ts`. Código, identificadores y comentarios en inglés.
- **Responsive**: sólo las clases y los anchos de la 003 (`.page--split`, `.col-main`,
  `.col-side`, `.wide-only`). Los formularios GET usan `NavForm`. En e2e, los clics que
  navegan se esperan con `clickAndNavigate`.
- **`db/seed/seed.ts`** sólo se amplía (D-010): no cambian los datos que ya tiene.
- **Commits**: un commit `test:` con los tests en rojo y después el commit `feat:` o
  `refactor:` que los pone en verde (Conventional Commits).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: fijar la referencia antes de tocar nada.

- [X] T001 Ejecutar `npm run test:all`, `npm run lint` y `npm run check:layers` en la rama
  recién creada y apuntar los totales por suite en la descripción del futuro PR. Medir
  `tests/e2e/performance.spec.ts` tres veces y anotar los tiempos: es la referencia de
  SC-004. No se sigue con nada en rojo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la cita pasa a tener una lista de servicios, el precio admite «sin precio»
y `serviceId` pasa a ser `serviceIds` en todas las capas. **En la interfaz no cambia
nada**: el selector sigue eligiendo un solo servicio. Al terminar, toda la suite de la
001 y la 003 sigue en verde.

**⚠️ CRITICAL**: ninguna historia empieza antes de terminar esta fase.

### Migración

- [X] T002 Añadir a `migrate()` de `scripts/migrate.ts` una opción
  `{ until?: string }`: aplica las migraciones hasta esa, incluida, y para. Sin la
  opción, el comportamiento es el de siempre. Lo necesita el test de T003.
- [X] T003 Escribir el test (rojo) `tests/integration/db/migration-0003.test.ts`:
  - Crear una base temporal en el servidor de `db-test` (`CREATE DATABASE` con un nombre
    aleatorio) y migrarla con `until: '0002_constraints_and_indexes.sql'`.
  - Insertar con SQL directo dos servicios (uno de 1800 céntimos y otro de 0) y tres
    citas con las columnas `service_*` antiguas: una confirmada, una cancelada y una
    anonimizada. Una de las tres debe tener `service_price_cents = 0`.
  - Aplicar el resto de migraciones y comprobar:
    - Cada cita tiene exactamente una fila en `appointment_service`, con `position = 1`
      y su snapshot (FR-021).
    - `ends_at − starts_at` es igual a la duración de esa fila.
    - Los 0 son `NULL`, tanto en `service` como en `appointment_service` (D-002).
    - Ya no existe ninguna columna `appointment.service_*`.
    - Insertar `price_cents = 0` en `service` falla por el `CHECK`.
    - Repetir un `service_id` en la misma cita falla por el índice único (FR-003).
  - Borrar la base temporal en `afterAll`.
- [X] T004 Escribir `src/infrastructure/db/migrations/0003_multiple_services.sql` según
  [data-model.md](./data-model.md), en el orden que allí se describe, comentado como
  0001 y 0002. T003 pasa a verde.
- [X] T005 Actualizar `src/infrastructure/db/schema.ts`:
  - añadir la tabla `appointmentService`;
  - quitar las columnas `service*` de `appointment`;
  - dejar `service.priceCents` sin `.notNull()`;
  - añadir `appointmentService` al objeto `schema`.
- [X] T006 Adaptar los sitios que escriben citas con SQL directo para que inserten también
  su fila en `appointment_service`, y dejar `TRUNCATE` en cascada:
  - `tests/integration/helpers/test-db.ts`: `truncateAppointments` pasa a
    `TRUNCATE appointment, appointment_service`.
  - `tests/e2e/helpers/appointments.ts`: `seedAppointment` y `resetAppointments`.
  - `db/seed/history.ts`.
  - Los inserts directos de `tests/contract/cancellation.test.ts`,
    `tests/integration/db/constraints.test.ts`,
    `tests/integration/use-cases/cancel-appointment.test.ts`,
    `config-change-preserves-appointments.test.ts`, `confirm-booking.test.ts`,
    `get-availability.test.ts` y `purge-expired-personal-data.test.ts`.

  Si el mismo insert se repite en varios archivos, extraer un helper
  `insertAppointmentRow` a `tests/integration/helpers/test-db.ts`.

### Dominio

- [X] T007 [P] Escribir los tests (rojo) `tests/unit/domain/catalog/selection.test.ts`
  para `selectServices`:
  - Un id devuelve una selección de uno.
  - Dos ids en orden inverso salen en el orden del catálogo (FR-006).
  - La duración es la suma (FR-007).
  - La lista vacía da `EMPTY`.
  - Un id repetido da `DUPLICATE`.
  - Un id inexistente o inactivo da `UNKNOWN_SERVICE` con ese id.
  - El snapshot copia nombre, duración y precio, también cuando el precio es `null`.
- [X] T008 [P] Cambiar `priceCents` a `number | null` en `Service` y en
  `ServiceSnapshot` (`src/domain/catalog/service.ts`). En `src/app/_lib/format.ts`,
  `priceLabel(null)` devuelve `messages.common.priceOnRequest` («Precio a consultar en
  el salón»). Añadir el texto a `src/messages/es-ES.ts`. Test en
  `tests/unit/ui/format.test.ts` (nuevo): `priceLabel(1800)` da «18,00 €» y
  `priceLabel(null)` da el texto.
- [X] T009 Crear `src/domain/catalog/selection.ts` con `NonEmptyServiceList`,
  `ServiceSelection`, `SelectionError` y `selectServices`, tal como están en
  [data-model.md](./data-model.md). T007 pasa a verde.
- [X] T010 Refactorizar el dominio de reserva:
  - `src/domain/booking/appointment.ts`: `Appointment.services: NonEmptyServiceList` y
    `durationOf(appointment)`.
  - `src/domain/booking/confirm.ts`: `BookingRequest` y `validateSlot` reciben
    `durationMinutes` en lugar de `service`, y `ValidatedBooking` lleva `services`.
  - `src/domain/booking/reschedule.ts`: valida con `durationOf(appointment)`.

  Actualizar los fixtures de `tests/unit/domain/booking/*.test.ts` y
  `tests/unit/domain/privacy/anonymize.test.ts` a `services: [snapshot]` sin cambiar
  ninguna comprobación. `npm test` en verde.

### Persistencia y casos de uso

- [X] T011 Escribir los tests (rojo) en
  `tests/integration/repositories/appointment-repository.test.ts`:
  - `insert` con dos servicios guarda dos filas con `position` 1 y 2.
  - Si `insert` choca con la restricción `EXCLUDE`, no queda **ninguna** fila en
    `appointment_service` (D-011).
  - `findByTokenHash` devuelve los servicios en orden y hace **una** consulta: contar
    las consultas con un `Pool` envuelto o con `pg_stat_statements`, igual que hace hoy
    el test de rendimiento.
  - `findConfirmedInWindow` no cambia.
- [X] T012 Implementar en `src/application/ports/index.ts` y
  `src/infrastructure/db/appointment-repository.ts`:
  - `NewAppointment.services`;
  - `insert` en una transacción (cita y filas de servicio);
  - `findByTokenHash` y las lecturas de `updateSchedule` y `cancel` con `json_agg` de
    los servicios ordenados por `position`, con `toDomain` montando la lista no vacía.

  T011 pasa a verde.
- [X] T013 [P] Cambiar a `priceCents: number | null` en
  `src/infrastructure/db/salon-config-repository.ts` y en `writeConfiguration` de
  `db/seed/configuration.ts` (`cents: number | null`). Añadir a `db/seed/seed.ts` el
  servicio `Lavado` (30 min, `cents: null`, orden 4, id `…000000000014`) y
  `SEED_IDS.lavado` (D-010). Se añade aquí y no en US3 porque el quickstart de US1 ya lo
  usa (pasos 7 y 8), y se ve bien desde T008 gracias a `priceLabel(null)`. Ajustar los
  tests que cuentan servicios o recorren el catálogo (`tests/contract/services.test.ts`,
  `tests/e2e/us1-availability.spec.ts` y los que aparezcan) sin cambiar lo que
  comprueban de los tres primeros.
- [X] T014 Cambiar los casos de uso a `serviceIds`:
  - `src/application/use-cases/get-availability.ts`: `serviceIds: readonly string[]`,
    selección con `selectServices` y `currentAppointment: { durationMinutes, startsAt }`
    (D-008). `AvailabilityView` pasa a `selection: ServiceSelection` en lugar de
    `serviceId` y `service`. `SelectionError` se traduce en `EMPTY_SELECTION` y
    `UNKNOWN_SERVICE`.
  - `src/application/use-cases/confirm-booking.ts`: `serviceIds`, `selectServices`
    **antes** de validar el hueco, y `validateBookingRequest` con
    `durationMinutes: selection.durationMinutes`.
  - `src/application/use-cases/reschedule-appointment.ts`: sin cambios de lógica, sólo
    tipos.

  Actualizar `tests/integration/use-cases/*.test.ts` a `serviceIds: [id]` sin cambiar
  ninguna comprobación. `npm run test:integration` en verde.

### Frontera HTTP

- [X] T015 Actualizar el contrato vivo
  `specs/001-client-appointment-booking/contracts/http-api.yaml` a la versión 2.0.0 según
  [contracts/http-api-changes.md](./contracts/http-api-changes.md): `Service`,
  `PriceTotal`, `AvailabilityResponse`, `BookingRequest`, `AppointmentDetail`, el
  parámetro `serviceIds`, `EMPTY_SELECTION` y `SERVICE_UNAVAILABLE`, con una nota en
  `info.description` que apunte a este documento. **Nota**: `price` y `fitsOpeningHours`
  entran como propiedades no obligatorias y pasan a obligatorias cuando existen de
  verdad: en la disponibilidad con T029 y en el detalle de la cita con T045. Adaptar `tests/contract/*.test.ts` y
  `tests/contract/helpers/seed-contract-db.ts` al nuevo nombre del parámetro y a los
  campos nuevos, con un solo servicio. Quedan en rojo.
- [X] T016 Implementar la frontera hasta que T015 pase a verde:
  - `src/app/api/_lib/serializers.ts`: `serviceDto` con `priceLabel`; respuesta de
    disponibilidad con `serviceIds`, `services` y `durationMinutes`; detalle con
    `services[]` y `durationMinutes` como suma.
  - `src/app/api/availability/route.ts`: `serviceIds` separado por comas en Zod,
    `EMPTY_SELECTION`, y **quitar los repetidos** antes de llamar al caso de uso, como
    dice el contrato. `selectServices` sigue rechazándolos para el resto de llamadas.
  - `src/app/api/appointments/route.ts`: `serviceIds` en el cuerpo (`z.array(uuid).min(1)`
    con comprobación de únicos).
  - `src/app/api/services/route.ts`.
  - `src/app/api/appointments/[token]/availability/route.ts`.

  `price` y `fitsOpeningHours` todavía no se envían (nota de T015).
- [X] T017 Renombrar `serviceId` → `serviceIds` en la interfaz, con un solo servicio:
  - campos ocultos de `src/components/day-range-picker.tsx`, `slot-list.tsx` y
    `booking-form.tsx`;
  - `name`/`value` de los botones de `src/components/service-picker.tsx`;
  - lectura de parámetros en `src/app/(booking)/page.tsx`, `src/app/(booking)/reservar/page.tsx`
    y `src/app/(booking)/reservar/actions.ts`;
  - enlaces de vuelta;
  - `src/app/cita/[token]/page.tsx` y `src/app/cita/[token]/reprogramar/page.tsx`, que
    pasan a leer `appointment.services[0]`;
  - las URL que construyen `tests/e2e/*.spec.ts` y `tests/e2e/helpers/*.ts`.
- [X] T018 Ejecutar `npm run test:all`, `npm run lint` y `npm run check:layers`. Todo en
  verde y con los mismos totales que T001, más los tests nuevos. Commit
  `refactor: carry a list of services through the appointment`.

**Checkpoint**: modelo de lista y precio opcional listos; la app se ve y se comporta
igual que antes.

---

## Phase 3: User Story 1 - Reservar varios servicios en una sola cita (Priority: P1) 🎯 MVP

**Goal**: el cliente marca uno o varios servicios y ve la duración total y el precio
total. Sólo se le ofrecen horas donde cabe la cita entera, y confirma una sola cita con
un solo enlace.

**Independent Test**: con el fixture, marcar «Corte» y «Peinado» y comprobar que el
último inicio de un día laborable es las 18:30. Reservar y verificar que queda una cita
con dos filas de servicio, 1 h 15 min de duración y precio total de 43,00 € (quickstart,
pasos 1 a 11).

### Tests for User Story 1 ⚠️

> Escribirlos primero y confirmar que fallan.

- [ ] T019 [P] [US1] En `tests/unit/ui/format.test.ts`:
  - `durationLabel` da `30 min`, `1 h`, `1 h 15 min` y `3 h 15 min` (D-009);
  - `totalPriceLabel` da «18,00 €», «Precio a consultar en el salón» y «18,00 € +
    precio a consultar en el salón» (FR-020).
- [ ] T020 [P] [US1] En `tests/unit/domain/catalog/selection.test.ts`:
  - `fitsOpeningHours(durationMinutes, schedule)`: `true` si algún tramo de la semana
    es igual o más largo; `false` si todos son más cortos; `false` con un horario vacío
    (D-007).
  - `totalPriceOf`: todos con precio da `ALL_PRICED` con la suma; ninguno da
    `NONE_PRICED`; mezcla da `PARTIALLY_PRICED` con la suma de los conocidos; un solo
    servicio sin precio da `NONE_PRICED`.
- [ ] T021 [P] [US1] Ampliar `tests/integration/use-cases/get-availability.test.ts`:
  - Con «Corte» y «Peinado» (75 min), en un día de 10:00 a 20:00 el último hueco es las
    18:30, y `price` es `ALL_PRICED` con 4300.
  - Escenario 4, con dos servicios de 30 min sembrados en el test: una cita confirmada
    de 11:00 a 11:30 quita los inicios de las 10:30 y las 11:00, y deja libres las 10:00
    y las 11:30 (BR-013 de la 001).
  - El orden de `serviceIds` no cambia el resultado.
  - Con un `SalonConfigRepository` de prueba con tramos de 2 h y una selección de 2 h
    30 min, `fitsOpeningHours` es `false` y no hay huecos.
- [ ] T022 [P] [US1] Ampliar `tests/integration/use-cases/confirm-booking.test.ts`:
  - Dos servicios crean una cita con dos filas y `endsAt = startsAt + suma`.
  - Un servicio desactivado entre la consulta y la confirmación da `UNKNOWN_SERVICE` con
    su id y no escribe nada (FR-015).
  - **Concurrencia**: dos confirmaciones simultáneas, una de 90 min a las 10:00 y otra de
    30 min a las 11:00, que se solapan sólo en parte. Prospera exactamente una (FR-016).
  - El límite de 3 citas futuras cuenta citas, no servicios: una cita de 4 servicios
    cuenta como 1.
- [ ] T023 [P] [US1] Ampliar `tests/contract/availability.test.ts` y
  `tests/contract/appointments-create.test.ts`:
  - `serviceIds` con dos ids da `durationMinutes` igual a la suma, `services` en el orden
    del catálogo y `price` con `kind: ALL_PRICED` y su `label`;
  - `serviceIds` con un id repetido da 200 y el mismo resultado que sin repetir (la ruta
    los quita);
  - `serviceIds=` da 400 `EMPTY_SELECTION` con `nextAction`;
  - `POST` con dos servicios da 303;
  - `POST` con un id inactivo da 409 `SERVICE_UNAVAILABLE` con `unavailableServiceIds`;
  - `POST` con un id repetido da 400.
- [ ] T024 [P] [US1] Escribir `tests/e2e/multiple-services.spec.ts` (US1, en los tres
  tamaños), con los escenarios 1 a 8 de US1 y los casos límite de selección:
  - preselección con «✓ Elegido»;
  - marcar un segundo servicio y ver «Duración total»;
  - último inicio del día;
  - recálculo de los 14 días;
  - resumen con cada servicio y el precio total (escenario 6);
  - confirmar y ver una sola cita;
  - hueco ocupado al confirmar;
  - desmarcarlo todo y ver «Elige al menos un servicio»;
  - Atrás y recarga conservan la selección;
  - en ordenador, añadir un servicio con hora elegida conserva la hora si cabe o la
    quita con el aviso si no cabe, y en los dos casos se conserva lo escrito en el
    formulario (FR-011);
  - **servicio retirado**: abrir `/reservar` con un `serviceIds` que incluye un id que
    no está en el catálogo. La selección, el resumen y la duración sólo cuentan los
    válidos (caso límite «deja de ofrecerse»; el rechazo al confirmar lo cubre T022);
  - **recorrido sólo con teclado** (SC-007): con `keyboard.press('Tab')`/`Enter`/`Space`,
    elegir dos servicios, un día y una hora, rellenar el formulario y confirmar, sin
    usar el ratón.

  Los clics que navegan van con `clickAndNavigate`.
- [ ] T025 [P] [US1] Añadir a `tests/e2e/accessibility.spec.ts` la página de reserva con
  dos servicios elegidos y con la selección vacía, a 360, 768 y 1280 px. Comprobar que la
  duración total está en una región `aria-live="polite"`.
- [ ] T026 [US1] Commit `test: describe booking several services in one appointment` con
  T019 a T025 en rojo.

### Implementation for User Story 1

- [ ] T027 [P] [US1] Implementar en `src/app/_lib/format.ts`, con los textos en
  `src/messages/es-ES.ts`:
  - `durationLabel` en horas y minutos;
  - `totalPriceLabel(PriceTotal)` con las tres frases.

  Actualizar las comprobaciones de los e2e de la 001 que esperan «90 min» o «45 min»
  (`tests/e2e/us1-availability.spec.ts` y las que aparezcan) al formato nuevo. T019
  pasa a verde.
- [ ] T028 [P] [US1] Implementar `fitsOpeningHours`, `PriceTotal` y `totalPriceOf` en
  `src/domain/catalog/selection.ts`. T020 pasa a verde.
- [ ] T029 [US1] En `src/application/use-cases/get-availability.ts`, añadir a
  `AvailabilityView`:
  - `fitsOpeningHours`, calculado sobre `configuration.schedule` y
    `selection.durationMinutes`;
  - `price: totalPriceOf(selection.services)`.

  Serializarlos en `src/app/api/_lib/serializers.ts` (`price` con `kind`, `knownCents` y
  `label`) y marcarlos como obligatorios en `AvailabilityResponse` del contrato. T021
  pasa a verde.
- [ ] T030 [US1] En `src/application/use-cases/confirm-booking.ts`, traducir
  `UNKNOWN_SERVICE` con ids a `SERVICE_UNAVAILABLE`. En
  `src/app/api/appointments/route.ts`, responder 409 `SERVICE_UNAVAILABLE` con
  `unavailableServiceIds` y `nextAction`. T022 y T023 pasan a verde.
- [ ] T031 [P] [US1] Añadir a `src/messages/es-ES.ts` los textos de
  [contracts/ui-booking.md](./contracts/ui-booking.md):
  - título y pista de «Elige los servicios»;
  - «✓ Elegido»;
  - «Duración total»;
  - selección vacía;
  - selección demasiado larga, con `{duración}` y `{teléfono}`;
  - hora quitada;
  - servicio que deja de ofrecerse.

  Los errores nuevos llevan `message` y `nextAction`; comprobarlo con
  `tests/unit/messages/actionable-errors.test.ts`.
- [ ] T032 [US1] Reescribir `src/components/service-picker.tsx` como selección múltiple
  (D-004):
  - Recibe `selectedIds` y los campos que debe conservar (`rangeStart`, `selectedDate`
    y, en `/reservar`, `startsAt`) y la `action`.
  - Cada botón tiene `name="serviceIds"` y como `value` la selección resultante, en
    orden de catálogo.
  - `aria-pressed` y «✓ Elegido» con texto e icono.
  - Debajo, el resumen de servicios elegidos y la duración total en `aria-live="polite"`.
- [ ] T033 [P] [US1] Crear `src/components/service-summary.tsx`: las filas `<dt>`/`<dd>`
  de los servicios (nombre · duración · precio con `priceLabel`), la duración total y
  el precio total con `totalPriceLabel`, para usar dentro de `dl.summary`. Con un
  servicio, la etiqueta es «Servicio», en singular. Sólo presentación: recibe
  snapshots, la duración y el `PriceTotal` ya calculados.
- [ ] T034 [US1] Actualizar `src/app/(booking)/page.tsx`:
  - leer `serviceIds` según la tabla de D-004 (ausente, vacío, desconocidos);
  - con la selección vacía, mostrar el selector y el aviso en lugar de días y horas;
  - con `fitsOpeningHours = false`, mostrar el mensaje de FR-010 en lugar de las horas;
  - con `horaQuitada=1`, mostrar el aviso de hora quitada (`role="status"`).

  Clases de la 003 sin cambios.
- [ ] T035 [US1] Actualizar `src/app/(booking)/reservar/page.tsx`:
  - resumen con `ServiceSummary`;
  - selector apuntando a `/reservar` con `startsAt`;
  - si `startsAt` no está entre los `slots` de la nueva selección, `redirect` a `/` con
    `serviceIds`, `rangeStart`, `selectedDate` y `horaQuitada=1` (D-005).

  El borrador del formulario (003/D-004) no se toca.
- [ ] T036 [US1] Actualizar `src/app/(booking)/reservar/actions.ts` y
  `src/components/booking-form.tsx`:
  - `serviceIds` como campo oculto separado por comas;
  - `SERVICE_UNAVAILABLE` muestra su mensaje y `revalidatePath('/reservar')`, como el
    hueco ocupado. Al volver a pintarse, la selección ya no incluye el servicio retirado
    (D-004).
- [ ] T037 [US1] Ejecutar la suite completa. T024 y T025 en verde y la de la 001 y la 003
  sin regresiones. Commit `feat: book several services in one appointment`.

**Checkpoint**: US1 funciona por sí sola, precio total incluido. Es el MVP de la feature.

---

## Phase 4: User Story 2 - Consultar y reprogramar una cita con varios servicios (Priority: P1)

**Goal**: el enlace muestra todos los servicios, la duración total y el precio total. Al
reprogramar sólo cambia la hora, y sólo se ofrecen inicios donde cabe la cita entera.

**Independent Test**: precargar una cita con dos servicios, abrir su enlace, reprogramarla
y comprobar que conserva servicios, duración y enlace. Una cita de antes de la feature se
ve igual (quickstart, pasos 12 y 13).

### Tests for User Story 2 ⚠️

- [ ] T038 [P] [US2] Ampliar `tests/unit/domain/booking/reschedule.test.ts`:
  - una cita de dos servicios de 30 min no se puede mover a un inicio donde sólo cabe
    media hora;
  - al moverla se conservan `services` y la duración;
  - `UNCHANGED` sigue igual.
- [ ] T039 [P] [US2] Ampliar `tests/integration/use-cases/reschedule-appointment.test.ts`
  y `view-appointment.test.ts`:
  - una cita de 1 h se reprograma y conserva token, servicios y `endsAt − startsAt`;
  - los huecos de reprogramación se calculan con 1 h y marcan la hora actual;
  - el detalle devuelve los servicios en orden.
- [ ] T040 [P] [US2] Ampliar `tests/contract/appointment-detail.test.ts` y
  `tests/contract/reschedule.test.ts`:
  - `services[]` con dos elementos y `durationMinutes` igual a la suma;
  - `price` en el detalle;
  - la disponibilidad de reprogramación con `durationMinutes` de la cita.
- [ ] T041 [P] [US2] Añadir a `tests/e2e/multiple-services.spec.ts` los escenarios de US2:
  - enlace con dos servicios y el precio total;
  - aviso de reprogramar que nombra los dos y no tiene selector;
  - sólo inicios de 1 h;
  - mover y conservar el enlace;
  - una cita sembrada con **una** fila de servicio (como deja la migración) se ve con
    «Servicio» en singular, igual que en la 001 (FR-021).

  Ampliar `seedAppointment` de `tests/e2e/helpers/appointments.ts` para aceptar varios
  servicios.
- [ ] T042 [US2] Commit `test: describe viewing and rescheduling an appointment with several services`.

### Implementation for User Story 2

- [ ] T043 [US2] En `src/app/cita/[token]/reprogramar/page.tsx`:
  - pasar a `getAvailability` `currentAppointment: { durationMinutes: durationOf(appointment), startsAt }`;
  - sustituir `appointment.services[0]` por la lista.

  Lo mismo en `src/app/api/appointments/[token]/availability/route.ts`.
- [ ] T044 [P] [US2] Cambiar `messages.reschedule.sameServiceNotice` en
  `src/messages/es-ES.ts` para que reciba la lista de nombres: «Estás cambiando la hora
  de tu cita (A y B). Los servicios no cambian; si quieres otros, cancela esta cita y
  reserva una nueva». Con un servicio, mantener el texto de la 001.
- [ ] T045 [US2] Añadir al detalle de la cita:
  - `price: totalPriceOf(appointment.services)` en `appointmentDetailResponse`
    (`src/app/api/_lib/serializers.ts`), marcado como obligatorio en `AppointmentDetail`
    del contrato;
  - en `src/app/cita/[token]/page.tsx`, los datos de la cita con `ServiceSummary`, que
    incluye duración y precio total.

  Lo mismo en la pantalla de confirmación (`?nueva=1`), que es esta misma página.
- [ ] T046 [US2] Ejecutar la suite completa. T038 a T041 en verde. Commit
  `feat: view and reschedule an appointment with several services`.

**Checkpoint**: US1 y US2 funcionan juntas; las citas anteriores siguen intactas.

---

## Phase 5: User Story 3 - Ver «Precio a consultar» cuando un servicio no tiene precio (Priority: P2)

**Goal**: ningún sitio muestra «0,00 €», y los servicios sin precio se ven igual en todas
las pantallas.

La regla del precio total y su formato ya llegaron con US1 (T020, T028) porque el
resumen los necesita, y `Lavado` está en el fixture desde la fase 2 (T013). Esta
historia prueba de principio a fin el caso sin precio y el caso mixto, y corrige lo que
esas pruebas destapen.

**Independent Test**: con «Lavado» (sin precio) y «Corte» (18 €), recorrer catálogo,
resumen, confirmación y enlace, y comprobar los tres casos de precio (quickstart, pasos 8
y 14).

### Tests for User Story 3 ⚠️

- [ ] T047 [P] [US3] Ampliar `tests/contract/services.test.ts`,
  `tests/contract/availability.test.ts` y `tests/contract/appointment-detail.test.ts`:
  - `Lavado` con `priceCents: null` y su `priceLabel`;
  - `price` de una selección mixta con `kind: PARTIALLY_PRICED`, `knownCents: 1800` y
    su `label`;
  - el detalle de una cita sólo con `Lavado` con `kind: NONE_PRICED`.
- [ ] T048 [P] [US3] Añadir a `tests/e2e/multiple-services.spec.ts` los escenarios 1 a 5
  de US3:
  - catálogo con «Precio a consultar en el salón» en `Lavado`;
  - resumen, confirmación y enlace con selección mixta y con `Lavado` solo;
  - un servicio que gana precio después de reservar sigue sin precio en el enlace (se
    siembra la cita con el snapshot sin precio y el servicio con precio).

  Añadir un test **SC-005**: recorrer `/`, `/reservar`, `/cita/{token}` y
  `/cita/{token}/reprogramar` con `Lavado` y comprobar que el texto «0,00 €» no aparece
  en ninguna.
- [ ] T049 [US3] Ejecutar T047 y T048. Si alguno falla, commit
  `test: describe services without a price` con los que fallan. Si todos pasan ya
  (porque la regla llegó con US1), commit `test: cover services without a price end to
  end`, diciéndolo en el mensaje. No se inventa implementación para justificar un rojo.

### Implementation for User Story 3

- [ ] T050 [US3] Corregir lo que T047 y T048 hayan destapado. Como mínimo, revisar que
  `service-picker.tsx`, `service-summary.tsx`, `/reservar`, `/cita/{token}` y
  `/cita/{token}/reprogramar` usan `priceLabel`/`totalPriceLabel` y que ningún archivo
  formatea céntimos por su cuenta: buscar `/ 100` y `toFixed` en `src/`. Con la suite
  completa en verde, commit `feat: show services without a price as price on request`,
  o `refactor:` si sólo hubo limpieza.

**Checkpoint**: las tres historias funcionan juntas.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T051 [P] Poner `cents: null` en los cuatro servicios de `db/seed/demo.ts` y
  actualizar su comentario de cabecera, que dice que la 005 hará los precios opcionales.
  Comprobar con `npm run db:seed:demo` y reiniciando la app (001/D-003).
- [ ] T052 Repetir `tests/e2e/performance.spec.ts` con cuatro servicios elegidos (añadir
  el caso al spec) y comparar con las medidas de T001 en la misma máquina (SC-004). Si
  supera los 2 s, investigar antes de seguir.
- [ ] T053 Recorrer a mano [quickstart.md](./quickstart.md), pasos 1 a 16, a 360 y a
  1280 px, y la sección de la demo. Anotar en el PR cualquier diferencia.
- [ ] T054 [P] Actualizar la documentación:
  - `README.md`: tabla de features con la 005, «Qué puede hacer hoy la app», la demo
    (precios «a consultar», ya no «0,00 €») y la tabla de checks.
  - `docs/roadmap.md`: marcar el paso 1b, y en el paso 2 anotar que la 002 debe revisar
    agenda, listado, citas a mano y catálogo con varios servicios por cita y precio
    opcional.
  - `CLAUDE.md`: añadir a «Stack y decisiones vigentes» que una cita lleva uno o varios
    servicios en `appointment_service`, y que el contrato HTTP vivo es el 2.0.0 de
    `specs/001-…/contracts/http-api.yaml`. Corregir de paso la ruta antigua
    `contracts/http-api.yaml`.
- [ ] T055 Ejecutar `npm run test:all`, `npm run lint` y `npm run check:layers`. Todo en
  verde, sin tests saltados, sin TODOs ni código comentado. Abrir el PR a `main`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (fase 1)**: sin dependencias.
- **Foundational (fase 2)**: depende de la fase 1 y bloquea todas las historias. Va en
  orden: T002 → T003 → T004 → T005 → T006; T007 ∥ T008 → T009 → T010; T011 → T012; T013
  en paralelo; T014 → T015 → T016 → T017 → T018.
- **US1 (fase 3)**: depende de la fase 2.
- **US2 (fase 4)**: depende de la fase 2, de `ServiceSummary` (T033) y de
  `totalPriceOf` (T028), las dos de US1. Para hacerla en paralelo con US1, adelantar
  T028 y T033.
- **US3 (fase 5)**: depende de US1 (regla y formato del precio) y de US2 (precio en el
  detalle de la cita).
- **Polish (fase 6)**: depende de las historias que se entreguen.

### Within Each User Story

- Tests primero, en rojo, con su commit `test:`.
- Dominio → caso de uso → serializer y contrato → componentes y pantallas.
- Commit `feat:` con la suite completa en verde.

### Parallel Opportunities

- Fase 2: T007 y T008; T013 junto a T011 y T012.
- US1: T019 a T025 entre sí; T027, T028, T031 y T033 entre sí.
- US2: T038 a T041 entre sí; T044 junto a T043.
- US3: T047 y T048.
- Polish: T051 y T054.

---

## Parallel Example: User Story 1

```text
# Tests de US1 a la vez (archivos distintos):
T019 durationLabel y totalPriceLabel en tests/unit/ui/format.test.ts
T020 fitsOpeningHours y totalPriceOf en tests/unit/domain/catalog/selection.test.ts
T021 tests/integration/use-cases/get-availability.test.ts
T022 tests/integration/use-cases/confirm-booking.test.ts
T023 tests/contract/{availability,appointments-create}.test.ts
T024 tests/e2e/multiple-services.spec.ts
T025 tests/e2e/accessibility.spec.ts

# Piezas independientes de la implementación:
T027 src/app/_lib/format.ts
T028 src/domain/catalog/selection.ts
T031 src/messages/es-ES.ts
T033 src/components/service-summary.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Fase 1: referencia.
2. Fase 2: refactor con la suite en verde (T018). Es el punto de más riesgo: no seguir
   con nada en rojo.
3. Fase 3: US1. **Parar y validar** con el quickstart, pasos 1 a 11.
4. Con US1 sola se puede enseñar en la demo «Corte de pelo + Diseño y corte de barba =
   1 h».

### Incremental Delivery

1. Fase 2 → la app se ve igual, con el modelo nuevo debajo.
2. US1 → reservar varios servicios, con duración y precio total.
3. US2 → el enlace y la reprogramación con varios servicios.
4. US3 → los servicios sin precio, probados de principio a fin.
5. Polish → demo, documentación y PR. La feature se fusiona entera a `main` (roadmap:
   «cada feature se fusiona a `main` al cerrarla»).

---

## Notes

- 55 tareas: 1 de setup, 17 de base, 19 de US1, 9 de US2, 4 de US3 y 5 de cierre.
- Cambios tras `/speckit-analyze` (2026-11-03):
  - **I1**: el dominio y el formato del precio total pasan de US3 a US1 (T019, T020,
    T027, T028, T029, T033), y el precio en el detalle de la cita, a US2 (T045).
  - **I2**: `Lavado` entra en el fixture en la fase 2 (T013).
  - **A1**: FR-010 de la spec queda alineado con D-007.
  - **I3**: `GET /availability` quita los repetidos en la ruta (T016, T023).
  - **C1**: e2e del servicio retirado (T024).
  - **C2**: recorrido completo con teclado (T024).
- [P] = archivos distintos, sin dependencias pendientes.
- Cada historia se puede comprobar por separado con su «Independent Test».
- Todo bug que aparezca empieza por un test de regresión.
