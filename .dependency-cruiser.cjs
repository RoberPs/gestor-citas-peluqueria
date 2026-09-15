/**
 * Mechanical check of Principio I: `src/domain` is pure TypeScript.
 * It knows nothing about the web framework, the database or any adapter.
 * CI runs `npm run check:layers` and a crossed boundary blocks the merge.
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment:
        'src/domain must not import React, Next, Drizzle, pg or anything from ' +
        'src/infrastructure. Move the dependency to infrastructure and pass the ' +
        'data in (Principio I).',
      from: { path: '^src/domain' },
      to: {
        path: [
          '^src/infrastructure',
          '^src/app/',
          '^src/components',
          'node_modules/(react|react-dom|next|drizzle-orm|drizzle-kit|pg|pino)(/|$)',
        ],
      },
    },
    {
      name: 'domain-knows-no-application',
      severity: 'error',
      comment: 'Dependencies point inwards: application -> domain, never the other way.',
      from: { path: '^src/domain' },
      to: { path: '^src/application' },
    },
    {
      name: 'application-has-no-framework',
      severity: 'error',
      comment:
        'Use cases orchestrate domain and ports. HTTP and the database live further out.',
      from: { path: '^src/application' },
      to: {
        path: [
          '^src/app/',
          '^src/components',
          '^src/infrastructure',
          'node_modules/(react|react-dom|next|drizzle-orm|pg)(/|$)',
        ],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make the layering unverifiable.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
