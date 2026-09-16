# Implementation Plan: Gestión del salón (cara a la dueña) v1

**Branch**: `002-salon-management` | **Date**: 2026-09-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-salon-management/spec.md`

## Summary

La dueña entra con usuario y contraseña, ve la agenda de su día, apunta y mueve citas a mano, bloquea ratos, y edita el horario, el catálogo y dos parámetros de reserva. Los requisitos nucleares son tres: que **sin credencial no se filtre un solo dato** (FR-002, SC-001), que **dos citas confirmadas no puedan solaparse jamás** —tampoco por acción manual ni resolviendo un conflicto (BR-001, FR-035, SC-004)— y que **todo cambio de configuración rija en la siguiente consulta del cliente, sin despliegue ni reinicio** (FR-056, SC-003, SC-007, SC-009).

La feature no arranca de cero: extiende la aplicación de la `001-client-appointment-booking`, conserva su arquitectura hexagonal y su garantía de base de datos, y convierte en editable lo que allí era configuración de arranque. Cuatro decisiones la sostienen:

1. **La sesión es una fila, no un token firmado.** 32 bytes de CSPRNG en una cookie `__Host-`, con sólo su hash SHA-256 en la base. Es el mismo patrón que la 001 aplicó al enlace de gestión del cliente, y es lo único que permite que cerrar sesión y caducar por inactividad signifiquen algo (FR-006, FR-007, D-015).
2. **La frontera de acceso se comprueba en cada handler, no en el middleware.** El middleware sólo redirige; si desapareciera, ninguna respuesta filtraría un dato. Es lo que el Principio V pide literalmente —autorización *en el endpoint*— y lo que evita que un fallo en una capa transversal se convierta en una fuga de la agenda entera (D-018).
3. **El conflicto se calcula en el dominio como un plan, y se aplica en una sola transacción.** El plan es un dato puro que **nombra** lo que estorba antes de tocar nada, y es a la vez la unidad indivisible que la infraestructura aplica. "Mantener ambas" no se rechaza: no se puede expresar (FR-033, FR-035, FR-037, D-023).
4. **Se acabó el caché de configuración.** La 001 memorizaba la configuración para siempre porque era inmutable. Ahora no lo es, y un caché sin invalidación incumpliría FR-056 por construcción. Se lee en cada evaluación, y una prueba de rendimiento que cuenta consultas es lo que impide que vuelva a aparecer (D-021).

## Technical Context

**Language/Version**: TypeScript 5.7 en modo `strict` (con `noUncheckedIndexedAccess`), Node.js 22 LTS. Sin cambios.

**Primary Dependencies**: las mismas de la 001, **sin añadir ninguna**.

- Next.js 15 (App Router) + React 19 — con el mínimo elevado a **15.2.3** (D-018)
- `@js-temporal/polyfill` — toda la aritmética de calendario de periodos, tramos y caducidades
- Drizzle ORM + `drizzle-kit` + `pg` — cuatro migraciones SQL nuevas, escritas a mano
- Zod 3 — validación de la frontera HTTP de `/api/gestion`
- Pino — logging con redacción de PII, ahora también en las pantallas que **muestran** PII
- `node:crypto` — `scrypt` para la contraseña y SHA-256 para el token de sesión. Biblioteca estándar: **ninguna dependencia nativa nueva** (D-016)

**Storage**: PostgreSQL 16 con `btree_gist`. Dos tablas nuevas (`owner_account`, `owner_session`), una que sustituye a otra (`unavailable_period` reemplaza a `closure`) y columnas nuevas en `salon` y `appointment`.

**Testing**: Vitest + Playwright + `@axe-core/playwright`, contra PostgreSQL real. Tres tipos de prueba propios de esta feature: barrido de acceso sin sesión, concurrencia de dos escritores solapados e indistinguibilidad de la respuesta de acceso (D-029).

**Target Platform**: contenedor Linux sobre VPS, un proceso por salón. Sin cambios. **HTTPS pasa de exigencia constitucional a exigencia funcional**: la cookie `__Host-` no funciona sin él.

**Project Type**: aplicación web renderizada en servidor con API HTTP propia. La misma aplicación de la 001 con una segunda cara.

**Performance Goals**:

- Agenda de un día en **menos de 2 s** en móvil de gama media sobre 4G, con tiempo invariante frente al crecimiento del histórico (SC-010)
- Apertura de un día: **número fijo de consultas**, sin ningún bucle por franjas que toque la base (D-027)
- Disponibilidad del cliente: sigue siendo **una sola consulta** del horizonte (D-003, intacta)
- Coste añadido por la retirada del caché de configuración: un viaje de cuatro `SELECT` sobre tablas de decenas de filas, medido y acotado en la suite (D-021)

**Constraints**:

- Ninguna decisión temporal usa el reloj del dispositivo, ni siquiera el de la dueña (BR-015 de la 001)
- Nombre, teléfono y email **se muestran** en estas pantallas y **no entran** en logs, trazas ni analítica (FR-057). El diálogo de conflicto es el punto de mayor riesgo
- La contraseña no se almacena de forma recuperable ni aparece en ningún log, ni parcialmente (FR-010)
- **No se almacena ninguna dirección IP** en el flujo de acceso: el bloqueo es por cuenta (FR-009, D-017)
- Interfaz operable a 360 px, WCAG 2.2 AA, estado siempre con texto además de color (FR-058)
- Sin mensajería saliente. Tampoco cuando la dueña cancela o mueve una cita reservada online (FR-043)
- Sin registro de auditoría: no se guarda quién cambió qué

**Scale/Scope**: un salón, un sillón, una cuenta, un idioma. Seis pantallas de gestión —acceso, agenda, horario, servicios, parámetros y cambio de contraseña— más el diálogo de conflicto, que es modal y transversal. Diecinueve operaciones HTTP sobre catorce rutas bajo `/api/gestion`. Sesiones vivas simultáneas: dos o tres, las de la tablet y el móvil de la misma persona.

### Parámetros fijados en esta fase

La especificación difiere a `/speckit-plan` lo que sigue. Queda fijado aquí:

| Parámetro | Valor | Origen |
|---|---|---|
| Algoritmo de contraseña | `scrypt` de `node:crypto`, `N=2^17, r=8, p=1`, sal de 16 B | **fijado aquí**, D-016 |
| Longitud mínima de contraseña | **12 caracteres**, sin reglas de composición | **fijado aquí**, FR-004 |
| Caducidad de sesión | 12 h de inactividad, deslizante | Asunción de la especificación |
| Precisión del deslizamiento | Se refresca como mucho **cada 5 min** | **fijado aquí**, D-015 |
| Cookie de sesión | `__Host-owner_session`; `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` | **fijado aquí**, D-015 |
| Límite de intentos | 5 fallos / 15 min → 15 min de bloqueo, **por cuenta** | Asunción + clarificación 2026-09-16 |
| Rejilla de inicios de la dueña | **Múltiplos de 15 min** | **fijado aquí**, D-025 |
| Granularidad de los periodos | Múltiplos de 15 min | Asunción de la especificación |
| Antelación mínima: rango | 0–48 h, en horas completas | Asunción de la especificación |
| Plazo de cancelación: rango | 0–72 h, en horas completas | Asunción de la especificación |
| Prefijo de rutas de gestión | `/gestion` y `/api/gestion` | **fijado aquí**, D-028 |
| Aprovisionamiento de la credencial | `npm run owner:provision`, fuera de la app | **fijado aquí**, FR-003 |
| Versión mínima de Next.js | **15.2.3** | **fijado aquí**, D-018 |

Los valores por defecto de los dos parámetros editables son exactamente los que la 001 fijó —2 h y 24 h—, de modo que la migración los hace editables sin cambiar el comportamiento de ninguna instancia existente.

### Lo que esta feature modifica de la 001

No es una feature aditiva y conviene tenerlo a la vista antes de empezar:

| Pieza de la 001 | Cambio | Decisión |
|---|---|---|
| Tabla `closure` y tipo `Closure` | **Desaparecen.** Los sustituye `unavailable_period` | D-019 |
| `computeDaySlots`, `computeRangeDays` | `isClosed: boolean` → `unavailablePeriods` | D-019, D-020 |
| `SalonConfigRepository.load()` | Deja de cachear | D-021 |
| `DEFAULT_BOOKING_POLICY` | Dos de sus siete campos pasan a leerse de la base | D-022 |
| `CustomerContact.email` | `string` → `string \| null` | D-026 |
| `appointment_anonymization_is_atomic` | Reescrita: email y enlace opcionales según el origen | D-026 |
| `confirmBooking` | Modo de fallo nuevo: `SERVICE_UNAVAILABLE` | US8-6 |
| `tests/contract/helpers/openapi.ts` | Se parametriza para validar contra dos contratos | D-028 |
| `package.json` | `next >= 15.2.3`; comando `owner:provision` | D-018 |

Cada una de esas líneas es trabajo de migración con test de regresión propio, no un ajuste de paso.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la Constitución v1.0.0.

| Principio | Estado | Cómo lo satisface este diseño |
|---|---|---|
| **I. Calidad de código y separación de capas** | ✅ PASS | `src/domain` sigue siendo TypeScript puro, verificado en CI. Las reglas nuevas viven **sólo** en el dominio: las exenciones de la dueña en `owner/manual-booking`, la detección y resolución de conflictos en `owner/conflict`, los rangos de los parámetros en `catalog/booking-params`. La pantalla de parámetros **no reescribe los límites**: los recibe del dominio a través de la API (FR-054). El plan de resolución es un dato puro; aplicarlo transaccionalmente es cosa de `infrastructure` (D-023). Toda función pública nueva devuelve `Result<T, E>` con sus fallos tipados. |
| **II. Disciplina de testing** | ✅ PASS | TDD obligatorio, sin excepciones, también para las migraciones y para los cambios de la 001. Los cinco casos límite de la constitución siguen cubiertos y cuatro ganan la cara de la dueña: doble reserva y solapamiento ahora también por acción manual y por resolución; petición fuera de horario ahora además como **aviso**; cancelación fuera de plazo ahora con la dueña exenta. El quinto —recordatorio de cita cancelada— sigue sin aplicar. Cada historia tiene su e2e. Cero tests saltados. |
| **III. Minimización de datos personales** | ✅ PASS | **Ningún campo personal nuevo.** El email pasa a poder faltar: menos dato, no más. `owner_account` no contiene datos de clientes y **no guarda ninguna IP** (FR-009). Las citas manuales siguen la misma política de retención de 12 meses y la misma anonimización atómica. La redacción de Pino se extiende a los cuerpos de conflicto, que llevan el nombre del cliente. La condición que la 001 dejó abierta —borrado a petición mediante el comando de purga— sigue cubierta y sin cambios. |
| **IV. Comunicaciones y consentimiento** | ➖ N/A | v1 sigue sin enviar nada. Esta feature **refuerza** el principio en vez de tensarlo: no crea ningún canal, y FR-043 convierte la ausencia de aviso en información explícita para la dueña, con el teléfono a mano para llamar. Ningún código de esta feature envía nada. |
| **V. Seguridad** | ✅ PASS | FR-002 es la aplicación directa del principio, y esta feature resuelve los dos [TBD] que lo dejaban colgando: **modelo de roles** (rol único, sin jerarquía: FR-001) y **método de autenticación del personal** (usuario y contraseña, aprovisionada fuera de la app: FR-003, D-015, D-016). Toda entrada se revalida en servidor con Zod más reglas de dominio. La autorización se comprueba **en cada handler**, no en el middleware, y un test de barrido lo verifica ruta por ruta (D-018, SC-001). Contraseña con derivación de coste de memoria, sesión opaca con sólo el hash en la base, bloqueo por intentos, respuesta indistinguible en cuerpo **y en tiempo**. Cookie `__Host-` con `SameSite=Strict`. Secretos fuera del repositorio; `OWNER_INITIAL_PASSWORD` es de un solo uso y se retira del entorno tras aprovisionar. |
| **VI. Experiencia de usuario** | ⚠️ PASS con nota | Apuntar una cita son cuatro toques desde la agenda abierta (SC-002). Los huecos que ve el cliente siguen siendo disponibilidad real porque los calcula el mismo código que luego autoriza, y ahora además restan los periodos. Toda acción devuelve carga, éxito o error accionable (FR-059). Cancelar pide confirmación explícita nombrando lo que se va a cancelar (FR-040). Mobile-first a 360 px, que aquí es el escenario real: la dueña usa la tablet de pie. **Nota**: el principio pide que las acciones destructivas sean "reversibles cuando sea posible", y la cancelación es **terminal** (FR-042, BR-008). Justificación en [Complexity Tracking](#complexity-tracking). |
| **VII. Accesibilidad** | ✅ PASS | HTML semántico en las seis pantallas. El origen de cada cita y su estado se comunican con **texto e icono además de color** (FR-013, FR-058). La línea temporal es una lista, no una rejilla absoluta, para que se lea con lector de pantalla y se recorra con teclado. El diálogo de conflicto es un `dialog` modal con foco atrapado a propósito, devuelto al elemento que lo abrió al cerrarse, y con el conflicto anunciado en `aria-live`: es el elemento de mayor riesgo y el que más atención de axe recibe. `@axe-core/playwright` falla el build ante cualquier violación AA. |
| **VIII. Rendimiento** | ⚠️ PASS con vigilancia | La agenda de un día se resuelve con un número **fijo** de consultas y se deriva en memoria; el índice GiST sobre el rango del periodo evita el escaneo al buscar periodos largos (D-027). La disponibilidad del cliente sigue siendo una sola consulta. **El punto a vigilar es la retirada del caché de configuración** (D-021): añade un viaje de cuatro `SELECT` a cada evaluación. Se acepta porque las cuatro tablas suman decenas de filas y porque FR-056 no admite otra cosa, y se vigila con una prueba que cuenta consultas y falla si alguien introduce un N+1 o si el coste se dispara. |

**Veredicto del gate previo a Fase 0**: aprobado. La única desviación —la irreversibilidad de la cancelación— está justificada abajo y no requiere enmienda de la constitución.

**Sobre los [TBD] de la constitución**: esta feature cierra dos —roles del personal y método de autenticación— y amplía un tercero —parámetros temporales del dominio, que pasan a ser parcialmente editables—. La Governance prevé exactamente esta vía: "un punto marcado [TBD] … es una decisión pendiente que debe tomarse y documentarse en la fase de especificación o plan correspondiente". No hay enmienda que proponer; hay decisiones que documentar, y están en [research.md](./research.md).

**Re-evaluación posterior a Fase 1**: ver [Constitution Re-Check](#constitution-re-check-post-design) al final.

## Project Structure

### Documentation (this feature)

```text
specs/002-salon-management/
├── plan.md              # Este archivo
├── research.md          # Fase 0: D-015 … D-029, y lo descartado
├── data-model.md        # Fase 1: entidades nuevas, cambios y migraciones
├── quickstart.md        # Fase 1: arranque, aprovisionamiento y validación
├── contracts/
│   ├── owner-api.yaml   # OpenAPI 3.1 de /api/gestion
│   └── domain-api.md    # Contratos tipados del dominio nuevo y de lo que cambia
├── checklists/          # Ya existente
└── tasks.md             # Fase 2: generado por /speckit-tasks, NO por este comando
```

### Source Code (repository root)

Sobre la estructura de la 001. `+` es nuevo, `~` es modificado, `-` desaparece.

```text
src/
├── domain/                              # TypeScript puro. Frontera verificada en CI.
│   ├── catalog/
│   │   ├── salon.ts                   ~ Closure fuera; UnavailablePeriod dentro;
│   │   │                                policy con dos campos que vienen de la base
│   │   ├── schedule-edit.ts           + validación de tramos y citas que quedan fuera
│   │   ├── service-edit.ts            + duración, precio y "no queda ninguno activo"
│   │   └── booking-params.ts          + rangos admitidos, en un solo sitio
│   ├── contact/contact.ts             ~ el email pasa a ser opcional
│   ├── availability/
│   │   ├── interval-math.ts           + restar intervalos: tiempo libre y CLOSED/FULL
│   │   ├── compute-day.ts             ~ los periodos entran como ocupados
│   │   └── compute-range.ts           ~ CLOSED cuando no queda apertura libre
│   ├── booking/confirm.ts             ~ SERVICE_UNAVAILABLE
│   └── owner/                         + toda la lógica de la cara de la dueña
│       ├── account.ts                 +   política de bloqueo, pura
│       ├── session.ts                 +   caducidad e intervalo de refresco, puros
│       ├── agenda.ts                  +   la línea temporal y el corte del pasado
│       ├── manual-booking.ts          +   qué bloquea, qué avisa, de qué está exenta
│       └── conflict.ts                +   detectar, nombrar, firmar estado, planificar
│
├── application/
│   ├── ports/index.ts                 ~ PasswordHasher, OwnerAccountRepository,
│   │                                    OwnerSessionRepository,
│   │                                    UnavailablePeriodRepository, SalonConfigWriter,
│   │                                    OwnerAppointmentWriter
│   └── use-cases/
│       ├── sign-in-owner.ts           + y sign-out-owner, change-owner-password
│       ├── authorize-owner-session.ts +   el guardián que usa TODO handler (D-018)
│       ├── get-agenda-day.ts          +
│       ├── create-manual-appointment.ts       +
│       ├── reschedule-appointment-as-owner.ts +
│       ├── cancel-appointment-as-owner.ts     +
│       ├── manage-unavailable-periods.ts      +
│       ├── update-weekly-schedule.ts          +
│       ├── manage-services.ts                 +
│       └── update-booking-parameters.ts       +
│
├── infrastructure/
│   ├── db/
│   │   ├── migrations/0003…0006.sql   + cuenta y sesión; periodos; origen; config
│   │   ├── schema.ts                  ~ tablas nuevas, columnas nuevas, closure fuera
│   │   ├── salon-config-repository.ts ~ sin caché; lee la política de la fila salon
│   │   ├── salon-config-writer.ts     +
│   │   ├── owner-account-repository.ts        +
│   │   ├── owner-session-repository.ts        +
│   │   ├── unavailable-period-repository.ts   +
│   │   └── owner-appointment-writer.ts        +   applyPlan, una transacción
│   └── security/
│       ├── password.ts                +   scrypt, con parámetros en el hash
│       └── session-token.ts           +   32 B de CSPRNG, SHA-256, como D-005
│
├── app/
│   ├── middleware.ts                  +   SÓLO redirige. No autoriza nada (D-018)
│   ├── gestion/                       +   acceso, agenda, horario, servicios,
│   │                                      parámetros, cuenta
│   └── api/gestion/                   +   los Route Handlers de owner-api.yaml
│
├── components/owner/                  +   Timeline, ConflictDialog, ScheduleEditor,
│                                          ServiceList, PeriodForm, ManualBookingForm
└── messages/es-ES.ts                  ~   un bloque `owner` con todos los textos nuevos
scripts/
├── provision-owner.ts                 +   npm run owner:provision
└── retention-purge.ts                 ~   borra además las sesiones caducadas
db/seed/seed.ts                        ~   cierres → periodos de día completo
tests/
├── unit/domain/owner/                 +   el grueso: agenda, exenciones, conflictos
├── integration/
│   ├── security/access-sweep.test.ts  +   SC-001 ruta por ruta
│   ├── concurrency/                   +   dos escritores solapados, base real
│   └── use-cases/                     +   uno por caso de uso nuevo
├── contract/owner/                    +   contra contracts/owner-api.yaml
└── e2e/us1-access … us9-parameters    +   una historia, un archivo, + axe
```

**Structure Decision**: se mantiene el proyecto único con arquitectura hexagonal de la 001, y se añade la cara de la dueña **dentro de las mismas cuatro capas**. Se descartó expresamente sacar la gestión a una segunda aplicación: duplicaría el cálculo de disponibilidad y las reglas de solape —lo que el Principio I prohíbe—, obligaría a sincronizar dos despliegues para un cambio de configuración que FR-056 exige instantáneo, y no compraría ningún aislamiento real, porque las dos caras leen y escriben exactamente la misma agenda.

La dirección de las dependencias sigue siendo estricta: `app` → `application` → `domain`, con `infrastructure` implementando los puertos. El único refuerzo nuevo es que `SalonConfigWriter` es un **puerto aparte** de `SalonConfigRepository`: los casos de uso del cliente dependen sólo del de lectura, y el compilador garantiza que ninguno pueda escribir configuración.

## Complexity Tracking

Una sola desviación que justificar.

| Violación | Por qué es necesaria | Alternativa más simple, y por qué se rechaza |
|---|---|---|
| **Principio VI**: "las acciones destructivas … SON reversibles cuando sea posible". La cancelación de una cita es **terminal** (FR-042, BR-008) | La reversibilidad es imposible aquí, no indeseable: cancelar libera la franja **de inmediato** en la disponibilidad pública, y otro cliente puede reservarla en el mismo segundo. Un botón de deshacer prometería algo que la mitad de las veces fallaría, y fallaría precisamente en el caso en que la dueña más lo necesita | Se consideró una ventana de deshacer que retuviera la franja unos minutos. Se rechaza porque convertiría una franja libre en un hueco fantasma —lo que el mismo Principio VI prohíbe en su segunda regla— y porque el estado "cancelada pero aún reservando sitio" contradice BR-005 de la 001, donde una cita cancelada deja de ocupar su franja en el acto. Se mitiga con lo que el principio sí permite: **confirmación explícita que nombra la cita concreta** antes de aplicar (FR-040), y el teléfono del cliente a mano para rehacerla a mano si hizo falta (FR-043) |

Las cuatro capas y los seis puertos nuevos no son complejidad que justificar: son la forma mínima de cumplir el Principio I sobre un dominio que ahora también escribe configuración. Un diseño con menos capas obligaría a que la regla de "no queda ningún servicio activo" conociera Drizzle.

## Constitution Re-Check (post-design)

Re-evaluación tras generar `research.md`, `data-model.md`, `contracts/` y `quickstart.md`:

- **Principio I**: `contracts/domain-api.md` deja cada función nueva con entrada, salida y modos de fallo tipados. El caso que más podía torcerse —los límites de los parámetros— queda con **un solo origen**, `BOOKING_PARAMETER_LIMITS`, que alimenta a la vez la validación, el mensaje de error y el contrato HTTP; la pantalla no los reescribe. La generalización de `computeDaySlots` concatena citas y periodos **antes** de la única comprobación de solape, en lugar de añadir un segundo bucle: una regla, un sitio. ✅
- **Principio II**: nada del diseño exige infraestructura para probarse. La agenda, las exenciones, los conflictos, el bloqueo de 15 minutos y la caducidad de 12 horas son funciones puras sobre un reloj inyectado. Lo que sí exige base de datos real —concurrencia, atomicidad, migración de cierres— está identificado y tiene su prueba de integración nombrada. ✅
- **Principio III**: `data-model.md` confirma que no hay ningún campo personal nuevo, que `owner_account` no tiene columna de IP ni de dispositivo, y que la restricción de anonimización atómica **conserva entera** su garantía al relajarse: sigue siendo imposible una cita medio anonimizada, y ahora también una cita manual con enlace de gestión. ✅
- **Principio V**: el contrato HTTP fija que la respuesta a un acceso rechazado es **idéntica** en cuerpo, código y cabeceras para usuario inexistente, contraseña incorrecta y cuenta bloqueada, sin `Retry-After` ni nada que delate la existencia de un límite; y D-017 añade la verificación señuelo para que tampoco el tiempo los distinga. `Unauthorized` es un cuerpo sin ningún dato. La seguridad de la API se declara a nivel de documento y sólo `POST /gestion/sesion` la exime. ✅
- **Principio VI**: el protocolo de dos pasos del contrato hace imposible aplicar un cambio sin que la dueña haya visto antes qué estorba, y `Resolution` **no tiene forma de expresar "mantener ambas"**. Rechazar el aviso no envía nada: el primer paso ya es de sólo lectura. ✅
- **Principio VIII**: `GET /gestion/agenda` está especificado para devolver la línea temporal completa —citas, periodos y tiempo libre— **en una sola respuesta**, alimentada por un número fijo de consultas. El índice GiST sobre el rango del periodo está en el modelo de datos, no como idea suelta. La vigilancia sobre la retirada del caché queda anclada en una prueba concreta, `config-propagation`, y en `agenda-performance`. ✅

**Veredicto posterior al diseño**: aprobado. La única desviación sigue siendo la del Principio VI, justificada y mitigada arriba. Sin enmienda de la constitución que proponer.
