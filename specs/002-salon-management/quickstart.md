# Quickstart — Gestión del salón (cara a la dueña) v1

**Feature**: `002-salon-management` | **Date**: 2026-09-16

Guía para arrancar esta feature en local y **comprobar que hace lo que promete**. Da por hecho que la 001 ya está arrancada según [`../001-client-appointment-booking/quickstart.md`](../001-client-appointment-booking/quickstart.md); aquí sólo aparece lo que cambia o se añade.

---

## Prerrequisitos

Los mismos de la 001, más uno:

- **`next` en versión 15.2.3 o superior.** El rango `^15.1.3` del `package.json` lo permite, pero hay que verificar lo que resolvió el *lockfile* y elevar el mínimo declarado. El motivo está en D-018: el middleware de Next tuvo una evasión de autorización explotable con una cabecera, y aunque esta feature **no autoriza en el middleware** precisamente por eso, no hay ninguna razón para quedarse en una versión afectada.

  ```bash
  npm ls next
  npm audit
  ```

---

## Arranque

```bash
# 1..5 como en la 001: dependencias, .env, docker compose, migraciones, seed
npm install
docker compose up -d db db-test

# 6. Las migraciones nuevas: cuenta, sesión, periodos no disponibles,
#    origen de la cita y configuración editable
npm run db:migrate

# 7. NUEVO: aprovisionar la credencial de la dueña, FUERA de la aplicación (FR-003)
npm run owner:provision

# 8. Aplicación
npm run dev
```

### El aprovisionamiento de la credencial

`npm run owner:provision` lee `OWNER_USERNAME` y `OWNER_INITIAL_PASSWORD` del entorno, deriva el hash con `scrypt` y escribe la única fila de `owner_account`. Es un comando de operación, hermano del `db:seed`, y **no existe ninguna forma de hacer esto desde la interfaz** (FR-003).

```bash
OWNER_USERNAME=rocio OWNER_INITIAL_PASSWORD='...' npm run owner:provision
```

Tres comportamientos que conviene conocer antes de usarlo en producción:

- **Es idempotente por usuario**: ejecutarlo de nuevo con el mismo `OWNER_USERNAME` **reescribe la contraseña**. Eso es lo que hace de él el medio de reaprovisionamiento que la especificación describe para cuando la dueña olvida la suya (FR-005), y por eso el comando avisa explícitamente cuando está sobrescribiendo en vez de crear.
- **Cierra todas las sesiones vivas** al reescribir la contraseña. Un reaprovisionamiento es una recuperación de la cuenta, y dejar sesiones abiertas de antes sería un agujero.
- **Rechaza contraseñas de menos de 12 caracteres** (D-016) y **no la escribe en ningún log**, ni el comando ni la aplicación (FR-010).

Sin ejecutar este comando, la aplicación arranca y el formulario de acceso funciona: simplemente **ningún usuario existe** y todo intento recibe la respuesta neutra de FR-008. No es un fallo de arranque, es el estado correcto de una instancia sin aprovisionar.

### Variables de entorno nuevas

| Variable | Obligatoria | Para qué |
|---|---|---|
| `OWNER_USERNAME` | Sólo para `owner:provision` | Usuario de la única cuenta. No lo lee la aplicación en marcha. |
| `OWNER_INITIAL_PASSWORD` | Sólo para `owner:provision` | Nunca se persiste en claro ni se registra. **No debe quedarse en el `.env`** del servidor después de usarla. |

La aplicación en marcha **no necesita ninguna variable nueva**. La sesión no lleva secreto de firma —es un token opaco con su hash en la base (D-015)— y el bloqueo por intentos no usa `RATE_LIMIT_SECRET`, porque no hashea ninguna IP: no la mira siquiera (D-017).

### Qué cambia el seed

`db:seed` deja de cargar `closure` —esa tabla ya no existe— y carga los mismos festivos como filas de `unavailable_period` de día completo. Añade además un periodo intradía de ejemplo, la comida de un martes, para que la agenda de la dueña tenga algo que enseñar en el primer arranque.

---

## Comprobación rápida (10 minutos)

Con `npm run dev` levantado y la credencial aprovisionada:

| # | Qué hacer | Qué debe pasar | Requisito |
|---|---|---|---|
| 1 | Abrir `/gestion/agenda` sin haber entrado | Aterriza en `/gestion/acceso`. **Ningún dato** de agenda asomó antes | FR-002, SC-001 |
| 2 | Entrar con la contraseña mal | Mensaje genérico. Probar con un usuario que no existe: **el mismo mensaje exacto** | FR-008 |
| 3 | Fallar cinco veces y luego acertar | Sigue rechazando, **con el mismo mensaje**, durante 15 minutos | FR-009 |
| 4 | Entrar bien | La agenda de hoy, con las citas del seed y la comida del martes marcada | FR-011 |
| 5 | Navegar a ayer | Se consulta, pero no se puede crear, mover ni cancelar nada | FR-016, BR-009 |
| 6 | Bloquear de 13:00 a 14:00 de un día futuro | En `/` (cara al cliente), **sin reiniciar nada**, desaparecen los inicios que pisan ese rato | FR-056, SC-003 |
| 7 | Eliminar ese bloqueo y recargar `/` | Los huecos vuelven de inmediato | FR-019, SC-003 |
| 8 | Apuntar una cita a mano en un hueco libre | Se crea sin ningún aviso; el hueco deja de ofrecerse en `/` | FR-024, US4-1 |
| 9 | Apuntar otra media hora después de la hora de cierre | **Avisa** de que está fuera de horario; se confirma y se crea | FR-028, US4-4 |
| 10 | Apuntar una tercera encima de una cita existente | Nombra la cita que estorba, con cliente, servicio y franja | FR-033, SC-005 |
| 11 | Rechazar ese aviso y mirar la agenda | **Nada ha cambiado**: ni la cita existente ni el intento | FR-036, SC-006 |
| 12 | Repetirlo y esta vez cancelar la que estorba | Ambas cosas ocurren juntas | FR-037 |
| 13 | Cancelar una cita **reservada online** | La pantalla recuerda que el cliente no recibe nada y muestra su teléfono | FR-043 |
| 14 | Cambiar el cierre del viernes de 20:00 a 18:00 con una cita a las 19:00 | Lista esa cita **antes** de guardar, y al guardar **sigue intacta** | FR-047, BR-004 |
| 15 | Añadir un servicio "Mechas" de 90 min | Seleccionable en `/` de inmediato, con huecos de 90 minutos | FR-048, SC-007 |
| 16 | Retirar todos los servicios menos uno, y luego ese | Lo impide, explicando que el salón se quedaría sin nada que reservar | FR-051, BR-010 |
| 17 | Subir la antelación mínima a 4 h | En `/`, desaparecen los inicios a menos de 4 horas vista | FR-055, SC-009 |
| 18 | Cerrar sesión y pulsar Atrás | No se ve ningún dato de gestión | FR-006 |

Los pasos 6, 7, 15 y 17 son los que demuestran lo que esta feature viene a resolver: **la configuración se edita en vivo y el cliente lo nota en la siguiente consulta, sin despliegue ni reinicio**.

---

## Validación automatizada

```bash
npm test                 # dominio puro: agenda, exenciones, conflictos, bloqueo, horario
npm run test:integration # casos de uso contra PostgreSQL real, incluida la concurrencia
npm run test:contract    # Route Handlers contra contracts/owner-api.yaml
npm run test:e2e         # Playwright + axe sobre las pantallas de gestión
npm run lint             # ESLint + tsc --noEmit
npm run check:layers     # la frontera del dominio: bloquea el merge si se cruza
npm run test:all         # todo, en ese orden
```

### Los checks que más importan en esta feature

**El barrido de acceso.** Enumera todas las rutas de `/gestion` y `/api/gestion` desde el enrutador —no desde una lista escrita a mano, que se queda obsoleta en cuanto se añade una pantalla— y exige que **ninguna**, sin cookie, devuelva contenido de gestión. Es SC-001 hecho test, y es el único que cubre la pantalla que alguien añada dentro de seis meses.

```bash
npm run test:integration -- access-sweep
```

**La concurrencia real.** Dos confirmaciones solapadas, dos conexiones, PostgreSQL de verdad. Exactamente una prospera; la otra recibe el conflicto recalculado sobre el estado ya actualizado, nunca un solape guardado (FR-038, SC-004).

```bash
npm run test:integration -- concurrent-conflict
```

**La indistinguibilidad del acceso.** Compara código, cuerpo y cabeceras de los tres casos —usuario inexistente, contraseña incorrecta, cuenta bloqueada— y falla si difieren en un byte (FR-008, FR-009).

### Cobertura mínima antes de dar la feature por terminada

- Una historia de usuario, un archivo e2e: nueve archivos, de `us1-access` a `us9-parameters`.
- `@axe-core/playwright` sobre las seis pantallas de gestión, **incluido el diálogo de conflicto**, que es el elemento con más riesgo de trampa de foco de toda la feature.
- Un test de regresión por cada garantía heredada que esta feature podría romper sin querer: que retirar un servicio no toca las citas (SC-008), que cambiar su duración no toca las ya confirmadas (FR-052), que reprogramar una cita online conserva su enlace vivo (FR-041) y que el origen sobrevive a la reprogramación (FR-025).
- Cero tests saltados. La constitución no admite excepciones tácitas.

---

## Verificar las garantías críticas a mano

### La no-superposición sigue siendo de la base de datos

La restricción `EXCLUDE` de la 001 no se toca, y ahora tiene que cubrir también lo que crea la dueña. Se comprueba igual que entonces, saltándose la aplicación entera:

```bash
docker compose exec db psql -U postgres -d salon -c "
  INSERT INTO appointment (id, status, starts_at, ends_at, service_id, service_name,
    service_duration_minutes, service_price_cents, origin, customer_name, customer_phone,
    customer_phone_normalized)
  SELECT gen_random_uuid(), 'CONFIRMED', starts_at, ends_at, service_id, service_name,
    service_duration_minutes, service_price_cents, 'OWNER', 'Prueba', '600000000', '+34600000000'
  FROM appointment WHERE status = 'CONFIRMED' LIMIT 1;"
```

Debe fallar con `23P01 appointment_no_overlap`. Que la fila diga `origin = 'OWNER'` no la exime de nada: FR-035 no admite excepción ni por decisión explícita de la dueña.

### La atomicidad de la resolución

```bash
npm run test:integration -- resolution-atomicity
```

El test provoca un fallo en mitad de la aplicación del plan y comprueba que **ni la cita en conflicto queda cancelada ni la nueva creada**. El peor resultado posible sería una cita perdida a cambio de nada, y es justo lo que FR-037 prohíbe.

### La agenda no se degrada con el histórico

```bash
npm run db:seed:history      # 10.000 citas pasadas
npm run test:integration -- agenda-performance
```

El test cuenta consultas y mide. Abrir un día debe costar **un número fijo de consultas**, el mismo con la base vacía que con diez mil citas dentro (SC-010, D-027). Si alguien introduce un bucle por franjas que toque la base, este test lo caza.

### La configuración se lee de verdad en cada evaluación

```bash
npm run test:integration -- config-propagation
```

Cambia un parámetro y comprueba que la **siguiente** consulta de disponibilidad ya lo usa, sin reiniciar el proceso. Es el test que protege D-021: si alguien vuelve a introducir un caché de proceso sin invalidación, esto se pone rojo.

### Los datos personales siguen sin llegar a los logs

Las pantallas de gestión muestran nombres y teléfonos —la dueña los necesita— y esa es exactamente la razón por la que hay que volver a comprobarlo (FR-057):

```bash
# entra en la gestión, abre la agenda de un día con citas, provoca un conflicto
docker compose logs app | grep -i -E 'ZZTESTZZ|600000000'   # debe no devolver nada
```

El diálogo de conflicto es el sitio de mayor riesgo: lleva el nombre del cliente en el cuerpo de la respuesta, y un `logger.error(conflict)` descuidado lo escribiría entero.

---

## Despliegue

Sobre lo que ya hace la 001, tres cosas:

1. **Aprovisionar la cuenta** una vez, con `npm run owner:provision`, y **retirar `OWNER_INITIAL_PASSWORD` del entorno del servidor** después. Es una credencial de un solo uso; dejarla en el `.env` es dejar la contraseña en claro en el disco.
2. **HTTPS deja de ser recomendable y pasa a ser obligatorio para que la aplicación funcione**. La cookie `__Host-owner_session` exige `Secure`, y el navegador la rechaza por HTTP. En local, `http://localhost` está exento por la regla de orígenes seguros. En cualquier otro sitio, sin TLS no hay sesión: el fallo es inmediato y visible, que es lo que se busca.
3. **El barrido de retención borra también las sesiones caducadas.** El cron diario de las 03:30 no cambia de horario ni de comando.

### Lo que sigue exigiendo un solo worker

La 001 ya lo exigía por el limitador por IP en memoria. Esta feature **no añade ninguna razón nueva**: la sesión y el bloqueo por intentos viven en PostgreSQL precisamente para no depender de la memoria del proceso (D-015, D-017). Si algún día hubiera que escalar a varios procesos, lo único que quedaría por mover es el limitador de la 001.

---

## Problemas frecuentes

**«Entro y me vuelve a pedir la contraseña».** La cookie no está llegando. En despliegue, casi siempre es TLS: `__Host-` exige `Secure` y `Secure` exige HTTPS. Comprobar también que el proxy no reescribe `Set-Cookie` ni sirve la aplicación bajo un subcamino, porque `__Host-` exige `Path=/`.

**«He cambiado el horario y el cliente sigue viendo los huecos viejos».** Si el cambio se guardó —se ve en `/gestion/horario`— y el cliente no lo nota, alguien ha reintroducido un caché de configuración. `config-propagation` debería estar en rojo; si está en verde y el síntoma persiste, el caché está en otro sitio, probablemente en la caché de datos de Next sobre la ruta pública: esas rutas se sirven con `no-store`.

**«La migración 0006 falla».** Está imponiendo el `EXCLUDE` de `opening_interval` sobre datos ya cargados, y esa instancia tiene tramos solapados en algún día de la semana. Falla ahí a propósito, antes de tocar nada. Hay que arreglar los datos y volver a migrar.

**«Me he quedado fuera 15 minutos».** Es el bloqueo por cuenta de FR-009, y **es por cuenta, no por origen**: cambiar de dispositivo o de red no lo evita. O se espera, o se reaprovisiona con `owner:provision`, que pone el contador a cero al reescribir la contraseña.
