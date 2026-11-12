import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract/host';

import { fontFoldersOf } from '../fontCatalogue.js';
import { readCatalogueApart } from '../fontCatalogueApart.js';
import { keepCatalogue } from '../keptCatalogue.js';
import { cryptoBytes } from '../token.js';
import { catalogueChannels } from './catalogueChannels.js';
import { catalogueFoldersOf } from './catalogueArguments.js';
import { createCatalogueHandlers } from './catalogueHandlers.js';
import { probeContainment } from './containment.js';
import type { HostArea } from './engineHandlers.js';
import { type HostByteStream, startEngineHost } from './hostBody.js';
import { createHostSessions } from './hostSessions.js';

/**
 * The catalogue host's handlers, composed and served on a pipe its launcher already connected
 * ([ADR-0293](../../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md)):
 * `composeHostServe.ts`' shape, through the one host body.
 *
 * The folders are the ones every host that sets text is handed, read by the same reader in a thread that ends
 * (`readCatalogueApart`), so what this host keeps is what each of them would have read.
 */
const { bundled, installed } = catalogueFoldersOf(process.argv);

const areas = createHostSessions<HostArea>(cryptoBytes);

const handlers = createCatalogueHandlers({
  areas,
  probe: probeContainment,
  keep: (outputDirectory, fingerprint) => keepCatalogue(outputDirectory, fingerprint, fontFoldersOf(bundled, installed), readCatalogueApart),
});

/** Serves the catalogue channels on `stream`, the pipe the launcher connected. Called once. */
export function serveCatalogue(stream: HostByteStream): void {
  startEngineHost(
    stream,
    {
      channels: catalogueChannels,
      handlers,
      // `composeHostServe.ts`' incidents: never the pipe, the inherited stderr handle.
      incidents: (incident) => {
        process.stderr.write(`MONSTERA_HOST_INCIDENT ${incident.id} on ${incident.channel}: ${JSON.stringify(incident.diagnostic)}\n`);
      },
      maxInFlight: ENGINE_HOST_MAX_IN_FLIGHT,
    },
    (reason) => {
      process.stderr.write(`MONSTERA_HOST_ENDED ${reason.code}: ${reason.detail}\n`);
      // A NON-ZERO EXIT for every ending, `hostEntry.ts`' reason: this process only ever stops because its connection did.
      process.exit(1);
    },
  );
}
