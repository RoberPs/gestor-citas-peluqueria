# Phase 0 — Research: Reserva de citas de peluquería v1

**Feature**: `001-client-appointment-booking` | **Date**: 2026-09-15

Este documento resuelve las incógnitas técnicas del plan. Cada decisión indica qué requisito o principio la obliga, por qué se eligió y qué se descartó.

Al cerrar este documento **no queda ningún `NEEDS CLARIFICATION`** en el Technical Context del plan.

---

## D-001 — Stack y arquitectura de la aplicación

**Decisión**: Next.js 15 (App Router) + React 19 + TypeScript 5.7 en modo `strict`, en un único proyecto, con arquitectura hexagonal en cuatro capas bajo `src/`: `domain` → `application` → `infrastructure` / `app`.

**Rationale**:

- El Principio I exige que las reglas de dominio no importen tipos del framework web ni de la base de datos. Esa exigencia es de **dependencias**, no de despliegue: un módulo `src/domain` de TypeScript puro la cumple igual que un servicio separado, y sin duplicar el toolchain.
- SC-004 (< 2 s percibidos en 4G) y SC-011 (una mano a 360 px) favorecen el renderizado en servidor: la primera pantalla llega como HTML con la disponibilidad ya calculada, sin esperar a que arranque un bundle de JavaScript.
- Un solo lenguaje evita el fallo que el Principio I señala explícitamente: que la validación de teléfono y email se bifurque en dos implementaciones divergentes, una en el cliente y otra en el servidor. Con TypeScript compartido, el mismo módulo de dominio valida en ambos lados y **la decisión autoritativa sigue siendo la del servidor** (FR-034).

**Frontera verificada, no confiada**: la separación de capas se comprueba en CI con `dependency-cruiser`, con una regla que falla el build si cualquier archivo de `src/domain` importa de `react`, `next`, `drizzle-orm`, `pg` o de `src/infrastructure`. Un principio que no se verifica se erosiona en el tercer sprint.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Backend Fastify + SPA React separados | Dos despliegues y dos configuraciones para un producto de cinco pantallas. La SPA empeora la primera carga en móvil, justo el escenario de SC-004. La separación física no aporta nada que `dependency-cruiser` no dé ya. |
| Python + FastAPI con frontend React | Dominio muy testeable, pero dos lenguajes obligan a mantener dos veces la validación de formato de contacto, con riesgo directo sobre el Principio I. |
| Next.js sin capas, lógica en Server Actions | Incumple el Principio I de forma frontal: las reglas de solape quedarían pegadas al framework y a Drizzle, imposibles de testear sin infraestructura. |

---

## D-002 — Garantía de no-superposición en la base de datos

**Decisión**: PostgreSQL 16 con la extensión `btree_gist` y una restricción de exclusión sobre el rango temporal, limitada a las citas confirmadas:

```sql
ALTER TABLE appointment ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'CONFIRMED');
```

**Rationale**:

- BR-001 y SC-002 no piden que el solape sea improbable, sino que sea **imposible**. Una comprobación en la aplicación seguida de un `INSERT` deja una ventana entre la lectura y la escritura; bajo dos confirmaciones simultáneas (FR-012) esa ventana es exactamente el fallo que hay que evitar.
- Con la restricción, la segunda transacción recibe un `23P01 exclusion_violation` y falla. La aplicación traduce ese código al rechazo explicativo de FR-012 y recarga la disponibilidad. No hace falta bloquear filas, ni serializar transacciones, ni introducir una tabla de huecos.
- El intervalo es **semiabierto** `[)`: una cita de 10:00 a 11:30 y otra de 11:30 a 12:00 **no** solapan, que es justo lo que BR-013 exige (sin margen entre citas).
- La cláusula `WHERE (status = 'CONFIRMED')` hace que las citas canceladas no participen, cumpliendo BR-005: cancelar libera el hueco de inmediato, sin borrar la fila y sin proceso adicional.
- La misma restricción cubre la atomicidad de la reprogramación (FR-025, BR-006): el `UPDATE` de la franja o se aplica o se rechaza, y en el rechazo la cita original queda intacta en su hora original porque la transacción revierte entera.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| SQLite | No tiene restricciones de exclusión por rango. La ausencia de solapes dependería de una transacción serializable escrita a mano, más frágil frente a FR-012 y sin red de seguridad si la lógica falla. |
| MySQL / MariaDB | Tampoco soporta exclusión por rangos. Exigiría bloqueo explícito de la franja o una tabla materializada de huecos, contradiciendo que el hueco es un concepto **derivado y no almacenado** (entidad "Hueco" de la especificación). |
| Tabla de huecos precalculados con `UNIQUE` | Convierte el hueco en entidad persistida. Cualquier cambio de configuración o de catálogo obligaría a regenerarla, y un servicio de duración distinta ya no encaja en una fila. Contradice el modelo de la especificación. |
| Bloqueo pesimista (`SELECT ... FOR UPDATE`) sobre una fila de día | Funciona, pero serializa todas las reservas del día y deja la garantía en manos de que nadie olvide el bloqueo. La restricción declarativa no se puede olvidar. |

---

## D-003 — Una sola consulta para toda la disponibilidad

**Decisión**: `GET /api/availability` carga, en **una única consulta**, todas las citas confirmadas entre el instante actual y el horizonte de 60 días. Con esos datos más la configuración del salón (cacheada en memoria), el dominio calcula en una sola pasada: el estado de los 14 días del rango, los huecos del día seleccionado y el siguiente día con disponibilidad.

```sql
SELECT id, starts_at, ends_at
  FROM appointment
 WHERE status = 'CONFIRMED'
   AND starts_at >= $1 AND starts_at < $2;   -- ahora .. horizonte
```

con el índice de apoyo:

```sql
CREATE INDEX appointment_confirmed_starts_at_idx
    ON appointment (starts_at) WHERE status = 'CONFIRMED';
```

**Rationale**:

- FR-005b obliga a calcular el estado de un rango "en una sola consulta de disponibilidad, no una por día". Traer el horizonte completo lo cumple y además resuelve FR-006 —el salto al siguiente día con huecos, que puede caer en un rango posterior— sin ninguna consulta adicional.
- El volumen está acotado por el propio dominio, no por el crecimiento del negocio: un solo sillón, 60 días, como mucho ~20 citas por día. El techo teórico son ~1.200 filas, y el realista unos pocos cientos. Materializarlas en memoria es trivial.
- El **índice parcial** es la clave de SC-005: el histórico pasado no entra en el índice ni en la consulta. Con 10.000 citas pasadas el plan de ejecución es idéntico al de la agenda vacía, porque esas filas simplemente no participan.
- Cero consultas N+1 por construcción (Principio VIII): no existe ningún bucle sobre días que toque la base de datos. El bucle está en el dominio, sobre un array.

**Consecuencia de diseño**: el cálculo de disponibilidad es una **función pura** `(configuración, citas, servicio, instante) → disponibilidad`. Se puede testear entero sin base de datos, que es lo que hace viable el "Independent Test" de la Historia 1.

**Alternativa considerada**: calcular la disponibilidad en SQL con `generate_series`. Descartada: metería la regla de la rejilla de 30 minutos y la del encaje en tramo dentro de una consulta, sacándola del dominio y volviéndola intesteable sin infraestructura. Viola el Principio I.

---

## D-004 — Tiempo, zona horaria y cambio de hora

**Decisión**: `@js-temporal/polyfill` en la capa de dominio, usando `Temporal.ZonedDateTime` para toda la aritmética de calendario, y `Temporal.Instant` como representación canónica de los momentos persistidos. El cliente **no hace ninguna aritmética**: recibe del servidor las horas ya formateadas como texto y las muestra.

**Rationale**:

- FR-032 y BR-015 exigen que toda decisión temporal se tome en la zona del salón contra el reloj del servidor. `ZonedDateTime` modela exactamente eso: una hora de pared en una zona concreta, con el desfase resuelto para esa fecha.
- El caso límite del cambio de horario estacional dentro del horizonte de 60 días (que ocurrirá: hoy es 15 de septiembre y el cambio de octubre entra en el horizonte) se resuelve solo. Sumar 90 minutos a un `ZonedDateTime` suma **90 minutos reales**, mientras que el horario de apertura "10:00–20:00" se interpreta como hora de pared en cada fecha. Es justo la distinción que pide el caso límite de la especificación: horas locales del salón, duraciones en minutos reales.
- Que el cliente no calcule nada elimina de raíz el caso límite del dispositivo con el reloj o la zona mal configurados: no hay ningún camino por el que el reloj del dispositivo pueda influir en lo que se muestra.

**Sobre el polyfill**: vive sólo en el servidor, dentro de `src/domain` y `src/application`. No entra en el bundle del cliente, así que no compromete el presupuesto de JavaScript. El formateo del lado del cliente, si hiciera falta, usa `Intl.DateTimeFormat` nativo con `timeZone` explícito.

**El reloj es un puerto**: el dominio nunca llama a `Date.now()`. Recibe un `Clock` inyectado. Sin esto, los tests de BR-003 (antelación de 2 h) y BR-004 (plazo de 24 h) dependerían de la hora a la que se ejecuta la suite, que es una forma segura de tener tests que fallan los domingos.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Luxon | Maduro y capaz, pero su API de zonas es menos explícita sobre los instantes ambiguos del cambio de hora (la hora que se repite en octubre). Temporal obliga a declarar la política de desambiguación. |
| `date-fns` + `date-fns-tz` | Ligero, pero la aritmética sobre `Date` nativo con desfases manuales es propensa a errores en la frontera del DST, y este dominio la cruza dos veces al año. |
| `Date` nativo con UTC a pelo | Obligaría a implementar a mano las reglas de `Europe/Madrid`. Descartado sin más. |

---

## D-005 — El enlace de gestión como credencial

**Decisión**: el token son **32 bytes** de `crypto.randomBytes` codificados en base64url (43 caracteres). La base de datos almacena únicamente `sha256(token)` en una columna `UNIQUE`. El token en claro existe sólo en la URL que el cliente guarda.

```text
https://<salon>/cita/kJ8x2mQ...43-caracteres-base64url
```

**Rationale**:

- FR-017 pide al menos 128 bits de entropía. 32 bytes dan **256 bits**, al mismo coste. Con ese espacio, probar enlaces al azar no es viable ni con recursos ilimitados, que es lo que BR-016 llama "inadivinable por construcción".
- Generado con `crypto.randomBytes` (CSPRNG), sin ninguna parte derivada de la cita ni del cliente, sin componente secuencial ni temporal. Conocer un enlace no aporta nada sobre otro.
- **Guardar sólo el hash** no lo pide ningún requisito, pero es gratis y cambia el peor caso: un volcado de la base de datos no entrega enlaces utilizables. Como el token tiene 256 bits de entropía, SHA-256 sin sal ni estiramiento es suficiente: no hay diccionario que atacar.
- La búsqueda es un `SELECT` por columna indexada única — O(1), sin barrido.
- FR-035 exige inutilizar el identificador en el mismo acto del borrado de datos personales. Con esta decisión eso es poner `token_hash = NULL`: el enlace deja de resolver de inmediato y no queda ni rastro del que hubo.

**Base64url y no hexadecimal**: 43 caracteres frente a 64, URL-safe sin escapar, y una URL más corta es una URL que el cliente copia y pega con menos errores desde el móvil (SC-001).

---

## D-006 — Respuesta neutra e indistinguible

**Decisión**: una única función de respuesta para los cinco casos de FR-019 y FR-038. Mismo código de estado (`404`), mismo cuerpo, mismo HTML, mismas cabeceras. Sin `Retry-After`, sin `X-RateLimit-*`, sin mensaje que mencione un límite.

Los cinco casos que deben ser indistinguibles:

1. El token no corresponde a ninguna cita.
2. El token está malformado (longitud o alfabeto incorrectos).
3. La cita fue borrada.
4. La cita fue anonimizada por retención a los 12 meses (FR-035, BR-018).
5. Se superó el límite de aperturas por IP (FR-038).

**Rationale**: si el caso 5 devolviera `429` o una cabecera distinta, quien prueba enlaces al azar sabría que ha tocado un límite y, peor, que el sistema distingue entre sus intentos. FR-038 lo prohíbe de forma explícita: la respuesta al exceso debe ser indistinguible de la de un enlace inexistente, "sin revelar que se ha alcanzado un límite ni si el enlace probado era válido".

**Sobre el canal temporal**: un token válido implica consulta a la base de datos y uno malformado no, lo que en teoría deja una diferencia de tiempo observable. Mitigación: **el formato del token se valida siempre, y siempre se ejecuta la consulta**, incluso cuando el formato ya ha fallado. El coste es una consulta indexada por petición fallida, acotada además por el propio límite por IP. Es barato y cierra el canal.

**Nota de diseño**: `404` es deliberado frente a `401` o `403`. Un `403` confirmaría que ahí hay algo. El `404` es la respuesta honesta a "para ti, esto no existe".

---

## D-007 — Límites por IP sin almacenar la IP

**Decisión**: ventana deslizante en memoria del proceso, con la IP convertida en clave mediante `HMAC-SHA256(ip, secreto)` truncado a 16 bytes. El secreto se genera al arrancar el proceso y **se rota con cada ventana**. Las entradas expiran al cerrarse su ventana.

| Límite | Valor | Requisito |
|---|---|---|
| Aperturas de enlace de gestión | 30 / 10 min por IP | FR-038 |
| Confirmaciones de reserva | 5 / hora y 15 / 24 h por IP | FR-039 |

**Rationale**:

- FR-040 exige conservar la IP "sólo durante la ventana del propio límite, en forma no reversible" y no asociarla a ninguna cita. El HMAC con secreto rotatorio lo cumple en sentido fuerte: sin el secreto no se puede comprobar si una IP dada estuvo presente, y pasada la ventana el secreto ya no existe.
- La memoria del proceso basta porque el despliegue es de **proceso único por salón** (una instancia por dueña). No hace falta Redis, y no introducirlo evita una dependencia que habría que operar, asegurar y respaldar.
- Los valores están fijados muy por encima del uso legítimo. Un cliente reserva una vez y abre su enlace unas pocas veces; 30 aperturas en 10 minutos dan margen a varios clientes legítimos tras una misma IP compartida (NAT móvil, wifi de centro comercial), que es el caso límite que la especificación señala. Quien aun así lo alcance recibe el mensaje accionable de FR-039 con el teléfono del salón.
- **Una dirección IPv6 cuenta por su `/64`** (revisión del 2026-11-06, antes de abrir la producción a clientes). Un abonado IPv6 recibe al menos un `/64` y puede cambiar de dirección dentro de él a voluntad: contar cada dirección aparte le daría 2^64 cupos. El `/64` es el bloque más pequeño que reparte una red, así que es lo que se cuenta; una IPv4 cuenta tal cual, y una IPv6 con una IPv4 dentro (`::ffff:a.b.c.d`) cuenta como esa IPv4. Lo hace `rateLimitSubject` antes del HMAC, en el limitador, así que vale para todas las rutas.
- El rechazo se contabiliza **agregado**: un contador de rechazos por tipo de límite, sin ninguna referencia al solicitante. Es lo que FR-040 permite y lo único que hace falta para saber si los valores están mal calibrados.

**Consecuencia para el despliegue**: la aplicación debe leer la IP real de la cabecera `X-Forwarded-For` que fija el proxy inverso, y **sólo confiar en ella si la petición llega del proxy conocido**. Si no, cualquiera falsea su IP y elude el límite. Queda documentado en `quickstart.md`.

**Puerto abstracto**: el límite se define como el puerto `RateLimiter` en `application/ports`. Si el despliegue cambiara a varias instancias, se sustituye el adaptador en memoria por uno compartido sin tocar dominio ni casos de uso.

---

## D-008 — Acceso a datos: Drizzle con migraciones SQL a mano

**Decisión**: Drizzle ORM para consultas tipadas, con las migraciones escritas **a mano en SQL**, no generadas.

**Rationale**:

- La pieza crítica del esquema es la restricción `EXCLUDE USING gist` de D-002, que ningún generador de migraciones modela bien. Escribirla a mano la hace explícita, revisable y versionada.
- Drizzle es una capa fina sobre SQL: no introduce un modelo de objetos paralelo ni carga perezosa, que es la fuente habitual de las consultas N+1 que el Principio VIII prohíbe. Lo que se escribe es lo que se ejecuta.
- Su salida son objetos planos, fáciles de traducir a los tipos de dominio en el repositorio, manteniendo `src/domain` libre de cualquier tipo de Drizzle (Principio I).

**Alternativa considerada**: Prisma. Descartada porque su capa de abstracción dificulta expresar la restricción de exclusión y los índices parciales, y porque su cliente generado tiende a filtrarse hacia las capas superiores.

---

## D-009 — Validación en frontera y reglas de formato en el dominio

**Decisión**: Zod valida en el Route Handler la **forma** de la petición (campos presentes, tipos, longitudes máximas). Las reglas de **formato de negocio** —teléfono español y sintaxis de email— viven en `src/domain` y Zod las invoca mediante `refine`.

**Rationale**: el Principio I prohíbe que una regla de negocio exista en dos sitios. "Un teléfono español válido" es una regla de negocio (FR-009, asunción 8), no una comprobación de transporte. Si viviera en un esquema Zod del Route Handler, el dominio no podría validarla y el mismo concepto tendría dos definiciones. Con `refine` delegando en el dominio hay **una sola implementación**, usada en la frontera HTTP, en el propio dominio y —compartida vía TypeScript— en la validación optimista del formulario, que nunca es autoritativa (FR-034).

**Formato aceptado** (asunción 8): móvil o fijo español, 9 dígitos empezando por 6, 7, 8 o 9, con prefijo `+34` o `0034` opcional y espacios, guiones o puntos tolerados y normalizados. El email se valida sintácticamente; ninguno de los dos se verifica como existente, porque v1 no envía nada.

---

## D-010 — Confirmación idempotente

**Decisión**: patrón POST-Redirect-GET. `POST /api/appointments` responde `303 See Other` con `Location: /cita/{token}?nueva=1`. La pantalla de confirmación es un `GET` sobre la propia cita.

**Rationale**: resuelve el escenario 3 de la Historia 3 —recargar la confirmación no debe crear una segunda cita— de la forma más simple posible: al recargar, el navegador repite un `GET` idempotente, no el `POST`. Sin claves de idempotencia, sin tabla auxiliar, sin ventana de deduplicación.

El parámetro `?nueva=1` sólo cambia la presentación: muestra el aviso destacado de FR-015 ("guarda este enlace, es tu única vía de acceso"). La cita se ve igual con o sin él.

**Beneficio adicional**: la pantalla de confirmación y la de consulta posterior (Historia 4) son **la misma pantalla**, alimentada por el mismo caso de uso. Menos código, menos superficie de fallo, y garantía de que ambas muestran lo mismo.

---

## D-011 — El snapshot del servicio en la cita

**Decisión**: la cita guarda una copia del nombre, la duración y el precio del servicio en el momento de reservar, además de la referencia al servicio.

**Rationale**: FR-016 y el caso límite de "el catálogo cambia entre la reserva y la consulta" lo exigen. Si el catálogo subiera el precio del color o cambiara su duración, una cita ya confirmada debe seguir mostrando lo que se reservó. La referencia se conserva para la reprogramación, que debe ofrecer huecos del **mismo servicio** (FR-024) usando su duración **vigente en la cita**, no la actual del catálogo: de lo contrario la cita cambiaría de duración sin que nadie lo decidiera.

---

## D-012 — El borrado por retención

**Decisión**: comando `scripts/retention-purge.ts`, invocado por un cron diario a las 03:30 hora del salón. Anonimiza en una sola sentencia las citas con más de 12 meses:

```sql
UPDATE appointment
   SET customer_name = NULL, customer_phone = NULL, customer_email = NULL,
       customer_phone_normalized = NULL, customer_email_normalized = NULL,
       token_hash = NULL, anonymized_at = now()
 WHERE starts_at < now() - interval '12 months'
   AND anonymized_at IS NULL;
```

**Rationale**:

- FR-035 exige borrar los tres datos personales e inutilizar el identificador de acceso **en el mismo acto**. Una sola sentencia lo garantiza: no hay estado intermedio en el que la cita esté anonimizada pero el enlace siga funcionando.
- FR-035a exige conservar el resto —servicio, horas, estado, momentos de creación y cancelación— para que el histórico de ocupación quede completo y sin datos personales. Por eso se anonimiza, no se borra la fila.
- Es un proceso en segundo plano, y conviene subrayar que **es el único**. FR-031 dice explícitamente que el estado "completada" se deriva del reloj al leer, sin ningún proceso que marque citas. Aquí no se toca el estado: una cita anonimizada sigue siendo `CONFIRMED` o `CANCELLED`.
- El mismo comando acepta `--appointment <id>` para anonimizar una cita concreta. Eso es lo que cubre la exigencia del Principio III sobre el borrado a petición del cliente, mientras la pantalla correspondiente llega en una feature posterior.

**Por qué un cron y no `pg_cron`**: mantiene la lógica de retención en el código de la aplicación, versionada y testeable con Vitest contra una base real, en lugar de escondida en una tabla de configuración de la base de datos.

---

## D-013 — Estrategia de testing

**Decisión**:

| Nivel | Herramienta | Alcance |
|---|---|---|
| Unitario | Vitest | `src/domain` completo, sin infraestructura. El grueso de la suite. |
| Integración | Vitest + PostgreSQL real (`docker compose`) | Casos de uso y repositorios. Incluye la prueba de que la restricción `EXCLUDE` rechaza el solape. |
| Contrato | Vitest + `openapi-fetch` | Los Route Handlers contra `contracts/http-api.yaml`. |
| End-to-end | Playwright | Una historia de usuario por archivo, más `@axe-core/playwright` en cada pantalla. |

**Rationale**:

- El Principio II exige tests unitarios sobre reserva, disponibilidad y cancelación cubriendo camino feliz y casos límite. Con el dominio puro de D-001 esos tests no necesitan base de datos y corren en milisegundos, lo que hace realista escribir el test primero.
- **PostgreSQL real, nunca simulado**, en integración: la garantía central de esta feature (D-002) es una restricción de la base de datos. Simularla sería testear la simulación.
- El test de FR-012 —dos confirmaciones simultáneas sobre el mismo hueco— se escribe abriendo dos transacciones concurrentes de verdad y comprobando que exactamente una prospera y la otra recibe `23P01`.
- Los casos límite exigidos por la constitución tienen test nombrado. El quinto de su lista, "recordatorio de una cita ya cancelada", **no aplica**: v1 no envía ningún mensaje (asunción 5). Queda constancia aquí para que la ausencia sea una decisión registrada y no un olvido.

**Reloj determinista**: todos los tests inyectan un `Clock` fijo. Ningún test depende de la hora real a la que se ejecuta.

---

## D-014 — Accesibilidad de la rejilla de 14 días

**Decisión**: la rejilla de días es una lista de botones en HTML semántico. Cada día comunica su estado por **tres vías simultáneas**: texto visible (o `aria-label` cuando el espacio obliga a abreviar), un icono con forma distinta por estado, y el color. Los días cerrados y los llenos se marcan `aria-disabled="true"` pero **siguen siendo enfocables**, para que quien navega por teclado sepa que existen y por qué no se pueden elegir.

**Rationale**:

- SC-010 y el Principio VII prohíben que el color sea el único portador de significado. Con tres estados —cerrado, lleno, con huecos— el riesgo es real: en una rejilla compacta la tentación de resolverlo sólo con color es alta.
- SC-011 exige que los 14 días quepan en 360 px manteniendo legible el estado y un área táctil suficiente. Con 7 columnas × 2 filas quedan ~48 px por celda, por encima del mínimo de 44 × 44 px que pide WCAG 2.2 para el tamaño de destino.
- El día seleccionado se marca con `aria-current="date"`, y la lista de huecos que aparece debajo se vincula a la rejilla con `aria-live="polite"`, de modo que al cambiar de día un lector de pantalla anuncie cuántos huecos hay sin que el foco salte.

**Iconografía por estado**: `—` cerrado, `×` lleno, `•` con huecos, con el número de huecos en el nombre accesible. Formas distinguibles sin color y sin depender de que el navegador cargue una fuente de iconos.

---

## Incógnitas resueltas — resumen

| Incógnita del Technical Context | Resuelta en |
|---|---|
| Lenguaje, framework y versión | D-001 |
| Base de datos y garantía de no-solape | D-002 |
| Estrategia de consulta de disponibilidad | D-003 |
| Manejo de zona horaria y cambio de hora | D-004 |
| Generación y almacenamiento de la credencial | D-005 |
| Indistinguibilidad de la respuesta neutra | D-006 |
| Implementación y valores de los límites por IP | D-007 |
| Capa de acceso a datos y migraciones | D-008 |
| Dónde vive la validación de formato | D-009 |
| Idempotencia de la confirmación | D-010 |
| Congelado del servicio en la cita | D-011 |
| Ejecución del borrado por retención | D-012 |
| Herramientas y niveles de test | D-013 |
| Accesibilidad de la rejilla de días | D-014 |

**Sin `NEEDS CLARIFICATION` pendientes.**
