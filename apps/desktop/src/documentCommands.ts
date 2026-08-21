import { type CommandKind, type CommandOfKind } from '@monstera/contract';
import {
  type CommandBus,
  type DeclaredSpecs,
  type DocumentService,
  type WriterSession,
  declaredSpecs,
} from '@monstera/kernel';
import { type DocId, type DocVersion } from '@monstera/shared';

/**
 * The composition point (ADR-0009, 2026-08-19): the one place that owns
 * `DocumentService.run → CommandBus.execute`.
 *
 * ## Why one, and why here
 *
 * §7 fixes the lane, §4 fixes the log, §6 fixes routing, and nothing said who
 * assembles them. If every handler assembled it, a handler that forgets the lane
 * is a race — and there would be **a second place where a feature is wired**,
 * which is the thing the command registry exists to forbid.
 *
 * It lives under `apps/desktop/src` and imports no Electron, and the location is
 * a constraint rather than a convenience: the reachability trigger in
 * `docs/security/engine-advisories.json` scans every `src` tree under `apps/`,
 * so handlers put anywhere else would leave that verdict green through the whole
 * unit it was armed for. The repository map's rule is that `apps/desktop` is the
 * *only* package that **may** import Electron, not that everything in it must.
 *
 * ## What it deliberately does not own
 *
 * **Engine session lifetime.** Sessions are looked up, never created here — see
 * {@link SessionLookup}.
 *
 * **Who owns them is settled, and this comment used to say it was not.**
 * `docs/ARCHITECTURE.md` §2 states that per document `DocumentService` owns
 * "canonical bytes, lazily-created engine handles (invalidated together on any
 * mutation), the command log and checkpoints, and the originating `FileHandle`",
 * and §3.2 restates the handle half. That is the answer to *who opens a session
 * and from which bytes*: `DocumentService`, lazily, from its own canonical
 * image, as a cache that may be thrown away and rebuilt.
 *
 * The earlier text read ADR-0009 §8's silence as the project's. §8 is silent —
 * it says only that the kernel keeps the bytes — but the **living law is not**,
 * and `CLAUDE.md`'s document table puts `ARCHITECTURE.md` above an ADR wherever
 * they diverge. The advisory register agreed with the law rather than with this
 * comment: its entry called itself "a prompt to decide", and a prompt to decide
 * is not a change-control stop. Widening a source's silence into the project's
 * is how three lines of work acquire a ruling-sized question (EE-7's shape).
 *
 * What is genuinely open is the **policy**, not the ownership: how many images
 * are resident, what happens at ADR-0007's ceiling, and whether a killed host
 * actually recovers. The first two are answered in
 * [ADR-0021](../../../docs/DECISIONS/0021-the-canonical-image-is-retained.md);
 * the third is owed against a running host and is a `docs/FEATURES.md` row.
 */

/**
 * The engine sessions one open document currently has, keyed by writer of
 * record.
 *
 * **Partial by construction**, the same shape and the same reason as the bus's
 * `WriterRegistry`: four writers of record are declared and one has an adapter,
 * so a total map could not be built today and pretending otherwise would mean a
 * placeholder that fails at a native call instead of at lookup.
 */
export type DocumentSessions = {
  readonly [W in keyof WriterSession]?: WriterSession[W];
};

/**
 * How this finds a document's sessions — **get-or-miss, never get-or-create**.
 *
 * The same rule the lane and the log follow, for the same reason: a lookup that
 * creates would mint a session for a closed `DocId` and run a command against a
 * torn-down document. A miss here is a **defect**, not an outcome — an open
 * document without its session is an inconsistency in whoever holds them, and it
 * is reported as {@link MissingSessionError} so it reaches the renderer as
 * `internal` with a diagnostic recorded rather than as something a user is asked
 * to act on.
 */
export type SessionLookup = (docId: DocId) => DocumentSessions | undefined;

/** An open document had no session for the writer its command routes to. */
export class MissingSessionError extends Error {
  override readonly name = 'MissingSessionError';

  constructor(docId: DocId, writer: string) {
    super(
      `No '${writer}' session for a document that is open. Session lookup is get-or-miss: ` +
        'nothing is created here, so this means the holder of sessions and the open-document ' +
        `index have diverged. (document ${docId.slice(0, 8)}…)`,
    );
  }
}

/**
 * Fails to compile the day a second command kind exists.
 *
 * **The hard shape this unit has NOT been verified against** (audit item 2),
 * named rather than left for someone to discover. With one kind, `Command` *is*
 * `CommandOfKind<'rotatePages'>`, so {@link DocumentCommands.execute} infers `K`
 * as that kind and every correlated lookup below — `declaredSpecs[command.kind]`
 * to a spec, `spec.writer` to a session — resolves to one concrete type.
 *
 * With two kinds a caller holding the wire union infers `K` as the union, and
 * `DeclaredSpecs[K]` becomes a *union of specs*: `spec.writer` is then a union of
 * writers, and TypeScript cannot correlate the session it selects with the
 * `apply` that will receive it. That needs a narrowing step from `Command` to
 * `CommandOfKind<K>`, which is a design with exactly zero data points today —
 * §6's mapped table routes, and what is missing is the discrimination in front
 * of it.
 *
 * So this is a trigger rather than a guess, the same mechanism `CommandBus.redo`
 * uses for `replay: 'stored-effect'`: it arrives at the moment the path becomes
 * reachable, and not before. `[X] extends [Y]` is the non-distributive form —
 * the bare `X extends Y` distributes and would answer `true` for a union that has
 * grown.
 */
type SingleCommandKindToday = [CommandKind] extends ['rotatePages'] ? true : never;
const singleCommandKind: SingleCommandKindToday = true;
void singleCommandKind;

export class DocumentCommands {
  readonly #documents: DocumentService;
  readonly #bus: CommandBus;
  readonly #sessions: SessionLookup;

  constructor(documents: DocumentService, bus: CommandBus, sessions: SessionLookup) {
    this.#documents = documents;
    this.#bus = bus;
    this.#sessions = sessions;
  }

  /**
   * Runs one command through the lane and returns the version it produced.
   *
   * **The ordering is the whole of this method**, and every part of it is
   * load-bearing:
   *
   * - the bus runs **inside** `run`'s callback, so a command queues behind
   *   whatever else that document is doing (§7). Outside it, two concurrent
   *   commands would both capture prior state before either applied, and the
   *   second entry's inverse would record the state the *first* replaced —
   *   undo would then restore a document to something it was never in;
   * - the session is resolved **inside** the lane too, so a session torn down
   *   between queueing and running is a miss rather than a stale handle;
   * - the version returned is the one `run` stamps **after** the work, not the
   *   one it handed in. For a command those are two different numbers, and the
   *   pre-work value is the version the command *replaced*.
   *
   * `Executed` is deliberately dropped. It carries the log entry, and a log
   * entry holds an inverse or a checkpoint — a whole byte image — which must not
   * leave the main process (L11) and has no renderer-side use.
   *
   * @throws `DocumentNotOpenError`, `DocumentBusyError` — outcomes the handler
   * reports as declared codes.
   * @throws {@link MissingSessionError} and anything the engine throws — defects,
   * which the boundary turns into `internal` with the diagnostic kept main-side.
   */
  async execute<K extends CommandKind>(
    docId: DocId,
    command: CommandOfKind<K>,
  ): Promise<DocVersion> {
    const spec: DeclaredSpecs[K] = declaredSpecs[command.kind];

    const { version } = await this.#documents.run(docId, async (context) => {
      const sessions = this.#sessions(docId);
      const session = sessions?.[spec.writer];
      if (session === undefined) throw new MissingSessionError(docId, spec.writer);

      await this.#bus.execute<K>(session, context, command);
    });

    return version;
  }
}
