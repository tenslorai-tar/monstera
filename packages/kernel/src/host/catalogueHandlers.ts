import type { Handlers } from '@monstera/contract';

import type { CatalogueChannels } from './catalogueChannels.js';
import type { ContainmentProbePaths, ContainmentReport } from './containment.js';
import type { HostArea, HostSessions } from './engineHandlers.js';

/** What the catalogue host's handlers are composed from: the areas it holds, its probe, and the one job it does. */
export interface CatalogueHandlerParts {
  readonly areas: HostSessions<HostArea>;
  readonly probe: (paths: ContainmentProbePaths) => Promise<ContainmentReport>;
  /** Reads the folders and writes the kept file into `outputDirectory` for `fingerprint`; answers the faces kept. */
  readonly keep: (outputDirectory: string, fingerprint: string) => number;
}

/**
 * The catalogue host's handlers ([ADR-0293](../../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)).
 * The probe, `open` and `close` are the compose host's three as they are (`composeHandlers.ts`): an area and nothing
 * else, since no document is ever here.
 */
export function createCatalogueHandlers({ areas, keep, probe }: CatalogueHandlerParts): Handlers<CatalogueChannels> {
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;
  return {
    // NO try/catch, `composeHandlers.ts`' reason: every outcome is already one of `ProbeOutcome`'s states.
    'engine/probe-containment': async ({ positive, negative, loopbackPort }) => ({
      ok: true,
      value: await probe({ positive, negative, loopbackPort }),
    }),

    'engine/open': ({ snapshotDirectory, outputDirectory }) =>
      Promise.resolve({
        ok: true,
        value: { session: areas.issue({ outputDirectory, snapshotDirectory }) },
      }),

    'engine/close': ({ session }) => {
      if (areas.lookup(session) === undefined) return Promise.resolve(gone);
      areas.forget(session);
      return Promise.resolve({ ok: true, value: {} });
    },

    // A READ THAT THROWS is a fault of this host, which the body reports as one; folders that held no face are an answer.
    'engine/keep-catalogue': ({ session, fingerprint }) => {
      const area = areas.lookup(session);
      if (area === undefined) return Promise.resolve(gone);
      const faces = keep(area.outputDirectory, fingerprint);
      return Promise.resolve(faces === 0 ? { ok: false, error: { code: 'no-faces' } } : { ok: true, value: { faces } });
    },
  };
}
