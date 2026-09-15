import { container } from '@/app/_lib/container';
import { jsonOk } from '../_lib/responses';
import { salonInfo, serviceDto } from '../_lib/serializers';

export const dynamic = 'force-dynamic';

/** FR-001: the catalogue, with the salon details the confirmation screen shows. */
export async function GET(): Promise<Response> {
  const catalogue = await container().listServices();

  return jsonOk({
    salon: salonInfo(catalogue.salon),
    services: catalogue.services.map(serviceDto),
  });
}
