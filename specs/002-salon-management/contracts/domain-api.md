# Contratos de la capa de dominio — gestión del salón

**Feature**: `002-salon-management` | **Date**: 2026-09-16

Continúa [`../../001-client-appointment-booking/contracts/domain-api.md`](../../001-client-appointment-booking/contracts/domain-api.md), cuyas dos reglas transversales siguen intactas:

1. **`src/domain` no importa nada del framework ni de la base de datos.** Verificado en CI con `dependency-cruiser`.
2. **Ninguna función de dominio lanza excepciones para fallos esperados.** Devuelven `Result<T, E>` con `E` enumerando los modos de fallo en el tipo.

Este documento fija los contratos **nuevos** y los **cambios** sobre los de la 001. Lo que no aparece, no cambia.

---

## Cambios en contratos existentes

### `computeDaySlots` — el cierre deja de ser un booleano

```diff
 export function computeDaySlots(input: {
   readonly date: Temporal.PlainDate;
   readonly openingIntervals: readonly OpeningInterval[];
-  readonly isClosed: boolean;
+  readonly unavailablePeriods: readonly BusyInterval[];   // D-019
   readonly serviceDurationMinutes: number;
   readonly confirmedAppointments: readonly BusyInterval[];
   readonly now: Temporal.Instant;
   readonly policy: BookingPolicy;
   readonly timezone: string;
   readonly currentAppointmentStart?: Temporal.Instant;
 }): readonly Slot[];
```

**Contrato**: las cuatro condiciones de FR-003 siguen siendo cuatro. La condición (b) se generaliza:

| # | Condición | Requisito |
|---|---|---|
| a | Cabe entero dentro de un mismo tramo de apertura | FR-003a, FR-007a |
| b | **No solapa ninguna cita confirmada ni ningún periodo no disponible** | FR-003b, BR-001, **BR-002** |
| c | `inicio >= now + policy.minimumLeadTime` | FR-003c, BR-003 |
| d | `inicio` cae dentro del horizonte | FR-003d, BR-011 |

La implementación concatena citas y periodos en una sola lista de ocupados antes de comprobar (b). **Una regla de solape, un solo sitio**: la misma media abierta `[)` de BR-013, la misma función `overlaps`. Añadir un segundo bucle para los periodos sería duplicar la regla, que es lo que el Principio I prohíbe.

`policy` deja de venir siempre de `DEFAULT_BOOKING_POLICY`: sus dos primeros campos se leen ahora de la configuración del salón (D-022). El tipo no cambia, y por eso ninguna de las llamadas existentes se rompe.

### `computeRangeDays` — `CLOSED` cuando no queda apertura libre

Mismo cambio de entrada. El contrato de salida gana una precisión (D-020):

- `CLOSED` ⟸ el día no tiene tramos de apertura **o** los periodos no disponibles cubren toda su apertura.
- `FULL` ⟸ queda apertura sin cubrir, pero ningún inicio cabe.
- `AVAILABLE` ⟸ hay al menos un inicio.

Unas vacaciones de una semana se ven como cerradas, no como llenas (escenario 3 de la Historia 3). La distinción es de producto: le dice al cliente si insistir otro día o no.

### `CustomerContact` y `ValidatedContact` — el email puede faltar

```diff
 export type CustomerContact = {
   readonly name: string;
   readonly phone: string;
-  readonly email: string;
+  readonly email: string | null;     // FR-024, D-026
 };
```

**Contrato de `validateContact`**: cuando el email está ausente (`null` o cadena vacía tras recortar), no es un fallo de formato; es un contacto válido sin email. Cuando está presente, se valida exactamente con las mismas reglas que antes (FR-031). El nombre y el teléfono siguen siendo obligatorios en los dos orígenes: son la vía de contacto real del salón (BR-011).

El tipo obliga a cada lector a hacerse cargo del caso ausente, igual que `customer: CustomerContact | null` ya obligaba con la anonimización. No hay ninguna lectura de `.email` que el compilador deje pasar sin tratar.

### `confirmBooking` — el servicio puede haberse retirado mientras tanto

```diff
 export type ConfirmBookingError =
   | 'SLOT_TAKEN'
   | 'OUTSIDE_AVAILABILITY'
   | 'CONTACT_LIMIT_REACHED'
   | 'INVALID_CONTACT'
+  | 'SERVICE_UNAVAILABLE';          // FR: escenario 6 de la Historia 8
```

**Contrato**: el catálogo activo se comprueba **en el instante de confirmar**, no sólo al pintar el formulario. Si la dueña retiró el servicio mientras el cliente rellenaba sus datos, la confirmación se rechaza con un mensaje que lo explica y la cita **no se crea a medias**. Es el precio de que el catálogo sea editable en vivo, y es un modo de fallo nuevo que el tipo obliga a tratar en todos los llamantes.

---

## `owner/agenda` — la línea temporal del día

### `buildAgendaDay`

```typescript
export function buildAgendaDay(input: {
  readonly date: Temporal.PlainDate;
  readonly openingIntervals: readonly OpeningInterval[];
  readonly appointments: readonly Appointment[];      // del día, ya cargadas
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  readonly now: Temporal.Instant;
  readonly timezone: string;
}): AgendaDay;
```

**Función pura.** Sin `Result`: no tiene modos de fallo. Un día sin nada es un `AgendaDay` con `entries` vacío, no un error.

**Contrato**:

- `entries` sale **ordenada cronológicamente y sin solapes entre sí**. El tiempo libre es lo que queda de la apertura tras restar citas y periodos: aparece como tramos `FREE` explícitos, no como el hueco entre dos entradas, para que la pantalla no tenga que deducirlo (FR-011).
- Un periodo y una cita **sí** pueden solaparse entre ellos —un bloqueo no cancela a nadie (FR-022)—, y en ese caso ambas entradas aparecen. Lo que nunca se solapa es un `FREE` con nada.
- `isClosed` sigue la regla de D-020.
- `isReadOnly` es `true` cuando **el día entero** ya pasó. `entry.isPast` de cada cita es `true` cuando **su hora de fin** ya transcurrió (FR-016, BR-009): una cita en curso es `false` y sigue siendo movible.
- Las canceladas sólo aparecen si vienen en `appointments`. Esta función no filtra por estado: filtrar es decisión del caso de uso, que sabe si la dueña pidió verlas (FR-015).

### `isPastSlot`

```typescript
export function isPastSlot(
  endsAt: Temporal.Instant,
  now: Temporal.Instant,
): boolean;
```

**El corte del pasado, en un solo sitio.** Tres reglas distintas lo usan —FR-016, FR-030 y BR-009— y las tres tienen que estar de acuerdo en dónde cae el corte. Compara contra la **hora de fin**, nunca contra la de inicio.

---

## `owner/manual-booking` — las exenciones de la dueña

### `planManualBooking`

```typescript
export function planManualBooking(input: {
  readonly intent: { readonly startsAt: Temporal.Instant;
                     readonly service: ServiceSnapshot;
                     readonly contact: ValidatedContact };
  readonly openingIntervals: readonly OpeningInterval[];
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  readonly futureCountsForContact: { readonly byPhone: number;
                                     readonly byEmail: number };
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
}): Result<ManualBookingPlan, ManualBookingBlocker>;

export type ManualBookingBlocker =
  | 'IN_THE_PAST'              // FR-030, BR-009
  | 'CONTACT_LIMIT_REACHED'    // FR-029, BR-007
  | 'INVALID_START_GRANULARITY';  // no es múltiplo de 15 min (D-025)

export type ManualBookingPlan = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;       // derivada del servicio (FR-027)
  readonly conflicts: readonly Conflict[]; // vacía si no estorba nada
  readonly warnings: readonly ManualBookingWarning[];
};

export type ManualBookingWarning = 'OUTSIDE_OPENING_HOURS';  // FR-028, avisa, no bloquea
```

**Contrato**: la tabla de D-025, y nada más. Lo que bloquea va en el canal de error; lo que avisa viaja **dentro del éxito**, porque un aviso no impide nada: exige acuse.

Tres cosas que esta función **no** comprueba, y es deliberado (BR-007): la antelación mínima, el horizonte de reserva y el plazo de cancelación. No aparecen ni como bloqueo ni como aviso. Una cita a las 17:00 cuando son las 16:40 y la antelación es de dos horas se crea **sin objeción** (escenario 3 de la Historia 4).

El formato del contacto no es un bloqueo de esta función: llega ya como `ValidatedContact`, validado por `validateContact` (FR-031). Una función, una responsabilidad.

`endsAt` se deriva siempre del servicio. No hay ninguna entrada que permita fijar otra duración: editar la duración de una cita concreta está fuera de alcance.

---

## `owner/conflict` — detectar, nombrar y resolver

### `detectConflicts`

```typescript
export function detectConflicts(input: {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly appointments: readonly Appointment[];
  readonly periods: readonly UnavailablePeriod[];
  /** Al reprogramar: la propia cita no estorba a su propio movimiento. */
  readonly excludeAppointmentId?: AppointmentId;
}): readonly Conflict[];
```

**Función pura, misma media abierta `[)` de BR-013.** Devuelve cada elemento que se solapa, **con lo que hace falta para nombrarlo** (FR-033): nombre del cliente, servicio y franja para una cita; franja y motivo para un periodo. Un `Conflict` que no se pudiera enseñar no serviría de nada, y por eso el tipo no admite un identificador a secas.

Solapar **por poco es solapar**: un minuto de intersección produce el mismo conflicto que la coincidencia total (clarificación del 2026-09-16).

### `computeStateToken`

```typescript
export function computeStateToken(
  conflicts: readonly Conflict[],
  hash: (input: string) => string,     // puerto: el dominio no conoce node:crypto
): string;
```

**Contrato**: determinista y estable frente al orden —ordena antes de hashear— y sensible a **cualquier** cambio en los elementos en conflicto. El hash se inyecta porque `node:crypto` está prohibido en el dominio; el adaptador vive en `infrastructure/security`.

No es un secreto y no autoriza nada. Es la huella que FR-038 compara.

### `buildResolutionPlan`

```typescript
export function buildResolutionPlan(input: {
  readonly intent: ResolutionIntent;
  readonly conflicts: readonly Conflict[];
  readonly resolution: Resolution;     // lo que la dueña eligió
}): Result<ResolutionPlan, ResolutionError>;

export type ResolutionError =
  | 'UNRESOLVED_CONFLICT'      // queda algo sin resolver: FR-034, FR-035
  | 'UNKNOWN_TARGET'           // resuelve algo que no está en conflicto
  | 'SHORTENING_DOES_NOT_FIT'; // el recorte sigue solapando
```

**Contrato**, y aquí está el corazón de BR-001 y FR-035:

- El plan sólo es válido si **todos** los conflictos con citas quedan resueltos. `UNRESOLVED_CONFLICT` es lo que hace imposible "mantener ambas": el sistema no tiene ninguna entrada que signifique eso, y la clarificación del 2026-09-15 lo retiró expresamente del alcance. No es que se rechace: es que **no se puede expresar**.
- Un conflicto con un **periodo** admite tres salidas: eliminarlo, recortarlo hasta que deje sitio, o —sólo al crear un periodo sobre citas existentes— acusarlo sin tocar nada (FR-022).
- `SHORTENING_DOES_NOT_FIT` se comprueba aquí y no en la pantalla: la UI puede anticipar el resultado, nunca decidirlo.
- El plan **no se aplica**: es un valor. Aplicarlo es cosa de `OwnerAppointmentWriter.applyPlan`, en una sola transacción (D-023).

---

## `catalog/schedule-edit` — validar el horario

### `validateDaySchedule`

```typescript
export function validateDaySchedule(
  stretches: readonly { startsAt: Temporal.PlainTime;
                        endsAt: Temporal.PlainTime }[],
): Result<readonly OpeningInterval[], ScheduleError>;

export type ScheduleError =
  | { readonly kind: 'END_NOT_AFTER_START'; readonly index: number }
  | { readonly kind: 'OVERLAPPING_STRETCHES'; readonly first: number;
      readonly second: number };
```

**Contrato**: el error dice **cuál** es el problema y **dónde**, porque FR-045 exige explicar el motivo del rechazo, y un `false` no explica nada. Una lista vacía es válida: es un día cerrado (FR-046).

Que ningún tramo cruce la medianoche se sigue de que ambos extremos sean `PlainTime` del mismo día y de que el inicio preceda al fin: no necesita comprobación aparte.

### `appointmentsOutsideSchedule`

```typescript
export function appointmentsOutsideSchedule(input: {
  readonly weekday: Weekday;
  readonly stretches: readonly OpeningInterval[];
  readonly confirmedAppointments: readonly Appointment[];
  readonly timezone: string;
}): readonly Appointment[];
```

**Contrato**: devuelve las citas confirmadas que dejarían de caber en el horario nuevo. **No las cancela, no las mueve y no impide el cambio** (FR-047, BR-004). Es una lista para enseñar antes de guardar; lo que se haga con ella lo decide la dueña, cita a cita.

---

## `catalog/service-edit` — validar el catálogo

```typescript
export function validateService(input: {
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
}): Result<ValidatedServiceInput, ServiceError>;

export type ServiceError = 'EMPTY_NAME' | 'NON_POSITIVE_DURATION' | 'NEGATIVE_PRICE';

export function canRetireService(input: {
  readonly activeServiceCount: number;
}): Result<void, 'LAST_ACTIVE_SERVICE'>;
```

**Contrato de `canRetireService`**: el catálogo nunca queda sin servicios activos (FR-051, BR-010). La regla es del dominio; el recuento se lo dan hecho, y el caso de uso lo obtiene **dentro de la transacción** que retira, para que dos retiradas simultáneas no dejen el catálogo vacío entre las dos.

Volver a activar no tiene regla: siempre se puede (FR-050).

---

## `catalog/booking-params` — validar los parámetros

```typescript
export const BOOKING_PARAMETER_LIMITS = {
  minimumLeadTimeHours: { min: 0, max: 48 },
  cancellationDeadlineHours: { min: 0, max: 72 },
} as const;

export function validateBookingParameters(input: {
  readonly minimumLeadTimeHours: number;
  readonly cancellationDeadlineHours: number;
}): Result<BookingParameterUpdate, BookingParameterError>;

export type BookingParameterError = {
  readonly parameter: 'minimumLeadTimeHours' | 'cancellationDeadlineHours';
  readonly min: number;
  readonly max: number;
};
```

**Contrato**: el error **lleva los límites dentro**. FR-054 pide que los rangos se expliquen en pantalla, y la única forma de que el mensaje no los reescriba por su cuenta —duplicando la regla— es que se los dé el dominio. `BOOKING_PARAMETER_LIMITS` es también lo que alimenta `GET /gestion/parametros`: un solo origen para el formulario, el mensaje de error y el contrato HTTP.

Horas completas, no minutos: es lo que la especificación fija y lo que la dueña entiende.

---

## `owner/account` y `owner/session` — reglas puras de acceso

El dominio no hashea, no consulta y no toca cookies. Sólo decide.

```typescript
// src/domain/owner/account.ts
export const LOCKOUT_POLICY = {
  maxFailedAttempts: 5,
  windowMinutes: 15,
  lockMinutes: 15,
} as const;

export function evaluateLockout(input: {
  readonly failedAttempts: number;
  readonly firstFailedAttemptAt: Temporal.Instant | null;
  readonly lockedUntil: Temporal.Instant | null;
  readonly now: Temporal.Instant;
}): { readonly isLocked: boolean; readonly windowExpired: boolean };

export function registerFailure(input: { /* mismo estado + now */ }):
  { readonly failedAttempts: number;
    readonly firstFailedAttemptAt: Temporal.Instant;
    readonly lockedUntil: Temporal.Instant | null };

// src/domain/owner/session.ts
export const SESSION_IDLE_TIMEOUT_HOURS = 12;
export const SESSION_TOUCH_INTERVAL_MINUTES = 5;

export function isSessionAlive(
  lastSeenAt: Temporal.Instant,
  now: Temporal.Instant,
): boolean;

export function shouldTouchSession(
  lastSeenAt: Temporal.Instant,
  now: Temporal.Instant,
): boolean;
```

**Contrato**: funciones puras sobre el reloj inyectado, sin `Date.now()` en ninguna. Es lo que permite probar el bloqueo de 15 minutos y la caducidad de 12 horas sin esperar 15 minutos ni 12 horas, y sin base de datos.

**Un acceso correcto durante el bloqueo no lo levanta**: `evaluateLockout` devuelve `isLocked: true` y el caso de uso rechaza antes de comparar nada. Si lo levantara, acertar al sexto intento eludiría el límite.

---

## Puertos nuevos

```typescript
// src/application/ports — el dominio sigue sin saber que existen

export interface PasswordHasher {
  hash(password: string): Promise<string>;              // scrypt$N$r$p$salt$hash
  verify(password: string, encoded: string): Promise<boolean>;
  /** Verificación señuelo, mismos parámetros, para no filtrar por tiempo (D-017). */
  verifyDecoy(password: string): Promise<void>;
}

export interface OwnerAccountRepository {
  findByUsername(username: string): Promise<OwnerAccountRecord | null>;
  registerFailedAttempt(id: string, state: LockoutState): Promise<void>;
  clearFailedAttempts(id: string): Promise<void>;
  updatePassword(id: string, encoded: string, at: Temporal.Instant): Promise<void>;
}

export interface OwnerSessionRepository {
  create(accountId: string, hash: Uint8Array, at: Temporal.Instant): Promise<void>;
  findAliveByHash(hash: Uint8Array, now: Temporal.Instant): Promise<OwnerSession | null>;
  touch(id: string, at: Temporal.Instant): Promise<void>;
  delete(hash: Uint8Array): Promise<void>;
  deleteAllExcept(accountId: string, keepHash: Uint8Array): Promise<void>;
  deleteExpired(before: Temporal.Instant): Promise<number>;
}

export interface UnavailablePeriodRepository {
  findOverlapping(from: Temporal.Instant,
                  to: Temporal.Instant): Promise<readonly UnavailablePeriod[]>;
  insert(period: NewUnavailablePeriod): Promise<UnavailablePeriod>;
  shorten(id: string, startsAt: Temporal.Instant,
          endsAt: Temporal.Instant): Promise<UnavailablePeriod>;
  delete(id: string): Promise<void>;
}

export interface SalonConfigWriter {
  replaceDaySchedule(weekday: Weekday,
                     stretches: readonly OpeningInterval[]): Promise<void>;
  createService(input: ValidatedServiceInput): Promise<Service>;
  updateService(id: string, input: ValidatedServiceInput): Promise<Service>;
  /** Cuenta los activos y decide dentro de la MISMA transacción (FR-051). */
  setServiceActive(id: string, isActive: boolean):
    Promise<Result<Service, 'LAST_ACTIVE_SERVICE'>>;
  updateBookingParameters(update: BookingParameterUpdate): Promise<void>;
}

export interface OwnerAppointmentWriter {
  /** FR-037: el plan entero en UNA transacción, o nada (D-023). */
  applyPlan(plan: ResolutionPlan, expectedStateToken: string):
    Promise<Result<AppliedPlan, 'STATE_CHANGED' | 'SLOT_TAKEN'>>;
}
```

**`SalonConfigWriter` es un puerto aparte de `SalonConfigRepository`**, que sigue siendo de sólo lectura. Los casos de uso del cliente dependen únicamente del de lectura, y el compilador garantiza que ninguno de ellos pueda escribir configuración.

**`applyPlan` recibe el `stateToken` esperado** y vuelve a detectar el conflicto dentro de la transacción antes de aplicar nada. `STATE_CHANGED` es la respuesta cuando lo que la dueña vio ya no es lo que hay; una violación `23P01` de la restricción `EXCLUDE` se traduce a ese mismo error, porque significa exactamente lo mismo (D-024).
