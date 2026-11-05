import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../../db/seed/seed';
import { closeTestDb, ensureSchema } from '../helpers/test-db';

/**
 * The commands the image runs (deploy/README.md). The runtime stage has no
 * devDependencies, so no `tsx`: `npm run build:cli` bundles each command into
 * one self-contained `.mjs`, and the image lays them out as `cli/` next to the
 * migrations in `src/infrastructure/db/migrations`.
 *
 * Built here into a directory outside the repository, with that same layout,
 * so a bundle that still needed `node_modules` would fail to start.
 */

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '../../..');
const connectionString = process.env['DATABASE_URL_TEST'] ?? '';

let image = '';

/** Runs a bundled command as the container would, with nothing but the env file. */
async function cli(name: string, args: readonly string[] = [], extraEnv: Record<string, string> = {}) {
  const { NODE_PATH: _ignored, ...inherited } = process.env;
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join('cli', `${name}.mjs`), ...args], {
      cwd: image,
      env: { ...inherited, DATABASE_URL: connectionString, NOTIFICATIONS_EMAIL: 'off', ...extraEnv },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

beforeAll(async () => {
  await ensureSchema();
  await seed(connectionString, 'Europe/Madrid');

  image = await mkdtemp(path.join(tmpdir(), 'gestor-citas-image-'));
  await run(process.execPath, [path.join(ROOT, 'scripts', 'build-cli.mjs'), '--outdir', path.join(image, 'cli')], {
    cwd: ROOT,
  });
  await cp(
    path.join(ROOT, 'src', 'infrastructure', 'db', 'migrations'),
    path.join(image, 'src', 'infrastructure', 'db', 'migrations'),
    { recursive: true },
  );
}, 120_000);

afterAll(async () => {
  if (image !== '') await rm(image, { recursive: true, force: true });
  await closeTestDb();
});

describe('npm run build:cli', () => {
  it('builds one file per command and nothing else', async () => {
    expect((await readdir(path.join(image, 'cli'))).sort()).toEqual([
      'dispatch-notifications.mjs',
      'load-salon.mjs',
      'migrate.mjs',
      'provision-owner.mjs',
      'retention-purge.mjs',
      'seed-demo.mjs',
    ]);
  });

  it('migrate finds the migrations next to it and applies nothing twice', async () => {
    const outcome = await cli('migrate');

    expect(outcome.stderr).toBe('');
    expect(outcome).toMatchObject({ code: 0, stdout: 'No pending migrations.\n' });
  });

  it('retention-purge runs its dry run', async () => {
    const outcome = await cli('retention-purge', ['--dry-run']);

    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toMatch(/^would anonymise \d+ appointment\(s\) older than /);
  });

  it('dispatch-notifications reads the environment and says when the channel is off', async () => {
    const outcome = await cli('dispatch-notifications');

    expect(outcome).toMatchObject({ code: 0 });
    expect(outcome.stdout).toContain('the email channel is off');
  });

  it('load-salon checks a file read from standard input, as `exec -T … - < salon.json` sends it', async () => {
    const { NODE_PATH: _ignored, ...inherited } = process.env;
    const child = execFile(process.execPath, [path.join('cli', 'load-salon.mjs'), '-', '--dry-run'], {
      cwd: image,
      env: { ...inherited, DATABASE_URL: connectionString },
    });
    let stdout = '';
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.stdin?.end(await readFile(path.join(ROOT, 'deploy', 'salon.example.json')));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));

    expect(code).toBe(0);
    expect(stdout).toContain('The file is valid. Peluquería de Caballeros Niza: 11 opening stretch(es), 4 service(s)');
  });

  it('provision-owner refuses to run without a username, with a non-zero code', async () => {
    const outcome = await cli('provision-owner', [], { OWNER_USERNAME: '', OWNER_INITIAL_PASSWORD: '' });

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toContain('OWNER_USERNAME is not set.');
  });
});
