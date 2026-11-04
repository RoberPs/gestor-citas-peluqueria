# Feature Specification: Gestión del salón (cara a la dueña) v1

**Feature Branch**: `002-salon-management`

**Created**: 2026-09-15

**Revised**: 2026-11-03 — modelo de varios servicios por cita y precio opcional de la `005-multiple-services`, y nueva Historia 10 «Listado de reservas». Después, el mismo día, las decisiones de la dueña del producto sobre esa revisión: nueva Historia 11 «Editar una cita», búsqueda en el listado, textos de la cancelación y tamaño de página

**Status**: Draft

**Input**: Especificación de negocio aportada por la dueña del producto: acceso privado, agenda del día, gestión manual de citas, bloqueo de huecos y edición de horario, ausencias, catálogo de servicios y parámetros de reserva.

---

## Contexto de negocio

Hoy el salón funciona con configuración precargada. El horario de apertura, los cierres, el catálogo de servicios y los parámetros de reserva se fijan al arrancar la instancia y sólo cambian tocando datos de arranque. La dueña no ve su agenda dentro de la app, no puede bloquear un hueco para comer y no tiene forma de apuntar a quien entra por la puerta sin cita.

Esta feature le da un acceso privado y las pantallas para llevar el salón día a día: ver la agenda, gestionar citas a mano y editar la configuración que lee el flujo de reserva de clientes.

**Lo que cambia respecto a la situación actual**: la configuración deja de ser un dato de arranque estático y pasa a ser algo que la dueña edita. El flujo de reserva de la feature `001-client-appointment-booking` sigue leyendo exactamente los mismos conceptos, pero ahora reflejan lo que la dueña acaba de guardar, no lo que se cargó al desplegar.

**Lo que no cambia**: la agenda sigue siendo **una única línea temporal** de un solo sillón, el cliente sigue sin tener cuenta, y v1 sigue sin enviar SMS ni email a nadie por nada de lo que hace la dueña. *Desde la `004-notifications` la reserva online puede enviar al cliente su confirmación por email; la agenda y el listado marcan, con el teléfono para llamar, las citas cuya confirmación falló (FR-020a de la 004).*

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

### Session 2026-11-03

- Q: La `005-multiple-services` ya está en `main`: una cita lleva uno o varios servicios y un servicio puede no tener precio. ¿Cómo afecta a la gestión? → A: La dueña ve y apunta citas con el mismo modelo. La agenda y el listado muestran todos los servicios de cada cita; una cita a mano admite uno o varios servicios y dura su suma; mover una cita conserva sus servicios y su duración total; el catálogo admite servicios sin precio, que se muestran como «Precio a consultar en el salón», nunca «0,00 €».
- Q: ¿Puede la dueña cambiar los servicios de una cita ya confirmada? → A: ~~No en v1, igual que el cliente en la 005: mover sólo cambia la hora. Para cambiar los servicios, la dueña cancela y apunta una cita nueva.~~ **Sustituida** ese mismo día por la respuesta sobre editar una cita, más abajo.
- Q: ¿Necesita la dueña una vista de todas sus reservas, además de la agenda de un día? → A: Sí. Un **listado de reservas** privado (Historia 10), dentro del MVP mínimo junto al acceso y la agenda. No es una vista de semana ni de mes: es una lista filtrable y paginada.
- Q: En el listado, ¿cómo se tratan las canceladas? → A: Igual que en la agenda (FR-015): ocultas por defecto. Un filtro *Confirmadas / Canceladas / Todas* las muestra, con la etiqueta «Cancelada» en texto e icono y la fecha de cancelación.
- Q: ¿Se guarda quién canceló una cita? → A: Sí. Cada cancelación registra si la hizo el cliente desde su enlace o la dueña desde la gestión, y el listado lo muestra. Las cancelaciones anteriores a esta feature las hizo siempre el cliente, porque no había otra forma de cancelar.
- Q: ¿Puede la dueña editar una cita en vez de cancelarla y apuntar otra? → A: Sí (Historia 11). Puede editar una cita confirmada y no pasada: sus **servicios** —añadir, quitar o cambiar— y los **datos del cliente** —nombre, teléfono y email—. Si la cita se alarga y pisa algo, sale el mismo aviso de conflicto que al moverla. Los servicios añadidos se guardan con el precio y la duración del momento. Una cita online conserva su enlace, que pasa a mostrar los servicios nuevos. El cliente sigue sin poder cambiar los servicios.
- Q: ¿Se puede buscar en el listado de reservas? → A: Sí, por **nombre o teléfono**, combinable con los filtros. El teléfono se compara sin espacios ni prefijo; el nombre, sin mayúsculas ni acentos y por una parte. Las citas anonimizadas no aparecen al buscar.
- Q: ¿Qué ve cada uno cuando la cita está cancelada? → A: El cliente, en su enlace, «Has cancelado esta cita» si la canceló él y «El salón ha cancelado esta cita», con el teléfono del salón, si la canceló la dueña. La dueña, en el listado, «Cancelada por el cliente» y «Cancelada por ti».
- Q: ¿Cuántas citas por página tiene el listado y a qué fecha se aplica el filtro? → A: 20 por página, con *Página siguiente* y *Volver al principio*. El filtro de fechas se aplica al día de la cita en los dos órdenes.

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

La dueña abre la agenda y ve su día como una línea temporal: quién viene, a qué hora, para qué servicios, qué huecos tiene libres y qué ratos ha bloqueado. Puede moverse a mañana para preparar la jornada o a la semana pasada para comprobar algo.

**Why this priority**: es la pantalla que sustituye a la agenda de papel. Es lo primero que la dueña mira cada mañana y el punto de partida de todas las acciones sobre citas.

**Independent Test**: con citas ya existentes, se abre la agenda y se comprueba que las muestra correctamente y que la navegación entre días funciona. No necesita ninguna otra historia.

**Acceptance Scenarios**:

1. **Given** un día con tres citas confirmadas, **When** la dueña abre la agenda de ese día, **Then** ve las tres en orden cronológico con hora de inicio y fin, todos sus servicios en el orden del catálogo, nombre y teléfono del cliente.
2. **Given** una cita reservada online y otra creada a mano el mismo día, **When** la dueña mira la agenda, **Then** distingue el origen de cada una por texto e icono, no sólo por color.
3. **Given** un periodo no disponible de 13:00 a 14:00, **When** la dueña mira ese día, **Then** el rato aparece marcado como no disponible en la línea temporal, con su motivo interno si lo puso.
4. **Given** la agenda de hoy abierta, **When** la dueña navega a otra fecha y después usa el atajo de hoy, **Then** vuelve al día actual.
5. **Given** un día ya pasado, **When** la dueña lo abre, **Then** puede consultarlo pero no crear, mover, editar ni cancelar nada en él.
6. **Given** un día sin ninguna cita, **When** la dueña lo abre, **Then** ve un estado vacío que distingue "sin citas" de "cerrado".
7. **Given** una cita reservada online con «Corte de pelo» y «Diseño y corte de barba», **When** la dueña mira la agenda, **Then** la cita ocupa la hora entera de la suma y muestra los dos servicios, no sólo el primero.

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

Entra una clienta sin cita, o llama por teléfono. La dueña la apunta desde la agenda: elige uno o varios servicios, la hora, escribe nombre y teléfono, y la cita queda en la misma línea temporal que las reservas online.

**Why this priority**: mientras haya citas que sólo existen en la cabeza de la dueña, la agenda no es fiable y los huecos que se ofrecen online no son reales.

**Independent Test**: se crea una cita a mano en un hueco libre y se comprueba que aparece en la agenda y que ese hueco deja de ofrecerse en la página pública.

**Acceptance Scenarios**:

1. **Given** un hueco libre a las 16:00, **When** la dueña apunta ahí a una clienta con nombre, teléfono y servicio, **Then** la cita queda confirmada sin ningún aviso y el hueco deja de ofrecerse online.
2. **Given** el formulario de cita manual, **When** la dueña deja el email vacío, **Then** la cita se crea igualmente; si deja vacío el nombre o el teléfono, no.
3. **Given** que son las 16:40 y la antelación mínima para clientes es de dos horas, **When** la dueña apunta una cita para las 17:00, **Then** se crea sin objeción.
4. **Given** un salón que cierra a las 20:00, **When** la dueña apunta una cita a las 20:30, **Then** el sistema avisa de que está fuera del horario, la dueña confirma y la cita se crea.
5. **Given** una clienta que ya tiene tres citas futuras confirmadas, **When** la dueña intenta apuntarle una cuarta, **Then** el sistema lo impide, igual que se lo impediría a ella online.
6. **Given** una cita creada a mano, **When** se consulta después, **Then** sigue marcada como creada por la dueña y no tiene enlace de gestión para el cliente.
7. **Given** el formulario de cita manual, **When** la dueña elige «Corte de pelo» y «Diseño y corte de barba», de 30 minutos cada uno, **Then** ve la duración total de una hora antes de guardar, y la cita ocupa esa hora entera en la agenda.
8. **Given** el formulario de cita manual, **When** la dueña no elige ningún servicio, **Then** la cita no se crea y el formulario le pide elegir al menos uno.

---

### User Story 5 - Mover o cancelar una cita desde la agenda (Priority: P1)

Una clienta llama para retrasar su cita media hora, o avisa de que no viene. La dueña lo resuelve desde la agenda, sin importar si la cita se reservó online o la apuntó ella.

**Why this priority**: es la otra mitad de tener la agenda dentro de la app. Sin esto, cualquier cambio de última hora vuelve al papel.

**Independent Test**: se mueve una cita existente a otra hora libre y se cancela otra, comprobando en ambos casos el efecto en la agenda y en la disponibilidad pública.

**Acceptance Scenarios**:

1. **Given** una cita online de las 11:00, **When** la dueña la mueve a las 11:30 y ese rato está libre, **Then** la cita queda a las 11:30, conserva sus servicios, su duración total, sus datos y su enlace de gestión, y las 11:00 vuelven a ofrecerse.
2. **Given** una cita que empieza dentro de una hora y un plazo de cancelación para clientes de 24 horas, **When** la dueña la cancela, **Then** se cancela igualmente.
3. **Given** cualquier cancelación, **When** la dueña la solicita, **Then** el sistema pide una confirmación explícita antes de aplicarla.
4. **Given** una cita ya cancelada, **When** la dueña la abre, **Then** no puede reactivarla ni moverla: la cancelación es definitiva.
5. **Given** una cita reservada online que la dueña acaba de cancelar o mover, **When** se aplica el cambio, **Then** la pantalla le recuerda que el cliente no recibe ningún aviso y le muestra el teléfono para llamarle.
6. **Given** una cita que la dueña acaba de cancelar, **When** después la consulta en el listado de reservas, **Then** figura como «Cancelada por ti»; una que canceló el cliente desde su enlace figura como «Cancelada por el cliente».
7. **Given** una cita online que la dueña acaba de cancelar, **When** el cliente abre su enlace, **Then** lee «El salón ha cancelado esta cita» junto al teléfono del salón; y si la canceló él mismo, lee «Has cancelado esta cita».

---

### User Story 6 - Resolver un conflicto a la vista (Priority: P1)

La dueña intenta poner una cita encima de otra o dentro de un rato bloqueado. En lugar de fallar con un error seco o de machacar lo que había, el sistema le enseña exactamente qué estorba y le deja decidir.

**Why this priority**: es lo que separa una herramienta que la dueña usa de una que abandona. Un error genérico la devuelve al papel; una resolución silenciosa le borra una cita sin que se entere.

**Independent Test**: se intenta crear una cita solapada y se comprueba que el aviso nombra la cita en conflicto, que rechazarlo no cambia nada y que resolverlo aplica ambos cambios juntos.

**Acceptance Scenarios**:

1. **Given** una reserva online de 15:45 a 16:30 a nombre de Ana, **When** la dueña intenta apuntar otra cita a las 16:00, **Then** el aviso nombra la cita de Ana con su hora y sus servicios antes de tocar nada.
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

La dueña añade un servicio nuevo con su duración y, si quiere, su precio; corrige la duración de otro que siempre se le queda corta y retira el que ya no hace.

**Why this priority**: el catálogo cambia menos que la agenda pero más que el horario, y un servicio con la duración equivocada desajusta la agenda entera todos los días.

**Independent Test**: se añade un servicio y se comprueba que es seleccionable de inmediato en la página pública y que sus huecos se calculan con la duración indicada.

**Acceptance Scenarios**:

1. **Given** un servicio nuevo "Mechas" de 90 minutos, **When** la dueña lo guarda, **Then** un cliente puede elegirlo de inmediato y sólo ve inicios donde quepan 90 minutos completos.
2. **Given** un servicio con citas futuras, **When** la dueña lo retira del catálogo, **Then** deja de ofrecerse a los clientes y las citas existentes siguen intactas en la agenda con su nombre, duración y precio originales.
3. **Given** un servicio retirado, **When** la dueña lo vuelve a activar, **Then** se ofrece de nuevo sin haber perdido nada.
4. **Given** un único servicio activo en el catálogo, **When** la dueña intenta retirarlo, **Then** el sistema lo impide explicando que el salón se quedaría sin nada que reservar.
5. **Given** un servicio cuya duración se cambia de 45 a 60 minutos, **When** se guarda, **Then** las citas ya confirmadas conservan los 45 minutos con los que se reservaron y sólo las nuevas usan 60.
6. **Given** un cliente con el formulario de reserva abierto para uno o varios servicios, **When** la dueña retira uno de ellos antes de que confirme, **Then** la confirmación se rechaza con un mensaje que explica que ese servicio ya no está disponible, sin dejar la cita a medias.
7. **Given** un servicio nuevo que la dueña guarda sin precio, **When** un cliente lo ve en la página de reserva, **Then** dice «Precio a consultar en el salón», nunca «0,00 €»; y si la dueña escribe un precio de 0, el sistema lo rechaza y le explica que, si no quiere poner precio, deje el campo vacío.
8. **Given** un servicio sin precio, **When** la dueña le pone uno, **Then** las citas nuevas lo muestran y las ya confirmadas siguen diciendo «Precio a consultar en el salón», como cuando se reservaron.

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

### User Story 10 - Consultar el listado de reservas (Priority: P1)

La dueña quiere saber qué reservas le han entrado desde ayer, o qué citas tiene en las próximas semanas, sin abrir la agenda día por día. Abre el listado, ve las próximas citas una debajo de otra y, si quiere, lo ordena por las últimas reservas recibidas, lo filtra por estado, origen y fechas, o busca a un cliente por su nombre o su teléfono.

**Why this priority**: la agenda enseña un día; el listado enseña lo que ha pasado. Es la forma de enterarse de las reservas online nuevas mientras v1 no envía avisos, y por eso forma parte del MVP mínimo junto al acceso y la agenda. Se numera después de las demás porque se añadió el 2026-11-03.

**Independent Test**: con citas confirmadas y canceladas, online y a mano, en varios días, se abre el listado y se comprueba el orden por defecto, cada filtro, el otro orden, la búsqueda por nombre y por teléfono, la paginación y el enlace de cada fila a su día de la agenda. No necesita ninguna otra historia salvo el acceso.

**Acceptance Scenarios**:

1. **Given** citas confirmadas de hoy en adelante, **When** la dueña abre el listado sin tocar nada, **Then** ve *Próximas citas*: las confirmadas desde hoy, ordenadas por día y hora de la cita, sin ninguna cancelada.
2. **Given** el listado abierto, **When** la dueña elige *Últimas reservas recibidas*, **Then** ve las reservas ordenadas de la más reciente a la más antigua por el momento en que se hicieron, incluidas las de días ya pasados.
3. **Given** una cita cancelada, **When** la dueña elige el filtro *Canceladas* o *Todas*, **Then** la cita aparece con la etiqueta «Cancelada» en texto e icono, la fecha de cancelación y quién la canceló: «Cancelada por el cliente» o «Cancelada por ti».
4. **Given** cada fila del listado, **When** la dueña la lee, **Then** ve el día y la hora, todos los servicios de la cita, el nombre y el teléfono del cliente, el estado, el origen —online o a mano, por texto e icono— y la fecha en que se hizo la reserva.
5. **Given** el listado, **When** la dueña filtra por origen *A mano* y por un rango de fechas, **Then** sólo ve las citas creadas por ella cuyo día cae dentro de ese rango.
6. **Given** más de 20 citas, **When** la dueña pulsa *Página siguiente*, **Then** ve las 20 siguientes en el mismo orden, con los mismos filtros y la misma búsqueda, sin repetir ni saltarse ninguna; y *Volver al principio* la devuelve a la primera página sin perder filtros ni búsqueda.
7. **Given** una fila del listado, **When** la dueña la activa, **Then** llega a la agenda del día de esa cita.
8. **Given** unos filtros o una búsqueda sin ningún resultado, **When** la dueña los aplica, **Then** ve un estado vacío que lo explica y le ofrece volver a los filtros por defecto.
9. **Given** una cita de «José Núñez» con el teléfono 600 11 22 33, **When** la dueña busca «jose», «NUÑEZ» o «nunez», **Then** la encuentra; y también cuando busca «600112233», «+34 600 11 22 33» o «0034600112233».
10. **Given** el filtro *Canceladas* y el orden *Últimas reservas recibidas*, **When** la dueña busca un nombre, **Then** sólo ve las canceladas de ese cliente, ordenadas por el momento en que se hicieron.
11. **Given** una cita anonimizada por retención, **When** la dueña busca por cualquier nombre o teléfono, **Then** esa cita no aparece; sin búsqueda sigue apareciendo, sin datos personales (FR-067).

---

### User Story 11 - Editar una cita (Priority: P1)

Una clienta que venía a cortarse el pelo llama para añadir la barba de su marido a continuación, o la dueña se da cuenta de que apuntó mal un teléfono. La dueña abre la cita y cambia sus servicios o los datos del cliente, sin cancelarla y apuntarla de nuevo.

**Why this priority**: sustituye a «cancelar y apuntar otra», que para una cita online rompía el enlace del cliente, perdía la fecha de reserva y, en el rato entre cancelar y volver a apuntar, dejaba la hora libre para que la reservara otra persona. Es un cambio de todos los días y pertenece a la gestión manual, con las Historias 4 a 6.

**Independent Test**: se añade un servicio a una cita con hueco detrás y se comprueba que la cita se alarga y que el hueco deja de ofrecerse; se añade otro a una cita con otra detrás y se comprueba que sale el aviso de conflicto; se corrige un teléfono y se comprueba que el enlace del cliente sigue funcionando.

**Acceptance Scenarios**:

1. **Given** una cita online de 11:00 con «Corte de pelo», de 30 minutos, y las 11:30 libres, **When** la dueña le añade «Diseño y corte de barba», de 30 minutos, **Then** ve la duración total de una hora y la nueva hora de fin, 12:00, antes de guardar; al guardar, la cita va de 11:00 a 12:00 y las 11:30 dejan de ofrecerse.
2. **Given** una cita con dos servicios, **When** la dueña quita uno, **Then** la cita dura sólo lo que dura el que queda y el tiempo liberado vuelve a ofrecerse; y **When** intenta quitar el último, **Then** el sistema se lo impide y le explica que una cita tiene al menos un servicio.
3. **Given** una cita de 11:00 a 11:30 y otra de Ana a las 11:30, **When** la dueña le añade a la primera un servicio de 30 minutos, **Then** el aviso nombra la cita de Ana con su hora y sus servicios, exactamente como al mover una cita, y nada cambia hasta que la dueña lo resuelva o lo abandone.
4. **Given** una cita reservada con un servicio de 15,00 € cuyo precio en el catálogo es hoy 18,00 €, **When** la dueña le añade otro servicio, **Then** el que ya tenía sigue a 15,00 € y el añadido lleva el precio y la duración de hoy.
5. **Given** una cita con el teléfono mal apuntado, **When** la dueña corrige el nombre, el teléfono o el email, **Then** la cita guarda los datos nuevos; y si el teléfono nuevo no tiene un formato válido, el sistema lo rechaza diciendo qué campo falla, igual que en una reserva.
6. **Given** una cita reservada online, **When** la dueña le cambia los servicios, **Then** el enlace del cliente sigue funcionando y muestra los servicios, la duración y el precio nuevos; la pantalla de la dueña le recuerda que el cliente no recibe ningún aviso y le muestra su teléfono.
7. **Given** una cita cancelada o ya terminada, **When** la dueña la abre, **Then** no puede editarla; **Given** una cita en curso, **Then** sí puede.
8. **Given** una cita con un servicio que la dueña retiró del catálogo después de reservarse, **When** le añade otro servicio, **Then** el retirado se queda en la cita con su nombre, su duración y su precio originales; lo que no puede es añadir un servicio retirado.

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
- **Cita de varios servicios con uno ya retirado**: la cita sigue intacta en la agenda y en el listado con los servicios con los que se reservó, y se puede mover, editar y cancelar igual que cualquier otra. Mover no vuelve a consultar el catálogo: la duración es la suma de sus servicios guardados. Editar sólo lo consulta para los servicios que se añaden.
- **Cita manual con un servicio sin precio**: se crea igual. La agenda y el listado no muestran ningún importe como 0; el precio total sigue la regla de la 005 (suma de los conocidos y «+ precio a consultar en el salón» si falta alguno).
- **Cita anonimizada por retención en el listado**: a los 12 meses los datos personales se borran (BR-018 de la 001). La fila sigue apareciendo, con su día, sus servicios, su estado, su origen y quién la canceló, y en lugar del nombre y el teléfono dice que se borraron por antigüedad. Una búsqueda no la encuentra nunca, porque no le queda nombre ni teléfono con que compararla.
- **Cita cancelada por la dueña y después consultada por el cliente**: el cliente abre su enlace y lee «El salón ha cancelado esta cita», con el teléfono del salón para llamar. Si la canceló él, lee «Has cancelado esta cita». Lo demás de la pantalla es igual en los dos casos.
- **Búsqueda con un teléfono a medias**: un término formado sólo por cifras, con o sin espacios y prefijo, se busca como teléfono, y un teléfono se compara entero. Si no llega a ser un teléfono válido, el listado lo explica y pide escribirlo completo, en lugar de devolver un vacío que se confundiría con «no hay ninguna cita».
- **Editar una cita en curso**: se puede, como moverla o cancelarla (clarificación del 2026-09-16). La hora de inicio no cambia; si se alarga, el fin se calcula desde ese inicio y el conflicto se comprueba igual.
- **Editar alargando hasta pisar un rato bloqueado o el cierre**: el rato bloqueado es un conflicto, con las salidas de FR-034. Terminar después de la hora de cierre es un aviso, como al moverla (FR-028): se confirma y se guarda.
- **Editar el teléfono hacia el de un cliente con tres citas futuras**: se impide, igual que apuntarle una cuarta (FR-029). La propia cita no cuenta para el límite.
- **Editar una cita online y quitarle el email**: se permite. El enlace sigue funcionando, porque no depende del email, y la cita se queda sin email como una apuntada a mano.
- **Cita editada mientras el cliente tiene su enlace abierto**: el cliente ve los servicios nuevos al recargar. Si intenta reprogramar con la pantalla vieja, la reprogramación usa la duración que la cita tiene **ahora**, no la de su pantalla.
- **Reserva que entra mientras la dueña mira el listado**: el listado no se actualiza solo. La reserva aparece al recargar o al cambiar de página, y la paginación no repite ni salta filas por ese motivo dentro de una misma consulta.

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
- **FR-014**: Cada cita de la agenda DEBE mostrar hora de inicio y fin, **todos sus servicios** en el orden del catálogo, nombre y teléfono del cliente, y su estado. Los servicios DEBEN leerse en la misma consulta que las citas del día, sin una consulta por cita.
- **FR-015**: Las citas canceladas NO DEBEN aparecer en la línea temporal por defecto; la dueña DEBE poder mostrarlas mediante un control explícito.
- **FR-016**: Las citas de franjas ya pasadas DEBEN ser de sólo lectura: no se crean, ni se mueven, ni se editan, ni se cancelan. Una franja se considera pasada cuando su **hora de fin** ya transcurrió; mientras una cita está en curso (empezada, no terminada) sigue siendo movible, editable y cancelable.
- **FR-017**: Un día sin citas DEBE mostrar un estado vacío que distinga "sin citas" de "cerrado".

#### Periodos no disponibles

- **FR-018**: La dueña DEBE poder crear un periodo no disponible indicando instante de inicio e instante de fin, en múltiplos de 15 minutos, con un motivo interno opcional. Un mismo periodo DEBE poder abarcar desde una fracción de un día hasta varias semanas.
- **FR-019**: La dueña DEBE poder eliminar o acortar un periodo no disponible existente.
- **FR-020**: Un periodo no disponible DEBE comportarse ante el cliente exactamente como tiempo cerrado: ningún hueco que se solape con él se ofrece.
- **FR-021**: El motivo de un periodo no disponible NO DEBE exponerse nunca al cliente.
- **FR-022**: Crear un periodo no disponible que se solape, total o parcialmente, con una o más citas confirmadas DEBE listarlas y exigir confirmación explícita, y NO DEBE cancelar ninguna.
- **FR-023**: El sistema DEBE rechazar periodos cuyo inicio no preceda a su fin.

#### Citas manuales

- **FR-024**: La dueña DEBE poder crear una cita indicando **uno o varios servicios** del catálogo activo, sin repetir ninguno, fecha y hora de inicio, nombre y teléfono del cliente. El email es opcional. Sin ningún servicio, la cita no se crea.
- **FR-025**: Una cita creada a mano DEBE quedar marcada como tal de forma permanente, y esa marca DEBE sobrevivir a las reprogramaciones y a las ediciones.
- **FR-026**: Una cita creada a mano NO DEBE entregar al cliente enlace de gestión: no se reserva online y v1 no tiene forma de hacérselo llegar.
- **FR-027**: La duración de una cita manual DEBE ser la **suma** de las duraciones de los servicios elegidos, igual que en una reserva online (FR-007 de la 005), y DEBE mostrarse antes de guardar. Cada servicio se guarda con su snapshot de nombre, duración y precio (FR-014 de la 005).
- **FR-028**: La dueña NO DEBE estar sujeta a la antelación mínima de reserva, al horizonte de reserva, al plazo de cancelación ni al horario de apertura al crear o mover citas.
- **FR-029**: La dueña SÍ DEBE estar sujeta al límite de citas futuras confirmadas por contacto, igual que el cliente.
- **FR-030**: El sistema NO DEBE permitir crear ni mover citas a franjas ya pasadas.
- **FR-031**: Los datos de cliente de una cita manual DEBEN validarse con las mismas reglas de formato que los de una reserva online.

#### Conflictos

- **FR-032**: Antes de guardar cualquier creación, reprogramación o edición manual, el sistema DEBE detectar solapes con citas confirmadas y con periodos no disponibles.
- **FR-033**: El aviso de conflicto DEBE nombrar el elemento que estorba: para una cita, el nombre del cliente, sus servicios y su franja; para un periodo no disponible, su franja y su motivo.
- **FR-034**: El aviso DEBE ofrecer únicamente salidas explícitas: abandonar la operación, o resolver el conflicto cancelando la cita que estorba, moviéndola, o eliminando o acortando el periodo no disponible.
- **FR-035**: El sistema NUNCA DEBE permitir que dos citas confirmadas se solapen, ni siquiera por decisión explícita de la dueña.
- **FR-036**: Abandonar la operación en el aviso DEBE dejar tanto la cita existente como el intento sin ningún cambio.
- **FR-037**: La resolución del conflicto y la cita nueva, movida o editada DEBEN aplicarse como una sola operación indivisible: o se aplican ambas, o no se aplica ninguna.
- **FR-038**: Si el estado cambió entre el cálculo del conflicto y su confirmación, el sistema DEBE rechazar la operación y volver a presentar el conflicto recalculado.

#### Gestión de citas existentes

- **FR-039**: La dueña DEBE poder reprogramar cualquier cita confirmada, online o manual, conservando sus servicios, su duración total —la suma de sus snapshots, no la del catálogo de hoy— y sus datos de cliente. Reprogramar NO DEBE cambiar los servicios: para eso está editar la cita (Historia 11).
- **FR-040**: La dueña DEBE poder cancelar cualquier cita confirmada, online o manual, con confirmación explícita previa.
- **FR-040a**: Toda cancelación DEBE registrar quién la hizo: el **cliente**, desde su enlace de gestión, o la **dueña**, desde la gestión. El dato se guarda en el mismo cambio que cancela la cita y no se modifica después.
- **FR-040b**: La pantalla de la cita del cliente, en su enlace, DEBE decir quién la canceló: «Has cancelado esta cita» si la canceló él, y «El salón ha cancelado esta cita», junto al teléfono del salón, si la canceló la dueña.
- **FR-041**: Reprogramar o editar una cita reservada online DEBE conservar su enlace de gestión en funcionamiento.
- **FR-042**: Una cita cancelada DEBE ser terminal: no se reactiva, ni se mueve, ni se edita.
- **FR-043**: Tras cancelar, reprogramar o editar una cita reservada online, el sistema DEBE advertir a la dueña de que el cliente no recibe ningún aviso y mostrarle el teléfono del cliente.

#### Edición de citas

- **FR-071**: La dueña DEBE poder editar una cita confirmada cuya hora de fin no haya pasado (FR-016), online o manual: sus **servicios** —añadir, quitar o cambiar uno por otro— y los **datos del cliente** —nombre, teléfono y email—. Una cita cancelada o ya terminada no se edita.
- **FR-072**: Una cita editada DEBE quedarse con al menos un servicio y sin repetidos. Los servicios que ya tenía DEBEN conservar su snapshot —el nombre, la duración y el precio con que se reservaron—, aunque el catálogo haya cambiado o el servicio se haya retirado. Los que se añaden DEBEN ser del catálogo activo y se guardan con el nombre, la duración y el precio de ese momento (FR-014 de la 005).
- **FR-073**: Editar NO DEBE cambiar la hora de inicio, el origen, el momento de la reserva ni el enlace de gestión. La duración pasa a ser la suma de los servicios resultantes, la hora de fin se recalcula con ella (BR-020), y las dos DEBEN mostrarse antes de guardar.
- **FR-074**: Si la cita editada se alarga y pisa una cita confirmada o un periodo no disponible, el sistema DEBE presentar el mismo aviso de conflicto que al moverla, con las mismas salidas, la misma operación indivisible y la misma comprobación de que el estado no cambió (FR-032 a FR-038). Si pasa a terminar fuera del horario de apertura, DEBE avisar como al moverla (FR-028).
- **FR-075**: Los datos del cliente editados DEBEN validarse con las mismas reglas de formato que los de una reserva (FR-031). El email es opcional, como en una cita a mano (FR-024). Si cambia el teléfono o el email, el límite de citas futuras por contacto DEBE evaluarse para el contacto nuevo, sin contar la propia cita (FR-029).
- **FR-076**: Una cita online editada DEBE mostrar en el enlace del cliente sus servicios, su duración, su precio y sus datos nuevos. El cliente sigue sin poder cambiar los servicios desde su enlace (FR-017 de la 005).

#### Horario de apertura

- **FR-044**: La dueña DEBE poder ver y editar los tramos de apertura de cada día de la semana, con cero, uno o varios tramos por día.
- **FR-045**: El sistema DEBE rechazar tramos cuyo inicio no preceda a su fin, tramos que crucen la medianoche y tramos del mismo día que se solapen, explicando el motivo del rechazo.
- **FR-046**: Un día de la semana sin ningún tramo DEBE presentarse al cliente como cerrado, nunca como lleno.
- **FR-047**: Reducir el horario NO DEBE cancelar ni modificar citas ya confirmadas; el sistema DEBE listar antes de guardar las que queden fuera del nuevo horario.

#### Catálogo de servicios

- **FR-048**: La dueña DEBE poder añadir un servicio con nombre, duración y, opcionalmente, precio. Un servicio sin precio se muestra como «Precio a consultar en el salón» (FR-019 de la 005).
- **FR-049**: La dueña DEBE poder editar el nombre, la duración, el precio —ponerlo, cambiarlo o quitarlo— y el orden de presentación de un servicio existente.
- **FR-050**: La dueña DEBE poder retirar un servicio del catálogo y volver a activarlo. Retirarlo NO DEBE alterar ni cancelar ninguna cita existente.
- **FR-051**: El sistema DEBE impedir retirar el último servicio activo del catálogo.
- **FR-052**: Cambiar la duración o el precio de un servicio NO DEBE alterar las citas ya confirmadas, que conservan los valores con los que se reservaron, también cuando el servicio era uno de varios de la cita.
- **FR-053**: El sistema DEBE rechazar servicios con duración no positiva o con un precio de cero o negativo. La ausencia de precio se expresa dejando el precio vacío, nunca con un 0 (D-002 de la 005).

#### Listado de reservas

- **FR-060**: La dueña DEBE poder consultar un listado de reservas con una fila por cita, que muestre día y hora, todos sus servicios, nombre y teléfono del cliente, estado, origen y fecha en que se hizo la reserva.
- **FR-061**: El listado DEBE ofrecer dos órdenes: *Próximas citas*, por defecto, con las citas de hoy en adelante ordenadas por su inicio; y *Últimas reservas recibidas*, sin límite de fecha —también las citas ya pasadas— y ordenadas por su momento de creación, de la más reciente a la más antigua.
- **FR-062**: El listado DEBE poder filtrarse por estado (*Confirmadas*, por defecto; *Canceladas*; *Todas*), por origen (online, a mano o ambos) y por un rango de fechas de la cita. Los filtros se combinan entre sí y con cualquiera de los dos órdenes.
- **FR-063**: Una cita cancelada DEBE mostrarse en el listado con la etiqueta «Cancelada» en texto e icono, nunca sólo con color, su fecha de cancelación y quién la canceló (FR-040a): «Cancelada por el cliente» o «Cancelada por ti».
- **FR-064**: El listado DEBE estar paginado de 20 en 20, con *Página siguiente* y *Volver al principio*, y la paginación DEBE conservar el orden, los filtros y la búsqueda sin repetir ni saltarse filas.
- **FR-065**: Cada fila DEBE llevar a la agenda del día de esa cita (Historia 2).
- **FR-066**: Una página del listado DEBE resolverse con un número fijo de consultas, servicios incluidos, que no crezca con el número de filas ni con el histórico de citas.
- **FR-067**: Una cita anonimizada por retención DEBE seguir apareciendo en el listado, sin datos personales y con un texto que explique que se borraron por antigüedad.
- **FR-068**: Unos filtros o una búsqueda sin resultados DEBEN mostrar un estado vacío que lo explique y ofrezca volver a los filtros por defecto.
- **FR-069**: El listado DEBE poder buscarse por nombre o por teléfono del cliente desde un único campo, combinable con los filtros, con los dos órdenes y con la paginación. Un término formado sólo por cifras —con o sin espacios, puntos, guiones y prefijo `+34` o `0034`— es un teléfono, y se compara **entero** y sin esos separadores ni prefijo; si no es un teléfono válido, el sistema lo explica. Cualquier otro término es un nombre, y se compara sin distinguir mayúsculas ni acentos y **por una parte**: «nuñ» encuentra a «José Núñez».
- **FR-070**: Una búsqueda NO DEBE encontrar citas anonimizadas. Sin búsqueda, siguen apareciendo como dice FR-067.

#### Parámetros de reserva

- **FR-054**: La dueña DEBE poder ver y editar la antelación mínima de reserva y el plazo límite de cancelación, cada uno dentro de un rango admitido y explicado en pantalla.
- **FR-055**: Un parámetro modificado DEBE aplicarse a partir de ese momento, evaluándose en el instante en que el cliente actúa, y NO DEBE reabrir ni deshacer plazos ya consumidos.

#### Transversales

- **FR-056**: Todo cambio de configuración —horario, periodos no disponibles, catálogo, parámetros— DEBE reflejarse en la siguiente consulta de disponibilidad del cliente, sin despliegue ni reinicio.
- **FR-057**: Los datos personales de los clientes visibles en estas pantallas NO DEBEN aparecer en logs, trazas ni analítica, igual que en el flujo de cliente.
- **FR-058**: Toda pantalla de esta feature DEBE ser plenamente usable en móvil a 360 px y cumplir WCAG 2.2 AA, con el estado transmitido siempre por texto además de por color. Además DEBE adaptarse a tablet (≥ 640 px) y ordenador (≥ 1024 px) con la base responsive de la `003-responsive-desktop`, sin anchos de corte propios.
- **FR-059**: Toda acción DEBE devolver feedback explícito de carga, éxito o error, con mensajes accionables.

### Reglas de negocio

- **BR-001**: No existen dos citas confirmadas que se solapen. Ni por reserva online, ni por acción manual, ni resolviendo un conflicto.
- **BR-002**: Un periodo no disponible equivale, para el cliente, a tiempo cerrado. Nunca se ofrece un hueco que lo pise.
- **BR-003**: Retirar un servicio no toca las citas que lo referencian. La cita conserva el nombre, la duración y el precio de cada uno de sus servicios, congelados al reservarse.
- **BR-004**: Reducir el horario de apertura no cancela retroactivamente ninguna cita. Sólo deja de ofrecerse disponibilidad nueva.
- **BR-005**: Resolver un conflicto es siempre una acción explícita, nombrada y confirmada por la dueña. No existe la resolución automática.
- **BR-006**: Los parámetros de reserva se evalúan con el valor vigente en el instante de la acción. Ni se aplican retroactivamente ni se reabren plazos pasados.
- **BR-007**: La dueña está exenta de la antelación mínima, del horizonte de reserva, del plazo de cancelación y del horario de apertura. No está exenta del límite de citas futuras por contacto.
- **BR-008**: La cancelación es terminal para cualquier cita, la haya cancelado el cliente o la dueña.
- **BR-009**: El pasado es de sólo lectura. Ninguna acción de la dueña crea, mueve, edita ni cancela nada en una franja cuya hora de fin ya transcurrió. Una cita en curso (empezada, no terminada) no es pasado: sigue siendo movible, editable y cancelable.
- **BR-010**: El catálogo tiene siempre al menos un servicio activo.
- **BR-011**: Toda cita, creada por quien sea, tiene nombre y teléfono de cliente mientras no se anonimice por retención.
- **BR-019**: Toda cita cancelada sabe quién la canceló, el cliente o la dueña, y una confirmada no tiene ese dato. Es un hecho de la cancelación, no un registro de auditoría: no se guarda nada más sobre quién hizo qué. (Numerada a continuación de las BR-012 a BR-018 de la 001, que esta feature cita sin prefijo.)
- **BR-020**: Una cita dura la suma de sus servicios guardados, la cree el cliente o la dueña. Esa duración no cambia al moverla; sólo cambia cuando la dueña edita sus servicios.
- **BR-021**: Un servicio guardado en una cita no cambia nunca: ni al moverla, ni al editarla, ni al cambiar o retirar el servicio del catálogo. Editar los servicios de una cita quita snapshots o añade otros nuevos, tomados del catálogo activo en ese momento; nunca reescribe los que ya tenía.

### Key Entities

- **Cuenta de la dueña**: la única identidad de personal. Usuario, credencial verificable y momento del último cambio de contraseña. No contiene datos de clientes.
- **Sesión**: el acceso vigente de la dueña, con su momento de creación y de última actividad. Es lo que FR-002 exige y lo que FR-007 caduca.
- **Periodo no disponible**: un intervalo con inicio y fin arbitrarios y un motivo interno opcional. Generaliza y sustituye al cierre de día completo actual: un festivo es un periodo de un día, unas vacaciones uno de dos semanas, la comida uno de una hora.
- **Tramo de apertura**: un intervalo horario de un día de la semana. Pasa de ser configuración de arranque a dato editable; su semántica no cambia.
- **Servicio**: una prestación del catálogo, con nombre, duración, precio opcional, orden y estado activo o retirado. Pasa de ser configuración de arranque a dato editable.
- **Parámetros de reserva**: la antelación mínima y el plazo de cancelación del salón. Pasan de constantes del sistema a configuración editable, con rangos admitidos.
- **Cita**: la entidad existente, con **uno o varios servicios** desde la 005, ampliada con su **origen** —reservada online o creada por la dueña—, con un email de cliente que ahora puede faltar en las creadas a mano y, si está cancelada, con **quién la canceló**.
- **Servicio de la cita**: cada servicio de una cita, con el nombre, la duración y el precio que tenía al reservarse o, si la dueña lo añadió al editarla, al añadirse. Existe desde la 005; esta feature lo lee en la agenda y en el listado, y lo escribe al apuntar citas a mano y al editarlas.
- **Listado de reservas**: no se persiste. Es una consulta paginada sobre las citas con un orden, unos filtros y, si la dueña la escribe, una búsqueda por nombre o teléfono.

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
- **SC-013**: Una página del listado de reservas se abre en menos de 2 segundos en un móvil de gama media sobre 4G, con el mismo número de consultas con la base vacía que con 10.000 citas en el histórico.
- **SC-014**: El 100 % de las citas canceladas del listado indican quién las canceló, y el 100 % de las citas con varios servicios muestran todos sus servicios, en la agenda y en el listado.
- **SC-015**: La dueña añade un servicio a una cita existente en menos de 30 segundos desde la agenda abierta, en móvil, y el 100 % de las ediciones que la alargarían sobre otra cita muestran el conflicto antes de guardar nada.
- **SC-016**: Buscar un cliente por cualquiera de las formas de escribir su teléfono o por cualquier parte de su nombre, con o sin acentos y mayúsculas, lo encuentra en el 100 % de los casos de prueba, con una consulta por página igual que sin búsqueda (SC-013).

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
- **Sin auditoría**: no se registra quién cambió qué. Hay una sola persona con acceso, y la constitución no exige trazabilidad de personal. La única excepción es **quién canceló** una cita (FR-040a), que es un dato de la cita y no un registro de cambios: distingue si la cancelación la hizo el cliente o la dueña, y nada más.
- **Cancelaciones anteriores a esta feature**: todas las hizo el cliente desde su enlace, porque no había otra forma de cancelar. Así se registran al migrar.
- **Tamaño de página del listado**: 20 citas, fijo, sin que la dueña lo elija (FR-064).
- **Rango de fechas del listado**: se aplica al día de la cita, en los dos órdenes. Ordenar por *Últimas reservas recibidas* no cambia a qué fecha se refiere el filtro.
- **Búsqueda en el listado, sin ficha de cliente**: buscar por nombre o teléfono filtra citas; no agrupa por cliente ni construye un historial. Cada cita sigue guardando sus propios datos, y dos citas del mismo cliente con el nombre escrito de dos formas aparecen las dos si el término encaja en ambas.
- **Búsqueda sin email**: el campo busca por nombre y por teléfono, que son los datos que toda cita tiene. El email puede faltar en las citas a mano y no se busca.
- **Editar no mueve**: editar una cita no cambia su hora de inicio. Si la dueña quiere otra hora y otros servicios, mueve la cita y la edita, en dos pasos.
- **Email opcional al editar**: como en una cita a mano. Quitar el email de una cita online no rompe su enlace, que no depende de él.
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
- Vista de semana o de mes en la agenda. Sólo día, navegable. El listado de reservas (Historia 10) no es una vista de calendario: es una lista.
- Edición de la duración de una cita concreta al margen de la suma de sus servicios.
- Que el **cliente** cambie los servicios de su cita desde el enlace. Sólo la dueña los edita (Historia 11); el cliente sigue cancelando y reservando de nuevo, como en la 005.
- Cambiar la hora y los servicios de una cita en una sola operación. Son dos acciones: mover y editar.
- Buscar en el listado por email, o por cualquier dato que no sea el nombre o el teléfono. Exportar el listado.
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
  - La **cancelación del cliente** pasa a registrar que la hizo el cliente (FR-040a).
  - La **pantalla de una cita cancelada** del cliente dice quién la canceló (FR-040b): «Has cancelado esta cita» sustituye al texto actual, y si la canceló el salón, «El salón ha cancelado esta cita» con su teléfono. El contrato HTTP de cliente pasa de la 2.0.0 a la **2.1.0**, que añade `cancelledBy` a la cita.
  - Una cita online puede **cambiar de servicios** después de reservarse, porque la dueña la edita (Historia 11). El enlace del cliente ya lee los servicios de la cita en cada consulta y los muestra sin cambios de código; reprogramar desde el enlace usa la duración que la cita tiene en ese momento.
- **Feature `003-responsive-desktop`**: las pantallas de la dueña usan su base responsive: los anchos de 640 px y 1024 px, las clases `.page--split`, `.site-header--split`, `.col-main`, `.col-side` y `.wide-only` de `src/app/globals.css`, y `NavForm` para los formularios GET de navegación, como los filtros del listado.
- **Feature `005-multiple-services`**: esta feature usa su modelo tal cual. Una cita tiene sus servicios en `appointment_service`, cada uno con su snapshot; la duración es su suma; el precio es opcional y el precio total lo decide el dominio (`totalPriceOf`). La revalidación del catálogo al confirmar (FR-015 de la 005) ya cubre el escenario 6 de la Historia 8. Lo único que la Historia 11 añade al modelo es que las filas de `appointment_service` de una cita se pueden quitar y añadir después de reservarse; las que quedan no se reescriben (BR-021).
- **Constitución del producto** (`.specify/memory/constitution.md`): esta feature resuelve dos puntos marcados [TBD] —el **modelo de roles del personal** (rol único, sin jerarquía) y el **método de autenticación del personal** (usuario y contraseña, aprovisionada fuera de la app)— y convierte los **parámetros temporales del dominio** en configuración editable. El Principio V exige autenticación y autorización en todo punto de acceso que lea o escriba datos de clientes o citas: FR-002 es su aplicación directa.
- **Reloj y zona horaria del salón**: todas las franjas, periodos y horarios se interpretan con el reloj del servidor en la zona horaria del salón, nunca con el del dispositivo de la dueña.
