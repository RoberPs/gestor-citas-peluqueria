# Contrato de interfaz: elegir varios servicios

Cómo se ve y cómo se navega la selección de servicios. Complementa
[003 · ui-layout.md](../../003-responsive-desktop/contracts/ui-layout.md), que no
cambia: tamaños, columnas y clases siguen siendo los mismos.

## URL

| Pantalla | Parámetros |
|---|---|
| `/` | `serviceIds`, `rangeStart`, `selectedDate`, `horaQuitada` |
| `/reservar` | `serviceIds`, `startsAt`, `rangeStart`, `selectedDate` |
| `/cita/{token}/reprogramar` | Sin cambios: los servicios son los de la cita. |

- `serviceIds`: ids separados por comas. Sin el parámetro se elige el primer servicio
  (FR-002). Con el parámetro vacío se pide elegir uno (FR-004). Ver D-004.
- `horaQuitada=1`: la hora elegida ya no cabía con la nueva selección (FR-011, D-005).
  Sólo se usa para mostrar el aviso.
- Todos los formularios GET que hoy llevan `serviceId` oculto (días, rangos, horas, salto
  al siguiente día) pasan a llevar `serviceIds`.
- La URL nunca lleva datos personales (003/D-004).

## Selector de servicios

- Una lista de botones con `aria-pressed`, uno por servicio, dentro de la sección «Elige
  los servicios». Cada botón muestra el nombre, la duración y el precio o «Precio a
  consultar en el salón».
- Un servicio elegido se distingue por texto e icono («✓ Elegido»), no sólo por el color
  (FR-023, Principio VII).
- El `value` de cada botón es la selección que resulta de pulsarlo (D-004).
- Debajo, un resumen que siempre se ve: los servicios elegidos y «Duración total: 1 h».
  Es una región `aria-live="polite"`, así que anuncia el cambio sin mover el foco
  (FR-023).
- Con la selección vacía, en lugar de días y horas: «Elige al menos un servicio para ver
  los días y las horas libres».
- Con `fitsOpeningHours = false`, en lugar de las horas: «Los servicios que has elegido
  duran {duración}, más que cualquier franja del salón. Quita alguno o llama al
  {teléfono}».

## Resumen, confirmación y enlace de la cita

En el bloque de datos de la cita:

```text
Servicios     Corte de pelo · 30 min · 12,00 €
              Afeitado clásico · 30 min · Precio a consultar en el salón
Duración      1 h
Precio        12,00 € + precio a consultar en el salón
Fecha / Hora / Plazo de cancelación   (como en la 001)
```

Con un solo servicio se mantiene la presentación de la 001 («Servicio», en singular).

## Reprogramar

El aviso «Estás cambiando la hora de tu {servicio}…» pasa a nombrar todos los servicios:
«Estás cambiando la hora de tu cita (Corte de pelo y Afeitado clásico). Los servicios no
cambian; si quieres otros, cancela esta cita y reserva una nueva» (FR-017).

## Textos

Todos los textos nuevos van en `src/messages/es-ES.ts`:

- título y pista de la sección de servicios
- marca de servicio elegido
- duración total
- selección vacía
- selección demasiado larga
- hora quitada
- servicio que deja de ofrecerse
- tres frases de precio
- formato de horas y minutos
- aviso de reprogramación en plural

`tests/unit/messages/actionable-errors.test.ts` comprueba que los errores nuevos llevan
`nextAction`.
