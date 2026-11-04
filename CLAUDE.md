# CLAUDE.md — Gestor de Citas de Peluquería

App web donde el cliente de un salón de un solo sillón reserva, consulta, reprograma
y cancela su cita desde el móvil, sin cuenta de usuario.

## Stack y decisiones vigentes

- **Next.js 15 (App Router) + React 19 + TypeScript 5.7** en modo `strict` con
  `noUncheckedIndexedAccess`. Node.js 22 LTS.
- **PostgreSQL 16** con extensión `btree_gist`, vía `docker compose`. Acceso con
  **Drizzle ORM** + `drizzle-kit` + `pg`; migraciones SQL escritas a mano.
- **Zod 3** valida la frontera HTTP. **Pino** loguea con redacción de PII.
  **`@js-temporal/polyfill`** para toda aritmética de calendario con DST.
- **Tests**: Vitest (unit + integración) y Playwright + `@axe-core/playwright` (e2e y
  accesibilidad), contra PostgreSQL real (`db-test`).
- **Arquitectura hexagonal** en `src/`: `app` → `application` → `domain`, con
  `infrastructure` implementando los puertos. `src/domain` es TypeScript puro y no
  importa Next, React, Drizzle ni `pg`; `npm run check:layers` lo verifica en CI.
- **La no-superposición la garantiza la base de datos**: restricción
  `EXCLUDE USING gist` sobre el rango temporal de las citas `CONFIRMED`. No es una
  comprobación de aplicación.
- **La disponibilidad es UNA sola consulta** del horizonte de 60 días; rango de 14
  días, huecos del día y siguiente día libre se derivan en memoria. Nunca N+1.
- **El enlace de gestión es la credencial**: 32 bytes aleatorios; la BD guarda sólo
  su hash SHA-256, y además el token cifrado (AES-256-GCM, `NOTIFICATION_SEAL_KEY`)
  mientras su email de confirmación está pendiente, como mucho 1 hora (004, D-002).
  Sin sesiones ni cookies.
- **Una cita lleva uno o varios servicios** en `appointment_service`, cada uno con su
  snapshot (nombre, duración y precio al reservar). Dura la suma y se lee en una sola
  consulta. Un precio puede ser `NULL` («Precio a consultar en el salón»), nunca 0.
- **El contrato HTTP vivo** es el 2.2.0 de
  `specs/001-client-appointment-booking/contracts/http-api.yaml` (y el 1.3.0 de
  `specs/002-salon-management/contracts/owner-api.yaml` para la dueña), los que
  comprueba `npm run test:contract`.
- **Tiempo**: siempre el reloj del servidor y `Europe/Madrid` (`SALON_TIMEZONE`),
  nunca el del dispositivo. El dominio recibe un puerto `Clock` inyectado.
- **El único mensaje que envía la app es el email de confirmación de una reserva
  online**, si el cliente marca la casilla (004). Sin SMS. Sale por un puerto
  `Notifier` (Brevo por HTTP; Resend de reserva con `EMAIL_PROVIDER=resend`) desde
  una bandeja de salida en la BD (`notification`): primer intento con `after()` y reintentos durante 1 hora con
  `npm run notifications:dispatch` por cron. Con `NOTIFICATIONS_EMAIL=off` la app se
  comporta como antes de la 004.

## Arranque local

```bash
npm install
cp .env.example .env
docker compose up -d db db-test
npm run db:migrate      # crea btree_gist, tablas y la restricción EXCLUDE
npm run db:seed         # obligatorio: horario, servicios y cierres precargados
npm run db:seed:demo    # opcional: los datos reales de la demo (db/seed/demo.ts)
npm run dev             # http://localhost:3000
```

Tests y checks:

```bash
npm test                 # unitarios (dominio puro)
npm run test:integration # casos de uso contra PostgreSQL real
npm run test:contract    # Route Handlers contra specs/001-…/contracts/http-api.yaml
npm run test:e2e         # Playwright + axe
npm run test:all         # todo, en ese orden
npm run lint             # ESLint + tsc --noEmit
npm run check:layers     # frontera del dominio — bloquea el merge si se cruza
npm run notifications:dispatch  # reintentos de los emails pendientes (cron, cada minuto)
npm run email:fake       # proveedor de email falso en :4010 para probar a mano
```

## Convenciones

- **TDD no negociable**: primero un test que falla. Cero tests saltados en `main`.
  Todo bug empieza por un test de regresión.
- Código, identificadores, comentarios, commits y ramas **en inglés**; documentación
  y textos de producto en español. Commits en **Conventional Commits**.
- Una feature por rama, nombrada como la feature (`001-client-appointment-booking`).
- Una regla de negocio existe **en un solo sitio**: el dominio. La UI puede
  anticipar el resultado, nunca decidirlo.
- Toda función pública del dominio devuelve `Result<T, E>` con sus fallos tipados.
  Sin excepciones para flujo de control.
- Nombre, teléfono y email son los **únicos** datos personales, y nunca aparecen en
  logs, trazas ni analítica.
- Los textos de la interfaz viven todos en `src/messages/es-ES.ts`.
- Mobile-first a 360 px y WCAG 2.2 AA: estado siempre con texto e icono, no sólo color.
- Responsive: los únicos anchos son 640 px (tablet) y 1024 px (ordenador), y las
  clases `.page--split`, `.site-header--split`, `.col-main`, `.col-side` y `.wide-only`
  viven en `src/app/globals.css`. Toda pantalla nueva las usa;
  `tests/unit/ui/layout-breakpoints.test.ts` rechaza cualquier otro ancho y `order`.
- Los formularios GET de navegación usan `NavForm` (`src/components/nav-form.tsx`), no
  `next/form`, que pierde el `name`/`value` del botón pulsado. En e2e, un clic que
  navega se espera con `clickAndNavigate` (`tests/e2e/helpers/booking.ts`).
- Nada de código muerto, comentado ni TODOs en `main`.
- `db/seed/seed.ts` es el fixture de los tests: no se cambian sus datos para una demo.
  Los datos que se enseñan al cliente van en `db/seed/demo.ts`.

Las reglas de producto viven en `.specify/memory/constitution.md`, el estado del
producto en `README.md` y el plan de trabajo, con sus decisiones pendientes, en
`docs/roadmap.md`. Al empezar una sesión, leer los dos últimos.
