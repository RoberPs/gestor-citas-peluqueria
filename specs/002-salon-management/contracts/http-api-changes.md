# Contrato HTTP de cliente 2.1.0: cambios de la 002

El contrato vivo sigue siendo
[`specs/001-client-appointment-booking/contracts/http-api.yaml`](../../001-client-appointment-booking/contracts/http-api.yaml).
Esta feature lo actualiza en su sitio, pasa `info.version` de `2.0.0` a `2.1.0` y le añade
una nota que apunta a este documento. Aquí sólo están los cambios.

El yaml se cambia junto con su test de contrato (T194), justo antes de implementarlo
(T195), y las dos tareas van en la misma rama: `npm run test:contract` comprueba los
Route Handlers contra ese archivo, y un contrato que se adelantara al código en `main` lo
pondría en rojo.

## Por qué sube la versión menor

El único cambio es un campo nuevo en una respuesta. Un consumidor de la 2.0.0 sigue
funcionando sin tocar nada: no hay campos retirados, ni tipos cambiados, ni entradas
nuevas obligatorias.

## Esquemas

### `AppointmentDetail` — gana `cancelledBy`

```yaml
AppointmentDetail:
  required:
    [view, services, price, date, startsLocalTime, endsLocalTime, durationMinutes,
     startsAt, canCancel, canReschedule, cancelledBy, salon]
  properties:
    # … todo lo de la 2.0.0, sin cambios …
    cancelledBy:
      type: [string, 'null']
      enum: [CUSTOMER, OWNER, null]
      description: |
        Quién canceló la cita (002, FR-040a, FR-040b, D-037). `null` si y sólo si
        `view` no es `CANCELLED`. La pantalla dice «Has cancelado esta cita» con
        `CUSTOMER` y «El salón ha cancelado esta cita», con el teléfono del salón,
        con `OWNER`.
```

`cancelledBy` es obligatorio en la respuesta —siempre está, `null` incluido— para que el
test de contrato detecte un handler que se olvide de enviarlo.

## Lo que no cambia

- Ninguna ruta, ningún parámetro y ningún cuerpo de entrada.
- `services`, `price` y `durationMinutes` siguen siendo los de la cita **en el momento de
  la consulta**. Desde la 002 la dueña puede editar los servicios de una cita (Historia
  11), y el enlace los muestra tal como estén; la forma de la respuesta es la misma.
- `POST /appointments/{token}/cancellation` sigue igual. Lo que cambia es lo que guarda
  por dentro (`cancelled_by = 'CUSTOMER'`), no lo que recibe ni lo que devuelve.
