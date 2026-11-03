import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONTRACT_NOW, seedContractDatabase } from './helpers/seed-contract-db';
import { expectMatchesContract, responseSchema } from './helpers/openapi';
import { closeTestDb } from '../integration/helpers/test-db';

// Every suite pins the clock: none of them depends on the hour it runs at.
vi.mock('@/infrastructure/time/system-clock', () => ({
  systemClock: { now: () => CONTRACT_NOW },
}));

const { GET } = await import('@/app/api/services/route');

const schema = responseSchema('/services', 'get', '200');

beforeAll(async () => {
  await seedContractDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

describe('GET /api/services', () => {
  it('answers 200 with a body shaped like the contract', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expectMatchesContract(schema, await response.json());
  });

  it('returns the catalogue with name, duration and price (FR-001)', async () => {
    const body = (await (await GET()).json()) as {
      services: { name: string; durationMinutes: number; priceCents: number | null }[];
    };

    expect(body.services.map((service) => service.name)).toEqual(['Corte', 'Color', 'Lavado']);
    expect(body.services[0]).toMatchObject({ durationMinutes: 30, priceCents: 1800 });
    expect(body.services[1]).toMatchObject({ durationMinutes: 90, priceCents: 5500 });
  });

  it('returns the salon details every screen shows, and its timezone label (FR-033)', async () => {
    const body = (await (await GET()).json()) as {
      salon: {
        name: string;
        address: string;
        phone: string;
        timezone: string;
        timezoneLabel: string;
      };
    };

    expect(body.salon.timezone).toBe('Europe/Madrid');
    expect(body.salon.timezoneLabel.length).toBeGreaterThan(0);
    expect(body.salon.phone.length).toBeGreaterThan(0);
  });

  it('carries no salon identifier anywhere: one salon per instance (asunción 11)', async () => {
    const body = (await (await GET()).json()) as { salon: Record<string, unknown> };

    expect(Object.keys(body.salon)).not.toContain('id');
  });
});

describe('a service without a price (005, FR-018, FR-019)', () => {
  it('has a null price, never 0, and says it is asked at the salon', async () => {
    const response = await GET();
    const body = (await response.clone().json()) as {
      services: { name: string; priceCents: number | null; priceLabel: string }[];
    };

    expectMatchesContract(schema, await response.json());
    expect(body.services.find((service) => service.name === 'Lavado')).toMatchObject({
      priceCents: null,
      priceLabel: 'Precio a consultar en el salón',
    });
    expect(body.services.find((service) => service.name === 'Corte')?.priceLabel).toBe('18,00 €');
  });
});
