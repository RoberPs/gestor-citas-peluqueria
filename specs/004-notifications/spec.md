# Feature Specification: Email de confirmación al reservar

**Feature Branch**: `004-notifications`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "004-notifications — Avisos al cliente por email. Al reservar online, el cliente recibe un email de confirmación con los datos de la cita (día y hora en Europe/Madrid, servicios con su precio o «Precio a consultar en el salón», precio total, dirección y teléfono del salón) y su enlace de gestión, de modo que el enlace deja de depender de que lo guarde desde la pantalla de confirmación. Es el único aviso de esta feature: recordatorio, aviso de cambios o cancelación hechos por la dueña y aviso a la dueña quedan fuera por ahora. Canal: sólo email, con un proveedor de plan gratuito (Resend o Brevo). El SMS queda preparado detrás de un puerto Notifier activable por configuración, sin proveedor conectado. Cambia la decisión vigente de que v1 no envía nada (CLAUDE.md y spec 001) y activa el Principio IV de la constitución: consentimiento por canal, baja y registro de envíos. Un fallo del envío no debe impedir ni deshacer la reserva. Las citas apuntadas a mano por la dueña no tienen enlace de cliente y el email es opcional (002). Nombre, teléfono y email nunca en logs."

## Contexto

Hoy la app no envía nada a nadie (001, Assumption 5). El cliente que reserva online
recibe su enlace de gestión sólo en la pantalla de confirmación, con un aviso de que
lo guarde porque «no se le va a enviar por ningún otro medio». Quien cierra la pestaña
sin guardarlo pierde la única forma de consultar, reprogramar o cancelar su cita, y
tiene que llamar al salón.

Esta feature envía al cliente que lo pida **un email de confirmación** con los datos de
su cita y su enlace. Es el primer mensaje que la app manda, y con él entra en vigor el
**Principio IV** de la constitución: consentimiento propio por canal, vía de baja en
cada mensaje, registro de envíos sin contenido y un envío que nunca afecta a la cita.

El SMS no se envía todavía: no hay opción gratuita válida para clientes reales. Queda
previsto como segundo canal, apagado, que podrá encenderse cuando se decidan proveedor
y presupuesto.

## Clarifications

### Session 2026-11-02

Decisiones de la dueña del producto recogidas en `docs/roadmap.md`:

- Q: ¿Qué avisos se envían? → A: Sólo la **confirmación al reservar**, enviada al
  cliente con los datos de la cita y su enlace de gestión. Recordatorio, aviso de
  cambios hechos por la dueña y aviso a la dueña quedan fuera por ahora.
- Q: ¿Por qué canal? → A: Sólo **email**, con un plan gratuito. El SMS queda preparado
  como canal apagado y se activará cuando se decidan proveedor y presupuesto.
- Q: ¿Cuándo se hace? → A: Después del MVP completo de la 002.

### Session 2026-11-04

- Q: ¿La baja afecta sólo a la cita de ese email o a la dirección para cualquier cita
  futura? → A: **Sólo a esa cita.** Los datos de contacto no forman un perfil (001) y no
  se guarda ninguna lista de direcciones dadas de baja, que sería un dato personal fuera
  del conjunto mínimo del Principio III. En cada reserva el cliente vuelve a decidir con
  la casilla.
- Q: Cuando la confirmación de una cita no llega a salir, ¿debe verlo la dueña? → A:
  **Sí, sólo las fallidas.** La agenda y el listado marcan, con texto e icono, las
  citas online cuya confirmación falló definitivamente, con el teléfono del cliente
  para llamarle. El resto de estados del envío no se muestran.
- Q: ¿Desde qué dirección salen los emails? → A: **Desde el dominio propio del salón si
  lo tiene**; si no, desde el dominio donde se publica la app, con el nombre del salón
  como remitente visible y las respuestas dirigidas al email del salón. La dirección de
  envío es configuración, así que pasar de uno a otro no cambia la feature. Falta
  confirmar con el cliente si tiene dominio.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recibir la confirmación por email al reservar (Priority: P1)

Un cliente reserva online un corte y una barba para el viernes a las 11:30. En el
formulario, además de sus datos, marca «Enviadme la confirmación por email». Confirma,
ve la pantalla de confirmación de siempre y, al poco, le llega un email con el día y la
hora, los servicios y su precio, la dirección y el teléfono del salón y el enlace para
gestionar la cita. Ya no tiene que acordarse de guardar el enlace: lo tiene en su
correo.

**Why this priority**: es el motivo de la feature. Resuelve que el enlace dependa de
que el cliente lo guarde desde una pantalla que puede cerrar sin querer.

**Independent Test**: con el canal de email encendido y un buzón de pruebas, reservar
online marcando la casilla y comprobar que llega un único email con los datos de la
cita y un enlace que abre esa misma cita.

**Acceptance Scenarios**:

1. **Given** el formulario de reserva online, **When** el cliente llega a él, **Then**
   ve una casilla **desmarcada** para recibir la confirmación por email, con un texto
   que dice que sólo recibirá la confirmación de esta cita, sin publicidad, y que puede
   darse de baja desde el propio email.
2. **Given** el cliente ha marcado la casilla, **When** confirma la reserva, **Then** la
   cita queda confirmada como siempre y recibe **un** email de confirmación en la
   dirección que escribió.
3. **Given** el email de confirmación, **When** el cliente lo lee, **Then** contiene el
   nombre del salón, el día con su día de la semana, la hora de inicio y de fin en hora
   del salón, cada servicio con su precio o «Precio a consultar en el salón», el precio
   total, el plazo para cancelar o reprogramar, la dirección y el teléfono del salón, el
   enlace de gestión y la vía de baja.
4. **Given** el email de confirmación, **When** el cliente pulsa el enlace de gestión,
   **Then** se abre la pantalla de su cita, la misma que desde la pantalla de
   confirmación.
5. **Given** el cliente **no** ha marcado la casilla, **When** confirma la reserva,
   **Then** la cita se confirma igual y no se le envía nada.
6. **Given** el cliente ha marcado la casilla, **When** ve la pantalla de confirmación,
   **Then** se le dice a qué dirección se le envía la confirmación y se le sigue
   ofreciendo el enlace con la recomendación de guardarlo, por si el email no llega.
7. **Given** una cita apuntada a mano por la dueña, **When** se crea, **Then** no se
   envía nada al cliente, tenga o no email.

---

### User Story 2 - Darse de baja del email (Priority: P2)

El cliente ya no quiere recibir emails del salón sobre su cita. Pulsa «Darme de baja»
al pie del email, confirma en la página que se abre y deja de recibir emails sobre esa
cita. Su cita sigue intacta.

**Why this priority**: el Principio IV lo exige en todo mensaje enviado. Con un único
aviso por cita su efecto inmediato es pequeño, pero sienta la regla que respetarán los
avisos que vengan después (recordatorios, cambios hechos por la dueña).

**Independent Test**: desde un email de confirmación recibido, abrir la vía de baja,
confirmar y comprobar que la cita sigue confirmada y que el consentimiento de email de
esa cita figura como revocado, con su fecha.

**Acceptance Scenarios**:

1. **Given** un email de confirmación, **When** el cliente abre su vía de baja, **Then**
   ve una página que nombra el salón y le pide confirmar la baja con un botón; abrir la
   página sola no da de baja.
2. **Given** esa página, **When** el cliente confirma, **Then** ve un mensaje de que ya
   no recibirá emails y la baja queda registrada con su fecha, sin cambiar nada de la
   cita.
3. **Given** una baja ya hecha, **When** el cliente vuelve a abrir la vía de baja,
   **Then** se le dice que ya está dado de baja, sin error.
4. **Given** la pantalla de gestión de una cita con el email activado, **When** el
   cliente la abre, **Then** ve que tiene activada la confirmación por email y puede
   darse de baja desde ahí también.
5. **Given** una vía de baja que no corresponde a ninguna cita, está malformada o apunta
   a una cita cuyos datos personales ya se han borrado, **When** se abre, **Then** se
   muestra el mismo mensaje neutro que para un enlace de gestión inválido (FR-019 de la
   001).

---

### User Story 3 - El envío nunca pone en riesgo la reserva (Priority: P3)

El proveedor de email está caído durante la mañana. Los clientes siguen reservando con
normalidad y viendo su pantalla de confirmación al instante. Los emails pendientes se
reintentan solos y salen en cuanto el proveedor vuelve; los que no salen en el plazo de
reintento quedan anotados como fallidos. Ninguna cita se pierde ni cambia.

**Why this priority**: es la garantía que hace aceptable enviar emails en un producto
cuyo activo es la agenda. Se prioriza después de US1 y US2 porque US1 ya entrega valor
con un proveedor que responde, pero no se cierra la feature sin ella.

**Independent Test**: con el proveedor simulado caído, reservar con la casilla marcada;
comprobar que la reserva responde en el tiempo de siempre, que la cita existe, que el
envío queda pendiente y que, al volver el proveedor dentro del plazo, sale un único
email; y que, si no vuelve, el envío queda fallido y la cita intacta.

**Acceptance Scenarios**:

1. **Given** el proveedor de email no responde, **When** el cliente confirma una reserva
   con la casilla marcada, **Then** la cita se confirma y la pantalla de confirmación se
   muestra en el mismo tiempo que sin email.
2. **Given** un envío fallido por un error transitorio, **When** el proveedor vuelve
   dentro del plazo de reintento, **Then** el email sale una sola vez.
3. **Given** un envío que sigue fallando al acabar el plazo de reintento, **When** se
   agota, **Then** el envío queda registrado como fallido y la cita no cambia.
4. **Given** una cita online cuya confirmación ha fallado definitivamente, **When** la
   dueña la ve en la agenda o en el listado, **Then** está marcada con el texto
   «Confirmación por email no enviada» y un icono, y la dueña tiene a mano el teléfono
   del cliente para avisarle de su enlace.
5. **Given** un envío todavía pendiente, **When** el cliente cancela la cita o la
   reprograma antes de que salga, **Then** si la cancela, no se envía; si la reprograma,
   el email sale con la hora nueva.
6. **Given** cualquier envío, **When** se registra, **Then** el registro guarda la cita,
   el canal, el tipo de aviso, el estado y el momento, y nunca el contenido ni la
   dirección de email.

---

### Edge Cases

- **Dos clics en «Confirmar»**: una sola cita (como en la 001) y un solo email.
- **Email que no existe o con una errata**: el proveedor lo acepta o lo rechaza. Si lo
  rechaza al enviarlo, el envío queda fallido. Los rebotes que el proveedor notifique
  más tarde no se procesan en esta feature. La cita no cambia en ningún caso.
- **El email llega a la carpeta de spam**: la pantalla de confirmación lo advierte y
  sigue ofreciendo el enlace.
- **Mismo email en varias citas**: cada cita tiene su propio consentimiento y su propia
  confirmación. Los datos de contacto no forman un perfil (001).
- **La dueña cambia o quita el email de una cita online antes de que salga la
  confirmación** (Historia 11 de la 002): no se envía, porque el consentimiento se dio
  para la dirección que escribió el cliente. El registro lo anota como no enviado.
- **La dueña mueve, edita o cancela una cita online**: no se envía nada, como hasta
  ahora (FR-043 de la 002). El email ya recibido puede quedar desactualizado; por eso
  dice que el enlace muestra siempre los datos vigentes.
- **El cliente reprograma o cancela después de recibir el email**: no se envía nada
  nuevo. El enlace del email sigue mostrando la cita como está.
- **Un antivirus o el gestor de correo abre los enlaces del email por su cuenta**: abrir
  la vía de baja no da de baja; hace falta confirmar con el botón.
- **El enlace del email se abre después del borrado a 12 meses**: mensaje neutro, como
  cualquier enlace inválido (BR-018 de la 001). La vía de baja deja de resolver en el
  mismo acto.
- **Confirmación fallida de una cita que luego se cancela o ya ha pasado**: la marca
  desaparece; ya no hay nada que avisar.
- **Borrado de datos a petición con un envío pendiente**: el envío se descarta y queda
  registrado como no enviado.
- **El canal de email está apagado** (por ejemplo, en una instalación sin proveedor
  configurado): el formulario no ofrece la casilla y la pantalla de confirmación dice lo
  mismo que en la 001.
- **El canal de SMS**: mientras esté apagado no se ofrece su consentimiento ni se envía
  nada por él.

## Requirements *(mandatory)*

### Functional Requirements

**Consentimiento**

- **FR-001**: El formulario de reserva online DEBE ofrecer una casilla para recibir la
  confirmación por email, **desmarcada** por defecto, con un texto que diga qué se va a
  recibir —sólo la confirmación de esta cita, sin publicidad— y que la baja es posible
  desde el propio email.
- **FR-002**: Marcar la casilla DEBE registrar el consentimiento de email de esa cita
  con el momento en que se dio, en el mismo cambio que crea la cita. No marcarla no
  impide reservar.
- **FR-003**: El consentimiento DEBE ser por canal: el de email no vale para SMS ni al
  revés, y revocar uno no afecta al otro ni a la cita.
- **FR-004**: Mientras un canal esté apagado por configuración, el formulario NO DEBE
  ofrecer su consentimiento y el sistema NO DEBE enviar nada por él. En esta feature el
  SMS está siempre apagado.

**Envío de la confirmación**

- **FR-005**: Tras confirmarse una reserva online con consentimiento de email vigente,
  el sistema DEBE enviar **un único** email de confirmación a la dirección de la cita.
- **FR-006**: El email DEBE contener: el nombre del salón; el día, con su día de la
  semana, y las horas de inicio y fin en la zona horaria del salón; cada servicio con
  su precio o «Precio a consultar en el salón»; el precio total con la misma regla que
  la pantalla (005); el plazo para cancelar o reprogramar; la dirección y el teléfono
  del salón; el enlace de gestión; una nota de que el enlace muestra siempre los datos
  vigentes de la cita; y la vía de baja.
- **FR-007**: El email NO DEBE incluir contenido comercial ni promocional, ni otro dato
  personal que el nombre del cliente.
- **FR-008**: El contenido DEBE tomarse de la cita tal como está en el momento de
  enviarlo. Si la cita está cancelada, o su email ha cambiado o desaparecido desde la
  reserva, el email NO DEBE enviarse.
- **FR-009**: NO DEBE enviarse nada por una cita apuntada a mano por la dueña, ni por
  ningún cambio que haga la dueña en una cita, ni cuando el cliente reprograma o cancela.
- **FR-010**: El envío NO DEBE formar parte de la reserva: la cita se confirma y la
  pantalla de confirmación se muestra sin esperar al proveedor, y un fallo de envío
  NUNCA cancela, modifica ni retrasa la cita.
- **FR-011**: Un envío que falla por un error transitorio DEBE reintentarse
  automáticamente durante **1 hora** desde la reserva. Al agotarse el plazo, el envío
  DEBE quedar como fallido y no reintentarse más.
- **FR-012**: Ninguna cita DEBE recibir dos emails de confirmación, ni con reintentos ni
  con envíos repetidos del formulario.
- **FR-013**: Con el consentimiento dado, la pantalla de confirmación DEBE decir a qué
  dirección se envía la confirmación, que puede tardar unos minutos y que conviene
  mirar la carpeta de spam, y DEBE seguir mostrando el enlace de gestión con la
  recomendación de guardarlo. Sin consentimiento, o con el canal apagado, DEBE mostrar
  el aviso de la 001 (FR-015 de la 001).

**Baja**

- **FR-014**: Todo email DEBE incluir una vía de baja clara para el canal de email.
- **FR-015**: Abrir la vía de baja DEBE mostrar una página que pida confirmarla con un
  botón; abrirla sin confirmar NO DEBE dar de baja. Confirmar no DEBE exigir ningún dato
  adicional ni sesión.
- **FR-016**: La baja DEBE registrarse con su momento y detener desde ese instante todo
  envío por email **de esa cita**, sin cambiar la cita ni otros canales. No afecta a
  otras citas con la misma dirección: en cada reserva el cliente vuelve a decidir con
  la casilla. Repetirla DEBE ser inocuo.
- **FR-017**: La pantalla de gestión de una cita con consentimiento de email vigente
  DEBE indicarlo y permitir darse de baja desde ahí, con el mismo efecto que FR-016.
- **FR-018**: Una vía de baja inexistente, malformada o de una cita cuyos datos
  personales se han borrado DEBE responder con el mismo mensaje neutro que un enlace de
  gestión inválido (FR-019 de la 001), sin revelar si la cita existió.

**Registro de envíos**

- **FR-019**: Cada envío DEBE quedar registrado con la cita, el canal, el tipo de aviso,
  su estado —pendiente, enviado, fallido o no enviado, con el motivo en este último
  caso—, el momento en que se creó, el de su último cambio de estado y el número de
  intentos.
- **FR-020**: El registro NO DEBE guardar el contenido del mensaje ni la dirección de
  email.
- **FR-020a**: La agenda y el listado de la dueña DEBEN marcar, con texto e icono y no
  sólo con color, cada cita online confirmada y no pasada cuya confirmación haya
  quedado **fallida** (FR-011), y mostrar el teléfono del cliente para que la dueña le
  llame. Los demás estados del envío —pendiente, enviado, no enviado— NO se muestran.
  La marca la ve sólo la dueña, con su sesión (002).
- **FR-021**: El registro de envíos y el de consentimientos NO DEBEN contener datos
  personales, y se conservan con la cita. El borrado a 12 meses y el borrado a petición
  (FR-035 de la 001) DEBEN inutilizar la vía de baja en el mismo acto y descartar
  cualquier envío pendiente.

**Datos personales y seguridad**

- **FR-022**: Nombre, teléfono y email NO DEBEN aparecer en logs, trazas ni analítica,
  tampoco dentro de los errores que devuelva el proveedor de email.
- **FR-023**: La dirección de email y el nombre del cliente DEBEN salir de la app sólo
  hacia el proveedor de email, y sólo para enviar la confirmación de esa cita.
- **FR-024**: La vía de baja DEBE ser tan difícil de adivinar como el enlace de gestión
  y NO DEBE permitir consultar ni cambiar la cita.

**Presentación**

- **FR-025**: El email DEBE estar en español, leerse completo sin cargar imágenes,
  incluir una versión de sólo texto y escribir las fechas con palabras (por ejemplo,
  «viernes 14 de noviembre, de 11:30 a 12:30»). Los enlaces DEBEN tener un texto que
  diga adónde llevan.
- **FR-026**: La casilla del formulario, la página de baja y los textos nuevos de la
  pantalla de confirmación y de la cita DEBEN cumplir lo mismo que el resto de
  pantallas: WCAG 2.2 AA, móvil a 360 px y los tamaños de la 003.

### Key Entities *(include if feature involves data)*

- **Consentimiento de canal**: que el cliente de una cita acepta recibir avisos por un
  canal. Cita, canal, momento en que se dio y, si se revocó, momento de la baja. No
  guarda datos personales: la dirección es la de la cita.
- **Envío**: cada aviso que la app intenta mandar. Cita, canal, tipo de aviso (en esta
  feature, sólo la confirmación), estado, motivo si no se envió, número de intentos y
  momentos. Nunca el contenido ni la dirección.
- **Cita**: la entidad existente. No gana datos personales; pasa a tener, si el cliente
  lo pidió, un consentimiento de email y su envío de confirmación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Con el proveedor disponible, **el 95 %** de las confirmaciones quedan
  entregadas al proveedor en **menos de 1 minuto** desde la reserva.
- **SC-002**: La reserva sigue respondiendo **por debajo de 2 segundos** con la casilla
  marcada, también con el proveedor lento o caído.
- **SC-003**: **Cero** citas perdidas, canceladas o modificadas por un fallo de envío.
- **SC-004**: **Cero** citas con más de un email de confirmación.
- **SC-005**: **Cero** emails enviados sin consentimiento, después de una baja, por una
  cita apuntada a mano o por una cita ya cancelada.
- **SC-006**: **El 100 %** de los envíos tienen su registro, y **ningún** registro, log
  ni traza contiene el contenido del mensaje, el nombre, el teléfono ni el email.
- **SC-007**: El cliente se da de baja en **2 acciones** desde el email: abrir la vía de
  baja y confirmar.
- **SC-008**: **Cero** infracciones WCAG 2.2 AA en las comprobaciones automáticas de las
  pantallas nuevas o cambiadas a 360, 768 y 1280 px.

## Assumptions

- **Base del consentimiento**: aunque una confirmación de reserva podría justificarse
  como parte del servicio, la constitución exige consentimiento propio por canal
  (Principio IV). Por eso la casilla es explícita y empieza desmarcada.
- **El email sigue siendo obligatorio al reservar online** (FR-008 de la 001). La
  casilla decide si se envía algo, no si se pide el email.
- **Sin verificar la dirección**: no hay doble confirmación del email. Una errata hace
  que el email no llegue, no que la cita falle.
- **Proveedor**: un plan gratuito basta para un salón de un sillón (unas 300 citas al
  mes). El proveedor concreto se elige en el plan. Actúa como encargado del
  tratamiento, y su contrato y su plazo de conservación de los envíos se documentan
  allí.
- **Remitente**: los emails salen con el nombre del salón como remitente visible, desde
  el dominio propio del salón si lo tiene o, si no, desde el dominio donde se publica la
  app, en ambos casos verificado ante el proveedor. Las respuestas van al email del
  salón cuando esté configurado. Dirección de envío y email de respuesta son
  configuración de la instalación.
- **Plazo de reintento**: 1 hora. Con la antelación mínima de 2 horas, una confirmación
  que sale dentro de ese plazo sigue llegando antes de la cita.
- **Sin rebotes**: los avisos que el proveedor envía más tarde sobre emails que no se
  entregaron no se procesan en esta feature.
- **Configuración**: cada canal se enciende o se apaga por configuración. Sin proveedor
  configurado, el email está apagado y la app se comporta como en la 001, lo que deja
  los tests y el desarrollo sin envíos reales.
- Los textos nuevos de la interfaz y del email viven con el resto de textos de la
  interfaz.

## Out of Scope

- Recordatorios antes de la cita.
- Avisar al cliente cuando la dueña mueve, edita o cancela su cita, y cualquier aviso a
  la dueña.
- Un email nuevo cuando el cliente reprograma o cancela.
- Enviar SMS, WhatsApp o cualquier canal que no sea email, y elegir su proveedor.
- Volver a dar el consentimiento después de una baja.
- Reenviar la confirmación desde la pantalla de la cita o desde la gestión.
- Mostrar a la dueña el estado del envío de cada cita, salvo la marca de confirmación
  fallida (FR-020a). Tampoco puede reenviarla.
- Procesar rebotes y quejas de spam que notifique el proveedor.
- Cualquier contenido comercial, boletín o comunicación que no sea la confirmación.
- Otros idiomas.

## Dependencies

- 001, 003 y 005, en `main`; 002 hasta el paso 6 del roadmap (citas a mano sin enlace y
  con email opcional, edición del email, quién canceló), en `002-salon-management`, de
  la que sale esta rama.
- Un dominio verificado ante el proveedor —el del salón o, si no tiene, el de la app—
  en el que publicar los registros que el proveedor pide para enviar en su nombre. Sin
  él no se puede enviar a clientes reales. Confirmar con el cliente si tiene dominio.
- **Cambia decisiones vigentes**, que deben actualizarse al cerrar la feature:
  - `CLAUDE.md`: «v1 no envía SMS ni email, ni siquiera la confirmación».
  - 001: FR-015 («no se le va a enviar por ningún otro medio»), Assumption 5 («Sin
    mensajería saliente»), Assumption 8 (por qué no se verifica el email) y la entrada
    de *Out of Scope* sobre el mensaje de confirmación.
  - 002: la frase «v1 sigue sin enviar SMS ni email a nadie» sigue siendo cierta para
    todo lo que hace la dueña, pero ya no para la reserva online. La agenda (US2) y el
    listado (US10) ganan la marca de confirmación fallida (FR-020a), y con ella su
    contrato de gestión.
- El Principio IV de la constitución pasa a aplicarse; no hace falta enmendarlo.
