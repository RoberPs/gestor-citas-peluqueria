---

description: "Lista de tareas de la versión responsive para tablet y ordenador"
---

# Tasks: Versión responsive para tablet y ordenador

**Input**: Design documents from `/specs/003-responsive-desktop/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/ui-layout.md](./contracts/ui-layout.md), [quickstart.md](./quickstart.md)

**Tests**: obligatorios. El proyecto exige TDD (CLAUDE.md, Principio II): en cada
historia, los tests se escriben primero y deben fallar antes de implementar.

**Organization**: tareas agrupadas por historia de usuario, cada una entregable y
comprobable por separado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: se puede hacer en paralelo (archivos distintos, sin dependencias pendientes).
- **[Story]**: historia a la que pertenece (US1, US2, US3).

## Path Conventions

Proyecto único: `src/` y `tests/` en la raíz. Rutas según [plan.md](./plan.md).

## Reglas comunes a todas las tareas

- **El móvil no cambia** (FR-002): toda regla CSS nueva va dentro de
  `@media (min-width: 640px)` o `@media (min-width: 1024px)`. Fuera de ellas sólo se
  añaden clases nuevas que no alteran nada por debajo de 640 px, salvo `.wide-only`.
- **El orden del DOM es el orden visual** (FR-015): no se usa `order` ni colocación en
  rejilla que reordene.
- **Textos** en `src/messages/es-ES.ts`. Código, identificadores y comentarios en inglés.
- **Datos personales** nunca en `localStorage`, `sessionStorage`, cookies ni URL (FR-009).
- **Commits**: un commit `test:` con los tests en rojo y después el commit `feat:` o
  `refactor:` que los pone en verde (Conventional Commits).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: ejecutar la suite en los tres tamaños y fijar la referencia antes de tocar nada.

- [X] T001 Añadir dos proyectos a `playwright.config.ts` junto al actual `mobile-360`.
  - `desktop-1280`: `devices['Desktop Chrome']`, viewport 1280 × 800, `isMobile: false`,
    `hasTouch: false`, `testIgnore: /performance\.spec\.ts/` y `grepInvert: /@mobile-only/`.
  - `tablet-768`: viewport 768 × 1024, `hasTouch: true`, `testMatch: /accessibility\.spec\.ts/`.
  - Añadir a `mobile-360` `testIgnore: /responsive\.spec\.ts/`, porque ese archivo fija su
    propio viewport y se ejecuta sólo en `desktop-1280`.
  - Actualizar el comentario de cabecera para explicar los tres proyectos (D-009).
- [X] T002 Ejecutar `npm run test:e2e -- --project=desktop-1280` y `-- --project=tablet-768`
  sobre el código actual y tratar cada fallo así:
  - Localizador ambiguo (un texto que aparece dos veces): acotarlo a su sección con
    `page.getByRole('region', …)` o `locator('section', { has: … })`, sin cambiar lo
    que se comprueba.
  - Comprobación que sólo tiene sentido a 360 px: añadir `@mobile-only` al título del test.
  - Cualquier otro fallo es un defecto: anotarlo y no seguir sin resolverlo.

  Archivos: `tests/e2e/*.spec.ts`. Al terminar, los tres proyectos en verde.
- [X] T003 Medir la referencia de rendimiento: ejecutar tres veces
  `npm run test:e2e -- --project=mobile-360 performance.spec.ts` y anotar los tiempos
  de cada acción en un apartado "Medición base" al final de D-008 en
  `specs/003-responsive-desktop/research.md`.

**Checkpoint**: la suite de la 001 pasa en los tres proyectos y hay una referencia de tiempos.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: la base de disposición compartida y el grupo de rutas. Bloquea todas las historias.

- [X] T004 [P] Crear `tests/unit/ui/layout-breakpoints.test.ts` (Vitest, entorno Node).
  Lee `src/app/globals.css` y comprueba:
  - toda `@media` es exactamente `(min-width: 640px)` o `(min-width: 1024px)`;
  - no aparece la propiedad `order:`;
  - existen los selectores `.page--split`, `.site-header--split`, `.col-main`,
    `.col-side` y `.wide-only`.

  Debe fallar (todavía no existen las clases).
- [X] T005 [P] Crear `tests/e2e/responsive.spec.ts` con un `describe('sin desplazamiento horizontal')`.
  - Para cada ancho de 320, 360, 640, 768, 1024, 1280 y 1920 px (`page.setViewportSize`,
    alto 800) visita `/`, `/reservar` con un hueco válido, `/cita/{token}`,
    `/cita/{token}/reprogramar` y `/cita/{'a'.repeat(43)}`. Reutiliza los helpers de
    `tests/e2e/helpers/` para sembrar la cita y obtener un hueco.
  - Comprueba que `scrollWidth - clientWidth` es 0, como `tests/e2e/helpers/axe.ts`.
  - Añade un caso a 320 × 200, que emula 1280 × 800 al 400 % (FR-005, SC-003).

  Puede pasar ya: es la guarda de regresión de toda la feature.
- [X] T006 Añadir el bloque `/* Layout */` en `src/app/globals.css`, siguiendo
  [contracts/ui-layout.md](./contracts/ui-layout.md):
  - `@media (min-width: 640px)`: `main` y `.site-header` pasan de `max-width: 480px` a
    `720px`.
  - `@media (min-width: 1024px)`:
    - `.site-header--split` pasa a `max-width: 1120px`, el mismo ancho que su `main`. La
      cabecera va antes que `main` en el DOM, así que lleva su propia clase.
    - `main.page--split` pasa a `max-width: 1120px` y es una rejilla
      `grid-template-columns: minmax(0, 26rem) minmax(0, 1fr)` con `column-gap: 2rem` y
      `align-items: start`.
    - Los hijos directos que no sean `.col-main` ni `.col-side` (el `h1` y los avisos
      globales) ocupan `grid-column: 1 / -1`.
    - Los párrafos de las columnas se limitan a `max-width: 70ch`.
  - `.wide-only { display: none }` por defecto y `display: revert` a partir de 1024 px.

  T004 pasa a verde y la suite de la 001 a 360 px sigue en verde.
- [X] T007 Mover las pantallas de reserva al grupo de rutas `(booking)` sin cambiar
  ninguna URL:
  - `git mv src/app/page.tsx "src/app/(booking)/page.tsx"`
  - `git mv src/app/reservar "src/app/(booking)/reservar"`
  - Actualizar todos los imports de `@/app/reservar/…`, que se buscan con
    `grep -rn "app/reservar" src tests`, a `@/app/(booking)/reservar/…`. Uno de ellos
    está en `src/components/booking-form.tsx`.
  - Crear `src/app/(booking)/layout.tsx`, que de momento sólo devuelve `children`.
  - `npm run lint`, `npm run check:layers` y `npm run test:e2e -- --project=mobile-360`
    en verde. Commit `refactor:`.

**Checkpoint**: base de disposición lista y vigilada; la 001 sigue en verde a 360 px.

---

## Phase 3: User Story 1 - Reservar desde el ordenador en dos columnas (Priority: P1) 🎯 MVP

**Goal**: a 1280 px, servicio y días a la izquierda; horas, resumen y formulario a la
derecha, sin perder lo escrito.

**Independent Test**: a 1280 px, reservar de principio a fin con servicio y día siempre
visibles a la izquierda (SC-001, SC-002).

### Tests for User Story 1 ⚠️

> Escribir estos tests primero y comprobar que fallan antes de implementar.

- [X] T008 [US1] En `tests/e2e/responsive.spec.ts`, añadir `describe('US1 — reserva en ordenador')`
  con `test.use({ viewport: { width: 1280, height: 800 } })` y un test por escenario
  de la historia 1 de [spec.md](./spec.md):
  1. En `/`: la sección de servicio y la de días tienen su `boundingBox().x` a la
     izquierda de la sección de horas, y las tres empiezan en la mitad superior de la
     ventana. La indicación de FR-010 está visible. El ancho de `main` es de al menos
     900 px (SC-002).
  2. Al elegir otro día, la URL lleva `selectedDate` y la sección de horas muestra ese día.
  3. Al elegir una hora, la URL es `/reservar?…startsAt=…`. La hora elegida tiene
     `aria-pressed="true"` y el texto "Elegida". Resumen y formulario están a la
     derecha, y servicio y días siguen visibles a la izquierda con el día marcado.
  4. Escribir nombre, teléfono y email; elegir otra hora: los tres valores siguen en sus
     casillas. Elegir otro día, después una hora: siguen igual.
  5. Teléfono inválido y Confirmar: el error está junto al campo en la columna derecha y
     se conservan los valores.
  6. Elegir un día lleno o cerrado: la columna derecha ofrece el salto al siguiente día
     con huecos.
  7. Con hora elegida, `page.goBack()` vuelve a `/` sin `startsAt`. Elegir hora otra vez
     y `page.reload()`: se conservan servicio, día y hora, y las casillas quedan vacías
     (aclaración Q2).
- [X] T009 [US1] En el mismo `describe`, un test de navegación suave (D-003):
  - antes de elegir una hora, ejecutar `page.evaluate(() => { window.__softNav = true; })`;
  - después, comprobar que `window.__softNav` sigue siendo `true` y que la URL contiene
    `startsAt`.

  Sirve para verificar que `next/form` envía el `name`/`value` del botón pulsado.
- [X] T010 [US1] En el mismo `describe`, un test de privacidad (FR-009):
  - escribir nombre, teléfono y email reconocibles y cambiar de hora;
  - comprobar que `localStorage`, `sessionStorage`, `document.cookie` y `page.url()`
    no contienen ninguno de los tres valores.
- [X] T011 [US1] En `tests/e2e/responsive.spec.ts`, añadir `describe('US1 — el móvil no cambia')`
  a 360 × 740: en `/reservar`, la sección de días y la de horas no son visibles
  (`toBeHidden`) y el resumen y el formulario sí (FR-002).
- [X] T011a [US1] En `describe('US1 — reserva en ordenador')`, un test de anuncios (FR-016, D-007):
  - en `/`, enfocar con teclado una celda de día con huecos y pulsar Enter: tras la
    navegación, `document.activeElement` sigue siendo el botón de ese día (el foco no se
    mueve) y la región `aria-live` de horas muestra la fecha del día elegido;
  - elegir una hora con Enter: `document.title` es `messages.booking.pageTitle`;
  - en `/reservar`, elegir otra hora con Enter: el foco sigue en esa hora, la sección de
    resumen tiene `aria-live="polite"` y su hora ha cambiado, y la lista de horas de la
    columna derecha no es una región `aria-live` (para no anunciar dos veces).
- [X] T011b [US1] En `describe('US1 — reserva en ordenador')`, un test de hueco ocupado
  (caso límite de la spec, Principio VI): igual que el escenario 5 de
  `tests/e2e/us2-booking.spec.ts`, otro contexto reserva la hora elegida mientras el
  cliente escribe; al confirmar, aparece `messages.errors.slotTaken`, los datos escritos
  se conservan y **ningún** botón de hora de la página tiene `value` igual al `startsAt`
  ocupado.
- [X] T011c [US1] En `describe('US1 — reserva en ordenador')`, un test de parámetros
  inválidos (Principio V): `/reservar?serviceId=…&startsAt=<hueco válido>&rangeStart=xx&selectedDate=2999-01-01`
  responde 200, muestra el resumen y el formulario, y la columna izquierda muestra el
  rango que contiene el día de `startsAt`, sin página de error.

### Implementation for User Story 1

- [X] T012 [P] [US1] Añadir en `src/messages/es-ES.ts`:
  - `availability.chooseHourHint`: "Elige una hora y aquí verás el resumen de tu cita y
    el formulario para tus datos."
  - `availability.selectedSlot`: "Elegida".
  - `booking.pageTitle`: "Tus datos · Reserva tu cita".

  Si `tests/unit/messages/` exige algo de los textos nuevos, cumplirlo.
- [X] T013 [P] [US1] En `src/components/slot-list.tsx`:
  - Cambiar los dos `<form method="get">` por `<NavForm>` (ver D-003: `next/form` pierde el botón pulsado), con los mismos
    `action` y campos.
  - Añadir la prop opcional `selectedStartsAt?: string`. La hora que coincide lleva
    `aria-pressed="true"`, la clase `is-selected` y una insignia `slot-badge` con
    `<span aria-hidden="true">✓ </span>` y `messages.availability.selectedSlot`. Su
    texto oculto añade ". Elegida".
  - Añadir los hidden inputs `rangeStart` y `selectedDate` (de `availability.range.start`
    y `availability.selectedDate`), para que `/reservar` sepa qué rango pintar.
  - Añadir la prop opcional `live?: boolean` (por defecto `true`). Con `false`, el
    contenedor de horas no lleva `aria-live` ni `aria-atomic` (D-007).
  - Añadir en `globals.css` el estilo `.slot.is-selected`, con borde y fondo de acento,
    válido en todos los tamaños.
- [X] T014 [P] [US1] En `src/components/day-range-picker.tsx` y `src/components/service-picker.tsx`,
  cambiar cada `<form method="get">` por `<NavForm>` (D-003), conservando `action`,
  `className` y campos.
- [X] T015 [US1] Crear `src/components/booking-draft.tsx` (`'use client'`):
  - `BookingDraftProvider`, que guarda `{ name, phone, email }` con `useState`, empezando
    vacío.
  - `useBookingDraft()`, que devuelve `{ draft, update(field, value) }`.
  - Un comentario que explique por qué sólo en memoria (D-004, Principio III).
  - Montarlo en `src/app/(booking)/layout.tsx` envolviendo `children`.
- [X] T016 [US1] En `src/components/booking-form.tsx`, usar `useBookingDraft()`:
  - El `defaultValue` de cada `Field` es `state.values.<campo>` si no está vacío y, si
    lo está, `draft.<campo>`.
  - Cada `input` llama a `update(campo, valor)` en `onChange`.
  - Añadir `onChange` a las props de `Field`.
- [X] T017 [US1] En `src/app/(booking)/page.tsx`, dar a `main` la clase `page--split` y a
  la cabecera `site-header site-header--split`, y repartir el contenido de `main`:
  - `h1` y aviso de rango fuera de límites como hijos directos;
  - `<div className="col-main">` con `ServicePicker` y `DayRangePicker`;
  - `<div className="col-side">` con `SlotList` y debajo
    `<p className="muted wide-only">{messages.availability.chooseHourHint}</p>`.
- [X] T018 [US1] Reescribir `src/app/(booking)/reservar/page.tsx`:
  - Leer `rangeStart` y `selectedDate` además de `serviceId` y `startsAt`.
  - El día de `startsAt` se calcula **siempre** con `localDateOf(start, salon.timezone)`
    de `@/domain/shared/time` (zona del salón, `SALON_TIMEZONE`, nunca la del servidor ni
    la del dispositivo). Como la zona viene del catálogo, se toma de `config.load()`.
  - Lanzar en paralelo con `Promise.all` `listServices()`, `config.load()` y
    `getAvailability({ serviceId, rangeStart, selectedDate: selectedDate ?? <día de startsAt> })`.
    `rangeStart` y `selectedDate` pasan tal cual: el caso de uso ya rechaza los mal
    formados y los fuera de límites. Si la disponibilidad falla por cualquiera de los dos
    motivos, reintentar con `getAvailability({ serviceId, selectedDate: <día de startsAt> })`,
    igual que `/` (D-008). Nunca página de error por estos dos parámetros (T011c).
  - La sección de resumen lleva `aria-live="polite"` y la `SlotList` de esta página se
    pinta con `live={false}` (prop nueva de T013), para que el cambio de hora se anuncie
    una sola vez (D-007, T011a).
  - `main.page--split`:
    - hijos directos: `h1` (`messages.booking.title`);
    - `<div className="col-main wide-only">`: `ServicePicker` y `DayRangePicker`;
    - `<div className="col-side">`: `<div className="wide-only">` con `SlotList`
      (`selectedStartsAt={start.toString()}`), y debajo las secciones actuales de
      resumen, formulario y Volver, sin cambios.
  - Añadir `generateMetadata` con `title: messages.booking.pageTitle` (D-007).
  - Mantener el caso "sin hueco" tal como está.
- [X] T018a [US1] En `src/app/(booking)/reservar/actions.ts`, cuando la reserva se rechaza
  por `SLOT_TAKEN`, `TOO_LATE_TO_BOOK` u `OUTSIDE_OPENING_HOURS`, llamar a
  `revalidatePath('/reservar')` antes de devolver el estado. La respuesta de la action
  trae entonces la página recalculada: las horas y los días de las dos columnas reflejan
  la disponibilidad real, y el formulario y el borrador, que son estado de cliente, se
  conservan (T011b, Principio VI).
- [X] T019 [US1] Ejecutar T008–T011c hasta verde. Después
  `npm run test:e2e -- --project=mobile-360` y `--project=desktop-1280` completos en verde.
- [X] T020 [US1] Repetir la medición de T003 con
  `npm run test:e2e -- --project=mobile-360 performance.spec.ts` tres veces y anotarla en
  D-008 de `research.md`. Si alguna acción supera los 2000 ms de forma reproducible,
  parar e informar antes de seguir (SC-006).

**Checkpoint**: la historia 1 funciona y se puede entregar sola.

---

## Phase 4: User Story 2 - Consultar, cancelar y reprogramar la cita desde el ordenador (Priority: P2)

**Goal**: cita y confirmación en dos columnas; reprogramación con días a la izquierda y
horas y confirmación a la derecha.

**Independent Test**: a 1280 px, abrir una cita recién reservada y otra existente,
cancelar una y reprogramar otra.

### Tests for User Story 2 ⚠️

- [X] T021 [US2] En `tests/e2e/responsive.spec.ts`, añadir `describe('US2 — la cita en ordenador')`
  a 1280 × 800, con un test por escenario de la historia 2:
  1. Reservar con el helper de `tests/e2e/helpers/booking.ts` hasta `/cita/{token}?nueva=1`:
     los datos de la cita, el enlace de gestión y el aviso de guardarlo tienen
     `boundingBox()` con `y + height <= 800` (SC-007).
  2. En `/cita/{token}`, la tarjeta de la cita está a la izquierda (`x` menor) de la
     sección de acciones, y los datos del salón están en la columna derecha.
  3. En `/cita/{token}/reprogramar`, la sección de días está a la izquierda de la de
     horas. Al elegir una hora: el panel de confirmación del cambio está a la derecha,
     los días siguen visibles y la hora elegida tiene `aria-pressed="true"`.
  4. Abrir el diálogo de cancelar y manejarlo sólo con teclado (Tab, Enter, Escape),
     con la confirmación explícita igual que en móvil.
  5. `/cita/{'a'.repeat(43)}`: el ancho de `main` está entre 640 y 720 px.
- [X] T022 [US2] En `describe('US2 — el móvil no cambia')`, a 360 × 740: en
  `/cita/{token}/reprogramar` con hora elegida, la sección de días y la de horas no son
  visibles y el panel de confirmación sí.

### Implementation for User Story 2

- [X] T023 [US2] En `src/app/cita/[token]/page.tsx`, dar a `main` la clase `page--split`:
  - `h1` como hijo directo;
  - `<div className="col-main">` con la sección `card` de la cita y, si existe, la
    sección `save-link-heading`;
  - `<div className="col-side">` con la sección de acciones (incluido el motivo cuando
    no las hay) y la de datos del salón.

  No cambiar el contenido de ninguna sección.
- [X] T024 [US2] En `src/app/cita/[token]/reprogramar/page.tsx`, dar a `main` la clase
  `page--split`:
  - hijos directos: `h1` y el aviso de mismo servicio;
  - `<div className="col-main">` con la tarjeta de hora actual, los avisos `sinCambios`
    y `ocupada`, y `DayRangePicker`;
  - `<div className="col-side">` con `SlotList`, `ConfirmPanel` y Volver.

  `DayRangePicker` y `SlotList` se pintan siempre. Cuando hay hora elegida (`chosen`),
  van envueltos en `<div className="wide-only">` y `SlotList` recibe
  `selectedStartsAt={chosen}`. En móvil se ve igual que hoy.
- [X] T025 [US2] Si T021.1 falla por altura, compactar en `globals.css`, sólo dentro de
  `@media (min-width: 1024px)`, los márgenes de la columna izquierda de la cita hasta que
  pase, sin bajar de las áreas táctiles de 44 px. Ejecutar T021–T022 y la suite de
  `desktop-1280` hasta verde.

**Checkpoint**: las historias 1 y 2 funcionan juntas y por separado.

---

## Phase 5: User Story 3 - Usar la app cómodamente en una tablet (Priority: P3)

**Goal**: una columna de 720 px con días y horas holgados.

**Independent Test**: a 768 px, recorrer reserva y cita en una columna más ancha que en móvil.

### Tests for User Story 3 ⚠️

- [X] T026 [US3] En `tests/e2e/responsive.spec.ts`, añadir `describe('US3 — tablet')` a 768 × 1024:
  1. En `/`, el ancho de `main` está entre 640 y 720 px y las secciones de servicio, días
     y horas están una debajo de otra, con `x` igual.
  2. Cada celda del rango mide al menos 44 px de ancho y **56 px de alto** y muestra su
     estado con texto; cada botón de hora mide al menos **96 px de ancho**. Es lo que
     pide T027, así que debe fallar antes de T027 (Principio II). Si ya pasa sobre el
     código actual, T027 sobra y se elimina en lugar de implementarse.
  3. Límites: a 639 px, `main` mide como mucho 480 px; a 640 px, más de 480; a 1023 px,
     `/reservar` oculta los días; a 1024 px, los muestra.

### Implementation for User Story 3

- [ ] T027 [US3] En `src/app/globals.css`, dentro de `@media (min-width: 640px)`:
  - más separación en `.day-grid` y `.slot-list`;
  - `.slot-list` con `minmax(96px, 1fr)`;
  - celdas del rango con altura mínima de 56 px.

  Ejecutar T026 y `--project=tablet-768` hasta verde.

**Checkpoint**: las tres historias funcionan.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T028 [P] En `tests/e2e/accessibility.spec.ts`, añadir el caso "`/reservar` con hora
  elegida" si no existe, para que axe revise también a 768 y 1280 px la columna derecha
  completa (SC-005).
- [ ] T029 [P] En `tests/e2e/responsive.spec.ts`, añadir a 1280 px:
  - un test de orden de foco: pulsando Tab desde el inicio, el primer botón de servicio
    recibe el foco antes que la primera celda del rango, y esta antes que la primera hora
    (FR-015);
  - un test de cambio de tamaño: con datos escritos en `/reservar`, `setViewportSize`
    a 700 × 800 y de vuelta a 1280 × 800, y los valores, la URL y la hora elegida se
    conservan (FR-014).
- [ ] T030 Actualizar la documentación:
  - `README.md`: tabla de features con la 003 implementada; eliminar de "Restricciones"
    la nota de la columna estrecha; añadir los proyectos de Playwright a "Estado de los
    checks".
  - `docs/roadmap.md`: marcar el paso 1.
  - `CLAUDE.md`, en "Convenciones": una línea que diga que los anchos responsive (640 y
    1024 px) y las clases `.page--split`, `.col-main`, `.col-side` y `.wide-only` viven
    en `src/app/globals.css` y son las que usan las pantallas nuevas.
- [ ] T031 Ejecutar la validación manual de [quickstart.md](./quickstart.md) (pasos 1–11)
  y después `npm run test:all`, `npm run lint` y `npm run check:layers` en verde.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sin dependencias.
- **Foundational (Fase 2)**: depende de la 1 y bloquea todas las historias.
- **US1 (Fase 3)**: depende de la 2.
- **US2 (Fase 4)**: depende de la 2. Usa `selectedStartsAt` de T013 y `NavForm` de T014,
  así que va después de T013 y T014.
- **US3 (Fase 5)**: depende de la 2. Sus comprobaciones de límites sobre `/reservar`
  (T026.3) necesitan T018.
- **Polish (Fase 6)**: depende de las historias que se entreguen.

### Within Each User Story

- Tests primero y en rojo (commit `test:`), después la implementación (commit `feat:`).
- Mensajes y componentes antes que las páginas que los usan.

### Parallel Opportunities

- T004 y T005: archivos distintos.
- T012, T013 y T014: mensajes y componentes distintos.
- T028 y T029.

## Parallel Example: User Story 1

```text
# Tras escribir T008–T011 en rojo:
Task: "T012 Añadir textos en src/messages/es-ES.ts"
Task: "T013 NavForm y hora elegida en src/components/slot-list.tsx"
Task: "T014 NavForm en day-range-picker.tsx y service-picker.tsx"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Fases 1 y 2.
2. Fase 3 (US1). **Parar y validar**: reservar a 1280 px y a 360 px; revisar la medición de T020.
3. Ya se puede entregar: el flujo principal funciona en ordenador.

### Incremental Delivery

1. Setup + Foundational → base lista.
2. US1 → reserva en ordenador (MVP).
3. US2 → cita y reprogramación en ordenador.
4. US3 → tablet.
5. Polish → documentación y validación final. PR a `main` con la CI en verde.
