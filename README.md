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
npm run db:seed
npm run dev             # http://localhost:3000
```

Tests: `npm run test:all`. Checks: `npm run lint` y `npm run check:layers`.

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
| [001 · Reserva del cliente](specs/001-client-appointment-booking/spec.md) | Implementada | 118 / 118 | `001-client-appointment-booking` | No |
| 002 · Gestión del salón (`specs/002-salon-management/` en su rama) | Spec, plan y tareas; sin código | 0 / 164 | `002-salon-management` | No |
| 003 · Versión responsive para ordenador | Planificada, sin spec | — | — | — |
| 004 · Avisos por email y SMS | Planificada, sin spec | — | — | — |

`main` sigue en el snapshot inicial (`0c45f82`). La rama `002-salon-management` contiene
todos los commits de la 001 más la documentación de la 002. La corrección de la
documentación de la 001 y la enmienda 1.1.0 de la constitución también están en la
rama 001, para que lleguen a `main` con ella.

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

### Estado de los checks

| Check | Resultado |
|---|---|
| `npm test` (unitarios) | 257 / 257 ✅ |
| `npm run test:integration` | 114 / 114 ✅ |
| `npm run test:contract` | 80 / 80 ✅ |
| `npm run test:e2e` | 61 / 61 ✅ |
| `npm run lint` | ✅ |
| `npm run check:layers` | ✅ |

El 2026-11-02 se corrigieron dos **tests que dependían de la fecha de ejecución**, no
defectos de la app:

1. `availability-horizon.test.ts` fijaba el reloj en 2026-09-15, pero
   `db/seed/history.ts` creaba el histórico con el `now()` real de PostgreSQL. Ahora
   `seedHistory` recibe el instante de referencia.
2. `slotDaysFromNow` saltaba los domingos pero no el festivo que crea el seed (hoy + 7),
   y un lunes caía en él. Ahora salta los dos.

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
- La interfaz está diseñada para 360 px. En pantallas anchas se ve como una columna
  estrecha; la 003 lo resuelve.
- v1 no envía SMS ni email. La 004 cambiará esa decisión y activará el Principio IV
  de la constitución.
