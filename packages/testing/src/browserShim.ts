import {
  type ChannelResult,
  type ContractClient,
  type ContractHandlers,
  type Incident,
  channels,
  createClient,
  wrapHandlers,
} from '@monstera/contract';
import {
  type DocId,
  type DocVersion,
  type FileHandle,
  asDocId,
  asDocVersion,
  err,
  findInLines,
  ok,
} from '@monstera/shared';

/**
 * The fourth contract surface: a `ContractClient` with no Electron and no kernel.
 *
 * ## What this is for, and the sin it exists to prevent
 *
 * The wired-tools rule requires a **pair** of tests per feature, and neither
 * alone counts: a kernel proof that a command produces the document effect, and
 * a UI test that the control dispatches exactly that command. The UI half needs
 * a client to dispatch into, in a browser, in milliseconds. Without one, the only
 * available UI test proves a button dispatches into the void — the display-only
 * sin wearing a green check.
 *
 * ## It is derived, not written
 *
 * `createClient` builds the surface from the channel registry, so **a shim that
 * does not implement the whole registry fails to compile.** That is the property
 * that stops a test double drifting away from the real thing while its tests
 * stay green, and it is why the handler map below is annotated
 * `ContractHandlers` rather than typed structurally: adding a channel breaks
 * this file until it is answered here too.
 *
 * ## The kernel is stubbed, and `packages/testing` cannot import it anyway
 *
 * The boundary permits `shared` and `contract` only. That is deliberate rather
 * than incidental: a shim that reached the real `DocumentService` would need a
 * filesystem, and the thing it exists to make possible is a test that runs in a
 * browser. What it models is the **contract**, not the engine — versions
 * advance, unknown documents are refused, and the wire shapes are the real ones.
 *
 * ## It goes through `wrapHandlers`, and that is the point of the design
 *
 * The obvious shim returns canned envelopes directly. This one runs the same
 * boundary code the main process runs: params are parsed by the real schemas,
 * results are validated against the real declarations, an undeclared failure
 * code becomes `internal`, and a throw is recorded as an incident rather than
 * rejecting. So a UI test meets the failure shapes it will actually meet — a
 * `Result` to destructure, never an exception to catch.
 *
 * ## Structured-clone in both directions, because the easy shape is the trap
 *
 * An in-process call passes object references. Real IPC serialises, and a value
 * that survives a reference pass and dies in `structuredClone` — a function, a
 * class instance, a `Symbol` — would work in every shim test and fail in the
 * shipped application. Cloning here makes the shim reject what the wire would
 * reject (audit item 2: the harness must not be richer than the real caller).
 *
 * **The two directions are not equally proven, and saying which is which is the
 * point.** The INBOUND clone is load-bearing and has a control: removing it
 * turns the non-serialisable-param case green, measured. The OUTBOUND clone
 * currently provides nothing a test can see, because `wrapHandler` returns
 * `parsedResult.data` — an object zod's parse just built — so results are
 * already fresh whether this clones them or not. Removing it reddens no case.
 *
 * It stays, as wire fidelity rather than as a proven mechanism, and the reason
 * it has no control is an expiry condition rather than an excuse: **the moment
 * any channel declares a result schema that can return its input by reference**
 * — a `z.custom`, a passthrough, an `any` — zod stops supplying the property and
 * this line becomes the only thing supplying it. A control written today would
 * pass for zod's reason and read as though it covered this one.
 */

/** How the shim was configured, and what a test can observe afterwards. */
/**
 * One answer from the shim's picker.
 *
 * The contract's own result type, narrowed to what a shim can produce: it is
 * `ChannelResult<'document.open'>`, so a variant added to the channel makes
 * every construction of one here a compile error rather than a silently
 * unhandled case.
 */
export type OpenAnswer = ChannelResult<'document.open'>;

export interface BrowserShim {
  /** The renderer-facing surface. Complete by construction. */
  readonly client: ContractClient;
  /** Seeds an open document. Returns the id the client should use. */
  open: (id?: string) => DocId;
  /** Closes one, so `document-not-open` can be exercised. */
  close: (docId: DocId) => void;
  /** The version the shim believes a document is at, or `undefined`. */
  versionOf: (docId: DocId) => DocVersion | undefined;
  /** Diagnostics withheld from the client, in order. */
  readonly incidents: readonly Incident[];
  /**
   * How many times the renderer asked for the log to be revealed.
   *
   * A COUNT, not a boolean. *It was asked for* and *it was asked for once* are
   * different claims, and a command wired to fire on every render satisfies the
   * boolean perfectly.
   */
  revealedLog: () => number;
}

/**
 * One link a test seeds a page with.
 *
 * The contract's own shape, restated here rather than imported, because the
 * contract exports schemas rather than types for this and a `z.infer` in a
 * fixture's signature is a type a test author cannot read. It is checked
 * against the real one where it matters: the shim's answers go through
 * `createClient`, which parses them.
 */
export type ShimPageLink =
  | {
      readonly kind: 'internal';
      readonly page: number;
      readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
    }
  | {
      readonly kind: 'external';
      readonly uri: string;
      readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
    };

/**
 * One outline entry a test seeds a document with.
 *
 * `page` is `null` for an entry that resolves nowhere — an external URI, or a
 * destination the document does not define. Stated here so a test can build
 * that state, because it is the one a panel is most likely to get wrong.
 */
export interface ShimDestination {
  readonly title: string;
  readonly page: number | null;
  readonly depth: number;
}

/**
 * One optional-content group a test seeds a document with.
 *
 * `index` is what a toggle names — the group's position in `/OCProperties/OCGs`
 * — and it is carried rather than derived from the array position so that a
 * test can make the two differ. A panel that sent a row's position where a
 * layer's address was wanted toggles the wrong layer, and a fixture where the
 * two coincide is a fixture the defect handles correctly.
 */
export interface ShimLayer {
  readonly index: number;
  readonly name: string;
  readonly visible: boolean;
}

export interface BrowserShimOptions {
  readonly version?: string;
  readonly installChannel?: 'store' | 'web' | 'development';
  /**
   * Documents whose lane is saturated, by id.
   *
   * A declared outcome the renderer must handle by backing off. It is a set a
   * test controls rather than a condition the shim simulates, because the shim
   * has no lane — modelling one would be inventing an engine here.
   */
  readonly busy?: ReadonlySet<string>;
  /**
   * Undo steps each document's next command reports as dropped, by id.
   *
   * §4's checkpoint budget, as a value a test supplies rather than behaviour
   * the shim invents: there are no checkpoints here and no ceiling, so any
   * number this side computed would be arithmetic nothing ships.
   */
  readonly trims?: ReadonlyMap<string, number>;
  /**
   * Documents whose save answers something other than `saved`, by id.
   *
   * Same reasoning as {@link BrowserShimOptions.busy} and the same shape: the
   * shim has no filesystem and no open-document index, so modelling a contested
   * target or a held rename would be inventing both. A test says which answer it
   * wants, and the renderer's handling of it becomes assertable — which is the
   * point, since a save UI that only ever meets success is one where the two
   * outcomes invariant 18 exists for have never been rendered.
   */
  readonly saveRefusals?: ReadonlyMap<
    string,
    'contested' | 'replaced' | 'target-absent' | 'unverifiable' | 'write-failed'
  >;
  /**
   * What `document.saveCopy` answers, for {@link saveRefusals}' reason.
   *
   * **Not a map by document**, which is the difference from the field above and
   * is the channel's shape rather than a simplification: writing a copy is one
   * dialog the user is in front of, so a case is about *what happened this
   * time* and never about two documents disagreeing.
   *
   * A number is a byte count and means the copy landed; `'write-failed'` is the
   * filesystem refusing; an object carries the count of other open documents
   * reaching the destination. **Absent means the user dismissed the dialog**,
   * which is the default so that the outcome a renderer most often mishandles
   * is the one it meets unless a case says otherwise.
   */
  readonly copyDestination?: number | 'write-failed' | { readonly openElsewhere: number };
  /**
   * The bytes each document is readable as, by id.
   *
   * **Real bytes rather than a generator**, because the one caller that matters
   * is PDF.js: a renderer test drives the shipped transport against the shipped
   * parser, and a parser fed synthetic bytes reports a corrupt document, which
   * is a fixture the defect also produces. A test supplies a fixture PDF and the
   * page it expects.
   *
   * A document with no entry here answers `document-not-open` — not an empty
   * range. Zero bytes is a document PDF.js rejects for a reason that has nothing
   * to do with what a test was asking about.
   */
  readonly documentBytes?: ReadonlyMap<string, Uint8Array>;

  /**
   * What `document.viewModel` answers, in order, across the whole shim.
   *
   * ## Scripted, and deliberately NOT simulated
   *
   * The obvious shape is to seed one model per document and have the shim apply
   * a `rotatePages` command to it. That is a second implementation of what
   * rotation means (B3a): MuPDF's snap, inheritance, and the absolute-versus-
   * relative question all live in `pageGeometry.ts`, and a shim that got any of
   * them subtly right would agree with the kernel until the day it did not — in
   * a component whose whole purpose is that tests trust it.
   *
   * A sequence asks the question a renderer test can actually answer: *did the
   * renderer read the model again after the version moved, and draw what it was
   * told?* The arithmetic is the kernel's, and it is proven against a real
   * engine in `pageGeometry.test.ts`.
   *
   * The last entry repeats once the sequence is exhausted, so a test supplying
   * one model gets a stable document and a test supplying two describes a
   * change. A document with no sequence at all answers a single flat page —
   * enough for a renderer to draw, and not enough for a test to accidentally
   * assert about.
   */
  readonly viewModels?: readonly {
    readonly pageCount: number;
    readonly rotations: readonly number[];
  }[];

  /**
   * What a page holds, for `document.searchPage` to search.
   *
   * **Lines rather than matches**, so the shim searches rather than agreeing
   * with whatever a test expected. A shim answering canned matches would let a
   * UI test pass against a renderer that sent the wrong query, the wrong page,
   * or no query at all — which is the display-only defect wearing a green
   * check, and the exact thing the wired-tools pair exists to catch.
   *
   * Indexed by page, so a test can put its needle on page 2 and assert the
   * renderer asked for page 2. A page with no entry holds no text.
   */
  readonly pageLines?: readonly (readonly string[])[];

  /**
   * The links each page carries, indexed by page.
   *
   * Seeded by the test rather than canned here, for `pageLines`' reason: a shim
   * answering the same links whatever it was asked would let a panel pass
   * against a renderer that requested the wrong page.
   *
   * A page with no entry has no links, which is a real state — most pages of
   * most documents have none.
   */
  readonly pageLinks?: readonly (readonly ShimPageLink[])[];

  /**
   * The document's outline, flattened, as a test wants it.
   *
   * A document with no outline is the common case, so the default is none —
   * which is a real state a panel must render rather than an empty fixture.
   */
  readonly destinations?: readonly ShimDestination[];

  /**
   * What `document.layers` answers, in order, across the whole shim.
   *
   * **Scripted, for `viewModels`' reason and not for a weaker one.** The
   * obvious shape is to hold one list and have the shim apply a
   * `setLayerVisibility` command to it, which is a second implementation of
   * what a toggle means (B3a): visibility is `/OCProperties`' default
   * configuration, whose `/BaseState` decides whether hiding a layer ADDS to
   * `/OFF` or REMOVES from `/ON`, and a shim that assigned one boolean would
   * agree with the kernel until it met a document of the second kind. The
   * kernel's answer is proven against a real engine in `layers.test.ts`.
   *
   * A sequence asks what a renderer test can answer: *did the panel read again
   * after the version moved, and draw what it was told?* The last entry
   * repeats, so one list is a stable document and two describe a change.
   *
   * At least one hidden layer is what makes a case about visibility mean
   * anything — a list where everything is visible cannot tell a panel that read
   * the flag from one that assumed it.
   */
  readonly layers?: readonly (readonly ShimLayer[])[];

  /**
   * What a previous run stored, as `settings.load` will answer it.
   *
   * A fixture rather than something a test writes first through
   * `settings.save`: *the renderer applies what was stored* and *the renderer
   * stores what was changed* are two claims, and a test that had to make the
   * second true in order to set up the first could not tell them apart.
   *
   * **Deliberately unvalidated**, matching the channel. A stored value the
   * registry refuses is the interesting fixture — it is what an older build
   * wrote — so a shim that rejected one could not be used to test the fallback.
   */
  readonly settings?: Readonly<Record<string, unknown>>;
  /**
   * Documents whose next command throws.
   *
   * Exists so the `internal` path is reachable. A failure shape nothing can
   * produce is one the renderer's handling of is never exercised, which is the
   * display-only sin one level down.
   */
  readonly faulty?: ReadonlySet<string>;
  /**
   * What `document.open` answers, in order, one per call.
   *
   * **A queue rather than a single value**, because the interesting cases are
   * sequences: cancel then open, open then open-again-already-open. A shim that
   * returned one fixed outcome forever could not express either, and a test
   * wanting the second would have to build its own client — which is the second
   * implementation of the boundary this shim exists to be.
   *
   * Unset, or exhausted, answers `cancelled`: the outcome that changes no state
   * and is a user closing a dialog. A default of `opened` would make every test
   * that never mentions opening quietly open a document.
   */
  readonly opens?: readonly OpenAnswer[];

  /**
   * What `document.recent` answers.
   *
   * Empty by default, because a first launch is the real state a start screen
   * must render — and a default list would make every case that never mentions
   * recent files show one.
   */
  readonly recent?: readonly { readonly handle: FileHandle; readonly name: string }[];

  /**
   * Whether the previous run exited cleanly. Defaults to `true`.
   *
   * The default is the ordinary state and the interesting fixture is `false`,
   * which is what a surface offering to recover has to be driven by. A shim
   * defaulting to `false` would make every case a crash-recovery case.
   */
  readonly lastExitClean?: boolean;

  /**
   * What was open when the previous run ended. Defaults to nothing.
   *
   * SEPARATE from `recent`, and a shim that derived it from the head of that
   * list would be modelling the inference multi-document tabs ended rather
   * than the recording that replaced it. A case about recovery has to be able
   * to name two documents that are not the two most recently opened.
   */
  readonly lastSession?: readonly { readonly handle: FileHandle; readonly name: string }[];
}

/**
 * A shallow structured clone, used to model the wire.
 *
 * `structuredClone` is on `globalThis` in Node 17+ and in every browser this
 * targets, so no import is needed and no polyfill is carried.
 *
 * @param value anything crossing the modelled boundary
 */
function acrossTheWire<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Builds a browser-side contract client backed by an in-memory stub.
 *
 * @param options see {@link BrowserShimOptions}
 */
export function createBrowserShim(options: BrowserShimOptions = {}): BrowserShim {
  const versions = new Map<string, number>();
  /** How many entries each document's log would have to step back through. */
  const undoable = new Map<string, number>();
  const incidents: Incident[] = [];
  let minted = 0;

  // Copied, not aliased: `options` is the caller's, and a handler that shifted
  // entries off it would mutate a value the caller may still be reading.
  const queuedOpens: OpenAnswer[] = [...(options.opens ?? [])];

  // Copied rather than aliased, for the same reason the queue above is: a test
  // holding the object it seeded would otherwise see it change underneath as
  // the renderer saves.
  let stored: Record<string, unknown> = { ...(options.settings ?? {}) };
  let revealedLog = 0;

  /**
   * What a command reports the document's new size as.
   *
   * Real bytes when a test supplied them, so a renderer rebinding its transport
   * gets a length its own ranges agree with. Otherwise a **non-zero constant**,
   * because zero is what an absent document reports and a length nothing can act
   * on is indistinguishable from a length nobody sent.
   *
   * @param docId the document a command was applied to
   */
  const byteLengthOf = (docId: string): number =>
    options.documentBytes?.get(docId)?.byteLength ?? 1024;

  /** One upright page: enough to draw, not enough to assert about. */
  const FLAT = { pageCount: 1, rotations: [0] };

  // Copied for the reason the opens queue is copied: this one is consumed, and
  // a test holding the array it seeded would watch it empty underneath.
  const viewModels = [...(options.viewModels ?? [])];
  const pageLines = options.pageLines ?? [];
  const pageLinks = options.pageLinks ?? [];
  const destinations = options.destinations ?? [];
  // Copied and consumed, exactly like `viewModels`.
  const layerLists = [...(options.layers ?? [])];
  const recentEntries = options.recent ?? [];

  // `Promise.resolve`, not `async`. The contract's handler type is asynchronous
  // because the real ones are; nothing here awaits anything, and `async` on a
  // body with no `await` is a lint error rather than a style preference. A
  // synchronous throw inside one of these still reaches `wrapHandler`'s catch,
  // which awaits the call inside its `try`.
  const handlers: ContractHandlers = {
    'app.info': () =>
      Promise.resolve(
        ok({
          version: options.version ?? '0.0.0-shim',
          // `development`, and never `store`. A shim reporting the Store channel
          // would let a test assert update behaviour that only the packaged
          // artifact can have (E4), which is `available: true` for a binary that
          // cannot be spawned, in a new place.
          installChannel: options.installChannel ?? 'development',
        }),
      ),

    'document.open': () => {
      const answer = queuedOpens.shift() ?? { kind: 'cancelled' as const };

      // AN `opened` ANSWER SEEDS THE DOCUMENT, so the id it returns is one
      // `document.execute` will accept. A shim that reported a document open
      // and then refused every command against it would hand a test the one
      // state the real boundary cannot produce, and the test written against it
      // would assert on a shape nothing ships.
      if (answer.kind === 'opened') versions.set(answer.docId, answer.version);
      return Promise.resolve(ok(answer));
    },

    /**
     * Closes a document, and it FORGETS THE VERSION rather than only answering.
     *
     * The version map is what makes `document.execute` accept an id, so a shim
     * that answered `closed: true` and kept the entry would let a surface go on
     * commanding a document it had closed — the one state the real boundary
     * cannot produce, and the state a tab strip's teardown is most likely to
     * get wrong. `closed` is the map's own answer for the same reason: a
     * literal `true` here would report a close for a document nobody opened.
     */
    'document.close': ({ docId }) => Promise.resolve(ok({ closed: versions.delete(docId) })),

    /**
     * The recent list, from the fixture.
     *
     * **Handles rather than paths, exactly as the real one answers.** A shim
     * that carried paths would let a surface pass here while doing something
     * invariant L2 forbids in the product — and the whole point of a recent
     * entry's handle is that a renderer can name a file it cannot read.
     */
    'document.recent': () =>
      Promise.resolve(
        ok({
          entries: recentEntries,
          lastExitClean: options.lastExitClean ?? true,
          lastSession: options.lastSession ?? [],
        }),
      ),

    /**
     * Opens a recent document, and REFUSES a handle the fixture did not name.
     *
     * The refusal is the half worth having: a shim that opened anything would
     * let a surface pass while sending a stale handle, which is the one thing
     * this channel's `unknown-handle` outcome exists for.
     */
    'document.openRecent': ({ handle }) => {
      if (!recentEntries.some((entry) => entry.handle === handle)) {
        return Promise.resolve(err({ code: 'unknown-handle' }));
      }
      const answer = queuedOpens.shift() ?? { kind: 'cancelled' as const };
      if (answer.kind === 'opened') versions.set(answer.docId, answer.version);
      return Promise.resolve(ok(answer));
    },

    'document.execute': ({ docId }) => {
      if (options.faulty?.has(docId) === true) {
        // Thrown, not returned. `wrapHandlers` records it and hands the client
        // `internal` plus an incident id — the same split the real boundary
        // makes, so a test sees the real shape rather than a shim's idea of it.
        throw new Error('shim: injected engine fault');
      }
      if (options.busy?.has(docId) === true) return Promise.resolve(err({ code: 'document-busy' }));

      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      const next = current + 1;
      versions.set(docId, next);
      undoable.set(docId, (undoable.get(docId) ?? 0) + 1);
      // THE BYTE LENGTH CHANGES, and it changes by a different amount than the
      // renderer would guess. A command rewrites the document, and a shim that
      // answered with the length it already had would let a transport bound to
      // the OLD size pass every test here — the fixture the defect handles
      // correctly. `documentBytes` is what a range is served from, so a test
      // that supplies real bytes gets a length consistent with them; one that
      // does not gets a number that moves.
      // A SET A TEST CONTROLS, not a condition the shim models. The shim keeps
      // no checkpoints and has no ceiling, so simulating a trim would be
      // inventing §4's budget here — and a shim that answered a plausible
      // number would let a renderer test pass against arithmetic nothing ships.
      // Zero is the honest default and `trims` is how a case asks for the other
      // branch.
      return Promise.resolve(
        ok({
          version: asDocVersion(next),
          byteLength: byteLengthOf(docId),
          historyDropped: options.trims?.get(docId) ?? 0,
        }),
      );
    },

    'document.undo': ({ docId }) => {
      if (options.busy?.has(docId) === true) return Promise.resolve(err({ code: 'document-busy' }));

      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      // A DEPTH, not a boolean, because the real log is a cursor. A shim that
      // answered `nothing-to-undo` after one undo would let a test assert a
      // single level and pass, which is the one behaviour §4 is explicit is
      // wrong — undo steps back and never pops.
      const depth = undoable.get(docId) ?? 0;
      if (depth === 0) return Promise.resolve(ok({ kind: 'nothing-to-undo' as const }));

      undoable.set(docId, depth - 1);
      // THE VERSION GOES UP, and that is not a mistake for an operation that
      // moves a document backwards. §4: the counter is bumped by every applied
      // mutation *"including undo and redo"* — it identifies a state, not a
      // position in the history, and a shim that decremented would teach a test
      // the opposite.
      const next = current + 1;
      versions.set(docId, next);
      return Promise.resolve(
        ok({ kind: 'undone' as const, version: asDocVersion(next), byteLength: byteLengthOf(docId) }),
      );
    },
    /**
     * Save, and the shim's job here is to make the two non-success outcomes
     * REACHABLE.
     *
     * A shim that only ever answered `saved` would let a UI test assert a save
     * control and pass while the renderer had no path for a refusal or a failed
     * write — and those are the two invariant 18 says the user must be told
     * about rather than shown a dialog that discards their work. So both are
     * driven by the caller, the same way `busy` already drives one.
     *
     * **The version does NOT move.** §4 bumps for every applied mutation; a
     * save applies none — it records that the file now holds the version the
     * document is already at. A shim that incremented would teach a test that
     * saving dirties the document it just cleaned.
     */
    'document.save': ({ docId }) => {
      if (options.busy?.has(docId) === true) return Promise.resolve(err({ code: 'document-busy' }));

      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      const refusal = options.saveRefusals?.get(docId);
      if (refusal !== undefined) {
        return Promise.resolve(
          refusal === 'write-failed'
            ? ok({ kind: 'write-failed' as const })
            : ok({ kind: 'refused' as const, reason: refusal }),
        );
      }

      return Promise.resolve(ok({ kind: 'saved' as const, version: asDocVersion(current) }));
    },

    /**
     * Writing a copy, which in the shim is **the picker's outcome and nothing
     * else**.
     *
     * There is no filesystem here and no dialog, so the only part of this
     * channel a browser-side case can be about is what the renderer does with
     * each answer. `copyDestination` is what a case sets to choose one:
     * `undefined` — the default — is the user dismissing the dialog, which is
     * also the state a renderer most often gets wrong by treating it as a
     * failure.
     *
     * **Cancelled is the DEFAULT deliberately**, for the recent-files fixture's
     * reason: a shim that copied by default would let a case asserting *the
     * status bar says copied* pass without ever choosing that outcome.
     */
    'document.saveCopy': ({ docId }) => {
      if (options.busy?.has(docId) === true) return Promise.resolve(err({ code: 'document-busy' }));
      if (!versions.has(docId)) return Promise.resolve(err({ code: 'document-not-open' }));

      const chosen = options.copyDestination;
      if (chosen === undefined) return Promise.resolve(ok({ kind: 'cancelled' as const }));
      if (chosen === 'write-failed') return Promise.resolve(ok({ kind: 'write-failed' as const }));
      if (typeof chosen === 'object') {
        return Promise.resolve(ok({ kind: 'refused' as const, openElsewhere: chosen.openElsewhere }));
      }
      return Promise.resolve(ok({ kind: 'copied' as const, bytes: chosen }));
    },

    // THE STALE RULE IS MODELLED, and it is the one behaviour here that is not
    // bookkeeping. A transport bound to a version that has moved must be told
    // so rather than served, because serving it is how a document gets built out
    // of two versions — and the renderer's handling of that is precisely what a
    // shim test can reach and a kernel test cannot.
    'document.readRange': ({ docId, version, begin, end }) => {
      const current = versions.get(docId);
      const bytes = options.documentBytes?.get(docId);
      if (current === undefined || bytes === undefined) {
        return Promise.resolve(err({ code: 'document-not-open' }));
      }

      if (current !== version) {
        return Promise.resolve(
          ok({
            kind: 'stale' as const,
            version: asDocVersion(current),
            byteLength: bytes.byteLength,
          }),
        );
      }

      // Refused rather than clamped, exactly as the service does. A shim that
      // answered a short read where main throws would let a transport bug pass
      // every UI test and fail in the product.
      if (end > bytes.byteLength) {
        throw new RangeError(
          `Range [${String(begin)}, ${String(end)}) falls outside a ` +
            `${String(bytes.byteLength)}-byte document.`,
        );
      }

      const copy = new Uint8Array(end - begin);
      copy.set(bytes.subarray(begin, end));
      return Promise.resolve(ok({ kind: 'bytes' as const, bytes: copy }));
    },

    'document.viewModel': ({ docId }) => {
      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      // THE LAST ENTRY REPEATS rather than the queue emptying into a default.
      // A sequence that ran out and started answering a flat page would make a
      // renderer appear to un-rotate a document on its third read, which is a
      // shim behaviour no product code could produce and a test would then be
      // written around.
      const model = viewModels.length > 1 ? (viewModels.shift() ?? FLAT) : (viewModels[0] ?? FLAT);
      return Promise.resolve(ok({ version: asDocVersion(current), ...model }));
    },

    /**
     * SEARCHES, rather than answering canned matches.
     *
     * A shim that returned a fixed list would agree with a renderer that sent
     * the wrong page, the wrong query, or a query it never built — and the UI
     * half of the wired pair would go green over a control dispatching into the
     * void. So the needle is actually looked for, in lines the test supplied.
     *
     * The matching rule is `@monstera/shared`'s `findInLines`, which is what
     * the kernel's search calls too. This was a lower-case `indexOf` loop with
     * a comment claiming it followed the kernel's rule — true while that rule
     * was one line, and a claim the moment case, whole-word, regex and
     * normalisation joined it (B3a).
     */
    'document.searchPage': ({ docId, page, query, limit, ...options }) => {
      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      // `findInLines`, NOT a rule written here. This handler had its own
      // lower-case `indexOf` loop and a comment saying it followed the kernel's
      // rule; that was true while the rule was one line and became a claim the
      // moment case, whole-word, regex and normalisation landed. The matcher
      // moved to `@monstera/shared` — which both this package and the kernel
      // may import — so there is one answer rather than two that agree for a
      // while (B3a).
      const found = findInLines(pageLines[page] ?? [], query, { ...options, limit: limit + 1 });
      if (!found.ok) {
        // The same refusal the real handler makes, and it is reachable here:
        // the channel accepts any non-empty string, so an unparseable pattern
        // reaches a handler rather than the schema.
        return Promise.resolve(err({ code: 'search-pattern-invalid' }));
      }

      return Promise.resolve(
        ok({
          version: asDocVersion(current),
          matches: found.value.slice(0, limit),
          // The same one-past-the-limit rule the kernel uses, so a shim answer
          // and a real one disagree about nothing a test could come to rely on.
          truncated: found.value.length > limit,
        }),
      );
    },

    /**
     * One page's links, from the fixture the shim was built with.
     *
     * **One of each kind on the first page**, because the split is what a
     * surface acts on: an internal link offers a jump and an external one has
     * to be asked about (invariant 24). A shim that answered only internals
     * would let a panel that ignored the distinction pass every case.
     */
    /**
     * The document's outline, from the fixture the shim was built with.
     *
     * Seeded rather than canned, for `pageLinks`' reason. A document with no
     * outline is the common case, so an unseeded shim answers with none.
     */
    'document.destinations': ({ docId }) => {
      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      return Promise.resolve(ok({ version: asDocVersion(current), destinations }));
    },

    /**
     * The document's layers, from the scripted sequence — see `layers` in the
     * options for why a toggle is not applied here.
     */
    'document.layers': ({ docId }) => {
      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      // The last entry repeats rather than the queue emptying into none, for
      // the reason `document.viewModel` states: a panel that appeared to lose
      // its layers on the third read would be reacting to a shim behaviour no
      // product code can produce.
      const layers = layerLists.length > 1 ? (layerLists.shift() ?? []) : (layerLists[0] ?? []);
      return Promise.resolve(ok({ version: asDocVersion(current), layers }));
    },

    /**
     * No duplicates, and the shim says so rather than being unable to answer.
     *
     * The renderer's surface for this is a dialog a person opens deliberately,
     * so the shim's job is to let it open and report the empty case honestly.
     * A queue of scripted answers is what the layer and view-model handlers
     * above have, and it exists for surfaces that read on their own; nothing
     * here reads without being asked.
     */
    'document.duplicatePages': ({ docId }) => {
      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));
      return Promise.resolve(ok({ version: asDocVersion(current), groups: [], truncated: false }));
    },

    'document.pageLinks': ({ docId, page }) => {
      const current = versions.get(docId);
      if (current === undefined) return Promise.resolve(err({ code: 'document-not-open' }));

      return Promise.resolve(
        ok({
          version: asDocVersion(current),
          links: pageLinks[page] ?? [],
        }),
      );
    },

    // SETTINGS SURVIVE WITHIN ONE SHIM, and do not survive constructing another.
    //
    // That is the real boundary's behaviour with the process boundary removed:
    // `settings.save` then `settings.load` answers with what was saved, which is
    // what a test of *the renderer persists what it changed* needs, and a fresh
    // shim is a fresh install. A shim that forgot immediately would make the
    // round trip untestable; one that reached a module-level map would make two
    // tests in one file share a user's preferences, which is the cross-test
    // leakage a per-instance store makes unrepresentable.
    //
    // `options.settings` seeds it, so *what a previous run stored* is a fixture
    // rather than something a test has to write first through the very channel
    // it is about to assert on.
    'settings.load': () => Promise.resolve(ok({ stored: { ...stored } })),
    'settings.save': ({ values }) => {
      stored = { ...values };
      return Promise.resolve(ok({ stored: true as const }));
    },
    // RECORDED, NOT PERFORMED, and `revealed` is the shim's answer rather than a
    // guess about the machine: a browser has no file manager and there is no log
    // directory in a shim, so `true` here would be the one thing this surface
    // must never do — agree with a call it did not make. The count is what a UI
    // test asserts against; whether an OS opened a window is main's business and
    // `proof:shell`'s.
    'log.reveal': () => {
      revealedLog += 1;
      return Promise.resolve(ok({ revealed: false }));
    },
  };

  const wrapped = wrapHandlers(channels, handlers, (incident) => {
    incidents.push(incident);
  });

  const client = createClient(channels, async (id, params) =>
    acrossTheWire(await wrapped[id](acrossTheWire(params))),
  );

  return {
    client,
    open: (id?: string) => {
      minted += 1;
      const docId = asDocId(id ?? `shim-doc-${String(minted)}`);
      // Version 1, not 0. ADR-0009 §5: `DocVersion` is monotonic from 1, and an
      // open document has always had one applied state.
      versions.set(docId, 1);
      return docId;
    },
    close: (docId: DocId) => {
      versions.delete(docId);
    },
    versionOf: (docId: DocId) => {
      const found = versions.get(docId);
      return found === undefined ? undefined : asDocVersion(found);
    },
    incidents,
    revealedLog: () => revealedLog,
  };
}
