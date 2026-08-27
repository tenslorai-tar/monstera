import type { ClientApi } from '@monstera/contract';

import type { ByteImage, EngineWriter, MupdfSession } from '../engineSeam.js';
import type { EngineChannels } from './engineChannels.js';
import type { RemoteSessions } from './remoteEngine.js';

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
 * Injected as an interface rather than imported, and that is a boundary rather
 * than a preference: creating a directory with a DACL is Win32 work that lives
 * in `apps/desktop`, which `packages/kernel` may not import. It is also what
 * lets every case in this module's proof run against ordinary temp directories
 * with no container in sight.
 */
export interface SessionArea {
  /** The directory the host may READ. Main writes the canonical image here. */
  readonly snapshotDirectory: string;
  /** The directory the host may MODIFY. It writes serialised bytes here. */
  readonly outputDirectory: string;
}

/** What this adapter needs from the host of the two directories. */
export interface SessionAreaSurface {
  /**
   * Creates one session's granted pair.
   *
   * Called before any bytes are written, so a failure here has produced no copy
   * of the document.
   */
  readonly create: () => Promise<SessionArea>;
  /** Writes the canonical image into the snapshot directory under `name`. */
  readonly writeSnapshot: (area: SessionArea, name: string, image: ByteImage) => Promise<void>;
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
 * @param client the engine host's channels, through the contract's own
 *   validating client.
 * @param sessions main's token registry — the same one `remoteMupdfExecution`
 *   uses, so a token minted here is one that adapter can run commands against.
 * @param areas how the granted directories are made and reached.
 */
export function remoteMupdfLifecycle(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
  areas: SessionAreaSurface,
): EngineWriter<MupdfSession> {
  /** Which directories each live session's bytes travel through. */
  const held = new WeakMap<MupdfSession, SessionArea>();

  const areaFor = (session: MupdfSession): SessionArea => {
    const area = held.get(session);
    if (area === undefined) {
      // The same shape `handleFor` refuses, and for the same reason: a token
      // this registry never adopted, or one already released. Throwing beats
      // falling through to a path built from `undefined`.
      throw new Error(
        'This session token has no granted directories in this registry. It was not opened ' +
          'here, or it has already been closed.',
      );
    }
    return area;
  };

  return {
    open: async (image) => {
      const area = await areas.create();
      const snapshotName = areas.mintName();
      try {
        await areas.writeSnapshot(area, snapshotName, image);
        const answer = await client['engine/open']({
          snapshotDirectory: area.snapshotDirectory,
          snapshotName,
          outputDirectory: area.outputDirectory,
        });
        if (!answer.ok) throw new EngineOpenFailed(answer.error.code);

        const session = sessions.adopt(answer.value.session);
        held.set(session, area);
        return session;
      } catch (error) {
        // EVERY FAILURE AFTER THE CREATE REMOVES THE PAIR. By this point the
        // image may already be on disk, and the caller is about to be handed an
        // error rather than a session — so nothing else will ever remove it.
        await areas.remove(area);
        throw error;
      }
    },

    serialise: async (session) => {
      const area = areaFor(session);
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
      const area = areaFor(session);
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
        held.delete(session);
        sessions.release(session);
        await areas.remove(area);
      }
    },
  };
}
