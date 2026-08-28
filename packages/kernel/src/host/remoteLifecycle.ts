import type { ClientApi } from '@monstera/contract';

import type { ByteImage, MupdfSession } from '../engineSeam.js';
import type { EngineChannels } from './engineChannels.js';
import type { RemoteSessions, SessionArea } from './remoteEngine.js';

/**
 * `EngineWriter`'s three lifecycle methods against a session an engine host
 * holds (ADR-0023 Decision 10, and Decision 7's verb split).
 *
 * `remoteEngine.ts` is the other half — running a command against a session
 * that already exists. This is how one comes to exist, how its bytes come back,
 * and how it stops existing.
 *
 * ## The images never touch the pipe
 *
 * `open(image)` writes the bytes into a directory the host may **read** and
 * hands over the path; `serialise` asks the host to write into a directory it
 * may **modify** and reads the file back. What crosses the pipe is a path, a
 * name and a count — which is Decision 7 in its own words: *intent and handles
 * cross, document images do not.*
 *
 * Invariant 11 is why this is not negotiable. A 20,000-page document's image is
 * hundreds of megabytes, and a `serialise` per checkpoint is a checkpoint per
 * operation — so the pipe would carry document-scaled bytes per operation. It
 * is not a rarity argument that saves this; it is that nothing crosses.
 *
 * ## Nothing the host says is joined to a path
 *
 * Main mints the output file name and sends it in the request, so the only
 * things arriving from the host are a session id and a byte count. A host that
 * could name the file main reads back could have main open an arbitrary path
 * and take the bytes as the user's document.
 *
 * ## The directories are created before the image is written, and removed on close
 *
 * Their lifetime is the session's, and the failure this closes is not subtle: a
 * snapshot that outlives its session is a copy of the user's document sitting
 * in a directory the contained host can read. `open` removes what it made if
 * anything after the creation fails, and `close` removes them whether or not
 * the host answered — a host that has gone away is exactly the case where the
 * files would otherwise be left.
 */

/** Why a remote lifecycle call failed. */
export class EngineOpenFailed extends Error {
  override readonly name = 'EngineOpenFailed';

  constructor(detail: string) {
    super(
      `The engine host could not open the handed image: ${detail}. This is the DOCUMENT's ` +
        'failure rather than the host\'s — a file that will never parse must not be counted as ' +
        'evidence that the host is unhealthy, or a rebuild-and-retry loop follows.',
    );
  }
}

export class EngineSerialiseFailed extends Error {
  override readonly name = 'EngineSerialiseFailed';

  constructor(detail: string) {
    super(`The engine host could not serialise the session: ${detail}.`);
  }
}

/** The host wrote a different number of bytes than the file main read back. */
export class EngineSerialiseMismatch extends Error {
  override readonly name = 'EngineSerialiseMismatch';

  constructor(claimed: number, read: number) {
    super(
      `The host reported writing ${String(claimed)} bytes and the file holds ${String(read)}. ` +
        'These are compared because they fail differently: a host that wrote nothing and a read ' +
        'that found nothing produce the same empty buffer, and only one of them is this side\'s ' +
        'problem.',
    );
  }
}

/**
 * The per-session directories, from whoever creates and grants them.
 *
 * `SessionArea` moved to `remoteEngine.ts` on 2026-08-28: the registry that
 * mints a token holds one now (ADR-0030 Decision 2), so the type belongs beside
 * the registry rather than beside a reader of it.
 */

/**
 * What this adapter needs from the host of the two directories.
 *
 * **`create` and `writeSnapshot` are gone**, and their absence is the decision.
 * Creating the pair and putting the document in it is the supervisor's, through
 * `writeCanonicalImage(supervisor, docId, destination)` — ADR-0023 Decision 14,
 * which refused an accessor on `DocumentService` because a second reference to
 * the image in main is 2.00× of file size against a 1.5× ceiling, measured.
 * This module used to call `writeSnapshot(area, name, image)`, which is that
 * route, and it predates the decision that refused it.
 *
 * What is left is what a *reader* of an existing session needs.
 */
export interface SessionAreaSurface {
  /** Reads back what the host wrote, then deletes it. */
  readonly takeOutput: (area: SessionArea, name: string) => Promise<ByteImage>;
  /** Removes both directories and everything under them. Must not throw. */
  readonly remove: (area: SessionArea) => Promise<void>;
  /**
   * A fresh name for a file inside a granted directory.
   *
   * Injected so a proof can make it deterministic, and because *what a handed
   * name may look like* is a rule the directory factory already owns — a second
   * spelling of it here would be the B3a defect (see `hostDacl.ts`'s note on
   * one resolver, two callers).
   */
  readonly mintName: () => string;
}

/**
 * What a session that already EXISTS supports: its bytes back, and its end.
 *
 * **No `open`.** A registered writer supplies `serialise` and the command
 * members and nothing else (ADR-0030 Decision 1), because those are what
 * `CommandBus` calls; a session comes into existence through the supervisor, in
 * the process that can create a contained host. Typing this as
 * `EngineWriter<MupdfSession>` is what forced an `open(image)` here that could
 * only be implemented the one way ADR-0023 Decision 14 had already refused.
 */
export interface RemoteMupdfLifecycle {
  /** The canonical bytes for the session's current state. */
  readonly serialise: (session: MupdfSession) => Promise<ByteImage>;
  /** Ends the session on the host and removes its granted pair. */
  readonly close: (session: MupdfSession) => Promise<void>;
}

/**
 * @param client the engine host's channels, through the contract's own
 *   validating client.
 * @param sessions main's token registry — the same one `remoteMupdfExecution`
 *   uses, so a token minted there is one this can read an area for.
 * @param areas how the granted directories are reached and removed.
 */
export function remoteMupdfLifecycle(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
  areas: SessionAreaSurface,
): RemoteMupdfLifecycle {
  return {
    serialise: async (session) => {
      const area = sessions.areaFor(session);
      const into = areas.mintName();
      const answer = await client['engine/serialise']({
        session: sessions.handleFor(session),
        into,
      });
      if (!answer.ok) throw new EngineSerialiseFailed(answer.error.code);

      const bytes = await areas.takeOutput(area, into);
      if (bytes.length !== answer.value.bytes) {
        throw new EngineSerialiseMismatch(answer.value.bytes, bytes.length);
      }
      return bytes;
    },

    close: async (session) => {
      // READ BEFORE THE CALL, because `release` below makes it unreadable and
      // the `finally` needs it. This is also the statement that used to throw
      // for every session the composition root opened — `close` read the
      // adapter's private map as its FIRST statement exactly as `serialise`
      // did, and the first write-up of that finding named `serialise` and
      // stopped there (ADR-0030 Decision 2).
      const area = sessions.areaFor(session);
      try {
        // The ANSWER is not checked, and that is deliberate: there is nothing
        // this side would do differently for a session the host has already
        // forgotten or a host that has died — both hold nothing.
        //
        // The `try` is not about the answer. It is about the CALL, which is a
        // different failure with a different shape: a handler that throws is
        // caught by `wrapHandler` and comes back as a Result, but a transport
        // that has gone — a dead host, a closed pipe, a call that will never be
        // answered — REJECTS. That is the only path between here and the
        // cleanup below, and it is precisely the case where the files would
        // otherwise be left on disk.
        await client['engine/close']({ session: sessions.handleFor(session) });
      } finally {
        sessions.release(session);
        await areas.remove(area);
      }
    },
  };
}
