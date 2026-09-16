# Phase 0 — Research: Gestión del salón (cara a la dueña) v1

**Feature**: `002-salon-management` | **Date**: 2026-09-16

Este documento fija las decisiones técnicas de la feature y deja constancia de lo descartado. La numeración continúa la de `001-client-appointment-booking` (D-001 … D-014), porque las decisiones de aquella siguen vigentes y algunas de éstas las modifican expresamente.

**Contexto de partida**: la 001 está construida y en verde. Esta feature no arranca de cero: convierte configuración de sólo lectura en configuración editable, generaliza el cierre de día completo y añade una segunda cara a la aplicación. Cada decisión de abajo dice, cuando procede, **qué decisión anterior modifica**.

---

## D-015 — Autenticación de la dueña: sesión opaca en base de datos

**Decisión**: una tabla `owner_session` con filas de sesión identificadas por un token opaco de 32 bytes de CSPRNG, del que la base de datos guarda **sólo su hash SHA-256**. El token viaja en una cookie `__Host-owner_session`, con `HttpOnly`, `Secure`, `SameSite=Strict` y `Path=/`. Sin `Max-Age`: es una cookie de sesión de navegador, y la caducidad real —12 horas de inactividad— la impone el servidor sobre la fila.

**Rationale**: FR-006 exige que cerrar sesión deje inaccesible toda pantalla de gestión, y FR-007 que la caducidad impida que se aplique la acción en curso. Ambas son exigencias de **revocación**, y la revocación necesita estado en servidor. Además, el patrón ya existe en este código: D-005 hizo exactamente esto con el enlace de gestión del cliente —secreto de 256 bits, hash en la base—, de modo que la sesión de la dueña no introduce un segundo modelo de credencial, sino el mismo aplicado a otro sujeto. Un volcado de la base no entrega sesiones utilizables.

`SameSite=Strict` es defensa en profundidad contra CSRF y se puede permitir aquí: la gestión no se alcanza desde ningún enlace externo, la dueña entra por marcador o escribiendo la dirección. El precio —llegar desde un enlace de WhatsApp muestra el formulario de acceso una vez— es aceptable y no vale a cambio de relajar a `Lax`.

El prefijo `__Host-` ata la cookie al origen exacto, sin `Domain` y con `Path=/`, y el navegador rechaza la cookie si falta `Secure`: en producción es imposible servirla por HTTP sin que el fallo sea inmediato y visible.

**Caducidad deslizante**: la fila lleva `last_seen_at`. Una petición con sesión válida lo actualiza, pero **como mucho una vez cada 5 minutos**, para no convertir cada navegación en una escritura (Principio VIII). Con 12 horas de ventana, un desfase máximo de 5 minutos en la caducidad es irrelevante.

**Alternativas consideradas**:

- **JWT firmado en cookie, sin estado en servidor**: descartado. No se puede revocar. FR-006 obligaría a mantener una lista de revocación, que es exactamente la tabla que el JWT pretendía evitar, y encima con dos fuentes de verdad.
- **Sesión en memoria del proceso**: descartado. Un reinicio del contenedor echa a la dueña en mitad de la jornada, y la caducidad dejaría de ser auditable. El limitador por IP de la 001 sí vive en memoria (D-007) porque perder su ventana al reiniciar es inofensivo; perder la sesión no lo es.
- **`SameSite=Lax`**: descartado por lo dicho arriba. No hay flujo que lo necesite.

---

## D-016 — Hash de contraseña: `scrypt` de `node:crypto`

**Decisión**: `crypto.scrypt` con `N = 2^17`, `r = 8`, `p = 1`, sal de 16 bytes por cuenta y salida de 64 bytes. La verificación compara con `crypto.timingSafeEqual`. Los parámetros se guardan **en la propia fila**, junto al hash, en formato `scrypt$N$r$p$salt$hash`.

**Rationale**: es el algoritmo de derivación con coste de memoria que Node 22 trae en la biblioteca estándar. Argon2id sería la primera opción del OWASP, pero exige una dependencia nativa (`argon2`, `@node-rs/argon2`) que hay que compilar en la imagen, y scrypt figura en la misma guía como alternativa aceptable cuando Argon2id no está disponible. Aquí el coste de una dependencia nativa no se paga con nada: hay **una sola cuenta** y un inicio de sesión cada doce horas como mucho. El presupuesto de memoria de `2^17 · 8 · 128 B ≈ 128 MiB` por verificación es asumible a esa frecuencia y hay que subir `maxmem` explícitamente, porque el valor por defecto de Node lo rechazaría.

Guardar los parámetros en la fila es lo que permite subirlos en el futuro sin invalidar la contraseña vigente: se re-deriva y se reescribe en el siguiente inicio de sesión correcto.

**Alternativas consideradas**:

- **bcrypt**: descartado. Trunca a 72 bytes, no tiene coste de memoria y también es dependencia nativa. Ninguna ventaja sobre scrypt aquí.
- **PBKDF2**: descartado. Sin coste de memoria, es el más débil frente a hardware dedicado de los tres que Node trae de serie.
- **Argon2id**: descartado por el coste de la dependencia nativa, no por el algoritmo. Si algún día la imagen ya la arrastra por otro motivo, el formato de la columna permite migrar cuenta a cuenta.

**Política mínima de contraseña, fijada aquí**: 12 caracteres como mínimo, sin reglas de composición, validada en servidor. FR-004 no fija ninguna; la longitud mínima sin exigencias de mayúsculas ni símbolos es lo que recomienda el NIST y lo que una persona no técnica puede cumplir sin apuntarla en un papel pegado al espejo.

---

## D-017 — El bloqueo por intentos fallidos vive en la cuenta, no en la IP

**Decisión**: la fila de la cuenta lleva `failed_attempts`, `first_failed_attempt_at` y `locked_until`. Cinco fallos dentro de una ventana de 15 minutos fijan `locked_until = now + 15 min`. Un inicio de sesión correcto pone el contador a cero. **No se almacena ni se consulta ninguna dirección IP** en este flujo.

**Rationale**: lo decide la clarificación del 2026-09-16 y lo exige FR-009. Es una decisión deliberadamente distinta de D-007, que sí usa la IP —hasheada— para los límites de cara al cliente. La diferencia está en el sujeto: allí hay muchos clientes anónimos y bloquear "la cuenta" no significa nada; aquí hay **una sola cuenta**, y limitar por origen invitaría a distribuir los intentos entre orígenes para saltarse el límite. Con una cuenta única, el límite por cuenta es el único que realmente limita.

El precio es real y hay que nombrarlo: quien conozca la dirección de la gestión puede dejar a la dueña fuera 15 minutos con cinco intentos. Se acepta porque la alternativa —no limitar, o limitar por origen— deja la única credencial del sistema expuesta a fuerza bruta, y porque 15 minutos de espera no destruyen nada: la agenda sigue siendo consultable por la dueña al cabo del bloqueo y ninguna cita se pierde.

**Indistinguibilidad (FR-008, FR-009)**: la respuesta es idéntica en los tres casos —usuario inexistente, contraseña incorrecta y cuenta bloqueada—: mismo código, mismo cuerpo, mismo mensaje, sin cabecera que los separe. Para que el **tiempo** tampoco los separe, el flujo deriva siempre un hash: si el usuario no existe o la cuenta está bloqueada, se verifica contra un hash señuelo fijo con los mismos parámetros. Sin eso, un usuario inexistente respondería en microsegundos y uno existente en cientos de milisegundos, y la indistinguibilidad que FR-008 pide sería sólo la del texto.

**Persistencia frente a D-007**: este contador vive en PostgreSQL, no en memoria. Un reinicio no debe regalar cinco intentos más.

---

## D-018 — La frontera de acceso no se delega en el middleware

**Decisión**: **cada** Route Handler y cada carga de pantalla de gestión resuelve la sesión y aborta si no hay una válida, mediante un único guardián `requireOwnerSession()`. El `middleware.ts` de Next existe sólo para **redirigir** a `/gestion/acceso` y ahorrar una pantalla en blanco; no autoriza nada, y si desapareciera, ninguna respuesta filtraría un dato.

**Rationale**: Principio V exige autenticación y autorización "en cualquier endpoint que lea o escriba datos de clientes o de citas" — endpoint, no capa transversal opcional. Y hay un motivo concreto además del principio: el middleware de Next.js tuvo en 2025 una vulnerabilidad de evasión de autorización (CVE-2025-29927) explotable con una cabecera de petición, corregida en 15.2.3. Un diseño en el que el middleware es la única puerta convierte ese tipo de fallo en una fuga completa de la agenda; un diseño en el que es una comodidad de navegación lo convierte en una molestia.

**Acciones derivadas**: fijar `next` en `>= 15.2.3` —el rango `^15.1.3` del `package.json` lo permite, pero hay que verificar la versión resuelta en el `package-lock.json` y elevar el mínimo declarado— y añadir a la suite un test que recorra **todas** las rutas de gestión sin cookie y exija que ninguna devuelva contenido (SC-001).

**Alternativa considerada**: autorizar en middleware y confiar. Descartado por lo anterior. El coste de repetir una llamada de tres líneas en cada handler es nulo comparado con el modo de fallo que evita.

---

## D-019 — `UnavailablePeriod` sustituye a `Closure`

**Decisión**: la tabla `closure` (un día completo, identificado por fecha local) desaparece y la sustituye `unavailable_period`, un intervalo `[starts_at, ends_at)` de instantes con motivo interno opcional. La migración convierte cada cierre existente en un periodo que va de las 00:00 a las 00:00 del día siguiente **en la zona del salón**. El tipo de dominio `Closure` desaparece con ella.

**Rationale**: la clarificación del 2026-09-15 decidió que el bloqueo intradía y la ausencia de varios días son el mismo concepto, y FR-018 lo exige explícitamente. Mantener las dos tablas obligaría a que el cálculo de disponibilidad restara dos clases de tiempo no disponible con dos códigos distintos, que es precisamente la duplicación de una regla que el Principio I prohíbe.

**Consecuencia en el cálculo de disponibilidad**: `computeDaySlots` deja de recibir `isClosed: boolean` y pasa a recibir los periodos que tocan el día como intervalos ocupados. La condición (b) de FR-003 —"no se solapa con ninguna cita confirmada"— se generaliza a "no se solapa con ningún intervalo ocupado", y las citas confirmadas y los periodos se concatenan antes de comprobarla. **Una sola regla de solape, en un solo sitio**, la misma media abierta `[)` de BR-013.

**Convertir el día en instantes, no en horas**: un día completo del cambio de hora dura 23 o 25 horas. El periodo se calcula con `instantFromWallTime(fecha, 00:00)` y `instantFromWallTime(fecha+1, 00:00)`, que es lo que D-004 ya hace para todo lo demás. Guardar "un día" como fecha y reconstruirlo luego habría vuelto a abrir el problema que D-004 cerró.

**Sin restricción de no-solape entre periodos**: dos periodos que se pisan son inofensivos —el tiempo no disponible no se "consume" dos veces— y prohibirlos obligaría a la dueña a fusionarlos a mano sin ganar nada. Sí se impone `ends_at > starts_at` (FR-023).

**Alternativa considerada**: conservar `closure` y añadir `unavailable_period` al lado. Descartado: dos conceptos para una sola idea, dos caminos de código en disponibilidad y una pregunta sin respuesta cada vez que hay que decidir en cuál de las dos tablas escribir.

---

## D-020 — `CLOSED` frente a `FULL` cuando el tiempo lo come un periodo

**Decisión**: un día se informa como `CLOSED` cuando **no queda ni un minuto de apertura sin cubrir** por periodos no disponibles, además de cuando no tiene tramos. Se informa `FULL` cuando queda tiempo abierto pero ningún inicio cabe.

**Rationale**: el escenario 3 de la Historia 3 lo pide literalmente —"el cliente los ve como cerrados"— y el tipo `DayStatus` de la 001 ya documenta que `CLOSED` y `FULL` son una distinción de producto, no de presentación: le dicen al cliente si mirar otro día o si ese día no existe para este salón. Unas vacaciones de una semana que se mostraran como "lleno" harían creer al cliente que el salón está a rebosar, y que insista al día siguiente.

La implementación es una resta de intervalos: se restan los periodos de los tramos de apertura del día; si el resultado es vacío, el día está cerrado. La misma resta sirve para la línea temporal de la agenda de la dueña, que necesita justo eso —apertura menos periodos menos citas— para pintar el tiempo libre de FR-011.

**Lo que NO cambia**: FR-021. El motivo del periodo no sale de la base de datos hacia el cliente en ninguna respuesta, igual que no salía el motivo del cierre.

---

## D-021 — La configuración deja de cachearse en el proceso

**Decisión**: `createSalonConfigRepository` deja de memorizar la configuración para siempre. Cada carga la lee de la base de datos. El comentario de esa función —"changes when the owner reloads it"— deja de ser cierto y se retira con el caché.

**Rationale**: FR-056 y SC-003, SC-007 y SC-009 exigen que un cambio de horario, catálogo, periodo o parámetro se note **en la siguiente consulta del cliente, sin despliegue ni reinicio**. Un caché de proceso sin invalidación lo incumple por construcción, y era correcto en la 001 sólo porque allí la configuración era inmutable en tiempo de ejecución.

**Por qué no un caché con invalidación**: se evaluó invalidar desde los casos de uso de escritura. Es viable —hay un solo worker por salón (D-007, *Target Platform*)— pero introduce un modo de fallo silencioso: una escritura futura que se olvide de invalidar produce huecos fantasma, que es exactamente lo que el Principio VI prohíbe, y el síntoma aparece lejos de la causa. El coste que evita es pequeño: son cuatro tablas de decenas de filas, leídas en un solo viaje con `Promise.all` e indexadas. Se prefiere el diseño sin estado y se sostiene con una prueba de rendimiento que cuenta consultas, no con la confianza en que nadie olvide invalidar.

Si algún día el perfil de carga lo pidiera, el sitio correcto para el caché es una capa con TTL corto —del orden de segundos— que no dependa de que nadie se olvide de nada.

---

## D-022 — Los dos parámetros editables viven en la fila del salón

**Decisión**: `minimum_lead_time_minutes` y `cancellation_deadline_hours` pasan a ser columnas de la fila única de `salon`, con `CHECK` que impone los rangos admitidos (0–48 h y 0–72 h, en horas completas). El resto de `BookingPolicy` —horizonte de 60 días, rango de 14, rejilla de 30 minutos, máximo de 3 citas por contacto, retención de 12 meses— sigue siendo constante de código en `DEFAULT_BOOKING_POLICY`.

**Rationale**: la clarificación del 2026-09-15 fija exactamente qué dos parámetros se abren, y el resto sigue siendo del sistema. Una tabla nueva de "ajustes" para dos enteros que pertenecen a una fila que ya existe y ya es única sería una indirección sin contenido. El `CHECK` en la base es lo que hace que el rango de FR-054 no dependa de que el formulario lo valide: el dominio lo valida para dar un mensaje útil, y la base lo impone para que sea cierto.

**Evaluación en el instante de actuar (BR-006, FR-055)**: no hay que hacer nada especial para lograrlo, y esto es una consecuencia grata de D-021. Como la política se lee en cada evaluación y las reglas de plazo de la 001 ya la reciben por parámetro, un cambio rige desde la siguiente acción sin retroactividad y sin reabrir nada. Lo único que hay que garantizar es que ningún valor de política quede capturado en una pantalla y se reenvíe: las decisiones se toman con lo que hay en la base en ese momento, no con lo que la pantalla creía.

---

## D-023 — El conflicto se calcula en el dominio y se aplica como un plan, en una transacción

**Decisión**: el dominio no escribe nada y no conoce transacciones. Ante una creación o reprogramación manual, produce un valor `ResolutionPlan`: la operación pedida más la lista de operaciones que hay que aplicar con ella —cancelar tal cita, recortar o eliminar tal periodo—. La infraestructura recibe ese plan y lo ejecuta **entero dentro de una sola transacción** mediante un puerto `OwnerAppointmentWriter.applyPlan(plan)`.

**Rationale**: FR-037 exige atomicidad —"o se aplican ambas, o no se aplica ninguna"— y BR-005 exige que la resolución sea siempre explícita y nombrada. Separar el cálculo de la aplicación es lo que permite las dos cosas a la vez: el plan es un dato puro, testeable sin base de datos, que **nombra** cada elemento afectado (FR-033) y que la pantalla puede mostrar tal cual antes de aplicarse; y es a la vez la unidad que la transacción aplica de una pieza.

La alternativa —que el caso de uso fuera cancelando y creando paso a paso— dejaría, ante un fallo a mitad, una cita cancelada y ninguna creada: exactamente el resultado que FR-036 y SC-006 prohíben, y el peor posible, porque la dueña habría perdido una cita a cambio de nada.

**Ausencia de auditoría**: la asunción de la especificación es que no se registra quién cambió qué. El plan no se persiste; vive lo que dura la operación.

---

## D-024 — Concurrencia: firma de estado, y la restricción `EXCLUDE` como red

**Decisión**: dos mecanismos, en este orden.

1. **Firma de estado**. Al detectar un conflicto, la respuesta incluye un `stateToken`: el hash de los identificadores y las marcas de tiempo de modificación de los elementos en conflicto. Al confirmar, la dueña lo devuelve; el caso de uso **vuelve a detectar el conflicto dentro de la transacción** y compara. Si la firma no coincide, no aplica nada y responde con el conflicto recalculado sobre el estado nuevo (FR-038).
2. **La restricción `EXCLUDE USING gist`** de D-002, intacta. Es la que garantiza BR-001 y FR-035 aunque el paso 1 fallara o alguien escribiera por otra vía. Una violación `23P01` dentro de la transacción se traduce a "el estado cambió", que es lo que realmente ha pasado.

**Rationale**: los dos mecanismos responden a exigencias distintas y ninguno sustituye al otro. La restricción garantiza la **invariante** —nunca dos citas confirmadas solapadas— pero no sabe explicar nada. La firma garantiza la **experiencia** que pide el escenario 5 de la Historia 6: la segunda dueña no recibe un error seco, recibe el conflicto recalculado sobre lo que hay ahora.

**Nivel de aislamiento**: `READ COMMITTED`, el de PostgreSQL por defecto. No hace falta `SERIALIZABLE`: la única invariante multi-fila es la no-superposición, y de ésa se ocupa la restricción, que es un índice y no depende del aislamiento. Subir a `SERIALIZABLE` añadiría fallos de serialización que habría que reintentar a cambio de una garantía que ya se tiene.

---

## D-025 — Las exenciones de la dueña: bloqueos frente a avisos

**Decisión**: el dominio distingue dos clases de resultado al crear o mover una cita como dueña.

| Regla | Para el cliente | Para la dueña |
|---|---|---|
| Solape con cita confirmada | bloquea | **conflicto**: exige resolución explícita |
| Franja ya pasada (fin transcurrido) | bloquea | **bloquea** (BR-009, FR-030) |
| Límite de 3 citas futuras por contacto | bloquea | **bloquea** (BR-007, FR-029) |
| Formato de nombre, teléfono, email | bloquea | **bloquea** (FR-031) |
| Antelación mínima | bloquea | exenta, sin aviso |
| Horizonte de 60 días | bloquea | exenta, sin aviso |
| Plazo de cancelación | bloquea | exenta, sin aviso |
| Fuera del horario de apertura | bloquea | **aviso**: confirma y se crea |
| Solape con periodo no disponible | no se le ofrece | **conflicto**: exige resolución |

**Rationale**: BR-007 enumera de qué queda exenta y de qué no, y la clarificación del 2026-09-15 lo cerró. La distinción entre *exenta sin aviso* y *aviso que confirma* la impone la especificación escenario a escenario: el escenario 3 de la Historia 4 dice que una cita dentro de la antelación mínima "se crea sin objeción", y el escenario 4 dice que una fuera de horario "avisa, la dueña confirma y se crea". No son el mismo trato y el dominio no debe unificarlos.

**Forma en el código**: una función pura devuelve `Result<ManualBookingPlan, ManualBookingBlocker>`, y el plan lleva dentro `warnings: readonly ManualBookingWarning[]` más los conflictos a resolver. Los bloqueos son el canal de error del `Result`; los avisos viajan en el éxito, porque no impiden nada: exigen acuse. La pantalla no decide cuáles hay, sólo los presenta (Principio I).

**Rejilla de inicios para la dueña, fijada aquí**: múltiplos de **15 minutos**, no los 30 de la rejilla del cliente (BR-012) ni minuto libre. Coincide con la granularidad que la especificación fija para los periodos no disponibles, cubre el caso real —"me la meto a y cuarto"— y evita una agenda con citas a las 16:07 que ningún hueco posterior encaja.

---

## D-026 — Email opcional y cita sin enlace: qué restricciones hay que relajar

**Decisión**: `appointment` gana una columna `origin` (`ONLINE` | `OWNER`), `customer_email` pasa a poder ser nula en una cita no anonimizada, y `token_hash` pasa a ser nulo en toda cita de origen `OWNER`. La restricción `appointment_anonymization_is_atomic` de la migración 0002 se reescribe en consecuencia.

**Rationale**: es la consecuencia directa de FR-024 y FR-026 sobre un esquema que se escribió cuando toda cita venía de una reserva online. La restricción actual exige, en una cita no anonimizada, que `customer_email` y `token_hash` no sean nulos; una cita manual sin email viola la primera y **toda** cita manual viola la segunda. Si no se relaja, la Historia 4 no se puede ni insertar.

Relajarla no puede significar debilitarla, porque es lo que garantiza que no exista una cita medio anonimizada. La reescritura conserva esa garantía y añade la nueva dimensión:

- **No anonimizada**: `name` y `phone` no nulos; `email` puede faltar; `token_hash` no nulo **si y sólo si** `origin = 'ONLINE'`.
- **Anonimizada**: los cinco campos personales y el hash, todos nulos. Sin cambios.

**El recuento por contacto con email ausente**: `countFutureByContact` no necesita tocarse. Su `WHERE customer_email_normalized = $2` con `$2` nulo no casa con nada, que es justo lo que corresponde —una cita sin email no consume cupo de email— y el `count(*) FILTER` devuelve 0 por el mismo motivo. El límite de tres sigue aplicándose por teléfono, que es lo que FR-029 necesita y el dato que siempre está.

**Consecuencia en el dominio**: `CustomerContact.email` y `ValidatedContact` pasan a admitir `null`. El tipo obliga a que cada lector se haga cargo, igual que ya hizo `customer: CustomerContact | null` con la anonimización. Las pantallas de cliente de la 001 no necesitan cambios de comportamiento, pero sí de tipo, y el compilador señala cada sitio.

---

## D-027 — La agenda del día se resuelve sin N+1

**Decisión**: abrir un día son tres consultas de coste acotado, siempre las mismas independientemente de lo que haya en el día: la configuración (D-021), las citas de la ventana del día y los periodos que la tocan. La línea temporal —citas, periodos, tiempo libre— se deriva en memoria en el dominio, igual que el rango de 14 días de D-003.

**Rationale**: SC-010 pide menos de 2 segundos en móvil de gama media y, sobre todo, que **ese tiempo no se degrade al crecer el histórico**. El índice parcial `appointment_confirmed_starts_at_idx` de la 001 ya sostiene lo primero. Lo segundo exige que no haya ningún bucle por franjas que consulte la base, que es la trampa natural al pintar una línea temporal hora a hora.

`unavailable_period` necesita su propio índice para la consulta "periodos que tocan esta ventana". Un índice GiST sobre `tstzrange(starts_at, ends_at, '[)')` resuelve el solape directamente; un B-tree sobre `starts_at` obligaría a leer de más para encontrar periodos largos que empezaron mucho antes. Con unas pocas decenas de periodos vivos la diferencia es teórica, pero el índice correcto cuesta lo mismo que el incorrecto y la extensión `btree_gist` ya está instalada.

**Citas canceladas (FR-015)**: no entran en la consulta por defecto. Mostrarlas es un control explícito y una segunda consulta que sólo se paga cuando se pide.

---

## D-028 — Superficie HTTP: Route Handlers bajo `/api/gestion`

**Decisión**: toda mutación de esta feature pasa por un Route Handler bajo `/api/gestion/*`, descrito en `contracts/owner-api.yaml`. Las pantallas viven bajo `/gestion/*`. No se usan Server Actions en esta feature.

**Rationale**: el protocolo de conflicto de la Historia 6 es de **dos pasos** —proponer, ver qué estorba, confirmar con una resolución y una firma de estado— y no encaja en el modelo de un envío de formulario que responde una vez. Tener un único tipo de punto de entrada para las mutaciones también hace verificable lo que D-018 exige: el guardián de sesión está en un sitio y se puede comprobar de una pasada que no falta en ninguno. La 001 mezcla Route Handlers y Server Actions porque sus formularios sí son de un solo paso; aquí la uniformidad vale más.

**Consecuencia para los tests de contrato**: `tests/contract/helpers/openapi.ts` tiene hoy la ruta del contrato de la 001 empotrada. Hay que parametrizarla para que pueda validar también contra `specs/002-salon-management/contracts/owner-api.yaml`, sin duplicar el ayudante.

---

## D-029 — Estrategia de testing de esta feature

**Decisión**: la misma pirámide de D-013, con tres añadidos propios de esta feature.

1. **Barrido de acceso (SC-001)**: un test de integración que enumera **todas** las rutas de `/gestion` y `/api/gestion` y, sin cookie, exige que ninguna devuelva contenido de gestión. Es un test que crece solo si se le da la lista de rutas desde el enrutador y no a mano; una lista a mano se queda obsoleta en cuanto se añade una pantalla.
2. **Concurrencia real (FR-038, SC-004)**: un test de integración que lanza dos confirmaciones solapadas contra PostgreSQL real, en dos conexiones, y exige que exactamente una prospere y que la otra reciba el conflicto recalculado. Sin base de datos real no prueba nada.
3. **Indistinguibilidad del acceso (FR-008, FR-009)**: un test que compara cuerpo, código y cabeceras de los tres casos —usuario inexistente, contraseña mala, cuenta bloqueada— y falla si difieren en un byte.

Los cinco casos límite que la constitución exige siguen cubiertos, y esta feature añade la cara de la dueña a cuatro de ellos: doble reserva y solapamiento ahora también por acción manual y por resolución de conflicto; petición fuera de horario ahora como **aviso** además de como bloqueo; cancelación fuera de plazo ahora con la dueña exenta. El quinto —recordatorio de cita cancelada— sigue sin aplicar: v1 no envía nada.

**Accesibilidad**: `@axe-core/playwright` se extiende a las seis pantallas de gestión, incluido el diálogo de conflicto, que es un `dialog` modal y el elemento con más riesgo de trampa de foco de toda la feature.

---

## Incógnitas resueltas — resumen

| Incógnita de la especificación | Resuelta en | Valor |
|---|---|---|
| Método de autenticación del personal ([TBD] de la constitución) | D-015, D-016 | Usuario y contraseña, sesión opaca en base de datos, `scrypt` |
| Modelo de roles del personal ([TBD] de la constitución) | Especificación (FR-001) | Rol único. No hay jerarquía que modelar |
| Aprovisionamiento de la credencial inicial | D-016, quickstart | `npm run owner:provision`, fuera de la app, en el arranque |
| Longitud mínima de contraseña | D-016 | 12 caracteres, sin reglas de composición |
| Caducidad e implementación de la sesión | D-015 | 12 h de inactividad, deslizante con precisión de 5 min |
| Límite de intentos y bloqueo | D-017 | 5 fallos / 15 min → 15 min de bloqueo, por cuenta |
| Cómo sustituir el cierre de día completo | D-019 | `unavailable_period` de instantes; migración de los cierres existentes |
| `CLOSED` vs `FULL` con periodos | D-020 | Cerrado si no queda apertura sin cubrir |
| Propagación de los cambios de configuración | D-021 | Sin caché de proceso; se lee en cada evaluación |
| Dónde viven los parámetros editables | D-022 | Columnas de la fila `salon`, con `CHECK` de rango |
| Atomicidad de la resolución de conflictos | D-023 | Plan puro en el dominio, transacción en infraestructura |
| Concurrencia entre dos dispositivos | D-024 | Firma de estado + restricción `EXCLUDE` |
| Rejilla de inicios de las citas manuales | D-025 | Múltiplos de 15 minutos |
| Restricciones a relajar por el email y el enlace | D-026 | `appointment_anonymization_is_atomic` reescrita |
| Superficie HTTP de la gestión | D-028 | Route Handlers bajo `/api/gestion`, OpenAPI propio |
