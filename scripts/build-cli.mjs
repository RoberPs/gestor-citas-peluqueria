// `npm run build:cli` — the commands the image runs, one self-contained file
// each (deploy/README.md).
//
// The runtime stage of the image has no devDependencies, so `tsx` is not
// there to run the TypeScript scripts. Each one is bundled with everything it
// imports into `cli/<name>.mjs`. `migrate` finds its SQL files through
// `../src/infrastructure/db/migrations`, so the image puts them there, next to
// `cli/`.
//
//   node scripts/build-cli.mjs [--outdir <dir>]   (default: ./cli)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = {
  migrate: 'scripts/migrate.ts',
  'provision-owner': 'scripts/provision-owner.ts',
  'retention-purge': 'scripts/retention-purge.ts',
  'dispatch-notifications': 'scripts/dispatch-notifications.ts',
  'load-salon': 'scripts/load-salon.ts',
  'seed-demo': 'db/seed/demo.ts',
};

const flag = process.argv.indexOf('--outdir');
const outdir = path.resolve(flag === -1 ? path.join(ROOT, 'cli') : (process.argv[flag + 1] ?? ''));

await build({
  absWorkingDir: ROOT,
  entryPoints: Object.fromEntries(Object.entries(COMMANDS).map(([name, file]) => [name, path.join(ROOT, file)])),
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  // `pg` asks for its optional native binding only when told to use it.
  external: ['pg-native'],
  // CommonJS dependencies (`pg`, `pino`) still call `require` inside an ES module.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});

console.log(`built ${Object.keys(COMMANDS).length} command(s) into ${path.relative(ROOT, outdir) || '.'}`);
