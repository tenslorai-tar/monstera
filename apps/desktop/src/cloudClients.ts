import { CLOUD_PROVIDER_IDS, type CloudProviderId } from '@monstera/contract';
import type { CloudClient } from '@monstera/kernel';

/**
 * Where a cloud provider's OAuth client values come from
 * ([ADR-0091](../../../docs/DECISIONS/0091-cloud-storage-a-declared-provider-a-build-configured-client-and-a-working-copy.md)
 * Decision 2): build configuration, never source.
 *
 * ## Two places, one set of names
 *
 * A development run reads the environment. A packaged build reads `oauth-clients.json` from its
 * resources, which the packaging step writes from the packager's environment under the SAME names
 * — so there is one list of names and no second spelling. The environment wins where both exist,
 * so a developer can point a packaged build at another registration.
 *
 * ## The values are never said
 *
 * Nothing here logs, throws or returns a message containing a value. A provider whose values are
 * absent is `null` — *not configured in this build* — and the reason is the absence, which needs
 * no value to state.
 */

/** Each provider's variable names. Google's Desktop client carries a secret Google declares non-confidential. */
export const CLOUD_CLIENT_VARIABLES: Readonly<
  Record<CloudProviderId, { readonly id: string; readonly secret?: string }>
> = {
  onedrive: { id: 'MONSTERA_MS_CLIENT_ID' },
  'google-drive': { id: 'MONSTERA_GOOGLE_CLIENT_ID', secret: 'MONSTERA_GOOGLE_CLIENT_SECRET' },
};

/** The packaged file's name in the build's resources. */
export const PACKAGED_CLIENTS_FILE = 'oauth-clients.json';

/** A value from the environment, then the packaged file; blank is absent. */
function valueOf(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  packaged: Readonly<Record<string, unknown>> | null,
): string | null {
  const fromEnv = env[name]?.trim() ?? '';
  if (fromEnv !== '') return fromEnv;
  const fromFile = packaged?.[name];
  return typeof fromFile === 'string' && fromFile.trim() !== '' ? fromFile.trim() : null;
}

/**
 * Every provider's client, or `null` where this build carries none.
 *
 * @param packaged the parsed `oauth-clients.json`, or `null` where there is none — a development
 *   run, and every build until Stage 10's packaging writes it
 */
export function readCloudClients(
  env: Readonly<Record<string, string | undefined>>,
  packaged: Readonly<Record<string, unknown>> | null,
): Readonly<Record<CloudProviderId, CloudClient | null>> {
  const entries = CLOUD_PROVIDER_IDS.map((provider): [CloudProviderId, CloudClient | null] => {
    const names = CLOUD_CLIENT_VARIABLES[provider];
    const clientId = valueOf(names.id, env, packaged);
    if (clientId === null) return [provider, null];
    const clientSecret = names.secret === undefined ? null : valueOf(names.secret, env, packaged);
    return [provider, clientSecret === null ? { clientId } : { clientId, clientSecret }];
  });
  return Object.fromEntries(entries) as Record<CloudProviderId, CloudClient | null>;
}
