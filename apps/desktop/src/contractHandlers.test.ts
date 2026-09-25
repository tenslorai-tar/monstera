import {
  ACCESSIBILITY_HUMAN_CHECKS,
  BARCODE_FORMATS,
  MAX_BARCODE_TEXT,
  MAX_PAGE_BARCODES,
  RECENT_PREVIEWS_SETTING_ID,
} from '@monstera/contract';
import {
  HUMAN_CHECKS,
  CapabilityRegistry,
  DocumentNotOpenError,
  DocumentService,
  ENGINE_BARCODE_TEXT_MAX,
  ENGINE_BARCODES_MAX,
} from '@monstera/kernel';
import { BARCODE_WRITE_FORMATS } from '@monstera/kernel/barcode';
import {
  type DocId,
  type FileHandle,
  asDocId,
  asDocVersion,
  asFileHandle,
} from '@monstera/shared';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CloudOutcomeRefused, unconfiguredCloud } from './cloudSession.js';
import { type AppInfo, type PickDocument, createContractHandlers } from './contractHandlers.js';
import type { KnownRoot } from './displayLocation.js';
import { NO_RECENT_PICTURES, createRecentPictures } from './recentPictures.js';
import type { DocumentCommands } from './documentCommands.js';
import { createRecentFiles } from './recentFiles.js';
import { createEphemeralSecrets } from './secretStore.js';
import { createAssistant } from './assistant.js';
import { type ChatHistory, noChatHistory } from './chatHistory.js';

/**
 * An assistant with no key and nowhere to push: these cases are about the other channels,
 * and `ai.ask` on it answers the refusal a machine with no provider key gives (ADR-0081).
 */
/** A machine that keeps no conversations — every case here that is not about history. */
const NO_HISTORY = noChatHistory();

const INERT_ASSISTANT = createAssistant({
  secret: () => undefined,
  setting: () => undefined,
  send: () => undefined,
});
import { createEphemeralSettings } from './settingsFile.js';

const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' };

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

/** What the harness's page image answers: a JPEG's first two bytes, enough to be told apart from nothing. */
const PAGE_ONE_JPEG = Uint8Array.of(0xff, 0xd8, 0x01);

/** When every opening in {@link harness} happens. */
const OPENED_AT = new Date('2026-09-25T08:00:00.000Z');

/** One known folder, platform-absolute for `displayLocation.test.ts`'s reason. */
const RECENT_ROOTS: readonly KnownRoot[] = [{ within: 'documents', path: resolve('home', 'Documents'), showsFolder: true }];

function harness(outcome: OpenOutcome, pickDocument: PickDocument) {
  const capabilities = new CapabilityRegistry();
  const { documents, opened } = serviceAnswering(outcome);
  // RECORDED RATHER THAN IGNORED. Whether a document gets an engine session is
  // decided by this call being made, and the outcomes it must NOT be made for
  // produce exactly the same handler result as the one it must.
  const sessioned: DocId[] = [];
  const revealed: boolean[] = [];
  // RECORDED for `sessioned`'s reason: the handler forwards one argument, and a handler that dropped
  // it would answer exactly what a correct one answers.
  const webPages: string[] = [];
  const settings = createEphemeralSettings();
  const secrets = createEphemeralSecrets();
  // RETURNED, like `settings`, so a case can read what the handlers recorded
  // rather than assert that a call was made.
  // A FIXED CLOCK, so a case asserts the instant an opening was stamped with rather than that one was.
  const recent = createRecentFiles(createEphemeralSettings(), () => OPENED_AT);
  // THE REAL PICTURE STORE over a folder held in memory, wired as the composition root wires it, so a case
  // reads what a capture kept and what a removal deleted rather than that a call was made.
  const pictureFolder = new Map<string, Uint8Array<ArrayBuffer>>();
  const pictures = createRecentPictures({
    files: {
      // A COPY, as a file on disk is: what was written, not a view of the caller's buffer.
      write: (name, bytes) => pictureFolder.set(name, new Uint8Array(bytes)),
      read: (name) => pictureFolder.get(name) ?? null,
      remove: (name) => pictureFolder.delete(name),
      names: () => [...pictureFolder.keys()],
    },
    picture: () => Promise.resolve(PAGE_ONE_JPEG),
    enabled: () => settings.read()[RECENT_PREVIEWS_SETTING_ID] !== false,
    listed: (path) => recent.has(path),
    notKept: () => undefined,
  });
  recent.onDropped((paths) => {
    pictures.drop(paths);
  });
  const handlers = createContractHandlers({
    assistant: INERT_ASSISTANT,
    appInfo,
    capabilities,
    commands: unusedCommands,
    documents,
    openedDocument: (docId) => {
      sessioned.push(docId);
      return Promise.resolve();
    },
    // `not-locked` IS THE ORDINARY DOCUMENT'S ANSWER, so cases that never
    // mention encryption get the state every fixture here is in.
    unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
    pickDocument,
    recent,
    recentRoots: RECENT_ROOTS,
    recentPictures: pictures,
    // RETURNED, so cases about persistence read the same object the handlers
    // wrote rather than a second copy. `settings.save` answering `stored: true`
    // is a claim about a surface having accepted the values, and a test that
    // could not look at the surface would be asserting the call was made.
    settings,
    // RETURNED TOO, for `settings`' reason and one of its own: the property
    // these channels exist for is that a secret is in the OTHER document, and
    // a case can only assert that if it can read both.
    secrets,
    chatHistory: NO_HISTORY,
    pickSettingsFile: () => Promise.resolve(null),
    // COUNTED, so a case can assert the handler asked exactly once rather than
    // that it answered something.
    titleBarOverlay: () => false,
    confirmClose: () => false,
    copySelection: () => false,
    copyText: () => false,
    openWebPage: (page) => {
      webPages.push(page);
      return Promise.resolve(true);
    },
    closeListening: () => false,
    cloud: unconfiguredCloud(),
    revealLog: () => {
      revealed.push(true);
      return Promise.resolve(true);
    },
    // TWO WORDS AND AN AFFIX LINE, so the handler's answer can be asserted as
    // the dictionary it was handed rather than as *something came back*. The
    // absent case has its own harness below, because `null` here would make
    // every case in this file exercise the refusal.
    readDictionary: (language) =>
      Promise.resolve({
        affix: new TextEncoder().encode(`SET UTF-8\n${language}\n`),
        words: new TextEncoder().encode('1\ndocument\n'),
      }),
    // ONE MODEL, for `readDictionary`'s reason: the empty answer is the state a
    // machine with nothing provisioned is in, and a fixture in it would make
    // every case here exercise that one.
    ocrLanguages: () => Promise.resolve(['eng' as const]),
  });
  return { capabilities, handlers, opened, pictureFolder, recent, revealed, secrets, sessioned, settings, webPages };
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

/**
 * The contract's COPIES of the kernel's barcode set and bounds, held equal here — the one package
 * that can import both. A copy that exists must be proven equal (ADR-0076).
 */
describe('the barcode channels’ copies of the kernel’s set and bounds', () => {
  it('offers exactly the formats the writer writes, in its order', () => {
    expect([...BARCODE_FORMATS]).toStrictEqual([...BARCODE_WRITE_FORMATS]);
  });

  it('names the accessibility checks only a person can make as the kernel does (ADR-0078)', () => {
    expect([...ACCESSIBILITY_HUMAN_CHECKS]).toStrictEqual([...HUMAN_CHECKS]);
  });

  it('bounds the renderer’s wire as the engine host’s wire is bounded', () => {
    expect({ count: MAX_PAGE_BARCODES, text: MAX_BARCODE_TEXT }).toStrictEqual({
      count: ENGINE_BARCODES_MAX,
      text: ENGINE_BARCODE_TEXT_MAX,
    });
  });
});

describe('app.openWebPage', () => {
  it('passes the PLACE through and answers what the resolver said (ADR-0095)', async () => {
    // NO DOCUMENT ANYWHERE IN THIS CASE: the channel is about the application, not a file, so the
    // harness is given the outcome that opens nothing.
    const { handlers, webPages } = harness({ kind: 'absent' }, () => Promise.resolve(null));

    const answer = await handlers['app.openWebPage']({ page: 'donate' });

    // BOTH HALVES, and the first is the one that matters: this handler forwards a single argument,
    // and one that dropped it — opening whatever the resolver defaults to — would answer `opened:
    // true` exactly like a correct one. Only the recorded call separates them.
    expect(webPages).toStrictEqual(['donate']);
    expect(answer).toStrictEqual({ ok: true, value: { opened: true } });
  });
});

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
          assistant: INERT_ASSISTANT,
          appInfo,
          capabilities: new CapabilityRegistry(),
          commands: unusedCommands,
          documents,
          openedDocument: () => Promise.resolve(),
          unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
          pickDocument: () => Promise.resolve(null),
          recent: createRecentFiles(createEphemeralSettings()),
          recentRoots: [],
          recentPictures: NO_RECENT_PICTURES,
          settings: createEphemeralSettings(),
          secrets: createEphemeralSecrets(),
          chatHistory: NO_HISTORY,
          pickSettingsFile: () => Promise.resolve(null),
          revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
    cloud: unconfiguredCloud(),
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
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

describe('document.openDropped (ADR-0099)', () => {
  // PLATFORM-ABSOLUTE, because CI runs this on Linux too and `isAbsolute` is the platform's: a literal
  // `C:/…` is relative there, and every case below would take the refusal for the wrong reason.
  const DROPPED = resolve('dropped', 'a.pdf');
  const OPENED: OpenOutcome = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' };
  const NO_PICKER: PickDocument = () => Promise.reject(new Error('a drop must never run the picker'));

  it('opens the dropped path by the ONE route: that handle, the recent list and a session', async () => {
    const { capabilities, handlers, opened, recent, sessioned } = harness(OPENED, NO_PICKER);

    const result = await handlers['document.openDropped']({ path: DROPPED });

    expect(result).toStrictEqual({ ok: true, value: { kind: 'opened', docId: A_DOC, version: 1, byteLength: 1024, name: 'a.pdf' } });
    // THE HANDLE RESOLVES TO THE DROPPED PATH, not merely *a* handle was opened.
    expect(capabilities.resolve(handleOpened(opened))).toBe(DROPPED);
    expect(recent.list()).toStrictEqual([{ path: DROPPED, name: 'a.pdf', openedAt: OPENED_AT.toISOString() }]);
    expect(sessioned).toStrictEqual([A_DOC]);
  });

  it('answers what the one route answers, and revokes the handle for a file that is gone', async () => {
    const { capabilities, handlers, opened } = harness({ kind: 'absent' }, NO_PICKER);

    const result = await handlers['document.openDropped']({ path: DROPPED });

    expect(result).toStrictEqual({ ok: true, value: { kind: 'absent' } });
    expect(capabilities.has(handleOpened(opened))).toBe(false);
  });

  it.each([
    ['an EMPTY path, which is what getPathForFile answers for a File that no drop gave', ''],
    ['a RELATIVE path, which would resolve against wherever main happens to be', join('dropped', 'a.pdf')],
  ])('refuses %s by name, and asks the service for nothing', async (_label, path) => {
    // AN OUTCOME THE SERVICE WOULD OPEN, so the refusal is the handler's decision and not the service's answer.
    const { handlers, opened, recent } = harness(OPENED, NO_PICKER);

    const result = await handlers['document.openDropped']({ path });

    expect(result).toStrictEqual({ ok: true, value: { kind: 'no-path' } });
    // THE CALL THAT WAS NOT MADE: a handler that opened the path and then answered `no-path` would pass the
    // line above.
    expect(opened).toStrictEqual([]);
    expect(recent.list()).toStrictEqual([]);
  });
});

describe('the recent cards’ pictures (ADR-0100)', () => {
  const OPENED: OpenOutcome = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' };

  /** Opens `C:/docs/a.pdf`, waits for its picture, and answers the list's handle for it. */
  async function openedWithPicture(
    parts: ReturnType<typeof harness>,
  ): Promise<ReturnType<typeof parts.capabilities.mint>> {
    await parts.handlers['document.open']({});
    // THE CAPTURE FOLLOWS THE SESSION, off the open's own answer, so the case waits for its effect.
    await vi.waitFor(() => {
      expect(parts.pictureFolder.size).toBe(1);
    });
    const listed = await parts.handlers['document.recent']({});
    if (!listed.ok || listed.value.entries[0] === undefined) throw new Error('the open was not listed');
    return listed.value.entries[0].handle;
  }

  it('an OPEN leaves a picture of page 1, and the card reads it back by the list’s handle', async () => {
    const parts = harness(OPENED, () => Promise.resolve('C:/docs/a.pdf'));
    const handle = await openedWithPicture(parts);

    const preview = await parts.handlers['document.recentPreview']({ handle });

    expect(preview).toStrictEqual({ ok: true, value: { kind: 'picture', jpeg: PAGE_ONE_JPEG } });
  });

  it('*Clear list* empties the list AND deletes the picture in the same step', async () => {
    const parts = harness(OPENED, () => Promise.resolve('C:/docs/a.pdf'));
    const handle = await openedWithPicture(parts);

    const cleared = await parts.handlers['document.clearRecent']({});

    expect(cleared).toStrictEqual({ ok: true, value: { cleared: 1 } });
    expect(parts.pictureFolder.size).toBe(0);
    expect(await parts.handlers['document.recentPreview']({ handle })).toStrictEqual({ ok: true, value: { kind: 'none' } });
  });

  it('turning the Privacy setting OFF deletes every picture with the write that turned it off', async () => {
    const parts = harness(OPENED, () => Promise.resolve('C:/docs/a.pdf'));
    const handle = await openedWithPicture(parts);

    await parts.handlers['settings.save']({ values: { [RECENT_PREVIEWS_SETTING_ID]: false } });

    expect(parts.pictureFolder.size).toBe(0);
    expect(await parts.handlers['document.recentPreview']({ handle })).toStrictEqual({ ok: true, value: { kind: 'none' } });
  });

  it('a handle this run did not mint answers none, and names no file', async () => {
    const parts = harness(OPENED, () => Promise.resolve('C:/docs/a.pdf'));
    await openedWithPicture(parts);

    const preview = await parts.handlers['document.recentPreview']({ handle: asFileHandle('never-minted') });

    expect(preview).toStrictEqual({ ok: true, value: { kind: 'none' } });
  });
});

describe('the recent list', () => {
  it('RECORDS an opened document, with the name and not the path', async () => {
    const { handlers, recent } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      () => Promise.resolve('C:/docs/a.pdf'),
    );

    await handlers['document.open']({});

    // The store holds the path — it is main's and never crosses — and the name
    // beside it. Asserting both is what separates *recorded something* from
    // *recorded the right thing*.
    // AND WHEN, from the injected clock: the time is recorded at the opening, not read from the file.
    expect(recent.list()).toStrictEqual([{ path: 'C:/docs/a.pdf', name: 'a.pdf', openedAt: OPENED_AT.toISOString() }]);
  });

  it('does NOT record a document that failed to open', async () => {
    // The control, and it is the direction that matters: a list that recorded
    // every pick would offer the reader files that are not there, which is the
    // one thing a recent list must not do.
    const { handlers, recent } = harness({ kind: 'absent' }, () =>
      Promise.resolve('C:/docs/gone.pdf'),
    );

    await handlers['document.open']({});

    expect(recent.list()).toStrictEqual([]);
  });

  it('answers with a HANDLE per entry and no path anywhere in the payload', async () => {
    // Invariant L2 at the one place this feature could break it: the list main
    // holds is paths, and what crosses is capabilities. A payload carrying a
    // path would satisfy every other assertion here.
    const { capabilities, handlers } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      () => Promise.resolve('C:/docs/a.pdf'),
    );
    await handlers['document.open']({});

    const listed = await handlers['document.recent']({});

    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.entries).toHaveLength(1);
    expect(listed.value.entries[0]?.name).toBe('a.pdf');
    // The handle RESOLVES to the path, which is what makes it the right handle
    // rather than any handle — and the payload's own text holds no path.
    const handle = listed.value.entries[0]?.handle;
    expect(handle === undefined ? undefined : capabilities.resolve(handle)).toBe('C:/docs/a.pdf');
    expect(JSON.stringify(listed.value)).not.toContain('C:/docs');
  });

  it('answers WHERE each entry is and WHEN it was opened, and still no path (ADR-0100)', async () => {
    const path = resolve('home', 'Documents', 'Leases', 'a.pdf');
    const { handlers } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      () => Promise.resolve(path),
    );
    await handlers['document.open']({});

    const listed = await handlers['document.recent']({});

    if (!listed.ok) throw new Error('document.recent refused');
    const [entry] = listed.value.entries;
    // THE KNOWN FOLDER AS A KEY and the folder's own name — not *Documents › Leases* as text, and not the path.
    expect(entry?.location).toStrictEqual({ within: 'documents', folder: 'Leases' });
    expect(entry?.openedAt).toBe(OPENED_AT.toISOString());
    expect(JSON.stringify(listed.value)).not.toContain(resolve('home'));
  });

  it('reopens by the handle the list carried, without a picker', async () => {
    const picked = vi.fn<PickDocument>(() => Promise.resolve('C:/docs/a.pdf'));
    const { capabilities, handlers, opened } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      picked,
    );
    await handlers['document.open']({});
    // `mint` rather than `asFileHandleFrom`, which revokes what it minted: this
    // case needs the LIVE handle the open produced, and minting is idempotent
    // per path, so this is that handle rather than a second one.
    const handle = capabilities.mint('C:/docs/a.pdf');

    const result = await handlers['document.openRecent']({ handle });

    expect(result.ok).toBe(true);
    // THE PICKER WAS NOT ASKED AGAIN. Without this the case passes for a
    // handler that ignores its parameter and opens whatever the picker says,
    // which is a recent list that opens the wrong document.
    expect(picked).toHaveBeenCalledTimes(1);
    expect(opened).toStrictEqual([handle, handle]);
  });

  it('REFUSES a handle this run never minted, rather than reporting a defect', async () => {
    // The registry is per-run, so a renderer holding a list from before a
    // reload names handles that resolve to nothing. That is an outcome a
    // surface acts on by asking for the list again — an `internal` with an
    // incident id would be a defect report for an ordinary event.
    const { handlers } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' },
      () => Promise.resolve('C:/docs/a.pdf'),
    );

    const result = await handlers['document.openRecent']({ handle: asFileHandle('not-minted') });

    expect(result).toStrictEqual({ ok: false, error: { code: 'unknown-handle' } });
  });

  it('FORGETS an entry whose file has gone', async () => {
    // `absent` for a recent entry means the file moved or was deleted since it
    // was opened. Leaving it would offer the reader the same dead row on every
    // launch, for ever.
    const capabilities = new CapabilityRegistry();
    const handle = capabilities.mint('C:/docs/gone.pdf');
    const { documents } = serviceAnswering({ kind: 'absent' });
    const recent = createRecentFiles(createEphemeralSettings());
    recent.record({ path: 'C:/docs/gone.pdf', name: 'gone.pdf' });
    const handlers = createContractHandlers({
      assistant: INERT_ASSISTANT,
      appInfo,
      capabilities,
      commands: unusedCommands,
      documents,
      openedDocument: () => Promise.resolve(),
      unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
      pickDocument: () => Promise.resolve(null),
      recent,
      recentRoots: [],
      recentPictures: NO_RECENT_PICTURES,
      settings: createEphemeralSettings(),
      secrets: createEphemeralSecrets(),
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
    cloud: unconfiguredCloud(),
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
    });

    await handlers['document.openRecent']({ handle });

    expect(recent.list()).toStrictEqual([]);
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
      assistant: INERT_ASSISTANT,
      appInfo,
      capabilities: new CapabilityRegistry(),
      commands: unusedCommands,
      documents: {} as unknown as DocumentService,
      openedDocument: () => Promise.resolve(),
      unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
      pickDocument: () => Promise.resolve(null),
      recent: createRecentFiles(createEphemeralSettings()),
      recentRoots: [],
      recentPictures: NO_RECENT_PICTURES,
settings: createEphemeralSettings(),
      secrets: createEphemeralSecrets(),
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
    cloud: unconfiguredCloud(),
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
    });

    await expect(handlers['log.reveal']({})).resolves.toEqual({
      ok: true,
      value: { revealed: false },
    });
  });
});

describe('ai.checkKey', () => {
  /** Handlers whose assistant asks a provider that answers `status` to a model-list request. */
  function checking(status: number) {
    const secrets = createEphemeralSecrets();
    secrets.write('ai.openai-key', 'the-working-key');
    const asked: string[] = [];
    const assistant = createAssistant({
      secret: (id) => secrets.read()[id],
      setting: () => undefined,
      send: () => undefined,
      fetchImpl: (_input, init) => {
        asked.push(String(new Headers(init?.headers).get('authorization')));
        return Promise.resolve(
          new Response(status === 200 ? JSON.stringify({ data: [{ id: 'gpt-x' }] }) : '{}', { status }),
        );
      },
    });
    const handlers = createContractHandlers({
      assistant,
      appInfo,
      capabilities: new CapabilityRegistry(),
      commands: unusedCommands,
      documents: {} as unknown as DocumentService,
      openedDocument: () => Promise.resolve(),
      unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
      pickDocument: () => Promise.resolve(null),
      recent: createRecentFiles(createEphemeralSettings()),
      recentRoots: [],
      recentPictures: NO_RECENT_PICTURES,
settings: createEphemeralSettings(),
      secrets,
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
      cloud: unconfiguredCloud(),
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
    });
    return { handlers, secrets, asked };
  }

  it('a REFUSED key never reaches the store: the key that was working is still the stored one', async () => {
    const { handlers, secrets, asked } = checking(401);
    const result = await handlers['ai.checkKey']({ provider: 'openai', key: 'a-typo' });
    expect(result).toEqual({ ok: true, value: { accepted: false, problem: 'unauthorised' } });
    expect(secrets.read()['ai.openai-key']).toBe('the-working-key');
    // THE CANDIDATE was what the provider was asked with — not the stored key, which would accept.
    expect(asked).toStrictEqual(['Bearer a-typo']);
  });

  it('CONTROL: an ACCEPTED key replaces the stored one', async () => {
    const { handlers, secrets } = checking(200);
    const result = await handlers['ai.checkKey']({ provider: 'openai', key: 'a-new-key' });
    expect(result).toEqual({ ok: true, value: { accepted: true } });
    expect(secrets.read()['ai.openai-key']).toBe('a-new-key');
  });
});

describe('ai.translatePage (ADR-0097)', () => {
  const DOC = asDocId('00000000-0000-4000-8000-0000000000b7');
  const run = (index: number, text: string) => ({ index, text });
  const box = { x0: 0, y0: 0, x1: 100, y1: 10 };
  /**
   * Two blocks: a heading of one line, and a paragraph of two lines of two runs whose first line
   * ends SHORT — at 50 of 100, where `within` (about 37 wide on the next line's measure) would have
   * fitted — so its break is a hard one and the text keeps it (ADR-0097 4c).
   */
  const BLOCKS = [
    { box, style: undefined, lines: [{ box, runs: [run(3, 'Invoice')] }] },
    {
      box,
      style: undefined,
      lines: [
        { box: { x0: 0, y0: 0, x1: 50, y1: 10 }, runs: [run(5, 'Payment is '), run(6, 'due')] },
        { box: { x0: 0, y0: 0, x1: 80, y1: 10 }, runs: [run(8, 'within 30 days.')] },
      ],
    },
  ];

  /**
   * Handlers whose page holds `blocks` and whose provider answers `reply` as a streamed OpenAI-format
   * answer (or `status` when not 200), recording what it was asked.
   */
  function translating(blocks: readonly unknown[], replies: string | readonly string[], status = 200) {
    /** One reply per ask, the last repeated — so a case can make the first answer unreadable. */
    const sequence = typeof replies === 'string' ? [replies] : replies;
    const secrets = createEphemeralSecrets();
    secrets.write('ai.openai-key', 'a-key');
    const asked: { system: string; user: string }[] = [];
    const assistant = createAssistant({
      secret: (id) => secrets.read()[id],
      setting: () => undefined,
      send: () => undefined,
      fetchImpl: ((_url: string, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}') as { messages: { role: string; content: string }[] };
        asked.push({
          system: body.messages.find((message) => message.role === 'system')?.content ?? '',
          user: body.messages.find((message) => message.role === 'user')?.content ?? '',
        });
        const reply = sequence[Math.min(asked.length - 1, sequence.length - 1)] ?? '';
        const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`;
        return Promise.resolve(new Response(status === 200 ? chunk : '{}', { status }));
      }) as unknown as typeof fetch,
    });
    const commands = {
      textBlocks: (docId: DocId) =>
        docId === DOC
          ? Promise.resolve({ version: asDocVersion(7), blocks, truncated: false, rotated: 0, unaddressable: 0 })
          : Promise.reject(new DocumentNotOpenError(docId, 'read its text blocks')),
    } as unknown as DocumentCommands;
    const handlers = createContractHandlers({
      assistant,
      appInfo,
      capabilities: new CapabilityRegistry(),
      commands,
      documents: {} as unknown as DocumentService,
      openedDocument: () => Promise.resolve(),
      unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
      pickDocument: () => Promise.resolve(null),
      recent: createRecentFiles(createEphemeralSettings()),
      recentRoots: [],
      recentPictures: NO_RECENT_PICTURES,
settings: createEphemeralSettings(),
      secrets,
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
      cloud: unconfiguredCloud(),
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
    });
    return { handlers, asked };
  }
  const ASK = { docId: DOC, page: 2, provider: 'openai', model: 'gpt-x', language: 'fr' } as const;

  it('asks once with each block as lineText joins it, and answers ONLY the blocks that changed', async () => {
    // THE SECOND BLOCK COMES BACK UNCHANGED, so a handler that answered every block would rewrite
    // it for nothing — the case separates *changed* from *answered*.
    const { handlers, asked } = translating(
      BLOCKS,
      JSON.stringify(['Facture', 'Payment is due\nwithin 30 days.']),
    );

    const result = await handlers['ai.translatePage'](ASK);

    expect(result).toStrictEqual({
      ok: true,
      value: { kind: 'translated', version: 7, blocks: [{ lines: [[3]], text: 'Facture' }] },
    });
    expect(asked).toHaveLength(1);
    // THE BLOCKS AS THE KERNEL WILL DIFF THEM: runs joined as they are, lines by a line break.
    expect(JSON.parse(asked[0]?.user ?? '[]')).toStrictEqual(['Invoice', 'Payment is due\nwithin 30 days.']);
    expect(asked[0]?.system).toContain('into French');
  });

  it('an answer of the WRONG LENGTH is refused as unreadable — after ONE more ask, never matched by guess', async () => {
    const { handlers, asked } = translating(BLOCKS, JSON.stringify(['Facture']));
    expect(await handlers['ai.translatePage'](ASK)).toStrictEqual({
      ok: true,
      value: { kind: 'refused', problem: 'unreadable' },
    });
    // TWICE AND NO MORE: a third ask would be paying again for the same slip.
    expect(asked).toHaveLength(2);
  });

  it('an unreadable FIRST answer is asked again, and a readable second one is written', async () => {
    const { handlers, asked } = translating(BLOCKS, ['not an array', JSON.stringify(['Facture', 'Payment is due\nwithin 30 days.'])]);
    expect(await handlers['ai.translatePage'](ASK)).toStrictEqual({
      ok: true,
      value: { kind: 'translated', version: 7, blocks: [{ lines: [[3]], text: 'Facture' }] },
    });
    expect(asked).toHaveLength(2);
  });

  it('a provider REFUSAL is not asked again', async () => {
    const { handlers, asked } = translating(BLOCKS, '', 401);
    await handlers['ai.translatePage'](ASK);
    expect(asked).toHaveLength(1);
  });

  it('the provider’s own refusal crosses by name', async () => {
    const { handlers } = translating(BLOCKS, '', 401);
    expect(await handlers['ai.translatePage'](ASK)).toStrictEqual({
      ok: true,
      value: { kind: 'refused', problem: 'unauthorised' },
    });
  });

  it('a page with no editable text is nothing to translate, and the provider is NOT asked', async () => {
    // THE CALL NOT MADE is the assertion: sending an empty array would still be a request a
    // person pays for.
    const { handlers, asked } = translating([], JSON.stringify([]));
    expect(await handlers['ai.translatePage'](ASK)).toStrictEqual({
      ok: true,
      value: { kind: 'nothing-to-translate' },
    });
    expect(asked).toStrictEqual([]);
  });

  it('a document that is not open is refused by its code', async () => {
    const { handlers } = translating(BLOCKS, '[]');
    const other = asDocId('00000000-0000-4000-8000-0000000000b8');
    expect(await handlers['ai.translatePage']({ ...ASK, docId: other })).toStrictEqual({
      ok: false,
      error: { code: 'document-not-open' },
    });
  });
});

describe('ai.history (ADR-0093)', () => {
  const DOC = asDocId('00000000-0000-4000-8000-0000000000a9');

  function withHistory(on: boolean) {
    const saved = new Map<string, readonly { role: 'user' | 'assistant'; text: string }[]>();
    const history: ChatHistory = {
      available: () => true,
      load: (key) => saved.get(key) ?? [],
      save: (key, turns) => {
        saved.set(key, turns);
      },
      clear: () => {
        const count = saved.size;
        saved.clear();
        return count;
      },
    };
    const settings = createEphemeralSettings();
    settings.write({ 'ai.save-history': on });
    const handlers = createContractHandlers({
      assistant: INERT_ASSISTANT,
      appInfo,
      capabilities: new CapabilityRegistry(),
      commands: unusedCommands,
      // THE KERNEL'S DIGEST, faked: one open document whose file key is `file-key`.
      documents: { historyKeyOf: (docId: DocId) => (docId === DOC ? 'file-key' : undefined) } as unknown as DocumentService,
      openedDocument: () => Promise.resolve(),
      unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
      pickDocument: () => Promise.resolve(null),
      recent: createRecentFiles(createEphemeralSettings()),
      recentRoots: [],
      recentPictures: NO_RECENT_PICTURES,
settings,
      secrets: createEphemeralSecrets(),
      chatHistory: history,
      pickSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
      cloud: unconfiguredCloud(),
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
    });
    return { handlers, saved };
  }

  const TURNS = [{ role: 'user' as const, text: 'Q' }];

  it('with the setting OFF, a save stores NOTHING, whatever the renderer asked', async () => {
    const { handlers, saved } = withHistory(false);
    await expect(handlers['ai.history.save']({ docId: DOC, turns: TURNS })).resolves.toEqual({ ok: true, value: { saved: false } });
    expect(saved.size).toBe(0);
  });

  it('CONTROL: with it ON, the same save is stored under the FILE key and loads back', async () => {
    const { handlers, saved } = withHistory(true);
    await expect(handlers['ai.history.save']({ docId: DOC, turns: TURNS })).resolves.toEqual({ ok: true, value: { saved: true } });
    expect([...saved.keys()]).toStrictEqual(['file-key']);
    await expect(handlers['ai.history.load']({ docId: DOC })).resolves.toEqual({ ok: true, value: { turns: TURNS } });
  });

  it('a document that is not open is refused by name, and clear says how many went', async () => {
    const { handlers } = withHistory(true);
    await handlers['ai.history.save']({ docId: DOC, turns: TURNS });
    const other = asDocId('00000000-0000-4000-8000-0000000000aa');
    const refused = await handlers['ai.history.load']({ docId: other });
    expect(refused.ok).toBe(false);
    await expect(handlers['ai.history.clear']({})).resolves.toEqual({ ok: true, value: { cleared: 1 } });
  });
});

/**
 * `cloud.saveBack`'s half of the save-back pair: main answers the version it saved, whenever it
 * saved. The renderer's half — that the version clears the tab's dot — is `cloudStorage.test.ts`'.
 */
describe('cloud.saveBack', () => {
  const DOC = asDocId('00000000-0000-4000-8000-0000000000b1');

  function withCloud(upload: () => Promise<void>, saved: 'saved' | 'write-failed') {
    const uploaded: Uint8Array[] = [];
    // A DOCUMENT WITH A CLOUD ORIGIN, faked at the surface: which provider it came from and what
    // happens to the upload are the only two things this handler asks of it.
    const cloud = {
      ...unconfiguredCloud(),
      originOf: (docId: DocId) => (docId === DOC ? ('onedrive' as const) : null),
      saveBack: (_docId: DocId, pdf: Uint8Array) => {
        uploaded.push(pdf);
        return upload();
      },
    };
    const commands = {
      save: () =>
        Promise.resolve(saved === 'saved' ? { kind: 'saved' as const, version: asDocVersion(9) } : { kind: 'write-failed' as const }),
      currentImage: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    } as unknown as DocumentCommands;
    const handlers = createContractHandlers({
      assistant: INERT_ASSISTANT,
      appInfo,
      capabilities: new CapabilityRegistry(),
      commands,
      documents: {} as unknown as DocumentService,
      openedDocument: () => Promise.resolve(),
      unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
      pickDocument: () => Promise.resolve(null),
      recent: createRecentFiles(createEphemeralSettings()),
      recentRoots: [],
      recentPictures: NO_RECENT_PICTURES,
settings: createEphemeralSettings(),
      secrets: createEphemeralSecrets(),
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      copySelection: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      closeListening: () => false,
      cloud,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
    });
    return { handlers, uploaded };
  }

  it('a save-back that landed answers THE VERSION IT SAVED, as `document.save` does', async () => {
    const { handlers, uploaded } = withCloud(() => Promise.resolve(), 'saved');
    await expect(handlers['cloud.saveBack']({ docId: DOC })).resolves.toEqual({
      ok: true,
      value: { kind: 'saved-back', version: asDocVersion(9) },
    });
    expect(uploaded).toHaveLength(1);
  });

  it('a refusal AFTER the working copy was saved still names the version, and the refusal', async () => {
    const { handlers } = withCloud(() => Promise.reject(new CloudOutcomeRefused('changed-elsewhere')), 'saved');
    await expect(handlers['cloud.saveBack']({ docId: DOC })).resolves.toEqual({
      ok: true,
      value: { kind: 'refused', reason: 'changed-elsewhere', version: asDocVersion(9) },
    });
  });

  it('CONTROL: a save that did not land names no version and SENDS NOTHING', async () => {
    const { handlers, uploaded } = withCloud(() => Promise.resolve(), 'write-failed');
    await expect(handlers['cloud.saveBack']({ docId: DOC })).resolves.toEqual({ ok: true, value: { kind: 'save-failed' } });
    expect(uploaded).toHaveLength(0);
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
