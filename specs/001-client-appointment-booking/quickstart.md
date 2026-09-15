# Quickstart — Reserva de citas de peluquería v1

**Feature**: `001-client-appointment-booking` | **Date**: 2026-09-15

Guía para arrancar el entorno y **validar que la feature funciona de punta a punta**. No contiene código de implementación: eso pertenece a `tasks.md` y a la fase de implementación.

Referencias: [plan.md](./plan.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/http-api.yaml](./contracts/http-api.yaml) · [contracts/domain-api.md](./contracts/domain-api.md)

---

## Prerrequisitos

| Requisito | Versión | Por qué |
|---|---|---|
| Node.js | 22 LTS | Runtime de la aplicación |
| Docker + Docker Compose | reciente | PostgreSQL de desarrollo y de test |
| PostgreSQL | 16, vía Docker | Restricción `EXCLUDE` y extensión `btree_gist` (D-002) |

No hace falta instalar PostgreSQL en la máquina: el `docker compose` levanta dos bases, `db` para desarrollo y `db-test` para la suite.

---

## Arranque

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno (el .env.example no lleva ningún valor real)
cp .env.example .env

# 3. Bases de datos
docker compose up -d db db-test

# 4. Migraciones — crean btree_gist, la tabla y la restricción EXCLUDE
npm run db:migrate

# 5. Configuración precargada: salón, servicios, tramos y cierres
npm run db:seed

# 6. Aplicación
npm run dev          # http://localhost:3000
```

El paso 5 no es opcional. FR-007 define el horario, los servicios y los cierres como **datos de configuración precargados, no editables desde la app**; sin seed no hay catálogo y la pantalla de reservas no tiene nada que ofrecer.

### Qué carga el seed

Pensado para que los escenarios de aceptación de la especificación se puedan reproducir tal cual:

| Dato | Valor | Escenario que habilita |
|---|---|---|
| Salón | Zona horaria `Europe/Madrid` | FR-033, BR-015 |
| Horario L–V | 10:00–20:00 (un solo tramo) | Historia 1, escenarios 1, 2, 4, 5 |
| Horario sábado | 10:00–14:00 y 16:00–20:00 | Historia 1, escenario 3 (cierre de mediodía) |
| Domingo | Sin tramos → día cerrado | Caso límite de día cerrado |
| Servicio "Corte" | 30 min, 18,00 € | Escenarios 1 y 4 |
| Servicio "Color" | 90 min, 55,00 € | Escenarios 2 y 3 |
| Servicio "Peinado" | 45 min, 25,00 € | Día lleno para uno y con huecos para otro |
| Cierre | Un festivo dentro de los próximos 14 días | Rejilla con un día `CLOSED` visible |

---

## Comprobación rápida (5 minutos)

Recorrido manual que toca las seis historias de usuario.

1. **Abre `http://localhost:3000` en un móvil o con el navegador a 360 px de ancho.**
   Debes ver el catálogo con nombre, duración y precio de los tres servicios (FR-001), y ningún selector de salón (asunción 11).

2. **Elige "Corte".**
   Aparece la rejilla de 14 días empezando hoy. Cada día muestra su estado **con texto e icono, no sólo con color** (SC-010): el domingo y el festivo como cerrados, el resto según disponibilidad. Debajo, los huecos del día seleccionado (FR-005a).

3. **Comprueba la antelación mínima.** Si hoy está abierto, el primer hueco de hoy está **al menos 2 horas por delante** del reloj (BR-003). Los anteriores no aparecen.

4. **Cambia a "Color" sin cambiar de día.** El estado de los 14 días **se recalcula**: algún día con huecos para "Corte" puede pasar a lleno para "Color", porque 90 minutos no caben donde caben 30 (caso límite de cambio de servicio).

5. **Elige el sábado con "Color".** No debe ofrecerse ningún inicio entre las 14:00 y las 16:00, el último de la mañana es **las 12:30** y el primero de la tarde **las 16:00** (Historia 1, escenario 3). Las 13:00 no aparecen: el servicio terminaría a las 14:30, con el salón ya cerrado.

6. **Avanza por rangos hasta el día 60.** Al llegar, no se puede avanzar más y se indica que la agenda aún no está abierta (escenario 9). En el primer rango no se puede retroceder (escenario 10).

7. **Reserva.** Se piden **exactamente tres datos** y ninguno más (FR-008). Antes de confirmar se ve servicio, día, hora, duración y el plazo de cancelación de 24 h (FR-010).

8. **Prueba un teléfono inválido.** El envío se bloquea, se señala el campo concreto con instrucción de corrección, y **no se pierde el resto de lo escrito** (FR-009).

9. **Confirma.** La pantalla de confirmación muestra los datos de la cita, los del salón, y el enlace de gestión con el aviso destacado de guardarlo (FR-014, FR-015). **Cópialo.**

10. **Recarga esa pantalla.** No se crea una segunda cita (Historia 3, escenario 3). La URL es un `GET`; el `POST` no se repite (D-010).

11. **Vuelve a la pantalla de reservas.** El hueco que acabas de tomar **ya no se ofrece** para ningún servicio (FR-011, BR-001).

12. **Abre el enlace copiado.** Ves tu cita, su estado, y las acciones de cancelar y reprogramar (Historia 4). No ves ninguna otra cita ni la agenda del salón (BR-009).

13. **Reprograma a otro hueco.** Sólo se ofrecen huecos del **mismo servicio** (FR-024), y tu hora actual aparece marcada como tal (FR-027). Tras el cambio, **el enlace sigue siendo el mismo** (FR-026) y el hueco antiguo vuelve a estar libre.

14. **Cancela.** Se pide confirmación explícita (FR-022). Tras cancelar, el hueco reaparece de inmediato en la pantalla de reservas (FR-023, BR-005).

15. **Inventa un enlace**: cambia unos caracteres del token. Debes ver **el mismo mensaje neutro** que verías con un enlace de una cita borrada (FR-019), sin nada que sugiera que esa cita existió.

---

## Validación automatizada

```bash
npm test                 # unitarios: dominio puro, sin infraestructura
npm run test:integration # casos de uso contra PostgreSQL real
npm run test:contract    # Route Handlers contra contracts/http-api.yaml
npm run test:e2e         # Playwright, una historia por archivo, + axe
npm run test:all         # todo, en el orden de arriba

npm run lint             # ESLint + tsc --noEmit
npm run check:layers     # dependency-cruiser: la frontera del dominio
```

### El check que más importa

```bash
npm run check:layers
```

Falla si cualquier archivo de `src/domain` importa de `react`, `next`, `drizzle-orm`, `pg` o `src/infrastructure`. Es la verificación mecánica del Principio I. Corre en CI y bloquea el merge: un principio que no se verifica se erosiona en el tercer sprint.

### Cobertura mínima antes de dar la feature por terminada

Trazabilidad de los casos límite que la constitución exige (Principio II) y de los requisitos críticos:

| Caso | Nivel | Requisito |
|---|---|---|
| Doble reserva del mismo hueco | Integración, dos transacciones concurrentes reales | FR-012, BR-001 |
| Solapamiento parcial (servicio largo sobre cita existente) | Unitario | BR-001, BR-002 |
| Petición fuera de horario de apertura | Unitario | FR-003a |
| Servicio que cruzaría el cierre de mediodía | Unitario | FR-007a, BR-002 |
| Cancelación pasado el plazo de 24 h | Unitario | BR-004 |
| Recordatorio de cita cancelada | **No aplica** — v1 no envía nada (asunción 5) | — |
| Confirmación justo al expirar la antelación de 2 h | Unitario, con reloj inyectado | BR-003 |
| Reprogramación cuyo hueco nuevo se ocupa entre medias | Integración | FR-025, BR-006 |
| Cuarta cita futura del mismo teléfono o email | Integración | FR-013, BR-014 |
| Respuesta neutra en los cinco casos de FR-019 y FR-038 | Contrato, comparando cuerpo **y** cabeceras | FR-019, FR-038 |
| Anonimización a los 12 meses | Integración | FR-035, FR-035a, BR-018 |
| Ausencia de PII en logs y trazas | Unitario | FR-036 |
| Cambio de horario estacional dentro del horizonte | Unitario | Caso límite de DST |
| Accesibilidad AA de las cinco pantallas | E2E con axe | SC-010 |

**Reloj determinista**: todos los tests inyectan un `Clock` fijo. Ninguno depende de la hora a la que se ejecuta la suite.

---

## Verificar las garantías críticas a mano

### La no-superposición es de la base de datos, no de la aplicación

Merece comprobarse directamente, porque es la garantía que sostiene SC-002:

```bash
docker compose exec db psql -U postgres -d salon
```

```sql
-- Inserta dos citas confirmadas solapadas saltándose la aplicación entera.
-- La segunda DEBE fallar con: ERROR 23P01 exclusion_violation
INSERT INTO appointment (id, status, starts_at, ends_at, /* ... */)
VALUES (gen_random_uuid(), 'CONFIRMED', '2026-09-18 10:00+02', '2026-09-18 11:30+02', /* ... */);

INSERT INTO appointment (id, status, starts_at, ends_at, /* ... */)
VALUES (gen_random_uuid(), 'CONFIRMED', '2026-09-18 11:00+02', '2026-09-18 11:30+02', /* ... */);
```

Si la segunda entra, la restricción no está bien aplicada y **BR-001 no está garantizado**, por correcta que parezca la lógica de la aplicación.

Comprueba también que el intervalo semiabierto funciona: una cita de 11:30 a 12:00 **sí** debe entrar junto a una de 10:00 a 11:30. Son consecutivas, no solapadas (BR-013).

### La disponibilidad es una sola consulta

```bash
# Con el log de consultas activado, carga un rango de 14 días
docker compose logs -f db | grep -i "SELECT .* FROM appointment"
```

Debe aparecer **una sola** consulta de citas por carga de rango, no catorce (FR-005b, Principio VIII). Si aparecen varias, hay un N+1 y SC-005 está comprometido.

### El histórico no degrada la disponibilidad

```bash
npm run db:seed:history -- --appointments 10000   # citas pasadas
```

Repite el paso 2 de la comprobación rápida y compara el tiempo de respuesta con el de antes. Deben ser equivalentes (SC-005). Si crecen, revisa que el índice sea **parcial** sobre `status = 'CONFIRMED'`: sin esa cláusula el histórico entra en el índice.

### Los datos personales no llegan a los logs

```bash
npm run dev 2>&1 | tee /tmp/app.log
# reserva con un nombre distintivo, por ejemplo "ZZTESTZZ"
grep -i "ZZTESTZZ\|600112233\|@" /tmp/app.log
```

No debe haber ninguna coincidencia, tampoco en las trazas de error (FR-036, Principio III). Provoca además un error de reserva —envía un hueco ya ocupado— y vuelve a comprobarlo: las trazas de error son el sitio donde la PII se cuela con más facilidad.

---

## El borrado por retención

```bash
# Simulación: muestra qué se anonimizaría, sin escribir
npm run retention:purge -- --dry-run

# Ejecución real (el cron diario invoca esto a las 03:30 hora del salón)
npm run retention:purge

# Anonimizar una cita concreta, a petición del cliente
npm run retention:purge -- --appointment <uuid>
```

Tras la purga de una cita, verifica los dos lados de BR-018:

1. Abrir su enlace devuelve **el mismo mensaje neutro** que un enlace inventado (FR-020).
2. La fila **sigue existiendo** con servicio, horas y estado, y sin ningún dato personal (FR-035a). El histórico de ocupación queda completo.

La última forma del comando es la que cubre la exigencia del Principio III sobre el borrado a petición del cliente mientras la pantalla correspondiente llega en otra feature.

---

## Despliegue

```bash
docker compose -f docker-compose.prod.yml up -d
```

Tres puntos que no se pueden pasar por alto:

**HTTPS obligatorio** (Principio V). El proxy inverso termina TLS y fija HSTS. La aplicación no escucha en claro fuera de la red interna del compose.

**La IP del cliente, sólo desde el proxy.** El límite por IP de FR-038 y FR-039 lee `X-Forwarded-For`, y debe **confiar en esa cabecera únicamente si la petición viene del proxy conocido** (`TRUSTED_PROXY_IPS`). Sin esa comprobación, cualquiera falsea su IP y el límite deja de existir.

**Cron de retención**: una entrada diaria a las 03:30 hora del salón ejecutando `npm run retention:purge` (D-012). Es el único proceso en segundo plano de la feature — el estado "completada" **no** necesita ninguno, se deriva del reloj al leer (FR-031).

### Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `SALON_TIMEZONE` | Por defecto `Europe/Madrid`. Configuración del salón, no constante del sistema (asunción 9) |
| `RATE_LIMIT_SECRET` | Secreto del HMAC que convierte la IP en clave (FR-040, D-007) |
| `TRUSTED_PROXY_IPS` | Proxies cuya cabecera `X-Forwarded-For` se acepta |
| `PUBLIC_BASE_URL` | Base de los enlaces de gestión que se muestran al cliente |

Ninguna lleva valor en `.env.example`, y `.env` está en `.gitignore`: los secretos nunca entran al repositorio (Principio V).

---

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `type "gist" does not exist` al migrar | Falta `btree_gist` | `CREATE EXTENSION btree_gist;` — debe ser la primera migración |
| Dos citas solapadas han entrado | La restricción `EXCLUDE` no se aplicó, o le falta el `WHERE status = 'CONFIRMED'` | Revisa la migración y vuelve a comprobarlo con el `psql` de arriba |
| El hueco cancelado no reaparece | La restricción no filtra por estado, o la consulta de disponibilidad no filtra `CONFIRMED` | Revisa ambos filtros (BR-005) |
| Las horas se desplazan una hora en octubre | Aritmética sobre `Date` en vez de `Temporal.ZonedDateTime` | La hora de apertura es hora **de pared**, no un instante (D-004) |
| `npm run check:layers` falla | Algo de `src/domain` importa framework o base de datos | Mueve la dependencia a `infrastructure` y páscala como dato (Principio I) |
| El límite por IP nunca salta tras un proxy | `X-Forwarded-For` no se está leyendo, o el proxy no está en `TRUSTED_PROXY_IPS` | Revisa la configuración del proxy |
| Un enlace caducado devuelve `410` o `429` | Ruptura de la indistinguibilidad | Debe devolver siempre la respuesta neutra de FR-019 (D-006) |
