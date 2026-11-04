# Cambios de los contratos HTTP

**Feature**: `004-notifications` | **Date**: 2026-11-04

Dos contratos cambian, los dos de forma **compatible**: ningún cliente actual deja de
funcionar.

| Contrato | Archivo | Antes | Después |
|---|---|---|---|
| Cliente | `specs/001-client-appointment-booking/contracts/http-api.yaml` | 2.1.0 | **2.2.0** |
| Gestión | `specs/002-salon-management/contracts/owner-api.yaml` | 1.2.0 | **1.3.0** |

`npm run test:contract` comprueba los dos archivos ya actualizados.

---

## Cliente 2.2.0

### `POST /api/appointments` (cambia)

Cuerpo: campo nuevo, opcional.

```yaml
emailConsent:
  type: boolean
  default: false
  description: >
    El cliente pide recibir la confirmación por email (FR-001). Con el canal de
    email apagado se acepta y se ignora (D-005). No cambia ninguna validación ni
    ningún error de la reserva.
```

Respuesta `201`: sin cambios de forma. El envío no forma parte de la respuesta
(FR-010).

### `GET /api/appointments/{token}` (cambia)

Respuesta `200`: campo nuevo, siempre presente.

```yaml
emailNotifications:
  type: object
  required: [active]
  properties:
    active:
      type: boolean
      description: Hay consentimiento de email vigente para esta cita (FR-017).
```

### `POST /api/appointments/{token}/email-consent/revocation` (nuevo)

Baja desde la pantalla de la cita (FR-017). Sin cuerpo.

| Respuesta | Cuándo |
|---|---|
| `204` | Baja hecha, o ya estaba hecha, o la cita nunca tuvo consentimiento: es inocua (FR-016). |
| `404` | El mismo `404` neutro que `GET /api/appointments/{token}` (FR-019 de la 001). También al superar el límite `APPOINTMENT_LOOKUP`, como el resto de rutas con token: nunca `429` (FR-038 de la 001). |

Una cita cancelada o pasada también admite la baja: no cambia la cita.

### `POST /api/unsubscribe/{unsubscribeToken}` (nuevo)

La baja de un clic del gestor de correo (RFC 8058, D-009). Cuerpo opcional
`List-Unsubscribe=One-Click` (`application/x-www-form-urlencoded`), que se ignora.

| Respuesta | Cuándo |
|---|---|
| `204` | Baja hecha o ya hecha. |
| `404` | Token inexistente, malformado o de una cita anonimizada (FR-018), con el mismo cuerpo neutro. También al superar el límite `APPOINTMENT_LOOKUP` (FR-038 de la 001). |

`unsubscribeToken`: el mismo formato que el token de gestión (43 caracteres base64url).

---

## Gestión 1.3.0

### `GET /api/gestion/agenda` y `GET /api/gestion/reservas` (cambian)

Cada cita gana un campo, siempre presente:

```yaml
confirmationEmailFailed:
  type: boolean
  description: >
    La cita es online, está confirmada, no ha terminado y su confirmación por email
    falló definitivamente (FR-020a). La dueña debería llamar al cliente.
```

Ningún otro estado del envío se expone.

---

## Lo que no cambia

- Ningún error nuevo en la reserva: un fallo de envío nunca llega a la respuesta.
- `POST /api/gestion/citas` y la edición no ganan campos: la dueña no da
  consentimiento en nombre del cliente.
- Las respuestas siguen sin llevar el teléfono ni el email en las rutas del cliente
  más allá de lo que ya llevaban.
