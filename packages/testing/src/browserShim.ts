import {
  type ChannelResult,
  type ContractClient,
  type ContractHandlers,
  type Incident,
  channels,
  createClient,
  wrapHandlers,
} from '@monstera/contract';
import { type DocId, type DocVersion, asDocId, asDocVersion, err, ok } from '@monstera/shared';

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
      return Promise.resolve(ok({ version: asDocVersion(next) }));
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
      return Promise.resolve(ok({ kind: 'undone' as const, version: asDocVersion(next) }));
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
  };
}
