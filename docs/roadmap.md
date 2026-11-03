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
- [ ] **2 · Actualizar la 002 con la US10 "Listado de reservas"**
  - Spec, plan, tareas y `/speckit-analyze`. Ver el apartado "US10" más abajo.
  - ~~Rebasar `002-salon-management` sobre `main`~~ — en su lugar se fusionó `main` en
    la rama el 2026-11-02, sin reescribir su historia; su documentación está en
    `main` (PR #4).
  - Fusionar de nuevo `main` en `002-salon-management` para traer la 005, del mismo
    modo, antes de revisar su spec.
  - Las pantallas de la dueña usan la base responsive de la 003 (clases `.page--split`,
    `.col-main`, `.col-side`, `.wide-only`, `NavForm`); revisar el plan de la 002 para
    que lo diga.
  - Revisar la 002 con el modelo de la 005: una cita lleva **uno o varios servicios**
    (`appointment_service`) y un servicio **puede no tener precio**. Afecta a la agenda
    y al listado (mostrar todos los servicios de cada cita, leídos en la misma consulta,
    sin N+1), a las citas a mano (elegir varios servicios, con la duración total), a
    mover citas (la duración es la suma de sus snapshots) y al catálogo de la US8
    (precio opcional, nunca 0).
- [ ] **3 · 002, fases 1 y 2: setup y base común**
  - Migraciones: cuenta de la dueña, sesión, periodos no disponibles, origen de la cita.
  - Dominio: la disponibilidad resta intervalos en lugar de descartar días; email y
    enlace de gestión opcionales; antelación y plazo leídos de la configuración.
  - Configuración leída en vivo (sustituye la caché de D-003).
  - **Control:** la 001 sigue en verde sin cambiar de comportamiento.
- [ ] **4 · 002, US1 + US2 + US10** → 🎯 **MVP mínimo**
  - Acceso de la dueña, agenda del día y listado de reservas.
  - Prueba manual en el navegador con la dueña del producto antes de seguir.
- [ ] **5 · 002, US3:** bloquear ratos (comida, vacaciones, festivos).
- [ ] **6 · 002, US4 + US5 + US6** → 🎯 **MVP completo**
  - Citas a mano, mover y cancelar desde la agenda, aviso de conflicto atómico.
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
- **A revisar en el modelo de datos:** si se guarda quién canceló (cliente o dueña).
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
