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
- [ ] **6 · 002, US4 + US5 + US6 + US11** → 🎯 **MVP completo**
  - Citas a mano, mover, editar y cancelar desde la agenda, aviso de conflicto atómico.
  - El cliente ve en su enlace quién canceló su cita (contrato de cliente 2.1.0).
- [ ] **7 · `004-notifications`:** avisos por email y, si se decide, SMS.
  Ver el apartado "Avisos" más abajo.
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

Cambia una decisión vigente: el CLAUDE.md y la spec 001 dicen que v1 no envía nada.
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
