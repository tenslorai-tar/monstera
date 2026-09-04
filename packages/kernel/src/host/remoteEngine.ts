import type { ClientApi, Command, CommandOfKind } from '@monstera/contract';

import type { CommandExecution, KindsRoutedTo } from '../commandSpecs.js';
import type { CaptureResult, CommandPrior } from '../commandLog.js';
import type { MupdfSession } from '../engineSeam.js';
import type { DuplicatePageGroup } from '../pageDuplicates.js';
import type { PageGeometryReader } from '../pageGeometry.js';
import { type EngineChannels, taggedPrior } from './engineChannels.js';
import type {
  HostDestinationsReader,
  HostLayersReader,
  HostPageLinksReader,
  HostPageTextReader,
} from './engineHandlers.js';

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
 * Unwraps a `Result`, turning a declared failure into a named throw.
 *
 * At module scope because a **second** caller arrived — the geometry reader
 * below — and a private copy in each would be two opinions about which code the
 * supervisor may act on. `no-such-session` is the one the supervisor rebuilds
 * for (Decision 9), so the mapping from a code to a class is exactly the kind of
 * rule B3a says lives once with callers.
 *
 * @param channel the channel name, carried into the throw so a failure names
 *   what was asked rather than only what went wrong.
 */
function answered<T>(
  channel: string,
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (result.ok) return result.value;
  if (result.error.code === 'no-such-session') throw new EngineSessionGone(channel);
  throw new EngineCallFailed(channel, result.error.code);
}

/**
 * Reading a session's page geometry from the process that holds it.
 *
 * A sibling of {@link remoteMupdfExecution} rather than a member of it, and the
 * split is ADR-0030 Decision 1's: a registered writer carries `serialise` plus
 * the command members **because those are what `CommandBus` calls**. Nothing in
 * the bus reads geometry — it is a query (§2, *"reads are queries"*) — so
 * putting it on the writer would widen the one type whose membership rule is
 * *the bus calls this*.
 *
 * @param client the engine host's channels, through the contract's own
 *   validating client — so a malformed answer is rejected at the boundary
 *   wrapper rather than by a second parse here (B3a).
 * @param sessions main's token registry.
 */
export function remoteMupdfGeometry(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): PageGeometryReader {
  return async (session, pages) =>
    answered(
      'engine/page-geometry',
      await client['engine/page-geometry']({ session: sessions.handleFor(session), pages }),
    );
}

/**
 * Reading one page's structured text from the process that holds the session.
 *
 * {@link remoteMupdfGeometry}'s sibling, for the same reason and by the same
 * split: text is a query, so it does not belong on the writer whose membership
 * rule is *the bus calls this*.
 *
 * **It returns the JSON rather than a parsed page.** `parsePageText` runs in
 * main, on a string this host produced, so there is exactly one reader of
 * MuPDF's format in the application and none of it is in the hostile process.
 *
 * @param client the engine host's channels, through the contract's own
 *   validating client — so a malformed answer is rejected at the boundary
 *   wrapper rather than by a second parse here (B3a).
 * @param sessions main's token registry.
 */
export function remoteMupdfPageText(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): HostPageTextReader {
  return async (session, page) =>
    answered(
      'engine/page-text',
      await client['engine/page-text']({ session: sessions.handleFor(session), page }),
    ).json;
}

/**
 * One page's links, over the boundary.
 *
 * The sibling of {@link remoteMupdfPageText}, and it returns the shape rather
 * than a string for the reason the channel gives: a link is not a format
 * anybody owns, so there is nothing to keep a second reader away from.
 *
 * @param client the engine host's channels, through the contract's own
 *   validating client — so a malformed answer is rejected at the boundary
 *   wrapper rather than by a second parse here (B3a).
 * @param sessions main's token registry.
 */
export function remoteMupdfPageLinks(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): HostPageLinksReader {
  return async (session, page) =>
    answered(
      'engine/page-links',
      await client['engine/page-links']({ session: sessions.handleFor(session), page }),
    ).links;
}

/**
 * The document's outline, over the boundary.
 *
 * @param client the engine host's channels, through the contract's own
 *   validating client.
 * @param sessions main's token registry.
 */
export function remoteMupdfDestinations(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): HostDestinationsReader {
  return async (session) =>
    answered(
      'engine/destinations',
      await client['engine/destinations']({ session: sessions.handleFor(session) }),
    ).destinations;
}

/** The document's layers, over the boundary. See {@link remoteMupdfDestinations}. */
export function remoteMupdfLayers(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): HostLayersReader {
  return async (session) =>
    answered(
      'engine/layers',
      await client['engine/layers']({ session: sessions.handleFor(session) }),
    ).layers;
}

/**
 * The document's duplicate pages, over the boundary.
 *
 * **The truncation flag is dropped here, deliberately**, and that is not a loss
 * of information: this returns the reader shape the composition point expects,
 * and the flag is the CHANNEL's. `DocumentCommands` reads it from the same
 * answer through `remoteMupdfDuplicateReport` below — one call, two consumers,
 * rather than a second round trip for a boolean.
 */
export function remoteMupdfDuplicateReport(
  client: ClientApi<EngineChannels>,
  sessions: RemoteSessions,
): (session: MupdfSession) => Promise<{
  readonly groups: readonly DuplicatePageGroup[];
  readonly truncated: boolean;
}> {
  return async (session) => {
    const answer = answered(
      'engine/duplicate-pages',
      await client['engine/duplicate-pages']({ session: sessions.handleFor(session) }),
    );
    return { groups: answer.groups, truncated: answer.truncated };
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

      // THE TAG CHECK, WRITTEN THE DAY ITS TRIGGER FIRED — 2026-09-03.
      //
      // This block used to say there was none, and said exactly why: `mupdf`
      // routed one kind, so a schema-valid response could only carry that tag,
      // lint reported the comparison as always false, and a disable would have
      // been a rule turned off to keep a check that checks nothing. It ended:
      // *the day a second command is routed to this writer, this line stops
      // compiling, and that is where the narrowing and its runtime tag check
      // get written.*
      //
      // `setLayerVisibility` is that second command and the line did stop
      // compiling. The deferral is recorded here rather than removed, because a
      // trigger that fired as written is the evidence the shape was right — and
      // the shape is the transferable part: state the condition, put it where
      // the compiler will raise it, and let it arrive when the path becomes
      // reachable rather than sitting green until then.
      //
      // The check is not a formality now. Two kinds can be tagged, so a peer
      // that answered the wrong one produces prior state of the wrong shape,
      // and the inverse built from it would restore something that was never
      // captured.
      // WIDENED TO READ ITS OWN TAG, and the reason arrived with the second
      // writer of record. `CommandOfKind<K>` is `Extract<Command, { kind: K }>`;
      // while `KindsRoutedTo<'mupdf'>` was every kind, the checker resolved that
      // far enough to expose `kind`, and now that it is a proper subset the
      // conditional stays deferred and the property is unreadable. Nothing about
      // the value changed — every `Command` carries a `kind` — so this restates
      // the constraint rather than escaping it.
      const { kind } = command as Command;
      if (answer.value.kind !== kind) {
        throw new Error(
          `engine/capture answered prior state tagged "${answer.value.kind}" for a ` +
            `"${kind}" command. The peer answered a different question, and prior state ` +
            `of the wrong shape would build an inverse that restores something nobody captured.`,
        );
      }

      // NARROWED BY THE CHECK ABOVE, which the checker cannot follow: the tag
      // and `K` are correlated through a comparison rather than through a
      // discriminant it can distribute over. The assertion is what that check
      // earns, and it is one line below the thing that establishes it.
      return { captured: true, prior: answer.value.prior as CommandPrior[K] };
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
          // THROUGH `taggedPrior` SINCE 2026-09-03, and the reason the object
          // literal stopped working is worth keeping.
          //
          // This used to say *no cast*: `kind` and `inverse` are bound to the
          // same `K`, and the wire schema's `.readonly()` made its inferred
          // type the one `CommandPrior` states, so the pair type-checked. Both
          // halves of that are still true and they are no longer sufficient —
          // with two kinds, `{ kind, prior }` is an object whose fields are
          // widened independently, and TypeScript cannot see that they came
          // from one `K`.
          //
          // The correlation is asserted in one place rather than here, which
          // is why this is a call and not a cast (see `taggedPrior`).
          inverse: taggedPrior(kind, inverse),
        }),
      );
    },
  };
}
