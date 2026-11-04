import { describe, expect, it } from 'vitest';
import { createLogger } from '@/infrastructure/logging/logger';

/**
 * FR-036 and Principio III: name, phone and email never reach logs, traces or
 * analytics. Error traces are where personal data leaks most easily, so that is
 * what this exercises.
 */

const NAME = 'ZZTESTZZ Lopez';
const PHONE = '+34600112233';
const EMAIL = 'ana@example.com';
const TOKEN = 'kJ8x2mQvR7tY1pL4wN6bC3dF5gH9jK0mZxA2sD4fG6h';

function capture(): { lines: string[]; write(chunk: string): void } {
  const lines: string[] = [];
  return {
    lines,
    write(chunk: string) {
      lines.push(chunk);
    },
  };
}

function assertClean(output: string): void {
  expect(output).not.toContain(NAME);
  expect(output).not.toContain('ZZTESTZZ');
  expect(output).not.toContain(PHONE);
  expect(output).not.toContain('600112233');
  expect(output).not.toContain(EMAIL);
  expect(output).not.toContain(TOKEN);
}

describe('logger redaction', () => {
  it("redacts the bodies of the owner's appointments and of a conflict (002, FR-057, T070)", () => {
    const sink = capture();
    const log = createLogger(sink);

    log.warn(
      {
        body: { serviceIds: ['s1'], customer: { name: NAME, phone: PHONE, email: EMAIL } },
        conflict: { code: 'CONFLICT', conflicts: [{ kind: 'APPOINTMENT', customerName: NAME, serviceNames: ['Corte'] }] },
      },
      'owner change',
    );
    log.warn({ code: 'CONFLICT', conflicts: [{ id: 'a1', customerName: NAME }] }, 'conflict answered');

    const output = sink.lines.join('');
    expect(output).toContain('Corte');
    assertClean(output);
  });

  it('emits none of the four sensitive values from a top level error trace', () => {
    const sink = capture();
    const log = createLogger(sink);

    log.error(
      { appointmentId: 'b2e9…', name: NAME, phone: PHONE, email: EMAIL, token: TOKEN },
      'booking failed',
    );

    const output = sink.lines.join('');
    expect(output).toContain('booking failed');
    assertClean(output);
  });

  it('redacts them when nested under a customer object', () => {
    const sink = capture();
    const log = createLogger(sink);

    log.error(
      { appointmentId: 'b2e9…', customer: { name: NAME, phone: PHONE, email: EMAIL }, token: TOKEN },
      'slot taken',
    );

    assertClean(sink.lines.join(''));
  });

  it('redacts them two levels down, where a request payload usually sits', () => {
    const sink = capture();
    const log = createLogger(sink);

    log.error(
      { request: { body: { name: NAME, phone: PHONE, email: EMAIL, token: TOKEN } } },
      'validation failed',
    );

    assertClean(sink.lines.join(''));
  });

  it('redacts them when they ride along on a thrown error', () => {
    const sink = capture();
    const log = createLogger(sink);

    const failure = Object.assign(new Error('insert rejected'), {
      name: NAME,
      phone: PHONE,
      email: EMAIL,
      token: TOKEN,
    });

    log.error({ err: failure }, 'unexpected failure');

    assertClean(sink.lines.join(''));
  });

  it('redacts an outgoing email and the sealed links of its notification (004, D-006)', () => {
    const sink = capture();
    const log = createLogger(sink);
    const email = { to: EMAIL, subject: `Hola ${NAME}`, html: `<p>${NAME}</p>`, text: NAME };

    log.error({ notificationId: 'n1', ...email, sealedTokens: TOKEN }, 'send failed');
    log.error({ message: email, row: { sealedTokens: TOKEN } }, 'send failed nested');
    log.error({ request: { message: email } }, 'send failed deeper');

    const output = sink.lines.join('');
    expect(output).toContain('n1');
    assertClean(output);
  });

  it('still logs the internal identifier, which is what a trace is for', () => {
    const sink = capture();
    const log = createLogger(sink);

    log.error({ appointmentId: 'b2e9c0de', name: NAME }, 'booking failed');

    expect(sink.lines.join('')).toContain('b2e9c0de');
  });
});
