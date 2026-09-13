import { ENGINE_HOST_MAX_IN_FLIGHT } from '@monstera/contract';

import { composeMarkdown } from '../markdownCompose.js';
import { cryptoBytes } from '../token.js';
import { composeChannels } from './composeChannels.js';
import { createComposeHandlers } from './composeHandlers.js';
import { probeContainment } from './containment.js';
import type { HostArea } from './engineHandlers.js';
import { startEngineHost } from './hostBody.js';
import { hostFilesystem, hostPipeStream } from './hostNodeSurfaces.js';
import { createHostSessions } from './hostSessions.js';

/**
 * The **compose** host's entry point
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## The third entry through the one body
 *
 * `hostEntry.ts`' two statements, and PDFium's: compose this host's channels and
 * handlers, then start the body on the pipe named on the command line. The body,
 * the framing, the failure classification and the shutdown ordering are
 * `hostBody.ts`'s; the pipe and the filesystem are `hostNodeSurfaces.ts`'.
 *
 * ## What it runs, and why here
 *
 * A Markdown file a person picked is input its author chose (threat model §1.9),
 * and §2 keeps document parsing of any kind out of `main`. So `markdown-it` and the
 * layout that follows it run in this process, whose token is a container of its own
 * and whose ending affects no open document.
 *
 * ## Node mode
 *
 * Under `ELECTRON_RUN_AS_NODE=1` in a process `CreateProcessW` made (ADR-0024). It
 * lives in `packages/kernel` because its subject is document composition.
 */

/**
 * The pipe name, from the command line the factory built.
 *
 * Refused rather than defaulted, for `hostEntry.ts`' reason: a host that cannot find
 * its pipe has nothing to serve and nobody to tell, and a default would be a process
 * that starts, connects to something else, and looks alive.
 */
function pipeNameFrom(argv: readonly string[]): string {
  const [name] = argv.slice(2);
  if (name === undefined || name.length === 0) {
    throw new Error(
      'the compose host was started with no pipe name. Its first argument after the entry ' +
        'script is the full `\\\\.\\pipe\\…` name the factory minted; without it there is ' +
        'nothing to connect to.',
    );
  }
  return name;
}

const pipeName = pipeNameFrom(process.argv);

const handlers = createComposeHandlers({
  // AREAS, NOT SESSIONS. This host holds no parse between calls, and it holds the
  // granted directories anyway (ADR-0048 Decision 2): a call that carried its own
  // directories would be a channel through which a confused main could redirect
  // bytes.
  areas: createHostSessions<HostArea>(cryptoBytes),
  files: hostFilesystem,
  probe: probeContainment,
  composeMarkdown,
});

startEngineHost(
  hostPipeStream(pipeName),
  {
    channels: composeChannels,
    handlers,
    // Where a handler's thrown diagnostic goes. Never the pipe: main gets
    // `internal` and an id, and the text stays on this side — which is the
    // inherited stderr handle, the one channel a container cannot close.
    incidents: (incident) => {
      process.stderr.write(
        `MONSTERA_HOST_INCIDENT ${incident.id} on ${incident.channel}: ` +
          `${JSON.stringify(incident.diagnostic)}\n`,
      );
    },
    maxInFlight: ENGINE_HOST_MAX_IN_FLIGHT,
  },
  (reason) => {
    process.stderr.write(`MONSTERA_HOST_ENDED ${reason.code}: ${reason.detail}\n`);
    // A NON-ZERO EXIT for every ending, including the ordinary one, for
    // `hostEntry.ts`' reason: this process only ever stops because its
    // connection did.
    process.exit(1);
  },
);
