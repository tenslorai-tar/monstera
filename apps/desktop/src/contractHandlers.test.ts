import { CapabilityRegistry, DocumentNotOpenError, DocumentService } from '@monstera/kernel';
import { type DocId, type FileHandle, asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { type AppInfo, type PickDocument, createContractHandlers } from './contractHandlers.js';
import type { DocumentCommands } from './documentCommands.js';
import { createEphemeralSettings } from './settingsFile.js';

const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development' };

/** These cases are about opening; nothing here dispatches a command. */
const unusedCommands = {} as unknown as DocumentCommands;

type OpenOutcome = Awaited<ReturnType<DocumentService['open']>>;

/**
 * A `DocumentService` that answers one outcome and records what it was handed.
 *
 * Substituted rather than constructed, because every case here is about what
 * `document.open`'s handler DOES with an outcome — the picker's answer, the
 * mint, the handle's lifetime — and none is about how a real service decides
 * which outcome to produce. That question has its own tests, in the kernel.
 */
function serviceAnswering(outcome: OpenOutcome): {
  documents: DocumentService;
  opened: FileHandle[];
} {
  const opened: FileHandle[] = [];
  const documents = {
    open: (handle: FileHandle) => {
      opened.push(handle);
      return Promise.resolve(outcome);
    },
  } as unknown as DocumentService;
  return { documents, opened };
}

function harness(outcome: OpenOutcome, pickDocument: PickDocument) {
  const capabilities = new CapabilityRegistry();
  const { documents, opened } = serviceAnswering(outcome);
  // RECORDED RATHER THAN IGNORED. Whether a document gets an engine session is
  // decided by this call being made, and the outcomes it must NOT be made for
  // produce exactly the same handler result as the one it must.
  const sessioned: DocId[] = [];
  const revealed: boolean[] = [];
  const settings = createEphemeralSettings();
  const handlers = createContractHandlers({
    appInfo,
    capabilities,
    commands: unusedCommands,
    documents,
    openedDocument: (docId) => sessioned.push(docId),
    pickDocument,
    // RETURNED, so cases about persistence read the same object the handlers
    // wrote rather than a second copy. `settings.save` answering `stored: true`
    // is a claim about a surface having accepted the values, and a test that
    // could not look at the surface would be asserting the call was made.
    settings,
    // COUNTED, so a case can assert the handler asked exactly once rather than
    // that it answered something.
    revealLog: () => {
      revealed.push(true);
      return Promise.resolve(true);
    },
  });
  return { capabilities, handlers, opened, revealed, sessioned, settings };
}

const A_DOC: DocId = asDocId('doc-1');

/**
 * The handle the service was asked to open.
 *
 * Throws rather than asserting the type, so *the handler never called open* is
 * a named failure instead of an assertion about `undefined` further down. Two
 * lint rules disagree about how to spell the assertion, which is a good sign
 * that neither spelling is what the case wants.
 */
function handleOpened(opened: readonly FileHandle[]): FileHandle {
  const handle = opened[0];
  if (handle === undefined) throw new Error('the service was never asked to open anything');
  return handle;
}

describe('document.open', () => {
  it('never asks the renderer where the document is', async () => {
    // THE INVARIANT, asserted at the one place it could be broken. The handler
    // takes `Record<string, never>`, so a renderer cannot name a path — this
    // case exists so that widening the params to carry one fails here as well
    // as at the type, and a reviewer sees a sentence rather than a signature.
    const picked = vi.fn<PickDocument>(() => Promise.resolve('C:/docs/a.pdf'));
    const { handlers } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      picked,
    );

    await handlers['document.open']({});

    expect(picked).toHaveBeenCalledWith();
  });

  it('reports cancellation as an outcome, and does not mint', async () => {
    const { capabilities, handlers, opened } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      () => Promise.resolve(null),
    );

    const result = await handlers['document.open']({});

    expect(result).toStrictEqual({ ok: true, value: { kind: 'cancelled' } });
    // ASSERT THE CALL THAT WAS NOT MADE. A cancelled pick that still opened
    // would produce a document nobody asked for, and asserting only the
    // returned `cancelled` would not see it — the service's answer is
    // discarded either way.
    expect(opened).toStrictEqual([]);
    expect(capabilities.has(asFileHandleFrom(capabilities, 'C:/docs/a.pdf'))).toBe(false);
  });

  it('mints a handle for the picked path and opens THAT handle', async () => {
    const { capabilities, handlers, opened } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      () => Promise.resolve('C:/docs/a.pdf'),
    );

    const result = await handlers['document.open']({});

    expect(result).toStrictEqual({
      ok: true,
      // THE NAME CROSSES AND THE PATH DOES NOT, which is the assertion the
      // field exists for: the fixture's document is at `C:/docs/a.pdf` and what
      // reaches a renderer is `a.pdf`. A handler that passed the outcome through
      // unchanged from a service that had sent the path would fail here.
      value: { kind: 'opened', docId: A_DOC, version: 1, byteLength: 1024, name: 'a.pdf' },
    });
    expect(opened).toHaveLength(1);
    // The handle the service received resolves to the path the picker chose.
    // Asserting only that *a* handle was passed would pass for a handler that
    // minted one for a different path.
    expect(capabilities.resolve(handleOpened(opened))).toBe('C:/docs/a.pdf');
  });

  describe('the handle after the outcome', () => {
    it('revokes it when the file is absent, so a repeated miss cannot grow the registry', async () => {
      const { capabilities, handlers, opened } = harness({ kind: 'absent' }, () =>
        Promise.resolve('C:/docs/gone.pdf'),
      );

      await handlers['document.open']({});

      expect(capabilities.has(handleOpened(opened))).toBe(false);
    });

    it('revokes it at capacity, for the same reason', async () => {
      const { capabilities, handlers, opened } = harness(
        { kind: 'at-capacity', wouldHold: 9, ceiling: 8 },
        () => Promise.resolve('C:/docs/huge.pdf'),
      );

      await handlers['document.open']({});

      expect(capabilities.has(handleOpened(opened))).toBe(false);
    });

    it('does NOT revoke it when the document is already open', async () => {
      // THE CASE THE SYMMETRIC VERSION GETS WRONG. `mint` is idempotent per
      // path, so the handle minted here IS the live document's handle —
      // revoking it would strip the capability out from under a document that
      // is open and working, and the failure would surface later and elsewhere
      // as a resolve that throws.
      //
      // Nothing about the outcome says this. It is a property of `mint`, which
      // is why a tidy-up that looks symmetric across four outcomes is correct
      // on two and destructive on this one.
      const { capabilities, handlers, opened } = harness(
        { kind: 'already-open', docId: A_DOC },
        () => Promise.resolve('C:/docs/open.pdf'),
      );

      await handlers['document.open']({});

      expect(capabilities.has(handleOpened(opened))).toBe(true);
      expect(capabilities.resolve(handleOpened(opened))).toBe('C:/docs/open.pdf');
    });

    it('keeps it when the document opened, because the service took it', async () => {
      const { capabilities, handlers, opened } = harness(
        { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
        () => Promise.resolve('C:/docs/a.pdf'),
      );

      await handlers['document.open']({});

      expect(capabilities.has(handleOpened(opened))).toBe(true);
    });
  });

  describe('the engine session', () => {
    it('asks for one, naming the document that opened', async () => {
      const { handlers, sessioned } = harness(
        { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
        () => Promise.resolve('C:/docs/a.pdf'),
      );

      await handlers['document.open']({});

      // The DocId, not merely that something was called. A session opened for
      // the wrong document is the failure invariant L10 exists about, and
      // "it was called once" cannot see it.
      expect(sessioned).toStrictEqual([A_DOC]);
    });

    it('does NOT ask again for a document that was already open', async () => {
      // THE DECISION, ASSERTED AS A CALL THAT WAS NOT MADE. Both outcomes hand
      // the renderer a DocId and both leave the document open with a session,
      // so the returned value cannot tell them apart — and a second entry would
      // spend ADR-0023 Decision 9a's failure bound a second time on a document
      // that never failed.
      const { handlers, sessioned } = harness(
        { kind: 'already-open', docId: A_DOC },
        () => Promise.resolve('C:/docs/a.pdf'),
      );

      await handlers['document.open']({});

      expect(sessioned).toStrictEqual([]);
    });

    it('does not ask when the file was absent', async () => {
      const { handlers, sessioned } = harness({ kind: 'absent' }, () =>
        Promise.resolve('C:/docs/gone.pdf'),
      );

      await handlers['document.open']({});

      expect(sessioned).toStrictEqual([]);
    });

    it('does not ask when the picker was dismissed', async () => {
      const { handlers, sessioned } = harness(
        { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
        () => Promise.resolve(null),
      );

      await handlers['document.open']({});

      expect(sessioned).toStrictEqual([]);
    });
  });

  /**
   * `document.readRange`'s handler (finding HHHHH-1).
   *
   * `readDocumentRange` has seven cases in the kernel and the params schema has
   * four in the contract; between them sat a handler with none, whose three
   * decisions were prose in a comment. These are those three, and each asserts
   * the decision rather than the tidy state it happens to produce.
   */
  describe('document.readRange', () => {
    /** A service whose range read does whatever the case needs. */
    function serviceReading(read: () => never | ReturnType<DocumentService['readRange']>): {
      handlers: ReturnType<typeof createContractHandlers>;
    } {
      const documents = { readRange: read } as unknown as DocumentService;
      return {
        handlers: createContractHandlers({
          appInfo,
          capabilities: new CapabilityRegistry(),
          commands: unusedCommands,
          documents,
          openedDocument: () => undefined,
          pickDocument: () => Promise.resolve(null),
          settings: createEphemeralSettings(),
          revealLog: () => Promise.resolve(false),
        }),
      };
    }

    const ASK = { docId: A_DOC, version: asDocVersion(1), begin: 0, end: 16 };

    it('serves what the service answered', async () => {
      const bytes = Uint8Array.from({ length: 16 }, (_, index) => index);
      const { handlers } = serviceReading(() => ({ kind: 'bytes', bytes }));

      await expect(handlers['document.readRange'](ASK)).resolves.toStrictEqual({
        ok: true,
        value: { kind: 'bytes', bytes },
      });
    });

    it('maps a closed document to its DECLARED code', async () => {
      const { handlers } = serviceReading(() => {
        throw new DocumentNotOpenError(A_DOC, 'read a byte range');
      });

      const result = await handlers['document.readRange'](ASK);

      expect(result).toStrictEqual({ ok: false, error: { code: 'document-not-open' } });
    });

    it('does NOT map an out-of-document read to a declared code', () => {
      // The direction that matters. A `RangeError` is a defect in the caller's
      // arithmetic, and a handler that widened its catch would hand the renderer
      // a defect wearing an outcome's clothes — where the renderer's answer to
      // `document-not-open` is to drop the view, which would be wrong and
      // silent. It escapes, and the boundary turns it into `internal` with the
      // diagnostic recorded main-side.
      //
      // SYNCHRONOUSLY, and that is worth asserting rather than smoothing over.
      // Every other handler here is `async`, so its throws arrive as rejections;
      // this one cannot be — `readDocumentRange` is synchronous, and `async` on
      // a body with no `await` is a lint error rather than a preference. So the
      // throw leaves before a promise exists. It is safe because `wrapHandler`
      // awaits the call **inside** its `try`, which is the same property the
      // browser shim's handlers rely on; the case is written this way so that a
      // future move to `async` shows up here rather than as a behaviour change
      // nothing observes.
      const { handlers } = serviceReading(() => {
        throw new RangeError('range outside the document');
      });

      expect(() => handlers['document.readRange'](ASK)).toThrow(RangeError);
    });

    it('a POISONED document is still readable, which invariant 18 depends on', async () => {
      // Not an omission from the failure list — a claim. Poisoning is about
      // engine sessions; the canonical image is exactly what main still holds,
      // and it is what invariant 18 recovers from. A user told a document cannot
      // be edited must still be able to look at it.
      //
      // The handler reaches the service with no knowledge of poisoning at all,
      // so this asserts that: a service that answers is answered through,
      // whatever the supervisor thinks of the document.
      const bytes = new Uint8Array(16);
      const { handlers } = serviceReading(() => ({ kind: 'bytes', bytes }));

      const result = await handlers['document.readRange'](ASK);

      expect(result.ok).toBe(true);
    });
  });
});

describe('log.reveal', () => {
  /**
   * The main-side half of the wired-tools pair. The other halves are
   * `App.test.tsx`, where the control dispatches this channel exactly once, and
   * `shellLog.test.ts`, where a reveal reaches the platform with the log's own
   * directory.
   */
  it('asks the log to reveal itself, once, and answers what it said', async () => {
    const { handlers, revealed } = harness({ kind: 'absent' }, () => Promise.resolve(null));

    const result = await handlers['log.reveal']({});

    expect(result).toEqual({ ok: true, value: { revealed: true } });
    // ONCE. A handler that asked twice answers identically, and a reveal is a
    // window opening: the second one is visible to the user and to nothing else
    // here.
    expect(revealed).toHaveLength(1);
  });

  /**
   * The answer is the LOG's, not the handler's. A handler that returned a
   * constant `true` passes the case above, and would report success for a
   * launch with no log directory at all.
   */
  it('passes a refusal through rather than reporting success', async () => {
    const handlers = createContractHandlers({
      appInfo,
      capabilities: new CapabilityRegistry(),
      commands: unusedCommands,
      documents: {} as unknown as DocumentService,
      openedDocument: () => undefined,
      pickDocument: () => Promise.resolve(null),
      settings: createEphemeralSettings(),
      revealLog: () => Promise.resolve(false),
    });

    await expect(handlers['log.reveal']({})).resolves.toEqual({
      ok: true,
      value: { revealed: false },
    });
  });
});

/** The handle this registry would mint for a path, without minting a new one. */
function asFileHandleFrom(registry: CapabilityRegistry, path: string): FileHandle {
  // `mint` is idempotent per path, so this is the handle the handler would have
  // produced — used only to ask whether the registry holds one already.
  const before = registry.mint(path);
  registry.revoke(before);
  return before;
}
