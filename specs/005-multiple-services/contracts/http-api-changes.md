# Contrato HTTP 2.0.0: cambios de la 005

El contrato vivo sigue siendo
[`specs/001-client-appointment-booking/contracts/http-api.yaml`](../../001-client-appointment-booking/contracts/http-api.yaml)
(D-006). Esta feature lo actualiza en su sitio, pasa `info.version` a `2.0.0` y le añade
una nota que apunta a este documento. Aquí sólo están los cambios.

## Esquemas

### `Service`

```yaml
Service:
  required: [id, name, durationMinutes, priceCents, priceLabel]
  properties:
    id: { type: string, format: uuid }
    name: { type: string }
    durationMinutes: { type: integer, minimum: 1 }
    priceCents:
      type: [integer, 'null']
      minimum: 1
      description: null = sin precio (FR-018). Nunca 0.
    priceLabel:
      type: string
      description: Ya redactado, p. ej. "18,00 €" o "Precio a consultar en el salón".
```

### `PriceTotal` (nuevo)

```yaml
PriceTotal:
  required: [kind, knownCents, label]
  properties:
    kind: { type: string, enum: [ALL_PRICED, NONE_PRICED, PARTIALLY_PRICED] }
    knownCents:
      type: [integer, 'null']
      description: Suma de los precios conocidos. null si kind = NONE_PRICED.
    label:
      type: string
      example: 12,00 € + precio a consultar en el salón
```

Como el resto de la API, el servidor manda el texto ya redactado: el cliente no suma
importes ni elige la frase (FR-020).

### `AvailabilityResponse`

| Antes | Después |
|---|---|
| `serviceId` | `serviceIds: string[]` (orden del catálogo) |
| — | `services: Service[]`, los de la selección |
| — | `durationMinutes: integer`, la suma (FR-007) |
| — | `price: PriceTotal` |
| — | `fitsOpeningHours: boolean` (FR-010, D-007) |

`days`, `slots`, `range`, `selectedDate`, `nextAvailableDate` y
`cancellationPolicyHours` no cambian. Ahora se calculan para la duración total.

### `BookingRequest`

```yaml
BookingRequest:
  required: [serviceIds, startsAt, customer]
  additionalProperties: false
  properties:
    serviceIds:
      type: array
      minItems: 1
      uniqueItems: true
      items: { type: string, format: uuid }
    startsAt: { type: string, format: date-time }
    customer: { $ref: '#/components/schemas/CustomerContact' }
```

### `AppointmentDetail`

| Antes | Después |
|---|---|
| `service: Service` | `services: Service[]` (`minItems: 1`), el snapshot de cada servicio al reservar (FR-014) |
| `durationMinutes` = duración del servicio | `durationMinutes` = suma |
| — | `price: PriceTotal` |

## Parámetros y respuestas

### `GET /availability`

- `serviceId` (obligatorio) se sustituye por `serviceIds`: obligatorio, ids separados
  por comas, por ejemplo `?serviceIds=uuid1,uuid2`.
- **400 `EMPTY_SELECTION`**: `serviceIds` vacío. Con `nextAction`: «Elige al menos un
  servicio».
- **400 `UNKNOWN_SERVICE`**: algún id no existe o está inactivo. El orden y los
  repetidos no provocan error: **la ruta** descarta los repetidos antes de llamar al caso
  de uso, y el dominio ordena por catálogo. `selectServices` sigue rechazando los
  repetidos (`DUPLICATE`) para quien lo llame sin pasar por la ruta.

### `GET /appointments/{token}/availability`

No cambian los parámetros: los servicios son los de la cita. La respuesta es la nueva
`AvailabilityResponse`.

### `POST /appointments`

- El cuerpo usa `serviceIds` (ver `BookingRequest`).
- **400 `INVALID_REQUEST`** si `serviceIds` está vacío o tiene repetidos (lo detecta el
  esquema).
- **409 `SERVICE_UNAVAILABLE`** (nuevo) si algún servicio ha dejado de ofrecerse entre la
  consulta y la confirmación. Lleva `unavailableServiceIds` y `nextAction`, que pide
  revisar la selección (FR-015).
- **409 `SLOT_TAKEN` / `TOO_LATE_TO_BOOK` / `OUTSIDE_OPENING_HOURS`**: igual que antes.
  La `availability` que acompaña al error se calcula para la misma selección.

### `GET /services`

Cada `Service` añade `priceLabel` y admite `priceCents: null`.

### `POST /appointments/{token}/reschedule` y `/cancellation`

Sin cambios en los parámetros. Las respuestas usan el `AppointmentDetail` nuevo.
