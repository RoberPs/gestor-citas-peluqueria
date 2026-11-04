# Pantallas y email

**Feature**: `004-notifications` | **Date**: 2026-11-04

Los textos viven en `src/messages/es-ES.ts` (CLAUDE.md). Los de aquí son la
referencia; un test de `tests/unit/messages` los compara.

## Formulario de reserva

Bajo el campo de email, sólo con el canal de email encendido (FR-001, FR-004):

- Casilla `emailConsent`, desmarcada, con `<label>` asociado:
  **«Enviadme la confirmación de esta cita por email»**.
- Ayuda unida con `aria-describedby`:
  «Sólo te enviaremos la confirmación de esta cita, sin publicidad. Podrás darte de
  baja desde el propio email.»
- Marcarla no hace obligatorio nada nuevo: el email ya lo es al reservar online.
- Si la reserva falla por otro campo, la casilla conserva su estado, como los demás
  datos (001, FR-009).

## Pantalla de confirmación (`/cita/{token}?nueva=1`)

El bloque «Guarda este enlace» cambia su texto (FR-013):

| Caso | Texto |
|---|---|
| Con consentimiento | «Te enviamos la confirmación a **{email}**. Puede tardar unos minutos; si no la ves, mira en la carpeta de spam. Por si acaso, guarda también este enlace: es la forma de volver a tu cita para consultarla, cambiarla o cancelarla.» |
| Sin consentimiento o canal apagado | El texto actual de la 001 (`saveLinkWarning`). |

El texto «No te lo vamos a enviar por SMS ni por email» sigue siendo cierto sólo en el
segundo caso, y ahí se queda.

## Pantalla de la cita (`/cita/{token}`)

Con consentimiento vigente (FR-017), una sección más:

- «Recibes la confirmación de esta cita por email.»
- Botón secundario **«Dejar de recibir emails»**, que envía un formulario. Tras él:
  «Ya no te enviaremos emails sobre esta cita. Tu cita no cambia.» con
  `role="status"`.

Sin consentimiento vigente, la sección no aparece.

## Página de baja (`/baja/{token}`)

Usa `.page` de una columna en los tres tamaños.

| Estado | Título | Contenido |
|---|---|---|
| Inicial | «Dejar de recibir emails» | «Dejarás de recibir emails de **{salón}** sobre tu cita. Tu cita no cambia.» Botón principal «Darme de baja». |
| Hecha | «Te has dado de baja» | «Ya no te enviaremos emails sobre esta cita. Tu cita no cambia.» Icono ✓ y texto, `role="status"`. |
| Ya estaba hecha | «Ya te habías dado de baja» | «No te enviaremos emails sobre esta cita.» |
| Token inválido | La pantalla neutra de un enlace inválido (001, FR-019). | |

La página no muestra datos de la cita: ni día, ni servicios, ni el nombre del cliente
(FR-024).

## Agenda y listado de la dueña

En cada cita con `confirmationEmailFailed` (FR-020a):

- Icono ⚠ con texto **«Confirmación por email no enviada»** (no sólo color).
- Al lado, el teléfono del cliente como enlace `tel:` y la ayuda «Llámale para darle
  su enlace.»

## Email de confirmación

### Cabeceras

| Cabecera | Valor |
|---|---|
| `From` | `{nombre del salón} <EMAIL_FROM>` |
| `Reply-To` | `EMAIL_REPLY_TO`, si está configurado |
| `Subject` | «Tu cita en {salón}: {día corto}, {hora}» — p. ej. «Tu cita en Peluquería de Caballeros Niza: vie 14 nov, 11:30» |
| `List-Unsubscribe` | `<{PUBLIC_BASE_URL}/api/unsubscribe/{unsubscribeToken}>` |
| `List-Unsubscribe-Post` | `List-Unsubscribe=One-Click` |
| `Idempotency-Key` (a la API del proveedor) | id del envío |

### Cuerpo, en este orden (FR-006)

1. «Hola, {nombre}:» y «Tu cita en {salón} está confirmada.»
2. **Cuándo**: «viernes 14 de noviembre, de 11:30 a 12:30» (hora del salón, FR-025).
3. **Servicios**: una línea por servicio con su precio o «Precio a consultar en el
   salón»; el total con la regla de la 005.
4. **Dónde**: dirección y teléfono del salón.
5. **Tu cita**: enlace con texto «Ver, cambiar o cancelar tu cita» →
   `{PUBLIC_BASE_URL}/cita/{token}`, y debajo la URL completa en texto.
6. «Puedes cambiarla o cancelarla hasta {N} horas antes. Lo que veas en este enlace es
   siempre lo vigente, aunque cambie después de este email.»
7. Pie: «Recibes este email porque lo pediste al reservar.» y el enlace «Darme de baja»
   → `{PUBLIC_BASE_URL}/baja/{unsubscribeToken}`.

### Reglas

- Una parte HTML y una de texto plano con el mismo contenido (FR-025).
- Sin imágenes, sin rastreo de apertura ni de clics, sin contenido comercial (FR-007).
- Del cliente sólo aparece el nombre, nunca su teléfono ni su email (FR-007).
- HTML semántico (`<h1>`, listas, `<a>` con texto), `lang="es"`, contraste AA.
