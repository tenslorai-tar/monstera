import { CapabilityRegistry, DocumentService } from '@monstera/kernel';
import { type DocId, type FileHandle, asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it, vi } from 'vitest';

import { type AppInfo, type PickDocument, createContractHandlers } from './contractHandlers.js';
import type { DocumentCommands } from './documentCommands.js';

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
  const handlers = createContractHandlers({
    appInfo,
    capabilities,
    commands: unusedCommands,
    documents,
    openedDocument: (docId) => sessioned.push(docId),
    pickDocument,
  });
  return { capabilities, handlers, opened, sessioned };
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
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024 },
      picked,
    );

    await handlers['document.open']({});

    expect(picked).toHaveBeenCalledWith();
  });

  it('reports cancellation as an outcome, and does not mint', async () => {
    const { capabilities, handlers, opened } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024 },
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
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024 },
      () => Promise.resolve('C:/docs/a.pdf'),
    );

    const result = await handlers['document.open']({});

    expect(result).toStrictEqual({
      ok: true,
      value: { kind: 'opened', docId: A_DOC, version: 1, byteLength: 1024 },
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
        { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024 },
        () => Promise.resolve('C:/docs/a.pdf'),
      );

      await handlers['document.open']({});

      expect(capabilities.has(handleOpened(opened))).toBe(true);
    });
  });

  describe('the engine session', () => {
    it('asks for one, naming the document that opened', async () => {
      const { handlers, sessioned } = harness(
        { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024 },
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
        { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024 },
        () => Promise.resolve(null),
      );

      await handlers['document.open']({});

      expect(sessioned).toStrictEqual([]);
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
