# Contratos de la capa de dominio — gestión del salón

**Feature**: `002-salon-management` | **Date**: 2026-09-16 | **Revised**: 2026-11-03 (005, quién canceló y listado de reservas; después, editar una cita y búsqueda en el listado)

Continúa [`../../001-client-appointment-booking/contracts/domain-api.md`](../../001-client-appointment-booking/contracts/domain-api.md) y usa tal cual lo que añadió la [`005-multiple-services`](../../005-multiple-services/contracts/): `NonEmptyServiceList`, `selectServices`, `durationOfServices`, `durationOf` y `totalPriceOf` de `catalog/selection.ts`. Las dos reglas transversales de la 001 siguen intactas:

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
   readonly serviceDurationMinutes: number;               // la suma de la selección (005)
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

**Contrato de `validateContact`** (*concretado al implementar*): recibe quién pide el contacto, `{ email: 'REQUIRED' | 'OPTIONAL' }`. La reserva online pasa `REQUIRED`, porque la 001 pide los tres datos (FR-008 de la 001), y su comportamiento no cambia. La cita a mano y la edición pasan `OPTIONAL`: un email ausente (`null` o cadena vacía tras recortar) no es un fallo de formato, es un contacto válido sin email. Cuando está presente, se valida exactamente con las mismas reglas que antes (FR-031). El nombre y el teléfono siguen siendo obligatorios en los dos casos: son la vía de contacto real del salón (BR-011).

El tipo obliga a cada lector a hacerse cargo del caso ausente, igual que `customer: CustomerContact | null` ya obligaba con la anonimización. No hay ninguna lectura de `.email` que el compilador deje pasar sin tratar.

### `searchableName` — el nombre tal como se busca

```typescript
declare const searchableNameBrand: unique symbol;
export type SearchableName = string & { readonly [searchableNameBrand]: true };

export function searchableName(raw: string): SearchableName;
```

```diff
 export type ValidatedContact = {
   readonly name: CustomerName;
+  readonly searchName: SearchableName;   // D-036
   readonly phone: string;
   readonly normalizedPhone: NormalizedPhone;
   readonly email: string | null;
   readonly normalizedEmail: NormalizedEmail | null;
 };
```

**Contrato**: NFD, sin las marcas U+0300–U+036F, en minúsculas, con los espacios recortados y colapsados. «José  NÚÑEZ» → «jose nunez». Es **la única** definición de cómo se compara un nombre (FR-069): `parseBookingListQuery` la aplica al término buscado, y la columna generada `customer_name_search` la replica en SQL, con un test que exige que coincidan (D-036). Función total, sin `Result`: cualquier cadena tiene su forma buscable.

### `confirmBooking` — el servicio puede haberse retirado mientras tanto

**Ya resuelto por la 005, sin cambios aquí.** `confirmBooking` comprueba la selección con `selectServices` contra el catálogo **activo** en el instante de confirmar (FR-015 de la 005), y un servicio retirado mientras el cliente rellenaba sus datos produce `SERVICE_UNAVAILABLE` con los identificadores que faltan. La cita **no se crea a medias**. Lo único que añade la 002 es el test que retira el servicio desde la gestión, de verdad, entre la consulta y la confirmación (escenario 6 de la Historia 8).

### `Appointment` — origen y quién canceló

```diff
 export type Appointment = {
   readonly id: AppointmentId;
   readonly status: AppointmentStatus;
+  readonly origin: 'ONLINE' | 'OWNER';                   // FR-025, D-026
   readonly startsAt: Temporal.Instant;
   readonly endsAt: Temporal.Instant;
   readonly services: NonEmptyServiceList;                // de la 005
   readonly customer: CustomerContact | null;
   readonly createdAt: Temporal.Instant;
   readonly cancelledAt: Temporal.Instant | null;
+  readonly cancelledBy: CancellationActor | null;        // FR-040a, D-032
   readonly anonymizedAt: Temporal.Instant | null;
 };
+
+export type CancellationActor = 'CUSTOMER' | 'OWNER';
```

`cancelledBy` es `null` si y sólo si `cancelledAt` lo es. Lo imponen el tipo de las dos transiciones de abajo —ninguna fija una sin la otra— y el `CHECK` de la base.

### `applyCancellation` — la del cliente registra que fue el cliente

La firma no cambia. El resultado sí: además de `status: 'CANCELLED'` y `cancelledAt`, fija `cancelledBy: 'CUSTOMER'`. Sus reglas —plazo de cancelación, cita ya cancelada, cita pasada— siguen siendo las de `canCancel`. La cancelación de la dueña **no** pasa por aquí: está exenta del plazo (BR-007) y tiene su propia función, `applyOwnerCancellation`.

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
  readonly startsAt: Temporal.Instant;
  /** De `selectServices` contra el catálogo activo (FR-024, D-030). */
  readonly services: NonEmptyServiceList;
  /** Los del día del inicio, en el salón. */
  readonly openingIntervals: readonly OpeningInterval[];
  /** Las que tocan la franja nueva, para nombrarlas si estorban. */
  readonly appointments: readonly Appointment[];
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  /** `null` al mover: la cita ya contaba y sigue contando lo mismo. */
  readonly futureCountsForContact: { readonly byPhone: number;
                                     readonly byEmail: number } | null;
  /** Al mover: la propia cita no estorba. */
  readonly excludeAppointmentId?: AppointmentId;
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
}): Result<ManualBookingPlan, ManualBookingBlocker>;

export type ManualBookingBlocker =
  | 'IN_THE_PAST'              // FR-030, BR-009: el FIN de la franja ya pasó
  | 'CONTACT_LIMIT_REACHED'    // FR-029, BR-007
  | 'INVALID_START_GRANULARITY';  // no es múltiplo de 15 min (D-025)

export type ManualBookingPlan = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;       // inicio + durationOfServices (FR-027)
  readonly conflicts: readonly Conflict[]; // vacía si no estorba nada
  readonly warnings: readonly ManualBookingWarning[];
};

export type ManualBookingWarning = 'OUTSIDE_OPENING_HOURS';  // FR-028, avisa, no bloquea
```

*Revisado al implementar (paso 6)*: el contacto no entra en la función, porque no decide nada con él; el caso de uso lo lleva a la intención. Recibe citas enteras, no `BusyInterval`, porque un conflicto tiene que poder nombrarlas (FR-033). Cuándo una cita **ya existente** se puede tocar —ni cancelada ni terminada— lo dice `checkOwnerCanChange` de `owner/cancellation`, la misma regla para mover, editar y cancelar.


**Contrato**: la tabla de D-025, y nada más. Lo que bloquea va en el canal de error; lo que avisa viaja **dentro del éxito**, porque un aviso no impide nada: exige acuse.

Tres cosas que esta función **no** comprueba, y es deliberado (BR-007): la antelación mínima, el horizonte de reserva y el plazo de cancelación. No aparecen ni como bloqueo ni como aviso. Una cita a las 17:00 cuando son las 16:40 y la antelación es de dos horas se crea **sin objeción** (escenario 3 de la Historia 4).

El formato del contacto no es un bloqueo de esta función: llega ya como `ValidatedContact`, validado por `validateContact` (FR-031). La selección de servicios tampoco: llega ya como `NonEmptyServiceList`, validada por `selectServices`, cuyos fallos `EMPTY`, `DUPLICATE` y `UNKNOWN_SERVICE` traduce el caso de uso. Una función, una responsabilidad.

`endsAt` se deriva siempre de la suma de los servicios. No hay ninguna entrada que permita fijar otra duración: editar la duración de una cita concreta está fuera de alcance.

### Mover como dueña

No hay función nueva para la duración: mover usa `durationOf(appointment)`, la suma de los snapshots guardados, y nunca el catálogo de hoy (FR-039, BR-020, D-008 de la 005). La planificación del destino es la misma `planManualBooking` con los servicios de la propia cita y `excludeAppointmentId` en la detección de conflictos.

---

## `catalog/selection` — los servicios de una cita editada

### `mergeServiceSelection`

```typescript
export function mergeServiceSelection(input: {
  /** El catálogo entero, activos y retirados, ordenado por `displayOrder`. */
  readonly catalogue: readonly Service[];
  readonly current: NonEmptyServiceList;
  readonly requestedIds: readonly ServiceId[];
}): Result<NonEmptyServiceList, SelectionError>;
```

**Contrato** (FR-072, BR-021, D-035): la misma `SelectionError` de `selectServices` y las mismas reglas —`EMPTY`, `DUPLICATE`, `UNKNOWN_SERVICE`—, con una diferencia que es toda la razón de la función:

- Un identificador que **ya está** en `current` conserva **su** snapshot, tal cual, aunque el servicio esté retirado o haya cambiado de precio o duración.
- Un identificador **nuevo** tiene que ser de un servicio activo; si no, `UNKNOWN_SERVICE`. Su snapshot es `snapshotOf(service)` en ese instante.
- El resultado sale en el orden del catálogo (`displayOrder`), retirados incluidos, como al reservar (FR-014).

Vive junto a `selectServices` y no en `owner/`: es una regla del catálogo sobre qué snapshot vale, y la dueña es sólo quien la usa.

---

## `owner/appointment-edit` — editar una cita

### `planAppointmentEdit`

```typescript
export function planAppointmentEdit(input: {
  readonly appointment: Appointment;
  /** De `mergeServiceSelection` (D-035). */
  readonly services: NonEmptyServiceList;
  /** De `validateContact`, con el email opcional (FR-075). */
  readonly contact: ValidatedContact;
  readonly openingIntervals: readonly OpeningInterval[];
  readonly appointments: readonly Appointment[];          // las que tocan la nueva franja
  readonly unavailablePeriods: readonly UnavailablePeriod[];
  /** Sólo si cambió el teléfono o el email; sin contar la propia cita. */
  readonly futureCountsForNewContact: { readonly byPhone: number;
                                        readonly byEmail: number } | null;
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
}): Result<AppointmentEditPlan, AppointmentEditBlocker>;

export type AppointmentEditBlocker =
  | 'ALREADY_CANCELLED'        // FR-042, BR-008
  | 'IN_THE_PAST'              // su fin ACTUAL ya pasó: isPastSlot (FR-071, BR-009)
  | 'CONTACT_LIMIT_REACHED';   // FR-075, FR-029

export type AppointmentEditPlan = {
  readonly appointmentId: AppointmentId;
  readonly startsAt: Temporal.Instant;     // el de la cita: editar no mueve (FR-073)
  readonly endsAt: Temporal.Instant;       // inicio + durationOfServices(services)
  readonly services: NonEmptyServiceList;
  readonly contact: ValidatedContact;
  readonly conflicts: readonly Conflict[]; // detectConflicts, excluyendo la propia cita
  readonly warnings: readonly ManualBookingWarning[];  // OUTSIDE_OPENING_HOURS
};
```

**Contrato**: la tabla de D-025 aplicada a una franja que empieza donde ya empezaba la cita.

- Bloquea lo mismo que mover, salvo el pasado, que aquí se mide con el **fin actual** de la cita: una cita en curso se edita (FR-071). No hay `INVALID_START_GRANULARITY`, porque el inicio no cambia.
- `conflicts` sólo puede salir no vacía si la cita **se alarga**: acortarla o dejarla igual nunca pisa nada que antes no pisara, y la propia cita está excluida. Es la misma `detectConflicts`, sin una regla de solape propia (Principio I).
- `warnings` lleva `OUTSIDE_OPENING_HOURS` si el **nuevo** fin queda fuera del tramo de apertura, igual que al mover. Como al mover, la antelación mínima, el horizonte y el plazo de cancelación no se miran (BR-007).
- `futureCountsForNewContact` es `null` cuando el contacto no cambió: entonces el límite no se evalúa, porque la cita ya contaba y sigue contando lo mismo.
- No produce ninguna escritura. El plan entra en `buildResolutionPlan` como `EditAppointment` y lo aplica `OwnerAppointmentWriter.applyPlan`, como los demás (D-023).

---

## `owner/cancellation` — la dueña cancela

```typescript
export function applyOwnerCancellation(
  appointment: Appointment,
  now: Temporal.Instant,
): Result<Appointment, OwnerCancellationBlock>;

export type OwnerCancellationBlock =
  | 'ALREADY_CANCELLED'   // FR-042, BR-008
  | 'IN_THE_PAST';        // su hora de fin ya pasó: FR-016, BR-009
```

**Contrato**: devuelve la cita con `status: 'CANCELLED'`, `cancelledAt: now` y `cancelledBy: 'OWNER'` (FR-040a). **No consulta el plazo de cancelación** (BR-007): una cita que empieza dentro de una hora se cancela igual. El corte del pasado es `isPastSlot`, el mismo que usa la agenda: una cita en curso todavía se cancela.

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

**Función pura, misma media abierta `[)` de BR-013.** Devuelve cada elemento que se solapa, **con lo que hace falta para nombrarlo** (FR-033): nombre del cliente, todos sus servicios (`serviceNames`, en el orden del catálogo) y franja para una cita; franja y motivo para un periodo. Un `Conflict` que no se pudiera enseñar no serviría de nada, y por eso el tipo no admite un identificador a secas.

Solapar **por poco es solapar**: un minuto de intersección produce el mismo conflicto que la coincidencia total (clarificación del 2026-09-16).

### `computeStateToken`

```typescript
export function computeStateToken(
  conflicts: readonly Conflict[],
  hash: (input: string) => string,     // puerto: el dominio no conoce node:crypto
): string;
```

**Contrato**: determinista y estable frente al orden —ordena antes de hashear— y sensible a **cualquier** cambio en los elementos en conflicto. Hashea todo lo que cada `Conflict` enseña —tipo, `id`, franja y, según el tipo, nombre del cliente y servicios o motivo—, no una marca de modificación: el esquema no tiene ninguna, y no le hace falta (D-024). Una cita que otra pantalla acaba de editar y alargar cambia su franja, y con ella la huella. El hash se inyecta porque `node:crypto` está prohibido en el dominio; el adaptador vive en `infrastructure/security`.

No es un secreto y no autoriza nada. Es la huella que FR-038 compara.

### `buildResolutionPlan`

```typescript
export function buildResolutionPlan(input: {
  readonly intent: ResolutionIntent;
  readonly conflicts: readonly Conflict[];
  readonly resolution: Resolution;     // lo que la dueña eligió
}): Result<ResolutionPlan, ResolutionError>;

export type ResolutionIntent =
  | CreateAppointment        // de planManualBooking
  | RescheduleAppointment    // de planManualBooking sobre la propia cita
  | EditAppointment          // de planAppointmentEdit (D-035)
  | CreatePeriod;

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
- *Revisado al implementar (paso 6)*: recibe también `now` y `timezone`, porque un recorte se valida con `validateShortening` (rejilla de 15 minutos, dentro del periodo, no pasado); el plan lleva `at`, el instante de sus cancelaciones. `shorteningsThatFit(period, span)` devuelve los recortes que dejarían sitio —lo que queda antes y lo que queda después— para que la pantalla los ofrezca sin calcularlos. `applyPlan` sólo responde `STATE_CHANGED`: la violación `23P01` significa lo mismo (D-024). Las escrituras de la dueña toman un *advisory lock* de transacción, así que dos de ellas nunca re-detectan a la vez; una reserva online no lo toma y para ella está la restricción `EXCLUDE`.

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
  /** `null` es «sin precio» (FR-018 de la 005), nunca 0. */
  readonly priceCents: number | null;
}): Result<ValidatedServiceInput, ServiceError>;

export type ServiceError = 'EMPTY_NAME' | 'NON_POSITIVE_DURATION' | 'NON_POSITIVE_PRICE';

export function canRetireService(input: {
  readonly activeServiceCount: number;
}): Result<void, 'LAST_ACTIVE_SERVICE'>;
```

**Contrato de `validateService`**: `NON_POSITIVE_PRICE` cubre el 0 y los negativos (FR-053, D-031). El mensaje dice qué hacer: dejar el precio vacío si no se quiere poner. Es la misma regla que impone `service_price_positive` en la base.

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

## `owner/booking-list` — el listado de reservas

```typescript
export const BOOKING_LIST_PAGE_SIZE = 20;

export function parseBookingListQuery(input: {
  readonly order?: string;          // 'UPCOMING' | 'RECENT'
  readonly status?: string;         // 'CONFIRMED' | 'CANCELLED' | 'ALL'
  readonly origin?: string;         // 'ONLINE' | 'OWNER' | 'ALL'
  readonly from?: string;           // YYYY-MM-DD, día del salón
  readonly to?: string;
  readonly search?: string;         // nombre o teléfono (FR-069)
  readonly after?: BookingListCursor;
  readonly now: Temporal.Instant;
  readonly timezone: string;
}): Result<BookingListQuery, BookingListQueryError>;

export type BookingListSearch =
  | { readonly kind: 'PHONE'; readonly phone: NormalizedPhone }      // igualdad
  | { readonly kind: 'NAME'; readonly fragment: SearchableName };    // por contenido

export type BookingListQueryError =
  | { readonly kind: 'INVALID_VALUE';
      readonly field: 'order' | 'status' | 'origin' | 'from' | 'to' | 'search' }
  | { readonly kind: 'RANGE_REVERSED' }                // from > to
  | { readonly kind: 'CURSOR_ORDER_MISMATCH' };       // cursor de un orden con el otro
```

**Contrato**: es donde viven las reglas de la Historia 10, en un solo sitio (Principio I):

- Un campo ausente toma su valor por defecto: `UPCOMING`, `CONFIRMED`, `ALL` y sin rango (FR-061, FR-062). La pantalla no los repite: si el filtro no está en la URL, el dominio lo pone.
- Con `UPCOMING`, `notBefore` es el inicio de **hoy** en la zona del salón, calculado con el `now` del reloj inyectado, nunca con el del dispositivo. Con `RECENT` es `null`: el orden por fecha de reserva incluye las citas pasadas.
- `from` y `to` son días del salón, inclusivos, sobre el **día de la cita** en los dos órdenes.
- El cursor de un orden no vale para el otro: cambiar de orden vuelve a la primera página.
- **Búsqueda** (FR-069, D-036): un término vacío tras recortarlo es «sin búsqueda». Si, sin espacios, puntos ni guiones, sólo tiene cifras y como mucho un `+` inicial, es un teléfono: `normalizePhone` lo convierte en `PHONE`, o falla con `INVALID_VALUE` en `search`. Cualquier otro término es `NAME` con `searchableName`. La pantalla no adivina qué tipo es: lo decide aquí.
- La búsqueda se combina con todo lo demás y viaja con el cursor: pasar de página no la pierde. Las anonimizadas nunca casan (FR-070), porque sus columnas de búsqueda son nulas.

Leer la página no es dominio: lo hace el puerto `BookingListReader` con la consulta ya normalizada, en **una** consulta (FR-066, D-033). El dominio no sabe que existen `LIMIT` ni `json_agg`.

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
  /**
   * FR-037: el plan entero en UNA transacción, o nada (D-023). Una cita nueva
   * se escribe con sus filas de appointment_service en esa misma transacción;
   * una cancelación del plan, con cancelled_by = OWNER (FR-040a). Una edición
   * (D-035) actualiza ends_at y los datos del cliente, borra las filas de
   * appointment_service que salen e inserta las que entran, sin reescribir
   * ninguna de las que se quedan (BR-021).
   */
  applyPlan(plan: ResolutionPlan, expectedStateToken: string):
    Promise<Result<AppliedPlan, 'STATE_CHANGED' | 'SLOT_TAKEN'>>;
}

export interface BookingListReader {
  /**
   * FR-066, D-033: UNA consulta, servicios incluidos, LIMIT pageSize + 1 para
   * saber si hay página siguiente sin contar el total.
   */
  readPage(query: BookingListQuery): Promise<BookingListPage>;
}
```

**Cambios en `AppointmentRepository`** (de la 001): `cancel(id, at)` pasa a `cancel(id, at, by: CancellationActor)` y escribe `cancelled_by` en el mismo `UPDATE` que el estado. Las lecturas devuelven `origin` y `cancelledBy`. Las citas de un día para la agenda se leen con sus servicios en una sola consulta, igual que la disponibilidad (D-027). `customer_name_search` es una columna generada: ni el `insert` ni la anonimización la tocan (D-036). `findInWindow(from, to, { includeCancelled })` lee las citas que tocan una ventana con todos sus servicios, en una consulta. `countFutureByContact` acepta un email nulo, que no cuenta nada, y admitirá excluir una cita, para el límite al editar el contacto (FR-075).

**Cambio en la vista de la cita del cliente** (D-037): la lectura por token devuelve también `cancelledBy`, y `AppointmentDetail` del contrato de cliente lo expone en su versión 2.1.0. Ninguna regla del cliente cambia: sólo el texto que la pantalla elige.

**`SalonConfigWriter` es un puerto aparte de `SalonConfigRepository`**, que sigue siendo de sólo lectura. Los casos de uso del cliente dependen únicamente del de lectura, y el compilador garantiza que ninguno de ellos pueda escribir configuración.

**`applyPlan` recibe el `stateToken` esperado** y vuelve a detectar el conflicto dentro de la transacción antes de aplicar nada. `STATE_CHANGED` es la respuesta cuando lo que la dueña vio ya no es lo que hay; una violación `23P01` de la restricción `EXCLUDE` se traduce a ese mismo error, porque significa exactamente lo mismo (D-024).
