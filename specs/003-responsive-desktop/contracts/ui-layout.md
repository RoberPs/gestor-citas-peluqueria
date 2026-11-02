# Contrato de interfaz: disposición responsive

**Feature**: [spec.md](../spec.md) · **Fecha**: 2026-11-02

La API HTTP no cambia: [contracts/http-api.yaml](../../001-client-appointment-booking/contracts/http-api.yaml)
de la 001 sigue vigente. Este documento fija lo que cualquier pantalla de cliente, y
más adelante las de la dueña, debe respetar.

## Tamaños

| Nombre | Condición CSS | Contenedor |
|---|---|---|
| Móvil | por defecto (sin media query) | máx. 480 px |
| Tablet | `@media (min-width: 640px)` | máx. 720 px |
| Ordenador | `@media (min-width: 1024px)` | máx. 1120 px en dos columnas; 720 px en una |

Son los **únicos** dos anchos de media query permitidos. El test de D-006 lo vigila.

## Clases de disposición

| Clase | Uso |
|---|---|
| `main` (elemento) | Contenedor de toda pantalla. Centrado y con el ancho del tamaño actual. |
| `.site-header--split` | Cabecera de una pantalla `.page--split`: mismo ancho que su `main` en ordenador. |
| `.page--split` | Pantalla que pasa a dos columnas en ordenador. Por debajo de 1024 px, una sola columna. |
| `.col-main` | Columna izquierda en ordenador. Siempre va antes en el DOM. |
| `.col-side` | Columna derecha en ordenador. |
| `.wide-only` | Contenido que sólo se ve en ordenador (`display: none` por debajo de 1024 px). |

Prohibido: la propiedad `order` y cualquier colocación en rejilla que haga que el orden
visual no coincida con el del DOM.

## Pantallas

| Pantalla | Ruta | Móvil y tablet | Ordenador: `.col-main` | Ordenador: `.col-side` |
|---|---|---|---|---|
| Reserva | `/` | Como hoy | Servicio, rango de días | Horas del día, indicación de FR-010 (`.wide-only`) |
| Datos | `/reservar` | Como hoy: resumen, formulario y Volver | Servicio y rango (`.wide-only`) | Horas con la elegida marcada (`.wide-only`), resumen, formulario y Volver |
| Cita y confirmación | `/cita/[token]` | Como hoy | Datos de la cita, enlace y aviso de guardarlo | Acciones (o motivo de que no las haya), datos del salón |
| Reprogramar | `/cita/[token]/reprogramar` | Como hoy | Hora actual, avisos y rango de días; con hora elegida, el rango es `.wide-only` | Horas con la actual y la elegida marcadas; panel de confirmación del cambio |
| Mensaje neutro | `/cita/[token]` sin cita | Como hoy | — una columna de 720 px — | |

## URL de `/reservar`

| Parámetro | Obligatorio | Uso |
|---|---|---|
| `serviceId` | sí | Como en la 001. |
| `startsAt` | sí | Como en la 001. |
| `rangeStart` | no | Rango que se estaba viendo; si falta, el que contiene el día de `startsAt`. |
| `selectedDate` | no | Si falta, el día de `startsAt`. |

Un `rangeStart` o `selectedDate` fuera de límites se trata como en `/`: se usa el rango
por defecto, sin página de error.

## Marcas de selección

- En la lista de horas, la hora elegida lleva `aria-pressed="true"`, una marca visible
  con texto ("Elegida") e icono, no sólo color.
- La hora actual de la cita al reprogramar conserva su marca de la 001.

## Navegación

- Elegir servicio, día, rango u hora es una navegación GET con su propia URL. Con
  JavaScript, la navegación ocurre dentro de la página (`NavForm`); sin JavaScript,
  recarga la página entera.
- Nunca se mueve el foco por programa al navegar. Avisan la región `aria-live` de horas
  y el título de la página.
