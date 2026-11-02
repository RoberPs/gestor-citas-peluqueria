# Phase 1 — Data Model: Reserva de citas de peluquería v1

**Feature**: `001-client-appointment-booking` | **Date**: 2026-09-15

Este documento define las entidades, sus invariantes y el esquema relacional. Distingue deliberadamente entre el **tipo de dominio** (lo que manipula `src/domain`) y la **tabla** (lo que conoce `src/infrastructure`): la traducción entre ambos vive en el repositorio, nunca en el dominio (Principio I).

---

## Mapa de entidades

```text
Salon (1) ──< OpeningInterval        configuración precargada, no editable en v1
  │      ──< Closure                 festivos y ausencias
  │
  └──< Service (catálogo)            configuración precargada
          │
          └──< Appointment           la ÚNICA entidad que esta feature crea o modifica
                    │
                    └── snapshot del servicio (nombre, duración, precio al reservar)
                    └── datos de contacto (nombre, teléfono, email) — se borran a los 12 meses
                    └── token_hash — se inutiliza en el mismo acto

Slot ─── NO SE PERSISTE. Concepto derivado.
```

**Regla de alcance**: `Appointment` es la única tabla que esta feature escribe. Salón, tramos, cierres y servicios son datos de configuración precargados (FR-007) y esta feature **sólo los lee**.

---

## Entidades de configuración (sólo lectura en v1)

### Salon

El establecimiento único de esta instancia. Una sola fila, siempre (asunción 11: un salón por instancia, sin identificador de salón en ningún flujo ni pantalla).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | Clave primaria. No aparece en ninguna URL ni pantalla. |
| `name` | `text` | Se muestra en la confirmación y en el detalle de la cita (FR-014). |
| `address` | `text` | Ídem. |
| `phone` | `text` | Se muestra además en todo mensaje que remita al salón (FR-028, FR-039). |
| `timezone` | `text` | IANA. Valor inicial `Europe/Madrid`. **Es configuración, no una constante del sistema** (asunción 9). |

**Invariante**: existe exactamente una fila. Se garantiza con una restricción de fila única.

### OpeningInterval

Un tramo de apertura de un día de la semana. Un día puede tener uno, varios o ninguno (FR-007a).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | |
| `weekday` | `smallint` | 1 = lunes … 7 = domingo (ISO-8601). |
| `starts_at` | `time` | Hora **de pared**, no instante. Se interpreta en la zona del salón en cada fecha concreta. |
| `ends_at` | `time` | |

**Invariantes**:

- `starts_at < ends_at`. Ningún tramo cruza la medianoche.
- Dos tramos del mismo día no se solapan ni se tocan (si se tocaran, serían un solo tramo).
- Un día de la semana sin ninguna fila es un **día cerrado**, indistinguible a efectos de disponibilidad de un cierre (FR-007a).

**Ejemplo** (día con cierre de mediodía, el escenario 3 de la Historia 1):

```text
weekday=5  10:00 → 14:00
weekday=5  16:00 → 20:00
```

El intervalo 14:00–16:00 no es un dato: es **la ausencia de dato**, y el dominio lo trata como tiempo no reservable.

### Closure

Un día completo cerrado por festivo o ausencia.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | |
| `date` | `date` | Fecha local del salón. |
| `reason` | `text` | Interno. **No se muestra al cliente**: el cliente ve "cerrado", nunca por qué. |

**Invariante**: `date` es única. Un cierre cubre el día entero; v1 no modela cierres parciales.

**Nota**: el motivo no se expone en ninguna respuesta de la API. Que el salón cierre por vacaciones o por una baja no es información del cliente.

### Service

Una prestación reservable del catálogo.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | Aparece en la API como identificador opaco del servicio. |
| `name` | `text` | |
| `duration_minutes` | `integer` | |
| `price_cents` | `integer` | Entero en céntimos, nunca coma flotante. |
| `is_active` | `boolean` | Un servicio retirado deja de ofrecerse, pero las citas que lo referencian siguen íntegras. |
| `display_order` | `integer` | Orden en el catálogo. |

**Invariantes**:

- `duration_minutes > 0`.
- `price_cents >= 0`. El precio es informativo: v1 no cobra nada (asunción 12).
- **`is_active = false` nunca borra ni altera citas existentes.** El snapshot de D-011 las protege.

---

## Appointment — la entidad central

La reserva de un cliente. Única entidad que esta feature crea y modifica.

### Tipo de dominio

```typescript
type AppointmentStatus = 'CONFIRMED' | 'CANCELLED';   // persistido (FR-030)

type AppointmentView = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
// COMPLETED es DERIVADO del reloj, nunca persistido (FR-031)

type Appointment = {
  id: AppointmentId;
  status: AppointmentStatus;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;          // derivado de la duración al confirmar
  service: ServiceSnapshot;          // congelado al reservar (FR-016, D-011)
  customer: CustomerContact | null;  // null tras la anonimización (BR-018)
  createdAt: Temporal.Instant;
  cancelledAt: Temporal.Instant | null;
  anonymizedAt: Temporal.Instant | null;
};

type ServiceSnapshot = {
  serviceId: ServiceId;              // para reprogramar al MISMO servicio (FR-024)
  name: string;
  durationMinutes: number;
  priceCents: number;
};

type CustomerContact = {
  name: string;
  phone: string;                     // tal como lo escribió el cliente
  email: string;
};
```

**Sobre `COMPLETED`**: no es un estado persistido y no existe ningún proceso que lo asigne. Se calcula al leer, comparando `endsAt` con el reloj del servidor (FR-031). Persistirlo obligaría a un proceso en segundo plano y abriría la puerta a que la agenda mostrara un estado desfasado.

**Sobre `customer: null`**: el tipo obliga a tratar el caso anonimizado en todo punto que use datos de contacto. TypeScript en modo `strict` convierte el olvido en error de compilación, no en incidente de privacidad.

### Tabla `appointment`

| Columna | Tipo | Nulo | Notas |
|---|---|---|---|
| `id` | `uuid` | no | PK. Es el identificador **interno**; nunca aparece en una URL de cliente. |
| `status` | `appointment_status` | no | Enum `CONFIRMED` \| `CANCELLED` (FR-030). |
| `starts_at` | `timestamptz` | no | Instante absoluto. |
| `ends_at` | `timestamptz` | no | `starts_at + duración` del snapshot. |
| `service_id` | `uuid` | no | FK a `service`, `ON DELETE RESTRICT`. |
| `service_name` | `text` | no | Snapshot (FR-016). |
| `service_duration_minutes` | `integer` | no | Snapshot. |
| `service_price_cents` | `integer` | no | Snapshot. |
| `customer_name` | `text` | **sí** | Nulo tras anonimizar. |
| `customer_phone` | `text` | **sí** | Nulo tras anonimizar. |
| `customer_email` | `text` | **sí** | Nulo tras anonimizar. |
| `customer_phone_normalized` | `text` | **sí** | Forma canónica E.164 para el conteo de BR-014. Nulo tras anonimizar. |
| `customer_email_normalized` | `text` | **sí** | Minúsculas y sin espacios, ídem. Nulo tras anonimizar. |
| `token_hash` | `bytea` | **sí** | `sha256` del token (D-005). `UNIQUE`. Nulo tras anonimizar: el enlace deja de resolver. |
| `created_at` | `timestamptz` | no | |
| `cancelled_at` | `timestamptz` | **sí** | No nulo si y sólo si `status = 'CANCELLED'`. |
| `anonymized_at` | `timestamptz` | **sí** | Marca de la purga por retención. |

**Por qué las columnas normalizadas**: BR-014 limita a 3 las citas confirmadas futuras "por teléfono o por email". Sin normalizar, `+34 600 11 22 33` y `600112233` contarían como personas distintas y el límite sería trivial de eludir sin proponérselo. La columna normalizada hace que la comprobación sea una búsqueda indexada sobre una forma canónica. Se guarda además el valor original tal como lo escribió el cliente, porque es el que la dueña usará para llamar.

### Restricciones de tabla

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- BR-001 / SC-002 / FR-012: el solape es IMPOSIBLE, no improbable.
ALTER TABLE appointment ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status = 'CONFIRMED');

-- BR-002: la franja es coherente.
ALTER TABLE appointment ADD CONSTRAINT appointment_positive_duration
  CHECK (ends_at > starts_at);

-- FR-030: cancelled_at y el estado no pueden discrepar.
ALTER TABLE appointment ADD CONSTRAINT appointment_cancelled_consistency
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));

-- BR-018: la anonimización es TODO o NADA. No existe la cita medio anonimizada
-- con el enlace aún funcionando.
ALTER TABLE appointment ADD CONSTRAINT appointment_anonymization_is_atomic
  CHECK (
    (anonymized_at IS NULL
      AND customer_name IS NOT NULL AND customer_phone IS NOT NULL
      AND customer_email IS NOT NULL AND token_hash IS NOT NULL)
    OR
    (anonymized_at IS NOT NULL
      AND customer_name IS NULL AND customer_phone IS NULL
      AND customer_email IS NULL AND customer_phone_normalized IS NULL
      AND customer_email_normalized IS NULL AND token_hash IS NULL)
  );
```

La última restricción merece subrayarse: convierte BR-018 en un invariante que la base de datos impone. Ningún error de programación futuro puede dejar una cita sin nombre pero con el enlace vivo, ni con el enlace muerto pero conservando el teléfono.

**Nota sobre `[)`**: el intervalo semiabierto es lo que permite BR-013 —sin margen entre citas—. Una cita que termina a las 11:30 y otra que empieza a las 11:30 no solapan.

### Índices

```sql
-- D-003 / SC-005: el histórico pasado no participa en la consulta de disponibilidad.
CREATE INDEX appointment_confirmed_starts_at_idx
    ON appointment (starts_at) WHERE status = 'CONFIRMED';

-- D-005: resolución del enlace en O(1).
CREATE UNIQUE INDEX appointment_token_hash_idx
    ON appointment (token_hash) WHERE token_hash IS NOT NULL;

-- BR-014: conteo de citas futuras por contacto.
CREATE INDEX appointment_phone_future_idx
    ON appointment (customer_phone_normalized, starts_at) WHERE status = 'CONFIRMED';
CREATE INDEX appointment_email_future_idx
    ON appointment (customer_email_normalized, starts_at) WHERE status = 'CONFIRMED';

-- D-012: barrido de la purga por retención.
CREATE INDEX appointment_retention_idx
    ON appointment (starts_at) WHERE anonymized_at IS NULL;
```

Los cinco son **parciales**. Es la decisión que sostiene SC-005: el índice de disponibilidad contiene sólo citas confirmadas del futuro y del pasado reciente, y su tamaño está acotado por el negocio (un sillón), no por la antigüedad del salón.

---

## Slot — entidad derivada, nunca persistida

Un `Slot` es un inicio candidato para un servicio en un día. **No se almacena, no se reserva y no se bloquea** mientras el cliente rellena el formulario (caso límite explícito de la especificación).

```typescript
type Slot = {
  startsAt: Temporal.Instant;
  localTime: string;          // "11:30", hora del salón, ya formateada
  isCurrentAppointment: boolean;  // sólo al reprogramar (FR-027)
};
```

Se calcula con la función pura de D-003:

```text
(tramos del día, cierres, duración del servicio, citas confirmadas, instante actual) → Slot[]
```

Un inicio se ofrece si y sólo si cumple **las cuatro condiciones de FR-003**:

1. `[inicio, inicio + duración)` cabe entero dentro de **un mismo tramo de apertura**, sin cruzar ningún cierre intermedio (BR-002).
2. No solapa ninguna cita confirmada (BR-001).
3. `inicio >= ahora + 2 h` (BR-003).
4. `inicio` cae dentro de los 60 días del horizonte (BR-011).

Los inicios candidatos se generan en rejilla de 30 minutos anclada a la hora en punto, **recorriendo cada tramo por separado** (FR-004). Esto es lo que impide que un servicio de 90 minutos se ofrezca a las 13:00 en un día que cierra a las 14:00, aunque las 13:00 estén dentro de un tramo abierto.

**Por qué no se persiste**: si el hueco fuera una fila, cambiar la duración de un servicio o retirar un tramo obligaría a regenerar la tabla, y un servicio de duración distinta ya no encajaría en ninguna fila existente. Derivarlo garantiza además que lo que se muestra y lo que se autoriza salen del **mismo código** (SC-003, Principio VI).

---

## DayStatus — estado de un día en el rango

```typescript
type DayStatus = 'CLOSED' | 'FULL' | 'AVAILABLE';

type RangeDay = {
  date: string;        // "2026-09-18", fecha local del salón
  weekdayLabel: string;
  status: DayStatus;
  slotCount: number;   // 0 si CLOSED o FULL; alimenta el nombre accesible (D-014)
};
```

- **`CLOSED`**: el día no tiene ningún tramo de apertura, o tiene un cierre. Se presenta como cerrado, **no como lleno** (caso límite de la especificación).
- **`FULL`**: el día está abierto pero ningún inicio admite ese servicio. Depende del servicio: un día lleno para "Color" puede tener huecos para "Corte".
- **`AVAILABLE`**: al menos un hueco.

La distinción entre `CLOSED` y `FULL` es un requisito de producto, no un detalle de presentación: al cliente le dice si vuelve a mirar otro día o si ese día simplemente no existe para el salón.

---

## Transiciones de estado

```text
                  confirmar (FR-011, FR-012, FR-013)
        ∅ ──────────────────────────────────► CONFIRMED
                                                 │ │
                     cancelar, > 24 h (BR-004)   │ │  reprogramar, > 24 h (FR-024)
                                                 │ │  ── cambia franja, MISMO estado,
                                                 │ │     MISMO token (FR-026)
                                                 ▼ │
                                            CANCELLED ◄┘ (no: reprogramar no cancela)

        CANCELLED ── es TERMINAL (BR-007): ninguna transición sale de aquí.

        COMPLETED ── no es un estado. Es CONFIRMED visto después de ends_at (FR-031).
```

Reglas que el dominio impone, cada una con su requisito:

| Transición | Condición | Requisito |
|---|---|---|
| ∅ → `CONFIRMED` | Hueco válido según FR-003 **en el instante de confirmar**, y ni el teléfono ni el email alcanzan por separado 3 citas confirmadas futuras | FR-011, FR-013 |
| `CONFIRMED` → `CANCELLED` | Faltan más de 24 h para `startsAt`, con confirmación explícita del cliente | BR-004, FR-022 |
| `CONFIRMED` → `CONFIRMED` (nueva franja) | Faltan más de 24 h, el hueco nuevo es válido para el **mismo servicio**, atómico | FR-024, FR-025, BR-006 |
| `CANCELLED` → cualquier cosa | **Prohibida.** Estado terminal | BR-007, FR-029 |
| Cita pasada → cualquier cosa | **Prohibida.** Sólo lectura | BR-010, FR-029 |

**La reprogramación no cancela y vuelve a crear.** Es un `UPDATE` de la franja sobre la misma fila, dentro de una transacción. Por eso el token sobrevive (FR-026) y por eso, si la restricción `EXCLUDE` rechaza la franja nueva, la transacción revierte y **la cita original queda intacta en su hora original** (FR-025, BR-006). Cancelar y recrear dejaría al cliente, en el caso de fallo, sin cita y sin hueco: exactamente lo que BR-006 prohíbe.

---

## Reglas de validación y dónde viven

| Regla | Dónde se decide | Requisito |
|---|---|---|
| Nombre no vacío, máximo 100 caracteres | Dominio (`CustomerContact`) | FR-008 |
| Teléfono español válido, móvil o fijo, prefijo opcional | Dominio, invocado desde Zod vía `refine` (D-009) | FR-009 |
| Email sintácticamente válido | Ídem | FR-009 |
| El hueco cumple las 4 condiciones de FR-003 | Dominio, **revalidado al confirmar** | FR-011 |
| Sin solape con cita confirmada | Dominio **y** restricción `EXCLUDE` | BR-001, FR-012 |
| Máximo 3 citas confirmadas futuras | Caso de uso, con consulta indexada | BR-014 |
| Plazo de 24 h para cancelar o reprogramar | Dominio, contra el reloj del servidor | BR-004 |
| Antelación mínima de 2 h | Dominio, contra el reloj del servidor | BR-003 |
| Horizonte de 60 días | Dominio | BR-011 |

Ninguna de estas reglas se reimplementa en la UI. El formulario puede anticipar el resultado para dar feedback inmediato, reutilizando el **mismo módulo** de dominio vía TypeScript, pero la decisión autoritativa es siempre la del servidor (Principio I, FR-034).

---

## Ciclo de vida de los datos personales

```text
Confirmación ──► nombre, teléfono, email, token_hash presentes
                 │
                 │  ... la cita transcurre, se completa o se cancela ...
                 │
     12 meses desde starts_at
                 │
                 ▼
Purga (D-012) ──► los tres campos, sus formas normalizadas y token_hash → NULL
                  anonymized_at → now()
                  ─────────────────────────────────────────────────────
                  SE CONSERVAN: servicio (snapshot), franja, estado,
                  created_at, cancelled_at  → histórico de ocupación completo
                  ─────────────────────────────────────────────────────
                  El enlace deja de resolver. Abrirlo es indistinguible
                  de abrir uno que nunca existió (FR-019, FR-020, BR-018).
```

Todo en una sola sentencia `UPDATE`, con la restricción `appointment_anonymization_is_atomic` impidiendo cualquier estado intermedio.

**Prohibición transversal** (FR-036, Principio III): `customer_name`, `customer_phone`, `customer_email` y el token en claro **no se escriben nunca** en logs, trazas de error ni eventos de analítica. Las trazas referencian `appointment.id`, que es interno y no aparece en ninguna URL de cliente. El logger lleva configurada la redacción de esas claves, y un test unitario verifica que una traza de error de reserva no contiene ninguno de los tres valores.
