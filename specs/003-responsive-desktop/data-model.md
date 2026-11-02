# Data Model: Versión responsive para tablet y ordenador

**Feature**: [spec.md](./spec.md) · **Fecha**: 2026-11-02

Esta feature **no cambia el modelo de datos**: no hay migraciones, ni entidades nuevas,
ni cambios en el dominio ni en la API HTTP. El modelo vigente es el de la
[001](../001-client-appointment-booking/data-model.md).

## Estado de interfaz (no persistido)

### Borrador de reserva (`BookingDraft`)

Lo que el cliente ha escrito en el formulario de reserva mientras cambia de día u hora
en ordenador (FR-009, [D-004](./research.md#d-004--datos-escritos-sólo-en-memoria)).

| Campo | Tipo | Notas |
|---|---|---|
| `name` | texto | Tal como se escribe; sin validar. |
| `phone` | texto | Tal como se escribe; sin validar. |
| `email` | texto | Tal como se escribe; sin validar. |

- **Dónde vive**: en estado de React del layout `src/app/(booking)/layout.tsx`. Nunca en
  el almacenamiento del navegador, cookies, URL ni servidor.
- **Ciclo de vida**: empieza vacío al cargar `/` o `/reservar`, se actualiza en cada
  pulsación y desaparece al salir del grupo `(booking)` (por ejemplo, al confirmar y
  llegar a `/cita/…`) o al recargar la página.
- **Validación**: ninguna. La única validación es la del servidor al confirmar (FR-034
  de la 001); el borrador sólo rellena las casillas.

### Parámetros de la URL de reserva

Los mismos de la 001, con un añadido: `/reservar` acepta también `rangeStart` y
`selectedDate` para pintar la columna izquierda en ordenador. Ver
[contracts/ui-layout.md](./contracts/ui-layout.md).
