# Quickstart: validar la versión responsive

**Feature**: [spec.md](./spec.md) · **Fecha**: 2026-11-02

## Requisitos

El entorno de la 001 en marcha (ver [README](../../README.md)):

```bash
docker compose up -d db db-test
npm run db:migrate && npm run db:seed
npm run dev   # http://localhost:3000
```

## Validación automática

```bash
npm run test:e2e -- --project=mobile-360     # la 001 sin cambios (SC-004)
npm run test:e2e -- --project=desktop-1280   # la 001 y responsive.spec.ts a 1280 px (SC-005)
npm run test:e2e -- --project=tablet-768     # accesibilidad y tablet
npm test                                     # incluye la guarda de anchos (D-006)
npm run test:all && npm run lint && npm run check:layers
```

Resultado esperado: todo en verde, sin tests saltados.

## Validación manual

Con las herramientas de desarrollo del navegador en modo dispositivo:

| # | Ancho | Pasos | Resultado esperado | Requisito |
|---|---|---|---|---|
| 1 | 360 px | Reservar una cita completa. | Idéntico a la 001: dos pantallas, mismas URL. | FR-002 |
| 2 | 768 px | Abrir `/` y una cita. | Una columna centrada más ancha; días holgados. | FR-003 |
| 3 | 1280 px | Elegir servicio, día y hora. | Servicio y días a la izquierda; horas, resumen y formulario a la derecha. | FR-007, FR-008 |
| 4 | 1280 px | Escribir nombre, cambiar de hora y de día, volver a elegir hora. | Lo escrito sigue en las casillas. | FR-009 |
| 5 | 1280 px | Pulsar Atrás tras elegir hora; luego recargar. | Atrás quita la hora; recargar conserva servicio, día y hora, y vacía el formulario. | FR-010a, Q2 |
| 6 | 1280 × 800 | Confirmar la reserva. | Datos, enlace y aviso visibles sin desplazarse. | SC-007 |
| 7 | 1280 px | Reprogramar una cita. | Días a la izquierda; horas y confirmación a la derecha. | FR-012 |
| 8 | 1280 px | Redimensionar a 700 px a mitad de la reserva. | Pasa a una columna sin perder nada. | FR-014 |
| 9 | 1280 px, zoom 400 % | Recorrer la reserva. | Disposición de móvil, sin desplazamiento horizontal. | FR-005 |
| 10 | 1280 px | Recorrer la reserva sólo con teclado. | Foco visible, orden izquierda → derecha. | FR-015, FR-017 |
| 11 | 1280 px | Comprobar el almacenamiento del navegador tras escribir datos. | Ni `localStorage` ni `sessionStorage` ni cookies contienen nombre, teléfono o email. | FR-009 |
