# Phase 1 — Data Model: Gestión del salón (cara a la dueña) v1

**Feature**: `002-salon-management` | **Date**: 2026-09-16 | **Revised**: 2026-11-03 (005, quién canceló y listado de reservas)

Este documento define las entidades nuevas, los cambios sobre las existentes y el esquema relacional resultante. Mantiene la distinción de la 001 entre el **tipo de dominio** —lo que manipula `src/domain`— y la **tabla** —lo que conoce `src/infrastructure`—: la traducción vive en el repositorio (Principio I).

Lo que no aparece aquí no cambia. `Slot` y el ciclo de vida de los datos personales siguen siendo los de [`../001-client-appointment-booking/data-model.md`](../001-client-appointment-booking/data-model.md). Los servicios de una cita —uno o varios, cada uno con su snapshot en `appointment_service`— y el precio opcional del catálogo son los de [`../005-multiple-services/data-model.md`](../005-multiple-services/data-model.md), que esta feature usa sin cambiarlos.

---

## Mapa de entidades

```text
OwnerAccount (1 fila)  ──< OwnerSession        NUEVAS. No contienen ningún dato de cliente.

Salon (1 fila)  ──< OpeningInterval            pasan de PRECARGADAS a EDITABLES
  │             ──< Service
  │
  ├── minimum_lead_time_minutes                NUEVAS columnas: los dos parámetros editables
  └── cancellation_deadline_hours

UnavailablePeriod                              NUEVA. SUSTITUYE a Closure, que desaparece.
                                               Intervalo de instantes, motivo interno.

Appointment                                    + origin (ONLINE | OWNER)
  │                                            + cancelled_by (CUSTOMER | OWNER), sólo si cancelada
  │                                            + customer_email ahora puede faltar
  │                                            + token_hash ahora puede faltar (si origin = OWNER)
  └──< AppointmentService                      DE LA 005, sin cambios: uno o varios por cita,
                                               cada uno con su snapshot. La 002 lo lee y lo escribe.

AgendaDay, TimelineEntry, ConflictReport,      NO SE PERSISTEN. Conceptos derivados.
ResolutionPlan, BookingListQuery,
BookingListPage
```

**Regla de alcance**: esta feature escribe en **todas** las tablas menos en ninguna. Es exactamente lo contrario de la 001, donde `appointment` era la única tabla escribible y el resto era configuración de sólo lectura. El cambio no es incidental: es el contenido de la feature.

---

## Entidades nuevas de acceso

### OwnerAccount

La única identidad de personal del sistema (FR-001). Una sola fila, siempre.

**Tabla `owner_account`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | Clave primaria. No aparece en ninguna URL ni pantalla. |
| `username` | `text` | Único. Identificador de acceso, no dato personal de cliente. |
| `password_hash` | `text` | `scrypt$N$r$p$salt$hash`, todo en base64url. Los parámetros viajan con el hash (D-016). |
| `password_changed_at` | `timestamptz` | Lo que FR-004 hace avanzar. |
| `failed_attempts` | `integer` | `DEFAULT 0`. Se pone a cero en cada acceso correcto. |
| `first_failed_attempt_at` | `timestamptz` | Inicio de la ventana de 15 minutos. Nulo si `failed_attempts = 0`. |
| `locked_until` | `timestamptz` | Nulo mientras no haya bloqueo (FR-009). |
| `created_at` | `timestamptz` | |

**Invariantes**:

- Existe **como mucho una fila**, impuesta con un índice único sobre una expresión constante. Cero filas es un despliegue sin aprovisionar: la aplicación arranca, el formulario de acceso funciona y **ningún usuario existe**, de modo que todo intento falla con la respuesta neutra de FR-008. No hay forma de crear la cuenta desde la interfaz (FR-003).
- `password_hash` nunca contiene la contraseña ni nada derivable a ella en tiempo razonable (FR-010).
- `failed_attempts = 0` ⟺ `first_failed_attempt_at IS NULL`.
- **No hay ninguna columna de dirección IP ni de dispositivo**, y es deliberado: FR-009 prohíbe almacenarla o distinguir por ella.

**Lo que esta tabla no tiene**: email de recuperación, pregunta de seguridad, token de restablecimiento. FR-005 deja la recuperación fuera de v1, y un campo preparado "por si acaso" sería un dato personal más que proteger sin ningún flujo que lo use.

### OwnerSession

El acceso vigente. Una fila por sesión viva; la dueña puede tener la tablet del salón y el móvil a la vez.

**Tabla `owner_session`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | |
| `account_id` | `uuid` | → `owner_account(id)`, `ON DELETE CASCADE`. Borrar la cuenta cierra todas las sesiones. |
| `token_hash` | `bytea` | SHA-256 de los 32 bytes de la cookie. **El token en claro no se guarda** (D-015). |
| `created_at` | `timestamptz` | |
| `last_seen_at` | `timestamptz` | Caducidad deslizante. Se actualiza como mucho cada 5 minutos (D-015). |

**Invariantes**:

- `token_hash` es único. Un hash pertenece como mucho a una sesión.
- Una sesión está **viva** si `last_seen_at > now() - 12 horas`. La caducidad es una comparación en la consulta, no un estado guardado: no hace falta ningún proceso que marque sesiones como caducadas, igual que `COMPLETED` no se persiste en la 001 (FR-031 de aquella).
- Cerrar sesión (FR-006) **borra la fila**. No la marca. Una fila borrada no puede reactivarse volviendo atrás en el navegador.

**Limpieza**: el barrido de retención diario (`retention:purge`) borra de paso las sesiones con `last_seen_at` anterior a 12 horas. No es un requisito de corrección —la consulta ya las ignora— sino higiene: una tabla que sólo crece acaba siendo un problema aunque nadie la lea.

---

## UnavailablePeriod — sustituye a Closure

Un intervalo en el que el salón no está disponible, con **inicio y fin arbitrarios** (FR-018). Generaliza el cierre de día completo: un festivo es un periodo de un día, unas vacaciones uno de dos semanas, la comida uno de una hora.

**Tipo de dominio**

```ts
type UnavailablePeriod = {
  readonly id: UnavailablePeriodId;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  /** Interno. Nunca cruza la frontera hacia el cliente (FR-021). */
  readonly reason: string | null;
};
```

El motivo es `string | null` y no `string` con vacío: la ausencia de motivo es un estado legítimo —la dueña bloquea una hora y no explica nada— y el tipo lo dice en vez de esconderlo tras una cadena vacía.

**Tabla `unavailable_period`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | |
| `starts_at` | `timestamptz` | Instante, no fecha. Un día completo son dos instantes calculados en la zona del salón (D-019). |
| `ends_at` | `timestamptz` | |
| `reason` | `text` | Anulable. **No sale nunca hacia el cliente** (FR-021, BR-002). |
| `created_at` | `timestamptz` | |

**Restricciones**:

```sql
CHECK (ends_at > starts_at)   -- FR-023
```

Y **ninguna más**. En particular, **no** hay restricción de no-solape entre periodos: dos periodos que se pisan son inofensivos y obligar a fusionarlos a mano no aporta nada (D-019).

**Índice**:

```sql
CREATE INDEX unavailable_period_range_idx
    ON unavailable_period USING gist (tstzrange(starts_at, ends_at, '[)'));
```

GiST sobre el rango, no B-tree sobre `starts_at`: la consulta que importa es "qué periodos tocan esta ventana", y un periodo de tres semanas que empezó hace quince días hay que encontrarlo mirando el rango, no el inicio (D-027).

**Media abierta `[)`**: la misma convención que BR-013 y que la restricción `EXCLUDE` de la 001. Un periodo que termina a las 14:00 no impide una cita que empieza a las 14:00.

**Migración desde `closure`**: cada fila de `closure` se convierte en un periodo de las 00:00 del día a las 00:00 del siguiente, calculado **en la zona horaria del salón** leída de la fila `salon`, de modo que el día del cambio de hora dura sus 23 o 25 horas reales. Después, la tabla `closure` se elimina. El `reason` se conserva tal cual: era interno antes y sigue siéndolo.

---

## Cambios sobre las entidades existentes

### Salon — dos columnas nuevas

| Campo nuevo | Tipo | Notas |
|---|---|---|
| `minimum_lead_time_minutes` | `integer` | `NOT NULL DEFAULT 120`. Era `DEFAULT_BOOKING_POLICY.minimumLeadTimeMinutes`. |
| `cancellation_deadline_hours` | `integer` | `NOT NULL DEFAULT 24`. Era `DEFAULT_BOOKING_POLICY.cancellationDeadlineHours`. |

**Restricciones** (FR-054, asunción de rangos de la especificación):

```sql
CHECK (minimum_lead_time_minutes BETWEEN 0 AND 2880)   --  0 h a 48 h
CHECK (minimum_lead_time_minutes % 60 = 0)             --  horas completas
CHECK (cancellation_deadline_hours BETWEEN 0 AND 72)
```

El rango se impone **en la base**, no sólo en el formulario. El dominio lo valida además para poder decir *por qué* se rechaza (FR-054 pide que los límites se expliquen en pantalla); la base lo impone para que sea cierto pase lo que pase.

Los valores por defecto son exactamente los que la 001 fijó en `DEFAULT_BOOKING_POLICY`, de modo que la migración no cambia el comportamiento de ninguna instancia existente: sólo lo hace editable.

**Lo que sigue siendo constante de código**: horizonte de 60 días, rango de 14, rejilla de 30 minutos, máximo de 3 citas futuras por contacto y retención de 12 meses. No son configuración (clarificación del 2026-09-15) y `DEFAULT_BOOKING_POLICY` sigue siendo su sitio.

### OpeningInterval — mismas columnas, nuevas invariantes que ahora se imponen

El esquema no cambia. Lo que cambia es que las invariantes que la 001 documentaba como propiedades del seed pasan a ser **reglas que hay que hacer cumplir en cada guardado** (FR-045):

- `starts_at < ends_at`: ahora también `CHECK` en la tabla. Ningún tramo cruza la medianoche, lo que se sigue de que ambos sean `time` del mismo día.
- Dos tramos del mismo día de la semana **no se solapan**. Se impone con una restricción de exclusión por día de la semana:

  ```sql
  ALTER TABLE opening_interval ADD CONSTRAINT opening_interval_no_overlap
    EXCLUDE USING gist (
      weekday WITH =,
      timerange(starts_at, ends_at, '[)') WITH &&
    );
  ```

  `timerange` no es un tipo nativo de PostgreSQL: se declara como rango sobre `time` en la propia migración. La alternativa —validar sólo en el dominio— dejaría la invariante a merced de cualquier escritura futura, y es justo el tipo de garantía que la 001 decidió poner en la base (D-002).

- Un día de la semana **sin ninguna fila** sigue siendo un día cerrado (FR-046). Guardar un día sin tramos es borrar sus filas, no guardar un tramo degenerado.

**Escritura como reemplazo del día**: editar el horario de un día de la semana borra sus filas e inserta las nuevas **en una transacción**. Un guardado parcial dejaría un día con el tramo de la mañana del horario nuevo y el de la tarde del viejo.

### Service — mismas columnas, nuevas reglas de escritura

El esquema no cambia; `is_active` y `display_order` ya existían esperando esto. Lo nuevo son las reglas:

- Las dos restricciones de valor **ya están en la base** y esta feature no añade ninguna: `service_positive_duration` (`duration_minutes > 0`) desde la 0001, y `service_price_positive` (`price_cents IS NULL OR price_cents > 0`) desde la `0003_multiple_services.sql` de la 005. El dominio valida lo mismo para poder explicar el rechazo (FR-053, D-031). `NULL` es «sin precio»; 0 no es un precio válido.
- **El catálogo nunca queda sin servicios activos** (FR-051, BR-010). Se impone en el caso de uso, dentro de la transacción que retira el servicio, contando los activos restantes. No se impone en la base: una restricción de "al menos una fila cumple un predicado" no tiene forma declarativa en PostgreSQL sin un disparador, y un disparador que aborta con un mensaje que hay que traducir es peor que un caso de uso que devuelve `LAST_ACTIVE_SERVICE` tipado.
- **Retirar no altera citas** (FR-050, FR-052, BR-003). No hace falta hacer nada para conseguirlo: cada fila de `appointment_service` (D-001 de la 005) ya congeló nombre, duración y precio en el momento de reservar. Esta feature se limita a **no romperlo**, y el test de regresión correspondiente lo vigila, también con citas de varios servicios.
- La clave foránea `appointment_service.service_id → service.id`, con `ON DELETE RESTRICT`, impide borrar de verdad un servicio con citas. Retirar es `is_active = false`, nunca `DELETE`, y esto es lo que lo garantiza.

### Appointment — origen, quién canceló, email opcional, enlace opcional

| Campo | Cambio | Notas |
|---|---|---|
| `origin` | **nuevo** | `appointment_origin` (`ONLINE` \| `OWNER`), `NOT NULL`. Las filas existentes migran a `ONLINE`. |
| `cancelled_by` | **nuevo** | `appointment_actor` (`CUSTOMER` \| `OWNER`), anulable. Presente si y sólo si la cita está cancelada. Las canceladas existentes migran a `CUSTOMER` (D-032). |
| `customer_email` | ahora anulable en cita viva | Una cita manual puede no tenerlo (FR-024). |
| `customer_email_normalized` | ídem | Nulo cuando no hay email. No consume cupo de email en BR-014. |
| `token_hash` | ahora anulable en cita viva | Sólo las de origen `ONLINE` lo tienen (FR-026). |

**El origen es permanente** (FR-025). No hay ninguna operación que lo cambie: reprogramar una cita manual la deja manual, y el test de la Historia 4 lo comprueba explícitamente porque es el tipo de propiedad que una reescritura descuidada del `UPDATE` destruye sin que nada se queje.

**Restricción `appointment_anonymization_is_atomic`, reescrita** (D-026):

```sql
ALTER TABLE appointment DROP CONSTRAINT appointment_anonymization_is_atomic;

ALTER TABLE appointment ADD CONSTRAINT appointment_anonymization_is_atomic
  CHECK (
    (anonymized_at IS NULL
      AND customer_name IS NOT NULL
      AND customer_phone IS NOT NULL
      -- El email puede faltar en una cita creada a mano (FR-024).
      AND (customer_email IS NOT NULL) = (customer_email_normalized IS NOT NULL)
      -- El enlace de gestión existe si y sólo si la reserva fue online (FR-026).
      AND (token_hash IS NOT NULL) = (origin = 'ONLINE'))
    OR
    (anonymized_at IS NOT NULL
      AND customer_name IS NULL AND customer_phone IS NULL
      AND customer_email IS NULL AND customer_phone_normalized IS NULL
      AND customer_email_normalized IS NULL AND token_hash IS NULL)
  );
```

La garantía que la 001 buscaba se conserva entera: **no existe una cita medio anonimizada**, ni una con enlace vivo y sin teléfono, ni una sin enlace que conservó el email. Lo que se añade es que el enlace y el email dejan de ser obligatorios donde la especificación dice que no lo son, y el bicondicional `(token_hash IS NOT NULL) = (origin = 'ONLINE')` es más fuerte que el `IS NOT NULL` anterior: ahora también prohíbe que una cita manual tenga enlace.

**El índice único de token no cambia**: ya era parcial sobre `token_hash IS NOT NULL`, de modo que las citas manuales simplemente no participan.

**Restricción nueva `appointment_cancelled_by_consistency`** (FR-040a, BR-019, D-032), hermana de la `appointment_cancelled_consistency` de la 0002:

```sql
CREATE TYPE appointment_actor AS ENUM ('CUSTOMER', 'OWNER');

ALTER TABLE appointment ADD COLUMN cancelled_by appointment_actor;
UPDATE appointment SET cancelled_by = 'CUSTOMER' WHERE status = 'CANCELLED';

ALTER TABLE appointment ADD CONSTRAINT appointment_cancelled_by_consistency
  CHECK ((status = 'CANCELLED') = (cancelled_by IS NOT NULL));
```

Entre las dos restricciones, estado, momento y autor de la cancelación no pueden discrepar: una cita confirmada no tiene ninguno de los dos datos y una cancelada tiene los dos. `cancelled_by` **no es un dato personal** y la anonimización no lo toca.

**Tipo de dominio**: `Appointment` gana `origin: 'ONLINE' | 'OWNER'` y `cancelledBy: 'CUSTOMER' | 'OWNER' | null`. `services: NonEmptyServiceList` sigue siendo el de la 005.

**Índices para el listado de reservas** (D-033):

```sql
CREATE INDEX appointment_starts_at_id_idx   ON appointment (starts_at, id);
CREATE INDEX appointment_created_at_id_idx  ON appointment (created_at DESC, id DESC);
```

El orden por defecto con el filtro *Confirmadas* ya lo sirve `appointment_confirmed_starts_at_idx`, que es parcial; estos dos cubren *Canceladas* y *Todas* y el orden por fecha de reserva sin recorrer la tabla.

**Retención**: las citas manuales siguen exactamente la misma política de 12 meses. La anonimización ya pone a nulo lo que haya; una cita sin email anonimiza igual de bien.

---

## Entidades derivadas — nunca se persisten

### AgendaDay y TimelineEntry

Lo que la Historia 2 pinta. Se calcula en el dominio a partir de la configuración, las citas del día y los periodos que lo tocan.

```ts
type TimelineEntry =
  | { kind: 'APPOINTMENT'; appointment: Appointment; isPast: boolean }
  | { kind: 'UNAVAILABLE'; period: UnavailablePeriod }
  | { kind: 'FREE'; startsAt: Temporal.Instant; endsAt: Temporal.Instant };

type AgendaDay = {
  readonly date: Temporal.PlainDate;
  readonly isClosed: boolean;          // sin tramos, o enteramente cubierto (D-020)
  readonly entries: readonly TimelineEntry[];  // ordenadas, sin solapes entre FREE y el resto
  readonly isReadOnly: boolean;        // el día entero ya pasó (BR-009)
};
```

`isPast` se deriva del reloj comparando con la **hora de fin** de la cita, nunca con su inicio (FR-016, BR-009, clarificación del 2026-09-16): una cita en curso no es pasado y sigue siendo movible y cancelable. Es un campo derivado por la misma razón que `COMPLETED` lo era en la 001: persistirlo obligaría a un proceso que lo fuera marcando, y ese proceso siempre va tarde.

`isClosed = true` con `entries` vacío es "cerrado". `isClosed = false` con `entries` vacío es "sin citas". La distinción que pide FR-017 está en el tipo, no en la plantilla.

### ConflictReport y ResolutionPlan

Lo que la Historia 6 necesita. Son datos puros que el dominio produce y la infraestructura aplica (D-023).

```ts
type Conflict =
  | { kind: 'APPOINTMENT'; id: AppointmentId; customerName: string;
      /** Todos, en el orden del catálogo (FR-033, D-030). */
      serviceNames: readonly [string, ...string[]];
      startsAt: Temporal.Instant; endsAt: Temporal.Instant }
  | { kind: 'UNAVAILABLE_PERIOD'; id: UnavailablePeriodId; reason: string | null;
      startsAt: Temporal.Instant; endsAt: Temporal.Instant };

type ConflictReport = {
  readonly conflicts: readonly Conflict[];
  /** Hash del estado de lo que estorba. FR-038 lo compara al confirmar (D-024). */
  readonly stateToken: string;
};

type ResolutionPlan = {
  readonly intent: CreateAppointment | RescheduleAppointment | CreatePeriod;
  readonly cancelAppointments: readonly AppointmentId[];
  readonly shortenPeriods: readonly { id: UnavailablePeriodId;
                                      startsAt: Temporal.Instant;
                                      endsAt: Temporal.Instant }[];
  readonly deletePeriods: readonly UnavailablePeriodId[];
  readonly warnings: readonly ManualBookingWarning[];
};
```

Cada `Conflict` lleva **lo que hay que enseñar para nombrarlo** (FR-033): el nombre del cliente y sus servicios para una cita, la franja y el motivo para un periodo. El nombre del cliente sale de la base y llega a la pantalla, pero no al log (FR-057).

**`stateToken`**: SHA-256 de la lista ordenada de `(tipo, id, marca de modificación)` de los elementos en conflicto. No es un secreto ni autoriza nada; es una huella para detectar que lo que la dueña vio ya no es lo que hay. Puede viajar en claro.

`warnings` viaja en el **plan**, no en el error, porque un aviso no impide nada: exige acuse (D-025).

### BookingListQuery y BookingListPage

Lo que la Historia 10 pinta (D-033). La consulta llega de la URL, el dominio la normaliza y el repositorio la traduce a SQL.

```ts
type BookingListOrder = 'UPCOMING' | 'RECENT';      // Próximas citas | Últimas reservas recibidas
type BookingListStatus = 'CONFIRMED' | 'CANCELLED' | 'ALL';
type BookingListOrigin = 'ONLINE' | 'OWNER' | 'ALL';

type BookingListQuery = {
  readonly order: BookingListOrder;                 // por defecto UPCOMING (FR-061)
  readonly status: BookingListStatus;               // por defecto CONFIRMED (FR-062)
  readonly origin: BookingListOrigin;               // por defecto ALL
  /** Días del salón, inclusivos, sobre el día de la cita. */
  readonly from: Temporal.PlainDate | null;
  readonly to: Temporal.PlainDate | null;
  /** Sólo con UPCOMING: el inicio de hoy en la zona del salón, del reloj inyectado. */
  readonly notBefore: Temporal.Instant | null;
  readonly after: BookingListCursor | null;
  readonly pageSize: typeof BOOKING_LIST_PAGE_SIZE; // 20
};

type BookingListCursor =
  | { readonly order: 'UPCOMING'; readonly startsAt: Temporal.Instant; readonly id: AppointmentId }
  | { readonly order: 'RECENT'; readonly createdAt: Temporal.Instant; readonly id: AppointmentId };

type BookingListPage = {
  readonly rows: readonly Appointment[];            // con services, origin y cancelledBy
  readonly next: BookingListCursor | null;          // null: no hay más páginas
};
```

**Invariantes**: un cursor de un orden no vale para el otro, y el dominio lo rechaza; `from <= to` cuando están los dos. Una fila anonimizada llega con `customer: null` y la pantalla dice que los datos se borraron por antigüedad (FR-067).

---

## Transiciones de estado

### Sesión

```text
(no existe) ──iniciar sesión correcto──> VIVA
   VIVA ──petición dentro de 12 h──> VIVA (last_seen_at avanza, como mucho cada 5 min)
   VIVA ──12 h sin actividad──> CADUCADA (derivada, no persistida)
   VIVA ──cerrar sesión──> (fila borrada)
```

Ninguna transición reactiva una sesión caducada ni borrada. La acción que llega con una sesión caducada **no se aplica** (FR-007): el guardián aborta antes de que el caso de uso empiece, no a medias.

### Bloqueo de la cuenta

```text
ABIERTA ──fallo──> ABIERTA (failed_attempts++)
ABIERTA ──5.º fallo en 15 min──> BLOQUEADA (locked_until = now + 15 min)
BLOQUEADA ──intento, correcto o no──> BLOQUEADA, respuesta idéntica a un fallo (FR-009)
BLOQUEADA ──pasa locked_until──> ABIERTA, contador a cero
ABIERTA ──acceso correcto──> ABIERTA, contador a cero
```

Un acceso **correcto** durante el bloqueo no lo levanta. Si lo levantara, quien acertara la contraseña al sexto intento eludiría el límite, que es precisamente contra quien está puesto.

### Servicio

```text
ACTIVO ──retirar──> RETIRADO        (prohibido si es el último activo: FR-051)
RETIRADO ──activar──> ACTIVO        (sin pérdida de nada: FR-050)
```

Ninguna de las dos transiciones toca ninguna cita (BR-003).

### Cita

**Sin cambios** respecto a la 001: `CONFIRMED → CANCELLED`, terminal (FR-042, BR-008). Lo que esta feature añade es un segundo sujeto capaz de provocar la transición —la dueña, exenta del plazo (BR-007)—, que queda **registrado** en `cancelled_by` (FR-040a), y un segundo origen de la creación. La máquina de estados es la misma.

```text
CONFIRMED ──cliente cancela desde su enlace──> CANCELLED (cancelled_by = CUSTOMER)
CONFIRMED ──dueña cancela desde la gestión──> CANCELLED (cancelled_by = OWNER)
CONFIRMED ──dueña mueve──> CONFIRMED (mismos servicios, misma duración total: FR-039)
```

---

## Reglas de validación y dónde vive cada una

| Regla | Dominio | Base de datos | Frontera HTTP |
|---|---|---|---|
| Dos citas confirmadas no se solapan (BR-001) | detecta y explica | **garantiza** (`EXCLUDE`) | — |
| Fin posterior al inicio de un periodo (FR-023) | valida con mensaje | `CHECK` | forma del cuerpo |
| Tramos del mismo día sin solape (FR-045) | valida con mensaje | `EXCLUDE` | forma del cuerpo |
| Duración positiva y precio vacío o positivo (FR-053) | valida con mensaje | `CHECK` (0001 y 0003 de la 005) | forma del cuerpo |
| Al menos un servicio por cita, sin repetidos (FR-024) | **decide** (`selectServices`) | índice único de la 005 | `minItems`, `uniqueItems` |
| Quién canceló, presente sólo si cancelada (FR-040a) | **decide** | `CHECK` | — |
| Valores por defecto y cursor del listado (FR-061, FR-062) | **decide** | — | forma de la consulta |
| Rangos de los parámetros (FR-054) | valida y explica límites | `CHECK` | forma del cuerpo |
| Al menos un servicio activo (FR-051) | **decide** | — | — |
| Límite de 3 citas futuras por contacto (FR-029) | **decide** | — | — |
| Nada en el pasado (FR-030, BR-009) | **decide** | — | — |
| Formato de nombre, teléfono, email (FR-031) | **decide** | — | Zod comprueba tipo y presencia |
| Exenciones de la dueña (BR-007) | **decide** | — | — |
| Coherencia de anonimización (BR-018 de la 001) | — | `CHECK` | — |
| Sesión válida (FR-002) | — | — | **guardián en cada handler** (D-018) |

La columna "Dominio" es la autoritativa en todos los casos en que aparece. Que una regla esté además en la base no la duplica: la base **impone** lo que el dominio **decide y explica**. Lo que el Principio I prohíbe es que dos capas decidan con lógicas distintas, no que una invariante tenga cinturón y tirantes.

---

## Migraciones

Cuatro migraciones, una idea cada una, en este orden. Empiezan en la 0004 porque la `0003_multiple_services.sql` es de la 005 y ya está en `main`:

| Archivo | Contenido |
|---|---|
| `0004_owner_account_and_session.sql` | `owner_account`, `owner_session`, sus índices y la unicidad de la fila de cuenta. |
| `0005_unavailable_period.sql` | Crea `unavailable_period` y su índice GiST, **convierte los cierres existentes** y elimina `closure`. |
| `0006_appointment_origin_and_cancellation.sql` | Enums `appointment_origin` y `appointment_actor`; columnas `origin` (`ONLINE` para lo existente) y `cancelled_by` (`CUSTOMER` para las ya canceladas) con su `CHECK`; reescritura de `appointment_anonymization_is_atomic`; los dos índices del listado. |
| `0007_editable_configuration.sql` | Columnas de política en `salon`, `CHECK` de rangos, `CHECK` y `EXCLUDE` de `opening_interval`. `service` no necesita nada: sus `CHECK` ya existen. |

Escritas a mano, como exige D-008. La 0005 es la única que convierte cierres y la única que borra una tabla; su prueba de integración carga cierres, migra y comprueba que los periodos resultantes cubren exactamente los mismos días, **incluido uno en la semana del cambio de hora**. La 0006 también convierte datos —marca las cancelaciones existentes como del cliente— y su prueba lo comprueba.

El orden importa: la 0007 impone el `EXCLUDE` de `opening_interval` sobre datos que el seed ya cargó. Si el seed de alguna instancia tuviera tramos solapados, la migración falla ahí y no a medio camino — que es el comportamiento correcto.
