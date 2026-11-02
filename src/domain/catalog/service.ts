export type ServiceId = string;

/** A bookable offering from the salon's catalogue. Preloaded configuration (FR-007). */
export type Service = {
  readonly id: ServiceId;
  readonly name: string;
  readonly durationMinutes: number;
  /** Cents as an integer, never a float. Informative: v1 charges nothing. */
  readonly priceCents: number;
  readonly isActive: boolean;
  readonly displayOrder: number;
};

/**
 * The copy of the service frozen into an appointment when it is booked (FR-016, D-011).
 *
 * A later price change or a retired service leaves confirmed appointments
 * untouched, and rescheduling uses the duration that was agreed, not today's.
 */
export type ServiceSnapshot = {
  readonly serviceId: ServiceId;
  readonly name: string;
  readonly durationMinutes: number;
  readonly priceCents: number;
};

export function snapshotOf(service: Service): ServiceSnapshot {
  return {
    serviceId: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceCents: service.priceCents,
  };
}
