# Gestor de Citas de Peluquería

App web para un salón de un solo sillón: el cliente reserva, consulta, reprograma y
cancela su cita desde el móvil, sin cuenta de usuario.

- Reglas de producto: [constitución](.specify/memory/constitution.md)
- Especificaciones: [specs/](specs/)
- Plan de trabajo y decisiones: [docs/roadmap.md](docs/roadmap.md)
- Stack y convenciones de desarrollo: [CLAUDE.md](CLAUDE.md)

## Arranque local

Requiere Node.js 22 y Docker.

```bash
npm install
cp .env.example .env
docker compose up -d db db-test
npm run db:migrate
npm run db:seed         # datos de prueba: los que usan los tests
npm run dev             # http://localhost:3000
```

Tests: `npm run test:all`. Checks: `npm run lint` y `npm run check:layers`.

### Demo para el cliente

`npm run db:seed:demo` carga en la base de desarrollo los datos reales de la
**Peluquería de Caballeros Niza**: dirección, teléfono, horario (L–V 10:00–14:00 y
17:00–20:00; sábados 10:00–14:00) y sus cuatro servicios. Datos provisionales hasta
acordarlos con el cliente:

- Todos los servicios duran 30 minutos; la reserva sigue siendo cada media hora.
- Los precios están a 0 y la pantalla muestra «0,00 €». La feature 005 los hará
  opcionales.
- No hay cierres por festivo.

Los servicios de prueba quedan desactivados, no borrados, porque puede haber citas que
los referencian. Para volver a los datos de prueba, `npm run db:seed`. Los tests usan
siempre `db-test` con su propio seed, así que cambiar la demo nunca los rompe.

## Estado del producto

Última revisión: **2026-11-02**.

### Resumen

La parte del **cliente** está construida y funciona: reserva, consulta, reprogramación y
cancelación sin cuenta. La parte de la **dueña** no existe todavía: no hay acceso
privado, agenda ni listado. Hoy una reserva entra en la base de datos y nadie en el
salón la ve sin consultarla a mano.

### Features

| Feature | Estado | Tareas | Rama | En `main` |
|---|---|---|---|---|
| [001 · Reserva del cliente](specs/001-client-appointment-booking/spec.md) | Implementada | 118 / 118 | `001-client-appointment-booking` | Sí (PR #1) |
| [002 · Gestión del salón](specs/002-salon-management/spec.md) | Spec, plan y tareas; sin código | 0 / 164 | `002-salon-management` | Sólo la documentación (PR #4) |
| [003 · Versión responsive para tablet y ordenador](specs/003-responsive-desktop/spec.md) | Implementada | 35 / 35 | `003-responsive-desktop` | Sí (PR #3) |
| 004 · Avisos por email y SMS | Planificada, sin spec | — | — | — |

`main` contiene la 001 y la 003 completas, la enmienda 1.1.0 de la constitución y la
documentación de la 002 (spec, plan y tareas), con la 003 ya incorporada a su rama para
que sus pantallas nazcan responsive. El código de cada feature se fusiona a `main` al cerrarla,
con la CI en verde. La 002 se implementa en su rama `002-salon-management` a partir del
paso 2 del [roadmap](docs/roadmap.md).

### Qué puede hacer hoy la app (001)

Probado a mano el 2026-11-02:

- Elegir servicio y ver 14 días marcados como *con huecos*, *lleno* o *cerrado*, con
  avance por rangos hasta 60 días.
- Ver las horas libres del día respetando la antelación mínima de 2 h y los tramos
  de apertura.
- Reservar con nombre, teléfono y email, con validación por campo que conserva lo escrito.
- Pantalla de confirmación con el enlace de gestión y el aviso de guardarlo.
- Desde el enlace: consultar, reprogramar (misma URL, hora actual marcada) y cancelar
  con confirmación explícita.
- Enlace inexistente o malformado: mensaje neutro.
- Borrado de datos personales a los 12 meses (`npm run retention:purge`).

Con la 003, todo lo anterior se adapta a tres tamaños:

- **Móvil** (< 640 px): igual que en la 001.
- **Tablet** (640–1023 px): una columna de 720 px, con días y horas más holgados.
- **Ordenador** (≥ 1024 px): la reserva, la cita y la reprogramación pasan a dos
  columnas. Al reservar, servicio y días quedan a la izquierda; horas, resumen y
  formulario, a la derecha.
- Elegir día u hora no recarga la página: lo escrito se conserva sin guardarse nunca en
  el navegador. Atrás deshace la última elección y recargar la mantiene.

### Estado de los checks

En `main` tras la 003, el 2026-11-02 (CI del PR #3 en verde). Playwright tiene tres proyectos,
uno por tamaño (ver `playwright.config.ts`).

| Check | Resultado |
|---|---|
| `npm test` (unitarios) | 264 / 264 ✅ |
| `npm run test:integration` | 114 / 114 ✅ |
| `npm run test:contract` | 80 / 80 ✅ |
| `npm run test:e2e` | 159 / 159 ✅ |
| · proyecto `mobile-360` (la suite de la 001) | 61 / 61 ✅ |
| · proyecto `desktop-1280` (la 001 sin rendimiento, más `responsive.spec.ts`) | 90 / 90 ✅ |
| · proyecto `tablet-768` (accesibilidad) | 8 / 8 ✅ |
| `npm run lint` | ✅ |
| `npm run check:layers` | ✅ |

El 2026-11-02 se corrigieron tres **tests que dependían de la fecha o de la zona
horaria de la máquina**, no defectos de la app:

1. `availability-horizon.test.ts` fijaba el reloj en 2026-09-15, pero
   `db/seed/history.ts` creaba el histórico con el `now()` real de PostgreSQL. Ahora
   `seedHistory` recibe el instante de referencia.
2. `slotDaysFromNow` saltaba los domingos pero no el festivo que crea el seed (hoy + 7),
   y un lunes caía en él. Ahora salta los dos.
3. `slotDaysFromNow` fijaba la hora con la zona horaria de la máquina. En la CI, que
   corre en UTC, la cita quedaba una hora más tarde en Madrid y `us4-view` fallaba.
   Ahora calcula día y hora en `SALON_TIMEZONE`, igual que `us1-availability`.

`performance.spec.ts` (SC-004) va justo en el límite: con `TZ=UTC` midió una vez 2017 ms
frente a 2000 ms y pasó al repetirlo. Si falla de forma intermitente en la CI, es esto.

### Defectos menores de experiencia de uso (001)

- Tras reprogramar o cancelar no hay mensaje de éxito (FR-037).
- Justo después de cancelar aparece "Esta cita ya está cancelada, así que no hay nada
  más que cambiar…", que se lee como un error.
- El encabezado "Tu cita" aparece tres veces en la pantalla de la cita.
- Una cita cancelada sigue mostrando "Puedes cancelar hasta 24 horas antes".
- El resumen de errores del formulario es redundante ("Revisa estos datos… Revisa los
  datos marcados").

### Restricciones a tener en cuenta

- La configuración del salón se cachea en memoria al primer acceso (D-003 de la 001).
  Cambiarla con el seed exige reiniciar la app; la 002 lo sustituye por lectura en vivo.
- v1 no envía SMS ni email. La 004 cambiará esa decisión y activará el Principio IV
  de la constitución.
