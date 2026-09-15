# Feature Specification: Reserva de citas de peluquería (cara al cliente) v1

**Feature Branch**: `001-client-appointment-booking`

**Created**: 2026-09-15

**Status**: Draft

**Input**: Especificación de negocio aportada por la dueña del producto: reserva, consulta, reprogramación y cancelación de citas por parte del cliente, en un salón de un solo sillón, sin cuentas de usuario.

---

## Contexto de negocio

Una peluquería de un solo sillón pierde reservas y tiempo por teléfono: la dueña no puede atender mientras corta el pelo, los clientes llaman fuera del horario de apertura, y se producen dobles reservas cuando la agenda de papel se apunta con prisa entre cliente y cliente.

Esta feature permite al cliente reservar, consultar, reprogramar y cancelar su propia cita online, sin llamar y sin que la peluquera interrumpa su trabajo.

El salón tiene **una única peluquera**, que además es la dueña. Sólo se puede atender a un cliente a la vez: toda la agenda es **una única línea temporal**.

Cada dueña de salón usa **su propia instancia independiente** de la app. No hay directorio de salones ni selector de establecimiento: el cliente siempre aterriza en la página de reservas de un salón concreto.

### Usuarios

- **Cliente** (usuario directo): reserva para sí mismo. No es técnico, normalmente va con el móvil y con prisa. No tiene cuenta y no va a crearse una. Puede ser cliente nuevo o habitual; el sistema no los distingue en esta versión.
- **Peluquera / dueña** (beneficiaria indirecta, no usa esta feature): recibe las reservas y trabaja con la agenda resultante. La agenda de la dueña es otra feature. **La dueña nunca debe tener que corregir a mano una reserva hecha por este flujo.**

---

## Clarifications

### Session 2026-09-15

- Q: ¿El horario de apertura de un día puede tener varios tramos (por ejemplo, cerrar a mediodía de 14:00 a 16:00), o es siempre un único tramo continuo de apertura a cierre? → A: Varios tramos por día; un servicio debe caber entero dentro de un solo tramo y no puede cruzar el cierre intermedio.
- Q: ¿Qué protección debe tener el sistema frente a un uso abusivo automatizado, como probar enlaces de gestión al azar o lanzar cientos de reservas con datos falsos distintos? → A: Entropía mínima de 128 bits en el identificador de acceso, más límite de intentos por IP en la apertura de enlaces y en la confirmación de reservas, con respuesta indistinguible al superarse.
- Q: Si la configuración precargada cambia y deja fuera de horario una cita ya confirmada, ¿qué debe hacer el sistema con esa cita? → A: La cita confirmada prevalece y no se toca; sólo deja de ofrecerse disponibilidad nueva en el tramo retirado. Resolver el conflicto queda fuera de v1 y lo hace la dueña por teléfono.
- Q: ¿Cómo elige el cliente el día: navegando de uno en uno, o desde un calendario que ya muestra qué días tienen hueco? → A: Vista de un rango acotado de 14 días con cada día marcado como cerrado, lleno o con huecos, y avance por rangos hasta el horizonte de 60 días; los huecos del día seleccionado se muestran debajo.
- Q: Cuando el enlace de gestión deja de funcionar porque los datos personales de la cita ya se han borrado a los 12 meses, ¿qué ve el cliente que lo abra? → A: El mismo mensaje neutro de FR-019, indistinguible de un enlace inexistente. La cita se conserva sin nombre, teléfono ni email, y su identificador de acceso deja de resolver.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver huecos realmente libres (Priority: P1)

El cliente abre la página de reservas del salón en el móvil, ve los servicios que ofrece el salón con su duración y su precio, elige uno, ve de un vistazo qué días de las próximas dos semanas tienen hueco, elige uno, y ve la lista de horas a las que puede empezar ese servicio. Toda hora que ve en pantalla es una hora que el salón puede atender de verdad.

**Why this priority**: sin disponibilidad fiable no hay producto. Un hueco fantasma —una hora que se ofrece y luego no se puede reservar— destruye la confianza del cliente y obliga a la dueña a llamar para deshacer el entuerto, que es exactamente el trabajo que esta feature viene a eliminar.

**Independent Test**: se puede probar entera sin reservar nada: precargar el catálogo de servicios, el horario de apertura y un conjunto de citas existentes, abrir la pantalla, y comprobar para cada hora mostrada y cada hora omitida que la decisión es correcta. Ya entrega valor: el cliente puede consultar si el salón tiene hueco sin llamar.

**Acceptance Scenarios**:

1. **Given** el salón abre de 10:00 a 20:00 y no hay ninguna cita ese día, **When** el cliente elige "Corte" (30 min) para un día futuro, **Then** se ofrecen los inicios de 10:00 a 19:30 en una rejilla de 30 minutos.
2. **Given** el salón cierra a las 20:00 y "Color" dura 90 minutos, **When** el cliente consulta huecos para "Color", **Then** las 19:00 y las 19:30 no se ofrecen y el último inicio ofrecido es las 18:30.
3. **Given** el salón abre de 10:00 a 14:00 y de 16:00 a 20:00, **When** el cliente consulta huecos para "Color" (90 min), **Then** no se ofrece ningún inicio entre las 14:00 y las 16:00, el último inicio del tramo de mañana es las 12:30, y el primero del tramo de tarde es las 16:00.
4. **Given** existe una cita confirmada de 10:00 a 11:30, **When** el cliente consulta huecos para "Corte" (30 min) ese día, **Then** no se ofrecen las 10:00, 10:30 ni las 11:00, y sí las 11:30.
5. **Given** son las 09:30 del día de hoy y la antelación mínima es de 2 horas, **When** el cliente consulta los huecos de hoy, **Then** el primer inicio ofrecido es las 11:30 y no se ofrecen las 10:00 ni las 11:00.
6. **Given** el cliente está viendo un día sin ningún hueco libre, **When** se carga la pantalla, **Then** se le indica que ese día no queda disponibilidad y se le ofrece navegar al siguiente día que sí la tenga.
7. **Given** el cliente ha elegido un servicio, **When** cambia de día dentro del rango o avanza al rango siguiente, **Then** la disponibilidad se recalcula para el mismo servicio sin perder la selección.
8. **Given** el cliente ha elegido un servicio, **When** se carga la pantalla, **Then** ve los 14 días que empiezan hoy, cada uno marcado como cerrado, lleno o con huecos para ese servicio, y los huecos del día seleccionado debajo.
9. **Given** el cliente está viendo el rango que llega al día 60, **When** intenta avanzar al siguiente rango, **Then** no puede, y se le indica que la agenda aún no está abierta para fechas posteriores.
10. **Given** el cliente está viendo el primer rango, que empieza hoy, **When** intenta retroceder, **Then** no puede, porque no se reservan días pasados.

---

### User Story 2 - Confirmar la cita (Priority: P1)

El cliente elige un hueco, deja su nombre, su teléfono y su email, ve el plazo de cancelación que se le aplica, y confirma. El hueco queda reservado a su nombre.

**Why this priority**: es el objetivo de la feature. Sin esto, la disponibilidad es sólo información y el cliente sigue teniendo que llamar.

**Independent Test**: se puede probar sobre un salón con disponibilidad precargada: elegir un hueco, rellenar los tres campos, confirmar, y verificar que la cita existe y que el hueco ha dejado de ofrecerse. Entrega el valor principal: reservar sin llamar.

**Acceptance Scenarios**:

1. **Given** el cliente ha elegido "Corte" el viernes a las 11:30, **When** llega al formulario, **Then** se le piden exactamente tres datos —nombre, teléfono y email— y ninguno más.
2. **Given** el cliente está en el formulario, **When** lo revisa antes de confirmar, **Then** ve el servicio, el día, la hora de inicio, la duración y el plazo de cancelación que aplicará a esa cita.
3. **Given** el cliente ha rellenado los tres campos correctamente, **When** confirma, **Then** la cita queda registrada como confirmada y ese hueco deja de ofrecerse inmediatamente para cualquier servicio.
4. **Given** el cliente introduce un email o un teléfono con formato inválido, **When** intenta confirmar, **Then** la reserva no se envía y se le señala qué campo corregir y cómo.
5. **Given** otro cliente ha tomado el mismo hueco mientras éste rellenaba el formulario, **When** confirma, **Then** la reserva se rechaza, se le explica con claridad que ese hueco acaba de ocuparse, y se le muestran los huecos que quedan libres ese día.
6. **Given** el mismo teléfono o email ya tiene 3 citas confirmadas futuras, **When** intenta confirmar una cuarta, **Then** la reserva se rechaza con un mensaje que explica el límite y le invita a cancelar una de las existentes o a contactar con el salón.

---

### User Story 3 - Recibir la confirmación en pantalla (Priority: P1)

Tras confirmar, el cliente ve una pantalla de confirmación inequívoca con todo lo que ha reservado, los datos del salón y el enlace para volver a esa cita más adelante.

**Why this priority**: sin confirmación explícita el cliente no sabe si la reserva ha entrado, y ante la duda llama al salón —de nuevo, el problema original—. Además, esta pantalla es el **único** sitio donde el cliente obtiene el enlace de su cita, porque v1 no envía ningún mensaje.

**Independent Test**: completar una reserva y verificar que la pantalla resultante contiene servicio, fecha, hora de inicio, duración, plazo de cancelación, datos del salón y el enlace de gestión.

**Acceptance Scenarios**:

1. **Given** una reserva recién confirmada, **When** se muestra la confirmación, **Then** aparecen el servicio, la fecha, la hora de inicio, la duración, el plazo de cancelación y los datos del salón (nombre, dirección y teléfono).
2. **Given** la pantalla de confirmación, **When** el cliente la consulta, **Then** se le muestra el enlace de gestión de su cita junto con un aviso destacado de que lo guarde, porque es su única vía de acceso y no se le va a enviar por ningún otro medio.
3. **Given** el cliente recarga la pantalla de confirmación, **When** se vuelve a cargar, **Then** no se crea una segunda cita.

---

### User Story 4 - Consultar la cita más tarde (Priority: P2)

El cliente abre el enlace que guardó y ve su cita: qué reservó, cuándo, y si aún está a tiempo de cambiarla.

**Why this priority**: evita llamadas de "¿a qué hora era lo mío?", pero el cliente ya tiene el dato en la confirmación. Es valioso, no crítico.

**Independent Test**: crear una cita, abrir su enlace, y verificar que muestra esa cita y su estado. Se prueba sin necesidad de que existan cancelación ni reprogramación.

**Acceptance Scenarios**:

1. **Given** una cita confirmada dentro de plazo, **When** el cliente abre su enlace, **Then** ve el servicio, la fecha, la hora, la duración, el estado y los datos del salón, y se le ofrecen las acciones de cancelar y reprogramar.
2. **Given** un enlace que no corresponde a ninguna cita, está malformado, apunta a una cita ya borrada o apunta a una cita cuyos datos personales se han borrado por retención, **When** se abre, **Then** se muestra el mismo mensaje neutro en los cuatro casos, sin revelar si esa cita existió, y se ofrece ir a la pantalla de reservas.
3. **Given** una cita cuya hora de fin ya ha pasado, **When** el cliente abre su enlace, **Then** la ve como completada, en sólo lectura, y se le ofrece reservar una nueva.
4. **Given** una cita ya cancelada, **When** el cliente abre su enlace, **Then** la ve como cancelada, sin opciones de modificarla, y se le ofrece reservar una nueva.
5. **Given** el enlace de una cita, **When** se abre, **Then** en ninguna circunstancia se muestran otras citas, otros clientes ni la agenda del salón.

---

### User Story 5 - Cancelar la cita (Priority: P2)

El cliente que no puede acudir abre su enlace, cancela, y el hueco vuelve a estar disponible para otra persona al momento.

**Why this priority**: beneficia sobre todo al salón —un hueco liberado es un hueco vendible— y evita la llamada de cancelación, que suele llegar en el peor momento. Depende de HU4.

**Independent Test**: crear una cita, cancelarla desde su enlace, y comprobar que el hueco reaparece en la pantalla de reservas.

**Acceptance Scenarios**:

1. **Given** una cita confirmada a más de 24 horas de su inicio, **When** el cliente pulsa cancelar, **Then** se le pide confirmación explícita antes de hacer nada.
2. **Given** el cliente ha confirmado la cancelación, **When** se procesa, **Then** la cita pasa a cancelada y el hueco vuelve a ofrecerse inmediatamente en la pantalla de reservas.
3. **Given** una cita a menos de 24 horas de su inicio, **When** el cliente abre su enlace, **Then** ve la cita pero las opciones de cancelar y reprogramar no están disponibles, con un mensaje que explica el porqué y le indica llamar al salón, mostrando su teléfono.
4. **Given** una cita ya cancelada, **When** se intenta cancelar de nuevo, **Then** la acción se rechaza y se muestra el estado actual de la cita.
5. **Given** un hueco liberado por una cancelación, **When** otro cliente consulta ese día, **Then** puede reservarlo con normalidad.

---

### User Story 6 - Reprogramar la cita (Priority: P3)

El cliente que no puede a la hora reservada, pero sí otro día, cambia su cita de hueco sin perderla.

**Why this priority**: es una comodidad. Cancelar y volver a reservar cubre la misma necesidad con un paso más, así que se puede entregar después sin bloquear nada.

**Independent Test**: crear una cita, reprogramarla a otro hueco libre del mismo servicio, y comprobar que el hueco antiguo queda libre y el nuevo ocupado, y que la cita sigue siendo la misma (mismo enlace).

**Acceptance Scenarios**:

1. **Given** una cita confirmada dentro de plazo, **When** el cliente pulsa reprogramar, **Then** ve los huecos disponibles para **el mismo servicio**, sin poder cambiar de servicio.
2. **Given** el cliente ha elegido un hueco nuevo válido, **When** confirma el cambio, **Then** la cita pasa a la hora nueva, conserva el mismo enlace, y el hueco antiguo queda libre de inmediato.
3. **Given** el hueco nuevo ha sido ocupado por otra persona entre la selección y la confirmación, **When** se intenta el cambio, **Then** la cita original **queda intacta en su hora original** y se avisa al cliente de que ese hueco ya no está, ofreciéndole los que sí quedan.
4. **Given** el cliente está eligiendo hueco nuevo, **When** se muestra la lista, **Then** su propia hora actual aparece marcada como "tu hora actual" y no se cuenta como ocupada.
5. **Given** el cliente selecciona su propia hora actual, **When** confirma, **Then** no se produce ningún cambio y se le informa de que ya tiene esa hora reservada.
6. **Given** una cita a menos de 24 horas de su inicio o ya cancelada, **When** se intenta reprogramar, **Then** la acción no está disponible.

---

### Edge Cases

- **Día sin ningún hueco libre**: se muestra un mensaje explícito de "sin disponibilidad este día" con acceso directo al siguiente día que sí tenga huecos para ese servicio, dentro del horizonte de 60 días.
- **Formulario abandonado y retomado más tarde**: el hueco **no** se reserva ni se bloquea mientras se rellena el formulario. Si al confirmar ya no está libre, se rechaza la reserva y se ofrecen los huecos restantes de ese día.
- **Confirmación justo al expirar la antelación de 2 horas**: la comprobación se hace contra el reloj del servidor en el instante de confirmar. Si el inicio ya está a menos de 2 horas, se rechaza con un mensaje que lo explica y se recarga la disponibilidad.
- **Enlace inexistente, malformado o de una cita ya borrada**: mismo mensaje neutro en los tres casos, sin distinguirlos, para no confirmar ni desmentir la existencia de ninguna cita.
- **Prueba masiva de enlaces al azar desde una misma IP**: al superarse el límite, la respuesta es idéntica a la de un enlace inexistente. Quien prueba no puede distinguir "no existe" de "te he cortado", ni deducir si alguno de los enlaces probados era válido.
- **Ráfaga de reservas desde una misma IP**: al superarse el límite se rechazan las siguientes con un mensaje que explica la situación y ofrece el teléfono del salón. Un cliente legítimo que reserva una vez nunca llega a ese límite.
- **Varios clientes legítimos tras una misma IP** (wifi del centro comercial, NAT de una operadora móvil): el límite debe estar holgado por encima del uso legítimo previsible; si aun así se alcanza, el cliente recibe el mensaje accionable de FR-039 y puede reservar por teléfono.
- **Enlace de una cita ya pasada**: se muestra en sólo lectura, como completada, mientras conserve sus datos personales.
- **Enlace de una cita cuyos datos personales ya se han borrado a los 12 meses**: deja de resolver y responde con el mismo mensaje neutro que un enlace inexistente, sin mencionar la retención ni insinuar que ahí hubo una cita. La cita permanece en el histórico de ocupación, ya anonimizada.
- **Reprogramar al hueco de la propia cita**: ese hueco se ofrece marcado como hora actual; seleccionarlo no cambia nada y se informa al cliente.
- **Salón cerrado todo el día elegido** (festivo, ausencia o día de cierre semanal): se muestra como día cerrado, no como día lleno, y se ofrece el siguiente día abierto.
- **Día con cierre intermedio** (por ejemplo, 10:00–14:00 y 16:00–20:00): no se ofrece ningún inicio dentro del cierre, y ningún servicio puede empezar en un tramo y terminar en el siguiente. Un servicio de 90 minutos no se ofrece a las 13:00 aunque las 13:00 estén dentro de un tramo abierto.
- **Teléfono o email con formato inválido**: se bloquea el envío y se señala el campo concreto con instrucción de corrección. No se pierde el resto de lo introducido.
- **Reservar, cancelar y volver a reservar el mismo hueco**: permitido. La cita cancelada permanece cancelada y se crea una cita nueva, con su propio enlace.
- **Dos pestañas del mismo cliente confirmando el mismo hueco**: sólo una reserva prospera; la segunda recibe el mismo rechazo por hueco ocupado que recibiría un tercero.
- **Reloj o zona horaria del dispositivo distintos de los del salón**: todas las horas mostradas y todas las decisiones de plazo son las del salón, indicándolo en pantalla. El reloj del dispositivo nunca decide.
- **Fecha muy lejana**: no se puede navegar ni reservar más allá de 60 días desde hoy; al llegar al límite se indica que la agenda aún no está abierta para fechas posteriores. El último rango se recorta al día 60 en lugar de completar los 14 días.
- **Rango entero sin disponibilidad**: los 14 días aparecen marcados como cerrados o llenos, y se ofrece el salto directo al siguiente día con huecos (FR-006) aunque esté en un rango posterior.
- **Cambio de servicio con un día ya seleccionado**: el estado de los 14 días se recalcula para el servicio nuevo, porque un día lleno para "Color" puede tener huecos para "Corte". Se conserva el día seleccionado si sigue teniendo huecos; si no, se marca como lleno y se ofrece el salto al siguiente con disponibilidad.
- **Cambio de horario de verano/invierno dentro del horizonte de 60 días**: las horas mostradas son siempre la hora local del salón en esa fecha; la duración del servicio se respeta en minutos reales.
- **El catálogo de servicios cambia entre la reserva y la consulta**: la cita conserva el nombre, la duración y el precio del servicio tal como estaban al reservar.
- **El horario o las ausencias cambian y dejan una cita confirmada fuera de horario**: la cita permanece confirmada e intacta, y su cliente la sigue viendo con normalidad en su enlace. Sólo se deja de ofrecer disponibilidad nueva en la franja retirada. Nadie avisa automáticamente al cliente: es una limitación conocida de v1 y la resuelve la dueña llamando.
- **Se retira un tramo de apertura que contiene una cita confirmada**: la disponibilidad de ese día deja de ofrecer ese tramo, pero la cita sigue ocupando su franja a efectos de solape, de modo que ningún otro cliente puede reservar encima de ella si el tramo se restaura después.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Catálogo y disponibilidad

- **FR-001**: El sistema MUST mostrar la lista de servicios que ofrece el salón, cada uno con su nombre, su duración y su precio.
- **FR-002**: El sistema MUST tratar el salón como un único recurso reservable: en un momento dado sólo puede haber una cita en curso.
- **FR-003**: El sistema MUST mostrar, para un servicio y un día elegidos, únicamente los huecos reservables en ese momento, es decir, aquellos que cumplen a la vez las cuatro condiciones: (a) el servicio empieza y termina dentro de **un mismo tramo de apertura** de ese día, sin cruzar ningún cierre intermedio, (b) el servicio completo no solapa ninguna cita confirmada, (c) el inicio respeta la antelación mínima de reserva, y (d) el inicio cae dentro del horizonte máximo de reserva.
- **FR-004**: El sistema MUST generar los inicios candidatos en una rejilla de **30 minutos** anclada a la hora en punto (10:00, 10:30, 11:00…), recorriendo cada tramo de apertura del día por separado.
- **FR-005**: El sistema MUST presentar los días en rangos de **14 días** y MUST marcar cada día del rango, para el servicio elegido, como una de estas tres cosas: **cerrado**, **lleno** (abierto pero sin ningún hueco que admita ese servicio) o **con huecos**. El primer rango empieza en el día de hoy.
- **FR-005a**: El sistema MUST mostrar los huecos del día seleccionado junto al rango, de modo que el cliente vea a la vez qué días tienen disponibilidad y a qué horas del día elegido puede empezar.
- **FR-005b**: El sistema MUST permitir avanzar y retroceder por rangos de 14 días hasta el horizonte de 60 días, sin permitir retroceder antes de hoy ni avanzar más allá del horizonte, y MUST calcular el estado de los días de un rango en una sola consulta de disponibilidad, no una por día.
- **FR-006**: El sistema MUST ofrecer al cliente un salto directo al siguiente día con disponibilidad para el servicio elegido cuando el día consultado no tenga ninguna, incluso si ese día cae en un rango posterior al que se está viendo.
- **FR-007**: El sistema MUST tratar el horario de apertura, los días de cierre, los festivos y las ausencias como datos de configuración precargados, no editables desde la app en esta versión.
- **FR-007a**: El sistema MUST admitir que el horario de apertura de un día conste de **uno o varios tramos** (por ejemplo, 10:00–14:00 y 16:00–20:00) y MUST tratar el intervalo entre tramos como tiempo no reservable, indistinguible a efectos de disponibilidad de un día cerrado.
- **FR-007b**: El sistema MUST mantener intacta y en estado confirmado toda cita existente cuando un cambio de la configuración precargada deje su franja fuera del horario de apertura. El cambio de configuración MUST afectar únicamente a la disponibilidad que se ofrece a partir de ese momento, y MUST NOT cancelar, mover ni ocultar ninguna cita ya confirmada.
- **FR-007c**: El sistema MUST seguir mostrando al cliente, en el enlace de su cita, los datos de esa cita tal como se confirmó, aunque su franja haya dejado de ser horario de apertura.

#### Reserva

- **FR-008**: El sistema MUST pedir exactamente tres datos del cliente para confirmar una reserva: nombre, teléfono y email. Los tres son obligatorios. No se solicita ni se almacena ningún otro dato personal.
- **FR-009**: El sistema MUST validar en servidor el formato del teléfono y del email antes de aceptar la reserva, y MUST señalar el campo concreto a corregir cuando falle.
- **FR-010**: El sistema MUST mostrar al cliente, antes de confirmar, el servicio, la fecha, la hora de inicio, la duración y el plazo de cancelación que aplicará a esa cita.
- **FR-011**: El sistema MUST revalidar en servidor, en el instante de confirmar, que el hueco elegido sigue cumpliendo todas las condiciones de FR-003, y MUST rechazar la reserva si no las cumple.
- **FR-012**: El sistema MUST garantizar que dos confirmaciones simultáneas sobre huecos que se solapan no puedan prosperar ambas: exactamente una tiene éxito y la otra recibe un rechazo explicativo con la disponibilidad actualizada.
- **FR-013**: El sistema MUST rechazar una reserva cuando el mismo teléfono o el mismo email ya tenga **3 citas confirmadas futuras**, explicando el límite al cliente.
- **FR-014**: El sistema MUST mostrar, tras confirmar, una pantalla de confirmación con servicio, fecha, hora de inicio, duración, plazo de cancelación y datos del salón (nombre, dirección y teléfono).
- **FR-015**: El sistema MUST mostrar en esa pantalla el enlace de gestión de la cita, con un aviso destacado de que es la única vía de acceso posterior y de que debe guardarlo.
- **FR-016**: El sistema MUST conservar en la cita el nombre, la duración y el precio del servicio vigentes en el momento de reservar, de forma que cambios posteriores del catálogo no alteren citas ya confirmadas.

#### Acceso a la cita

- **FR-017**: El sistema MUST dar a cada cita un identificador de acceso propio que funciona como credencial de esa cita y de ninguna otra, generado con un generador criptográficamente seguro y con **al menos 128 bits de entropía**. El identificador MUST NOT derivarse de datos de la cita ni del cliente, ni contener ninguna parte predecible o secuencial.
- **FR-018**: El sistema MUST mostrar, al abrir ese enlace, únicamente los datos de esa cita. Nunca otras citas, otros clientes ni la agenda del salón.
- **FR-019**: El sistema MUST responder con un mensaje neutro e indistinguible en todos estos casos, sin diferenciarlos entre sí: el enlace no corresponde a ninguna cita, está malformado, apunta a una cita borrada, o apunta a una cita cuyos datos personales ya se han borrado por retención (FR-035).
- **FR-020**: El sistema MUST mantener el enlace operativo, en sólo lectura, después de que la cita haya pasado, hasta el borrado de sus datos personales. A partir de ese borrado el identificador MUST dejar de resolver, respondiendo con el mensaje neutro de FR-019.

#### Cancelación y reprogramación

- **FR-021**: El sistema MUST permitir al cliente cancelar su propia cita mientras falten más de 24 horas para su inicio.
- **FR-022**: El sistema MUST pedir confirmación explícita antes de ejecutar cualquier cancelación.
- **FR-023**: El sistema MUST liberar el hueco de una cita cancelada de forma inmediata, quedando disponible para cualquier otro cliente.
- **FR-024**: El sistema MUST permitir al cliente reprogramar su cita a otro hueco disponible **del mismo servicio**, mientras falten más de 24 horas para su inicio.
- **FR-025**: El sistema MUST ejecutar la reprogramación de forma atómica: si el hueco nuevo no se puede tomar, la cita original permanece intacta en su hora original y se informa al cliente.
- **FR-026**: El sistema MUST conservar el mismo enlace de acceso tras una reprogramación.
- **FR-027**: El sistema MUST ofrecer, durante la reprogramación, el propio hueco actual de la cita marcado como tal, sin contarlo como ocupado.
- **FR-028**: El sistema MUST ocultar o deshabilitar las acciones de cancelar y reprogramar cuando no procedan, explicando el motivo e indicando el teléfono del salón como alternativa.
- **FR-029**: El sistema MUST rechazar cualquier intento de cancelar, reprogramar o reactivar una cita cancelada, o de modificar una cita ya pasada.

#### Estado, tiempo y datos

- **FR-030**: El sistema MUST registrar para cada cita uno de estos dos estados persistidos: **confirmada** o **cancelada**.
- **FR-031**: El sistema MUST presentar como **completada** toda cita confirmada cuya hora de fin ya haya pasado, derivándolo del reloj sin requerir ninguna acción ni proceso en segundo plano.
- **FR-032**: El sistema MUST tomar todas las decisiones temporales —antelación mínima, plazo de cancelación, horizonte y cita pasada— contra el reloj del servidor y la zona horaria del salón, nunca contra el reloj del dispositivo del cliente.
- **FR-033**: El sistema MUST mostrar todas las horas en la hora local del salón e indicarlo en pantalla.
- **FR-034**: El sistema MUST validar en servidor toda entrada procedente del cliente, incluidas las que la interfaz ya haya validado.
- **FR-035**: El sistema MUST borrar el nombre, el teléfono y el email de una cita transcurridos **12 meses** desde su fecha, incluyendo copias derivadas y registros auxiliares, y MUST inutilizar su identificador de acceso en el mismo acto.
- **FR-035a**: El sistema MUST conservar, tras ese borrado, el resto de la cita —servicio, horas de inicio y fin, estado y momentos de creación y cancelación—, de forma que el histórico de ocupación del salón permanezca completo y sin datos personales.
- **FR-036**: El sistema MUST NOT escribir nombre, teléfono ni email en logs, trazas de error ni eventos de analítica. Las trazas referencian identificadores internos.
- **FR-037**: El sistema MUST mostrar estado de carga, éxito o error en toda acción, y todo mensaje de error MUST indicar qué hacer a continuación.
- **FR-038**: El sistema MUST limitar por dirección IP el número de aperturas de enlaces de gestión en una ventana de tiempo, y MUST responder al exceso de forma indistinguible de un enlace inexistente (el mensaje neutro de FR-019), sin revelar que se ha alcanzado un límite ni si el enlace probado era válido.
- **FR-039**: El sistema MUST limitar por dirección IP el número de confirmaciones de reserva en una ventana de tiempo, y MUST rechazar el exceso con un mensaje que indique al cliente legítimo qué hacer a continuación, incluido el teléfono del salón.
- **FR-040**: El sistema MUST conservar la dirección IP usada para los límites de FR-038 y FR-039 sólo durante la ventana del propio límite, en forma no reversible, y MUST NOT asociarla a ninguna cita ni a ningún dato de contacto. Los rechazos por límite se contabilizan de forma agregada, sin identificar al solicitante.

### Reglas de negocio

- **BR-001 — Sin doble reserva**: dos citas confirmadas nunca pueden solaparse en el tiempo, porque sólo hay una peluquera. *Ejemplo*: con una cita confirmada de 10:00 a 11:30, una petición de las 11:00 para cualquier servicio se rechaza, aunque el cliente haya llegado a ese hueco desde una página desactualizada.
- **BR-002 — El hueco debe dar cabida al servicio completo dentro de un solo tramo**: un hueco sólo se ofrece si el servicio termina dentro del mismo tramo de apertura en el que empieza y antes de la siguiente cita. Un servicio nunca cruza un cierre intermedio. *Ejemplo*: el salón cierra a las 20:00 y el color dura 90 minutos; las 19:00 no se ofrecen para color, pero sí para un corte de 30 minutos. *Ejemplo*: con tramos de 10:00–14:00 y 16:00–20:00, las 13:00 no se ofrecen para color (terminaría a las 14:30, ya cerrado), pero sí para un corte.
- **BR-003 — Antelación mínima de reserva: 2 horas**. Ninguna cita puede empezar antes de ahora + 2h. *Ejemplo*: a las 09:30 no se ofrecen los huecos de las 10:00 ni de las 11:00; el primero que se ofrece ese día es el de las 11:30.
- **BR-004 — Plazo de cancelación: 24 horas antes del inicio**. Pasado ese plazo el cliente ya no puede cancelar ni reprogramar online. *Ejemplo*: una cita del viernes a las 17:00 se puede cancelar hasta el jueves a las 17:00; el jueves a las 18:00 la opción ya no está y se indica al cliente que llame al salón.
- **BR-005 — Cancelar libera el hueco de inmediato**: una vez cancelada, esa franja queda disponible para cualquier otro cliente al momento.
- **BR-006 — Reprogramar es atómico**: el cliente nunca acaba sin cita y sin hueco. Si el nuevo hueco no se puede tomar, la cita original queda intacta.
- **BR-007 — Una cita cancelada es terminal**: no se puede cancelar, reprogramar ni reactivar.
- **BR-008 — Un servicio por cita** en esta versión.
- **BR-009 — El enlace da acceso sólo a esa cita**: nunca lista otras citas, otros clientes ni la agenda del salón.
- **BR-010 — Las citas pasadas son de sólo lectura**: se pueden consultar pero no modificar, y dejan de ser consultables cuando sus datos personales se borran a los 12 meses (BR-018).
- **BR-011 — Horizonte máximo de reserva: 60 días** desde hoy.
- **BR-011b — Los días se presentan en rangos de 14**, empezando hoy, cada uno marcado como cerrado, lleno o con huecos para el servicio elegido. El avance por rangos se detiene en el horizonte de 60 días y el retroceso se detiene en hoy.
- **BR-012 — Rejilla de inicios: 30 minutos**, anclada a la hora en punto.
- **BR-013 — Sin tiempo de margen entre citas**: una cita puede empezar exactamente cuando termina la anterior.
- **BR-014 — Máximo 3 citas confirmadas futuras** por teléfono o por email.
- **BR-015 — La hora del salón manda**: toda decisión temporal se toma en la zona horaria del salón contra el reloj del servidor.
- **BR-016 — El enlace es inadivinable por construcción**: la credencial de acceso tiene al menos 128 bits de entropía, de modo que probar enlaces al azar no es viable aunque no hubiera ningún otro freno. *Ejemplo*: conocer el enlace de una cita no aporta ninguna información para deducir el de otra.
- **BR-016b — La cita confirmada prevalece sobre un cambio de configuración**: si el horario, un festivo o una ausencia se recargan y dejan una cita confirmada fuera de horario, la cita no se toca. El cambio sólo afecta a la disponibilidad futura. *Ejemplo*: la dueña añade una ausencia el jueves que ya tenía dos citas; esas dos citas siguen confirmadas y visibles para sus clientes, y el jueves deja de ofrecer huecos nuevos. Avisar a esos dos clientes es trabajo de la dueña por teléfono, fuera de v1.
- **BR-017 — Límite de peticiones por IP**: tanto abrir enlaces de gestión como confirmar reservas están limitados por IP en una ventana de tiempo. El exceso al abrir enlaces responde exactamente igual que un enlace inexistente; el exceso al reservar se explica al cliente y le remite al teléfono del salón.
- **BR-018 — El borrado a 12 meses anonimiza, no elimina**: transcurridos 12 meses desde la fecha de la cita se borran nombre, teléfono y email y se inutiliza el enlace; el resto de la cita —servicio, horas, estado— se conserva como histórico de ocupación. Abrir ese enlace es indistinguible de abrir uno que nunca existió. *Ejemplo*: un cliente que guardó el enlace de su corte de hace 13 meses recibe el mismo mensaje neutro que quien teclea un enlace al azar.

### Key Entities

- **Salón**: el establecimiento único de esta instancia. Nombre, dirección, teléfono, zona horaria, horario de apertura semanal y días de cierre (festivos y ausencias). El horario de cada día de la semana es una **lista de tramos de apertura** (inicio y fin); un día puede tener un solo tramo, varios —con cierre de mediodía— o ninguno, que equivale a día cerrado. Dato de configuración precargado, no editable desde la app en v1.
- **Servicio**: una prestación reservable del catálogo. Nombre, duración en minutos y precio. Dato de configuración precargado. El precio es informativo: v1 no cobra nada.
- **Cita**: la reserva de un cliente. Referencia al servicio, hora de inicio, hora de fin derivada de la duración, estado persistido (confirmada o cancelada), credencial de acceso, datos de contacto del cliente, momento de creación y momento de cancelación si la hubo. A los 12 meses pierde los datos de contacto y la credencial y queda como registro anónimo de ocupación (BR-018). Es la única entidad que esta feature crea o modifica.
- **Datos de contacto del cliente**: nombre, teléfono y email, asociados a una cita concreta. **No forman un perfil de cliente**: no hay cuentas, no se vinculan entre citas y no se reutilizan de una reserva a otra. Se borran a los 12 meses de la fecha de la cita, junto con la credencial de acceso, sin que desaparezca la cita.
- **Hueco**: un inicio candidato para un servicio en un día. Es un concepto **derivado** de los tramos de apertura, la duración del servicio, las citas confirmadas y el reloj. No se almacena y no se reserva ni bloquea temporalmente.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un cliente nuevo completa una reserva en **menos de 90 segundos** desde que abre la página de reservas, en un móvil.
- **SC-002**: **Cero** pares de citas confirmadas solapadas en el tiempo, verificable sobre la agenda completa en cualquier momento.
- **SC-003**: **El 100%** de los huecos mostrados son reservables en el instante en que se muestran; los únicos rechazos al confirmar son por ocupación sobrevenida entre la carga de la pantalla y la confirmación.
- **SC-004**: La respuesta percibida está **por debajo de 2 segundos** en cualquier acción del flujo de reserva, medida en un móvil de gama media sobre 4G.
- **SC-005**: El tiempo de consulta de disponibilidad **no se degrada** al crecer el histórico: con 10.000 citas pasadas el tiempo es equivalente al de la agenda vacía. El cálculo del estado de un rango de 14 días se resuelve en **una sola consulta**, con independencia de cuántos días del rango estén abiertos o llenos.
- **SC-006**: **El 95%** de los clientes completan la reserva a la primera, sin ayuda y sin abandonar el flujo.
- **SC-007**: Un hueco liberado por una cancelación vuelve a aparecer como disponible en **la siguiente consulta** de cualquier otro cliente.
- **SC-008**: **Cero** reservas hechas por este flujo que la dueña tenga que corregir a mano por un fallo del propio flujo —hueco fantasma, solape o dato mal capturado—. Quedan fuera de esta cuenta las citas que la dueña decide reubicar tras cambiar ella misma el horario o añadir una ausencia (BR-016b).
- **SC-009**: Al menos el **70%** de las reservas del salón entran por este flujo durante el primer mes de uso, reduciendo en la misma proporción las llamadas de reserva.
- **SC-010**: Todas las pantallas cumplen **WCAG 2.2 nivel AA**, son navegables íntegramente por teclado con foco visible, y ningún significado depende sólo del color.
- **SC-011**: El flujo completo —elegir servicio, elegir día, elegir hueco, rellenar y confirmar— se puede ejecutar **con una sola mano** en una pantalla de 360 px de ancho, sin desplazamiento horizontal de la página. El rango de 14 días cabe en ese ancho manteniendo legible el estado de cada día y un área táctil suficiente.
- **SC-012**: **El 100%** de los mensajes de error indican una acción concreta a realizar a continuación.

---

## Assumptions

Decisiones tomadas para cerrar huecos de la descripción de negocio. Las cuatro primeras resuelven puntos que la constitución marcaba como `[TBD]`.

1. **Acceso sin cuenta mediante credencial en el enlace**: el identificador aleatorio de la cita, de al menos 128 bits de entropía, **es** la credencial de autenticación y autorización de esa cita (FR-017, BR-016). Así se satisface el Principio V —"autenticación y autorización obligatorias", "un cliente sólo puede leer o modificar sus propias citas"— sin cuentas ni login. Riesgo aceptado conscientemente: quien obtenga el enlace puede ver y modificar esa cita.
2. **Parámetros temporales del dominio** (`[TBD]` en la constitución): antelación mínima 2 h, plazo de cancelación 24 h, horizonte 60 días presentado en rangos de 14 días, rejilla de 30 minutos, sin margen entre citas.
3. **Retención** (`[TBD]` en la constitución): los datos personales de una cita se borran a los 12 meses de la fecha de la cita. El borrado anonimiza la cita en lugar de eliminarla: se conservan servicio, horas y estado como histórico de ocupación, y el enlace deja de resolver (BR-018). Se asume que 12 meses cubren de sobra la necesidad del cliente de consultar una cita pasada.
4. **Idioma** (`[TBD]` en la constitución): interfaz únicamente en español de España. Sin multiidioma.
5. **Sin mensajería saliente**: v1 no envía SMS ni email, **ni siquiera la confirmación**. En consecuencia no hay consentimiento de canal que recoger ni registro de auditoría de envíos que mantener, y el Principio IV no aplica a esta feature. El teléfono y el email se recogen para que el salón pueda contactar al cliente por vías ajenas a la app y para habilitar la mensajería en una feature posterior.
6. **La pantalla de confirmación es la única entrega del enlace**: se asume que el cliente lo guarda (marcador, captura, copiar-pegar). Es una limitación conocida y aceptada de v1, consecuencia directa de la asunción 5.
7. **Límite antiabuso**: 3 citas confirmadas futuras por teléfono o email (BR-014), reforzado con límites de peticiones por IP sobre la apertura de enlaces y sobre la confirmación de reservas (BR-017). Se asume que cualquier cliente legítimo cabe en ambos márgenes —reserva una vez y abre su enlace unas pocas veces— y que el riesgo residual de reservas falsas con datos de contacto distintos lo absorbe la dueña por teléfono. Los valores concretos de cada límite y de su ventana se fijan en `/speckit-plan`.
8. **Formato de los datos de contacto**: teléfono español, móvil o fijo, con prefijo internacional opcional; email validado sintácticamente. Ninguno de los dos se verifica como existente, porque v1 no envía nada.
9. **Zona horaria del salón**: Europe/Madrid, con sus cambios de horario estacional. Es configuración del salón, no una constante del sistema.
10. **Configuración precargada disponible**: catálogo de servicios, horario de apertura por tramos, festivos y ausencias existen y cubren los 60 días del horizonte antes de que la feature se ponga en uso. Cómo se cargan, y cómo se recargan después, queda fuera de esta feature. Se asume que una recarga puede entrar en conflicto con citas ya confirmadas y que, cuando ocurra, la cita gana (BR-016b) y la dueña resuelve el conflicto por teléfono.
11. **Un salón por instancia**: no hay identificador de salón en ningún flujo ni pantalla.
12. **El precio es informativo**: se muestra en el catálogo y se conserva en la cita, pero v1 no cobra, ni reserva importe, ni aplica política de no-shows.

---

## Out of Scope

Esta versión NO incluye:

- Multi-salón ni directorio de salones: una instancia independiente por dueña.
- Más de un profesional ni más de un sillón. Elegir profesional no forma parte del flujo.
- Agenda de la dueña, login de la dueña, roles y permisos.
- Pantallas de configuración del salón: catálogo de servicios, horario de apertura, festivos y ausencias son datos precargados, no editables en la app.
- Resolución de conflictos entre un cambio de configuración y citas ya confirmadas: no hay detección, ni aviso al cliente, ni cancelación en cascada, ni reubicación automática. La cita prevalece (BR-016b) y la dueña llama.
- Recordatorios y cualquier mensajería saliente por SMS o email, **incluido el mensaje de confirmación**, y con ella todo el aparato de consentimiento por canal, baja y auditoría de envíos del Principio IV.
- Cuentas de cliente, login, registro, historial de reservas y preferencias guardadas.
- Varios servicios en una misma cita.
- Pagos, señales, cobro de precios, política de no-shows o penalizaciones.
- Listas de espera, citas recurrentes y reservas de grupo.
- Informes, analítica y estadísticas de ocupación.
- Interfaz multiidioma.
- **Pantalla** de borrado de datos a petición del cliente (exigencia constitucional del Principio III, pero feature aparte). Sí entra aquí la **capacidad**: un comando de operación permite a la dueña atender una petición de borrado desde el día uno, borrando los datos personales de una cita concreta con el mismo efecto que la purga automática. Lo que queda fuera es que el cliente pueda pedirlo por sí mismo desde la app. El borrado automático a los 12 meses de FR-035 también entra aquí.

---

## Dependencies

- **Configuración del salón precargada**: nombre, dirección, teléfono, zona horaria, horario de apertura semanal expresado como tramos por día, festivos y ausencias cubriendo 60 días.
- **Catálogo de servicios precargado**: nombre, duración y precio de cada servicio.
- **Reloj del servidor fiable**: todas las reglas temporales (BR-003, BR-004, BR-011, FR-031) dependen de él.
