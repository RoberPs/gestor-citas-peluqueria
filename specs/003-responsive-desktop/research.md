# Research: Versión responsive para tablet y ordenador

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Fecha**: 2026-11-02

No quedaba ningún `NEEDS CLARIFICATION` en el contexto técnico: el stack es el de la
001. Las decisiones de abajo resuelven cómo cumplir la spec sin tocar el dominio ni
cambiar el móvil.

## D-001 — La disposición se decide sólo con CSS

**Decision**: los tres tamaños se resuelven con media queries `min-width` en CSS
(mobile-first). Ningún componente sabe en qué tamaño está; no hay detección del ancho
en JavaScript ni en el servidor.

**Rationale**:

- El HTML del servidor es el mismo para todos los tamaños: no hay desajustes de
  hidratación ni parpadeos al cargar.
- Cambiar el tamaño de la ventana o girar la tablet no desmonta nada, así que servicio,
  día, hora y datos escritos se conservan sin código adicional (FR-014).
- Funciona sin JavaScript, como toda la 001.

**Alternatives considered**:

- Hook `useMediaQuery` que renderiza un árbol distinto por tamaño: rechazado porque el
  servidor no conoce el ancho, provoca un primer render incorrecto y desmonta el
  formulario al cruzar un límite.
- Client Hints (`Sec-CH-Viewport-Width`): no llegan en la primera petición ni en todos
  los navegadores.

## D-002 — Reserva en dos columnas sin cambiar las rutas

**Decision**: se mantienen las dos rutas de la 001. Ambas pintan la misma estructura de
dos columnas:

| Ruta | Columna izquierda | Columna derecha |
|---|---|---|
| `/?serviceId&rangeStart&selectedDate` | Servicio y rango de días | Horas del día e indicación de FR-010 |
| `/reservar?serviceId&rangeStart&selectedDate&startsAt` | Servicio y rango, con el día de `startsAt` marcado | Horas con la elegida marcada, resumen y formulario |

En `/reservar`, el contexto (servicio, rango y horas) se marca como *sólo en ordenador*
y queda oculto con `display: none` por debajo de 1024 px. En móvil y tablet `/reservar`
se ve exactamente como hoy.

**Rationale**:

- La URL y el flujo del móvil no cambian (FR-002), y los tests de la 001 que comprueban
  `/reservar` siguen valiendo (SC-004).
- Cada elección es una navegación con su propia URL, así que Atrás deshace la última y
  recargar o compartir la dirección conserva servicio, día y hora (FR-010a).
- `display: none` saca el contenido oculto del árbol de accesibilidad y del orden de
  tabulación: en móvil, un lector de pantalla no oye nada que no se vea.

**Alternatives considered**:

- Unificar todo en `/` con un parámetro `startsAt`: cambia la URL del móvil y obliga a
  reescribir tests de la 001.
- Una máquina de estados en el cliente sin navegación: rompe el funcionamiento sin
  JavaScript y el historial del navegador.

**Coste**: `/reservar` pasa a pedir también la disponibilidad del rango. Es **una sola
consulta** (D-003 de la 001), que se lanza en paralelo con el catálogo y la
configuración. Ver D-008.

## D-003 — Navegación suave con `next/form`

**Decision**: los formularios GET de servicio, días, rango y horas pasan de
`<form method="get">` a `<Form>` de `next/form` (Next 15).

**Rationale**:

- Con JavaScript, la navegación se hace en el cliente y los layouts siguen montados. Eso
  permite conservar los datos escritos al cambiar de día u hora (FR-009, D-004). Al
  cambiar de día dentro de `/`, la página es la misma y la región `aria-live` de las
  horas no se recrea, así que anuncia el cambio (FR-016). Al pasar de `/` a `/reservar`
  la página sí cambia: ese paso lo anuncia el título (D-007).
- Sin JavaScript, `<Form>` se comporta como un formulario GET normal: la mejora es
  progresiva y nada deja de funcionar.

**Riesgo a verificar primero**: los botones de hora y de servicio envían su valor con
`name`/`value` en el propio botón. La primera tarea de la historia 1 es un test que
falla si `<Form>` no incluye ese valor en la URL. Plan B: sustituir esos botones por
enlaces (`<Link>`) con la URL completa, que se comportan igual con y sin JavaScript.

**Resultado (T009, Next 15.5)**: el riesgo se confirmó. `next/form` construye la URL
con `new FormData(form)`, sin el botón pulsado, así que se pierden `selectedDate`,
`startsAt`, `serviceId` y `rangeStart`. Tampoco se adopta el plan B: convertir los
botones en enlaces cambia su rol, y los tests de la 001 los buscan como `button`, lo que
obligaría a reescribirlos (SC-004). En su lugar, `src/components/nav-form.tsx`
(`NavForm`) hace lo mismo que `next/form` (`router.push` con la URL del formulario),
pero con `new FormData(form, submitter)`. Sin JavaScript es un `<form method="get">`
normal.

**Estado de carga**: al no recargar, la pantalla que se deja sigue a la vista mientras
llega la nueva, y se podía elegir una hora del día anterior. Mientras hay una navegación
en curso, `NavForm` ignora cualquier otra elección hecha sobre esa pantalla y marca
`html[data-navigating]`, con el que la hoja de estilos atenúa servicios, días y horas
(Principio VI). Los tests e2e de la 001 esperan cada navegación con `clickAndNavigate`.

## D-004 — Datos escritos sólo en memoria

**Decision**: un proveedor de cliente, `BookingDraftProvider`, guarda nombre, teléfono y
email en estado de React mientras el cliente está en `/` o `/reservar`. Vive en el layout
de un grupo de rutas `src/app/(booking)/`, que no cambia ninguna URL.
`BookingForm` toma de ahí sus valores iniciales y los actualiza al escribir. Tras un
envío fallido mandan los valores devueltos por el servidor, como hoy.

**Rationale**:

- El layout del grupo sigue montado al navegar entre `/` y `/reservar` (D-003): lo escrito
  sobrevive al cambio de día o de hora (FR-009).
- Al confirmar, la navegación a `/cita/…` sale del grupo, el layout se desmonta y el
  borrador desaparece. Una recarga también lo borra (aclaración Q2).
- Nada se escribe en `localStorage`, `sessionStorage`, cookies ni en la URL
  (Principio III, FR-009).

**Alternatives considered**:

- `sessionStorage`: deja datos personales en el dispositivo; lo prohíbe la aclaración Q2.
- Pasar los datos en la URL: acabarían en el historial y en los logs del servidor.
- Proveedor en el layout raíz: obligaría a vaciarlo a mano tras reservar.

## D-005 — Anchos y columnas

**Decision**:

| Tamaño | Contenedor | Columnas |
|---|---|---|
| Móvil (< 640 px) | máx. 480 px (sin cambios) | 1 |
| Tablet (640–1023 px) | máx. 720 px | 1 |
| Ordenador (≥ 1024 px) | máx. 1120 px | 2: `minmax(0, 26rem)` y `minmax(0, 1fr)`, separación de 2 rem |

En ordenador, las pantallas sin dos columnas (mensaje neutro) usan el ancho de tablet.
El texto corrido se limita a `70ch` (FR-004).

**Rationale**: a 1280 px el contenido útil es de 1120 px (SC-002 pide al menos 900). La
columna izquierda de 26 rem (416 px) cabe la rejilla de 7 días con áreas de 44 px y la
lista de servicios. La derecha, con unos 670 px, deja las horas en varias filas y el
formulario en un ancho de lectura cómodo.

## D-006 — Los anchos se definen una sola vez

**Decision**: todo el responsive vive en un bloque *Layout* de `src/app/globals.css`, con
unas pocas clases reutilizables:

- `main` (el elemento, sin clase): el contenedor centrado con el ancho de cada tamaño.
- `.site-header--split`: la cabecera de una pantalla de dos columnas, con su mismo ancho.
- `.page--split`: el contenedor de dos columnas en ordenador.
- `.col-main` y `.col-side`: las dos columnas.
- `.wide-only`: contenido que sólo se ve en ordenador.

Un test unitario lee la hoja de estilos y falla si aparece cualquier `@media` con un
ancho distinto de 640 o 1024 px, o una propiedad `order` (FR-006, FR-015).

**Rationale**: las media queries no admiten variables CSS, así que la garantía de
"una sola vez" la da el test. Las pantallas de la 002 usarán las mismas clases.

## D-007 — Orden de lectura y anuncios

**Decision**:

- El orden del DOM es el orden visual en todos los tamaños: primero la columna
  izquierda y después la derecha. No se usa `order` ni colocación explícita en la
  rejilla que reordene (FR-015).
- No se mueve el foco al elegir día u hora (FR-016). El cambio de horas lo anuncia la
  región `aria-live` existente de la lista de horas. El paso a `/reservar` lo anuncia el
  anunciador de rutas de Next, que lee el título del documento; por eso `/reservar`
  tiene un título propio.
- Al cambiar de hora **dentro** de `/reservar` el título no cambia. Lo anuncia la
  sección de resumen, que es una región `aria-live="polite"` sin `aria-atomic`: sólo se
  leen la fecha y la hora que cambian. Para no anunciarlo dos veces, la lista de horas
  de `/reservar` se pinta sin `aria-live` (`SlotList live={false}`).
- Al reprogramar con una hora elegida pasa lo mismo: la lista de horas deja de ser
  región `aria-live` y el panel de confirmación se pinta dentro de una región
  `aria-live` que está siempre en la página. Así se anuncia al aparecer y al cambiar de
  hora, una sola vez.
- Si al confirmar la hora ya está ocupada, la action llama a `revalidatePath('/reservar')`:
  las dos columnas se recalculan en la misma respuesta y nunca queda a la vista una hora
  que ya no se puede reservar (Principio VI). Lo escrito se conserva porque es estado de
  cliente.

## D-008 — Rendimiento

**Decision**: en `/reservar`, las tres lecturas (catálogo, disponibilidad y
configuración) se lanzan en paralelo. El test de rendimiento de la 001 sigue
ejecutándose a 360 px y es la referencia de SC-006.

**Rationale**: la medición de SC-004 de la 001 ya roza los 2000 ms (README). Añadir una
consulta en serie podría pasarla; en paralelo, el tiempo lo marca la lectura más lenta,
que ya era la de disponibilidad en `/`.

### Medición base (T003, antes de tocar nada)

`performance.spec.ts` en `mobile-360`, tres ejecuciones seguidas en la misma máquina,
con la red de 4G emulada del test:

| Acción | 1 | 2 | 3 |
|---|---|---|---|
| Abrir la reserva | 789 ms | 1121 ms | 769 ms |
| Elegir servicio | 839 ms | 919 ms | 710 ms |
| Elegir día | 601 ms | 584 ms | 431 ms |
| Elegir hora | 578 ms | 515 ms | 559 ms |
| Confirmar | 692 ms | 493 ms | 604 ms |
| Abrir la cita | 652 ms | 749 ms | 921 ms |
| Abrir reprogramar | 506 ms | 513 ms | 829 ms |
| JS de la reserva | 102,7 KiB | 102,7 KiB | 102,7 KiB |
| JS del formulario | 6,1 KiB | 6,1 KiB | 6,1 KiB |

### Medición tras US1 (T020)

Misma prueba y misma máquina. Elegir servicio y día ya es navegación dentro de la app
(`NavForm`), y el test espera a que cambie la URL antes de dar el paso por terminado.

| Acción | 1 | 2 | 3 |
|---|---|---|---|
| Abrir la reserva | 1175 ms | 1123 ms | 1209 ms |
| Elegir servicio | 633 ms | 605 ms | 560 ms |
| Elegir día | 272 ms | 420 ms | 295 ms |
| Elegir hora | 438 ms | 512 ms | 526 ms |
| Confirmar | 556 ms | 580 ms | 497 ms |
| Abrir la cita | 974 ms | 765 ms | 924 ms |
| Abrir reprogramar | 574 ms | 464 ms | 611 ms |
| JS de la reserva | 104,8 KiB | 104,8 KiB | 104,8 KiB |
| JS del formulario | 6,5 KiB | 6,5 KiB | 6,5 KiB |

Ninguna acción se acerca a los 2000 ms (SC-006). Abrir la reserva sube unos 250 ms de
media, por el HTML de las dos columnas y el JavaScript de `NavForm` y del borrador
(+2,1 KiB). Elegir día y servicio bajan, porque ya no recargan la página.

## D-009 — Tests

**Decision**:

- **Proyectos de Playwright**:
  - `mobile-360`: la suite completa, como hoy.
  - `desktop-1280` (1280 × 800): toda la suite salvo `performance.spec.ts` y los tests
    etiquetados `@mobile-only`, más el nuevo `responsive.spec.ts`.
  - `tablet-768`: `accessibility.spec.ts` y los escenarios de tablet de
    `responsive.spec.ts`.
- **`responsive.spec.ts`** comprueba:
  - las columnas, mirando la posición de cada sección;
  - que los datos escritos se conservan al cambiar de hora y de día;
  - Atrás y recarga;
  - la pantalla de confirmación sin desplazarse a 1280 × 800;
  - que no hay desplazamiento horizontal a 320, 360, 640, 768, 1024, 1280 y 1920 px;
  - el zoom del 400 %, emulado con una ventana de 320 × 200 px, que es lo que ve un
    navegador de 1280 × 800 al 400 %.
- Si algún test de la 001 choca a 1280 px porque un texto aparece dos veces (por ejemplo,
  el nombre del servicio en la columna izquierda y en el resumen), se acota el localizador
  a su sección. No se cambia lo que se comprueba.

**Rationale**: así se cumple la aclaración Q4 sin duplicar tests. El tiempo de e2e en la
CI pasa de 1,3 a unos 3 minutos.
