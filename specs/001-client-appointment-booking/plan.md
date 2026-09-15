# Implementation Plan: Reserva de citas de peluquería (cara al cliente) v1

**Branch**: `001-client-appointment-booking` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-client-appointment-booking/spec.md`

## Summary

El cliente reserva, consulta, reprograma y cancela su cita en un salón de un solo sillón, sin cuenta de usuario y desde el móvil. El requisito nuclear es que **todo hueco mostrado sea reservable de verdad** (FR-003, SC-003) y que **dos citas confirmadas no puedan solaparse jamás** (BR-001, SC-002).

El enfoque técnico es una aplicación **Next.js 15 + TypeScript** con arquitectura hexagonal: las reglas de disponibilidad, reserva, cancelación y reprogramación viven en `src/domain`, un módulo puro sin ninguna importación del framework ni de la base de datos, y la frontera se verifica automáticamente en CI (Principio I).

Tres decisiones sostienen los criterios de éxito más exigentes:

1. **La no-superposición se garantiza en la base de datos**, con una restricción `EXCLUDE USING gist` sobre el rango temporal de las citas confirmadas. Dos confirmaciones simultáneas no pueden prosperar ambas aunque la lógica de aplicación fallara (FR-012, BR-001).
2. **La disponibilidad se resuelve con una única consulta** que carga las citas confirmadas de todo el horizonte de 60 días; el estado de los 14 días del rango, los huecos del día seleccionado y el salto al siguiente día con disponibilidad se calculan en memoria en el dominio (FR-005b, FR-006, SC-005).
3. **El enlace de gestión es la credencial**: 32 bytes aleatorios criptográficamente seguros (256 bits, por encima del mínimo de 128 de FR-017), de los que la base de datos almacena únicamente su hash SHA-256. Borrar el hash inutiliza el enlace en el mismo acto del borrado de datos personales (FR-035, BR-018).

## Technical Context

**Language/Version**: TypeScript 5.7 en modo `strict` (con `noUncheckedIndexedAccess`), Node.js 22 LTS

**Primary Dependencies**:

- Next.js 15 (App Router) + React 19 — UI y Route Handlers en un solo proyecto
- `@js-temporal/polyfill` — aritmética de calendario con zona horaria y DST en la capa de dominio
- Drizzle ORM + `drizzle-kit` + `pg` — acceso a datos tipado con migraciones SQL escritas a mano
- Zod 3 — validación de la frontera HTTP, delegando las reglas de formato al dominio
- Pino — logging estructurado con redacción de PII

**Storage**: PostgreSQL 16 con la extensión `btree_gist`, desplegada junto a la aplicación en el mismo `docker compose`

**Testing**: Vitest (unitario e integración) + Playwright (end-to-end) + `@axe-core/playwright` (accesibilidad automatizada). PostgreSQL real en los tests de integración y e2e mediante el servicio `db-test` de `docker compose`

**Target Platform**: Contenedor Linux sobre VPS. Proceso único de aplicación por salón (una instancia independiente por dueña, asunción 11)

**Project Type**: Aplicación web renderizada en servidor con API HTTP propia

**Performance Goals**:

- Respuesta percibida < 2 s en cualquier acción del flujo, en móvil de gama media sobre 4G (SC-004, Principio VIII)
- Consulta de disponibilidad: **una sola consulta SQL** por carga de rango, con tiempo invariante frente al crecimiento del histórico (SC-005)
- Presupuesto de JavaScript del cliente ≤ 120 KB comprimidos en la ruta de reserva

**Constraints**:

- Ninguna decisión temporal usa el reloj del dispositivo: todas contra el reloj del servidor y `Europe/Madrid` (FR-032, BR-015)
- Nombre, teléfono y email nunca entran en logs, trazas ni analítica (FR-036, Principio III)
- Interfaz operable con una mano a 360 px de ancho, sin scroll horizontal (SC-011)
- WCAG 2.2 nivel AA en todas las pantallas (SC-010, Principio VII)
- Sin mensajería saliente de ningún tipo en v1 (asunción 5)
- El limitador por IP vive en la memoria del proceso: exige **un solo worker de aplicación por salón**, coherente con *Target Platform*. Su secreto es fijo durante la vida del proceso y se rota reiniciándolo; rotarlo en caliente reiniciaría en silencio todas las ventanas vivas. Escalar a varios procesos obligaría a mover el contador a PostgreSQL (FR-038, FR-039)

**Scale/Scope**: Un salón, un sillón, un idioma. 5 rutas de cara al cliente: reserva (`/`), formulario (`/reservar`), detalle de la cita (`/cita/[token]`, que hace también de pantalla de confirmación cuando llega con `?nueva=1`), reprogramación (`/cita/[token]/reprogramar`) y enlace no válido. Volumen máximo teórico del horizonte: 60 días × 20 huecos/día ≈ 1.200 citas vivas; histórico de 10.000+ citas pasadas sin impacto en la disponibilidad.

### Parámetros del dominio fijados en esta fase

La asunción 7 de la especificación difiere a `/speckit-plan` los valores concretos de los límites antiabuso. Quedan fijados aquí:

| Parámetro | Valor | Origen |
|---|---|---|
| Antelación mínima de reserva | 2 h | BR-003 |
| Plazo de cancelación y reprogramación | 24 h | BR-004 |
| Horizonte de reserva | 60 días | BR-011 |
| Tamaño del rango de días | 14 días | BR-011b |
| Rejilla de inicios | 30 min, anclada a la hora en punto | BR-012 |
| Máximo de citas confirmadas futuras | 3 por teléfono **o** por email | BR-014 |
| Límite de apertura de enlaces por IP | **30 aperturas / 10 min** | FR-038, **fijado aquí** |
| Límite de confirmaciones por IP | **5 / hora** y **15 / 24 h** | FR-039, **fijado aquí** |
| Retención de datos personales | 12 meses desde la fecha de la cita | FR-035 |
| Ejecución del borrado por retención | Diaria, 03:30 hora del salón | **fijado aquí** |
| Zona horaria del salón | `Europe/Madrid` (configuración, no constante) | Asunción 9 |

Los dos límites por IP se sitúan deliberadamente muy por encima del uso legítimo: un cliente reserva una vez y abre su enlace unas pocas veces. El margen absorbe además a varios clientes tras una misma IP compartida (NAT móvil, wifi de centro comercial), y quien aun así lo alcance recibe el mensaje accionable de FR-039 con el teléfono del salón.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluado contra la Constitución v1.0.0.

| Principio | Estado | Cómo lo satisface este diseño |
|---|---|---|
| **I. Calidad de código y separación de capas** | ✅ PASS | `src/domain` es TypeScript puro: no importa Next.js, React, Drizzle ni `pg`. La frontera se verifica en CI con `dependency-cruiser` y falla el build si se cruza. Las reglas de solape, rejilla, plazos y horizonte existen **una sola vez**, en el dominio; la UI nunca las reimplementa, sólo muestra lo que el dominio devuelve. Toda función pública del dominio devuelve un `Result<T, E>` con sus modos de fallo declarados en el tipo. |
| **II. Disciplina de testing** | ✅ PASS | TDD obligatorio: cada tarea de `/speckit-tasks` empieza por un test que falla. Los cinco casos límite exigidos por la constitución tienen test unitario nombrado (doble reserva, solapamiento, fuera de horario, cancelación fuera de plazo; el quinto —recordatorio de cita cancelada— **no aplica**, v1 no envía nada). Cada historia de usuario tiene al menos un test e2e en Playwright. Cero tests saltados o desactivados en `main`. |
| **III. Minimización de datos personales** | ⚠️ PASS con condición | Exactamente tres campos personales, ninguno más. Pino con `redact` sobre `name`, `phone`, `email` y el token, más un test que verifica que una traza de error no los contiene. El borrado a los 12 meses anonimiza y es completo (FR-035a). **Condición**: la constitución exige que el borrado a petición del cliente "DEBE ser posible y completo", y la especificación deja el *flujo de cara al cliente* fuera de alcance. Se resuelve exponiendo la capacidad —no la pantalla— en esta feature: el caso de uso `anonymizeAppointment` y el comando `npm run retention:purge -- --appointment <id>` permiten a la dueña atender una petición de borrado desde el día uno. La pantalla queda para una feature posterior, sin dejar la exigencia constitucional sin cubrir. |
| **IV. Comunicaciones y consentimiento** | ➖ N/A | v1 no envía SMS ni email, ni siquiera la confirmación (asunción 5). No hay canal, luego no hay consentimiento que recoger ni auditoría de envíos que mantener. El teléfono y el email se recogen para contacto del salón por vías ajenas a la app. Ningún código de esta feature envía nada. |
| **V. Seguridad** | ✅ PASS | Toda entrada se revalida en servidor con Zod + reglas de dominio, incluidas las que la UI ya validó (FR-034). La autorización es una credencial de capacidad: el token de 256 bits **es** la autenticación y la autorización de esa cita y de ninguna otra (asunción 1, FR-017). La base de datos guarda sólo su hash SHA-256, de modo que un volcado de la base no entrega enlaces utilizables. Ningún endpoint devuelve datos de otra cita ni de la agenda (FR-018, BR-009). Secretos por variable de entorno, con `.env` en `.gitignore` y un `.env.example` sin valores. HTTPS terminado en el proxy inverso, con HSTS y cookies inexistentes (no hay sesión). |
| **VI. Experiencia de usuario** | ✅ PASS | Cuatro pasos hasta confirmar: servicio → día → hueco → datos. Los huecos mostrados son disponibilidad real porque los calcula el mismo código de dominio que luego autoriza la reserva, y se revalidan en el instante de confirmar (FR-011). Toda acción devuelve estado de carga, éxito o error, y todo error indica qué hacer a continuación (FR-037, SC-012). Cancelar y reprogramar piden confirmación explícita (FR-022). Mobile-first: se diseña a 360 px y se escala hacia arriba. |
| **VII. Accesibilidad** | ✅ PASS | HTML semántico, sin `div` clicables. El estado de cada día del rango se comunica con **texto e icono además de color** (SC-010, FR-005). Rejilla de días y lista de huecos navegables por teclado con foco visible. Errores de formulario asociados al campo con `aria-describedby` y anunciados en una región `aria-live`. `@axe-core/playwright` corre sobre las cinco pantallas y falla el build ante cualquier violación de nivel AA. |
| **VIII. Rendimiento** | ✅ PASS | La disponibilidad se resuelve con **una sola consulta** que trae las citas confirmadas del horizonte; el estado de los 14 días y los huecos del día se derivan en memoria. Cero consultas N+1 por construcción: no hay ningún bucle sobre días que consulte la base. La consulta usa un índice parcial sobre citas confirmadas, de modo que el histórico pasado —por grande que sea— no participa (SC-005). Renderizado en servidor con hidratación selectiva para mantener el presupuesto de JavaScript. |

**Veredicto del gate previo a Fase 0**: aprobado. La única condición (Principio III) se cubre dentro de esta feature mediante el comando de anonimización; no requiere enmienda de la constitución.

**Re-evaluación posterior a Fase 1**: ver [Constitution Re-Check](#constitution-re-check-post-design) al final del documento.

## Project Structure

### Documentation (this feature)

```text
specs/001-client-appointment-booking/
├── plan.md              # Este archivo
├── research.md          # Fase 0: decisiones técnicas y alternativas descartadas
├── data-model.md        # Fase 1: entidades, invariantes y esquema relacional
├── quickstart.md        # Fase 1: guía de arranque y validación end-to-end
├── contracts/
│   ├── http-api.yaml    # OpenAPI 3.1 de los endpoints de cara al cliente
│   └── domain-api.md    # Contratos tipados de las funciones públicas del dominio
├── checklists/
│   └── requirements.md  # Checklist de calidad de la especificación (ya existente)
└── tasks.md             # Fase 2: generado por /speckit-tasks, NO por este comando
```

### Source Code (repository root)

```text
src/
├── domain/                        # TypeScript puro. Prohibido importar framework o BD.
│   ├── shared/
│   │   ├── result.ts              # Result<T, E>: éxito o fallo declarado, sin excepciones
│   │   ├── clock.ts               # Puerto Clock: el dominio nunca llama a Date.now()
│   │   └── time.ts                # SalonTime: instante ↔ hora local del salón, DST incluido
│   ├── catalog/
│   │   ├── service.ts             # Service: nombre, duración, precio
│   │   └── salon.ts               # Salon: datos, zona horaria, tramos semanales, cierres
│   ├── contact/
│   │   └── contact.ts             # Formato de nombre, teléfono y email (FR-009, D-009)
│   ├── availability/
│   │   ├── slot-grid.ts           # Rejilla de 30 min anclada a la hora, por tramo (FR-004)
│   │   ├── compute-day.ts         # Huecos de un día: las 4 condiciones de FR-003
│   │   ├── compute-range.ts       # Estado de 14 días: cerrado | lleno | con huecos (FR-005)
│   │   └── next-available.ts      # Siguiente día con disponibilidad hasta el horizonte (FR-006)
│   ├── booking/
│   │   ├── appointment.ts         # Appointment: estado, franja, snapshot del servicio
│   │   ├── confirm.ts             # Reglas de confirmación: FR-011, FR-013, BR-003
│   │   ├── cancel.ts              # Reglas de cancelación: BR-004, BR-007
│   │   ├── reschedule.ts          # Reglas de reprogramación: FR-024..FR-027, BR-006
│   │   ├── modification-rules.ts  # canCancel / canReschedule, compartidas por US4-US6
│   │   └── derive-view.ts         # COMPLETED derivado del reloj, nunca persistido (FR-031)
│   └── privacy/
│       └── anonymize.ts           # Qué se borra y qué se conserva a los 12 meses (BR-018)
│
├── application/                   # Casos de uso. Orquesta dominio + puertos. Sin HTTP.
│   ├── ports/                     # AppointmentRepository, SalonConfigRepository,
│   │                              # TokenGenerator, RateLimiter, Clock
│   └── use-cases/                 # list-services, get-availability, confirm-booking,
│                                  # view-appointment, cancel-appointment,
│                                  # reschedule-appointment, purge-expired-personal-data
│
├── infrastructure/                # Adaptadores. El único lugar que conoce Postgres.
│   ├── db/
│   │   ├── schema.ts              # Definición Drizzle de las tablas
│   │   ├── migrations/            # SQL a mano: incluye la restricción EXCLUDE
│   │   ├── appointment-repository.ts
│   │   └── salon-config-repository.ts
│   ├── security/
│   │   ├── token.ts               # 32 bytes de randomBytes → base64url; hash SHA-256
│   │   └── rate-limiter.ts        # Ventana deslizante en memoria, IP hasheada (FR-040)
│   ├── time/system-clock.ts
│   └── logging/logger.ts          # Pino con redacción de PII
│
├── app/                           # Next.js App Router: presentación y HTTP
│   ├── page.tsx                   # Pantalla de reserva (HU1)
│   ├── reservar/                  # Formulario y confirmación (HU2, HU3)
│   ├── cita/[token]/              # Detalle, cancelación y reprogramación (HU4, HU5, HU6)
│   └── api/                       # Route Handlers: la API de contracts/http-api.yaml
│
├── components/                    # Presentación pura, sin lógica de negocio
│   └── ...                        # DayRangePicker, SlotList, BookingForm, ...
│
└── messages/es-ES.ts              # Todos los textos de la interfaz, en un solo sitio
tests/
├── unit/                          # Dominio puro, sin infraestructura. El grueso de la suite.
├── integration/                   # Casos de uso contra PostgreSQL real
├── contract/                      # Route Handlers contra el OpenAPI
└── e2e/                           # Playwright: una historia de usuario por archivo, + axe
db/
└── seed/                          # Configuración precargada: salón, servicios, tramos, cierres
scripts/
└── retention-purge.ts             # Comando del borrado por retención (cron diario)
```

**Structure Decision**: proyecto único Next.js con arquitectura hexagonal en cuatro capas bajo `src/`. Se descarta separar backend y frontend en dos despliegues porque duplicaría la validación de formato de teléfono y email —exactamente lo que el Principio I prohíbe— y penalizaría la primera carga en móvil, que es el escenario de SC-004 y SC-011. La separación que la constitución exige es **de dependencias, no de despliegue**, y se consigue con `src/domain` aislado y verificado en CI.

La dirección de las dependencias es estricta y unidireccional: `app` → `application` → `domain`, con `infrastructure` implementando los puertos que declara `application`. `domain` no importa a nadie.

## Complexity Tracking

Sin violaciones de la Constitución que justificar. Las cuatro capas bajo `src/` no son complejidad añadida: son la forma mínima de cumplir el Principio I, que exige que las reglas de dominio no importen tipos del framework web ni de la base de datos. Un diseño de menos capas obligaría a que la regla de solape conociera Drizzle, lo que la constitución prohíbe expresamente.

## Constitution Re-Check (post-design)

Re-evaluación tras generar `research.md`, `data-model.md`, `contracts/` y `quickstart.md`:

- **Principio I**: el modelo de datos de `data-model.md` distingue el tipo de dominio `Appointment` de la tabla `appointment`; la traducción vive en el repositorio, en `infrastructure`. Los contratos de `contracts/domain-api.md` son funciones puras con entrada, salida y modos de fallo tipados. Sin regresión. ✅
- **Principio II**: el diseño no introduce ninguna pieza no testeable sin infraestructura; toda la lógica de FR-003 a FR-006 es una función pura sobre datos en memoria. ✅
- **Principio III**: `data-model.md` fija que la anonimización pone a `NULL` los tres campos personales y el hash del token en la misma sentencia, conservando franja, estado y servicio. La condición previa sigue cubierta por el comando de purga. ✅
- **Principio V**: el contrato HTTP devuelve **la misma respuesta 404 con el mismo cuerpo** para enlace inexistente, malformado, cita borrada, cita anonimizada y límite por IP superado, sin cabecera que distinga el caso (FR-019, FR-038). ✅
- **Principio VIII**: `GET /api/availability` está especificado para devolver rango, huecos del día y siguiente día disponible **en una sola respuesta**, alimentada por una sola consulta. ✅

**Veredicto posterior al diseño**: aprobado. Sin desviaciones que requieran enmienda.
