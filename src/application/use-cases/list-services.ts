import type { Salon } from '@/domain/catalog/salon';
import type { Service } from '@/domain/catalog/service';
import type { SalonConfigRepository } from '../ports';

/** FR-001: the catalogue, with the salon details every screen shows (FR-014). */
export type ServiceCatalogue = {
  readonly salon: Salon;
  readonly services: readonly Service[];
};

export function createListServices(deps: { readonly config: SalonConfigRepository }) {
  return async function listServices(): Promise<ServiceCatalogue> {
    const configuration = await deps.config.load();

    // Retired services stop being offered; appointments that reference them stay
    // whole, because each carries its own snapshot (D-011).
    return { salon: configuration.salon, services: configuration.services };
  };
}
