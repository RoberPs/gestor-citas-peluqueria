# Specification Quality Checklist: Reserva de citas de peluquería (cara al cliente) v1

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-15
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [ ] Success criteria are technology-agnostic (no implementation details) — _SC-005 mezcla un resultado observable ("no se degrada con el histórico") con una decisión de implementación ("en una sola consulta"), que es exactamente el detalle que este criterio pide excluir_
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [ ] No implementation details leak into specification — _misma causa que el punto anterior: SC-005 nombra explícitamente "una sola consulta" (detalle de implementación) en un criterio de éxito de cara al negocio_

## Constitution Compliance (v1.0.0)

- [x] **I. Calidad de código**: la spec no impone estructura de código; las reglas de negocio (BR-001..BR-015) están enunciadas una sola vez y de forma independiente de la interfaz.
- [x] **II. Testing**: cada historia declara su Independent Test; los casos límite exigidos por la constitución (doble reserva, solapamiento, fuera de horario, cancelación fuera de plazo) están cubiertos en Edge Cases y en escenarios de aceptación.
- [x] **III. Minimización de datos**: FR-008 fija los tres campos exactos; FR-035/FR-035a el borrado anonimizador a 12 meses; FR-036 prohíbe datos personales en logs; FR-040 acota la retención de la IP usada para los límites antiabuso.
- [x] **IV. Comunicaciones y consentimiento**: no aplica en v1 — no hay mensajería saliente (Assumption 5, Out of Scope). Aplicará íntegro en la feature de mensajería.
- [x] **V. Seguridad**: FR-017 cuantifica la credencial por cita en ≥128 bits de entropía (el enlace autentica y autoriza); FR-038/FR-039 limitan por IP la apertura de enlaces y la confirmación de reservas; FR-034 exige validación en servidor; FR-019 evita filtrar existencia de citas, también tras el borrado por retención.
- [x] **VI. Experiencia de usuario**: FR-003 garantiza disponibilidad real; FR-005/FR-005a dan el estado de cada día de un vistazo; FR-022 confirmación previa a cancelar; FR-037 feedback accionable; SC-011 mobile-first.
- [x] **VII. Accesibilidad**: SC-010 exige WCAG 2.2 AA, teclado, foco visible y no depender del color.
- [x] **VIII. Rendimiento**: SC-004 (<2 s en móvil/4G) y SC-005 (sin degradación con el histórico, y el rango de 14 días en una sola consulta); FR-005b prohíbe explícitamente una consulta por día.

## Decisiones que resuelven puntos [TBD] de la constitución

| Punto [TBD] constitucional | Resuelto en esta spec |
|----------------------------|-----------------------|
| Parámetros temporales del dominio | BR-003 (2 h), BR-004 (24 h), BR-011 (60 días), BR-011b (rangos de 14 días), BR-012 (rejilla 30 min), BR-013 (sin margen) |
| Método de autenticación de clientes | Assumption 1 + FR-017 + BR-016: credencial de ≥128 bits en el enlace de la cita, con límite de intentos por IP (BR-017) |
| Periodos de retención | FR-035/FR-035a y BR-018: a los 12 meses se borran los datos personales y el enlace deja de resolver; la cita se conserva anonimizada |
| Idiomas soportados | Assumption 4: sólo español de España |
| Alcance multi-salón / multi-profesional | Out of Scope: una instancia por salón, un único recurso reservable |
| Política de no-shows, pagos, señales | Out of Scope + Assumption 12 |

Siguen `[TBD]` y corresponden a `/speckit-plan`: stack técnico, proveedores de mensajería, modelo de roles del personal, autenticación del personal, objetivos de disponibilidad y copias de seguridad, observabilidad, documentación RGPD.

## Notes

- **"Servidor" en FR-011, FR-032 y FR-034**: es terminología heredada literalmente del Principio V y del Principio VIII de la constitución ("toda entrada SE VALIDA en servidor"). Designa dónde reside la autoridad de la decisión, no una tecnología concreta; se mantiene deliberadamente para que el cumplimiento constitucional sea verificable en la spec.
- **Sesión de clarificación 2026-09-15**: cinco preguntas resueltas e integradas (ver `## Clarifications` en la spec): tramos de apertura múltiples por día, protección antiabuso por entropía + límite por IP, prevalencia de la cita confirmada sobre un cambio de configuración, presentación de días en rangos de 14, y comportamiento del enlace tras el borrado por retención. Ninguna de las cinco contradijo un requisito previo; todas ampliaron o cuantificaron uno existente.
- **Límites concretos deferidos a `/speckit-plan`**: el número de peticiones y la ventana de tiempo de FR-038 y FR-039. La spec fija que los límites existen y cómo se comportan al superarse; los valores dependen del hosting y del tráfico real.
- **Contradicción resuelta durante la redacción**: la descripción inicial excluía toda mensajería saliente y a la vez planteaba enviar la cita por SMS/email. Se resolvió a favor de la exclusión: v1 muestra la confirmación y el enlace **sólo en pantalla** (Assumption 5 y 6). La consecuencia aceptada es que un cliente que pierda el enlace sólo puede recurrir al teléfono del salón.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
