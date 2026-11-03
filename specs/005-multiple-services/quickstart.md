# Quickstart: validar la 005

## Preparación

```bash
docker compose up -d db db-test
npm run db:migrate      # aplica 0003_multiple_services.sql
npm run db:seed         # fixture: Corte, Color, Peinado y Lavado (sin precio, desde la fase 2)
npm run dev
```

## Validación automática

```bash
npm test                 # selectServices, totalPriceOf, durationLabel, applyReschedule
npm run test:integration # migración 0003, confirmBooking y reschedule con varios servicios
npm run test:contract    # contrato 2.0.0
npm run test:e2e         # tres tamaños
npm run lint && npm run check:layers
```

Todo en verde y sin tests saltados. `check:layers` confirma que
`domain/catalog/selection.ts` no importa nada fuera del dominio.

## Validación manual

Sobre el fixture (`npm run db:seed`), en móvil (360 px) y en ordenador (1280 px). Cada
paso indica qué requisito comprueba.

1. **Preselección.** Abrir `/`. «Corte» aparece elegido, con «✓ Elegido», y debajo se lee
   «Duración total: 30 min». (FR-002, FR-005)
2. **Dos servicios.** Pulsar «Peinado». Se ven los dos servicios y «Duración total:
   1 h 15 min». La URL lleva `serviceIds=<corte>,<peinado>`. (FR-001, FR-005, D-004)
3. **Las horas se ajustan.** Un día laborable de 10:00 a 20:00: el último inicio que se
   ofrece es las 18:30 (18:30 + 75 min = 19:45) y no aparecen las 19:00. (FR-008)
4. **Atrás y recarga.** Atrás vuelve a sólo «Corte». Adelante y recargar mantienen los
   dos. (003 FR-010a)
5. **Orden del catálogo.** Desmarcarlo todo, marcar «Peinado» y después «Corte». El
   resumen dice «Corte, Peinado». (FR-006)
6. **Selección vacía.** Desmarcar los dos. Desaparecen días y horas y aparece «Elige al
   menos un servicio…». (FR-004)
7. **Selección larga.** Marcar los cuatro (30 + 90 + 45 + 30 = 3 h 15 min). Un sábado
   (tramos de 10:00 a 14:00 y de 16:00 a 20:00) sólo se ofrecen las 10:00, las 10:30, las
   16:00 y las 16:30: ninguna cita cruza el cierre de mediodía. El mensaje de FR-010 no
   sale con el fixture, porque su tramo más largo dura 10 h. Lo cubren el test unitario
   de `fitsOpeningHours` y un test de integración de `getAvailability` con un horario de
   tramos de 2 h. Un e2e necesitaría otro horario en `db-test` y reiniciar la app, porque
   la configuración se cachea (001/D-003). (FR-008, FR-010, D-007)
8. **Reservar.** Con «Corte» y «Lavado», elegir una hora. En ordenador, el resumen
   muestra «Corte · 30 min · 18,00 €», «Lavado · 30 min · Precio a consultar en el salón»,
   «Duración: 1 h» y «Precio: 18,00 € + precio a consultar en el salón». Confirmar.
   (FR-013, FR-020)
9. **Una cita, un enlace.** La confirmación muestra los dos servicios. En la base de
   datos hay una fila en `appointment` y dos en `appointment_service`, y
   `ends_at − starts_at` es igual a 60 minutos. (FR-012, FR-014)
10. **El hueco queda ocupado.** Volver a `/` con «Corte»: la hora reservada y la media
    hora siguiente ya no se ofrecen. (FR-016)
11. **Conservar la hora.** En ordenador, en `/reservar` con una hora elegida, añadir un
    servicio:
    - Si la cita sigue cabiendo, se queda la hora y se actualiza el resumen.
    - Si no cabe (elegir la última hora del día y añadir «Color»), se vuelve a las horas
      del mismo día con el aviso de hora quitada, y lo escrito en el formulario se
      conserva. (FR-011)
12. **Reprogramar.** Abrir el enlace del paso 9 y pulsar Reprogramar. El aviso nombra los
    dos servicios, no hay selector y sólo se ofrecen inicios donde cabe 1 h. La hora
    actual aparece como «tu hora actual». Moverla: el enlace es el mismo y la duración
    sigue siendo 1 h. (FR-017)
13. **Cita anterior a la 005.** Una cita creada antes de migrar (fixture del test de
    migración) se ve igual que antes: «Servicio», en singular, con su duración y su
    precio. (FR-021, SC-006)
14. **Nunca «0,00 €».** Recorrer catálogo, resumen, confirmación y enlace con «Lavado»
    solo. Siempre se lee «Precio a consultar en el salón». (FR-019, SC-005)
15. **Accesibilidad.** Elegir y quitar servicios sólo con teclado. El lector de pantalla
    anuncia la duración total sin mover el foco. axe sin infracciones a 360, 768 y
    1280 px. El recorrido completo con teclado también está automatizado en
    `multiple-services.spec.ts`. (FR-023, SC-007)
16. **Servicio retirado.** Abrir `/reservar` con un `serviceIds` que incluye un id que
    no está en el catálogo. La selección se muestra sin él y el resumen y la duración
    sólo cuentan los servicios válidos. El rechazo al confirmar (FR-015) lo cubre el
    test de integración de `confirmBooking`: con la configuración en caché no se puede
    retirar un servicio a mitad de un e2e. (Caso límite «deja de ofrecerse»)

## Demo

```bash
npm run db:seed:demo
```

Los cuatro servicios de la Peluquería Niza aparecen sin precio, con «Precio a consultar
en el salón», y «Corte de pelo» + «Diseño y corte de barba» suma 1 h.
