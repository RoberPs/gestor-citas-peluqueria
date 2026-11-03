# Feature Specification: Varios servicios por cita y precio opcional

**Feature Branch**: `005-multiple-services`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "005-multiple-services: varios servicios por cita y precio opcional, según las decisiones del 2026-11-02 en docs/roadmap.md. El cliente puede elegir varios servicios; la cita dura la suma de sus servicios, sin máximo y sin combinaciones prohibidas. Al reprogramar sólo cambia la hora; para cambiar servicios se cancela y se reserva de nuevo. Un servicio puede no tener precio, y la pantalla dice «Precio a consultar en el salón» en lugar de «0,00 €». Va antes de la 002 para que las pantallas de la dueña nazcan con varios servicios por cita."

## Contexto

En la 001 cada cita lleva un solo servicio (BR-008). En una peluquería de caballeros
lo normal es pedir varios a la vez: corte y barba, corte y afeitado. Hoy el cliente
tiene que reservar dos citas seguidas, con dos enlaces, o elegir uno y explicar el
resto al llegar, y el sillón queda reservado por menos tiempo del que hace falta.

Además, el salón todavía no ha fijado sus precios y la pantalla enseña «0,00 €», que se
lee como «gratis».

Esta feature cambia las dos cosas en la parte del cliente. Se hace antes de la 002 para
que la agenda y el listado de la dueña nazcan mostrando varios servicios por cita, sin
migrar datos después.

## Clarifications

### Session 2026-11-02

Decisiones de la dueña del producto recogidas en `docs/roadmap.md`:

- Q: ¿Puede el cliente elegir varios servicios en una cita? → A: Sí. La cita dura la
  **suma** de sus servicios. Sin máximo y sin combinaciones prohibidas.
- Q: ¿Qué se puede cambiar al reprogramar una cita con varios servicios? → A: Sólo la
  hora. Para cambiar los servicios se cancela y se reserva de nuevo.
- Q: ¿Qué se muestra si un servicio no tiene precio? → A: «Precio a consultar en el
  salón», nunca «0,00 €».
- Q: ¿Cuánto dura cada servicio? → A: 30 minutos cada uno hasta que el peluquero diga
  lo que tarda; la reserva sigue siendo cada media hora. Es un dato del catálogo, no
  una regla de esta feature.

### Session 2026-11-03

- Q: ¿Cómo se muestra el precio total cuando unos servicios tienen precio y otros no?
  → A: Cada servicio muestra su precio o «Precio a consultar en el salón», y el total
  suma los que tienen precio seguido de «+ precio a consultar en el salón».

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reservar varios servicios en una sola cita (Priority: P1)

Un cliente quiere cortarse el pelo y arreglarse la barba. En la página de reservas
marca «Corte de pelo» y «Diseño y corte de barba». Ve que la cita durará 1 hora, elige
un día y una de las horas en las que cabe la hora entera, deja sus datos y confirma. Le
queda una sola cita, con un solo enlace, que ocupa el sillón el tiempo que hace falta.

**Why this priority**: es el motivo de la feature. Sin ella el cliente reserva dos
citas o reserva menos tiempo del que necesita, y la dueña lo corrige a mano.

**Independent Test**: con el catálogo precargado, marcar dos servicios, comprobar que
sólo se ofrecen horas donde cabe la suma de duraciones, reservar, y verificar que hay
una única cita con los dos servicios que ocupa la suma de sus duraciones.

**Acceptance Scenarios**:

1. **Given** el catálogo del salón, **When** el cliente abre la página de reservas,
   **Then** el primer servicio aparece elegido y puede marcar y desmarcar cualquier otro,
   viendo de cada uno su nombre, su duración y su precio.
2. **Given** el cliente ha marcado «Corte de pelo» (30 min) y «Diseño y corte de barba»
   (30 min), **When** mira la selección, **Then** ve los dos servicios y la duración
   total: 1 h.
3. **Given** el salón abre de 10:00 a 14:00, **When** el cliente consulta las horas de
   ese día con una selección de 1 h, **Then** el último inicio ofrecido es las 13:00 y
   no se ofrecen las 13:30.
4. **Given** una cita confirmada de 11:00 a 11:30, **When** el cliente consulta las horas
   con una selección de 1 h, **Then** no se ofrecen las 10:30 ni las 11:00 para empezar,
   y sí las 10:00 y las 11:30, porque una cita puede empezar justo cuando termina otra
   (BR-013 de la 001).
5. **Given** dos servicios elegidos, **When** el cliente cambia la selección, **Then** el
   estado de los 14 días y las horas del día elegido se recalculan para la nueva
   duración total.
6. **Given** el cliente llega al formulario con dos servicios, **When** revisa la cita
   antes de confirmar, **Then** ve cada servicio con su duración y su precio, la duración
   total, el precio total, el día, la hora de inicio y el plazo de cancelación.
7. **Given** el cliente confirma con dos servicios, **When** la reserva prospera, **Then**
   existe una sola cita, con un solo enlace de gestión, que ocupa el sillón de la hora de
   inicio a la hora de inicio más la duración total, y la pantalla de confirmación
   muestra los dos servicios.
8. **Given** otro cliente ha ocupado parte del tramo mientras éste rellenaba el
   formulario, **When** confirma, **Then** la reserva se rechaza igual que en la 001 y se
   le ofrecen las horas en las que sigue cabiendo su selección.

---

### User Story 2 - Consultar y reprogramar una cita con varios servicios (Priority: P1)

El cliente abre el enlace de una cita con corte y barba. Ve los dos servicios, la
duración total y el precio. Si reprograma, sólo elige otra hora: los servicios se
mantienen y sólo se le ofrecen las horas en las que cabe la cita entera.

**Why this priority**: en cuanto existe una cita con varios servicios, su enlace tiene
que enseñarla bien y la reprogramación no puede romper la garantía de no-superposición.
Sin esta historia, la 1 deja citas que no se gestionan bien.

**Independent Test**: precargar una cita con dos servicios, abrir su enlace, comprobar
lo que muestra, reprogramarla y verificar que conserva los servicios, la duración total
y el enlace.

**Acceptance Scenarios**:

1. **Given** una cita con «Corte de pelo» y «Afeitado clásico», **When** el cliente abre
   su enlace, **Then** ve los dos servicios, la duración total, el precio, la fecha, la
   hora, el estado y los datos del salón.
2. **Given** esa cita dentro de plazo, **When** el cliente pulsa reprogramar, **Then** ve
   los servicios de la cita sin poder cambiarlos, con un aviso de que para cambiarlos
   debe cancelar y reservar de nuevo.
3. **Given** la reprogramación de una cita de 1 h, **When** el cliente consulta las horas
   de un día, **Then** sólo se ofrecen inicios donde cabe 1 h, y su hora actual aparece
   marcada como «tu hora actual» sin contar como ocupada.
4. **Given** el cliente elige una hora nueva válida, **When** confirma el cambio, **Then**
   la cita pasa a la hora nueva con los mismos servicios y la misma duración total, y
   conserva el mismo enlace.
5. **Given** una cita reservada antes de esta feature, con un solo servicio, **When** el
   cliente abre su enlace, **Then** la ve exactamente igual que antes.

---

### User Story 3 - Ver «Precio a consultar» cuando un servicio no tiene precio (Priority: P2)

El salón todavía no ha fijado algunos precios. El cliente ve «Precio a consultar en el
salón» en esos servicios, en el resumen, en la confirmación y en el enlace de su cita.
Nunca ve «0,00 €».

**Why this priority**: hoy la demo enseña «0,00 €» y se lee como «gratis», pero no
impide reservar. Es independiente de las historias 1 y 2.

**Independent Test**: precargar un servicio sin precio y otro con precio, recorrer
catálogo, resumen, confirmación y enlace, y comprobar qué se muestra en cada sitio.

**Acceptance Scenarios**:

1. **Given** un servicio sin precio, **When** el cliente ve el catálogo, **Then** ese
   servicio muestra «Precio a consultar en el salón» y no muestra ningún importe.
2. **Given** una selección en la que ningún servicio tiene precio, **When** el cliente
   ve el resumen, la confirmación o el enlace de su cita, **Then** el precio aparece como
   «Precio a consultar en el salón».
3. **Given** una selección en la que todos los servicios tienen precio, **When** el
   cliente ve el resumen, **Then** el precio total es la suma de los precios.
4. **Given** una selección con servicios con precio y servicios sin precio, **When** el
   cliente ve el resumen, **Then** cada servicio muestra su precio o «Precio a consultar
   en el salón», y el total suma los que tienen precio seguido de «+ precio a consultar
   en el salón» (por ejemplo, «12,00 € + precio a consultar en el salón»).
5. **Given** un servicio que no tenía precio al reservar y lo tiene después, **When** el
   cliente abre el enlace de su cita, **Then** sigue viendo «Precio a consultar en el
   salón», porque la cita conserva el catálogo tal como estaba al reservar.

---

### Edge Cases

- **Desmarcar todos los servicios**: no se muestran días ni horas, y en su lugar se
  pide elegir al menos uno. No se puede llegar al formulario sin servicios.
- **Selección que no cabe en ningún tramo** (por ejemplo, una suma más larga que el
  tramo de apertura más largo del salón): todos los días aparecen sin horas y se explica
  que la selección dura más que cualquier tramo libre, invitando a quitar algún servicio
  o a llamar al salón, con su teléfono.
- **Selección larga que cruza un cierre intermedio**: igual que en la 001, la cita
  entera tiene que caber en un solo tramo de apertura. Con tramos de 10:00–14:00 y
  17:00–20:00, una selección de 1 h 30 min no se ofrece a las 13:00.
- **Cambiar la selección con una hora ya elegida**: si la hora sigue siendo válida
  para la nueva duración total se conserva; si no, se quita, se avisa al cliente y se
  conservan el día y los datos escritos.
- **Elegir dos veces el mismo servicio**: no es posible; cada servicio se marca o se
  desmarca.
- **Un servicio de la selección deja de ofrecerse mientras el cliente reserva**: la
  reserva se rechaza con un mensaje que lo explica, y la selección se muestra sin ese
  servicio para que el cliente decida.
- **Atrás y recarga** (003, FR-010a): marcar o desmarcar un servicio es un paso del
  historial. Atrás deshace el último cambio y recargar conserva la selección, el día y
  la hora.
- **El catálogo cambia después de reservar**: la cita conserva el nombre, la duración y
  el precio de cada servicio tal como estaban al reservar, también si un servicio deja de
  ofrecerse o cambia de precio.
- **Límite de 3 citas futuras** (001, BR-014): cuenta citas, no servicios. Una cita con
  cuatro servicios es una cita.
- **Borrado a los 12 meses** (001, BR-018): la cita anonimizada conserva sus servicios
  como histórico de ocupación.
- **Precio cero**: un servicio sin precio no es un servicio de 0 €. La app nunca
  muestra «0,00 €» como precio de un servicio.

## Requirements *(mandatory)*

### Functional Requirements

#### Elegir servicios

- **FR-001**: El sistema MUST permitir al cliente elegir uno o varios servicios del
  catálogo para una misma cita, sin máximo y sin combinaciones prohibidas.
- **FR-002**: El sistema MUST mostrar el primer servicio del catálogo ya elegido al abrir
  la página de reservas, y MUST permitir marcar y desmarcar cada servicio por separado.
- **FR-003**: El sistema MUST impedir que un mismo servicio aparezca más de una vez en
  una cita.
- **FR-004**: El sistema MUST exigir al menos un servicio para mostrar días, horas y
  formulario, y MUST pedirlo de forma explícita cuando la selección quede vacía.
- **FR-005**: El sistema MUST mostrar en todo momento los servicios elegidos y la
  duración total de la selección.
- **FR-006**: El sistema MUST presentar los servicios de una cita siempre en el orden
  del catálogo, sea cual sea el orden en que el cliente los marcó.

#### Duración y disponibilidad

- **FR-007**: El sistema MUST calcular la duración de una cita como la **suma** de las
  duraciones de sus servicios.
- **FR-008**: El sistema MUST aplicar a la duración total todas las condiciones de
  disponibilidad de la 001 (FR-003 de la 001): la cita entera cabe en un solo tramo de
  apertura, no solapa ninguna cita confirmada, respeta la antelación mínima y cae dentro
  del horizonte.
- **FR-009**: El sistema MUST recalcular el estado de los 14 días y las horas del día
  elegido cada vez que cambia la selección, y MUST seguir resolviendo el estado de un
  rango en una sola consulta de disponibilidad, sea cual sea el número de servicios.
- **FR-010**: El sistema MUST explicar al cliente, cuando su selección dure más que
  cualquier tramo de apertura del salón, que debe quitar algún servicio o llamar al
  salón, mostrando su teléfono. Si la selección cabe en el horario pero no queda ningún
  hueco libre, se mantiene el comportamiento de la 001: días llenos y salto al siguiente
  día con huecos.
- **FR-011**: El sistema MUST conservar la hora elegida al cambiar la selección sólo si
  sigue siendo reservable con la nueva duración total; si no, MUST quitarla y avisar al
  cliente, conservando el día elegido y los datos escritos.

#### Reserva y cita

- **FR-012**: El sistema MUST crear una sola cita, con un solo enlace de gestión, para
  todos los servicios elegidos.
- **FR-013**: El sistema MUST mostrar, antes de confirmar, en la confirmación y en el
  enlace de la cita: cada servicio con su duración y su precio, la duración total y el
  precio total (FR-018 a FR-020), además de los datos que ya mostraba la 001.
- **FR-014**: El sistema MUST conservar en la cita el nombre, la duración y el precio de
  **cada** servicio vigentes al reservar, de forma que cambios posteriores del catálogo
  no alteren citas ya confirmadas. Amplía FR-016 de la 001.
- **FR-015**: El sistema MUST revalidar en servidor, al confirmar, que todos los
  servicios elegidos siguen en el catálogo y que la duración total sigue cabiendo en el
  hueco, y MUST rechazar la reserva si no se cumple, explicando qué ha cambiado.
- **FR-016**: El sistema MUST seguir garantizando que ninguna cita confirmada se solapa
  con otra en ningún minuto de su duración total, también cuando dos confirmaciones
  simultáneas compiten por tramos que se solapan en parte.

#### Reprogramación

- **FR-017**: El sistema MUST conservar los servicios y la duración total de la cita al
  reprogramarla: sólo cambia la hora de inicio. MUST ofrecer únicamente horas en las que
  cabe la duración total, y MUST indicar que para cambiar los servicios hay que cancelar
  y reservar de nuevo. Sustituye a FR-024 de la 001 («del mismo servicio»).

#### Precio opcional

- **FR-018**: El sistema MUST admitir servicios sin precio. Cuando un servicio tiene
  precio, ese precio es mayor que cero.
- **FR-019**: El sistema MUST mostrar «Precio a consultar en el salón» en lugar de un
  importe en todo lugar donde aparezca un servicio sin precio, y MUST NOT mostrar nunca
  «0,00 €» como precio.
- **FR-020**: El sistema MUST mostrar como precio total de una cita la suma de sus
  precios cuando todos sus servicios tienen precio, y «Precio a consultar en el salón»
  cuando ninguno lo tiene. Cuando unos tienen precio y otros no, MUST mostrar la suma de
  los que tienen precio seguida de «+ precio a consultar en el salón».

#### Compatibilidad

- **FR-021**: El sistema MUST mostrar y gestionar las citas reservadas antes de esta
  feature como citas de un solo servicio, sin cambiar su hora, su duración, su precio ni
  su enlace.
- **FR-022**: El sistema MUST mantener en los tres tamaños de la 003 la misma
  disposición: en ordenador, la elección de servicios y los días a la izquierda; horas,
  resumen y formulario a la derecha.
- **FR-023**: El sistema MUST mostrar qué servicios están elegidos con texto e icono, no
  sólo con color, y MUST anunciar a quien usa lector de pantalla los cambios de la
  duración total sin mover el foco.

### Key Entities

- **Servicio**: una prestación del catálogo. Nombre, duración en minutos y, de forma
  opcional, precio. Cambia respecto a la 001: el precio deja de ser obligatorio.
- **Cita**: la reserva de un cliente. Cambia respecto a la 001: en lugar de un servicio
  lleva **una lista de uno o más servicios**, sin repetir, cada uno con el nombre, la
  duración y el precio que tenía al reservar. Su duración es la suma de esa lista y su
  hora de fin, la de inicio más esa suma. El resto de la cita no cambia.
- **Selección de servicios**: los servicios marcados por el cliente antes de reservar.
  Es un concepto derivado de la pantalla: no se guarda hasta que se confirma la cita.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un cliente reserva dos servicios en **una sola cita en menos de 90
  segundos**, el mismo objetivo que la 001 para un servicio.
- **SC-002**: **Cero** citas confirmadas que se solapan en algún minuto, incluidas las
  de varios servicios, verificable sobre la agenda completa en cualquier momento.
- **SC-003**: **El 100 %** de las horas ofrecidas para una selección admiten su duración
  total completa en el instante en que se muestran.
- **SC-004**: La respuesta percibida sigue **por debajo de 2 segundos** en cualquier
  acción de la reserva, con uno o con cuatro servicios elegidos.
- **SC-005**: **Cero** pantallas que muestran «0,00 €» como precio de un servicio o de
  una cita.
- **SC-006**: **El 100 %** de las citas reservadas antes de esta feature se ven y se
  gestionan igual que antes.
- **SC-007**: **Cero** infracciones WCAG 2.2 AA en las comprobaciones automáticas a 360,
  768 y 1280 px, y el flujo con varios servicios se completa entero con teclado.

## Assumptions

- La duración de cada servicio la fija el catálogo. Mientras el peluquero no diga lo que
  tarda, todos duran 30 minutos y la rejilla de inicios sigue siendo de 30 minutos
  (BR-012 de la 001).
- El precio sigue siendo informativo, como en la 001: la app no cobra nada.
- La demo de la Peluquería Niza pasa a tener sus cuatro servicios sin precio hasta que
  se acuerden. El fixture de los tests incluye al menos un servicio sin precio.
- No cambia ningún dato personal: la cita sigue guardando sólo nombre, teléfono y email
  (Principio III).
- No cambian la antelación mínima, el plazo de cancelación, el horizonte, la rejilla ni
  el límite de 3 citas futuras.
- Los textos nuevos viven con el resto de textos de la interfaz.

## Out of Scope

- Cambiar los servicios de una cita ya reservada. Se cancela y se reserva de nuevo.
- Combinaciones con duración o precio propios (por ejemplo, «corte + barba» más barato
  que la suma). La duración y el precio son siempre la suma.
- Márgenes entre servicios de una misma cita: los servicios van seguidos.
- Elegir el orden en que se hacen los servicios.
- Editar el catálogo desde la app: sigue siendo configuración precargada hasta la 002
  (US8).
- Pantallas de la dueña (002), que tendrán que mostrar varios servicios por cita.

## Dependencies

- 001 · Reserva del cliente y 003 · Versión responsive, ya en `main`.
- Esta feature modifica de la 001: BR-008 (un servicio por cita), FR-001 y FR-016
  (catálogo y precio) y FR-024 (reprogramar «el mismo servicio»).
- La 002 (agenda, listado, citas a mano y catálogo) y la 004 (email de confirmación) se
  especifican o revisan después, sobre este modelo de cita.
