import type { HostArea, HostFilesystem, HostSessions } from './engineHandlers.js';
import type { RuntimeFileAnswers } from './runtime.js';

/**
 * Where an engine host writes a file-routed answer: the granted output directory of the session the request names
 * ([ADR-0125](../../../../docs/DECISIONS/0125-an-answer-that-grows-with-the-document-crosses-in-a-file.md)).
 *
 * ONE RESOLUTION FOR EVERY HOST, taken by each entry with its own table: the MuPDF host's sessions and the PDFium
 * host's areas are both {@link HostArea}s by that type's bound, so *which directory* is one rule — the one a byte-image
 * `serialise` already follows — and not a copy per entry. The runtime knows no session (ADR-0048); the entry does, and
 * hands this over.
 *
 * Every file-routed channel is a session channel, and its params were validated before its handler answered, so a
 * missing session here means the session was forgotten between the answer and the write — a close racing a read.
 * That throws, and the runtime ends the connection as it does for an answer it cannot frame, because the answer
 * cannot be delivered anywhere main will look.
 *
 * @param sessions the host's table, looked up by the id the request carries
 * @param files the host's filesystem, which writes only into directories it was handed
 */
export function sessionFileAnswers<TEntry extends HostArea>(
  sessions: Pick<HostSessions<TEntry>, 'lookup'>,
  files: Pick<HostFilesystem, 'writeOutput' | 'readSnapshot'>,
): RuntimeFileAnswers {
  return {
    // THE SNAPSHOT DIRECTORY, the one this host may only read: a file-requested call's params arrive by the door the
    // document and an asset arrive by (ADR-0044, ADR-0125's addendum).
    read: async (session, name) => {
      const held = sessions.lookup(session);
      if (held === undefined) throw new Error('the session these params belong to is not held');
      return files.readSnapshot(held.snapshotDirectory, name);
    },
    write: async (params, name, bytes) => {
      const session = (params as { readonly session?: unknown } | null)?.session;
      if (typeof session !== 'string') {
        throw new Error('a file-routed answer was asked for by a call that names no session');
      }
      const held = sessions.lookup(session);
      if (held === undefined) throw new Error('the session this answer belongs to is no longer held');
      return files.writeOutput(held.outputDirectory, name, bytes);
    },
  };
}
