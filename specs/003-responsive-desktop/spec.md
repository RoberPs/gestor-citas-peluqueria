# Feature Specification: Versión responsive para tablet y ordenador

**Feature Branch**: `003-responsive-desktop`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "003-responsive-desktop: versión responsive de la parte del cliente (001) para tablet y ordenador. Tres tamaños: móvil (< 640 px, el diseño actual, sin cambios), tablet (≥ 640 px) y ordenador (≥ 1024 px). En ordenador, la reserva se muestra en dos columnas: servicio y días a la izquierda, horas y formulario a la derecha. Las pantallas de la cita (consultar, reprogramar, cancelar) y confirmación se adaptan sin quedarse como una columna estrecha. Tests e2e y de accesibilidad (axe) también a 1280 px. Se hace antes de la 002 para que las pantallas de la dueña nazcan responsive. Spec corta."

## Contexto

La parte del cliente (001) se diseñó para un móvil de 360 px. En una pantalla ancha
todo se ve como una columna estrecha en el centro, y reservar exige ir y volver entre
la pantalla de huecos y la de datos. Muchos clientes reservan desde el ordenador del
trabajo o desde una tablet en casa.

Esta feature adapta las pantallas existentes a tres tamaños, sin cambiar ninguna regla
de negocio. Se hace antes de la 002 para que las pantallas de la dueña, que ella usará
sobre todo en tablet u ordenador, partan de una base responsive ya probada.

### Tamaños

| Tamaño | Ancho de la ventana | Disposición |
|---|---|---|
| Móvil | menos de 640 px | La actual de la 001, sin cambios. |
| Tablet | de 640 a 1023 px | Una columna más ancha y cómoda. |
| Ordenador | 1024 px o más | Reserva, reprogramación y cita en dos columnas. |

## Clarifications

### Session 2026-11-02

- Q: En ordenador, ¿qué hacen el botón Atrás del navegador y la recarga después de
  elegir servicio, día u hora? → A: Cada elección es un paso del historial: Atrás
  deshace la última, y recargar o compartir la dirección conserva servicio, día y hora.
- Q: ¿Los datos escritos en el formulario deben sobrevivir a una recarga de la página?
  → A: No. Se conservan sólo mientras la página está abierta y nunca se guardan en el
  navegador (Principio III).
- Q: En ordenador, ¿la pantalla de la cita se muestra en una columna ancha o en dos?
  → A: En dos: a la izquierda los datos de la cita y el aviso de guardar el enlace; a la
  derecha las acciones y los datos del salón.
- Q: ¿Qué tests e2e de la 001 se ejecutan también a 1280 px? → A: Toda la suite, salvo
  la medición de rendimiento y la comprobación a una mano, que son propias del móvil.
  Las comprobaciones de accesibilidad, a 360, 768 y 1280 px.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reservar desde el ordenador en dos columnas (Priority: P1)

Un cliente abre la página de reservas en el ordenador. A la izquierda elige el servicio
y ve el rango de 14 días; a la derecha ve las horas libres del día elegido. Al elegir
una hora, el resumen de la cita y el formulario aparecen en la columna derecha, sin
perder de vista el servicio y el día elegidos. Rellena sus datos y confirma.

**Why this priority**: es el cambio que más valor aporta y el motivo de la feature:
la reserva es el camino principal (Principio VI) y en ordenador hoy obliga a saltar
entre pantallas con una columna estrecha.

**Independent Test**: a 1280 px, reservar una cita de principio a fin y comprobar que
servicio y días permanecen visibles a la izquierda mientras se eligen la hora y se
rellenan los datos a la derecha.

**Acceptance Scenarios**:

1. **Given** un ordenador con la ventana a 1280 px, **When** el cliente abre la página
   de reservas, **Then** ve la elección de servicio y el rango de días en una columna
   izquierda, y en la derecha las horas del día con la indicación de qué pasa al elegir una.
2. **Given** un servicio elegido, **When** el cliente elige un día, **Then** la columna
   derecha muestra las horas libres de ese día y la izquierda sigue mostrando el
   servicio y el rango con el día marcado como elegido.
3. **Given** un día con horas libres, **When** el cliente elige una hora, **Then** la
   columna derecha muestra el resumen de la cita (servicio, fecha, hora, duración,
   precio y plazo de cancelación) y el formulario de datos, y la izquierda sigue visible.
4. **Given** el formulario con datos ya escritos, **When** el cliente elige otra hora u
   otro día con huecos, **Then** el resumen se actualiza y los datos escritos se conservan.
5. **Given** el formulario con un dato incorrecto, **When** el cliente confirma, **Then**
   el error aparece junto al campo en la columna derecha, conservando lo escrito, igual
   que en móvil.
6. **Given** un día lleno o cerrado, **When** el cliente lo elige, **Then** la columna
   derecha explica que no hay horas y ofrece el salto al siguiente día con huecos.
7. **Given** servicio, día y hora elegidos en ordenador, **When** el cliente pulsa Atrás
   en el navegador, **Then** vuelve a las horas de ese día sin hora elegida; **When**
   en su lugar recarga la página, **Then** ve el mismo servicio, día y hora elegidos.

---

### User Story 2 - Consultar, cancelar y reprogramar la cita desde el ordenador (Priority: P2)

Un cliente abre el enlace de su cita en el ordenador, recién reservada o días después.
Ve los datos de la cita, el aviso de guardar el enlace y las acciones disponibles con un
ancho de lectura cómodo. Si reprograma, ve los días a la izquierda y las horas a la
derecha, como al reservar.

**Why this priority**: es el segundo uso más frecuente y comparte la base con la
historia 1, pero el cliente puede hacerlo aunque se vea estrecho.

**Independent Test**: a 1280 px, abrir una cita recién reservada, otra ya existente,
cancelar una y reprogramar otra, comprobando la disposición de cada pantalla.

**Acceptance Scenarios**:

1. **Given** una reserva recién confirmada en un ordenador, **When** se muestra la
   pantalla de confirmación, **Then** los datos de la cita, el enlace de gestión y el
   aviso de guardarlo son visibles a 1280 × 800 px sin desplazarse.
2. **Given** el enlace de una cita confirmada, **When** el cliente lo abre en un
   ordenador, **Then** ve en dos columnas los datos de la cita a la izquierda y las
   acciones y los datos del salón a la derecha, no una franja de móvil.
3. **Given** la pantalla de reprogramar en un ordenador, **When** el cliente elige un
   día, **Then** el rango de días está a la izquierda y las horas, con la hora actual
   marcada, a la derecha; al elegir una hora, la confirmación del cambio aparece en la
   columna derecha.
4. **Given** el diálogo de cancelar en un ordenador, **When** se abre, **Then** pide la
   confirmación explícita igual que en móvil y se puede manejar entero con teclado.
5. **Given** un enlace inexistente, **When** se abre en un ordenador, **Then** el
   mensaje neutro se presenta con el mismo ancho de lectura que el resto de pantallas.

---

### User Story 3 - Usar la app cómodamente en una tablet (Priority: P3)

Un cliente reserva desde una tablet. Ve el mismo flujo que en el móvil, en una columna,
pero más ancha y con el rango de días y las horas más holgados.

**Why this priority**: el flujo de móvil ya funciona en tablet, sólo que se ve estrecho;
mejora la comodidad pero no desbloquea nada.

**Independent Test**: a 768 px, recorrer reserva y gestión de cita y comprobar que el
flujo es el de móvil con una columna más ancha.

**Acceptance Scenarios**:

1. **Given** una tablet con la ventana a 768 px, **When** el cliente abre la página de
   reservas, **Then** ve una sola columna más ancha que en móvil y el mismo orden de pasos.
2. **Given** la misma tablet, **When** el cliente consulta el rango de 14 días, **Then**
   el estado de cada día se lee con texto e icono y cada día tiene un área táctil
   holgada.

---

### Edge Cases

- **Cambio de tamaño a mitad del flujo** (girar la tablet, redimensionar la ventana):
  se conservan servicio, día, hora elegida y datos escritos; sólo cambia la disposición.
- **Recarga con datos escritos**: se conservan servicio, día y hora, pero los datos del
  formulario se pierden, porque nunca se guardan en el navegador.
- **Anchos límite**: a 639 px se ve móvil, a 640 px tablet, a 1023 px tablet y a
  1024 px ordenador.
- **Zoom del navegador**: con zoom de hasta el 400 % en una ventana de 1280 px, la
  página se reorganiza como en móvil sin desplazamiento horizontal.
- **Pantallas muy anchas** (1920 px o más): el contenido queda centrado con un ancho
  máximo; no se estira hasta los bordes.
- **Ordenador sin hora elegida**: el primer servicio llega preseleccionado, así que la
  columna derecha muestra las horas del día y una indicación de que, al elegir una,
  aparecerán ahí el resumen y el formulario.
- **Hueco ocupado al confirmar en ordenador**: el rechazo y la disponibilidad
  actualizada se muestran en la columna derecha y la izquierda refleja el nuevo estado
  de los días.
- **Cita cancelada o pasada en ordenador**: se ve igual que en móvil, con el motivo por
  el que no hay acciones, sólo que con más ancho.

## Requirements *(mandatory)*

### Functional Requirements

#### Tamaños y disposición

- **FR-001**: El sistema MUST adaptar cada pantalla de cliente a tres tamaños según el
  ancho de la ventana: móvil (menos de 640 px), tablet (de 640 a 1023 px) y ordenador
  (1024 px o más).
- **FR-002**: El sistema MUST mantener en móvil la presentación y el flujo actuales de
  la 001 sin cambios.
- **FR-003**: El sistema MUST mostrar en tablet el mismo flujo que en móvil, en una sola
  columna más ancha y centrada.
- **FR-004**: El sistema MUST limitar el ancho del contenido y centrarlo en pantallas muy
  anchas, de modo que ninguna línea de texto corrido supere unos 80 caracteres.
- **FR-005**: El sistema MUST NOT provocar desplazamiento horizontal de la página en
  ningún ancho desde 320 px, ni con zoom de hasta el 400 %.
- **FR-006**: El sistema MUST definir los tres tamaños y sus anchos una sola vez, de modo
  que cualquier pantalla nueva, incluidas las de la dueña (002), los aplique igual.

#### Reserva en ordenador

- **FR-007**: El sistema MUST presentar en ordenador la reserva en dos columnas: a la
  izquierda la elección de servicio y el rango de 14 días; a la derecha las horas del
  día elegido y, al elegir una hora, el resumen de la cita y el formulario de datos.
- **FR-008**: El sistema MUST mantener visibles en la columna izquierda el servicio y el
  día elegidos mientras el cliente elige la hora, revisa el resumen y rellena el
  formulario.
- **FR-009**: El sistema MUST conservar los datos ya escritos en el formulario cuando el
  cliente cambia de hora o de día en ordenador, sólo mientras la página siga abierta, y
  MUST NOT guardar nombre, teléfono ni email en el almacenamiento del navegador.
- **FR-010**: El sistema MUST mostrar en la columna derecha, mientras no haya hora
  elegida, una indicación de que al elegirla aparecerán ahí el resumen y el formulario.
- **FR-010a**: El sistema MUST registrar cada elección de servicio, día y hora como un
  paso del historial del navegador: Atrás deshace la última elección, y recargar o abrir
  la misma dirección muestra el mismo servicio, día y hora elegidos.

#### Pantallas de la cita

- **FR-011**: El sistema MUST presentar en tablet las pantallas de confirmación,
  consulta, cancelación y mensaje neutro en una columna más ancha que en móvil, limitada
  por FR-004, y en ordenador el mensaje neutro con ese mismo ancho.
- **FR-011a**: El sistema MUST presentar en ordenador las pantallas de confirmación y
  consulta de la cita en dos columnas: a la izquierda los datos de la cita y, si es una
  reserva recién hecha, el enlace de gestión con su aviso; a la derecha las acciones
  disponibles (o el motivo por el que no las hay) y los datos del salón.
- **FR-012**: El sistema MUST presentar en ordenador la reprogramación con la misma
  disposición en dos columnas que la reserva: días a la izquierda; horas, con la hora
  actual marcada, y confirmación del cambio a la derecha.

#### Comportamiento común

- **FR-013**: El sistema MUST ofrecer en todos los tamaños exactamente los mismos huecos,
  validaciones, mensajes y acciones que la 001. Cambiar de tamaño no cambia ninguna
  regla de negocio.
- **FR-014**: El sistema MUST conservar servicio, día, hora elegida y datos escritos
  cuando la ventana cambia de tamaño a mitad del flujo.
- **FR-015**: El sistema MUST mantener el orden de lectura y de foco igual al orden
  visual: columna izquierda antes que derecha, y dentro de cada una de arriba abajo.
- **FR-016**: El sistema MUST informar a quien usa lector de pantalla de que la columna
  derecha ha cambiado al elegir día u hora en ordenador, sin mover el foco por sorpresa.
- **FR-017**: El sistema MUST cumplir en los tres tamaños WCAG 2.2 AA, con área táctil
  mínima de 44 × 44 px, foco visible y estado con texto e icono, no sólo color.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: En ordenador, el cliente completa una reserva **sin salir de la vista de
  reserva**: desde que elige servicio hasta que confirma, el servicio y el día elegidos
  están siempre a la vista.
- **SC-002**: A 1280 px, la vista de reserva aprovecha **al menos 900 px** de ancho útil,
  frente a los 480 px actuales.
- **SC-003**: **Cero** desplazamiento horizontal a 320, 360, 640, 768, 1024, 1280 y
  1920 px de ancho, y a 1280 px con zoom del 400 %.
- **SC-004**: **El 100 %** de los tests e2e de la 001 a 360 px siguen pasando sin
  modificar sus comprobaciones de comportamiento.
- **SC-005**: **Toda** la suite e2e de la 001 pasa también a **1280 px**, salvo la
  medición de rendimiento y la comprobación a una mano, propias del móvil; y las
  comprobaciones automáticas de accesibilidad dan **cero** infracciones WCAG 2.2 AA a
  360, 768 y 1280 px.
- **SC-006**: La respuesta percibida sigue **por debajo de 2 segundos** en cualquier
  acción del flujo de reserva, en todos los tamaños.
- **SC-007**: A 1280 × 800 px, la pantalla de confirmación muestra los datos de la cita,
  el enlace de gestión y el aviso de guardarlo **sin desplazarse**.

## Assumptions

- Los anchos se refieren al ancho de la ventana del navegador, no al tipo de
  dispositivo. Una tablet apaisada de 1024 px o más se ve como ordenador.
- No hay rediseño visual: colores, tipografía, iconos y textos son los de la 001. Si
  hace falta algún texto nuevo (por ejemplo, la indicación de FR-010), vive con el
  resto de textos de la interfaz.
- No cambia ninguna regla de negocio ni ningún dato: es una feature de presentación.
- Se toman como anchos de prueba 360 px (móvil), 768 px (tablet) y 1280 px (ordenador).
- Las pantallas de la dueña quedan fuera, pero se construirán sobre esta base (FR-006).

## Out of Scope

- Pantallas de la dueña (002).
- Rediseño de marca, modo oscuro o estilos de impresión.
- Vista semanal o mensual del calendario: el rango sigue siendo de 14 días.
- Corregir los defectos menores de la 001 listados en el `README.md`, salvo que la
  nueva disposición los resuelva de paso.

## Dependencies

- 001 · Reserva del cliente, ya en `main`.
