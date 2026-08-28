import type { ClientApi, CommandOfKind } from '@monstera/contract';

import type { CommandExecution, KindsRoutedTo } from '../commandSpecs.js';
import type { CaptureResult, CommandPrior } from '../commandLog.js';
import type { MupdfSession } from '../engineSeam.js';
import type { EngineChannels } from './engineChannels.js';

/**
 * Running commands against a session an engine host holds (ADR-0023 Decision
 * 10, second half).
 *
 * `localMupdfExecution` looks a spec up and calls it against a document in this
 * process. This one sends the command and the **host's** local execution
 * performs that same lookup against its own live session — one implementation
 * per command, executed where the session is, rather than two opinions about
 * what a command means (B3a).
 */

/** The host no longer holds this session. */
export class EngineSessionGone extends Error {
  override readonly name = 'EngineSessionGone';

  constructor(channel: string) {
    super(
      `The engine host does not hold this session (${channel}). A host that died and was ` +
        'rebuilt holds none of the sessions the previous one minted, so this is an outcome the ' +
        'supervisor answers with a rebuild rather than a defect.',
    );
  }
}

/** A call the host refused for a reason this side did not declare. */
export class EngineCallFailed extends Error {
  override readonly name = 'EngineCallFailed';

  constructor(channel: string, code: string) {
    super(`The engine host refused ${channel}: ${code}`);
  }
}

/**
 * Main's side of session identity (ADR-0023 Decision 10b).
 *
 * **The host mints and owns the identity; main holds a token it cannot
 * dereference.** The wire handle lives in a `WeakMap` *beside* the token rather
 * than on it, which is `mupdfWriter`'s shape and for the same two reasons: a
 * structural `{ engine: 'mupdf' }` satisfies `MupdfSession`, so provenance has
 * to be map membership rather than a property; and a token that has been
 * released is still a valid token, which a brand cannot express and a map can.
 *
 * A main-side object carrying the handle as a field would be the alternative,
 * and it is the one Decision 10b names as wrong: two writers of one identity,
 * with main free to construct a handle the host never issued.
 */
export interface RemoteSessions {
  /**
   * Records a handle the host issued **and the area its bytes travel through**,
   * returning the token main holds.
   *
   * The area arrives here rather than being kept by whoever opened, because a
   * token stands for both halves and one registry has to own the pair
   * ([ADR-0030](../../../../docs/DECISIONS/0030-a-remote-writer-does-not-open-from-an-image.md)
   * Decision 2). `remoteMupdfLifecycle` kept it in a module-private `WeakMap`
   * populated only inside its own `open`, so a session opened anywhere else —
   * which is where every session now comes from — threw from `serialise` **and**
   * from `close`, each on its first statement.
   */
  readonly adopt: (handle: string, area: SessionArea) => MupdfSession;
  /** The handle behind a token this registry adopted and has not released. */
  readonly handleFor: (session: MupdfSession) => string;
  /** The granted directories behind that token. Same lifetime, same refusal. */
  readonly areaFor: (session: MupdfSession) => SessionArea;
  /** Forgets a token. A later call through it is refused rather than reusing a handle. */
  readonly release: (session: MupdfSession) => void;
}

/**
 * The per-session directories, from whoever creates and grants them.
 *
 * Injected as an interface rather than imported, and that is a boundary rather
 * than a preference: creating a directory with a DACL is Win32 work that lives
 * in `apps/desktop`, which `packages/kernel` may not import. It is also what
 * lets every case in this module's proof run against ordinary temp directories
 * with no container in sight.
 *
 * Declared here rather than beside the lifecycle that reads it, because the
 * registry above is what holds one now.
 */
export interface SessionArea {
  /** The directory the host may READ. Main writes the canonical image here. */
  readonly snapshotDirectory: string;
  /** The directory the host may MODIFY. It writes serialised bytes here. */
  readonly outputDirectory: string;
}

/** A token whose handle this registry does not hold. */
export class UnknownRemoteSession extends Error {
  override readonly name = 'UnknownRemoteSession';

  constructor() {
    super(
      'This session token was not adopted by this registry, or it has already been released. ' +
        'Tokens are minted from a handle the host issued and are not transferable between hosts.',
    );
  }
}

/**
 * @returns a registry with no sessions in it.
 */
export function createRemoteSessions(): RemoteSessions {
  const held = new WeakMap<MupdfSession, { handle: string; area: SessionArea }>();
  return {
    adopt: (handle, area) => {
      // The same mint `mupdfWriter.open` makes, and the same reason it is a cast
      // rather than a constructor: the brand exists so nothing outside an
      // adapter can produce one, and an exported mint would be exactly that.
      const session = { engine: 'mupdf' } as MupdfSession;
      held.set(session, { handle, area });
      return session;
    },
    handleFor: (session) => {
      const entry = held.get(session);
      if (entry === undefined) throw new UnknownRemoteSession();
      return entry.handle;
    },
    areaFor: (session) => {
      // ONE REFUSAL FOR ONE IDENTITY. A token whose handle this registry does
      // not hold has no area either, and the two answering differently is how a
      // session becomes valid for one operation and not another.
      const entry = held.get(session);
      if (entry === undefined) throw new UnknownRemoteSession();
      return entry.area;
    },
    release: (session) => {
      held.delete(session);
    },
  };
}

/**
 * @param client the engine host's channels, through the contract's own
 *   validating client — so a malformed answer is rejected at the boundary
 *   wrapper rather than by a second parse here (B3a).
 * @param sessions main's token registry.
 */
export function remoteMupdfExecution(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): CommandExecution<'mupdf'> {
  /** Unwraps a `Result`, turning a declared failure into a named throw. */
  const answered = <T>(channel: string, result: { ok: true; value: T } | { ok: false; error: { code: string } }): T => {
    if (result.ok) return result.value;
    if (result.error.code === 'no-such-session') throw new EngineSessionGone(channel);
    throw new EngineCallFailed(channel, result.error.code);
  };

  return {
    apply: async (session, command) => {
      answered(
        'engine/apply',
        await client['engine/apply']({ session: sessions.handleFor(session), command }),
      );
    },

    capture: async <K extends KindsRoutedTo<'mupdf'>>(
      session: MupdfSession,
      command: CommandOfKind<K>,
    ): Promise<CaptureResult<CommandPrior[K]>> => {
      const answer = answered(
        'engine/capture',
        await client['engine/capture']({ session: sessions.handleFor(session), command }),
      );
      if (!answer.captured) return { captured: false, reason: answer.reason };

      // NO TAG CHECK HERE, AND THAT IS A MEASURED ABSENCE RATHER THAN AN
      // OVERSIGHT. One was written — *the peer answered a different question* —
      // and lint reported it as a comparison that is always false: `mupdf`
      // routes exactly ONE kind, so a schema-valid response can only carry that
      // tag and the branch is unreachable. A disable would have been a rule
      // turned off to keep a check that checks nothing.
      //
      // What guards this today is the type system, and it guards it in the
      // right direction. `CommandPrior[K]` resolves because `K` is constrained
      // to one literal; the day a second command is routed to this writer, this
      // line **stops compiling**, and that is where the narrowing and its
      // runtime tag check get written — arriving at the moment the path becomes
      // reachable rather than sitting green until then.
      //
      // The tag stays ON THE WIRE regardless, and is not dead weight: a bare
      // array would make the second kind a breaking wire change instead of a
      // union widening, and the discriminator is what lets a response be
      // validated on its own terms rather than against the request the
      // correlation id points at.
      return { captured: true, prior: answer.value.prior };
    },

    invert: async <K extends KindsRoutedTo<'mupdf'>>(
      session: MupdfSession,
      kind: K,
      inverse: CommandPrior[K],
    ): Promise<void> => {
      answered(
        'engine/invert',
        await client['engine/invert']({
          session: sessions.handleFor(session),
          // No cast: `kind` and `inverse` are bound to the same `K` in the
          // signature, and the wire schema's `.readonly()` makes its inferred
          // type the same one `CommandPrior` states — so the pair type-checks
          // rather than being asserted. It did NOT before that `.readonly()`,
          // and the cast it needed read as a formality while being the only
          // thing standing between two types that differed.
          inverse: { kind, prior: inverse },
        }),
      );
    },
  };
}
