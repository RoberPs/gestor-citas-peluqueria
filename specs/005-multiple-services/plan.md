# Implementation Plan: Varios servicios por cita y precio opcional

**Branch**: `005-multiple-services` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-multiple-services/spec.md`

## Summary

Una cita pasa a llevar uno o varios servicios y dura la suma de sus duraciones. Un
servicio puede no tener precio, y entonces se muestra «Precio a consultar en el salón»,
nunca «0,00 €».

El cálculo de disponibilidad ya trabaja con una duración en minutos, así que apenas
cambia. El cambio está en el modelo de cita, en el catálogo y en la frontera: URL, API
y pantallas.

Cinco decisiones lo sostienen ([research.md](./research.md)):

1. **Tabla hija `appointment_service`** con el snapshot de cada servicio. La restricción
   `EXCLUDE` no cambia, porque `ends_at` ya es el inicio más la duración total (D-001).
2. **Precio `NULL`** en el catálogo y en el snapshot, con `CHECK (> 0)`. Los 0 actuales
   pasan a `NULL` (D-002).
3. **El dominio decide** qué servicios entran en la cita y en qué orden, cuánto dura y
   qué precio total se muestra, incluido el caso mixto (D-003).
4. **La selección viaja en la URL** como `serviceIds`, y cada botón lleva la selección
   resultante, así que funciona sin JavaScript y recargar no altera nada (D-004).
5. **Un solo contrato HTTP**, el de la 001, sube a la versión 2.0.0 (D-006).

## Technical Context

**Language/Version**: TypeScript 5.7 (`strict`, `noUncheckedIndexedAccess`), Node.js 22 LTS

**Primary Dependencies**: Next.js 15 (App Router) + React 19, Drizzle ORM + `pg`, Zod 3, `@js-temporal/polyfill`. Sin dependencias nuevas.

**Storage**: PostgreSQL 16. Una migración nueva escrita a mano, `0003_multiple_services.sql`: tabla `appointment_service`, migración de las citas existentes, precio nullable.

**Testing**: Vitest (unitarios de dominio, integración contra `db-test`, contrato contra `http-api.yaml` 2.0.0). Playwright + axe en `mobile-360`, `tablet-768` y `desktop-1280`.

**Target Platform**: El mismo servidor y los mismos navegadores que la 001 y la 003.

**Project Type**: Aplicación web renderizada en servidor (la de la 001).

**Performance Goals**: Respuesta percibida < 2 s con 1 y con 4 servicios elegidos (SC-004). La disponibilidad sigue siendo **una** consulta (001/D-003). Leer una cita sigue siendo **una** consulta (D-011).

**Constraints**:
- Las citas anteriores a la feature se ven y se gestionan igual (FR-021).
- Sin datos personales nuevos (Principio III).
- Funciona sin JavaScript (003/D-003).
- Sólo los anchos de la 003.
- Ninguna pantalla muestra «0,00 €».

**Scale/Scope**: 1 migración, 1 módulo de dominio nuevo y 4 que cambian, 4 casos de uso, 6 Route Handlers, 5 pantallas, 5 componentes, 2 seeds y el contrato.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento |
|---|---|
| I. Capas | ✅ Selección, orden, duración total, precio total y «cabe en el horario» viven en `src/domain` (D-003, D-007). La UI sólo pinta el `kind` que devuelve el dominio. `selection.ts` es TypeScript puro y `check:layers` lo verifica. |
| II. Testing | ✅ Cada historia empieza por tests que fallan (D-012). Primero un refactor con la suite de la 001 y la 003 en verde. Hay tests para los casos límite que exige el principio: el solape parcial de una cita larga en una confirmación concurrente y la reprogramación con duración total. |
| III. Datos personales | ✅ Los tres datos de siempre. `appointment_service` no tiene datos personales, y la anonimización no cambia. |
| IV. Comunicaciones | N/A. No hay envíos (la 004 llegará después). |
| V. Seguridad | ✅ `serviceIds` se valida en servidor con Zod (forma) y con `selectServices` (servicios existentes y activos), también al confirmar (FR-015). El enlace sigue siendo la credencial. |
| VI. Experiencia de usuario | ✅ Elegir varios servicios no añade pasos: cada pulsación actualiza la disponibilidad. Sólo se ofrecen huecos donde cabe la cita entera (FR-008). Mensajes accionables para la selección vacía, la demasiado larga y la hora quitada. |
| VII. Accesibilidad | ✅ `aria-pressed` y «✓ Elegido» con texto e icono. La duración total se anuncia con `aria-live` sin mover el foco. axe en los tres tamaños. |
| VIII. Rendimiento | ✅ `findConfirmedInWindow` no cambia: una consulta. La cita y sus servicios se leen en una consulta con `json_agg`, sin N+1 (D-011). SC-004 se mide con 4 servicios. |

**Post-design re-check**: sin cambios. Ninguna desviación que justificar.

## Project Structure

### Documentation (this feature)

```text
specs/005-multiple-services/
├── plan.md              # Este archivo
├── research.md          # D-001 a D-012
├── data-model.md        # appointment_service, precio nullable, tipos del dominio
├── quickstart.md        # Validación automática y manual
├── contracts/
│   ├── http-api-changes.md   # Cambios del contrato 2.0.0
│   └── ui-booking.md         # URL, selector, resumen y textos
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── catalog/
│   │   ├── service.ts                 # priceCents: number | null
│   │   └── selection.ts               # Nuevo: selectServices, totalPriceOf, fitsOpeningHours, NonEmptyServiceList
│   └── booking/
│       ├── appointment.ts             # services: NonEmptyServiceList; durationOf
│       ├── confirm.ts                 # validateSlot recibe durationMinutes
│       └── reschedule.ts              # duración total de la cita
├── application/
│   ├── ports/index.ts                 # NewAppointment.services
│   └── use-cases/
│       ├── get-availability.ts        # serviceIds; selection, price, fitsOpeningHours
│       ├── confirm-booking.ts         # serviceIds; SelectionError antes del hueco
│       ├── reschedule-appointment.ts  # currentAppointment.durationMinutes
│       └── view-appointment.ts        # sin cambios de lógica
├── infrastructure/db/
│   ├── migrations/0003_multiple_services.sql   # Nueva
│   ├── schema.ts                      # appointmentService; service.priceCents nullable
│   ├── appointment-repository.ts      # insert en transacción; lectura con json_agg
│   └── salon-config-repository.ts     # priceCents nullable
├── app/
│   ├── _lib/format.ts                 # durationLabel en horas; priceLabel(null); totalPriceLabel
│   ├── api/_lib/serializers.ts        # services[], price, priceLabel, fitsOpeningHours
│   ├── api/availability/route.ts      # serviceIds
│   ├── api/appointments/route.ts      # serviceIds; SERVICE_UNAVAILABLE
│   ├── api/services/route.ts          # priceLabel
│   ├── (booking)/page.tsx             # selección, vacía, demasiado larga, horaQuitada
│   ├── (booking)/reservar/page.tsx    # resumen con varios servicios; conservar o quitar la hora (D-005)
│   ├── (booking)/reservar/actions.ts  # serviceIds
│   ├── cita/[token]/page.tsx          # lista de servicios, duración y precio total
│   └── cita/[token]/reprogramar/page.tsx  # aviso en plural; duración total
├── components/
│   ├── service-picker.tsx             # multiselección (D-004), resumen aria-live
│   ├── service-summary.tsx            # Nuevo: líneas de servicio, duración y precio (resumen, confirmación, enlace)
│   ├── day-range-picker.tsx           # serviceIds oculto
│   ├── slot-list.tsx                  # serviceIds oculto
│   └── booking-form.tsx               # serviceIds oculto
└── messages/es-ES.ts                  # Textos de contracts/ui-booking.md

db/seed/
├── configuration.ts                   # cents: number | null
├── seed.ts                            # + Lavado, sin precio (D-010)
└── demo.ts                            # Servicios de Niza sin precio

specs/001-client-appointment-booking/contracts/http-api.yaml   # 2.0.0 (D-006)

tests/
├── unit/domain/catalog/selection.test.ts          # Nuevo
├── unit/domain/booking/{confirm,reschedule}.test.ts
├── unit/ui/format.test.ts                         # Nuevo: duración y precio
├── integration/db/migration-0003.test.ts          # Nuevo: citas anteriores intactas
├── integration/use-cases/{confirm-booking,get-availability,reschedule-appointment}.test.ts
├── contract/*.test.ts                             # serviceIds y esquemas 2.0.0
└── e2e/multiple-services.spec.ts                  # Nuevo: US1–US3 en tres tamaños
```

**Structure Decision**: se mantiene el proyecto único de la 001 con sus cuatro capas.
Hay un archivo nuevo en el dominio (`selection.ts`), otro en componentes
(`service-summary.tsx`, que comparten resumen, confirmación y enlace) y una migración.
Todo lo demás son cambios dentro de archivos existentes.

## Orden de trabajo

1. **Refactor sin cambio de comportamiento**: migración 0003, `services` como lista de
   un elemento y `serviceId` → `serviceIds` en URL, API y tests. La suite completa de la
   001 y la 003 en verde antes de seguir.
2. **US1**: varios servicios al reservar, con la regla del precio total (el resumen la
   necesita, escenario 6).
3. **US2**: consultar y reprogramar.
4. **US3**: precio opcional de principio a fin (contrato, e2e y comprobación de que
   «0,00 €» no aparece en ninguna pantalla). El dominio y el formato del precio ya
   llegaron con US1.
5. **Cierre**: seeds, demo, README, roadmap (paso 1b) y CLAUDE.md, si cambia alguna
   convención.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El cambio de `serviceId` a `serviceIds` toca muchos tests (unos 80 usos) y puede esconder un cambio de comportamiento. | Se hace en el paso 1, como refactor aparte, sin cambiar ninguna comprobación salvo el nombre del parámetro. |
| La migración rompe citas existentes. | Test de integración de la migración sobre datos cargados con el esquema de la 0002 (FR-021). Todo en una transacción. |
| Una cita queda sin servicios o con una duración que no cuadra. | Una transacción en `insert`, el tipo de lista no vacía y un test de integración del invariante (D-001). |
| El test de rendimiento a 360 px, que ya va justo, supera los 2 s. | La disponibilidad no añade consultas. Se mide antes y después en la misma máquina, con 1 y con 4 servicios. |
| Los e2e que esperan «90 min» o «45 min» fallan por el formato nuevo. | Se actualizan en US1, junto con el test unitario de `durationLabel` (D-009). |
| La caché de configuración (001/D-003) oculta el cambio de precios de la demo. | Reiniciar la app tras `db:seed:demo`, como ya dice el README. La 002 lo resuelve. |

## Complexity Tracking

Sin violaciones de la constitución que justificar.
