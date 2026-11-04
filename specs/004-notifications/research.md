# Phase 0 — Research: Email de confirmación al reservar

**Feature**: `004-notifications` | **Date**: 2026-11-04

Cada decisión indica qué requisito la obliga, por qué se eligió y qué se descartó. Las
referencias `001/…`, `002/…` y `005/…` apuntan a las decisiones de esas features.

Al cerrar este documento **no queda ningún `NEEDS CLARIFICATION`** en el Technical
Context del plan.

---

## D-001 — Bandeja de salida en la misma transacción que la cita

**Decisión**: al confirmar una reserva con la casilla marcada, el repositorio inserta en
**la misma transacción** la cita, sus servicios, el consentimiento de email
(`channel_consent`) y una fila `notification` en estado `PENDING`. El envío lo hace
después otro proceso, que lee esa fila.

**Rationale**:

- FR-010 y SC-002: la reserva no espera al proveedor. Si el envío fuera parte de la
  petición, un proveedor lento haría lenta la reserva.
- FR-002: el consentimiento se registra «en el mismo cambio que crea la cita». Si la
  cita no se guarda (la restricción `EXCLUDE` la rechaza), tampoco quedan el
  consentimiento ni el envío.
- FR-019: el envío existe como fila desde el primer instante, así que el registro está
  completo aunque el proceso caiga antes de intentarlo.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Enviar dentro de la petición de reserva | Rompe FR-010 y SC-002 con el proveedor lento o caído. |
| Enviar en segundo plano sin fila previa | Un reinicio entre la reserva y el envío pierde el email sin dejar rastro (FR-011, FR-019). |
| Una cola externa (Redis, SQS) | Una pieza más que operar para unos 10 envíos al día; PostgreSQL ya da la transacción que hace falta. |

---

## D-002 — Los enlaces viajan cifrados en la fila pendiente y se borran al terminar

**Decisión**: la fila `notification` guarda, mientras está `PENDING`, el token de
gestión y el de baja **cifrados** con AES-256-GCM (`sealed_tokens`), con una clave de
entorno `NOTIFICATION_SEAL_KEY` de 32 bytes. Al pasar a cualquier estado final
(`SENT`, `FAILED`, `NOT_SENT`), la columna se pone a `NULL` en el mismo `UPDATE`. Un
`CHECK` impone que haya tokens sólo en una fila pendiente.

**Rationale**:

- El email lleva el enlace de gestión (FR-006), pero la base de datos guarda sólo su
  hash (001/D-005). Un reintento media hora después (FR-011) no puede reconstruirlo.
- Cifrado y efímero: el texto claro nunca se escribe; el cifrado existe como mucho
  1 hora (el plazo de reintento) y sólo para las citas que pidieron el email. Robar la
  base de datos sin la clave no da ningún enlace; robar las dos da como mucho los de la
  última hora.
- **Cambia una decisión vigente del CLAUDE.md** («la BD guarda sólo su hash»), no de la
  constitución: el Principio V no exige el hash. Se actualiza el CLAUDE.md al cerrar la
  feature para que diga «sólo su hash, y el token cifrado mientras su confirmación está
  pendiente».

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Guardar el token sólo en memoria | Un reinicio dentro del plazo de reintento pierde el envío; FR-011 deja de cumplirse. |
| Token de gestión determinista, `HMAC(secreto, id de la cita)` | Cambia el modelo de la credencial de la 001 para todas las citas, y filtrar el secreto expone todos los enlaces para siempre, no los de una hora. |
| Guardar el enlace en claro en la fila | Una copia de la base de datos daría acceso a las citas pendientes. |
| Enlace en el email que no sea el de gestión (p. ej. «abre tu cita» con un código) | Inventa una segunda credencial de acceso y una pantalla más para llegar a lo mismo. |

---

## D-003 — Primer intento justo después de responder; reintentos por cron

**Decisión**:

- **Primer intento**: la server action de la reserva y `POST /api/appointments` llaman
  a `after()` de `next/server` con el id del envío. La respuesta sale antes; el intento
  se hace a continuación, en el mismo proceso.
- **Reintentos**: un comando, `npm run notifications:dispatch`, procesa los envíos
  pendientes cuyo `next_attempt_at` ya ha llegado. Un cron lo lanza **cada minuto**,
  igual que la purga diaria (001/D-012).
- Cada envío se procesa dentro de una transacción que lo bloquea con
  `SELECT … FOR UPDATE SKIP LOCKED`: el `after()` y el cron nunca trabajan a la vez
  sobre la misma fila.
- **Calendario de reintentos** (dominio), contado **desde la reserva**: tras un fallo
  transitorio, el siguiente intento se programa en el primero de estos momentos que
  aún no haya pasado: a los 1, 3, 7, 15, 30 y 45 minutos. Son como mucho seis
  reintentos. Si el de los 45 minutos también falla, o ya no queda ningún momento antes
  de **1 hora desde la reserva** (FR-011), el envío pasa a `FAILED`.

**Rationale**:

- SC-001 (95 % en menos de 1 minuto) lo cubre el primer intento, sin esperar al cron.
- El cron por minuto recoge lo que el `after()` no pudo: proveedor caído, reinicio del
  proceso. Es el patrón que ya usa el proyecto para tareas periódicas, con su comando
  versionado y testeable.
- Una transacción abierta mientras dura la llamada al proveedor (con un *timeout* de
  10 s) es aceptable con este volumen y evita un estado intermedio `SENDING`.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Sólo cron, sin `after()` | El primer email tardaría hasta un minuto más; SC-001 queda justo. |
| Sólo `after()`, con reintentos en memoria | Un reinicio pierde los reintentos. |
| `setInterval` en `instrumentation.ts` | Un temporizador oculto dentro del servidor web, que corre en cada instancia y no se puede lanzar a mano ni probar como un comando. |
| `pg_cron` | 001/D-012 ya lo descartó: la lógica se queda en el código. |

---

## D-004 — Proveedor: Resend por HTTP, detrás de un puerto

**Decisión**: **Resend**, con su API HTTP llamada con `fetch`, sin SDK. El dominio de
envío se da de alta en la región de la UE. Cada petición lleva
`Idempotency-Key: <id del envío>`.

**Rationale**:

- El plan gratuito (unos 3.000 emails al mes, 100 al día) cubre de sobra unas 300
  citas al mes. Brevo también (300 al día).
- La clave de idempotencia hace seguro un reintento tras un corte entre «el proveedor
  lo aceptó» y «lo anotamos como enviado»: el proveedor no lo manda dos veces (FR-012).
  Es lo que inclina la balanza frente a Brevo.
- Con `fetch` no entra ninguna dependencia nueva, y el adaptador cabe en un archivo.
- El adaptador implementa un puerto (D-005). Cambiar a Brevo es otro adaptador, no otra
  feature.
- **A confirmar al contratar**: los límites del plan gratuito, la región de la UE, el
  contrato de encargado del tratamiento y el plazo de conservación de los registros
  del proveedor, que se fija en el mínimo que ofrezca (Principio III; ver D-012).

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Brevo | Empresa de la UE y plan gratuito suficiente, pero su API transaccional no ofrece clave de idempotencia; el duplicado tras un corte habría que asumirlo. Sigue siendo la alternativa si la región de la UE de Resend no convence. |
| SMTP con `nodemailer` | Una dependencia más, y SMTP no da idempotencia ni errores tan claros como una API HTTP. |
| SDK oficial de Resend | Una dependencia para una sola llamada `POST /emails`. |

---

## D-004 revisada (2026-11-04) — Brevo primero, Resend de reserva

**Decisión**: el email sale por **Brevo**, con su API HTTP (`POST /v3/smtp/email`,
cabecera `api-key`) y `fetch`. El adaptador de **Resend se conserva** y se elige con
`EMAIL_PROVIDER=resend`: si Brevo no funciona bien, volver es cambiar una variable y la
clave. `EMAIL_PROVIDER` vale `brevo` por omisión.

**Rationale**:

- La cuenta de Brevo, el dominio `automatizacionro.work` verificado (SPF, DKIM y DMARC)
  y su contrato de encargado ya existen por el chatbot multicliente: no entra ningún
  subencargado nuevo. Los 300 emails al día de su plan gratuito se comparten entre los
  dos proyectos y bastan de sobra.
- **Idempotencia**: la descartaba la D-004 original, pero Brevo sí la ofrece. El id del
  envío, un UUID, viaja como `idempotencyKey` dentro de `headers`, y una segunda
  petición con la misma clave se rechaza con `400 duplicate_parameter` en vez de
  enviarse. El adaptador lo cuenta como aceptado: ese email ya está en camino
  (FR-012). Brevo recuerda la clave **30 minutos**, frente a la hora de reintentos
  (D-003), así que un corte justo después de aceptar y un reintento pasada la media
  hora podrían duplicar la confirmación. Se acepta.
- **D-006 con Brevo**: de un `400` se lee sólo su `code`, un valor de la lista cerrada
  de Brevo, para distinguir `duplicate_parameter`; su `message` puede repetir la
  dirección y no se mira. Cualquier otro cuerpo se descarta sin leer.

**Consecuencia sobre la baja (D-009)**, aceptada por la dueña del producto el
2026-11-04:

- La API de Brevo no admite cabeceras estándar en `headers`, y Brevo añade su propia
  `List-Unsubscribe` a todos los emails, también a los transaccionales. Quitarla sólo
  se puede en su plan Enterprise. Por eso el adaptador **no envía** las cabeceras de
  baja del mensaje.
- El botón «Cancelar suscripción» del gestor de correo da de baja **en Brevo**, en la
  lista de bloqueados de toda la cuenta, compartida con el chatbot. La app no se entera:
  si esa dirección vuelve a reservar, Brevo acepta el email y no lo entrega, y la marca
  de la dueña no sale. Contradice en parte la aclaración del 2026-11-04 de la spec («no
  se guarda ninguna lista de direcciones dadas de baja»): la app no la guarda, pero el
  proveedor sí.
- El enlace de baja del **cuerpo** del email sigue siendo el de la app (`/baja/{token}`),
  y la baja desde la pantalla de la cita no cambia. `POST /api/unsubscribe/{token}`
  queda para el adaptador de Resend, que sí envía las cabeceras.
- Comprobar en la primera prueba real qué cabecera `List-Unsubscribe` llega. Si esto
  molesta en la práctica, se vuelve a Resend.

---

## D-005 — El puerto `Notifier` y los canales por configuración

**Decisión**:

- Puerto de aplicación `Notifier` con un método `send(message, idempotencyKey)` que
  devuelve `Result<void, 'TRANSIENT' | 'PERMANENT'>`. El mensaje lleva su canal; esta
  feature sólo construye mensajes de email.
- Los canales se encienden por entorno: `NOTIFICATIONS_EMAIL=on|off` y
  `NOTIFICATIONS_SMS=off`. Con `on`, el arranque exige `EMAIL_API_KEY` y `EMAIL_FROM`
  y falla si faltan, en lugar de dejar el canal apagado sin avisar.
- `NOTIFICATIONS_SMS` sólo admite `off` en esta feature: no hay adaptador de SMS, y
  encenderlo es la feature que lo conecte. El dominio ya conoce el canal `SMS` (tipo
  y `CHECK` de la tabla) para que añadirlo no exija migrar.
- El caso de uso pregunta a un puerto `ChannelSettings` qué canales están encendidos.
  Con el email apagado, el formulario no pinta la casilla (FR-004) y una reserva por API
  con `emailConsent: true` se acepta y se ignora: no se crea ni consentimiento ni
  envío.

**Rationale**: es la recomendación del roadmap («SMS detrás de un puerto `Notifier`
activable por configuración») sin escribir un adaptador que nadie usa, que sería
código muerto en `main` (CLAUDE.md).

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Un adaptador de SMS de Twilio en modo de prueba | Código que no se ejecuta en producción; cuando se elija proveedor puede no ser Twilio. |
| Canal encendido si hay API key, sin interruptor | Una variable olvidada en producción apaga el email sin que nadie se entere. |

---

## D-006 — Errores del proveedor: transitorio o permanente, y nunca su texto

**Decisión**:

- Red, *timeout*, `429` y `5xx` → `TRANSIENT` (se reintenta).
- Cualquier otro `4xx` → `PERMANENT` (dirección rechazada, petición inválida): el envío
  pasa a `FAILED` sin más intentos.
- El adaptador **nunca** devuelve ni registra el cuerpo de la respuesta del proveedor,
  que puede repetir la dirección. Sólo el código HTTP y el `name` del error del
  proveedor, si lo trae.
- El logger añade a sus rutas redactadas `to`, `subject`, `html`, `text` y
  `sealedTokens`.

**Rationale**: FR-022 pide que el email no aparezca tampoco dentro de los errores del
proveedor. El `serializeError` del logger conserva `message`, así que el texto del
proveedor no puede llegar a un `Error`.

---

## D-007 — Consentimiento por cita y por canal

**Decisión**: tabla `channel_consent` con clave `(appointment_id, channel)`,
`granted_at`, `ended_at`, `end_reason` y `unsubscribe_token_hash`.

- **Por cita** (clarificación del 2026-11-04): no hay lista de direcciones dadas de
  baja. Una baja no afecta a otras citas con la misma dirección.
- `end_reason`:
  - `UNSUBSCRIBED`: el cliente se dio de baja, desde el email o desde su cita.
  - `EMAIL_CHANGED`: la dueña cambió o quitó el email de la cita (Historia 11 de la
    002). El consentimiento se dio para la dirección que escribió el cliente (FR-008).
- El token de baja son 32 bytes aleatorios, como el de gestión, y la base de datos
  guarda su SHA-256 (FR-024). Es una credencial distinta: quien tenga la vía de baja no
  puede abrir la cita.
- Una cita sin consentimiento no tiene fila. «Sin fila» y «con `ended_at`» significan lo
  mismo para el envío: no se envía.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Columnas en `appointment` (`email_consent_at`, …) | El canal SMS obligaría a duplicarlas, y la tabla de citas, que lee la disponibilidad, crece sin necesidad. |
| La vía de baja con el token de gestión (`/cita/{token}/baja`) | Quien tiene la vía de baja podría abrir y cancelar la cita (FR-024). |

---

## D-008 — Qué decide el dominio y qué pinta la infraestructura

**Decisión**: un módulo nuevo, `src/domain/notifications/`, TypeScript puro:

- `decideDelivery(input)`: con la cita como está ahora, su consentimiento, el envío y
  el instante actual, devuelve `SEND`, `SKIP` con su motivo (`CONSENT_ENDED`,
  `APPOINTMENT_CANCELLED`, `PERSONAL_DATA_DELETED`) o `EXPIRED`. Es el único sitio que
  decide si sale un email (FR-005, FR-008, FR-009, FR-011).
- `nextAttemptAt(attempts, createdAt)`: el calendario de D-003, o `null` si se pasa del
  plazo.
- `confirmationContent(appointment, salon, policy)`: los **datos** del email —día,
  horas en la zona del salón, servicios con precio o sin él, total, plazo— reutilizando
  `deriveView` y el total de la 005. Datos, no texto.
- `needsConfirmationCall(appointment, delivery, now)`: si la dueña debe ver la marca
  (FR-020a): cita online, confirmada, no pasada y con la confirmación `FAILED`.

La infraestructura (`src/infrastructure/notifications/confirmation-email.ts`) convierte
esos datos en asunto, texto y HTML con los textos de `src/messages/es-ES.ts`.

**Rationale**: una regla de negocio en un solo sitio (Principio I). Que un email salga
o no se prueba con unitarios sin base de datos ni proveedor. Los textos viven donde
viven todos (CLAUDE.md).

---

## D-009 — La baja: página con botón y baja de un clic para el gestor de correo

**Decisión**:

- **Página** `/baja/[token]`: con un `GET` enseña el nombre del salón y un botón
  «Darme de baja»; el botón envía un formulario (server action, `POST`). Abrir la página
  no da de baja (FR-015). Tras confirmar, la misma página dice que ya no recibirá
  emails; con la baja ya hecha, dice que ya estaba dado de baja (escenario 3 de la
  Historia 2).
- **API** `POST /api/unsubscribe/{token}`: la misma baja, para el botón «Cancelar
  suscripción» del gestor de correo. Cada email lleva las cabeceras `List-Unsubscribe`
  (con esa URL) y `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Es un
  `POST` explícito, no un enlace que un antivirus abra solo.
- **Pantalla de la cita**: si tiene consentimiento vigente, dice «Recibes la
  confirmación de esta cita por email» y ofrece «Dejar de recibir emails» (FR-017), con
  `POST /api/appointments/{token}/email-consent/revocation` en la API.
- Token inexistente, malformado o de una cita anonimizada → el mismo mensaje neutro y
  el mismo `404` que un enlace de gestión inválido (FR-018). La apertura de la página
  de baja cuenta en el mismo límite por IP que la apertura de enlaces
  (`APPOINTMENT_LOOKUP`, 001/D-006).

---

## D-010 — La casilla, la pantalla de confirmación y el contrato de cliente 2.2.0

**Decisión**:

- El formulario de reserva pinta una casilla `emailConsent`, desmarcada, bajo el campo
  de email y sólo con el canal encendido. Su etiqueta y su ayuda están en
  [contracts/ui-and-email.md](./contracts/ui-and-email.md).
- `POST /api/appointments` acepta `emailConsent: boolean`, opcional y `false` por
  defecto. Es un cambio **compatible**: el contrato de cliente pasa de 2.1.0 a
  **2.2.0**.
- `GET /api/appointments/{token}` añade `emailNotifications: { "active": boolean }`.
- La pantalla de confirmación (`/cita/{token}?nueva=1`) cambia el aviso de guardar el
  enlace según haya consentimiento (FR-013): con él, nombra la dirección, avisa del
  spam y sigue recomendando guardar el enlace; sin él, el texto de la 001.

---

## D-011 — La marca de la dueña sale en la misma consulta

**Decisión**: `findInWindow` (agenda) y `BookingListReader.readPage` (listado) añaden
un `LEFT JOIN` a `notification` sobre la confirmación de email y devuelven su estado
como `confirmationDelivery: 'FAILED' | 'OTHER' | null`. El dominio decide la marca con
`needsConfirmationCall`. El contrato de gestión pasa de 1.2.0 a **1.3.0**, con el campo
`confirmationEmailFailed: boolean` en cada cita de la agenda y del listado.

**Rationale**: FR-020a sin consultas N+1 (Principio VIII, 002/D-027). Un índice único
`(appointment_id, channel, kind)` hace que el join devuelva como mucho una fila.

---

## D-012 — Retención, borrado y datos personales

**Decisión**:

- `notification` y `channel_consent` **no tienen datos personales**: id de la cita,
  canal, tipo, estados, momentos, motivos y hashes. Se conservan con la cita, también
  anonimizada, como el resto del histórico (001/BR-018).
- La anonimización (purga a 12 meses y borrado a petición) pasa a ser **una sentencia**
  con CTE que, además de la cita, pone a `NULL` el `unsubscribe_token_hash` de sus
  consentimientos y pasa a `NOT_SENT` (`PERSONAL_DATA_DELETED`), sin tokens, cualquier
  envío pendiente (FR-021). Sigue sin existir un instante en que la cita esté
  anonimizada y su vía de baja resuelva.
- **La copia del proveedor.** El proveedor conserva un registro de cada envío con la
  dirección, el asunto y el cuerpo, que lleva el nombre. Es una copia derivada, y el
  Principio III exige que el borrado a petición la alcance:
  - Su conservación se fija en el **mínimo** que permita el proveedor, que es el tope
    de lo que puede durar la copia aunque nadie pida nada.
  - **Borrado a petición**: el procedimiento de borrado de la 001
    (`npm run retention:purge -- --appointment <uuid>`) gana un segundo paso
    documentado: borrar ese envío en el proveedor. Si su API permite borrar envíos,
    se hace por ella con el id del envío, que es la `Idempotency-Key` y el único dato
    que se necesita. Si no, se le pide por el canal que fije el contrato de encargado
    del tratamiento, y se anota el plazo en que se compromete a cumplirlo.
  - El correo que ya está en el buzón del cliente es suyo, no una copia de la app.
  - Lo que el proveedor ofrezca de verdad se comprueba al contratarlo, y el
    procedimiento queda escrito con ese dato antes de enviar a clientes reales.

---

## D-013 — Estrategia de testing y orden de trabajo

**Decisión**:

- **Unitarios** (dominio): `decideDelivery` en todos sus casos, incluido «confirmación
  de una cita ya cancelada» (el caso límite que exige el Principio II para los
  recordatorios); `nextAttemptAt` en el borde de la hora; `confirmationContent` con
  precio, sin precio y mixto, y una cita que cruza un cambio de hora;
  `needsConfirmationCall`. Render del email: los textos, la versión de texto plano y
  que no lleva teléfono ni email del cliente (FR-007).
- **Integración** (contra `db-test`): la transacción de D-001 (una cita rechazada por
  `EXCLUDE` no deja consentimiento ni envío), el despacho con un reloj fijo (reintento,
  plazo agotado, cita cancelada, email cambiado por la dueña, dos despachos a la vez
  que envían una sola vez), la purga con un envío pendiente, el adaptador de Resend
  contra un **proveedor falso** y los logs sin datos personales con un proveedor que
  devuelve la dirección en su error.
- **Proveedor falso**: un servidor HTTP pequeño en `tests/support/fake-email-provider.ts`
  que imita `POST /emails` de Resend, guarda en memoria lo recibido y se puede poner a
  fallar. El adaptador real apunta a él con `EMAIL_API_BASE_URL`. Lo usan integración,
  contrato y e2e, y `npm run email:fake` lo arranca para la prueba manual.
- **Contrato**: `emailConsent`, `emailNotifications`, la revocación y la baja contra
  `http-api.yaml` 2.2.0; `confirmationEmailFailed` contra `owner-api.yaml` 1.3.0.
- **E2E** (tres tamaños + axe): reservar con y sin la casilla y leer el email en el
  proveedor falso; abrir su enlace de gestión; darse de baja desde el email y desde la
  cita; proveedor caído sin efecto en la reserva; la marca en la agenda. El límite de
  2 s —SC-002 de esta feature, SC-004 de la 001— se mide con la casilla marcada, y
  SC-001 con el tiempo que tarda el email en llegar al proveedor falso sin lanzar el
  cron.
- **Canal en las suites**: la suite e2e corre entera con `NOTIFICATIONS_EMAIL=on`
  (un solo servidor, el caso real), así que los e2e de la 001 a la 005 deben seguir en
  verde con la casilla presente. Unitarios, integración y contrato corren con `off`
  salvo los archivos que arrancan el proveedor falso.
- **Orden**: base (migración, dominio, puerto, adaptador, render, proveedor falso) →
  US1 → US2 (baja) → US3 (fiabilidad y marca) → cierre de documentos. El token de baja
  y su enlace en el email nacen en la base y en US1, porque todo email lleva su vía de
  baja (Principio IV). Ninguna historia llega a `main` sola: la feature se fusiona
  entera, con US2 y US3, porque US1 sin baja ni reintentos no cumple el Principio IV.
