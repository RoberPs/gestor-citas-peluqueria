# Phase 0 — Research: Varios servicios por cita y precio opcional

**Feature**: `005-multiple-services` | **Date**: 2026-11-03

Cada decisión indica qué requisito la obliga, por qué se eligió y qué se descartó. Las
referencias `001/…` y `003/…` apuntan a las decisiones de esas features.

Al cerrar este documento **no queda ningún `NEEDS CLARIFICATION`** en el Technical
Context del plan.

---

## D-001 — Los servicios de la cita en una tabla hija

**Decisión**: una tabla nueva, `appointment_service`, con una fila por servicio de la
cita: `appointment_id`, `position`, `service_id` y el snapshot de `name`,
`duration_minutes` y `price_cents`. La clave primaria es `(appointment_id, position)` y
hay un índice único `(appointment_id, service_id)`. Las columnas `service_*` de
`appointment` se migran a esta tabla y se eliminan.

**Rationale**:

- FR-014 amplía el snapshot de 001/D-011 a **cada** servicio. Una fila por servicio es la
  forma natural de guardar una lista con un snapshot por elemento.
- Se conserva la clave foránea a `service` con `ON DELETE RESTRICT`, la misma garantía
  que daba 001/D-011: no se puede borrar un servicio que una cita referencia.
- El índice único impone FR-003 (sin servicios repetidos) en la base de datos, no sólo en
  la aplicación.
- La 002 tendrá que pintar los servicios de las citas de un día en la agenda y en el
  listado. Una tabla se consulta y se agrega con SQL normal.
- La garantía de no-superposición **no cambia**: la restricción `EXCLUDE` sigue sobre
  `appointment.starts_at`/`ends_at`, y `ends_at` ya es el inicio más la duración total.

**Lo que la base de datos no impone**, y quién lo impone:

| Invariante | Quién lo garantiza |
|---|---|
| Una cita tiene al menos un servicio. | El tipo del dominio (lista no vacía, D-003) y el repositorio, que inserta la cita y sus servicios en **una transacción**. Test de integración. |
| `ends_at − starts_at` es la suma de las duraciones. | El dominio calcula `endsAt` (FR-007). Test de integración sobre lo persistido. |

Un trigger diferido podría comprobar los dos invariantes en la base de datos, pero
añade una pieza que nadie más usa en el proyecto. Como la cita y sus servicios se
escriben en un único sitio, los tests bastan.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| Una columna `jsonb` con la lista en `appointment` | Se pierde la clave foránea a `service` y la unicidad por servicio. La 002 tendría que consultar dentro del JSON. |
| Un array `service_ids uuid[]` y el snapshot aparte | Dos estructuras que deben ir sincronizadas, y los arrays no admiten claves foráneas. |
| Mantener `appointment.service_*` para el primer servicio y la tabla para el resto | Dos sitios para el mismo dato, y cada lectura tiene que unirlos. |

---

## D-002 — El precio es opcional en el catálogo y en el snapshot

**Decisión**: `service.price_cents` y `appointment_service.price_cents` pasan a admitir
`NULL`, con `CHECK (price_cents IS NULL OR price_cents > 0)`. La migración convierte los
`0` que ya existen en `NULL`, tanto en `service` como en los snapshots. En el dominio el
tipo pasa a ser `priceCents: number | null`.

**Rationale**: FR-018 y FR-019. Si «sin precio» y «0 €» fueran el mismo dato, el
«0,00 €» de la demo nunca desaparecería del todo. Con el `CHECK` es imposible volver a
guardar un 0. Hoy los únicos ceros son los de la demo, que todavía no tiene precios, así
que convertirlos en `NULL` es exactamente lo que se quiere decir.

**Alternativas consideradas**: un booleano `has_price` junto a un importe (dos campos
para un solo dato) y el valor centinela `-1` (un número que no es un precio).

---

## D-003 — La lista de servicios y el precio total son reglas del dominio

**Decisión**: un módulo nuevo, `src/domain/catalog/selection.ts`, con:

- `selectServices(catalogue, requestedIds): Result<ServiceSelection, SelectionError>`.
  Rechaza la lista vacía (`EMPTY`), los repetidos (`DUPLICATE`) y los servicios que no
  existen o están inactivos (`UNKNOWN_SERVICE`, con sus ids). Devuelve los servicios en
  el orden del catálogo (FR-006), su snapshot y la duración total (FR-007).
- `totalPriceOf(services): PriceTotal`, con
  `PriceTotal = { kind: 'ALL_PRICED', cents } | { kind: 'NONE_PRICED' } | { kind: 'PARTIALLY_PRICED', knownCents }`
  (FR-020).
- El tipo `NonEmptyServiceList = readonly [ServiceSnapshot, ...ServiceSnapshot[]]`.
  `Appointment.service` pasa a `Appointment.services: NonEmptyServiceList`.

`validateSlot`, `computeDaySlots` y `computeRangeDays` reciben `durationMinutes`, no un
servicio. Las dos últimas ya funcionan así, y `validateSlot` es la única que cambia de
firma.

**Rationale**:

- Elegir qué servicios entran en la cita, en qué orden y cuánto dura son reglas de
  negocio. Según el Principio I y el CLAUDE.md viven sólo en el dominio. La interfaz se
  limita a mostrar el resultado.
- El precio total del caso mixto es una regla de producto (Session 2026-11-03), no una
  cuestión de formato. Si el dominio no la decidiera, cada pantalla (resumen,
  confirmación, enlace y, más adelante, el email de la 004) podría calcularla de una
  forma distinta. El dominio devuelve el `kind` y el catálogo de textos lo redacta.
- Con un tipo de lista no vacía, una cita sin servicios no se puede ni escribir.

**Alternativa descartada**: sumar duraciones y precios en los componentes. Eso
duplicaría la regla en cuatro pantallas y en la API.

---

## D-004 — La selección viaja en la URL como `serviceIds`

**Decisión**: un solo parámetro, `serviceIds`, con los ids separados por comas, por
ejemplo `/?serviceIds=a,b&selectedDate=…`. Cada botón del selector de servicios es un
botón de envío de un formulario GET (`NavForm`) cuyo `value` es **la selección que
resulta de pulsarlo**: la actual más ese servicio, o la actual sin él.

| URL | Significado |
|---|---|
| sin `serviceIds` | Primer servicio del catálogo preseleccionado (FR-002). |
| `serviceIds=` (vacío) | El cliente lo ha desmarcado todo: se pide elegir al menos uno (FR-004). |
| ids desconocidos o repetidos | Se ignoran los que sobran. Si no queda ninguno válido, se trata como sin `serviceIds`, igual que hoy un `serviceId` desconocido. |

**Rationale**:

- Se mantiene 003/D-003: sin JavaScript, cada elección es un paso del historial, y
  recargar o compartir la URL conserva la selección (FR-010a de la 003).
- Si el botón enviara sólo «alterna este servicio», recargar la página lo volvería a
  alternar. Con la selección final en el `value`, recargar es idempotente.
- Calcular «la selección actual más o menos este id» es presentación, no una regla:
  decidir si esa selección vale le corresponde a `selectServices` en el servidor.
- `NavForm` sí envía el `name`/`value` del botón pulsado, que es justo lo que `next/form`
  pierde (CLAUDE.md).

**Compatibilidad**: los enlaces antiguos con `serviceId=` (singular) caen en el caso «sin
`serviceIds`» y muestran el primer servicio. No se añade un alias, porque los enlaces
que importan son los de las citas (`/cita/{token}`), y esos no cambian.

**Alternativas consideradas**:

| Alternativa | Por qué se descarta |
|---|---|
| `serviceId` repetido (`?serviceId=a&serviceId=b`) | Un botón sólo envía un par `name`/`value`, así que el botón tendría que llevar la lista completa igualmente. |
| Casillas (checkbox) y un botón «Aplicar» | Añade un paso a la reserva (Principio VI) y, sin JavaScript, la disponibilidad no se actualiza al marcar. |
| Guardar la selección en una cookie o en el navegador | Va en contra de 003/D-004: la URL basta y no deja estado escondido. |

---

## D-005 — Conservar la hora al cambiar la selección (FR-011)

**Decisión**: en ordenador, `/reservar` muestra el selector de servicios (003/D-002).
Ese selector envía a `/reservar` la selección nueva junto con `startsAt`, `selectedDate`
y `rangeStart`. La página calcula la disponibilidad de ese día con la nueva selección:

- Si `startsAt` está entre los huecos que devuelve el dominio, la hora se conserva y
  sólo se actualiza el resumen.
- Si no, redirige a `/` con la selección, el día y `horaQuitada=1`, y se muestra un
  aviso.

Los datos escritos en el formulario siguen en el borrador en memoria (003/D-004).

**Rationale**: quien decide si la hora sigue valiendo es el dominio, a través de la lista
de huecos que ya calcula. La página sólo comprueba si la hora está en esa lista. No hace
falta ninguna consulta nueva, porque `/reservar` ya pide la disponibilidad de ese día
(003/D-008).

En móvil el selector sólo aparece en `/`, donde todavía no hay hora elegida, así que el
caso no se da.

---

## D-006 — Un solo contrato HTTP, versión 2.0.0

**Decisión**: `specs/001-client-appointment-booking/contracts/http-api.yaml` sigue siendo
**el** contrato vivo, el que comprueban los tests de contrato. Se actualiza en su sitio
a la versión **2.0.0**. Los cambios se describen en
[contracts/http-api-changes.md](./contracts/http-api-changes.md).

**Rationale**: el cambio rompe la compatibilidad (`serviceId` pasa a ser `serviceIds`,
`service` pasa a ser `services` y el precio puede ser `null`), así que toca subir la
versión mayor. Si hubiera dos contratos, uno en la 001 y otro en la 005, se acabarían
separando, que es justo lo que `tests/contract/helpers/openapi.ts` está pensado para
evitar. La API no tiene consumidores externos: la interfaz usa casos de uso y server
actions, y la API sólo la usan los tests de contrato. Por eso no se mantiene una
versión 1.

**Alternativa descartada**: aceptar `serviceId` y `serviceIds` a la vez. Habría dos
formas de pedir lo mismo, y la antigua sería código que nadie usa.

---

## D-007 — Una selección que no cabe en ningún tramo (FR-010)

**Decisión**: el dominio expone `fitsOpeningHours(durationMinutes, schedule)`, que es
`true` si algún tramo de apertura de la semana es tan largo como la selección. La vista
de disponibilidad añade ese dato. Cuando es `false`, la pantalla sustituye las horas
por el mensaje de FR-010, con el teléfono del salón.

**Rationale**: «el horizonte está lleno» y «tu selección no cabe en el salón» son
situaciones distintas que piden acciones distintas al cliente. En la primera, el salto
al siguiente día con huecos de la 001 ya ayuda. En la segunda, ningún día servirá nunca,
y lo útil es quitar un servicio. La comprobación sólo usa el horario, que ya está en
memoria, así que no añade consultas.

**Alineado con la spec**: tras `/speckit-analyze` (hallazgo A1), FR-010 dice ya
«cuando su selección dure más que cualquier tramo de apertura». Si la selección cabe en
el horario pero el horizonte está ocupado, se mantiene el comportamiento de la 001: días
llenos y salto al siguiente día con huecos.

---

## D-008 — Reprogramar con la duración total

**Decisión**: `GetAvailabilityInput.currentAppointment` pasa a llevar `durationMinutes` y
`startsAt` en lugar del snapshot de un servicio. `applyReschedule` calcula la duración
con los servicios de la cita. Al reprogramar no se puede pasar ningún servicio, igual
que en la 001 (FR-017): sigue siendo un estado que no se puede expresar.

**Rationale**: la duración de la cita sale de sus snapshots, no del catálogo actual
(001/D-011). Por eso un cambio de duraciones en el catálogo no alarga una cita que se
está reprogramando.

---

## D-009 — Formato de duración y precio

**Decisión**: `durationLabel` pasa a escribir horas y minutos: `30 min`, `1 h`,
`1 h 30 min`. `priceLabel(null)` devuelve «Precio a consultar en el salón». Una función
nueva, `totalPriceLabel(PriceTotal)`, redacta los tres casos de FR-020. Todos los textos
viven en `src/messages/es-ES.ts`.

**Rationale**: con varios servicios, las duraciones de 60 minutos o más pasan a ser lo
normal, y «90 min» se lee peor que «1 h 30 min». El escenario 2 de US1 ya espera «1 h».

**Impacto**: los e2e de la 001 que comprueban «30 min» siguen valiendo. Los que esperen
«90 min» o «45 min» se actualizan. No es un cambio de comportamiento sino del texto que
pide la spec.

---

## D-010 — Datos de prueba y de la demo

**Decisión**:

- `db/seed/seed.ts` (el fixture de los tests) añade un cuarto servicio **sin precio**,
  `Lavado` (30 min), al final del catálogo. Los tres que ya hay no cambian, para que las
  suites de la 001 sigan comprobando lo mismo.
- `db/seed/demo.ts` pone los cuatro servicios de Niza sin precio, en lugar de con 0.
- `writeConfiguration` acepta `cents: number | null`.

**Rationale**: hace falta un servicio sin precio en el fixture para probar US3 de
principio a fin. El CLAUDE.md prohíbe cambiar el fixture para la demo, no ampliarlo para
una feature. Los tests que cuentan servicios (por ejemplo, el de contrato de
`/services`) se ajustan en la misma tarea.

---

## D-011 — Persistencia y una sola consulta de disponibilidad

**Decisión**:

- `insert` escribe la cita y sus servicios en **una transacción**. Si la restricción
  `EXCLUDE` rechaza la cita, no queda ninguna fila de servicios suelta.
- `findByTokenHash` lee la cita y sus servicios en **una consulta**, con
  `json_agg(… ORDER BY position)`.
- `findConfirmedInWindow` **no cambia**: la disponibilidad sólo necesita los intervalos
  ocupados, no los servicios. Se mantiene la consulta única de 001/D-003 y SC-004.
- La anonimización (001/D-012) no toca `appointment_service`, que no tiene datos
  personales. La cita anonimizada conserva sus servicios como histórico (FR-035a de la
  001).

**Alternativa descartada**: leer los servicios con una segunda consulta por cita. No
cambia nada para una cita sola, pero la 002 heredaría el patrón para la agenda, y ahí
sería N+1 (Principio VIII).

---

## D-012 — Estrategia de testing y orden de trabajo

**Decisión**: primero una refactorización con la suite en verde y luego las historias,
siempre empezando por un test que falla.

1. **Refactor**: la migración 0003 y el cambio de tipos a una lista de un elemento. La
   suite completa de la 001 y la 003 tiene que seguir en verde sin cambiar
   comportamiento, sólo el nombre del parámetro en URL, API y tests (`serviceIds`).
2. **US1**: unitarios de `selectServices`, de la duración total y de `totalPriceOf`
   (el escenario 6 de US1 ya pide el precio total); integración de
   `confirmBooking` con varios servicios, incluida una confirmación concurrente que
   solapa sólo una parte del tramo (FR-016); contrato 2.0.0; e2e de la reserva con dos
   servicios en los tres tamaños.
3. **US2**: unitarios de `applyReschedule` con duración total; integración; e2e de
   consultar y reprogramar; e2e de una cita anterior a la feature (FR-021, cargada en el
   estado que deja la migración).
4. **US3**: contrato y e2e de los servicios sin precio y del caso mixto, y un test que
   recorre todas las pantallas y comprueba que no aparece «0,00 €» (SC-005). El servicio
   sin precio del fixture (`Lavado`) entra ya en la fase 2, porque el quickstart de US1
   lo usa.

La comprobación de rendimiento (SC-004) se repite con cuatro servicios elegidos.
