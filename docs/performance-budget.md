# Presupuesto de rendimiento

**Feature**: `001-client-appointment-booking` | **Última medición**: 2026-09-15

Este documento registra las dos mediciones que exige T112. Las produce
`tests/e2e/performance.spec.ts`, que además las **asegura**: si alguna se sale
del límite, la suite falla.

## Lo que se mide y por qué

El presupuesto de JavaScript es un **proxy**, no el objetivo. Una ruta puede
caber de sobra en 120 KB y aun así sentirse lenta. Lo que SC-004 y el Principio
VIII piden es tiempo, así que lo que se afirma es el tiempo de cada paso del
flujo, y los bytes se anotan al lado — no en su lugar.

## Condiciones

| Parámetro | Valor |
|---|---|
| Ancho de banda | 4 Mbit/s bajada, 3 Mbit/s subida |
| Latencia | 20 ms de ida y vuelta |
| CPU | 4× más lenta que la máquina de desarrollo (móvil de gama media) |
| Viewport | 360 × 740 px |
| Servidor | `next start` sobre el build de producción |

El estrangulamiento se aplica por CDP (`Network.emulateNetworkConditions` y
`Emulation.setCPUThrottlingRate`), no por aproximación.

## SC-004 — respuesta percibida por debajo de 2 s

| Acción | Medido | Límite |
|---|---|---|
| Abrir la pantalla de reserva | 1213 ms | 2000 ms |
| Elegir servicio | 1074 ms | 2000 ms |
| Elegir día | 732 ms | 2000 ms |
| Elegir hora | 620 ms | 2000 ms |
| Confirmar | 656 ms | 2000 ms |
| Abrir la cita desde su enlace | 956 ms | 2000 ms |
| Abrir la pantalla de reprogramación | 607 ms | 2000 ms |

El paso más lento es la primera carga, que es donde se paga el arranque. Los
siguientes van por debajo porque la navegación es HTML renderizado en servidor:
no hay bundle que arrancar entre pantalla y pantalla.

## Presupuesto de JavaScript — ≤ 120 KB comprimidos

Se cuentan los **bytes que viajan de verdad** (`encodedDataLength` de CDP), no
la cabecera `content-length`: falta en la mayoría de estas respuestas, que van
comprimidas y por trozos, así que leerla contaba casi nada. Una primera versión
de este test daba 557 bytes por ese motivo.

| Ruta | Medido | Presupuesto |
|---|---|---|
| Pantalla de reserva (`/`, carga en frío) | 105 175 B (102,7 KiB) | 122 880 B |
| Pantalla de datos (`/reservar`, navegando) | 6244 B (6,1 KiB) | 122 880 B |

El grueso de esos 102,7 KiB es el runtime de React que Next envía siempre. El
código propio de la ruta de reserva son 142 B según el informe del build, y
1,87 KB en `/reservar`, que es donde vive el único componente cliente de la
feature.

Del informe de `next build`, para contraste:

```text
┌ ƒ /                                         142 B         103 kB
├ ƒ /cita/[token]                             162 B         106 kB
├ ƒ /cita/[token]/reprogramar                 164 B         106 kB
└ ƒ /reservar                               1.87 kB         108 kB
```

## Margen

El margen del presupuesto es de unos 17 KiB, y casi todo el consumo es el
runtime del framework. Lo que lo gastaría es **convertir en cliente un
componente que hoy es de servidor**: hoy sólo lo es el formulario de reserva, y
lo es porque conservar los campos válidos tras un error exige estado en el
navegador. Cualquier otro que cruce esa línea debería justificarse contra esta
tabla.
