/**
 * Reads `serviceIds` from the URL of the booking screens (005, D-004):
 *
 * - absent: the first service of the catalogue is chosen (FR-002);
 * - present and empty: the client unmarked everything, so nothing is chosen
 *   and the screen asks for one (FR-004);
 * - ids that are unknown or repeated are dropped, and if none is left it reads
 *   as absent, as an unknown `serviceId` did in 001.
 *
 * Presentation, not a rule. Whether a selection can be booked is decided by
 * the domain, through `selectServices`, every time it reaches a use case.
 */
export function serviceIdsFrom(
  param: string | undefined,
  catalogue: readonly { readonly id: string }[],
): string[] {
  if (param === '') return [];

  const requested = (param ?? '').split(',');
  const known = catalogue.filter((service) => requested.includes(service.id));
  if (known.length > 0) return known.map((service) => service.id);

  const first = catalogue[0];
  return first === undefined ? [] : [first.id];
}
