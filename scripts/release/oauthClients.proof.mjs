// @ts-check
/**
 * Proof that a packaged build carries the cloud client values and reads them back, and that a Store build without
 * them is not made (rule B2; ADR-0091, corrected 2026-10-14).
 *
 * The writer and the reader are the shell's own (`apps/desktop/dist/cloudClients.js`), so this needs `npm run build`.
 * The values are made up here; the load-bearing case reads the written file back through `packagedCloudClients` and
 * `readCloudClients` with an EMPTY environment — a person's PC — which is the path 0.1.15.0 never took.
 *
 * Usage: node scripts/release/oauthClients.proof.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRoster } from '../lib/passRoster.mjs';
import { cloudClientsModule, writePackagedClients } from './oauthClients.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const module = await cloudClientsModule(ROOT);
/** @type {{ packagedCloudClients: (read: string | null) => Readonly<Record<string, string>> | null }} */
const shell = await import(pathToFileURL(join(ROOT, 'apps', 'desktop', 'dist', 'cloudClients.js')).href);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 5 });
/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const VALUES = {
  MONSTERA_MS_CLIENT_ID: 'made-up-microsoft-id',
  MONSTERA_GOOGLE_CLIENT_ID: 'made-up-google-id',
  MONSTERA_GOOGLE_CLIENT_SECRET: 'made-up-google-secret',
};
const quiet = () => undefined;
const workspace = mkdtempSync(join(tmpdir(), 'monstera-oauthclients-'));

try {
  // ---------------------------------------------------------------- the path a person's PC takes
  const store = mkdtempSync(join(workspace, 'store-'));
  writePackagedClients({ module, env: VALUES, resources: store, flavour: 'store', say: quiet });
  const read = shell.packagedCloudClients(readFileSync(join(store, module.PACKAGED_CLIENTS_FILE), 'utf8'));
  const clients = module.readCloudClients({}, read);
  check(
    'a Store package carries both providers, read back by the shell with an EMPTY environment',
    Object.values(clients).every((client) => client !== null) && Object.keys(clients).length === 2,
    `read back ${JSON.stringify(Object.keys(clients).filter((provider) => clients[provider] !== null))}`,
  );
  check(
    "CONTROL: the same reader with no packaged file — 0.1.15.0's path — reaches no provider",
    Object.values(module.readCloudClients({}, shell.packagedCloudClients(null))).every((client) => client === null),
    'a provider was reached with nothing packaged, so the case above would pass without the file',
  );

  // ---------------------------------------------------------------- a Store package without a value is refused
  let refusal = '';
  try {
    writePackagedClients({
      module,
      env: { ...VALUES, MONSTERA_GOOGLE_CLIENT_SECRET: ' ' },
      resources: mkdtempSync(join(workspace, 'refused-')),
      flavour: 'store',
      say: quiet,
    });
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  check(
    'a Store package with a value missing is refused, naming the VARIABLE and no value',
    refusal.includes('MONSTERA_GOOGLE_CLIENT_SECRET') && !Object.values(VALUES).some((value) => refusal.includes(value)),
    `refused with: ${refusal || '(nothing: it was built)'}`,
  );

  // ---------------------------------------------------------------- a contributor's test build
  const test = mkdtempSync(join(workspace, 'test-'));
  /** @type {string[]} */
  const said = [];
  const { providers } = writePackagedClients({ module, env: {}, resources: test, flavour: 'test', say: (line) => said.push(line) });
  check(
    'a test build without values is made, reaches no provider, and says which variables were empty',
    providers.length === 0 && said.some((line) => line.includes('MONSTERA_MS_CLIENT_ID')),
    `providers ${JSON.stringify(providers)}; said ${JSON.stringify(said)}`,
  );

  let damaged = false;
  try {
    shell.packagedCloudClients('[1, 2]');
  } catch {
    damaged = true;
  }
  check('a packaged file that is not an object of values is refused, never read as no values', damaged, 'a damaged file read as an empty one');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\nOAuth-clients proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
  process.exit(1);
}
process.stdout.write(roster.format('OAuth-clients case'));
