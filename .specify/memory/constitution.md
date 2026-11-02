<!--
SYNC IMPACT REPORT
==================
Version change: (plantilla sin rellenar) → 1.0.0
Bump rationale: MINOR/MAJOR no aplican; primera ratificación del documento con el
conjunto completo de principios. Se adopta 1.0.0 como línea base.

Principios definidos (antes → después):
- [PRINCIPLE_1_NAME] → I. Calidad de Código y Separación de Capas
- [PRINCIPLE_2_NAME] → II. Disciplina de Testing (NO NEGOCIABLE)
- [PRINCIPLE_3_NAME] → III. Minimización de Datos Personales
- [PRINCIPLE_4_NAME] → IV. Comunicaciones con el Cliente y Consentimiento
- [PRINCIPLE_5_NAME] → V. Seguridad
- (añadido) → VI. Experiencia de Usuario
- (añadido) → VII. Accesibilidad
- (añadido) → VIII. Rendimiento

Secciones añadidas:
- Convenciones de Desarrollo (antes [SECTION_2_NAME])
- Ámbito No Cubierto [TBD] (antes [SECTION_3_NAME])
- Governance (rellenada)

Secciones eliminadas: ninguna.

Follow-up TODOs:
- Todos los puntos de la sección "Ámbito No Cubierto [TBD]" quedan deferidos a las
  fases de especificación y plan. Ninguno bloquea la ratificación.

--------------------------------------------------------------------------------
Amendment 2026-09-16 (1.0.0 → 1.1.0)
Sección modificada: Governance.
Cambio: se añade la regla "Desviaciones por imposibilidad técnica", que permite
documentar en la tabla "Complexity Tracking" del plan —sin el procedimiento completo
de enmienda— una desviación de principio cuando revertir la acción es técnicamente
imposible, no sólo costoso o inconveniente.
Motivado por: 002-salon-management, plan.md — la cancelación de una cita es terminal
(FR-042, BR-008) frente a la exigencia de reversibilidad del Principio VI. Hallazgo D1
de /speckit-analyze sobre esa feature.
Ningún principio existente cambia de contenido.
--------------------------------------------------------------------------------
-->

# Constitución del Gestor de Citas de Peluquería

Este documento define los principios no negociables del producto. Prevalece sobre
cualquier otra práctica, convención o preferencia de implementación. Nada en las fases
de especificación, plan o implementación puede contradecirlo sin una enmienda previa.

## Core Principles

### I. Calidad de Código y Separación de Capas

- Cada módulo TIENE una única responsabilidad. Los componentes de UI NO CONTIENEN
  lógica de negocio: sólo presentación, entrada del usuario y orquestación de llamadas.
- Las reglas de dominio (disponibilidad, reserva, cancelación, recordatorios) VIVEN en
  una capa independiente del framework y de la persistencia. Esa capa NO IMPORTA
  tipos, clientes ni utilidades del framework web ni de la base de datos.
- Una regla de negocio EXISTE en un único lugar. Duplicarla entre capas (por ejemplo,
  validar el solape en la UI y en el dominio con lógicas distintas) ESTÁ PROHIBIDO; la
  UI puede anticipar el resultado, pero la decisión autoritativa es siempre la del
  dominio.
- Toda función pública TIENE un contrato explícito y tipado: tipos de entrada, tipo de
  retorno y modos de fallo declarados.
- NO SE FUSIONA a `main` código muerto, código comentado ni TODOs.

**Rationale**: la lógica de citas es el activo del producto y sobrevivirá a cualquier
framework o base de datos que se elija. Aislarla la hace testeable sin infraestructura y
evita que una regla de negocio se bifurque silenciosamente en dos versiones divergentes.

### II. Disciplina de Testing (NO NEGOCIABLE)

- Los tests SE ESCRIBEN antes de la implementación: DEBE existir un test que falle
  antes de escribir código de producción, y la suite DEBE quedar en verde al terminar.
- Los tests SE MANTIENEN después: forman parte del entregable, no del andamiaje.
- Toda corrección de bug EMPIEZA por un test de regresión que reproduzca el fallo.
- La lógica de reserva, disponibilidad, cancelación y envío de recordatorios EXIGE
  tests unitarios que cubran el camino feliz y, como mínimo, estos casos límite:
  doble reserva, solapamiento de huecos, peticiones fuera de horario, cancelación
  pasado el plazo y recordatorio de una cita ya cancelada.
- Todo flujo de cara al usuario TIENE al menos un test end-to-end.
- Ninguna funcionalidad se da por terminada con tests saltados, marcados como pendientes
  o desactivados.

**Rationale**: una cita mal gestionada cuesta dinero y confianza en el mundo físico —un
cliente que se presenta y no tiene hueco—. El coste de detectar esos fallos en
producción es desproporcionado frente al de escribir el test primero.

### III. Minimización de Datos Personales

- La app ALMACENA exactamente tres datos del cliente: nombre, teléfono y email.
  Cualquier campo personal adicional EXIGE una enmienda explícita de esta constitución.
- Los datos personales NUNCA se escriben en logs, trazas de error ni eventos de
  analítica. Las trazas referencian identificadores internos, nunca nombre, teléfono ni
  email.
- El borrado de datos a petición del cliente DEBE ser posible y completo, incluyendo
  copias derivadas y registros auxiliares que contengan datos personales.
- El tratamiento de datos personales de clientes CUMPLE el RGPD (UE 2016/679) y la
  LOPDGDD.

**Rationale**: el dato que no se guarda no se filtra, no hay que protegerlo y no hay que
borrarlo. Fijar el conjunto mínimo en la constitución convierte cada ampliación en una
decisión consciente y documentada, no en un campo más en un formulario.

### IV. Comunicaciones con el Cliente y Consentimiento

- Cada canal de contacto (SMS, email) REQUIERE consentimiento propio, registrado con
  fecha y revocable de forma independiente.
- Los recordatorios SON comunicaciones de servicio ligadas a una cita concreta: NO
  PUEDEN incluir contenido comercial ni promocional.
- Todo mensaje enviado INCLUYE una vía de baja clara para ese canal.
- Revocar el consentimiento de un canal DETIENE los envíos por ese canal sin afectar a
  la cita ni a los demás canales.
- Sin consentimiento vigente para un canal, NO SE ENVÍA nada por él.
- Cada envío QUEDA REGISTRADO con el mínimo dato necesario para auditarlo: cita, canal,
  estado y momento. NUNCA el contenido del mensaje.
- Un fallo de envío NUNCA invalida ni modifica la cita.

**Rationale**: el consentimiento por canal es una exigencia legal y, además, la única
forma de que "no quiero SMS" no signifique "no quiero que me avisen". Separar el envío
de la cita evita que una caída del proveedor de mensajería destruya la agenda del salón.

### V. Seguridad

- Toda entrada SE VALIDA en servidor. El cliente NUNCA es fuente de confianza, ni
  siquiera para datos que la UI ya validó.
- Autenticación y autorización SON OBLIGATORIAS en cualquier endpoint que lea o escriba
  datos de clientes o de citas.
- Un cliente SÓLO PUEDE leer o modificar sus propias citas. El acceso del personal del
  salón ESTÁ RESTRINGIDO por rol.
- Secretos y credenciales NUNCA se suben al repositorio.
- Todo el tráfico VA por HTTPS.

**Rationale**: la agenda contiene datos de contacto de personas reales y su ubicación en
el tiempo. Un fallo de autorización expone dónde estará alguien y cuándo.

### VI. Experiencia de Usuario

- El flujo de reserva ES el camino principal: confirmar una cita DEBE requerir los
  mínimos pasos posibles.
- Los huecos mostrados SON disponibilidad real. NUNCA se ofrece un hueco que no se pueda
  reservar.
- Toda acción DEVUELVE feedback explícito: estados de carga, éxito y error con mensajes
  accionables que digan qué hacer a continuación.
- Las acciones destructivas (cancelar, reprogramar) PIDEN confirmación y SON reversibles
  cuando sea posible.
- Mobile-first: todo flujo DEBE ser plenamente usable en un móvil.

**Rationale**: el usuario reserva desde el móvil, a menudo de pie y con prisa. Cada paso
adicional y cada hueco fantasma es una reserva perdida.

### VII. Accesibilidad

- WCAG 2.2 nivel AA como MÍNIMO en todas las pantallas de cara al usuario.
- Navegación completa por teclado con foco visible.
- Marcado semántico y nombre accesible en todo elemento interactivo.
- El color NUNCA es el único portador de significado.
- El contraste de texto CUMPLE los ratios de AA.

**Rationale**: reservar cita en una peluquería es un servicio cotidiano; excluir a quien
usa lector de pantalla o no distingue colores no es un caso límite, es perder clientes.

### VIII. Rendimiento

- La respuesta percibida ESTÁ por debajo de 2 segundos en cualquier acción de reserva,
  medida en un móvil de gama media sobre 4G.
- Las consultas de disponibilidad NO DEBEN degradarse a medida que crece el histórico de
  citas.
- NO HAY consultas N+1 en disponibilidad ni en vistas de calendario.

**Rationale**: la disponibilidad se consulta en cada paso del flujo principal y el
histórico crece de forma monótona; un diseño que sólo funciona con la agenda vacía falla
justo cuando el salón tiene éxito.

## Convenciones de Desarrollo

- Código, identificadores, comentarios, mensajes de commit y nombres de rama EN INGLÉS.
- Los mensajes de commit SIGUEN Conventional Commits.
- Una feature por rama, nombrada según la feature.
- Cualquier cambio en estos principios EXIGE una enmienda explícita de la constitución,
  versionada y fechada (ver Governance).

## Ámbito No Cubierto [TBD]

Los siguientes puntos NO están decididos por esta constitución. Pertenecen a las fases
de especificación y plan, y NO deben inventarse antes de llegar a ellas. Cuando una
decisión de estas afecte a un principio, requerirá enmienda.

- **Stack técnico**: lenguaje, frameworks, versiones, base de datos, herramientas de
  test, CI/CD, hosting. [TBD]
- **Proveedores de mensajería** para SMS y email. [TBD]
- **Parámetros temporales del dominio**: antelación mínima para reservar, plazo límite
  de cancelación, momento y número de recordatorios por cita. [TBD]
- **Modelo de roles del personal del salón** y sus permisos concretos. [TBD]
- **Método de autenticación** de clientes y de personal. [TBD]
- **Periodos de retención** de citas pasadas y del registro de auditoría de envíos, y
  procedimiento operativo de borrado a petición. [TBD]
- **Alcance multi-salón / multi-profesional** y gestión de horarios, ausencias y
  festivos. [TBD]
- **Política de no-shows, pagos, señales o precios**. [TBD]
- **Idiomas soportados** en la interfaz de cliente. [TBD]
- **Objetivos de disponibilidad, copias de seguridad y recuperación**. [TBD]
- **Herramientas de observabilidad y analítica**, sujetas al Principio III. [TBD]
- **Documentación de cumplimiento RGPD** (base jurídica, registro de actividades de
  tratamiento, encargados de tratamiento, información al interesado). [TBD]

## Governance

- Esta constitución PREVALECE sobre cualquier otra práctica, guía de estilo o
  preferencia individual. Ante conflicto, gana la constitución.
- **Procedimiento de enmienda**: toda modificación, adición o eliminación de un
  principio SE PROPONE por escrito indicando el principio afectado, la motivación y el
  impacto sobre artefactos existentes; se aprueba de forma explícita; y se aplica en un
  commit dedicado que actualiza la versión y la fecha de última enmienda. Ningún cambio
  de principio se cuela dentro de un commit de feature.
- **Política de versionado** (semántico):
  - **MAJOR**: eliminación o redefinición incompatible de un principio o de una regla de
    gobernanza.
  - **MINOR**: nuevo principio o sección, o ampliación material de una guía existente.
  - **PATCH**: aclaraciones, redacción, correcciones sin cambio semántico.
- **Cumplimiento**: toda revisión de cambios VERIFICA el cumplimiento de estos
  principios. Un cambio que los infrinja no se fusiona. Toda desviación necesita o bien
  corrección, o bien una enmienda aprobada previamente; no se admiten excepciones
  tácitas ni "se arregla después".
- **Desviaciones por imposibilidad técnica**: cuando una desviación de un principio no
  es una preferencia de diseño sino una imposibilidad técnica genuina —por ejemplo,
  revertir una acción que libera de inmediato un recurso que un tercero puede tomar en
  el mismo instante—, basta con documentarla en la tabla "Complexity Tracking" del plan
  correspondiente, nombrando la alternativa considerada y por qué se rechaza. Esto NO
  exige el procedimiento de enmienda. Una desviación que sea evitable, aunque cueste
  más, sigue exigiendo enmienda.
- **Elementos [TBD]**: un punto marcado [TBD] no es una laguna que cada implementación
  resuelva a su criterio; es una decisión pendiente que debe tomarse y documentarse en
  la fase de especificación o plan correspondiente.

**Version**: 1.1.0 | **Ratified**: 2026-09-15 | **Last Amended**: 2026-09-16
