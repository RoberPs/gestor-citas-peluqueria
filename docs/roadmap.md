# Plan de trabajo hacia el MVP

Acordado el **2026-11-02**. El estado actual del producto está en
[README.md](../README.md).

**Cómo usar este documento en una sesión nueva:** leer el estado actual, buscar aquí el
primer paso sin marcar y, antes de empezar a implementar, confirmar con la dueña del
producto las decisiones pendientes que afecten a ese paso. Al cerrar un paso, marcarlo
y actualizar `README.md`.

## Objetivo

- **MVP mínimo:** la dueña entra con su contraseña, ve la agenda del día y el listado
  de reservas, y nadie más puede verlos.
- **MVP completo:** además puede bloquear ratos, apuntar, mover y cancelar citas a mano,
  y los conflictos se resuelven sin romper la garantía de no-superposición.

## Pasos

Cada paso termina con `npm run test:all`, `npm run lint` y `npm run check:layers` en
verde, y es un punto donde se puede parar.

- [x] **0 · Cerrar la 001** (rama `001-client-appointment-booking`) — PR #1 y #2,
  2026-11-02
  - Arreglar `availability-horizon.test.ts`: `seedHistory` recibe el instante de
    referencia en vez de usar `now()` de PostgreSQL.
  - Arreglar `slotDaysFromNow` para que no caiga en el día de cierre del seed.
  - Primero el commit `test:` que reproduce el fallo, después el arreglo.
  - Abrir PR a `main` y fusionar.
- [x] **1 · `003-responsive-desktop`** — PR #3, 2026-11-02
  - Spec corta con `/speckit-specify`.
  - Tres tamaños: móvil (< 640 px, el actual), tablet (≥ 640 px), ordenador
    (≥ 1024 px, reserva en dos columnas: servicio y días a la izquierda, horas y
    formulario a la derecha).
  - Tests e2e y de accesibilidad también a 1280 px.
  - Va antes de la 002 para que las pantallas de la dueña nazcan responsive.
- [x] **1b · `005-multiple-services`:** varios servicios por cita y precio opcional —
  PR #6, 2026-11-03
  - Spec con `/speckit-specify`, después plan, tareas y `/speckit-analyze`. Ver
    "Decisiones tomadas" del 2026-11-02 sobre la 005.
  - Va antes de la 002, como la 003: las pantallas de la dueña nacen mostrando varios
    servicios por cita y sin que haya que migrar datos después.
  - Una cita guarda sus servicios en `appointment_service`, cada uno con su snapshot; el
    contrato HTTP vivo pasa a la 2.0.0.
- [x] **2 · Actualizar la 002 con la US10 "Listado de reservas"** — rama
  `002-salon-management`, 2026-11-03
  - Spec, plan, tareas y `/speckit-analyze`. Ver el apartado "US10" más abajo.
    Resultado: la US10 entra como Fase 4b con las tareas T165–T187; decisiones nuevas
    D-030 a D-034 en `specs/002-salon-management/research.md`; las migraciones de la
    002 pasan a ser `0004`–`0007`; `/speckit-analyze` sin problemas críticos.
  - ~~Rebasar `002-salon-management` sobre `main`~~ — en su lugar se fusionó `main` en
    la rama el 2026-11-02, sin reescribir su historia; su documentación está en
    `main` (PR #4).
  - Fusionar de nuevo `main` en `002-salon-management` para traer la 005, del mismo
    modo, antes de revisar su spec. Hecho el 2026-11-03.
  - Las pantallas de la dueña usan la base responsive de la 003 (clases `.page--split`,
    `.col-main`, `.col-side`, `.wide-only`, `NavForm`); revisar el plan de la 002 para
    que lo diga.
  - Revisar la 002 con el modelo de la 005: una cita lleva **uno o varios servicios**
    (`appointment_service`) y un servicio **puede no tener precio**. Afecta a la agenda
    y al listado (mostrar todos los servicios de cada cita, leídos en la misma consulta,
    sin N+1), a las citas a mano (elegir varios servicios, con la duración total), a
    mover citas (la duración es la suma de sus snapshots) y al catálogo de la US8
    (precio opcional, nunca 0).
- [x] **2b · Llevar a la 002 las decisiones del 2026-11-03 sobre su revisión** — rama
  `002-salon-management`, 2026-11-03
  - Ver las cuatro entradas del 2026-11-03 que empiezan por «002» en "Decisiones
    tomadas": editar cita, búsqueda, textos de cancelación y tamaño de página.
  - Spec (historia nueva de editar cita, requisito de búsqueda en la US10, texto de
    la cancelación en la pantalla del cliente; quitar de *Out of Scope* y de las
    *Assumptions* lo que estas decisiones contradicen), plan, modelo de datos,
    contratos y tareas. Cerrar con `/speckit-analyze`.
    Resultado: la Historia 11 «Editar una cita» entra como Fase 8b; la búsqueda amplía
    la Fase 4b y añade la columna `customer_name_search` a la migración `0006`, que
    pasa a llamarse `0006_appointment_owner_fields.sql`; el cliente ve quién canceló, con
    el contrato de cliente 2.1.0 (`specs/002-salon-management/contracts/http-api-changes.md`)
    y el de gestión 1.2.0. Decisiones D-035 a D-037; tareas T188–T212 (212 en total);
    `/speckit-analyze` sin problemas críticos.
  - Concretado al bajarlo a la spec, confirmado por la dueña del producto el 2026-11-04: un término
    de sólo cifras que no es un teléfono completo se explica en vez de dar un listado
    vacío; editar no cambia la hora (mover y editar son dos acciones); al editar, el
    email puede quitarse también en una cita online, y un teléfono nuevo cuenta para el
    límite de 3 citas futuras sin contar la propia cita.
  - Va antes del paso 3: la edición y los textos del cliente tocan el dominio y el
    contrato que el paso 3 empieza a construir.
- [x] **3 · 002, fases 1 y 2: setup y base común** — rama `002-salon-management`,
  2026-11-03
  - Resultado: migraciones `0004` (cuenta y sesión), `0005` (periodos no disponibles en
    lugar de cierres, convertidos en la zona del salón), `0006` (origen, quién canceló,
    email y enlace opcionales y nombre buscable) y `0007` (parámetros editables y
    horario sin solapes). La disponibilidad resta intervalos; la configuración se lee
    en vivo. 336 unitarios, 195 de integración, 94 de contrato y 210 e2e en verde.
  - Cambio respecto al plan: `customer_name_search` es una columna generada por
    PostgreSQL en lugar de escrita por el repositorio (D-036 revisada).
  - Aplazado a la historia que lo usa: el script `owner:provision` y sus variables
    (T002, T003, con T056), los puertos de cuenta, sesión y escritura (T025), el bloque
    de textos `owner` (T030, con T058) y la comida del martes en el seed (T029, con la
    US2).
  - Migraciones: cuenta de la dueña, sesión, periodos no disponibles, origen de la cita,
    quién la canceló y nombre buscable.
  - Dominio: la disponibilidad resta intervalos en lugar de descartar días; email y
    enlace de gestión opcionales; antelación y plazo leídos de la configuración.
  - Configuración leída en vivo (sustituye la caché de D-003).
  - **Control:** la 001 sigue en verde sin cambiar de comportamiento.
- [x] **4 · 002, US1 + US2 + US10** → 🎯 **MVP mínimo** — rama `002-salon-management`,
  2026-11-04
  - Acceso de la dueña, agenda del día y listado de reservas.
  - Resultado: fases 3, 4 y 4b de la 002 (94 de 212 tareas). 411 unitarios, 236 de
    integración, 123 de contrato y 272 e2e en verde; lint y `check:layers` también.
  - Aplazado: T070 (redacción de Pino en los cuerpos de crear, editar y conflicto) pasa
    a la US6, porque en este paso ningún código registra esos cuerpos.
  - Probado a mano en el navegador con la dueña del producto el 2026-11-04, que
    confirmó los tres detalles concretados en el paso 2b (ver "Decisiones tomadas").
- [x] **5 · 002, US3:** bloquear ratos (comida, vacaciones, festivos) — rama
  `002-salon-management`, 2026-11-04
  - Resultado: fase 5 de la 002 (T071–T082; 107 de 212 tareas). Desde la agenda se
    bloquean unas horas de un día o varios días enteros, en múltiplos de 15 minutos y
    con un motivo que el cliente nunca ve, y cada rato se libera desde la línea
    temporal. Sobre citas confirmadas, el aviso las nombra y sólo guarda si la dueña
    las acusa todas; no cancela ninguna. El cliente lo nota en la consulta siguiente.
    468 unitarios, 256 de integración, 144 de contrato y 284 e2e en verde; lint y
    `check:layers` también.
  - Adelantado de la US6: `detectConflicts` y `computeStateToken` (T108 y parte de
    T114), porque el `409` del contrato exige el `stateToken`. Cancelar citas desde este
    aviso queda para T116.
  - Decidido al implementar: liberar un rato ya terminado se permite (BR-009 prohíbe
    crear, mover, editar y cancelar, no liberar); crearlo o acortarlo, no.
  - `password.test.ts` lleva un timeout propio de 30 s: con la suite entera en paralelo,
    sus cuatro derivaciones de scrypt pasaban de los 5 s por defecto.
  - Probado a mano en el navegador con la dueña del producto el 2026-11-04: bloquear la
    comida, liberarla, bloquear sobre una cita y bloquear días enteros, sin cambios.
- [x] **6 · 002, US4 + US5 + US6 + US11** → 🎯 **MVP completo** — rama
  `002-salon-management`, 2026-11-04
  - Citas a mano, mover, editar y cancelar desde la agenda, aviso de conflicto atómico.
  - El cliente ve en su enlace quién canceló su cita (contrato de cliente 2.1.0).
  - Resultado: fases 6, 7, 8 y 8b de la 002, más T070 (164 de 212 tareas). 565
    unitarios, 306 de integración, 173 de contrato y 326 e2e en verde; lint y
    `check:layers` también.
  - Decidido al implementar:
    - Un aviso sin conflicto (cita fuera de horario) responde `409` con `code: WARNING`
      y `conflicts` vacía, y se acusa con `acknowledgedWarnings`. Si el estado cambia
      también al recalcular, `409` con `code: STATE_CHANGED`. Está en `owner-api.yaml`.
    - Al editar, sólo se busca conflicto en lo que la cita crece: corregir un teléfono
      de una cita con un rato bloqueado debajo no lo saca como conflicto.
    - Las escrituras de la dueña toman un *advisory lock* de transacción, y la
      restricción `EXCLUDE` sigue siendo la red frente a las reservas online.
    - La pantalla es la agenda con un panel lateral por acción (`?nueva=`, `?mover=`,
      `?editar=`, `?cancelar=`): funciona sin JavaScript y el teléfono del cliente
      nunca va en la URL. El conflicto se resuelve en un `dialog` modal nativo.
    - Bloquear un rato pasa por el mismo protocolo y la API permite cancelar las citas
      que pisa (T116); la pantalla de la US3 sigue ofreciendo sólo acusarlas.
  - Pendiente: probarlo a mano en el navegador con la dueña del producto, y la medición
    de SC-015 en el e2e de editar (T204).
- [x] **7 · `004-notifications`:** email de confirmación al reservar — rama
  `004-notifications`, 2026-11-04. Sin SMS (canal apagado, sin adaptador).
  - Resultado: casilla en el formulario (desmarcada), consentimiento y envío pendiente
    en la misma transacción que la cita (migración `0008`), primer intento con
    `after()` y reintentos durante 1 hora con `npm run notifications:dispatch` por cron,
    Resend por HTTP con `Idempotency-Key`, baja desde el email (`/baja/{token}` y baja
    de un clic RFC 8058) y desde la cita, anonimización que alcanza baja y envíos
    pendientes, y la marca «Confirmación por email no enviada» en la agenda y el
    listado. Contratos: cliente 2.2.0 y gestión 1.3.0.
  - Checks: unitarios 695, integración 395, contrato 200, e2e 358; lint y
    `check:layers` en verde.
  - Probado a mano el 2026-11-04 con el proveedor falso, siguiendo la «Validación
    manual» del quickstart (T085): todo como se espera. En el camino salieron los
    límites de la 001 (5 reservas por hora por IP, 3 citas futuras por email), que se
    comportan como deben. La bandeja del proveedor falso pasó a renderizar los emails
    en `http://127.0.0.1:4010/` para poder leerlos.
  - Pendiente antes de enviar a clientes reales: el alta en Resend (dominio, región UE)
    y la tabla del contrato de encargado en `specs/004-notifications/quickstart.md`.
- [ ] **7b · Producción de prueba** en `niza.automatizacionro.work`, en el VPS y el
  Cloudflare del chatbot multicliente. Va antes de los pasos 8 y 9. Ver las decisiones
  del 2026-11-04 sobre producción.
  - [x] Fusionar la 002 y la 004 en `main` con la CI en verde, una PR por feature. La
    002 entró con la PR #8 y la 004 con la PR #9, las dos el 2026-11-04.
  - [x] Adaptador de Brevo detrás del puerto `Notifier`, con TDD, y `EMAIL_PROVIDER`
    para volver a Resend; D-004 revisada, quickstart y `.env.example` de la 004
    actualizados.
  - [x] Imagen para el VPS compartido, rama `deploy-shared-vps`, 2026-11-05: HSTS y CSP
    en `next.config.ts` (sin `preload`: es un subdominio de una zona compartida),
    `/health` con su test y `HEALTHCHECK`, `node:22-slim` fijada por el digest del
    chatbot, `.dockerignore` en lista blanca, salida `standalone` sin devDependencies,
    usuario `node`, sin npm en la imagen y versión obligatoria en la etiqueta. Los
    comandos (`migrate`, `provision-owner`, `retention-purge`,
    `dispatch-notifications`, `seed-demo` y el nuevo `load-salon`) se empaquetan con
    esbuild en `cli/*.mjs` (`npm run build:cli`) y corren con `node`, sin `tsx`.
  - [x] Imagen publicada en GHCR el 2026-11-05, privada:
    `ghcr.io/roberps/gestor-citas-peluqueria:1.0.0`, digest
    `sha256:c8a07e72e93f7fda1d6730556d60c4b901af95e3acdedbea8178467c8f43f008`.
  - [x] `deploy/`, 2026-11-05: compose propio (app y PostgreSQL sin puertos, la base sólo
    en una red interna sin salida), la app como `salon_app`, **no superusuario**
    (`btree_gist` es extensión de confianza), en `chatbot_proxy` y endurecida; bloque
    para el Caddyfile del chatbot que reutiliza su fragmento `(instancia)`; copias
    diarias cifradas con gpg y verificadas que baja `descargar-copias.ps1`; reintentos de email por cron y copia y purga con temporizadores de systemd en hora de
    Madrid (el cron de Ubuntu no entiende `CRON_TZ`, comprobado en el VPS); `vps.sh` (`preparar`, `imagen`, `comprobar`);
    `prueba-ip.sh`; y `load-salon`, que carga el salón desde un JSON sin tocar los
    ratos bloqueados. Guía en `deploy/README.md`. Sustituye a `./docker-compose.prod.yml`
    y `./Caddyfile`. Probado en local con la imagen: migraciones con `salon_app`,
    todos los comandos en el contenedor de sólo lectura, un Caddy real con el Caddyfile
    del chatbot (el `X-Forwarded-For` falso no sirve y cada visitante tiene su
    contador), y una copia restaurada entera.
  - **Cambio sobre el plan:** en producción no se ejecuta `db:seed`. Es el fixture de los
    tests y sólo dejaría sus servicios desactivados en la base; `seed-demo` ya carga la
    configuración completa. La imagen no lo trae.
  - [ ] Puesta en marcha en el VPS (`deploy/README.md`).
    - [x] 2026-11-05, pasos 3 a 6, 10 y 11: entornos `0600` y secretos en Bitwarden, imagen
      comprobada por digest, base con `salon_app` y las 8 migraciones, app `healthy`, datos
      de la demo, cuenta de la dueña (contraseña retirada del entorno), `vps.sh comprobar`
      en verde, reintentos de email por cron, copia y purga con temporizadores de systemd,
      primera copia hecha y bajada al PC, y la tarea «Gestor citas - descargar copias del
      VPS» (diaria, 09:45) probada.
    - [ ] Cuando se quiera enseñar la demo: registro `A` `niza` en Cloudflare y bloque en el
      Caddy del chatbot (paso 7), prueba de la IP (paso 8) y, con la clave de Brevo,
      el email y una reserva real (paso 9).
- [ ] **8 · 002, US7 + US8 + US9:** editar horario, catálogo y parámetros desde la app.
- [ ] **9 · Pulido final:** accesibilidad, rendimiento, revisión de datos personales en
  logs, quickstart y corrección de los defectos menores listados en `README.md`.

## US10 · Listado de reservas (propuesta)

Pantalla privada de la dueña, dentro de la 002.

- **Canceladas:** ocultas por defecto, igual que en la agenda (FR-015). Un filtro
  *Confirmadas / Canceladas / Todas* las muestra con la etiqueta "× Cancelada" (texto e
  icono, no sólo color) y la fecha de cancelación.
- **Cada fila:** día y hora, servicio, nombre, teléfono, estado, origen (online o a mano)
  y fecha de reserva.
- **Orden:** *Próximas citas* por defecto (de hoy en adelante, por fecha de la cita) o
  *Últimas reservas recibidas* (por fecha de creación).
- **Filtros:** estado, origen y rango de fechas. Lista paginada.
- **Acción:** desde cada fila se va a la cita en la agenda.
- **Quién canceló:** se guarda (cliente o dueña) y el listado lo muestra. Decidido el
  2026-11-03; columna `cancelled_by`, D-032 de la 002.
- **A aclarar en la spec:** "vista de semana o de mes" sigue fuera de alcance; un
  listado no es una vista de calendario.

## Avisos (004)

*Hecho en el paso 7 (email); el SMS sigue pendiente de presupuesto.* Cambia una
decisión vigente: el CLAUDE.md y la spec 001 dicen que v1 no envía nada.
Activa el **Principio IV** de la constitución: consentimiento por canal, baja y
registro de envíos.

**Email:** un plan gratuito basta para un salón de un sillón (Resend, unos 3.000 al mes;
Brevo, unos 300 al día). Además el enlace de la cita deja de depender de que el cliente
lo guarde desde la pantalla de confirmación.

**SMS:** no hay opción gratuita válida para clientes reales.

| Opción | Coste | Comentario |
|---|---|---|
| Prueba de Twilio o Vonage | Crédito inicial | Sólo a números verificados. Para desarrollo. |
| Proveedor de pago (Brevo, Twilio, Vonage, Amazon SNS) | Aprox. 5–9 cént. por SMS en España, a confirmar al contratar | La opción fiable. Unos 30–50 €/mes con 300 citas y 2 SMS por cita. |
| Móvil del salón como pasarela (p. ej. httpSMS) | Tarifa del móvil | Depende del teléfono encendido; muchas operadoras lo prohíben. No recomendado. |
| WhatsApp Business API | De pago por mensaje | Muy usado en España. |
| Bot de Telegram / push web | Gratis | Telegram exige que el cliente inicie el bot; push en iPhone exige instalar la web. |

**Recomendación:** email desde el primer día; SMS detrás de un puerto `Notifier`
activable por configuración, desarrollado con el modo de prueba de Twilio y conectado a
un proveedor de pago cuando se decida el presupuesto.

## Decisiones pendientes

Ninguna por ahora.

## Decisiones tomadas

- 2026-11-04 · **Producción · Alcance:** se despliega ya el MVP completo con la 004;
  los pasos 8 y 9 van después. Mientras no exista la US7–US9, el horario y los
  servicios se cargan con un script de datos del salón.
- 2026-11-04 · **Producción · Prueba antes de abrirla:** el primer despliegue es de
  prueba, con los datos de la demo y sin anunciarlo a clientes. Copias y registro de
  envíos listos antes de abrirlo al público.
- 2026-11-04 · **Producción · Dominio:** `niza.automatizacionro.work`, en la zona de
  Cloudflare del chatbot. Si el cliente lo acepta, después se migra a su dominio, o a
  uno nuevo que se le gestione en Cloudflare. El dominio es sólo configuración
  (`PUBLIC_BASE_URL` y el bloque de Caddy); al migrar, el subdominio de prueba redirige
  al nuevo conservando la ruta, para que los enlaces de los emails ya enviados sigan
  valiendo. El dominio nuevo tiene que estar en Cloudflare, porque el cortafuegos del
  VPS sólo admite el 443 desde sus rangos.
- 2026-11-04 · **004 · Proveedor: Brevo en lugar de Resend.** Reutiliza la cuenta, el
  dominio verificado y el DPA del chatbot; 300 emails al día compartidos bastan. Se
  usa su API HTTP con una clave propia del proyecto. Se acepta que, sin clave de
  idempotencia, un corte entre el envío y su anotación pueda duplicar una confirmación.
  Sustituye la decisión D-004 de la 004. Si Brevo no funciona bien, se vuelve a Resend:
  su adaptador se conserva y se elige con `EMAIL_PROVIDER=resend`. Al comprobar su API
  salió que Brevo sí admite idempotencia (30 minutos) y que añade su propia baja de un
  clic, que va a la lista de bloqueados de toda la cuenta; la dueña del producto lo
  acepta. Detalle en «D-004 revisada» de `specs/004-notifications/research.md`.
- 2026-11-04 · **Producción · Infraestructura compartida:** el Caddy del chatbot
  sigue siendo el único en los puertos 80 y 443, y este proyecto se le suma con un
  bloque propio y la red `chatbot_proxy`. PostgreSQL propio, porque `btree_gist` pide
  superusuario. La imagen se construye en el PC y se publica en GHCR, como la del
  chatbot.

- 2026-11-04 · **004 · Clarificación:** la baja afecta **sólo a esa cita**, sin lista
  de direcciones dadas de baja; la dueña ve **sólo las confirmaciones fallidas**, con
  el teléfono del cliente para llamarle; los emails salen **del dominio del salón si lo
  tiene**, si no del de la app, con el nombre del salón como remitente y respuestas al
  email del salón. Falta confirmar con el cliente si tiene dominio.
- 2026-11-04 · **004 · Límite en las rutas de baja:** como el resto de rutas con token,
  superar el límite por IP se responde con el `404` neutro, nunca `429` (FR-038 de la
  001). Corrige una errata de `contracts/http-api-changes.md`, que decía `429`.

- 2026-11-04 · **002 · Detalles del paso 2b, confirmados en la prueba del paso 4:** la
  dueña los deja como están. Un teléfono a medias en la búsqueda pide el número entero
  en lugar de dar un listado vacío (D-036). Editar no cambia la hora: mover y editar
  son dos acciones (FR-073). Al editar, el email puede quitarse también en una cita
  online, cuyo enlace no depende de él (FR-075). Que todavía no se pueda editar es lo
  previsto: la edición (US11) llega en el paso 6.

- 2026-11-03 · **002 · Editar una cita:** la dueña puede editar una cita confirmada y
  no pasada: sus **servicios** (añadir, quitar, cambiar) y los **datos del cliente**
  (nombre, teléfono, email). Sustituye a "cancelar y apuntar otra". Si la cita se
  alarga y pisa algo, sale el mismo aviso de conflicto que al moverla. Los servicios
  añadidos se guardan con el precio y la duración del momento. Una cita online
  conserva su enlace, que pasa a mostrar los servicios nuevos. El cliente sigue sin
  poder cambiar los servicios.
- 2026-11-03 · **002 · Buscar en el listado:** la US10 permite buscar por **nombre o
  teléfono**, combinable con los filtros. El teléfono se compara sin espacios ni
  prefijo; el nombre, sin mayúsculas ni acentos y por una parte. Las citas
  anonimizadas no aparecen al buscar. Deja de estar fuera de alcance.
- 2026-11-03 · **002 · Textos de la cancelación:** en la pantalla del cliente (su
  enlace), «Has cancelado esta cita» si la canceló él y «El salón ha cancelado esta
  cita», con el teléfono del salón, si la canceló la dueña. En el listado de la
  dueña, «Cancelada por el cliente» y «Cancelada por ti».
- 2026-11-03 · **002 · Listado:** 20 citas por página con *Página siguiente* y
  *Volver al principio*; el filtro de fechas se aplica al día de la cita en los dos
  órdenes.

- 2026-11-03 · **US10 · Quién canceló:** cada cancelación guarda si la hizo el cliente
  desde su enlace o la dueña desde la gestión, y el listado lo muestra. Las
  cancelaciones anteriores se registran como del cliente, que era el único que podía
  cancelar.
- 2026-11-03 · ~~**002 · Servicios de una cita:** la dueña tampoco cambia los servicios
  de una cita confirmada en v1; mover sólo cambia la hora, como para el cliente en la
  005. Para cambiarlos, cancela y apunta una nueva.~~ **Sustituida** el mismo día por
  «002 · Editar una cita».

- 2026-11-02 · **005 · Varios servicios por cita:** el cliente puede elegir varios. La
  cita dura la **suma** de sus servicios. Sin máximo y sin combinaciones prohibidas.
  Al reprogramar sólo cambia la hora; para cambiar servicios se cancela y se reserva
  de nuevo.
- 2026-11-02 · **005 · Precio opcional:** un servicio puede no tener precio; la
  pantalla dice "Precio a consultar en el salón" en lugar de "0,00 €".
- 2026-11-02 · **Duración de los servicios:** 30 minutos cada uno hasta que el
  peluquero diga lo que tarda; la reserva sigue siendo cada media hora.
- 2026-11-02 · **Demo:** datos reales de la Peluquería de Caballeros Niza en
  `db/seed/demo.ts` (`npm run db:seed:demo`), separados del fixture de los tests. El
  nombre se dedujo del email de la empresa; confirmarlo con el cliente.

- 2026-11-02 · **Avisos de la 004:** sólo la **confirmación al reservar**, enviada al
  cliente con los datos de la cita y su enlace de gestión. Recordatorio, aviso de
  cambios hechos por la dueña y aviso a la dueña quedan fuera por ahora.
- 2026-11-02 · **Canal:** sólo email (plan gratuito). El SMS queda preparado detrás del
  puerto `Notifier` y se activará cuando se decidan proveedor y presupuesto.
- 2026-11-02 · **US10:** las canceladas se ocultan por defecto y se muestran con el
  filtro *Confirmadas / Canceladas / Todas*, como en la agenda (FR-015).
- 2026-11-02 · Se empieza por el paso 0.
- 2026-11-02 · Cada feature se fusiona a `main` al cerrarla, no todas al final del
  proyecto. Cada una conserva su spec en `specs/NNN-…/`.

- 2026-11-02 · El listado de reservas es una historia de la 002 (US10), no una feature
  aparte, y entra en el MVP mínimo.
- 2026-11-02 · El responsive para ordenador se hace antes de las pantallas de la dueña.
- 2026-11-02 · Los avisos van después del MVP completo, porque el más útil (avisar al
  cliente cuando la dueña mueve o cancela su cita) necesita que la gestión exista.
