import { err, ok, type Result } from '../shared/result';
import { snapshotOf, type Service, type ServiceId, type ServiceSnapshot } from './service';

/**
 * The services of one appointment (D-003).
 *
 * Which services go in, in what order and for how long are business rules, so
 * they are decided here and only here. The screen and the API show the result;
 * none of them sums a duration or sorts a list on its own.
 */

/** An appointment without services cannot be written down, let alone stored. */
export type NonEmptyServiceList = readonly [ServiceSnapshot, ...ServiceSnapshot[]];

export type ServiceSelection = {
  /** Catalogue order, whatever order the client picked them in (FR-006). */
  readonly services: NonEmptyServiceList;
  /** The sum of their durations, with no gap between them (FR-007). */
  readonly durationMinutes: number;
};

export type SelectionError =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'DUPLICATE' }
  | { readonly kind: 'UNKNOWN_SERVICE'; readonly serviceIds: readonly ServiceId[] };

export function durationOfServices(services: readonly ServiceSnapshot[]): number {
  return services.reduce((total, service) => total + service.durationMinutes, 0);
}

/**
 * Only active services count: one that stopped being offered is as unknown as
 * one that never existed (FR-015).
 */
export function selectServices(
  catalogue: readonly Service[],
  requestedIds: readonly ServiceId[],
): Result<ServiceSelection, SelectionError> {
  if (requestedIds.length === 0) return err({ kind: 'EMPTY' });
  if (new Set(requestedIds).size !== requestedIds.length) return err({ kind: 'DUPLICATE' });

  const offered = catalogue.filter((service) => service.isActive);
  const unknown = requestedIds.filter((id) => !offered.some((service) => service.id === id));
  if (unknown.length > 0) return err({ kind: 'UNKNOWN_SERVICE', serviceIds: unknown });

  const [first, ...rest] = offered
    .filter((service) => requestedIds.includes(service.id))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(snapshotOf);

  // Unreachable once every id has been found, but the type has to hear it.
  if (first === undefined) return err({ kind: 'EMPTY' });

  const services: NonEmptyServiceList = [first, ...rest];
  return ok({ services, durationMinutes: durationOfServices(services) });
}
