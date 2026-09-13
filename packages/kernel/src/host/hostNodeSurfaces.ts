import { readFile, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';

import type { HostFilesystem } from './engineHandlers.js';
import type { HostByteStream } from './hostBody.js';

/**
 * The two Node surfaces every host entry hands the body: its end of the pipe, and
 * the filesystem inside the directories it was granted.
 *
 * ## Shared at the THIRD caller, which is when this was said to happen
 *
 * `pdfiumHostEntry.ts` kept its own copy on purpose and said why: fifteen lines of
 * `node:net` with two decisions in them, shared between two entry points whose
 * whole purpose was to be two statements each, would be an abstraction with a copy
 * on either side of it — *if a third host arrives it will be the third caller,
 * which is the point at which a shared surface abstracts something real.* The
 * compose host is that caller
 * ([ADR-0060](../../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)),
 * so the pipe and the filesystem are defined here once and every entry takes them.
 *
 * ## Node mode
 *
 * Every importer runs under `ELECTRON_RUN_AS_NODE=1` in a process `CreateProcessW`
 * made (ADR-0024), which is why this lives beside the entries and imports nothing
 * of Electron's.
 */

/** The host's end of the pipe, as {@link HostByteStream}. */
export function hostPipeStream(pipeName: string): HostByteStream {
  const socket = connect({ path: pipeName });
  // NAGLE OFF. Frames here are small and request/response — a delayed ACK
  // waiting for a second frame that only arrives after this one is answered is
  // latency added to every call, and it would look like a slow engine.
  socket.setNoDelay(true);

  return {
    write: (bytes) => {
      socket.write(bytes);
    },
    onData: (sink) => {
      socket.on('data', (chunk: Buffer) => {
        sink(new Uint8Array(chunk));
      });
    },
    onEnd: (sink) => {
      // BOTH, and once. A pipe that closes cleanly emits `close` with no
      // `error`; one that breaks emits `error` then `close`. Listening to only
      // the first would hang this process on the ordinary ending, and to only
      // the second would lose the reason on the broken one.
      let reason = 'the pipe closed';
      socket.on('error', (error: NodeJS.ErrnoException) => {
        reason = `the pipe failed: ${error.code ?? error.message}`;
      });
      socket.once('close', () => {
        sink(reason);
      });
    },
    close: () => {
      socket.destroy();
    },
  };
}

/**
 * Reads and writes inside the directories main granted, by name.
 *
 * **Nothing here validates a path.** Main composed those directories and wrote
 * their DACLs, and this process reaches them because it was granted them — a
 * policy re-derived here would be a second opinion about a question the ACE
 * already answers (B3a).
 */
export const hostFilesystem: HostFilesystem = {
  readSnapshot: async (directory, name) => new Uint8Array(await readFile(join(directory, name))),
  writeOutput: async (directory, name, bytes) => {
    await writeFile(join(directory, name), bytes);
    return bytes.length;
  },
};
