# Contratos de la capa de dominio

**Feature**: `001-client-appointment-booking` | **Date**: 2026-09-15

El Principio I exige que toda función pública tenga un contrato explícito y tipado: tipos de entrada, tipo de retorno y **modos de fallo declarados**. Este documento fija esos contratos antes de escribir código.

Dos reglas transversales, no negociables:

1. **`src/domain` no importa nada del framework ni de la base de datos.** Ni React, ni Next, ni Drizzle, ni `pg`. Verificado en CI con `dependency-cruiser`; cruzar la frontera rompe el build.
2. **Ninguna función de dominio lanza excepciones para fallos esperados.** Devuelven `Result<T, E>`, con `E` enumerando los modos de fallo en el propio tipo. Un fallo que no está en el tipo no existe, y el compilador obliga a tratar todos los que sí.

---

## Tipos base

```typescript
// src/domain/shared/result.ts
export type Result<T, E> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

// src/domain/shared/clock.ts
// El dominio NUNCA llama a Date.now(). Recibe el reloj (FR-032, BR-015, D-004).
// Sin esto, los tests de la antelación de 2 h y del plazo de 24 h dependerían de
// la hora a la que se ejecuta la suite.
export interface Clock {
  now(): Temporal.Instant;
}
```

---

## `availability` — cálculo de huecos

Todo este módulo son **funciones puras**: mismos datos de entrada, misma salida, sin E/S y sin reloj propio. Es lo que hace viable el "Independent Test" de la Historia 1 —probar la disponibilidad entera sin reservar nada y sin base de datos— y lo que sostiene SC-005.

### `computeDaySlots`

```typescript
export function computeDaySlots(input: {
  readonly date: Temporal.PlainDate;          // fecha local del salón
  readonly openingIntervals: readonly OpeningInterval[];  // tramos de ESE día
  readonly isClosed: boolean;                 // festivo o ausencia
  readonly serviceDurationMinutes: number;
  readonly confirmedAppointments: readonly BusyInterval[];
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
  readonly currentAppointmentStart?: Temporal.Instant;  // sólo al reprogramar
}): readonly Slot[];
```

**Contrato**: devuelve los inicios que cumplen **las cuatro condiciones de FR-003**, y sólo esos:

| # | Condición | Requisito |
|---|---|---|
| a | `[inicio, inicio + duración)` cabe entero **dentro de un mismo tramo**, sin cruzar ningún cierre intermedio | FR-003a, FR-007a, BR-002 |
| b | No solapa ninguna cita confirmada | FR-003b, BR-001 |
| c | `inicio >= now + policy.minimumLeadTime` | FR-003c, BR-003 |
| d | `inicio` cae dentro del horizonte | FR-003d, BR-011 |

Detalles que el contrato fija:

- Los candidatos se generan en rejilla de **30 minutos anclada a la hora en punto**, recorriendo **cada tramo por separado** (FR-004). Esto es lo que impide ofrecer las 13:00 para un servicio de 90 minutos en un día que cierra a las 14:00.
- El solape usa intervalo **semiabierto** `[)`: una cita puede empezar exactamente cuando termina la anterior (BR-013).
- `isClosed = true` o `openingIntervals` vacío devuelven `[]`. Un día cerrado y un día sin tramos son indistinguibles a efectos de disponibilidad (FR-007a).
- Si se pasa `currentAppointmentStart`, ese hueco **se ofrece** con `isCurrentAppointment: true` y **no cuenta como ocupado** (FR-027).

**Sin modos de fallo**: devuelve un array, nunca un `Result`. Un día sin huecos no es un error, es un array vacío.

### `computeRangeDays`

```typescript
export function computeRangeDays(input: {
  readonly rangeStart: Temporal.PlainDate;
  readonly rangeLengthDays: number;                  // 14 (BR-011b)
  readonly salonSchedule: WeeklySchedule;
  readonly closures: ReadonlySet<string>;            // fechas ISO
  readonly serviceDurationMinutes: number;
  readonly confirmedAppointments: readonly BusyInterval[];  // TODO el horizonte
  readonly now: Temporal.Instant;
  readonly policy: BookingPolicy;
  readonly timezone: string;
}): readonly RangeDay[];
```

**Contrato**: marca cada día del rango como `CLOSED`, `FULL` o `AVAILABLE` para ese servicio (FR-005).

- `CLOSED`: sin tramos ese día de la semana, o con cierre. **Nunca se devuelve `FULL` para un día cerrado**: es una distinción de producto, no de presentación.
- `FULL`: abierto, pero `computeDaySlots` devuelve vacío.
- `AVAILABLE`: al menos un hueco. `slotCount` lleva cuántos, para el nombre accesible (D-014).
- El rango se **recorta** al horizonte: el último devuelve menos de 14 días en lugar de rebasar el día 60 (caso límite de fecha lejana).

**Recibe las citas de todo el horizonte, no las de un día.** Esa firma es deliberada: obliga a que la llamada traiga los datos de una sola consulta (D-003) y hace imposible el patrón N+1 que el Principio VIII prohíbe. Una firma que aceptara las citas de un solo día invitaría a llamar catorce veces.

### `findNextAvailableDate`

```typescript
export function findNextAvailableDate(input: {
  readonly fromDate: Temporal.PlainDate;             // exclusivo
  readonly horizonEnd: Temporal.PlainDate;
  /* ...mismas dependencias que computeRangeDays... */
}): Temporal.PlainDate | null;
```

**Contrato**: primer día con al menos un hueco después de `fromDate`, **aunque caiga en un rango posterior** (FR-006). `null` si no queda ninguno dentro del horizonte.

Opera sobre los mismos datos ya cargados en memoria: no dispara ninguna consulta adicional, que es lo que permite ofrecer el salto directo aunque el rango entero esté sin disponibilidad.

---

## `booking` — reglas de reserva

### `validateBookingRequest`

```typescript
export type BookingRejection =
  | { readonly kind: 'SLOT_TAKEN' }
  | { readonly kind: 'TOO_LATE_TO_BOOK'; readonly earliestStart: Temporal.Instant }
  | { readonly kind: 'OUTSIDE_OPENING_HOURS' }
  | { readonly kind: 'BEYOND_HORIZON'; readonly horizonEnd: Temporal.PlainDate }
  | { readonly kind: 'NOT_ON_GRID' }
  | { readonly kind: 'INVALID_CONTACT'; readonly fields: readonly ContactFieldError[] };

export function validateBookingRequest(input: {
  readonly requestedStart: Temporal.Instant;
  readonly service: ServiceSnapshot;
  readonly contact: RawContact;
  /* ...configuración, citas confirmadas, reloj, política... */
}): Result<ValidatedBooking, BookingRejection>;
```

**Contrato**: revalida en servidor **todo** lo que la interfaz ya validó (FR-011, FR-034). Nada de lo que llega del cliente se da por bueno, ni siquiera el hecho de que el inicio esté en la rejilla.

`ValidatedBooking` incluye el contacto ya **normalizado** (teléfono a E.164, email en minúsculas), que es lo que se persiste en las columnas normalizadas para el conteo de BR-014.

**`BEYOND_HORIZON` y `NOT_ON_GRID` no tienen escenario de usuario**, porque la interfaz no puede producirlos. Están en el tipo precisamente por eso: sólo llegan de una petición manipulada, y el Principio V dice que el cliente nunca es fuente de confianza.

El límite de 3 citas futuras (BR-014) **no está aquí**: necesita consultar el repositorio, así que vive en el caso de uso. El dominio decide sobre los datos que recibe; no los busca.

### `canCancel` / `canReschedule`

```typescript
export type ModificationBlock =
  | { readonly kind: 'TOO_LATE'; readonly deadline: Temporal.Instant }
  | { readonly kind: 'ALREADY_CANCELLED' }
  | { readonly kind: 'ALREADY_COMPLETED' };

export function canCancel(
  appointment: Appointment, now: Temporal.Instant, policy: BookingPolicy
): Result<void, ModificationBlock>;

export function canReschedule(
  appointment: Appointment, now: Temporal.Instant, policy: BookingPolicy
): Result<void, ModificationBlock>;
```

**Contrato**: las dos aplican las mismas tres reglas —más de 24 h por delante (BR-004), no cancelada (BR-007), no pasada (BR-010)—. El error devuelto es lo que alimenta `unavailableReason` en la API, de modo que **el motivo que se muestra al cliente sale del dominio**, no de un `if` en la interfaz (FR-028).

`deadline` viaja en el error para que el mensaje pueda ser concreto en lugar de genérico.

### `deriveView`

```typescript
export function deriveView(
  appointment: Appointment, now: Temporal.Instant
): 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
```

**Contrato**: `COMPLETED` es una cita `CONFIRMED` cuyo `endsAt` ya pasó. **Se deriva al leer, nunca se persiste** (FR-031). No existe ningún proceso en segundo plano que marque citas como completadas, y este contrato es el único lugar donde se decide.

### `applyReschedule`

```typescript
export function applyReschedule(input: {
  readonly appointment: Appointment;
  readonly newStart: Temporal.Instant;
  /* ...configuración, citas confirmadas, reloj, política... */
}): Result<RescheduleOutcome, BookingRejection | ModificationBlock>;

export type RescheduleOutcome =
  | { readonly kind: 'UNCHANGED' }                              // eligió su propia hora
  | { readonly kind: 'MOVED'; readonly appointment: Appointment };
```

**Contrato**:

- El servicio **no cambia**: se usa el del snapshot de la cita, con su duración congelada (FR-024, D-011). La firma no acepta un servicio nuevo, así que cambiarlo no es un error en tiempo de ejecución: es imposible de expresar.
- El hueco actual de la cita no cuenta como ocupado (FR-027).
- Elegir la propia hora devuelve `UNCHANGED`, no un error (Historia 6, escenario 5).
- `MOVED` devuelve una cita **nueva e inmutable** con la franja cambiada, **conservando `id` y token** (FR-026).

La atomicidad de BR-006 no se resuelve aquí: esta función es pura y no escribe. La garantiza el caso de uso, con una transacción y la restricción `EXCLUDE` (D-002). Si la escritura falla, la transacción revierte y la cita original queda intacta en su hora original.

---

## `contact` — formato de los datos de contacto

```typescript
export function normalizePhone(raw: string): Result<NormalizedPhone, 'INVALID_PHONE'>;
export function normalizeEmail(raw: string): Result<NormalizedEmail, 'INVALID_EMAIL'>;
export function validateName(raw: string): Result<CustomerName, 'INVALID_NAME'>;
```

**Contrato**: única implementación de las reglas de formato de FR-009. Zod las invoca desde la frontera HTTP mediante `refine` (D-009); el formulario las reutiliza vía TypeScript para dar feedback inmediato, **sin ser nunca autoritativo** (FR-034).

Que vivan aquí y no en un esquema Zod del Route Handler es exigencia directa del Principio I: "una regla de negocio existe en un único lugar". "Un teléfono español válido" es una regla de negocio, no una comprobación de transporte.

**Formato aceptado** (asunción 8): 9 dígitos empezando por 6, 7, 8 o 9; prefijo `+34` o `0034` opcional; espacios, guiones y puntos tolerados y eliminados en la normalización. Ninguno de los dos se verifica como existente: v1 no envía nada.

---

## `privacy` — anonimización

```typescript
export function anonymize(appointment: Appointment): AnonymizedAppointment;

export function isDueForAnonymization(
  appointment: Appointment, now: Temporal.Instant, retentionMonths: number
): boolean;
```

**Contrato**: `anonymize` define **qué se borra y qué se conserva**, en un solo lugar y sin estados intermedios posibles:

| Se borra (FR-035) | Se conserva (FR-035a) |
|---|---|
| nombre | servicio (snapshot completo) |
| teléfono y su forma normalizada | hora de inicio y de fin |
| email y su forma normalizada | estado persistido |
| **hash del token** | `createdAt`, `cancelledAt` |

El tipo `AnonymizedAppointment` hace **imposible por construcción** representar una cita con el nombre borrado y el token vivo, o al revés. La base de datos impone el mismo invariante con la restricción `appointment_anonymization_is_atomic`. Dos capas, el mismo invariante: BR-018 no depende de que nadie se acuerde.

---

## Puertos que el dominio no conoce

Estos interfaces viven en `src/application/ports`, **no en el dominio**. El dominio recibe datos ya cargados; nunca los busca. Es lo que le permite ser puro y testeable sin infraestructura.

```typescript
export interface AppointmentRepository {
  findByTokenHash(hash: Uint8Array): Promise<Appointment | null>;

  /** D-003: UNA consulta para todo el horizonte. Sostiene SC-005 y FR-005b. */
  findConfirmedInWindow(from: Temporal.Instant, to: Temporal.Instant):
    Promise<readonly BusyInterval[]>;

  /**
   * BR-014 / FR-013: cuenta **por separado** las citas confirmadas futuras de
   * ese teléfono y las de ese email. Devuelve los dos conteos, no su unión:
   * la regla es `byPhone >= 3 || byEmail >= 3`, no `count(phone OR email) >= 3`.
   * Un `WHERE phone = $1 OR email = $2` implementaría una regla más estricta
   * que la especificada, rechazando a quien no ha alcanzado ningún límite.
   */
  countFutureByContact(phone: NormalizedPhone, email: NormalizedEmail, now: Temporal.Instant):
    Promise<{ readonly byPhone: number; readonly byEmail: number }>;

  /**
   * Inserta. Traduce la violación 23P01 de la restricción EXCLUDE a
   * `SLOT_TAKEN`, que es como FR-012 llega a ser observable sin filtrar
   * detalles de la base de datos hacia arriba.
   */
  insert(appointment: NewAppointment): Promise<Result<Appointment, 'SLOT_TAKEN'>>;

  /** FR-025, BR-006: atómico. Si falla, la cita original queda intacta. */
  updateSchedule(id: AppointmentId, start: Temporal.Instant, end: Temporal.Instant):
    Promise<Result<Appointment, 'SLOT_TAKEN'>>;

  cancel(id: AppointmentId, at: Temporal.Instant): Promise<Result<Appointment, 'ALREADY_CANCELLED'>>;
}

export interface SalonConfigRepository {
  /** FR-007: configuración precargada, sólo lectura en v1. Cacheable en memoria. */
  load(): Promise<SalonConfiguration>;
}

export interface TokenGenerator {
  /** D-005: 32 bytes de CSPRNG. Devuelve el token en claro y su hash SHA-256. */
  generate(): { readonly token: string; readonly hash: Uint8Array };
  hash(token: string): Uint8Array;
}

export interface RateLimiter {
  /**
   * FR-040: la IP se convierte en clave con HMAC y secreto rotatorio, y no se
   * conserva más allá de la ventana. El resultado no revela cuántos intentos
   * quedan: quien consulta un enlace no debe poder deducir que hay un límite
   * (FR-038, D-006).
   */
  check(bucket: 'APPOINTMENT_LOOKUP' | 'BOOKING_CONFIRMATION', clientIp: string):
    Promise<{ readonly allowed: boolean }>;
}
```

**Sobre `insert` devolviendo `Result`**: que el repositorio traduzca `23P01` a `SLOT_TAKEN` es lo que mantiene el código de PostgreSQL dentro de `infrastructure`. El caso de uso recibe un modo de fallo del dominio, no un error de driver, y puede responder el `409` de FR-012 con la disponibilidad actualizada sin saber que existe una restricción de exclusión.

**Sobre `check` devolviendo sólo `allowed`**: deliberadamente no devuelve intentos restantes ni tiempo de reintento. Si lo hiciera, alguien acabaría poniéndolo en una cabecera y rompiendo la indistinguibilidad que FR-038 exige.
