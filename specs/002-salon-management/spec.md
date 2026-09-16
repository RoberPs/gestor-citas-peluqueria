# Feature Specification: Gestión del salón (cara a la dueña) v1

**Feature Branch**: `002-salon-management`

**Created**: 2026-09-15

**Status**: Draft

**Input**: Especificación de negocio aportada por la dueña del producto: acceso privado, agenda del día, gestión manual de citas, bloqueo de huecos y edición de horario, ausencias, catálogo de servicios y parámetros de reserva.

---

## Contexto de negocio

Hoy el salón funciona con configuración precargada. El horario de apertura, los cierres, el catálogo de servicios y los parámetros de reserva se fijan al arrancar la instancia y sólo cambian tocando datos de arranque. La dueña no ve su agenda dentro de la app, no puede bloquear un hueco para comer y no tiene forma de apuntar a quien entra por la puerta sin cita.

Esta feature le da un acceso privado y las pantallas para llevar el salón día a día: ver la agenda, gestionar citas a mano y editar la configuración que lee el flujo de reserva de clientes.

**Lo que cambia respecto a la situación actual**: la configuración deja de ser un dato de arranque estático y pasa a ser algo que la dueña edita. El flujo de reserva de la feature `001-client-appointment-booking` sigue leyendo exactamente los mismos conceptos, pero ahora reflejan lo que la dueña acaba de guardar, no lo que se cargó al desplegar.

**Lo que no cambia**: la agenda sigue siendo **una única línea temporal** de un solo sillón, el cliente sigue sin tener cuenta, y v1 sigue sin enviar SMS ni email a nadie.

### Usuarios

- **Dueña / peluquera** (usuaria directa y única): la única cuenta de personal del sistema. Inicia sesión con usuario y contraseña. No es técnica, usa la app entre cliente y cliente, de pie, a menudo en tablet o móvil dentro del salón. Hay un solo rol: no existe jerarquía de personal que modelar.
- **Cliente** (afectado, no usuario): nunca ve esta feature. Sus reservas aparecen en la agenda de la dueña, y lo que la dueña configura aquí determina qué huecos se le ofrecen. Un cambio hecho en estas pantallas puede afectar a una cita suya sin que él se entere: v1 no le notifica nada.

---

## Clarifications

### Session 2026-09-15

- Q: El borrador permitía "mantener ambas" al forzar un conflicto, pero el sistema garantiza hoy que dos citas confirmadas no puedan solaparse en ningún caso. ¿Debe poder la dueña romper esa garantía? → A: No, nunca. El aviso de conflicto obliga a resolverlo (cancelar o mover lo que estorba); la garantía de no-superposición se mantiene intacta y "mantener ambas" desaparece del alcance.
- Q: ¿Qué datos de cliente exige una cita creada a mano? → A: Nombre y teléfono obligatorios, email opcional. El teléfono es la vía con la que la dueña avisa de un cambio, porque v1 no envía nada.
- Q: ¿Cómo nace y cómo se recupera la contraseña de la dueña? → A: La credencial inicial se aprovisiona fuera de la app; la dueña puede cambiarla estando dentro; no hay flujo de recuperación en v1. Si la olvida, se reaprovisiona por el mismo medio.
- Q: ¿Bloqueo intradía y ausencia de varios días son el mismo concepto? → A: Uno solo. Un **periodo no disponible** con inicio y fin arbitrarios, que puede durar cuarenta y cinco minutos, un día o tres semanas. Sustituye al cierre de día completo actual.
- Q: ¿Qué parámetros del dominio pasan a ser editables? → A: Antelación mínima de reserva y plazo límite de cancelación. El horizonte de 60 días y el límite de 3 citas futuras por contacto siguen siendo constantes del sistema.
- Q: ¿De qué reglas del dominio queda exenta la dueña al gestionar citas a mano? → A: De la antelación mínima, del horizonte de reserva, del plazo de cancelación y del horario de apertura. **No** queda exenta del límite de 3 citas futuras por contacto.
- Q: ¿Hasta dónde llega la agenda en v1? → A: Vista de un solo día, navegable a cualquier fecha pasada o futura. Sin vista de semana ni de mes.
- Q: ¿Qué significa eliminar un servicio y puede el catálogo quedarse vacío? → A: Eliminar significa **retirar**: deja de ofrecerse, las citas existentes quedan intactas y se puede volver a activar. El sistema impide retirar el último servicio activo.

### Session 2026-09-16

- Q: Al superar el límite de intentos fallidos, ¿el bloqueo se aplica a la cuenta o al origen del intento (IP)? → A: A la cuenta entera. Cualquier origen que falle repetidamente bloquea el acceso para todos los orígenes durante el periodo definido; no se almacena ninguna dirección IP.
- Q: Un periodo no disponible que se solapa sólo parcialmente con una cita confirmada, ¿exige el mismo aviso de conflicto que un solape total? → A: Sí. Cualquier solape, por mínimo que sea, dispara el aviso de conflicto y exige confirmación explícita antes de guardar el bloqueo.
- Q: Una cita ya empezada pero no terminada, ¿es "pasada" (sólo lectura) o sigue siendo movible/cancelable? → A: Editable hasta que termina. El corte de "pasado" es la hora de fin de la cita; mientras está en curso, la dueña puede moverla o cancelarla igual que cualquier cita futura.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entrar en la gestión del salón (Priority: P1)

La dueña abre la app en su tablet, escribe su usuario y su contraseña, y accede a las pantallas de gestión. Quien no tenga esa credencial no ve nada: ni agenda, ni horario, ni catálogo, ni teléfonos de clientes.

**Why this priority**: sin esto, cualquier persona con la dirección vería los datos de contacto de todos los clientes del salón y podría cancelarles la cita. Ninguna otra historia puede existir antes que ésta.

**Independent Test**: se prueba entera con dos navegaciones —una con credencial válida y otra sin ella— y entrega valor por sí sola: la frontera de acceso queda establecida.

**Acceptance Scenarios**:

1. **Given** una dueña con credencial válida, **When** la introduce en el formulario de acceso, **Then** entra en la gestión del salón y su sesión se mantiene mientras siga usándola.
2. **Given** una persona sin sesión, **When** abre directamente cualquier dirección de gestión, **Then** aterriza en el formulario de acceso sin haber visto ningún dato del salón ni de sus clientes.
3. **Given** una contraseña incorrecta, **When** se envía el formulario, **Then** el mensaje de error es el mismo que para un usuario inexistente y no revela cuál de los dos campos falló.
4. **Given** varios intentos fallidos seguidos, **When** se supera el límite, **Then** el acceso queda temporalmente bloqueado y la respuesta es indistinguible de un intento fallido normal.
5. **Given** una dueña con sesión iniciada, **When** cierra sesión, **Then** volver atrás en el navegador no muestra ningún dato de gestión.

---

### User Story 2 - Ver la agenda del día (Priority: P1)

La dueña abre la agenda y ve su día como una línea temporal: quién viene, a qué hora, para qué servicio, qué huecos tiene libres y qué ratos ha bloqueado. Puede moverse a mañana para preparar la jornada o a la semana pasada para comprobar algo.

**Why this priority**: es la pantalla que sustituye a la agenda de papel. Es lo primero que la dueña mira cada mañana y el punto de partida de todas las acciones sobre citas.

**Independent Test**: con citas ya existentes, se abre la agenda y se comprueba que las muestra correctamente y que la navegación entre días funciona. No necesita ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un día con tres citas confirmadas, **When** la dueña abre la agenda de ese día, **Then** ve las tres en orden cronológico con hora de inicio y fin, servicio, nombre y teléfono del cliente.
2. **Given** una cita reservada online y otra creada a mano el mismo día, **When** la dueña mira la agenda, **Then** distingue el origen de cada una por texto e icono, no sólo por color.
3. **Given** un periodo no disponible de 13:00 a 14:00, **When** la dueña mira ese día, **Then** el rato aparece marcado como no disponible en la línea temporal, con su motivo interno si lo puso.
4. **Given** la agenda de hoy abierta, **When** la dueña navega a otra fecha y después usa el atajo de hoy, **Then** vuelve al día actual.
5. **Given** un día ya pasado, **When** la dueña lo abre, **Then** puede consultarlo pero no crear, mover ni cancelar nada en él.
6. **Given** un día sin ninguna cita, **When** la dueña lo abre, **Then** ve un estado vacío que distingue "sin citas" de "cerrado".

---

### User Story 3 - Bloquear y liberar ratos (Priority: P1)

La dueña marca de 13:00 a 14:00 para comer, o toda la semana del 10 al 17 porque se va. Los clientes dejan de ver esos huecos. Cuando el plan cambia, lo elimina y los huecos vuelven.

**Why this priority**: es la causa más frecuente de hueco fantasma —el cliente reserva a una hora en la que la dueña no está— y hoy no tiene ninguna solución dentro de la app.

**Independent Test**: se crea un periodo no disponible y se comprueba en la página pública de reserva que esos huecos desaparecen; se elimina y se comprueba que vuelven.

**Acceptance Scenarios**:

1. **Given** un martes abierto de 10:00 a 20:00, **When** la dueña bloquea de 13:00 a 14:00, **Then** un cliente que busque un corte de 45 minutos no ve ningún inicio que se solape con ese rato.
2. **Given** ese mismo bloqueo, **When** la dueña lo elimina, **Then** los huecos de 13:00 a 14:00 vuelven a ofrecerse de inmediato.
3. **Given** unas vacaciones del 10 al 17, **When** la dueña las registra como un único periodo no disponible, **Then** ninguno de esos días ofrece huecos y el cliente los ve como cerrados, sin conocer el motivo.
4. **Given** un rato que ya contiene una cita confirmada, **When** la dueña intenta bloquearlo, **Then** el sistema nombra esa cita y exige una decisión explícita antes de guardar; la cita nunca se cancela sola.

---

### User Story 4 - Apuntar una cita a mano (Priority: P1)

Entra una clienta sin cita, o llama por teléfono. La dueña la apunta desde la agenda: elige servicio, hora, escribe nombre y teléfono, y la cita queda en la misma línea temporal que las reservas online.

**Why this priority**: mientras haya citas que sólo existen en la cabeza de la dueña, la agenda no es fiable y los huecos que se ofrecen online no son reales.

**Independent Test**: se crea una cita a mano en un hueco libre y se comprueba que aparece en la agenda y que ese hueco deja de ofrecerse en la página pública.

**Acceptance Scenarios**:

1. **Given** un hueco libre a las 16:00, **When** la dueña apunta ahí a una clienta con nombre, teléfono y servicio, **Then** la cita queda confirmada sin ningún aviso y el hueco deja de ofrecerse online.
2. **Given** el formulario de cita manual, **When** la dueña deja el email vacío, **Then** la cita se crea igualmente; si deja vacío el nombre o el teléfono, no.
3. **Given** que son las 16:40 y la antelación mínima para clientes es de dos horas, **When** la dueña apunta una cita para las 17:00, **Then** se crea sin objeción.
4. **Given** un salón que cierra a las 20:00, **When** la dueña apunta una cita a las 20:30, **Then** el sistema avisa de que está fuera del horario, la dueña confirma y la cita se crea.
5. **Given** una clienta que ya tiene tres citas futuras confirmadas, **When** la dueña intenta apuntarle una cuarta, **Then** el sistema lo impide, igual que se lo impediría a ella online.
6. **Given** una cita creada a mano, **When** se consulta después, **Then** sigue marcada como creada por la dueña y no tiene enlace de gestión para el cliente.

---

### User Story 5 - Mover o cancelar una cita desde la agenda (Priority: P1)

Una clienta llama para retrasar su cita media hora, o avisa de que no viene. La dueña lo resuelve desde la agenda, sin importar si la cita se reservó online o la apuntó ella.

**Why this priority**: es la otra mitad de tener la agenda dentro de la app. Sin esto, cualquier cambio de última hora vuelve al papel.

**Independent Test**: se mueve una cita existente a otra hora libre y se cancela otra, comprobando en ambos casos el efecto en la agenda y en la disponibilidad pública.

**Acceptance Scenarios**:

1. **Given** una cita online de las 11:00, **When** la dueña la mueve a las 11:30 y ese rato está libre, **Then** la cita queda a las 11:30, conserva su servicio, sus datos y su enlace de gestión, y las 11:00 vuelven a ofrecerse.
2. **Given** una cita que empieza dentro de una hora y un plazo de cancelación para clientes de 24 horas, **When** la dueña la cancela, **Then** se cancela igualmente.
3. **Given** cualquier cancelación, **When** la dueña la solicita, **Then** el sistema pide una confirmación explícita antes de aplicarla.
4. **Given** una cita ya cancelada, **When** la dueña la abre, **Then** no puede reactivarla ni moverla: la cancelación es definitiva.
5. **Given** una cita reservada online que la dueña acaba de cancelar o mover, **When** se aplica el cambio, **Then** la pantalla le recuerda que el cliente no recibe ningún aviso y le muestra el teléfono para llamarle.

---

### User Story 6 - Resolver un conflicto a la vista (Priority: P1)

La dueña intenta poner una cita encima de otra o dentro de un rato bloqueado. En lugar de fallar con un error seco o de machacar lo que había, el sistema le enseña exactamente qué estorba y le deja decidir.

**Why this priority**: es lo que separa una herramienta que la dueña usa de una que abandona. Un error genérico la devuelve al papel; una resolución silenciosa le borra una cita sin que se entere.

**Independent Test**: se intenta crear una cita solapada y se comprueba que el aviso nombra la cita en conflicto, que rechazarlo no cambia nada y que resolverlo aplica ambos cambios juntos.

**Acceptance Scenarios**:

1. **Given** una reserva online de 15:45 a 16:30 a nombre de Ana, **When** la dueña intenta apuntar otra cita a las 16:00, **Then** el aviso nombra la cita de Ana con su hora y su servicio antes de tocar nada.
2. **Given** ese aviso en pantalla, **When** la dueña lo rechaza, **Then** ni la cita existente ni el intento nuevo cambian en absoluto.
3. **Given** ese aviso en pantalla, **When** la dueña elige cancelar la cita en conflicto y confirmar la nueva, **Then** ambas cosas ocurren juntas: o se aplican las dos, o no se aplica ninguna.
4. **Given** un conflicto con un rato bloqueado en vez de con una cita, **When** el aviso aparece, **Then** nombra el periodo no disponible y su motivo, y ofrece recortarlo o eliminarlo para dejar sitio.
5. **Given** dos dispositivos con la agenda abierta, **When** ambos confirman casi a la vez acciones que se solapan, **Then** sólo una se aplica y la otra recibe el conflicto recalculado sobre el estado ya actualizado, nunca un solape guardado.
6. **Given** cualquier conflicto resuelto, **When** termina la operación, **Then** no existen dos citas confirmadas que se solapen en la agenda.

---

### User Story 7 - Ajustar horario y ausencias (Priority: P2)

La dueña cambia la hora de cierre de los viernes, abre los lunes que antes cerraba o registra los días que no estará. Los huecos que ven los clientes se ajustan solos.

**Why this priority**: el horario cambia pocas veces al año, pero cuando cambia y no puede tocarlo, todos los huecos que se ofrecen son mentira. Va después de la gestión diaria porque su frecuencia de uso es mucho menor.

**Independent Test**: se edita el horario de un día de la semana y se comprueba en la página pública que los huecos de ese día cambian en consecuencia.

**Acceptance Scenarios**:

1. **Given** el horario de los viernes de 10:00 a 20:00, **When** la dueña lo cambia a 10:00–18:00, **Then** los clientes dejan de ver huecos después de las 18:00 y las citas ya confirmadas a las 19:00 se mantienen intactas.
2. **Given** ese mismo cambio, **When** hay citas confirmadas que quedan fuera del nuevo horario, **Then** el sistema las lista antes de guardar para que la dueña sepa cuáles son, sin impedir el cambio ni cancelarlas.
3. **Given** un día con parón de mediodía, **When** la dueña define dos tramos, 10:00–14:00 y 16:00–20:00, **Then** el rato intermedio deja de ofrecerse y ningún servicio se ofrece a caballo entre los dos tramos.
4. **Given** el formulario de horario, **When** la dueña introduce un tramo que empieza después de terminar, o dos tramos del mismo día que se solapan, **Then** el sistema lo rechaza explicando cuál es el problema.
5. **Given** un día de la semana sin ningún tramo, **When** un cliente lo consulta, **Then** lo ve cerrado, no lleno.

---

### User Story 8 - Mantener el catálogo de servicios (Priority: P2)

La dueña añade un servicio nuevo con su duración y su precio, corrige la duración de otro que siempre se le queda corta y retira el que ya no hace.

**Why this priority**: el catálogo cambia menos que la agenda pero más que el horario, y un servicio con la duración equivocada desajusta la agenda entera todos los días.

**Independent Test**: se añade un servicio y se comprueba que es seleccionable de inmediato en la página pública y que sus huecos se calculan con la duración indicada.

**Acceptance Scenarios**:

1. **Given** un servicio nuevo "Mechas" de 90 minutos, **When** la dueña lo guarda, **Then** un cliente puede elegirlo de inmediato y sólo ve inicios donde quepan 90 minutos completos.
2. **Given** un servicio con citas futuras, **When** la dueña lo retira del catálogo, **Then** deja de ofrecerse a los clientes y las citas existentes siguen intactas en la agenda con su nombre, duración y precio originales.
3. **Given** un servicio retirado, **When** la dueña lo vuelve a activar, **Then** se ofrece de nuevo sin haber perdido nada.
4. **Given** un único servicio activo en el catálogo, **When** la dueña intenta retirarlo, **Then** el sistema lo impide explicando que el salón se quedaría sin nada que reservar.
5. **Given** un servicio cuya duración se cambia de 45 a 60 minutos, **When** se guarda, **Then** las citas ya confirmadas conservan los 45 minutos con los que se reservaron y sólo las nuevas usan 60.
6. **Given** un cliente con el formulario de reserva abierto para un servicio, **When** la dueña lo retira antes de que confirme, **Then** la confirmación se rechaza con un mensaje que explica que ese servicio ya no está disponible, sin dejar la cita a medias.

---

### User Story 9 - Ajustar los parámetros de reserva (Priority: P2)

La dueña sube la antelación mínima a cuatro horas porque se cansó de las reservas a última hora, o baja el plazo de cancelación a doce horas.

**Why this priority**: es el ajuste menos frecuente de todos, pero hoy exige tocar el código. Su valor está en la autonomía, no en el día a día.

**Independent Test**: se cambia la antelación mínima y se comprueba que un intento de reserva del cliente por debajo del nuevo valor se rechaza.

**Acceptance Scenarios**:

1. **Given** una antelación mínima de 2 horas, **When** la dueña la cambia a 4, **Then** los clientes dejan de ver inicios a menos de 4 horas vista, de inmediato.
2. **Given** un plazo de cancelación de 24 horas cambiado a 12, **When** un cliente con cita dentro de 18 horas abre su enlace, **Then** ya puede cancelar, cosa que antes del cambio no podía.
3. **Given** un plazo de cancelación subido de 12 a 48 horas, **When** un cliente con cita dentro de 24 horas abre su enlace, **Then** ya no puede cancelar, y ninguna cancelación hecha antes del cambio se deshace.
4. **Given** el formulario de parámetros, **When** la dueña introduce un valor fuera de los rangos admitidos, **Then** el sistema lo rechaza indicando los límites.

---

### Edge Cases

- **Bloquear encima de una cita**: el sistema nombra la cita afectada y exige decisión explícita. El periodo no disponible puede crearse conviviendo con la cita ya confirmada —un bloqueo no cancela a nadie—, o la dueña puede cancelar antes la cita. Lo que nunca ocurre es que la cita desaparezca sola.
- **Servicio retirado a mitad de una reserva del cliente**: la confirmación se rechaza con un mensaje que explica que el servicio ya no se ofrece. La cita no se crea a medias y el cliente vuelve al catálogo actualizado.
- **Hora de cierre por delante de una cita futura**: el cambio de horario se permite y la cita se mantiene. El sistema lista las citas que quedan fuera del nuevo horario para que la dueña las gestione ella; no hay cancelación automática.
- **Plazo de cancelación endurecido sobre una cita que estaba en plazo**: el plazo se evalúa siempre en el momento en que el cliente actúa, con el valor vigente entonces. Una cita que estaba en plazo puede dejar de estarlo, y el cliente ve el mensaje de fuera de plazo con el teléfono del salón.
- **Dos acciones solapadas casi simultáneas desde dos dispositivos**: la primera en llegar gana. La segunda no se aplica: se recalcula el conflicto sobre el estado ya actualizado y se le vuelve a preguntar a la dueña. Nunca se guarda un solape.
- **Intentos de acceso repetidos con contraseña incorrecta**: tras superar el límite de intentos, el acceso se bloquea temporalmente y la respuesta es indistinguible de un intento fallido corriente, sin revelar si el usuario existe ni cuánto dura el bloqueo.
- **Retirar el último servicio activo**: se impide. El catálogo nunca queda vacío, porque un salón sin servicios activos es una página de reserva rota, no una configuración legítima.
- **Día en curso marcado entero como no disponible con citas dentro**: el sistema lista las citas afectadas y pide confirmación. El periodo se crea, las citas se mantienen y la dueña decide cuáles cancela, una a una.
- **Sesión caducada a mitad de una acción**: la acción no se aplica. La dueña vuelve al formulario de acceso y, tras entrar, recupera la pantalla donde estaba, con los datos actuales.
- **Cita manual sobre una franja ya pasada**: se impide. Ni la dueña puede crear ni mover citas al pasado; la agenda de días pasados es de sólo lectura.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Acceso y sesión

- **FR-001**: El sistema DEBE disponer de una única cuenta de personal, identificada por usuario y contraseña. No hay registro, ni invitaciones, ni segundas cuentas.
- **FR-002**: El sistema DEBE exigir una sesión válida para acceder a cualquier pantalla u operación de esta feature. Sin sesión, la respuesta DEBE ser el formulario de acceso, sin filtrar ningún dato de agenda, horario, catálogo ni cliente.
- **FR-003**: La credencial inicial DEBE aprovisionarse fuera de la aplicación, en el arranque de la instancia. La aplicación NO DEBE ofrecer ninguna forma de crear la cuenta desde la interfaz.
- **FR-004**: La dueña DEBE poder cambiar su contraseña desde dentro de la sesión, acreditando la contraseña actual.
- **FR-005**: El sistema NO DEBE ofrecer recuperación de contraseña en v1. El formulario de acceso DEBE indicar qué hacer si se olvida, sin exponer detalles operativos.
- **FR-006**: La dueña DEBE poder cerrar sesión explícitamente, y tras hacerlo ninguna pantalla de gestión DEBE seguir siendo accesible.
- **FR-007**: La sesión DEBE caducar por inactividad. Al caducar, la acción en curso NO DEBE aplicarse.
- **FR-008**: La respuesta a un acceso fallido DEBE ser idéntica para usuario inexistente y para contraseña incorrecta.
- **FR-009**: El sistema DEBE limitar los intentos de acceso fallidos y bloquear temporalmente el acceso al superarse el límite, con una respuesta indistinguible de un fallo corriente. El bloqueo se aplica a la cuenta, no al origen del intento: el sistema NO DEBE almacenar ni distinguir por dirección IP u otro identificador de origen.
- **FR-010**: La contraseña NO DEBE almacenarse de forma recuperable ni aparecer en logs, trazas ni analítica, ni siquiera parcialmente.

#### Agenda

- **FR-011**: El sistema DEBE mostrar el día seleccionado como una línea temporal que incluya las citas confirmadas, los periodos no disponibles y el tiempo libre dentro del horario de apertura.
- **FR-012**: La dueña DEBE poder navegar a cualquier fecha, pasada o futura, y volver al día actual con un solo gesto.
- **FR-013**: Cada cita DEBE indicar si procede de una reserva online o de una creación manual, mediante texto e icono, nunca sólo mediante color.
- **FR-014**: Cada cita de la agenda DEBE mostrar hora de inicio y fin, servicio, nombre y teléfono del cliente, y su estado.
- **FR-015**: Las citas canceladas NO DEBEN aparecer en la línea temporal por defecto; la dueña DEBE poder mostrarlas mediante un control explícito.
- **FR-016**: Las citas de franjas ya pasadas DEBEN ser de sólo lectura: no se crean, ni se mueven, ni se cancelan. Una franja se considera pasada cuando su **hora de fin** ya transcurrió; mientras una cita está en curso (empezada, no terminada) sigue siendo movible y cancelable.
- **FR-017**: Un día sin citas DEBE mostrar un estado vacío que distinga "sin citas" de "cerrado".

#### Periodos no disponibles

- **FR-018**: La dueña DEBE poder crear un periodo no disponible indicando instante de inicio e instante de fin, en múltiplos de 15 minutos, con un motivo interno opcional. Un mismo periodo DEBE poder abarcar desde una fracción de un día hasta varias semanas.
- **FR-019**: La dueña DEBE poder eliminar o acortar un periodo no disponible existente.
- **FR-020**: Un periodo no disponible DEBE comportarse ante el cliente exactamente como tiempo cerrado: ningún hueco que se solape con él se ofrece.
- **FR-021**: El motivo de un periodo no disponible NO DEBE exponerse nunca al cliente.
- **FR-022**: Crear un periodo no disponible que se solape, total o parcialmente, con una o más citas confirmadas DEBE listarlas y exigir confirmación explícita, y NO DEBE cancelar ninguna.
- **FR-023**: El sistema DEBE rechazar periodos cuyo inicio no preceda a su fin.

#### Citas manuales

- **FR-024**: La dueña DEBE poder crear una cita indicando servicio del catálogo activo, fecha y hora de inicio, nombre y teléfono del cliente. El email es opcional.
- **FR-025**: Una cita creada a mano DEBE quedar marcada como tal de forma permanente, y esa marca DEBE sobrevivir a las reprogramaciones.
- **FR-026**: Una cita creada a mano NO DEBE entregar al cliente enlace de gestión: no se reserva online y v1 no tiene forma de hacérselo llegar.
- **FR-027**: La duración de una cita manual DEBE derivarse del servicio elegido, igual que en una reserva online.
- **FR-028**: La dueña NO DEBE estar sujeta a la antelación mínima de reserva, al horizonte de reserva, al plazo de cancelación ni al horario de apertura al crear o mover citas.
- **FR-029**: La dueña SÍ DEBE estar sujeta al límite de citas futuras confirmadas por contacto, igual que el cliente.
- **FR-030**: El sistema NO DEBE permitir crear ni mover citas a franjas ya pasadas.
- **FR-031**: Los datos de cliente de una cita manual DEBEN validarse con las mismas reglas de formato que los de una reserva online.

#### Conflictos

- **FR-032**: Antes de guardar cualquier creación o reprogramación manual, el sistema DEBE detectar solapes con citas confirmadas y con periodos no disponibles.
- **FR-033**: El aviso de conflicto DEBE nombrar el elemento que estorba: para una cita, el nombre del cliente, el servicio y su franja; para un periodo no disponible, su franja y su motivo.
- **FR-034**: El aviso DEBE ofrecer únicamente salidas explícitas: abandonar la operación, o resolver el conflicto cancelando la cita que estorba, moviéndola, o eliminando o acortando el periodo no disponible.
- **FR-035**: El sistema NUNCA DEBE permitir que dos citas confirmadas se solapen, ni siquiera por decisión explícita de la dueña.
- **FR-036**: Abandonar la operación en el aviso DEBE dejar tanto la cita existente como el intento sin ningún cambio.
- **FR-037**: La resolución del conflicto y la cita nueva o movida DEBEN aplicarse como una sola operación indivisible: o se aplican ambas, o no se aplica ninguna.
- **FR-038**: Si el estado cambió entre el cálculo del conflicto y su confirmación, el sistema DEBE rechazar la operación y volver a presentar el conflicto recalculado.

#### Gestión de citas existentes

- **FR-039**: La dueña DEBE poder reprogramar cualquier cita confirmada, online o manual, conservando su servicio y sus datos de cliente.
- **FR-040**: La dueña DEBE poder cancelar cualquier cita confirmada, online o manual, con confirmación explícita previa.
- **FR-041**: Reprogramar una cita reservada online DEBE conservar su enlace de gestión en funcionamiento.
- **FR-042**: Una cita cancelada DEBE ser terminal: no se reactiva ni se mueve.
- **FR-043**: Tras cancelar o reprogramar una cita reservada online, el sistema DEBE advertir a la dueña de que el cliente no recibe ningún aviso y mostrarle el teléfono del cliente.

#### Horario de apertura

- **FR-044**: La dueña DEBE poder ver y editar los tramos de apertura de cada día de la semana, con cero, uno o varios tramos por día.
- **FR-045**: El sistema DEBE rechazar tramos cuyo inicio no preceda a su fin, tramos que crucen la medianoche y tramos del mismo día que se solapen, explicando el motivo del rechazo.
- **FR-046**: Un día de la semana sin ningún tramo DEBE presentarse al cliente como cerrado, nunca como lleno.
- **FR-047**: Reducir el horario NO DEBE cancelar ni modificar citas ya confirmadas; el sistema DEBE listar antes de guardar las que queden fuera del nuevo horario.

#### Catálogo de servicios

- **FR-048**: La dueña DEBE poder añadir un servicio con nombre, duración y precio.
- **FR-049**: La dueña DEBE poder editar el nombre, la duración, el precio y el orden de presentación de un servicio existente.
- **FR-050**: La dueña DEBE poder retirar un servicio del catálogo y volver a activarlo. Retirarlo NO DEBE alterar ni cancelar ninguna cita existente.
- **FR-051**: El sistema DEBE impedir retirar el último servicio activo del catálogo.
- **FR-052**: Cambiar la duración o el precio de un servicio NO DEBE alterar las citas ya confirmadas, que conservan los valores con los que se reservaron.
- **FR-053**: El sistema DEBE rechazar servicios con duración no positiva o precio negativo.

#### Parámetros de reserva

- **FR-054**: La dueña DEBE poder ver y editar la antelación mínima de reserva y el plazo límite de cancelación, cada uno dentro de un rango admitido y explicado en pantalla.
- **FR-055**: Un parámetro modificado DEBE aplicarse a partir de ese momento, evaluándose en el instante en que el cliente actúa, y NO DEBE reabrir ni deshacer plazos ya consumidos.

#### Transversales

- **FR-056**: Todo cambio de configuración —horario, periodos no disponibles, catálogo, parámetros— DEBE reflejarse en la siguiente consulta de disponibilidad del cliente, sin despliegue ni reinicio.
- **FR-057**: Los datos personales de los clientes visibles en estas pantallas NO DEBEN aparecer en logs, trazas ni analítica, igual que en el flujo de cliente.
- **FR-058**: Toda pantalla de esta feature DEBE ser plenamente usable en móvil a 360 px y cumplir WCAG 2.2 AA, con el estado transmitido siempre por texto además de por color.
- **FR-059**: Toda acción DEBE devolver feedback explícito de carga, éxito o error, con mensajes accionables.

### Reglas de negocio

- **BR-001**: No existen dos citas confirmadas que se solapen. Ni por reserva online, ni por acción manual, ni resolviendo un conflicto.
- **BR-002**: Un periodo no disponible equivale, para el cliente, a tiempo cerrado. Nunca se ofrece un hueco que lo pise.
- **BR-003**: Retirar un servicio no toca las citas que lo referencian. La cita conserva el nombre, la duración y el precio congelados al reservarse.
- **BR-004**: Reducir el horario de apertura no cancela retroactivamente ninguna cita. Sólo deja de ofrecerse disponibilidad nueva.
- **BR-005**: Resolver un conflicto es siempre una acción explícita, nombrada y confirmada por la dueña. No existe la resolución automática.
- **BR-006**: Los parámetros de reserva se evalúan con el valor vigente en el instante de la acción. Ni se aplican retroactivamente ni se reabren plazos pasados.
- **BR-007**: La dueña está exenta de la antelación mínima, del horizonte de reserva, del plazo de cancelación y del horario de apertura. No está exenta del límite de citas futuras por contacto.
- **BR-008**: La cancelación es terminal para cualquier cita, la haya cancelado el cliente o la dueña.
- **BR-009**: El pasado es de sólo lectura. Ninguna acción de la dueña crea, mueve ni cancela nada en una franja cuya hora de fin ya transcurrió. Una cita en curso (empezada, no terminada) no es pasado: sigue siendo movible y cancelable.
- **BR-010**: El catálogo tiene siempre al menos un servicio activo.
- **BR-011**: Toda cita, creada por quien sea, tiene nombre y teléfono de cliente mientras no se anonimice por retención.

### Key Entities

- **Cuenta de la dueña**: la única identidad de personal. Usuario, credencial verificable y momento del último cambio de contraseña. No contiene datos de clientes.
- **Sesión**: el acceso vigente de la dueña, con su momento de creación y de última actividad. Es lo que FR-002 exige y lo que FR-007 caduca.
- **Periodo no disponible**: un intervalo con inicio y fin arbitrarios y un motivo interno opcional. Generaliza y sustituye al cierre de día completo actual: un festivo es un periodo de un día, unas vacaciones uno de dos semanas, la comida uno de una hora.
- **Tramo de apertura**: un intervalo horario de un día de la semana. Pasa de ser configuración de arranque a dato editable; su semántica no cambia.
- **Servicio**: una prestación del catálogo, con nombre, duración, precio, orden y estado activo o retirado. Pasa de ser configuración de arranque a dato editable.
- **Parámetros de reserva**: la antelación mínima y el plazo de cancelación del salón. Pasan de constantes del sistema a configuración editable, con rangos admitidos.
- **Cita**: la entidad existente, ampliada con su **origen** —reservada online o creada por la dueña— y con un email de cliente que ahora puede faltar en las creadas a mano.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sin credencial válida, ninguna pantalla ni respuesta de esta feature revela un solo dato de agenda, horario, catálogo o cliente: cero fugas en un barrido de todas las direcciones de gestión.
- **SC-002**: La dueña apunta a un cliente que entra sin reserva en menos de 30 segundos desde la agenda abierta, en móvil.
- **SC-003**: Un rato bloqueado desaparece de la disponibilidad que ve el cliente en la siguiente consulta, sin ninguna intervención adicional.
- **SC-004**: El 100 % de los intentos de solape —incluidos los confirmados por la dueña y los simultáneos desde dos dispositivos— terminan sin dos citas confirmadas solapadas en la agenda.
- **SC-005**: El 100 % de los avisos de conflicto identifican el elemento que estorba por nombre y franja antes de aplicar cualquier cambio.
- **SC-006**: Rechazar un aviso de conflicto deja el sistema exactamente como estaba: ninguna cita creada, movida ni cancelada.
- **SC-007**: Un servicio nuevo es seleccionable por un cliente y sus huecos se calculan con la duración indicada en la siguiente consulta tras guardarlo.
- **SC-008**: Retirar un servicio con citas futuras deja el 100 % de esas citas intactas en fecha, hora, duración, precio y estado.
- **SC-009**: Un cambio de antelación mínima o de plazo de cancelación rige el siguiente intento del cliente, sin despliegue ni reinicio.
- **SC-010**: La agenda de un día se abre en menos de 2 segundos en un móvil de gama media sobre 4G, y ese tiempo no se degrada a medida que crece el histórico de citas.
- **SC-011**: Todas las pantallas de gestión pasan una auditoría automática de accesibilidad sin incidencias de nivel AA, y son operables íntegramente con teclado.
- **SC-012**: La dueña completa el ajuste del horario de un día de la semana sin ayuda ni documentación, en el primer intento.

---

## Assumptions

- **Una instancia por salón**: sigue vigente. Una cuenta, un salón, una línea temporal. No hay identificador de salón en ninguna pantalla.
- **Aprovisionamiento de la credencial**: se hace en el arranque de la instancia, por el mismo medio que hoy carga la configuración inicial. Si la dueña olvida la contraseña, se reaprovisiona por ese medio; la app no participa.
- **Caducidad de sesión**: 12 horas de inactividad. Suficiente para una jornada completa sin volver a entrar, y corto para una tablet que vive en el salón.
- **Límite de intentos de acceso**: 5 fallos en 15 minutos bloquean el acceso durante 15 minutos. El bloqueo es por cuenta, no por origen: no se registra ni distingue IP ni dispositivo.
- **Citas manuales y notificación**: v1 no envía nada a nadie, tampoco cuando la dueña cancela o mueve una cita reservada online. La dueña llama por teléfono; la pantalla se lo recuerda y le da el número.
- **Email opcional en citas manuales**: una cita sin email es plenamente válida. Nombre y teléfono siguen siendo obligatorios porque son la vía de contacto real del salón.
- **Retención de datos personales**: las citas manuales siguen exactamente la misma política de anonimización a 12 meses que las online.
- **Rangos admitidos de los parámetros**: antelación mínima entre 0 y 48 horas; plazo de cancelación entre 0 y 72 horas. Ambos en horas completas.
- **Granularidad de los periodos no disponibles**: formalizada en FR-018 — múltiplos de 15 minutos, suficientes para cualquier interrupción real del salón.
- **Orden del catálogo**: la dueña controla el orden de presentación de los servicios; no hay ordenación automática por precio ni por popularidad.
- **Sin auditoría**: no se registra quién cambió qué. Hay una sola persona con acceso, y la constitución no exige trazabilidad de personal.
- **Idioma**: todos los textos de la interfaz de gestión están en español, en el mismo catálogo de mensajes que el resto del producto.
- **El teléfono del salón** no es un dato personal de cliente y puede seguir mostrándose en pantallas públicas, como ya ocurre hoy.

---

## Out of Scope

Esta versión NO incluye:

- Varias cuentas de personal, roles o niveles de permiso. Una dueña, un acceso.
- Recordatorios, notificaciones por SMS o email y consentimiento por canal. Es una feature aparte, y arrastra el Principio IV de la constitución.
- Varios profesionales o varios sillones. La agenda sigue siendo una única línea temporal.
- Informes, analítica o estadísticas de ocupación.
- Pagos, señales, precios variables o penalizaciones por no presentarse.
- Recuperación de contraseña por email o por cualquier otro canal.
- Métodos de autenticación alternativos: sin SSO, sin enlace mágico, sin segundo factor.
- Registro de auditoría de cambios de configuración.
- Vista de semana o de mes en la agenda. Sólo día, navegable.
- Edición de la duración de una cita concreta al margen de la duración de su servicio.
- Ficha de cliente como entidad propia: no hay historial por cliente ni libreta de contactos; los datos siguen viviendo en cada cita.
- Importación o exportación de la agenda, y sincronización con calendarios externos.

---

## Dependencies

- **Feature `001-client-appointment-booking`**: esta feature edita en vivo la configuración que aquella lee. Sus reglas de disponibilidad, reserva, cancelación y reprogramación no cambian, pero pasan a leer datos mutables. Lo que esta feature modifica de lo ya construido allí:
  - El **cierre de día completo** se generaliza a **periodo no disponible** con inicio y fin arbitrarios. El cálculo de disponibilidad deja de tratar el cierre como "día entero" y pasa a restar intervalos.
  - El **email del cliente** deja de estar siempre presente: una cita manual puede no tenerlo.
  - El **enlace de gestión** deja de existir en todas las citas: las manuales no lo tienen.
  - La **antelación mínima** y el **plazo de cancelación** dejan de ser constantes del dominio y pasan a leerse de la configuración del salón en cada evaluación.
  - La cita gana un atributo de **origen**, y la garantía de no-superposición debe seguir cubriendo por igual a las citas creadas por la dueña.
- **Constitución del producto** (`.specify/memory/constitution.md`): esta feature resuelve dos puntos marcados [TBD] —el **modelo de roles del personal** (rol único, sin jerarquía) y el **método de autenticación del personal** (usuario y contraseña, aprovisionada fuera de la app)— y convierte los **parámetros temporales del dominio** en configuración editable. El Principio V exige autenticación y autorización en todo punto de acceso que lea o escriba datos de clientes o citas: FR-002 es su aplicación directa.
- **Reloj y zona horaria del salón**: todas las franjas, periodos y horarios se interpretan con el reloj del servidor en la zona horaria del salón, nunca con el del dispositivo de la dueña.
