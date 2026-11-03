import type { ReactNode } from 'react';
import { durationLabel } from '@/app/_lib/format';
import type { PriceTotalDto, ServiceDto } from '@/app/api/_lib/serializers';
import { messages } from '@/messages/es-ES';

/**
 * The services of an appointment inside a `dl.summary`, with their total
 * duration and total price (005, FR-013). One component for the summary before
 * confirming, the confirmation and the link, so the three cannot disagree.
 *
 * Presentation only: the duration and the price arrive already decided by the
 * domain, and each price already written out. What goes between the services
 * and the totals — the day and the hour — is the caller's, so the rows keep
 * the order they had in 001.
 *
 * With one service it reads exactly as in 001: "Servicio", and its name.
 */
export function ServiceSummary({
  services,
  durationMinutes,
  price,
  children,
}: {
  readonly services: readonly ServiceDto[];
  readonly durationMinutes: number;
  readonly price: PriceTotalDto;
  readonly children?: ReactNode;
}) {
  const [only] = services;

  return (
    <>
      {services.length === 1 && only !== undefined ? (
        <>
          <dt>{messages.booking.summaryService}</dt>
          <dd>{only.name}</dd>
        </>
      ) : (
        <>
          <dt>{messages.booking.summaryServices}</dt>
          <dd>
            <ul className="summary-services">
              {services.map((service) => (
                <li key={service.id}>
                  {service.name} · {durationLabel(service.durationMinutes)} · {service.priceLabel}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}

      {children}

      <dt>{messages.booking.summaryDuration}</dt>
      <dd>{durationLabel(durationMinutes)}</dd>

      <dt>{messages.booking.summaryPrice}</dt>
      <dd>{price.label}</dd>
    </>
  );
}
