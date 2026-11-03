# Data Model: Varios servicios por cita y precio opcional

**Feature**: `005-multiple-services` | **Date**: 2026-11-03

Sólo se describe lo que cambia respecto al
[modelo de la 001](../001-client-appointment-booking/data-model.md). Salón, horario,
cierres, estados de la cita, credencial y retención no cambian.

## Base de datos

### `service` (cambia)

| Columna | Antes | Después |
|---|---|---|
| `price_cents` | `integer NOT NULL`, `CHECK (price_cents >= 0)` | `integer NULL`, `CHECK (price_cents IS NULL OR price_cents > 0)` |

`NULL` significa «sin precio» (FR-018). Un precio, si existe, es mayor que cero.

### `appointment_service` (nueva)

Una fila por servicio de una cita. Es el snapshot de 001/D-011, ampliado a cada
servicio (FR-014).

| Columna | Tipo | Regla |
|---|---|---|
| `appointment_id` | `uuid NOT NULL` | FK → `appointment(id)` `ON DELETE CASCADE` |
| `position` | `smallint NOT NULL` | `CHECK (position >= 1)`. Orden del catálogo al reservar (FR-006). |
| `service_id` | `uuid NOT NULL` | FK → `service(id)` `ON DELETE RESTRICT`, como antes en `appointment` |
| `name` | `text NOT NULL` | Snapshot |
| `duration_minutes` | `integer NOT NULL` | Snapshot. `CHECK (duration_minutes > 0)` |
| `price_cents` | `integer NULL` | Snapshot. `CHECK (price_cents IS NULL OR price_cents > 0)` |

- **PK** `(appointment_id, position)`.
- **UNIQUE** `(appointment_id, service_id)`: un servicio no se repite en una cita (FR-003).
- Sin datos personales. La anonimización no la toca, y la cita anonimizada conserva
  sus servicios como histórico.
- `ON DELETE CASCADE` hacia la cita: hoy no se borra ninguna cita, pero si algún día se
  hiciera, sus servicios no pueden quedar sueltos.

### `appointment` (cambia)

Se eliminan `service_id`, `service_name`, `service_duration_minutes` y
`service_price_cents`. Todo lo demás sigue igual, incluidas la restricción
`appointment_no_overlap` y los índices parciales: `ends_at` ya es el inicio más la
duración total.

### Migración `0003_multiple_services.sql`

En una transacción, en este orden:

1. `CREATE TABLE appointment_service …` con sus restricciones.
2. Copiar cada cita existente como **una** fila con `position = 1` y su snapshot
   (FR-021). El `price_cents` 0 pasa a `NULL`.
3. `ALTER TABLE appointment DROP COLUMN service_id, service_name, service_duration_minutes, service_price_cents`.
4. En `service`: quitar `service_non_negative_price`, permitir `NULL`, convertir los 0
   en `NULL` y añadir `service_price_positive`.

Comprobaciones tras migrar, en un test de integración:

- Cada cita tiene exactamente una fila en `appointment_service`.
- Para cada cita, `ends_at − starts_at` es igual a la suma de sus duraciones.
- No queda ningún `price_cents = 0`.

## Dominio

### `Service` (cambia)

```text
Service {
  id, name, durationMinutes, isActive, displayOrder
  priceCents: number | null        // antes: number
}
ServiceSnapshot { serviceId, name, durationMinutes, priceCents: number | null }
```

### `NonEmptyServiceList` (nuevo)

`readonly [ServiceSnapshot, ...ServiceSnapshot[]]`. Hace imposible escribir una cita sin
servicios.

### `ServiceSelection` (nuevo, `domain/catalog/selection.ts`)

```text
selectServices(catalogue: readonly Service[], requestedIds: readonly string[])
  → Result<ServiceSelection, SelectionError>

ServiceSelection {
  services: NonEmptyServiceList    // orden del catálogo (FR-006)
  durationMinutes: number          // suma (FR-007)
}

SelectionError =
  | { kind: 'EMPTY' }                                      // FR-004
  | { kind: 'DUPLICATE' }                                  // FR-003
  | { kind: 'UNKNOWN_SERVICE', serviceIds: string[] }      // FR-015, edge case "deja de ofrecerse"
```

Sólo cuentan los servicios activos del catálogo. El orden en que llegan los ids no
importa.

### `PriceTotal` (nuevo)

```text
totalPriceOf(services: NonEmptyServiceList) → PriceTotal

PriceTotal =
  | { kind: 'ALL_PRICED', cents }          // todos con precio: la suma
  | { kind: 'NONE_PRICED' }                // ninguno: "Precio a consultar en el salón"
  | { kind: 'PARTIALLY_PRICED', knownCents } // mixto: "X € + precio a consultar en el salón"
```

Con una cita de un solo servicio sale `ALL_PRICED` o `NONE_PRICED`.

### `Appointment` (cambia)

```text
Appointment {
  …igual que en la 001…
  services: NonEmptyServiceList    // antes: service: ServiceSnapshot
}
durationOf(appointment) = suma de services[].durationMinutes
```

`endsAt` sigue siendo `startsAt + duración total` en minutos reales, que es lo que pide
001/D-004 cuando hay cambio de hora estacional.

### Firmas que cambian

| Función | Antes | Después |
|---|---|---|
| `validateSlot` / `BookingRequest` | `service: ServiceSnapshot` | `durationMinutes: number` |
| `validateBookingRequest` → `ValidatedBooking` | `service` | `services: NonEmptyServiceList` |
| `applyReschedule` | duración del snapshot | `durationOf(appointment)` |
| `GetAvailabilityInput` | `serviceId`; `currentAppointment.service` | `serviceIds`; `currentAppointment.durationMinutes` |
| `ConfirmBookingInput` | `serviceId` | `serviceIds` |
| `AvailabilityView` | `serviceId`, `service` | `selection: ServiceSelection`, `price: PriceTotal`, `fitsOpeningHours: boolean` |
| `NewAppointment` (puerto) | `service` | `services` |

### Rechazos nuevos

| Caso de uso | Fallo | Origen |
|---|---|---|
| `getAvailability` | `EMPTY_SELECTION`, `UNKNOWN_SERVICE` | `SelectionError` |
| `confirmBooking` | `EMPTY_SELECTION`, `DUPLICATE_SERVICE`, `UNKNOWN_SERVICE` (con ids) | `SelectionError`, antes de mirar el hueco |

`BookingRejection` (hueco ocupado, antelación, horario, horizonte, rejilla, contacto) no
cambia.

## Reglas que no cambian

- El límite de 3 citas futuras cuenta citas, no servicios (BR-014 de la 001).
- La rejilla sigue siendo de 30 minutos y no hay margen entre servicios de una cita.
- `CONFIRMED` y `CANCELLED` siguen siendo los únicos estados persistidos.
