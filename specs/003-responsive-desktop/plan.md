# Implementation Plan: Versión responsive para tablet y ordenador

**Branch**: `003-responsive-desktop` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-responsive-desktop/spec.md`

## Summary

Adaptar las pantallas de cliente de la 001 a tres tamaños:

- **Móvil** (< 640 px): sin cambios.
- **Tablet** (≥ 640 px): una columna más ancha.
- **Ordenador** (≥ 1024 px): reserva, cita y reprogramación en dos columnas.

No cambia ninguna regla de negocio, dato ni endpoint: es una feature de presentación
que queda dentro de `src/app`, `src/components` y `src/messages`.

Cuatro decisiones la sostienen ([research.md](./research.md)):

1. **Sólo CSS** decide la disposición, con media queries `min-width` a 640 y 1024 px
   definidas una sola vez y vigiladas por un test (D-001, D-006).
2. **Se mantienen `/` y `/reservar`.** En ordenador, `/reservar` pinta también servicio,
   días y horas, ocultos por debajo de 1024 px. El móvil conserva sus URL y su aspecto
   (D-002).
3. **Navegación suave con `next/form`**, que sigue funcionando sin JavaScript (D-003).
4. **Los datos escritos viven sólo en memoria**, en un layout del grupo de rutas
   `(booking)`, y nunca en el navegador (D-004).

## Technical Context

**Language/Version**: TypeScript 5.7 (`strict`, `noUncheckedIndexedAccess`), Node.js 22 LTS

**Primary Dependencies**: Next.js 15 (App Router, `next/form`) + React 19. Sin dependencias nuevas.

**Storage**: N/A. Sin cambios en PostgreSQL ni migraciones.

**Testing**: Vitest para la guarda de anchos. Playwright + `@axe-core/playwright` con tres proyectos: `mobile-360`, `tablet-768` y `desktop-1280`.

**Target Platform**: Navegadores actuales en móvil, tablet y ordenador. Servidor igual que la 001.

**Project Type**: Aplicación web renderizada en servidor (la de la 001).

**Performance Goals**: Respuesta percibida < 2 s en toda acción de reserva y en todos los tamaños (SC-006). `/reservar` sigue haciendo una sola consulta de disponibilidad.

**Constraints**:
- Móvil idéntico a la 001 (FR-002).
- Sin datos personales en el almacenamiento del navegador ni en la URL (FR-009).
- Funciona sin JavaScript.
- WCAG 2.2 AA en los tres tamaños.

**Scale/Scope**: 5 pantallas de cliente, 5 componentes y la hoja de estilos global.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cumplimiento |
|---|---|
| I. Capas | ✅ Sólo cambian `src/app`, `src/components`, `src/messages` y CSS. El dominio no se toca y `check:layers` no cambia. El borrador de reserva es estado de presentación, no regla de negocio. |
| II. Testing | ✅ Cada historia empieza por tests e2e que fallan. La guarda de anchos es un test unitario. La suite de la 001 se ejecuta también a 1280 px. |
| III. Datos personales | ✅ El borrador vive sólo en memoria (D-004). Nada en `localStorage`, `sessionStorage`, cookies ni URL. Lo comprueba un test (quickstart, paso 11). |
| IV. Comunicaciones | N/A. No hay envíos. |
| V. Seguridad | ✅ Sin endpoints nuevos. `/reservar` valida sus parámetros nuevos como `/` (fuera de límites, rango por defecto). |
| VI. Experiencia de usuario | ✅ Mobile-first: los estilos de partida son los del móvil y las media queries son `min-width`. En ordenador la reserva no sale de la vista (SC-001). |
| VII. Accesibilidad | ✅ axe a 360, 768 y 1280 px; reflow al 400 %; orden del DOM igual al visual; contenido oculto con `display: none`; "Elegida" con texto e icono. |
| VIII. Rendimiento | ✅ con vigilancia: `/reservar` añade una consulta de disponibilidad (una sola, D-003 de la 001) en paralelo con las demás (D-008). El test de rendimiento a 360 px sigue siendo la referencia y ya va justo en el límite. |

**Post-design re-check**: sin cambios. Ninguna desviación que justificar.

## Project Structure

### Documentation (this feature)

```text
specs/003-responsive-desktop/
├── plan.md              # Este archivo
├── research.md          # D-001 a D-009
├── data-model.md        # Sin cambios de datos; borrador en memoria
├── quickstart.md        # Validación automática y manual
├── contracts/
│   └── ui-layout.md     # Tamaños, clases, disposición por pantalla, URL de /reservar
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── globals.css                    # Bloque Layout: main, .page--split, .site-header--split, .col-main, .col-side, .wide-only
│   ├── layout.tsx                     # Sin cambios
│   ├── (booking)/                     # Grupo de rutas: no cambia ninguna URL
│   │   ├── layout.tsx                 # Nuevo: monta BookingDraftProvider
│   │   ├── page.tsx                   # Movido desde app/page.tsx; dos columnas
│   │   └── reservar/                  # Movido desde app/reservar/
│   │       ├── page.tsx               # Dos columnas; contexto .wide-only; lecturas en paralelo
│   │       ├── actions.ts
│   │       └── form-state.ts
│   └── cita/[token]/
│       ├── page.tsx                   # Dos columnas en ordenador
│       └── reprogramar/page.tsx       # Dos columnas; rango .wide-only con hora elegida
├── components/
│   ├── booking-draft.tsx              # Nuevo: BookingDraftProvider + useBookingDraft
│   ├── booking-form.tsx               # Lee y escribe el borrador
│   ├── day-range-picker.tsx           # next/form
│   ├── service-picker.tsx             # next/form
│   └── slot-list.tsx                  # next/form; marca de hora elegida
└── messages/es-ES.ts                  # Indicación de FR-010, "Elegida", título de /reservar

tests/
├── unit/ui/layout-breakpoints.test.ts # Guarda de D-006
└── e2e/
    ├── responsive.spec.ts             # Nuevo: historias 1-3 y casos límite
    └── (suites de la 001)             # Ejecutadas también en desktop-1280

playwright.config.ts                   # Proyectos mobile-360, tablet-768, desktop-1280
```

**Structure Decision**: se mantiene el proyecto único de la 001. El grupo de rutas
`(booking)` sólo existe para que el borrador de reserva viva y muera con las dos
pantallas de reserva. El resto son cambios dentro de archivos existentes.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| `next/form` no incluye en la URL el `name`/`value` del botón pulsado. | Es lo primero que se prueba (D-003). Plan B: enlaces con la URL completa. |
| El test de rendimiento a 360 px supera los 2 s por la consulta extra en `/reservar`. | Lecturas en paralelo (D-008). Medir antes y después en la misma máquina. |
| Tests de la 001 con localizadores ambiguos a 1280 px. | Acotar el localizador a su sección, sin cambiar lo que se comprueba (D-009). |
| Mover `page.tsx` y `reservar/` al grupo rompe imports. | El movimiento es una tarea aparte, con `lint` y la suite en verde antes de seguir. |

## Complexity Tracking

Sin violaciones de la constitución que justificar.
