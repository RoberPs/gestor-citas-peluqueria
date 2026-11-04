# Tasks: Gestión del salón (cara a la dueña) v1

**Input**: Design documents from `/specs/002-salon-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: SE INCLUYEN Y NO SON OPCIONALES. `CLAUDE.md` y el Principio II de la constitución imponen TDD: primero un test que falla. En cada fase, las tareas de test preceden a las de implementación y deben estar en rojo antes de escribir el código que las pone en verde.

**Organization**: las tareas se agrupan por historia de usuario. Cada fase es un incremento entregable y verificable por separado.

**Revisión del 2026-11-03**: las tareas se adaptan a la `005-multiple-services` (varios servicios por cita, precio opcional, migración `0003` ya ocupada) y a la `003-responsive-desktop`, y se añaden la Historia 10 (Fase 4b) y el registro de quién cancela. Las tareas nuevas van de la T165 a la T187 para no renumerar las existentes; T139 y T140 ya las cubrió la 005.

**Segunda revisión del 2026-11-03**, con las decisiones de la dueña del producto: la Historia 11, «Editar una cita» (Fase 8b, D-035); la búsqueda en el listado (D-036), que amplía las tareas de la Fase 4b en su sitio y añade la columna `customer_name_search` a la Fase 2; y el texto de la cita cancelada que ve el cliente, con el contrato de cliente 2.1.0 (D-037), en la Fase 7. Las tareas nuevas van de la T188 a la T212.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede ejecutar en paralelo (archivos distintos, sin dependencias pendientes)
- **[Story]**: la historia a la que pertenece la tarea (US1 … US11)
- Toda descripción lleva la ruta exacta del archivo

## Path Conventions

Proyecto único con arquitectura hexagonal, heredado de `001-client-appointment-booking`: `src/domain`, `src/application`, `src/infrastructure`, `src/app`, `src/components`, `tests/`. Las rutas de abajo son las reales del repositorio.

**Nota sobre el middleware**: [plan.md](./plan.md) lo sitúa en `src/app/middleware.ts`. Next.js sólo reconoce el middleware en `src/middleware.ts` (junto a `app/`, no dentro). Las tareas usan la ruta válida.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dejar el proyecto listo para la feature. Sin lógica de negocio.

- [x] T001 Elevar el mínimo declarado de `next` a `^15.2.3` en `package.json`, verificar con `npm ls next` que el lockfile resuelve 15.2.3 o superior y actualizar `package-lock.json` (D-018, CVE-2025-29927)
- [x] T002 [P] Añadir el script `owner:provision` (`tsx scripts/provision-owner.ts`) a `package.json`, junto a `db:seed`. *Se hace con T056*: el script no puede apuntar a un archivo que todavía no existe
- [x] T003 [P] Documentar `OWNER_USERNAME` y `OWNER_INITIAL_PASSWORD` en `.env.example`, con la nota de que son de un solo uso y no las lee la aplicación en marcha. *Se hace con T056*, cuando exista el comando que las usa
- [x] T004 [P] Parametrizar `tests/contract/helpers/openapi.ts` para que acepte la ruta del contrato en vez de tenerla empotrada, sin duplicar el ayudante (D-028)
- [x] T005 [P] Actualizar las rutas de tests en `vitest.config.ts` / `package.json` para que `tests/unit/domain/owner/`, `tests/integration/security/` y `tests/integration/concurrency/` entren en las suites correspondientes — sin cambios: los `include` ya son `tests/unit/**` y `tests/integration/**`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, tipos de dominio y migración de lo que la 001 dejó escrito. Toca código existente y ninguna historia puede construirse encima hasta que esté verde.

**⚠️ CRITICAL**: ninguna historia empieza hasta que esta fase esté completa y `npm run test:all` en verde.

### Tests de la fase fundacional ⚠️ (escribir primero, deben fallar)

- [x] T006 [P] Test de regresión de la migración 0005 en `tests/integration/db/migration-0005-closures.test.ts`: carga cierres, migra y comprueba que los periodos resultantes cubren exactamente los mismos días, incluido uno en la semana del cambio de hora (data-model.md, "Migración desde `closure`")
- [x] T007 [P] Test de restricciones nuevas en `tests/integration/db/constraints.test.ts` (ampliar): `CHECK (ends_at > starts_at)` de `unavailable_period`, `EXCLUDE` de `opening_interval` y `CHECK` de rangos de `salon`. Los `CHECK` de `service` ya existen (0001 y 0003 de la 005) y ya tienen test
- [x] T008 [P] Test de la restricción `appointment_anonymization_is_atomic` reescrita en `tests/integration/db/constraints.test.ts`: cita manual sin email válida, cita manual con `token_hash` rechazada, cita online sin `token_hash` rechazada, anonimizada a medias rechazada, y `customer_name_search` que sigue al nombre y se vacía al anonimizar (D-026, D-036)
- [x] T165 [P] Test de `appointment_cancelled_by_consistency` en `tests/integration/db/constraints.test.ts`: cancelada sin `cancelled_by` rechazada, confirmada con `cancelled_by` rechazada; y en `tests/integration/db/migration-0006-owner-fields.test.ts`, que las canceladas existentes migran a `CUSTOMER` y las confirmadas a `NULL` (FR-040a, D-032)
- [x] T188 [P] Test unitario de `searchableName` en `tests/unit/domain/contact/contact.test.ts` (ampliar): tildes, diéresis, eñes, mayúsculas y espacios repetidos («José  NÚÑEZ» → «jose nunez»), y `validateContact` devuelve `searchName` (FR-069, D-036)
- [x] T189 [P] Test del relleno de `customer_name_search` en `tests/integration/db/migration-0006-owner-fields.test.ts`: carga citas con nombres con tildes, eñes y mayúsculas antes de la 0006, migra y exige que la columna valga **exactamente** lo que da `searchableName` para cada una, y `NULL` en las anonimizadas (D-036)
- [x] T190 [P] Test de regresión en `tests/integration/use-cases/purge-expired-personal-data.test.ts` (ampliar): anonimizar borra también `customer_name_search` (Principio III, D-036)
- [x] T166 [P] Test unitario en `tests/unit/domain/booking/cancel.test.ts` (ampliar): `applyCancellation` fija `cancelledBy: 'CUSTOMER'` junto a `cancelledAt` (FR-040a)
- [x] T167 [P] Test de regresión en `tests/integration/use-cases/cancel-appointment.test.ts` (ampliar): el cliente cancela desde su enlace y la cita queda con `cancelled_by = 'CUSTOMER'`; lo que ve el cliente no cambia (FR-040a)
- [x] T168 [P] Test en `tests/integration/repositories/appointment-repository.test.ts` (ampliar): las citas de un día se leen con **todos** sus servicios en el orden del catálogo, con una sola consulta, y devuelven `origin` y `cancelledBy` (FR-014, D-027)
- [x] T009 [P] Test unitario de resta de intervalos en `tests/unit/domain/availability/interval-math.test.ts`: apertura menos ocupados, media abierta `[)`, resultado vacío, solapes parciales y anidados
- [x] T010 [P] Test unitario en `tests/unit/domain/availability/compute-day.test.ts` (ampliar): los periodos no disponibles entran como ocupados y ningún inicio los pisa (FR-020, BR-002)
- [x] T011 [P] Test unitario en `tests/unit/domain/availability/compute-range.test.ts` (ampliar): `CLOSED` cuando los periodos cubren toda la apertura, `FULL` cuando queda apertura sin cubrir (D-020)
- [x] T012 [P] Test unitario en `tests/unit/domain/contact/contact.test.ts` (ampliar): email ausente (`null` o cadena vacía) es contacto válido; nombre y teléfono siguen siendo obligatorios (FR-024, FR-031)
- [x] T013 [P] Test de integración `tests/integration/use-cases/config-propagation.test.ts`: cambiar un parámetro y comprobar que la siguiente consulta de disponibilidad ya lo usa, sin reiniciar el proceso, contando consultas para que un caché reintroducido lo ponga en rojo (D-021, FR-056)

### Migraciones y esquema

La `0003_multiple_services.sql` es de la 005 y ya está en `main`: las de esta feature empiezan en la `0004`.

- [x] T014 Escribir a mano `src/infrastructure/db/migrations/0004_owner_account_and_session.sql`: `owner_account` con su índice único de fila única, `owner_session` con `token_hash` único y `ON DELETE CASCADE`, sin ninguna columna de IP ni de dispositivo (FR-009)
- [x] T015 Escribir a mano `src/infrastructure/db/migrations/0005_unavailable_period.sql`: crear la tabla, el `CHECK (ends_at > starts_at)`, el índice GiST sobre `tstzrange(starts_at, ends_at, '[)')`, convertir los cierres a instantes en la zona del salón y eliminar `closure` (D-019, D-027)
- [x] T016 Escribir a mano `src/infrastructure/db/migrations/0006_appointment_owner_fields.sql`: enums `appointment_origin` y `appointment_actor`, columna `origin NOT NULL` con `ONLINE` para lo existente, columna `cancelled_by` con `CUSTOMER` para las ya canceladas y su `CHECK` `appointment_cancelled_by_consistency`, columna generada `customer_name_search` con el SQL de data-model.md, reescritura de `appointment_anonymization_is_atomic`, e índices `appointment_starts_at_id_idx` y `appointment_created_at_id_idx` del listado (D-026, D-032, D-033, D-036)
- [x] T017 Escribir a mano `src/infrastructure/db/migrations/0007_editable_configuration.sql`: columnas de política en `salon` con sus `CHECK` de rango y de horas completas, tipo `timerange` y `EXCLUDE` de `opening_interval` (D-022, FR-045). `service` no se toca: sus `CHECK` ya existen (D-031)
- [x] T018 Actualizar `src/infrastructure/db/schema.ts`: tablas `owner_account`, `owner_session` y `unavailable_period`, columnas nuevas de `salon` y de `appointment` (`origin`, `cancelled_by`), y retirada de `closure`

### Dominio: lo que cambia de la 001

- [x] T019 [P] Crear `src/domain/availability/interval-math.ts` con la resta de intervalos, en un solo sitio y con la media abierta `[)` de BR-013 (D-019, D-020)
- [x] T020 Sustituir `Closure` por `UnavailablePeriod` en `src/domain/catalog/salon.ts` y exponer los dos campos de política que ahora vienen de la base (D-019, D-022)
- [x] T021 Generalizar `src/domain/availability/compute-day.ts`: `isClosed: boolean` → `unavailablePeriods`, concatenando citas y periodos **antes** de la única comprobación de solape (contracts/domain-api.md)
- [x] T022 Generalizar `src/domain/availability/compute-range.ts` con la regla `CLOSED`/`FULL` de D-020, apoyándose en `interval-math.ts`
- [x] T023 [P] Hacer opcional el email en `src/domain/contact/contact.ts`: `CustomerContact.email: string | null` y `validateContact` tratando la ausencia como válida (D-026)
- [x] T191 Añadir `searchableName` y `ValidatedContact.searchName` a `src/domain/contact/contact.ts`, como única definición de cómo se compara un nombre (D-036; después de T023, mismo archivo)
- [x] T024 Propagar el email opcional por los llamantes que el compilador señale en `src/domain/booking/`, `src/application/use-cases/` y `src/components/`, sin cambiar ningún comportamiento de la cara del cliente
- [x] T169 Añadir `origin` y `cancelledBy: CancellationActor | null` a `Appointment` en `src/domain/booking/appointment.ts`, y hacer que `applyCancellation` en `src/domain/booking/cancel.ts` fije `cancelledBy: 'CUSTOMER'` (D-032, contracts/domain-api.md)

### Infraestructura y puertos

- [ ] T025 Declarar los puertos nuevos en `src/application/ports/index.ts`: `PasswordHasher`, `OwnerAccountRepository`, `OwnerSessionRepository`, `UnavailablePeriodRepository`, `SalonConfigWriter`, `OwnerAppointmentWriter` (contracts/domain-api.md). *En la Fase 2 sólo `UnavailablePeriodRepository`, que es el que la disponibilidad usa; cada uno de los demás se declara con la primera tarea que lo implementa (T045, T077, T115, T125), para no dejar interfaces sin nadie detrás*
- [x] T026 Retirar el caché de proceso de `src/infrastructure/db/salon-config-repository.ts`, leer la política de la fila `salon` y borrar el comentario que dejó de ser cierto (D-021, D-022)
- [ ] T027 [P] Implementar `src/infrastructure/db/unavailable-period-repository.ts` con `findOverlapping` apoyada en el índice GiST, `insert`, `shorten` y `delete`. *`findOverlapping` hecho en la Fase 2, que es lo que la disponibilidad lee; `insert`, `shorten` y `delete` llegan con T077, que es quien los usa*
- [x] T028 Añadir `origin`, `cancelled_by` y el email opcional a `src/infrastructure/db/appointment-repository.ts`; `cancel(id, at, by)` escribe `cancelled_by` en el mismo `UPDATE`; y una consulta de las citas de un día **con sus servicios** de `appointment_service`, en una sola consulta, con filtro de canceladas (FR-014, FR-015, FR-040a, D-027)
- [x] T170 Pasar `CUSTOMER` desde `src/application/use-cases/cancel-appointment.ts` al repositorio, sin cambiar nada de lo que ve el cliente (FR-040a). El texto que el cliente ve según quién canceló es de la Fase 7 (T195)
- [x] T192 ~~Escribir `customer_name_search` desde `ValidatedContact.searchName` en el `insert` y ponerla a `NULL` al anonimizar~~ — innecesaria: la columna es generada desde el nombre (D-036, revisado al implementar). T189 y T190 vigilan que siga al nombre
- [x] T029 [P] Cargar los festivos como `unavailable_period` de día completo y añadir la comida de un martes en `db/seed/seed.ts`; retirar toda referencia a `closure` en `db/seed/configuration.ts`, que comparten el fixture y la demo. En `db/seed/demo.ts` sólo cambia el nombre del campo (`closures: []` pasa a periodos vacíos): sus datos no se tocan. *Hecho sin la comida del martes: `us2-agenda.spec.ts` escribe la hora bloqueada que necesita y la borra después, y el fixture de la 001 no cambia*
- [x] T030 [P] Crear el bloque `owner` de textos en `src/messages/es-ES.ts`, con los mensajes comunes de carga, éxito y error accionable (FR-059). *Se hace con T058, la primera pantalla que los muestra: `actionable-errors.test.ts` no puede comprobar textos que nadie usa*
- [ ] T031 Registrar los repositorios y puertos nuevos en `src/app/_lib/container.ts`. *Registrado `createUnavailablePeriodRepository` en la Fase 2; cada historia registra los suyos*

**Checkpoint**: `npm run test:all` en verde con los cierres migrados, la configuración leída en vivo, las cancelaciones del cliente registradas como suyas y el nombre buscable guardado en cada cita. La 001 y la 005 siguen en verde sin cambiar de comportamiento. Las historias pueden empezar.

---

## Phase 3: User Story 1 - Entrar en la gestión del salón (Priority: P1) 🎯 MVP

**Goal**: la dueña entra con usuario y contraseña; sin credencial válida ninguna pantalla ni respuesta de gestión revela un solo dato.

**Independent Test**: dos navegaciones —una con credencial válida y otra sin ella— más el barrido de todas las rutas de gestión sin cookie (SC-001).

### Tests de la Historia 1 ⚠️ (escribir primero, deben fallar)

- [x] T032 [P] [US1] Test unitario del bloqueo en `tests/unit/domain/owner/account.test.ts`: cinco fallos en quince minutos bloquean, la ventana caduca, un acceso correcto durante el bloqueo **no** lo levanta (D-017)
- [x] T033 [P] [US1] Test unitario de la sesión en `tests/unit/domain/owner/session.test.ts`: viva dentro de 12 h, caducada fuera, `shouldTouchSession` sólo cada 5 min, todo sobre reloj inyectado (D-015)
- [x] T034 [P] [US1] Test unitario de `scrypt` en `tests/unit/infrastructure/password.test.ts`: formato `scrypt$N$r$p$salt$hash`, verificación correcta e incorrecta, comparación en tiempo constante, rechazo por debajo de 12 caracteres (D-016)
- [x] T035 [P] [US1] Test de barrido de acceso en `tests/integration/security/access-sweep.test.ts`: enumera **desde el enrutador** todas las rutas de `/gestion` y `/api/gestion` y exige que ninguna, sin cookie, devuelva contenido de gestión (SC-001, D-018, D-029)
- [x] T036 [P] [US1] Test de indistinguibilidad en `tests/integration/security/sign-in-indistinguishability.test.ts`: código, cuerpo y cabeceras idénticos para usuario inexistente, contraseña incorrecta y cuenta bloqueada, sin `Retry-After` (FR-008, FR-009, D-017)
- [x] T037 [P] [US1] Test de contrato en `tests/contract/owner/sesion.test.ts` para `POST /gestion/sesion`, `DELETE /gestion/sesion` y `PUT /gestion/cuenta/contrasena` contra `contracts/owner-api.yaml`
- [x] T038 [P] [US1] Test de integración del caso de uso en `tests/integration/use-cases/sign-in-owner.test.ts` contra PostgreSQL real: contador a cero al acertar, bloqueo persistido entre reinicios simulados
- [x] T039 [P] [US1] Test de que la contraseña no llega a los logs en `tests/integration/logging/no-pii.test.ts` (ampliar) (FR-010)
- [x] T040 [P] [US1] E2E en `tests/e2e/us1-access.spec.ts`: acceso válido, acceso sin sesión, mensaje idéntico en los dos fallos, cierre de sesión con Atrás del navegador, más `@axe-core/playwright` sobre el formulario de acceso

### Implementación de la Historia 1

- [x] T041 [P] [US1] Implementar `src/domain/owner/account.ts`: `LOCKOUT_POLICY`, `evaluateLockout` y `registerFailure`, puras sobre el reloj inyectado
- [x] T042 [P] [US1] Implementar `src/domain/owner/session.ts`: `SESSION_IDLE_TIMEOUT_HOURS`, `SESSION_TOUCH_INTERVAL_MINUTES`, `isSessionAlive` y `shouldTouchSession`
- [x] T043 [P] [US1] Implementar `src/infrastructure/security/password.ts` con `scrypt` (`N=2^17, r=8, p=1`, sal de 16 B, `maxmem` elevado), `verify` con `timingSafeEqual` y `verifyDecoy` contra un hash señuelo fijo (D-016, D-017)
- [x] T044 [P] [US1] Implementar `src/infrastructure/security/session-token.ts`: 32 bytes de CSPRNG y su hash SHA-256, siguiendo el patrón de `token.ts` (D-005, D-015). *Hecho reutilizando `tokenGenerator` de `token.ts`, que ya hace exactamente eso: un segundo archivo idéntico sería la misma regla dos veces*
- [x] T045 [US1] Implementar `src/infrastructure/db/owner-account-repository.ts` y `src/infrastructure/db/owner-session-repository.ts` sobre los puertos de T025
- [x] T046 [US1] Implementar `src/application/use-cases/sign-in-owner.ts`: deriva siempre un hash —señuelo si el usuario no existe o la cuenta está bloqueada— y devuelve `Result` con un único modo de fallo indistinguible (FR-008, FR-009)
- [x] T047 [P] [US1] Implementar `src/application/use-cases/sign-out-owner.ts`, que **borra** la fila de sesión (FR-006)
- [x] T048 [P] [US1] Implementar `src/application/use-cases/change-owner-password.ts`: acredita la contraseña actual, exige 12 caracteres y avanza `password_changed_at` (FR-004)
- [x] T049 [US1] Implementar `src/application/use-cases/authorize-owner-session.ts`: el guardián que resuelve la sesión, refresca `last_seen_at` como mucho cada 5 min y aborta si no hay sesión viva (FR-002, FR-007)
- [x] T050 [US1] Implementar el envoltorio `requireOwnerSession()` en `src/app/api/gestion/_lib/require-owner-session.ts`, que **todo** handler y toda pantalla de gestión usará (D-018)
- [x] T051 [US1] Implementar `src/app/api/gestion/sesion/route.ts` (`POST` y `DELETE`) con validación Zod y la cookie `__Host-owner_session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, sin `Max-Age`)
- [x] T052 [P] [US1] Implementar `src/app/api/gestion/cuenta/contrasena/route.ts` (`PUT`)
- [x] T053 [P] [US1] Implementar `src/middleware.ts` que **sólo redirige** a `/gestion/acceso` y no autoriza nada (D-018)
- [x] T054 [P] [US1] Implementar la pantalla `src/app/gestion/acceso/page.tsx`: formulario accesible a 360 px, en una columna con la base de la 003 (D-034), mensaje de error único y la indicación de qué hacer si se olvida la contraseña, sin detalles operativos (FR-005)
- [x] T055 [P] [US1] Implementar la pantalla `src/app/gestion/cuenta/page.tsx` con el cambio de contraseña y el cierre de sesión, en una columna con la base de la 003 (D-034)
- [x] T056 [P] [US1] Implementar `scripts/provision-owner.ts`: lee el entorno, rechaza contraseñas cortas, avisa cuando sobrescribe, cierra todas las sesiones vivas y no registra la contraseña en ningún log (quickstart.md)
- [x] T057 [P] [US1] Borrar las sesiones caducadas en `scripts/retention-purge.ts` (data-model.md, "Limpieza")
- [x] T058 [US1] Añadir los textos de acceso, cuenta y errores de sesión al bloque `owner` de `src/messages/es-ES.ts`

**Checkpoint**: la frontera de acceso está establecida y el barrido de SC-001 pasa. Las historias 2 a 9 pueden construirse encima.

---

## Phase 4: User Story 2 - Ver la agenda del día (Priority: P1)

**Goal**: la dueña ve su día como una línea temporal navegable con citas, periodos y tiempo libre.

**Independent Test**: con citas ya existentes, abrir la agenda y comprobar que las muestra y que la navegación entre días funciona.

### Tests de la Historia 2 ⚠️

- [x] T059 [P] [US2] Test unitario en `tests/unit/domain/owner/agenda.test.ts`: `entries` ordenadas y sin `FREE` solapado, cita y periodo sí pueden solaparse, `isClosed` según D-020, distinción "sin citas" vs "cerrado" (FR-011, FR-017)
- [x] T060 [P] [US2] Test unitario de `isPastSlot` en `tests/unit/domain/owner/agenda.test.ts`: el corte es la **hora de fin**; una cita en curso no es pasado (FR-016, BR-009)
- [x] T061 [P] [US2] Test de contrato en `tests/contract/owner/agenda.test.ts` para `GET /gestion/agenda`
- [x] T062 [P] [US2] Test de rendimiento en `tests/integration/performance/agenda-performance.test.ts`: número **fijo** de consultas al abrir un día, igual con la base vacía que con las 10.000 citas de `db:seed:history`, y sin aumentar cuando cada cita del día tiene cuatro servicios (SC-010, D-027, FR-014)
- [x] T063 [P] [US2] E2E en `tests/e2e/us2-agenda.spec.ts`: tres citas en orden, origen por texto e icono, periodo con su motivo, atajo de hoy, día pasado de sólo lectura, día vacío, una cita de dos servicios con los dos a la vista (US2-7), más axe; a 360 px y a 1280 px

### Implementación de la Historia 2

- [x] T064 [US2] Implementar `src/domain/owner/agenda.ts`: `buildAgendaDay` e `isPastSlot`, funciones puras apoyadas en `interval-math.ts` (contracts/domain-api.md)
- [x] T065 [US2] Implementar `src/application/use-cases/get-agenda-day.ts`: tres consultas de coste acotado y el filtro de canceladas según lo que la dueña pidió (FR-015, D-027)
- [x] T066 [US2] Implementar `src/app/api/gestion/agenda/route.ts` (`GET`) con el guardián de T050, devolviendo la línea temporal completa en una sola respuesta
- [x] T067 [P] [US2] Implementar `src/components/owner/timeline.tsx` como **lista** semántica, no rejilla absoluta: recorrible con teclado y legible con lector de pantalla (Principio VII). Cada cita muestra todos sus servicios y su precio total reutilizando `src/components/service-summary.tsx` de la 005 (FR-014)
- [x] T068 [US2] Implementar la pantalla `src/app/gestion/agenda/page.tsx` con la navegación a cualquier fecha y el atajo de hoy (FR-012), con `NavForm` para cambiar de día y la base responsive de la 003: línea temporal en `.col-main`, navegación en `.col-side` dentro de `.page--split` (D-034)
- [x] T069 [P] [US2] Añadir a `src/messages/es-ES.ts` los textos de origen de la cita, estado, estado vacío "sin citas" y "cerrado" (FR-013, FR-017)
- [ ] T070 [P] [US2] Extender la redacción de Pino en `src/infrastructure/logging/logger.ts` a los cuerpos de agenda y conflicto y a los de crear y editar una cita (`POST /gestion/citas` y `PATCH /gestion/citas/{id}`), que llevan nombre, teléfono y email (FR-057). *Pendiente para la US6: en el paso 4 ningún código registra esos cuerpos; las contraseñas ya se redactan (T039)*

**Checkpoint**: la agenda sustituye al papel. Historias 1 y 2 funcionan por separado.

---

## Phase 4b: User Story 10 - Consultar el listado de reservas (Priority: P1)

**Goal**: la dueña ve sus reservas una debajo de otra, con los dos órdenes, los filtros de estado, origen y fechas, la búsqueda por nombre o teléfono, y quién canceló cada cancelada.

**Independent Test**: con citas confirmadas y canceladas, online y a mano, en varios días, abrir el listado y comprobar el orden por defecto, cada filtro, el otro orden, la búsqueda, la paginación y el enlace de cada fila a su día.

**Depende de**: US1 (el guardián) y la Fase 2 (`cancelled_by`, citas con servicios). Sólo el escenario 7 —ir a la agenda desde una fila— necesita la pantalla de US2 (T068).

### Tests de la Historia 10 ⚠️

- [x] T171 [P] [US10] Test unitario en `tests/unit/domain/owner/booking-list.test.ts`: valores por defecto `UPCOMING`, `CONFIRMED` y `ALL`; `notBefore` es el inicio de hoy en `Europe/Madrid` con el reloj inyectado, también un día de cambio de hora; `RANGE_REVERSED`; `INVALID_VALUE` por campo; `CURSOR_ORDER_MISMATCH`; y la búsqueda: vacía es `null`, «600 11 22 33», «+34600112233» y «0034 600-112-233» son el mismo `PHONE`, «600 11» es `INVALID_VALUE` en `search`, «José NÚÑEZ» es `NAME` «jose nunez» (FR-061, FR-062, FR-069, D-033, D-036)
- [x] T172 [P] [US10] Test de contrato en `tests/contract/owner/reservas.test.ts` para `GET /gestion/reservas`: forma de `BookingListPage`, `query` normalizada en la respuesta con `buscar`, 400 con `nextAction` —también por un `buscar` de cifras incompleto— y 401 sin sesión
- [x] T173 [P] [US10] Test de integración en `tests/integration/use-cases/list-bookings.test.ts` contra PostgreSQL real: los dos órdenes, cada filtro y sus combinaciones, el rango sobre el día de la cita en los dos órdenes, una cita de varios servicios con todos en orden, una cancelada con su fecha y `cancelledBy`, una anonimizada sin datos personales (FR-060 a FR-063, FR-067)
- [x] T193 [P] [US10] Test de integración de la búsqueda en `tests/integration/use-cases/list-bookings.test.ts`: por una parte del nombre con y sin acentos y mayúsculas, por el teléfono escrito de tres formas, combinada con el filtro *Canceladas* y con los dos órdenes, sin encontrar nunca una anonimizada, y un `%` o un `_` en el término tratados como letras (FR-069, FR-070, SC-016)
- [x] T174 [P] [US10] Test de paginación en `tests/integration/use-cases/list-bookings.test.ts`: 45 citas en tres páginas sin repetir ni saltarse ninguna, también con una reserva insertada entre página y página y con una búsqueda activa (FR-064, D-033)
- [x] T175 [P] [US10] Test de rendimiento en `tests/integration/performance/booking-list-performance.test.ts`: **una** consulta por página, igual con la base vacía que con las 10.000 citas de `db:seed:history`, con cuatro servicios por cita y con una búsqueda por nombre y otra por teléfono (FR-066, SC-013, SC-016)
- [x] T176 [P] [US10] E2E en `tests/e2e/us10-bookings.spec.ts`: los once escenarios de la historia y el escenario 6 de la US5 —una cita cancelada desde la gestión aparece como «Cancelada por ti» y una cancelada desde el enlace como «Cancelada por el cliente»—, con `clickAndNavigate` en cada cambio de filtro, de orden, de búsqueda y de página, *Volver al principio* incluido, más axe; a 360 px y a 1280 px (D-034)

### Implementación de la Historia 10

- [x] T177 [US10] Implementar `src/domain/owner/booking-list.ts`: `BOOKING_LIST_PAGE_SIZE` y `parseBookingListQuery`, con la clasificación de la búsqueda apoyada en `normalizePhone` y `searchableName` (contracts/domain-api.md, D-036)
- [x] T178 [US10] Declarar `BookingListReader` en `src/application/ports/index.ts` e implementarlo en `src/infrastructure/db/booking-list-reader.ts`: una consulta con los servicios agregados por `json_agg` en una subconsulta lateral, `LIMIT` de 21, la clave del cursor según el orden y, si hay búsqueda, la igualdad sobre `customer_phone_normalized` o el `LIKE` con `%`, `_` y `\` escapados sobre `customer_name_search` (D-033, D-036)
- [x] T179 [US10] Implementar `src/application/use-cases/list-bookings.ts` y registrarlo en `src/app/_lib/container.ts`
- [x] T180 [US10] Implementar `src/app/api/gestion/reservas/route.ts` (`GET`) con el guardián de T050, validación Zod de los parámetros —`buscar` incluido—, la traducción de sus valores en español (`proximas`, `mano`…) a los del dominio (`UPCOMING`, `OWNER`…) y el cursor opaco codificado en la frontera HTTP
- [x] T181 [P] [US10] Implementar `src/components/owner/booking-list.tsx`: una fila por cita con día y hora, servicios y precio (`service-summary.tsx`), nombre, teléfono, estado, origen y fecha de reserva; «Cancelada» con icono, fecha y «por el cliente» o «por ti»; origen y fecha de reserva en `.wide-only` a 1024 px; cada fila enlaza a `/gestion/agenda?fecha=…` (FR-060, FR-063, FR-065)
- [x] T182 [US10] Implementar la pantalla `src/app/gestion/reservas/page.tsx`: campo de búsqueda con su etiqueta, filtros y orden con `NavForm` en `.col-side`, filas en `.col-main` dentro de `.page--split`, *Página siguiente* y *Volver al principio* conservando filtros y búsqueda, estado vacío con vuelta a los filtros por defecto (FR-064, FR-068, FR-069, D-034)
- [x] T183 [P] [US10] Añadir el enlace al listado en la navegación de gestión, junto a la agenda
- [x] T184 [P] [US10] Añadir a `src/messages/es-ES.ts` los textos del listado: órdenes, filtros, búsqueda —su etiqueta, su ayuda y el error de un teléfono incompleto—, «Cancelada por el cliente», «Cancelada por ti», datos borrados por antigüedad, estado vacío y paginación

**Checkpoint**: 🎯 **MVP mínimo**. Con US1, US2 y US10 la dueña entra, ve su día y ve todas sus reservas, y nadie más puede verlos.

---

## Phase 5: User Story 3 - Bloquear y liberar ratos (Priority: P1)

**Goal**: la dueña bloquea un rato o unas vacaciones y los huecos desaparecen para el cliente; al eliminarlo, vuelven.

**Independent Test**: crear un periodo, comprobar en la página pública que los huecos desaparecen, eliminarlo y comprobar que vuelven.

### Tests de la Historia 3 ⚠️

- [x] T071 [P] [US3] Test de contrato en `tests/contract/owner/periodos.test.ts` para `GET`/`POST /gestion/periodos` y `PATCH`/`DELETE /gestion/periodos/{id}`
- [x] T072 [P] [US3] Test de integración en `tests/integration/use-cases/manage-unavailable-periods.test.ts`: crear, acortar, eliminar, rechazo de `fin <= inicio` y rechazo de granularidad distinta de 15 min (FR-018, FR-019, FR-023)
- [x] T073 [P] [US3] Test de integración en `tests/integration/use-cases/get-availability.test.ts` (ampliar): un periodo creado desaparece de la disponibilidad en la consulta siguiente y unas vacaciones se ven `CLOSED`, no `FULL` (SC-003, D-020)
- [x] T074 [P] [US3] Test de que el motivo **nunca** cruza hacia el cliente en `tests/contract/availability.test.ts` (ampliar) (FR-021, BR-002)
- [x] T075 [P] [US3] Test de integración del solape parcial en `tests/integration/use-cases/manage-unavailable-periods.test.ts`: un minuto de intersección con una cita confirmada lista la cita y exige confirmación, y **no cancela ninguna** (FR-022, clarificación 2026-09-16)
- [x] T076 [P] [US3] E2E en `tests/e2e/us3-periods.spec.ts`: bloquear la comida, comprobar en `/` que los inicios desaparecen, eliminarlo y verlos volver, más axe

### Implementación de la Historia 3

- [x] T077 [US3] Implementar `src/application/use-cases/manage-unavailable-periods.ts`: crear, acortar y eliminar, listando las citas solapadas y exigiendo acuse antes de guardar (FR-022) *Hecho con `detectConflicts`, `computeStateToken` y `checkAcknowledgement` de `src/domain/owner/conflict.ts`, adelantados a la US3 porque el `409` del contrato exige `stateToken`. La resolución sólo admite `acknowledgeAppointments`; cancelar citas desde este aviso llega con T116*
- [x] T078 [P] [US3] Implementar `src/app/api/gestion/periodos/route.ts` (`GET`, `POST`) con validación Zod y el guardián
- [x] T079 [P] [US3] Implementar `src/app/api/gestion/periodos/[id]/route.ts` (`PATCH`, `DELETE`)
- [x] T080 [P] [US3] Implementar `src/components/owner/period-form.tsx` con la rejilla de 15 minutos y el motivo interno opcional *Las horas se eligen en una lista de 15 en 15 minutos, y también se pueden bloquear días enteros. El formulario envía la hora del salón a una server action (`src/app/gestion/agenda/actions.ts`), que la convierte en la zona del salón y llama al mismo caso de uso que la API*
- [x] T081 [US3] Integrar la creación y el borrado de periodos en `src/app/gestion/agenda/page.tsx`, desde la propia línea temporal *Liberar se hace desde cada rato de la línea temporal; un día pasado no ofrece ni el formulario ni el botón (BR-009). Borrar un periodo ya terminado sí se permite por la API: BR-009 prohíbe crear, mover, editar y cancelar, y liberar tiempo no quita nada a nadie*
- [x] T082 [P] [US3] Añadir los textos de periodos y de la lista de citas afectadas a `src/messages/es-ES.ts`

**Checkpoint**: el hueco fantasma más frecuente queda resuelto y se nota en la cara del cliente sin reiniciar nada.

---

## Phase 6: User Story 4 - Apuntar una cita a mano (Priority: P1)

**Goal**: la dueña apunta desde la agenda a quien entra sin cita, con las exenciones que le corresponden y sin las que no.

**Independent Test**: crear una cita a mano en un hueco libre y comprobar que aparece en la agenda y que el hueco deja de ofrecerse en la página pública.

### Tests de la Historia 4 ⚠️

- [ ] T083 [P] [US4] Test unitario en `tests/unit/domain/owner/manual-booking.test.ts`, caso por caso de la tabla de D-025: bloquea el pasado, bloquea el cuarto contacto, bloquea la granularidad; **no** objeta antelación, horizonte ni plazo; **avisa** fuera de horario; con dos servicios, `endsAt` es el inicio más la suma (FR-027, D-030)
- [ ] T084 [P] [US4] Test unitario en `tests/unit/domain/owner/conflict.test.ts`: `detectConflicts` con la media abierta `[)`, un minuto de intersección es conflicto, y cada `Conflict` lleva lo necesario para nombrarlo, con **todos** los servicios de la cita en `serviceNames` (FR-033, SC-005)
- [ ] T085 [P] [US4] Test de contrato en `tests/contract/owner/citas.test.ts` para `POST /gestion/citas`, incluida la respuesta de conflicto
- [ ] T086 [P] [US4] Test de integración en `tests/integration/use-cases/create-manual-appointment.test.ts`: cita sin email válida, sin nombre o sin teléfono rechazada, cuarta cita del contacto rechazada, sin `token_hash` y con `origin = 'OWNER'`, varios servicios guardados en `appointment_service` en el orden del catálogo con su snapshot, duración igual a su suma en el instante de guardar, y rechazo de una selección vacía, repetida o con un servicio retirado (FR-024, FR-026, FR-027, FR-029)
- [ ] T087 [P] [US4] Test de regresión del origen permanente en `tests/integration/use-cases/create-manual-appointment.test.ts`: reprogramar una cita manual la deja manual (FR-025)
- [ ] T088 [P] [US4] E2E en `tests/e2e/us4-manual-booking.spec.ts`: los ocho escenarios de la historia, incluido el aviso de fuera de horario y la duración total con dos servicios, más axe y la medición de SC-002; a 360 px y a 1280 px

### Implementación de la Historia 4

- [ ] T089 [US4] Implementar `src/domain/owner/manual-booking.ts`: `planManualBooking` sobre una `NonEmptyServiceList`, con la duración de `durationOfServices`, devolviendo `Result<ManualBookingPlan, ManualBookingBlocker>` con los avisos **dentro** del éxito (D-025, D-030)
- [ ] T090 [US4] Implementar `detectConflicts` en `src/domain/owner/conflict.ts`, reutilizando la función `overlaps` existente (contracts/domain-api.md)
- [ ] T091 [US4] Implementar `src/application/use-cases/create-manual-appointment.ts`: la selección con `selectServices` contra el catálogo activo, apoyándose en el recuento por contacto ya existente y sin tocarlo (D-026, D-030)
- [ ] T092 [US4] Implementar `src/app/api/gestion/citas/route.ts` (`POST`) con validación Zod y el guardián
- [ ] T093 [P] [US4] Implementar `src/components/owner/manual-booking-form.tsx`: uno o varios servicios con la duración total a la vista, reutilizando `src/components/service-picker.tsx` de la 005; hora en rejilla de 15 min; nombre y teléfono obligatorios, email opcional; en cuatro toques desde la agenda (SC-002, FR-027)
- [ ] T094 [US4] Enganchar el formulario a los huecos de `src/app/gestion/agenda/page.tsx`
- [ ] T095 [P] [US4] Añadir los textos de cita manual, avisos y bloqueos a `src/messages/es-ES.ts`

**Checkpoint**: la agenda pasa a ser fiable y los huecos que se ofrecen online son reales.

---

## Phase 7: User Story 5 - Mover o cancelar una cita desde la agenda (Priority: P1)

**Goal**: la dueña reprograma o cancela cualquier cita, online o manual, desde la agenda.

**Independent Test**: mover una cita a otra hora libre y cancelar otra, comprobando el efecto en la agenda y en la disponibilidad pública.

### Tests de la Historia 5 ⚠️

- [ ] T096 [P] [US5] Test de contrato en `tests/contract/owner/citas-cambios.test.ts` para `POST /gestion/citas/{id}/reprogramacion` y `POST /gestion/citas/{id}/cancelacion`
- [ ] T097 [P] [US5] Test de integración en `tests/integration/use-cases/reschedule-appointment-as-owner.test.ts`: una cita de dos servicios conserva los dos, su duración total —aunque uno haya cambiado de duración o se haya retirado del catálogo—, sus datos y su **enlace de gestión vivo** (FR-039, FR-041, BR-020)
- [ ] T098 [P] [US5] Test de integración en `tests/integration/use-cases/cancel-appointment-as-owner.test.ts`: la dueña cancela dentro del plazo vedado al cliente, la cita queda con `cancelled_by = 'OWNER'`, y una cita cancelada no se reactiva ni se mueve (FR-040a, FR-042, BR-007, BR-008)
- [ ] T185 [P] [US5] Test unitario en `tests/unit/domain/owner/cancellation.test.ts`: `applyOwnerCancellation` fija `cancelledBy: 'OWNER'`, no consulta el plazo, rechaza `ALREADY_CANCELLED` e `IN_THE_PAST` y deja cancelar una cita en curso (FR-016, FR-040a, BR-007)
- [ ] T099 [P] [US5] Test de integración de que ni crear ni mover al pasado es posible, con una cita **en curso** que sí se mueve, en `tests/integration/use-cases/reschedule-appointment-as-owner.test.ts` (FR-030, BR-009)
- [ ] T100 [P] [US5] E2E en `tests/e2e/us5-manage.spec.ts`: mover, cancelar con confirmación explícita que nombra la cita, el recordatorio de FR-043 con el teléfono a la vista y, en el escenario 7, abrir después el enlace de esa cita y leer «El salón ha cancelado esta cita» con el teléfono del salón, más axe. El escenario 6 —la cancelada aparece en el listado como «Cancelada por ti»— lo comprueba T176, porque necesita la pantalla de la US10
- [ ] T194 [P] [US5] Ampliar el test de contrato de la vista de la cita en `tests/contract/` y pasar `specs/001-client-appointment-booking/contracts/http-api.yaml` a la **2.1.0** según `contracts/http-api-changes.md`: `AppointmentDetail` exige `cancelledBy`. Queda en rojo hasta T195 (D-037)
- [ ] T196 [P] [US5] Ampliar `tests/e2e/us5-cancel.spec.ts` de la 001: tras cancelar desde el enlace, la pantalla dice «Has cancelado esta cita» y ya no «Esta cita está cancelada…» (FR-040b, D-037)

### Implementación de la Historia 5

- [ ] T186 [US5] Implementar `src/domain/owner/cancellation.ts`: `applyOwnerCancellation` apoyada en `isPastSlot` (contracts/domain-api.md)
- [ ] T101 [P] [US5] Implementar `src/application/use-cases/reschedule-appointment-as-owner.ts`, con la duración de `durationOf(appointment)` y nunca la del catálogo (D-030)
- [ ] T102 [P] [US5] Implementar `src/application/use-cases/cancel-appointment-as-owner.ts` sobre `applyOwnerCancellation`, pasando `OWNER` al repositorio
- [ ] T103 [P] [US5] Implementar `src/app/api/gestion/citas/[id]/reprogramacion/route.ts` (`POST`)
- [ ] T104 [P] [US5] Implementar `src/app/api/gestion/citas/[id]/cancelacion/route.ts` (`POST`)
- [ ] T105 [US5] Añadir a `src/app/gestion/agenda/page.tsx` las acciones de mover y cancelar, con confirmación explícita que nombra la cita concreta (FR-040)
- [ ] T106 [P] [US5] Añadir el aviso de "el cliente no recibe ningún aviso" con su teléfono a `src/messages/es-ES.ts` y a la pantalla (FR-043)
- [ ] T195 [US5] Devolver `cancelledBy` desde `src/application/use-cases/view-appointment.ts` y su Route Handler, y en `src/app/cita/[token]/page.tsx` elegir el texto según su valor: «Has cancelado esta cita» o «El salón ha cancelado esta cita» con el teléfono del salón, sustituyendo `cancelledNote` en `src/messages/es-ES.ts` (FR-040b, D-037)

**Checkpoint**: todo cambio de última hora se resuelve dentro de la app.

---

## Phase 8: User Story 6 - Resolver un conflicto a la vista (Priority: P1)

**Goal**: el sistema nombra lo que estorba, deja decidir a la dueña y aplica la resolución y el cambio como una sola operación indivisible.

**Independent Test**: intentar crear una cita solapada, comprobar que el aviso nombra la cita en conflicto, que rechazarlo no cambia nada y que resolverlo aplica ambos cambios juntos.

**Depende de**: US4 (`detectConflicts`) y US5 (las mutaciones sobre las que se monta el protocolo de dos pasos).

### Tests de la Historia 6 ⚠️

- [ ] T107 [P] [US6] Test unitario en `tests/unit/domain/owner/conflict.test.ts`: `buildResolutionPlan` devuelve `UNRESOLVED_CONFLICT` si queda una cita sin resolver, `UNKNOWN_TARGET` y `SHORTENING_DOES_NOT_FIT`; **no existe entrada que signifique "mantener ambas"** (FR-034, FR-035)
- [x] T108 [P] [US6] Test unitario de `computeStateToken` en `tests/unit/domain/owner/conflict.test.ts`: determinista, estable frente al orden y sensible a cualquier cambio (D-024) *Hecho en la US3, junto con los tests de `detectConflicts` y `checkAcknowledgement`*
- [ ] T109 [P] [US6] Test de integración de atomicidad en `tests/integration/use-cases/resolution-atomicity.test.ts`: provoca un fallo a mitad del plan y comprueba que **ni la cita en conflicto queda cancelada ni la nueva creada** (FR-037, SC-006)
- [ ] T110 [P] [US6] Test de concurrencia real en `tests/integration/concurrency/concurrent-conflict.test.ts`: dos confirmaciones solapadas en dos conexiones; exactamente una prospera y la otra recibe el conflicto **recalculado**, nunca un solape guardado (FR-038, SC-004, D-029)
- [ ] T111 [P] [US6] Test de integración de que una violación `23P01` se traduce a `STATE_CHANGED` en `tests/integration/db/constraints.test.ts` (D-024)
- [ ] T112 [P] [US6] Test de contrato del protocolo de dos pasos en `tests/contract/owner/conflicto.test.ts`: el primer paso es de sólo lectura y el segundo exige `stateToken` y `Resolution`
- [ ] T113 [P] [US6] E2E en `tests/e2e/us6-conflict.spec.ts`: los seis escenarios, más axe sobre el `dialog` modal con foco atrapado, devuelto al abridor y conflicto anunciado en `aria-live` (Principio VII)

### Implementación de la Historia 6

- [ ] T114 [US6] Completar `src/domain/owner/conflict.ts` con `computeStateToken` —con el `hash` inyectado como puerto— y `buildResolutionPlan` con sus tres modos de fallo tipados *`computeStateToken` y `detectConflicts` ya existen desde la US3; queda `buildResolutionPlan`*
- [ ] T115 [US6] Implementar `src/infrastructure/db/owner-appointment-writer.ts`: `applyPlan` que re-detecta el conflicto **dentro** de la transacción, compara el `stateToken` y aplica el plan entero o nada, con las filas de `appointment_service` de la cita nueva y `cancelled_by = 'OWNER'` en las cancelaciones de la resolución (D-023, D-024, FR-040a)
- [ ] T116 [US6] Integrar el protocolo de dos pasos en los handlers de `src/app/api/gestion/citas/`, `citas/[id]/reprogramacion/` y `periodos/`
- [ ] T117 [US6] Implementar `src/components/owner/conflict-dialog.tsx`: `dialog` modal accesible que nombra cada elemento en conflicto —con todos los servicios de una cita— y ofrece **sólo** salidas explícitas (FR-033, FR-034)
- [ ] T118 [P] [US6] Añadir los textos del diálogo de conflicto a `src/messages/es-ES.ts`, con el nombre del cliente en pantalla y **nunca** en el log (FR-057)

**Checkpoint**: crear, mover y cancelar con resolución de conflictos están completos; SC-004, SC-005 y SC-006 se cumplen. Falta la Historia 11 para cerrar la gestión manual.

---

## Phase 8b: User Story 11 - Editar una cita (Priority: P1)

**Goal**: la dueña cambia los servicios y los datos del cliente de una cita sin cancelarla, con el mismo aviso de conflicto que al moverla, y sin tocar los snapshots que la cita ya tenía.

**Independent Test**: añadir un servicio a una cita con hueco detrás y ver que se alarga y que el hueco deja de ofrecerse; añadir otro a una cita con otra detrás y ver el aviso de conflicto; corregir un teléfono y ver que el enlace del cliente sigue funcionando.

**Depende de**: US6 (`buildResolutionPlan`, `applyPlan` y el diálogo de conflicto) y US5 (las acciones sobre una cita en la agenda).

### Tests de la Historia 11 ⚠️

- [ ] T197 [P] [US11] Test unitario de `mergeServiceSelection` en `tests/unit/domain/catalog/selection.test.ts` (ampliar): un servicio que se queda conserva su snapshot aunque esté retirado o haya cambiado de precio; uno nuevo toma el snapshot de hoy y tiene que estar activo (`UNKNOWN_SERVICE` si no); `EMPTY` y `DUPLICATE`; orden del catálogo con retirados incluidos (FR-072, BR-021)
- [ ] T198 [P] [US11] Test unitario de `planAppointmentEdit` en `tests/unit/domain/owner/appointment-edit.test.ts`: el inicio no cambia; alargar sobre otra cita o un periodo da conflicto y acortar nunca; la propia cita no estorba; terminar tras el cierre avisa con `OUTSIDE_OPENING_HOURS`; `ALREADY_CANCELLED`; `IN_THE_PAST` con el fin actual, y una cita en curso se edita; `CONTACT_LIMIT_REACHED` sólo si cambia el contacto (FR-071 a FR-075)
- [ ] T199 [P] [US11] Test unitario en `tests/unit/domain/owner/conflict.test.ts` (ampliar): `buildResolutionPlan` acepta `EditAppointment` con las mismas salidas y los mismos fallos que mover, y `computeStateToken` cambia cuando una cita en conflicto se alarga (FR-074, D-024)
- [ ] T200 [P] [US11] Test de contrato en `tests/contract/owner/citas-edicion.test.ts` para `PATCH /gestion/citas/{id}`: 200, 409 con el conflicto, 422 por cada bloqueo, 404 y 401
- [ ] T201 [P] [US11] Test de integración en `tests/integration/use-cases/edit-appointment-as-owner.test.ts` contra PostgreSQL real: las filas de `appointment_service` que se quedan no cambian ni de precio ni de duración; las nuevas llevan el snapshot de hoy; `position` sale en el orden del catálogo; `ends_at` es inicio más la suma; `id`, `starts_at`, `origin`, `created_at` y `token_hash` no cambian; `customer_name_search` sigue al nombre nuevo; el email puede quitarse en una cita online; el contacto nuevo con tres citas futuras se rechaza (FR-072, FR-073, FR-075, BR-021)
- [ ] T202 [P] [US11] Test de concurrencia en `tests/integration/concurrency/concurrent-conflict.test.ts` (ampliar): una edición que alarga una cita y una reserva online sobre ese mismo rato, a la vez; exactamente una prospera y nunca queda un solape guardado (FR-038, SC-004)
- [ ] T203 [P] [US11] Test de integración en `tests/integration/use-cases/view-appointment.test.ts` y `reschedule-appointment.test.ts` (ampliar): tras editar una cita online, su enlace muestra los servicios, la duración y el precio nuevos, y reprogramarla desde el enlace usa la duración nueva (FR-076)
- [ ] T204 [P] [US11] E2E en `tests/e2e/us11-edit.spec.ts`: los ocho escenarios de la historia, con el diálogo de conflicto del escenario 3, más axe y la medición de SC-015; a 360 px y a 1280 px

### Implementación de la Historia 11

- [ ] T205 [US11] Implementar `mergeServiceSelection` en `src/domain/catalog/selection.ts`, junto a `selectServices` (contracts/domain-api.md)
- [ ] T206 [US11] Implementar `src/domain/owner/appointment-edit.ts` con `planAppointmentEdit`, apoyada en `detectConflicts`, `isPastSlot` y `durationOfServices`, y añadir `EditAppointment` a `ResolutionIntent` en `src/domain/owner/conflict.ts` (D-035)
- [ ] T207 [US11] Permitir excluir una cita en `countFutureByContact` de `src/infrastructure/db/appointment-repository.ts`, para el límite al editar el contacto (FR-075)
- [ ] T208 [US11] Aplicar `EditAppointment` en `applyPlan` de `src/infrastructure/db/owner-appointment-writer.ts`: `UPDATE` de `ends_at` y de los datos del cliente con `customer_name_search`; `DELETE` de los servicios que salen, `INSERT` de los que entran y renumeración de `position` sin tocar nada más de las filas que se quedan, todo en la misma transacción (D-035, BR-021)
- [ ] T209 [US11] Implementar `src/application/use-cases/edit-appointment-as-owner.ts`: carga la cita y el catálogo entero, `mergeServiceSelection`, `validateContact` con el email opcional, el recuento del contacto nuevo sólo si cambió, `planAppointmentEdit` y el protocolo de dos pasos; registrarlo en `src/app/_lib/container.ts`
- [ ] T210 [US11] Implementar `PATCH` en `src/app/api/gestion/citas/[id]/route.ts` con validación Zod, el guardián y `notifyCustomer` en las citas online (FR-043)
- [ ] T211 [P] [US11] Implementar `src/components/owner/appointment-edit-form.tsx`: los servicios con `service-picker.tsx` de la 005 y la duración total y la hora de fin a la vista, los datos del cliente con los mismos campos que `manual-booking-form.tsx`, y el diálogo de conflicto de T117 (FR-073, SC-015)
- [ ] T212 [US11] Añadir la acción «Editar» a cada cita de `src/app/gestion/agenda/page.tsx`, sólo en las confirmadas no terminadas, y los textos de la edición a `src/messages/es-ES.ts`

**Checkpoint**: 🎯 **MVP completo**. Las ocho historias P1 —US1 a US6, US10 y US11— están completas. La gestión manual funciona de punta a punta sin romper la garantía de no-superposición.

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
- [ ] T129 [US7] Implementar la pantalla `src/app/gestion/horario/page.tsx` (SC-012: sin ayuda ni documentación, al primer intento), en una columna con la base de la 003 (D-034)
- [ ] T130 [P] [US7] Añadir los textos de horario y de rechazo de tramos a `src/messages/es-ES.ts`

**Checkpoint**: el horario deja de ser dato de arranque.

---

## Phase 10: User Story 8 - Mantener el catálogo de servicios (Priority: P2)

**Goal**: la dueña añade, corrige, reordena, retira y reactiva servicios sin tocar ninguna cita existente.

**Independent Test**: añadir un servicio y comprobar que es seleccionable de inmediato en la página pública y que sus huecos se calculan con la duración indicada.

### Tests de la Historia 8 ⚠️

- [ ] T131 [P] [US8] Test unitario en `tests/unit/domain/catalog/service-edit.test.ts`: `EMPTY_NAME`, `NON_POSITIVE_DURATION`, `NON_POSITIVE_PRICE` con 0 y con negativos, `priceCents: null` válido, y `canRetireService` con `LAST_ACTIVE_SERVICE` (FR-051, FR-053, D-031)
- [ ] T132 [P] [US8] Test de contrato en `tests/contract/owner/servicios.test.ts` para `GET`/`POST /gestion/servicios`, `PATCH /gestion/servicios/{id}` (incluido que acepta y persiste un `displayOrder` nuevo, FR-049, y que acepta `priceCents: null`) y `PUT /gestion/servicios/{id}/activo`
- [ ] T133 [P] [US8] Test de regresión en `tests/integration/use-cases/config-change-preserves-appointments.test.ts` (ampliar): retirar un servicio deja el 100 % de sus citas futuras intactas en fecha, hora, duración, precio y estado, incluidas las que lo llevan junto a otros servicios (SC-008, BR-003)
- [ ] T134 [P] [US8] Test de regresión del snapshot congelado: cambiar la duración de 45 a 60 min, o poner precio a un servicio que no lo tenía, no toca las citas ya confirmadas (FR-052, US8-5, US8-8)
- [ ] T135 [P] [US8] Test de integración de la retirada concurrente en `tests/integration/use-cases/manage-services.test.ts`: dos retiradas simultáneas no dejan el catálogo vacío, porque el recuento va **dentro** de la transacción (FR-051)
- [ ] T136 [P] [US8] Test de integración en `tests/integration/use-cases/confirm-booking.test.ts` (ampliar): la dueña retira con `setServiceActive` uno de los servicios elegidos entre la consulta de disponibilidad y la confirmación del cliente, y la confirmación devuelve `SERVICE_UNAVAILABLE` sin dejar la cita a medias (US8-6; el modo de fallo es de la 005)
- [ ] T137 [P] [US8] E2E en `tests/e2e/us8-services.spec.ts`: los ocho escenarios —incluido SC-007, servicio nuevo seleccionable de inmediato, y el servicio sin precio que el cliente ve como «Precio a consultar en el salón»—, más axe

### Implementación de la Historia 8

- [ ] T138 [P] [US8] Implementar `src/domain/catalog/service-edit.ts`: `validateService` con precio opcional y `canRetireService` (D-031)
- [x] T139 [US8] ~~Añadir `SERVICE_UNAVAILABLE` a `confirmBooking` y comprobar el catálogo activo en el instante de confirmar~~ — hecho en la 005 (FR-015 de la 005): `confirm-booking.ts` valida la selección con `selectServices` y devuelve `SERVICE_UNAVAILABLE`
- [x] T140 [US8] ~~Propagar el modo de fallo por el caso de uso, la pantalla y `POST /api/appointments`~~ — hecho en la 005, con su test de contrato
- [ ] T141 [US8] Implementar `createService`, `updateService` y `setServiceActive` en `src/infrastructure/db/salon-config-writer.ts`, con el precio anulable y el recuento de activos dentro de la misma transacción
- [ ] T142 [US8] Implementar `src/application/use-cases/manage-services.ts`
- [ ] T143 [P] [US8] Implementar `src/app/api/gestion/servicios/route.ts`, `src/app/api/gestion/servicios/[id]/route.ts` y `src/app/api/gestion/servicios/[id]/activo/route.ts`, con `priceLabel` redactado igual que en la API de cliente
- [ ] T144 [P] [US8] Implementar `src/components/owner/service-list.tsx` con el orden de presentación editable y el precio como campo opcional: vacío viaja como `null`, nunca como 0 (D-031)
- [ ] T145 [US8] Implementar la pantalla `src/app/gestion/servicios/page.tsx`, en una columna con la base de la 003 (D-034)
- [ ] T146 [P] [US8] Añadir los textos de catálogo, incluidos "el salón se quedaría sin nada que reservar" y "si no quieres poner precio, deja el campo vacío", a `src/messages/es-ES.ts`

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
- [ ] T155 [US9] Implementar la pantalla `src/app/gestion/parametros/page.tsx`, que **recibe** los límites y no los reescribe (Principio I), en una columna con la base de la 003 (D-034)
- [ ] T156 [P] [US9] Añadir los textos de parámetros a `src/messages/es-ES.ts`

**Checkpoint**: las once historias están completas.

---

## Phase 12: Polish & Cross-Cutting Concerns

- [ ] T157 [P] Auditoría de accesibilidad de las siete pantallas, del diálogo de conflicto y de los formularios de cita a mano y de edición en `tests/e2e/accessibility.spec.ts` (ampliar), sin ninguna incidencia AA y operable íntegramente con teclado, en los tres tamaños de la 003 (SC-011)
- [ ] T187 [P] Ampliar `tests/e2e/responsive.spec.ts` con las pantallas de gestión a 1280 px —agenda y listado en dos columnas, el resto en una, sin desplazamiento horizontal— y comprobar que `tests/unit/ui/layout-breakpoints.test.ts` sigue en verde sin excepciones nuevas (FR-058, D-034)
- [ ] T158 [P] Barrido manual de PII en los logs siguiendo `quickstart.md`, y ampliación de `tests/integration/logging/no-pii.test.ts` con los cuerpos de agenda, conflicto, cita a mano y edición, y con el parámetro `buscar` del listado, que lleva un nombre o un teléfono en la URL: ni su valor ni la URL completa pueden llegar a ningún log ni traza (FR-057, D-036)
- [ ] T159 [P] Revisar que ningún texto de gestión vive fuera de `src/messages/es-ES.ts` con un test en `tests/unit/messages/actionable-errors.test.ts` (ampliar)
- [ ] T160 [P] Actualizar `CLAUDE.md`: los cierres pasan a periodos no disponibles, la configuración deja de ser precargada, aparece `owner:provision`, cada cancelación guarda quién la hizo, la dueña puede editar los servicios de una cita y el contrato HTTP vivo de cliente es el 2.1.0
- [ ] T161 [P] Actualizar `README.md` (estado del producto, features y checks) y `docs/roadmap.md` con el estado de la feature 002
- [ ] T162 Verificar el despliegue según `quickstart.md`: aprovisionar, retirar `OWNER_INITIAL_PASSWORD` del entorno y comprobar que la cookie `__Host-` exige HTTPS
- [ ] T163 Ejecutar `npm run test:all`, `npm run lint` y `npm run check:layers` en verde, con cero tests saltados
- [ ] T164 Recorrer los 27 pasos de la comprobación rápida de `quickstart.md` a mano, y los del listado otra vez a 1280 px

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de la Fase 1. **Bloquea todas las historias.**
- **US1 (Fase 3)**: depende de la Fase 2. **Bloquea US2 … US10**, porque entrega `requireOwnerSession()`, sin el cual ninguna pantalla ni handler de gestión puede existir sin filtrar datos (FR-002).
- **US10 (Fase 4b)**: depende de US1 y de la Fase 2 (`cancelled_by`, citas con servicios). Tiene pantalla propia, `reservas/page.tsx`, y no toca `agenda/page.tsx`; sólo su e2e del escenario 7 —ir de una fila a la agenda— necesita T068 (US2). Las cancelaciones hechas por la dueña aparecen cuando existe US5, pero el listado ya las muestra con los datos de prueba.
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
- **US11**: depende de US6 (`buildResolutionPlan`, `applyPlan`, el diálogo de conflicto) y de US5 (las acciones sobre una cita en la agenda). Su dominio puro —T197, T198, T205 y T206— puede adelantarse en cuanto exista `detectConflicts` (US4).
- **Texto de la cancelación del cliente (T194–T196)**: va en US5 porque el caso que importa, «El salón ha cancelado esta cita», sólo existe cuando la dueña puede cancelar. Depende de `cancelled_by` (Fase 2).
- **Polish (Fase 12)**: depende de todas las historias que se quieran entregar.

### Within Each User Story

- Los tests se escriben primero y **deben fallar** antes de implementar. TDD no es negociable.
- Dominio → puertos → infraestructura → casos de uso → handlers → pantallas.
- Los textos de `src/messages/es-ES.ts` se tocan al final de cada historia, porque es un archivo compartido y varias tareas `[P]` chocarían en él.

### Parallel Opportunities

- Fase 1: T002, T003, T004 y T005 en paralelo.
- Fase 2: los doce tests T006–T013 y T165–T168 en paralelo (T165 escribe en `constraints.test.ts`, como T007 y T008: esos tres se reparten por bloques `describe`); después las cuatro migraciones **en serie**, por orden.
- Con equipo, una vez cerrada US1, US2 y US10 pueden avanzar a la vez: son las dos pantallas del MVP mínimo y no comparten archivos.
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

El MVP de esta feature **no es una sola historia**: es US1, US2 y US10. Un acceso privado que no enseña nada no sustituye al papel, una agenda sin frontera de acceso viola FR-002, y sin el listado la dueña no se entera de las reservas online nuevas mientras v1 no avisa. El corte mínimo desplegable es:

1. Fase 1: Setup
2. Fase 2: Foundational (crítica — bloquea todo)
3. Fase 3: US1 — la frontera de acceso, con el barrido de SC-001 en verde
4. Fase 4: US2 — la agenda del día
5. Fase 4b: US10 — el listado de reservas
6. **PARAR Y VALIDAR**, en el navegador y con la dueña del producto: ve su día y todas sus reservas, y nadie más las ve.

### Incremental Delivery

1. Setup + Foundational → los cierres migrados, la configuración editable en vivo y quién canceló registrado
2. US1 + US2 + US10 → MVP mínimo desplegable
3. US3 → el hueco fantasma resuelto
4. US4 + US5 + US6 + US11 → la gestión manual completa, con la garantía de no-superposición intacta
5. US7 + US8 + US9 → la autonomía de configuración
6. Fase 12 → pulido y validación final

### Riesgos a vigilar

- **La Fase 2 toca código en verde de la 001.** Cada línea de la tabla "Lo que esta feature modifica de la 001" de [plan.md](./plan.md) es trabajo de migración con su test de regresión, no un ajuste de paso.
- **La migración 0005 es la única que convierte cierres y la única que borra una tabla.** Su test es innegociable. La 0006 también convierte datos —marca como del cliente las cancelaciones existentes— y tiene el suyo (T165).
- **La migración 0007 impone el `EXCLUDE` de `opening_interval` sobre datos ya cargados.** Si falla, falla ahí y no a medio camino: es el comportamiento correcto.
- **Los servicios de cada cita se leen en la misma consulta, en la agenda y en el listado.** Una consulta por cita es la trampa natural al pintar varios servicios; T062 y T175 la cazan.
- **El diálogo de conflicto es el punto de mayor riesgo de PII en logs** y el de mayor riesgo de trampa de foco. Recibe atención doble: T070, T118, T113 y T158.

---

## Notes

- Las tareas `[P]` tocan archivos distintos y no dependen de nada pendiente.
- Toda función pública de dominio devuelve `Result<T, E>` con sus fallos tipados. Sin excepciones para flujo de control.
- Código, identificadores y commits en inglés; textos de producto en español, todos en `src/messages/es-ES.ts`.
- Commit por tarea o por grupo lógico, en Conventional Commits.
- Nada de código muerto, comentado ni TODOs en `main`. Cero tests saltados.
