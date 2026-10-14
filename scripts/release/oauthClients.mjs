// @ts-check
/**
 * Writes the cloud providers' OAuth client values into the package, as `resources/oauth-clients.json`
 * ([ADR-0091](../../docs/DECISIONS/0091-cloud-storage-a-declared-provider-a-build-configured-client-and-a-working-copy.md)
 * Decisions 2 and 3, and its 2026-10-14 correction).
 *
 * ## Why the package carries them
 *
 * They are DESKTOP clients: Microsoft's is a public client with no secret, and Google's *Desktop app* secret is one
 * Google's own documentation says an installed app cannot keep. Each person signs in with their own account; the
 * values only say which registration they are signing in to. 0.1.15.0 read them from the packager's environment at
 * RUN time, so cloud storage worked on the one PC that had those variables and said *Not available in this build*
 * everywhere else.
 *
 * ## The names are the shell's, never a second list
 *
 * `CLOUD_CLIENT_VARIABLES` in the desktop build's own `cloudClients.js` names them, and `readCloudClients` reads the
 * file back; this module imports both from the built `dist/`, so the writer and the reader cannot disagree (B3a).
 *
 * ## A value is never said
 *
 * Nothing here prints, logs or throws a value. A refusal names the VARIABLE that was empty.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{
 *   CLOUD_CLIENT_VARIABLES: Readonly<Record<string, { readonly id: string; readonly secret?: string }>>,
 *   PACKAGED_CLIENTS_FILE: string,
 *   readCloudClients: (env: Readonly<Record<string, string | undefined>>, packaged: Readonly<Record<string, unknown>> | null) => Readonly<Record<string, unknown>>,
 * }} CloudClientsModule
 */

/**
 * The desktop build's own module for the client values, after `npm run build`. A LITERAL SPECIFIER, so
 * `proof:electronimports` can read what this loads.
 *
 * @returns {Promise<CloudClientsModule>}
 */
export async function cloudClientsModule() {
  return /** @type {CloudClientsModule} */ (await import('../../apps/desktop/dist/cloudClients.js'));
}

/**
 * The file's contents, from `env`, and the variables that were empty.
 *
 * @param {CloudClientsModule} module
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {{ values: Record<string, string>, empty: string[] }}
 */
export function packagedClients(module, env) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const empty = [];
  for (const names of Object.values(module.CLOUD_CLIENT_VARIABLES)) {
    for (const name of [names.id, names.secret]) {
      if (name === undefined) continue;
      const value = env[name]?.trim() ?? '';
      if (value === '') empty.push(name);
      else values[name] = value;
    }
  }
  return { values, empty };
}

/**
 * Writes `oauth-clients.json` into the stage's `resources/`, refusing a Store build that lacks any value, and proves
 * the written file is read back as configured for every provider it carries.
 *
 * A TEST build without values is allowed — a contributor's — and the cloud commands are then hidden in it; it is said,
 * by variable name.
 *
 * @param {{ module: CloudClientsModule, env: Readonly<Record<string, string | undefined>>, resources: string,
 *   flavour: 'test' | 'store', say: (line: string) => void }} options
 * @returns {{ providers: string[] }} the providers the package can sign in to
 */
export function writePackagedClients({ module, env, resources, flavour, say }) {
  const { values, empty } = packagedClients(module, env);
  if (empty.length > 0 && flavour === 'store') {
    throw new Error(
      `A Store package must reach every cloud provider, and these build variables are empty: ${empty.join(', ')}. ` +
        'Set them in the packaging environment (ADR-0091 Decision 2); their values are never printed.',
    );
  }
  writeFileSync(join(resources, module.PACKAGED_CLIENTS_FILE), `${JSON.stringify(values, null, 2)}\n`);
  // READ BACK BY THE SHELL'S OWN READER, with an EMPTY environment — what a person's PC gives it.
  const read = module.readCloudClients({}, values);
  const providers = Object.entries(read)
    .filter(([, client]) => client !== null)
    .map(([provider]) => provider);
  if (flavour === 'store' && providers.length !== Object.keys(module.CLOUD_CLIENT_VARIABLES).length) {
    throw new Error(`The written ${module.PACKAGED_CLIENTS_FILE} reads back as configured for ${providers.join(', ') || 'no provider'} only.`);
  }
  say(
    empty.length === 0
      ? `  ${module.PACKAGED_CLIENTS_FILE}: ${providers.join(', ')}`
      : `  ${module.PACKAGED_CLIENTS_FILE}: ${providers.join(', ') || 'no provider'}; empty, so their commands are hidden: ${empty.join(', ')}`,
  );
  return { providers };
}
