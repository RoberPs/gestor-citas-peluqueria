# Quickstart: validar la 004

## Preparación

```bash
npm install
docker compose up -d db db-test
npm run db:migrate          # incluye 0008_notifications.sql
npm run db:seed
```

Variables nuevas en `.env` (ver `.env.example`):

| Variable | Desarrollo | Producción |
|---|---|---|
| `NOTIFICATIONS_EMAIL` | `on` para probar, `off` para trabajar como en la 001 | `on` |
| `NOTIFICATIONS_SMS` | `off` | `off` (sólo admite `off` en esta feature) |
| `EMAIL_API_KEY` | cualquier valor con el proveedor falso | clave de Resend |
| `EMAIL_API_BASE_URL` | `http://127.0.0.1:4010` (proveedor falso) | sin definir (la de Resend) |
| `EMAIL_FROM` | `citas@example.test` | dirección del dominio verificado |
| `EMAIL_REPLY_TO` | opcional | email del salón |
| `NOTIFICATION_SEAL_KEY` | `openssl rand -base64 32` | ídem, distinta, fuera del repositorio |

## Validación automática

```bash
npm test                  # decideDelivery, nextAttemptAt, contenido, render del email
npm run test:integration  # transacción, despacho, purga, adaptador, logs sin datos personales
npm run test:contract     # http-api.yaml 2.2.0 y owner-api.yaml 1.3.0
npm run test:e2e          # US1–US3 en mobile-360, tablet-768 y desktop-1280, con axe
npm run lint
npm run check:layers      # src/domain/notifications no importa nada de fuera
```

Los tests arrancan su propio proveedor falso; no hace falta `npm run email:fake`.

## Validación manual

En una terminal, el proveedor falso, que imprime el asunto de cada email que recibe y
lo enseña, tal como lo vería el cliente y en su versión de texto, en
`http://127.0.0.1:4010/` (en JSON, en `/__messages`):

```bash
npm run email:fake
```

En otra, la app con `NOTIFICATIONS_EMAIL=on`:

```bash
npm run dev
```

1. **US1 · Confirmación**: reservar en `/reservar` marcando «Enviadme la confirmación…».
   La pantalla de confirmación nombra la dirección. En unos segundos el proveedor falso
   muestra un email con día, horas, servicios, total, dirección y teléfono del salón,
   enlace de gestión y vía de baja, sin el teléfono ni el email del cliente. El enlace
   abre la cita.
2. **US1 · Sin casilla**: reservar sin marcarla. No llega nada y la pantalla dice lo de
   la 001.
3. **US1 · Cita a mano**: apuntar una cita desde la agenda con email. No llega nada.
4. **US3 · Proveedor caído**: parar `email:fake` y reservar con la casilla. La reserva
   va igual de rápida. Arrancarlo de nuevo y lanzar `npm run notifications:dispatch`:
   sale el email, una sola vez.
5. **US3 · Envío fallido**: con `npm run email:fake -- --reject` (responde `422`, un
   rechazo permanente), reservar con la casilla. El envío queda fallido al primer
   intento, y la agenda y el listado de la dueña marcan la cita «Confirmación por email
   no enviada» con el teléfono. El plazo de 1 hora con errores transitorios lo cubre un
   test de integración con el reloj fijo.
6. **US2 · Baja desde el email**: abrir «Darme de baja». La página pide confirmar;
   abrirla no da de baja. Confirmar, volver a abrirla: «Ya te habías dado de baja». La
   cita sigue igual.
7. **US2 · Baja desde la cita**: en otra cita con la casilla, «Dejar de recibir emails».
8. **Canal apagado**: con `NOTIFICATIONS_EMAIL=off`, el formulario no tiene casilla.

## Puesta en producción

1. **Dominio**: dar de alta en Resend, región de la UE, el dominio del salón si lo
   tiene o, si no, el de la app. Publicar los registros DNS que pida (SPF, DKIM) y
   esperar a que lo verifique. Sin esto no sale ningún email a clientes reales.
2. **Contrato**: aceptar el acuerdo de encargado del tratamiento (DPA) del proveedor
   y fijar la conservación de sus registros en el mínimo que permita. Anotar aquí,
   **antes de enviar a clientes reales** (Principio III), lo que el proveedor ofrezca
   de verdad al contratarlo (research D-012):

   | Dato | Valor (rellenar al contratar) |
   |---|---|
   | Región de envío | UE (`eu-west-1` o la que ofrezca) |
   | DPA aceptado el | _pendiente_ |
   | Conservación de los registros de envío | _pendiente_ — el mínimo que permita el panel |
   | Cómo se borra un envío concreto | _pendiente_ — por su API, con el id del envío, si la ofrece; si no, la petición por el canal que fije el DPA |
   | Plazo en que se compromete a borrarlo | _pendiente_ |

   El id del envío es el de la tabla `notification`, que es también la
   `Idempotency-Key` con la que se mandó: es el único dato que hace falta para
   localizarlo en el proveedor, sin dar el email ni el nombre del cliente.
3. **Variables**: las de la tabla de arriba, con `NOTIFICATION_SEAL_KEY` nueva.
4. **Cron**, junto al de la purga:

   ```cron
   CRON_TZ=Europe/Madrid
   * * * * * cd /srv/gestor-citas && docker compose -f docker-compose.prod.yml exec -T app npm run notifications:dispatch >> /var/log/salon-notifications.log 2>&1
   ```

   El log sólo lleva ids, estados y recuentos.
5. **Prueba**: una reserva real con un email propio, y la baja.
6. **No se envía a clientes reales** hasta que la tabla del paso 2 esté completa.

## Borrado de datos a petición

El procedimiento de la 001 gana un paso. Para atender a un cliente que pide borrar sus
datos:

1. `npm run retention:purge -- --appointment <uuid>`: anonimiza la cita, inutiliza su
   enlace y su vía de baja y descarta cualquier envío pendiente.
2. Si la cita tuvo un envío `SENT` o `FAILED` dentro del plazo de conservación del
   proveedor, borrar ese envío en el proveedor con el id del envío, por la vía anotada
   en el paso 2 de la puesta en producción. El id se obtiene así, sin leer ningún dato
   del cliente:

   ```sql
   SELECT id, status, created_at FROM notification WHERE appointment_id = '<uuid>';
   ```
3. Anotar la fecha de la petición y la de cada paso, sin datos del cliente.
