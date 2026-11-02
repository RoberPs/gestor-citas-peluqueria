import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The responsive widths are defined once (003, FR-006, D-006).
 *
 * Media queries cannot read CSS variables, so "once" cannot be enforced by the
 * stylesheet itself: this test is the guarantee. Any new screen — the owner's
 * ones included — reuses the same two widths and the same layout classes.
 */

const css = readFileSync(
  fileURLToPath(new URL('../../../src/app/globals.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

const ALLOWED_MEDIA = ['(min-width: 640px)', '(min-width: 1024px)'];

describe('layout breakpoints (D-006)', () => {
  it('uses only the two agreed min-width media queries', () => {
    const queries = [...css.matchAll(/@media\s+([^{]+)\{/g)].map((match) =>
      (match[1] ?? '').trim(),
    );

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.filter((query) => !ALLOWED_MEDIA.includes(query))).toEqual([]);
  });

  it('never reorders content visually (FR-015)', () => {
    expect(css).not.toMatch(/(^|[\s;{])order\s*:/);
  });

  it.each(['.page--split', '.site-header--split', '.col-main', '.col-side', '.wide-only'])(
    'defines the layout class %s',
    (selector) => {
      expect(css).toContain(selector);
    },
  );
});
