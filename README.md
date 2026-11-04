# Gestor de Citas de Peluquería

App web para un salón de un solo sillón: el cliente reserva, consulta, reprograma y
cancela su cita desde el móvil, sin cuenta de usuario.

- Reglas de producto: [constitución](.specify/memory/constitution.md)
- Especificaciones: [specs/](specs/)
- Plan de trabajo y decisiones: [docs/roadmap.md](docs/roadmap.md)
- Stack y convenciones de desarrollo: [CLAUDE.md](CLAUDE.md)

## Arranque local

Requiere Node.js 22 y Docker.

```bash
npm install
cp .env.example .env
docker compose up -d db db-test
npm run db:migrate
npm run db:seed         # datos de prueba: los que usan los tests
npm run dev             # http://localhost:3000
```

Tests: `npm run test:all`. Checks: `npm run lint` y `npm run check:layers`.

### Demo para el cliente

`npm run db:seed:demo` carga en la base de desarrollo los datos reales de la
**Peluquería de Caballeros Niza**: dirección, teléfono, horario (L–V 10:00–14:00 y
17:00–20:00; sábados 10:00–14:00) y sus cuatro servicios. Datos provisionales hasta
acordarlos con el cliente:

- Todos los servicios duran 30 minutos; la reserva sigue siendo cada media hora. Se
  pueden elegir varios en una cita: «Corte de pelo» + «Diseño y corte de barba» = 1 h.
- Ningún servicio tiene precio: la pantalla dice «Precio a consultar en el salón», nunca
  «0,00 €».
- No hay cierres por festivo.

La configuración se lee en cada consulta: lo que carga `npm run db:seed:demo` se ve al recargar, sin reiniciar la app.

Los servicios de prueba quedan desactivados, no borrados, porque puede haber citas que
los referencian. Para volver a los datos de prueba, `npm run db:seed`. Los tests usan
siempre `db-test` con su propio seed, así que cambiar la demo nunca los rompe.

## Estado del producto

Última revisión: **2026-11-04**.

### Resumen

La parte del **cliente** está construida y funciona: reserva, consulta, reprogramación y
cancelación sin cuenta. De la parte de la **dueña** está el **MVP mínimo** (paso 4 del
[roadmap](docs/roadmap.md)): entra con su contraseña y ve la agenda del día y el listado
de reservas, y nadie más puede verlos. Desde el paso 5 también bloquea ratos (comida,
vacaciones, festivos) desde la agenda. Con el paso 6 está el **MVP completo**: apunta,
mueve, edita y cancela citas desde la agenda, y lo que estorba se resuelve a la vista sin
romper la garantía de no-superposición. Falta probarlo a mano con la dueña del producto.

### Features

| Feature | Estado | Tareas | Rama | En `main` |
|---|---|---|---|---|
| [001 · Reserva del cliente](specs/001-client-appointment-booking/spec.md) | Implementada | 118 / 118 | `001-client-appointment-booking` | Sí (PR #1) |
| [002 · Gestión del salón](specs/002-salon-management/spec.md) | En curso: MVP completo (US1 a US6, US10 y US11), hecho el 2026-11-04; faltan US7, US8, US9 y el pulido | 164 / 212 (T139 y T140 las cubrió la 005) | `002-salon-management` | Sólo la documentación de antes de la revisión (PR #4) |
| [003 · Versión responsive para tablet y ordenador](specs/003-responsive-desktop/spec.md) | Implementada | 35 / 35 | `003-responsive-desktop` | Sí (PR #3) |
| 004 · Avisos por email y SMS | Planificada, sin spec | — | — | — |
| [005 · Varios servicios por cita y precio opcional](specs/005-multiple-services/spec.md) | Implementada | 55 / 55 | `005-multiple-services` | Sí (PR #6) |

`main` contiene la 001, la 003 y la 005 completas, la enmienda 1.1.0 de la constitución
y la primera documentación de la 002 (spec, plan y tareas). La rama
`002-salon-management` ya tiene la 003 y la 005 incorporadas y su documentación
revisada con ellas, con la US10 «Listado de reservas» y con las decisiones de la dueña
del producto del 2026-11-03: la US11 «Editar una cita», la búsqueda por nombre o
teléfono en el listado y el texto que ve el cliente según quién canceló. El código de cada feature se
fusiona a `main` al cerrarla, con la CI en verde. La 002 se implementa en su rama a
partir del paso 3 del [roadmap](docs/roadmap.md).

### Qué puede hacer hoy la app (001, 003 y 005)

Probado a mano el 2026-11-02, y la 005 el 2026-11-03:

- Elegir uno o varios servicios y ver la duración total; la cita dura la suma. Con cada
  cambio se recalculan los 14 días, marcados como *con huecos*, *lleno* o *cerrado*,
  con avance por rangos hasta 60 días. Sólo se ofrecen horas donde cabe la cita entera.
- Un servicio sin precio dice «Precio a consultar en el salón». El resumen, la
  confirmación y el enlace muestran cada servicio con su precio y el precio total, que
  suma los conocidos y añade «+ precio a consultar en el salón» si falta alguno.
- Ver las horas libres del día respetando la antelación mínima de 2 h y los tramos
  de apertura.
- Reservar con nombre, teléfono y email, con validación por campo que conserva lo escrito.
- Pantalla de confirmación con el enlace de gestión y el aviso de guardarlo.
- Desde el enlace: consultar, reprogramar (misma URL, hora actual marcada, mismos
  servicios y misma duración total) y cancelar con confirmación explícita. Para cambiar
  los servicios se cancela y se reserva de nuevo.
- Las citas anteriores a la 005 se ven igual que antes: un servicio, «Servicio» en
  singular.
- Enlace inexistente o malformado: mensaje neutro.
- Borrado de datos personales a los 12 meses (`npm run retention:purge`).

Con la 003, todo lo anterior se adapta a tres tamaños:

- **Móvil** (< 640 px): igual que en la 001.
- **Tablet** (640–1023 px): una columna de 720 px, con días y horas más holgados.
- **Ordenador** (≥ 1024 px): la reserva, la cita y la reprogramación pasan a dos
  columnas. Al reservar, servicio y días quedan a la izquierda; horas, resumen y
  formulario, a la derecha.
- Elegir día u hora no recarga la página: lo escrito se conserva sin guardarse nunca en
  el navegador. Atrás deshace la última elección y recargar la mantiene.
- En ordenador, cambiar los servicios con una hora ya elegida la conserva si la cita
  sigue cabiendo; si no, vuelve a las horas de ese día con un aviso, sin perder lo
  escrito.

### Qué puede hacer hoy la dueña (002, MVP mínimo)

Probado a mano con la dueña del producto el 2026-11-04.

- **Acceso** en `/gestion/acceso` con usuario y contraseña. La cuenta se crea fuera de
  la app con `npm run owner:provision`, que lee `OWNER_USERNAME` y
  `OWNER_INITIAL_PASSWORD` (12 caracteres como mínimo) del `.env`; esa contraseña se
  borra del `.env` después. Cinco fallos en quince minutos bloquean el acceso, y el
  mensaje de error es el mismo sea cual sea el motivo. La sesión caduca tras 12 h sin
  uso; se puede cambiar la contraseña y cerrar la sesión desde *Cuenta*.
- Ninguna pantalla ni ruta de `/gestion` o `/api/gestion` devuelve nada sin sesión.
- **Agenda** de cualquier día, con atajo a hoy: las citas en orden con todos sus
  servicios, el origen (online o a mano) con texto e icono, los periodos no
  disponibles con su motivo, y la diferencia entre «sin citas» y «cerrado». Un día
  pasado es de sólo lectura y las canceladas se ocultan salvo que se pidan.
- **Listado de reservas**: *Próximas citas* o *Últimas reservas recibidas*; filtros
  por estado, origen y fechas del día de la cita; búsqueda por una parte del nombre
  (sin mayúsculas ni acentos) o por el teléfono entero. Un teléfono a medias pide el
  número completo en vez de dar un listado vacío. 20 citas por página y quién canceló
  cada cancelada.

Con la US3 (paso 5), probada a mano con la dueña del producto el 2026-11-04:

- **Bloquear un rato** desde la agenda de un día que no ha pasado: unas horas de un día
  o varios días enteros, de 15 en 15 minutos, con un motivo opcional que sólo ve la
  dueña. Los clientes dejan de ver esas horas en la consulta siguiente, y un día entero
  bloqueado les sale *cerrado*, sin el motivo.
- Si el rato pisa citas confirmadas, la agenda las nombra (cliente, servicios y hora) y
  pregunta antes de guardar: «Bloquear igualmente, sin cancelar ninguna cita» o «No
  bloquear». Ninguna cita se cancela sola.
- **Liberar un rato** desde la propia línea temporal; las horas vuelven a ofrecerse al
  momento.
- La API también permite acortar un rato (`PATCH /api/gestion/periodos/{id}`); la
  pantalla todavía no lo ofrece.

Con las US4, US5, US6 y US11 (paso 6), todavía sin probar a mano con la dueña del producto:

- **Apuntar una cita a mano** desde cualquier tramo libre de la agenda: uno o varios
  servicios con la duración total a la vista, la hora de 15 en 15 minutos, nombre y
  teléfono obligatorios y email opcional. Se crea aunque falten menos de 2 h o quede más
  allá de los 60 días; fuera del horario avisa y pide confirmarlo. El límite de 3 citas
  futuras por teléfono o email se aplica igual que online. La cita queda «Apuntada por
  ti» y sin enlace de cliente.
- **Mover** una cita, online o a mano, a otro día u hora: conserva servicios, duración,
  datos y enlace.
- **Editar** una cita: añadir, quitar o cambiar servicios, con la nueva hora de fin a la
  vista, y corregir nombre, teléfono o email. La hora no cambia. Un servicio que ya
  tenía conserva su precio y su duración aunque el catálogo haya cambiado o se haya
  retirado; uno nuevo tiene que estar en el catálogo y entra con el precio de hoy.
- **Cancelar** cualquier cita confirmada que no haya terminado, sin plazo, tras una
  pregunta que la nombra. Es definitiva. El cliente lee en su enlace «El salón ha
  cancelado esta cita» con el teléfono del salón; si la canceló él, «Has cancelado esta
  cita».
- Tras mover, editar o cancelar una cita online, la agenda recuerda que el cliente no
  recibe ningún aviso y enseña su teléfono para llamarle.
- **Conflictos**: si la cita pisa otra o un rato bloqueado, un diálogo los nombra
  (cliente, servicios y hora; o el rato y su motivo) antes de tocar nada. Las salidas son
  cancelar la cita que estorba, eliminar el rato o recortarlo para dejar sitio, o volver
  sin cambiar nada. No existe «mantener las dos». Lo elegido y el cambio se aplican a la
  vez o no se aplica nada, y si otra pantalla cambió algo mientras tanto se vuelve a
  preguntar sobre lo que hay ahora.
- Al bloquear un rato, la API también permite cancelar en la misma operación las citas
  que pisa; la pantalla sigue ofreciendo sólo bloquear sin cancelar ninguna.

### Estado de los checks

En la rama `002-salon-management`, el 2026-11-04, con el paso 6 (US4, US5, US6 y US11) de la 002. Playwright
tiene tres proyectos, uno por tamaño (ver `playwright.config.ts`).

| Check | Resultado |
|---|---|
| `npm test` (unitarios) | 565 / 565 ✅ |
| `npm run test:integration` | 306 / 306 ✅ |
| `npm run test:contract` | 173 / 173 ✅ |
| `npm run test:e2e` | 326 / 326 ✅ |
| · proyecto `mobile-360` (la suite de la 001, la 005 y la 002) | 143 / 143 ✅ |
| · proyecto `desktop-1280` (lo mismo sin rendimiento, más `responsive.spec.ts`) | 173 / 173 ✅ |
| · proyecto `tablet-768` (accesibilidad) | 10 / 10 ✅ |
| `npm run lint` | ✅ |
| `npm run check:layers` | ✅ |

El 2026-11-02 se corrigieron tres **tests que dependían de la fecha o de la zona
horaria de la máquina**, no defectos de la app:

1. `availability-horizon.test.ts` fijaba el reloj en 2026-09-15, pero
   `db/seed/history.ts` creaba el histórico con el `now()` real de PostgreSQL. Ahora
   `seedHistory` recibe el instante de referencia.
2. `slotDaysFromNow` saltaba los domingos pero no el festivo que crea el seed (hoy + 7),
   y un lunes caía en él. Ahora salta los dos.
3. `slotDaysFromNow` fijaba la hora con la zona horaria de la máquina. En la CI, que
   corre en UTC, la cita quedaba una hora más tarde en Madrid y `us4-view` fallaba.
   Ahora calcula día y hora en `SALON_TIMEZONE`, igual que `us1-availability`.

`performance.spec.ts` (SC-004) va justo en el límite: con `TZ=UTC` midió una vez 2017 ms
frente a 2000 ms y pasó al repetirlo. Si falla de forma intermitente en la CI, es esto.
Con cuatro servicios elegidos (005) ningún paso pasa de 1 s en local, igual que con uno.
El 2026-11-04, en una ejecución completa con la máquina cargada, los dos tests SC-004
del cliente midieron 2392 ms y 2311 ms; aislados, y en la repetición completa, pasaron.

El 2026-11-04, en una ejecución completa de `npm run test:integration`, falló una vez
«loses the race rather than double-booking when two moves target one slot»
(`reschedule-appointment.test.ts`, de la 001): dos reprogramaciones del cliente a la vez
hacia la misma hora. Pasó aislado y en las dos ejecuciones completas siguientes. Es una
carrera del propio test, no un solape guardado; si se repite en la CI, es esto.

El 2026-11-03 el helper de axe pasó a esperar al `<title>` antes de analizar: justo
después de una server action que redirige, React cambia el `<head>` y por un instante
no hay título, y `us5-cancel` fallaba de forma intermitente por eso.

### Defectos menores de experiencia de uso (001)

- Tras reprogramar o cancelar no hay mensaje de éxito (FR-037).
- Justo después de cancelar aparece "Esta cita ya está cancelada, así que no hay nada
  más que cambiar…", que se lee como un error.
- El encabezado "Tu cita" aparece tres veces en la pantalla de la cita.
- Una cita cancelada sigue mostrando "Puedes cancelar hasta 24 horas antes".
- El resumen de errores del formulario es redundante ("Revisa estos datos… Revisa los
  datos marcados").

### Restricciones a tener en cuenta

- v1 no envía SMS ni email. La 004 cambiará esa decisión y activará el Principio IV
  de la constitución.
