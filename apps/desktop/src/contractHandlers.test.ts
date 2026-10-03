import {
  ACCESSIBILITY_HUMAN_CHECKS,
  AZURE_KEY_SETTING_ID,
  BARCODE_FORMATS,
  MAX_BARCODE_TEXT,
  MAX_IMAGE_BYTES,
  MAX_LIBRARY_PICTURE_BYTES,
  MAX_OFFICE_MISSING_BLOCKS,
  MAX_PAGE_BARCODES,
  MAX_SETTINGS_FILE_BYTES,
  RECENT_CHECK_CAP_MS,
  RECENT_PREVIEWS_SETTING_ID,
  blockEditOf,
  channels,
} from '@monstera/contract';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  HUMAN_CHECKS,
  CapabilityRegistry,
  DocumentBusyError,
  DocumentNotOpenError,
  DocumentService,
  ENGINE_BARCODE_TEXT_MAX,
  ENGINE_BARCODES_MAX,
  type IdentityReader,
  StaleTargetError,
  TextNotWritableError,
  readFileIdentity,
} from '@monstera/kernel';
import { BARCODE_WRITE_FORMATS } from '@monstera/kernel/barcode';
import {
  type DocId,
  type FileHandle,
  asDocId,
  asDocVersion,
  asFileHandle,
} from '@monstera/shared';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CloudOutcomeRefused, type CloudStorage, unconfiguredCloud } from './cloudSession.js';
import { type AttachmentReaders, NO_ATTACHMENTS } from './askAttachments.js';
import { type AppInfo, type PickDocument, createContractHandlers } from './contractHandlers.js';
import type { KnownRoot } from './displayLocation.js';
import { NO_RECENT_PICTURES, createRecentPictures } from './recentPictures.js';
import { createHeldPicture } from './heldPicture.js';
import { unusedLibrarySurface } from './personalLibrary.js';
import { NO_REVIEW_PROMPT, createEngagement, reviewPrompt } from './engagement.js';
import type { DocumentCommands, ImageRead } from './documentCommands.js';
import type { ScannedSignaturePicture } from './signaturePicture.js';
import { type LaunchDocuments, createLaunchDocuments } from './launchDocuments.js';
import { type RecentFiles, createRecentFiles } from './recentFiles.js';
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
  setting: (definition) => definition.fallback,
  send: () => undefined,
  openInBrowser: () => Promise.resolve(),
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
  closed: DocId[];
} {
  const opened: FileHandle[] = [];
  const closed: DocId[] = [];
  const documents = {
    open: (handle: FileHandle) => {
      opened.push(handle);
      return Promise.resolve(outcome);
    },
    close: (docId: DocId) => {
      closed.push(docId);
      return Promise.resolve();
    },
  } as unknown as DocumentService;
  return { documents, opened, closed };
}

/** What the harness's page image answers: a JPEG's first two bytes, enough to be told apart from nothing. */
const PAGE_ONE_JPEG = Uint8Array.of(0xff, 0xd8, 0x01);

/** When every opening in {@link harness} happens. */
const OPENED_AT = new Date('2026-09-25T08:00:00.000Z');

/** One known folder, platform-absolute for `displayLocation.test.ts`'s reason. */
const RECENT_ROOTS: readonly KnownRoot[] = [{ within: 'documents', path: resolve('home', 'Documents'), showsFolder: true }];

function harness(
  outcome: OpenOutcome,
  pickDocument: PickDocument,
  launchDocuments?: LaunchDocuments,
  /** The library surface and the document commands, for the cases about them; the unused ones otherwise. */
  overrides: {
    readonly library?: ReturnType<typeof unusedLibrarySurface>;
    readonly commands?: DocumentCommands;
    /** The settings file to import, for the import's cases; a dismissed picker otherwise. */
    readonly openSettingsFile?: () => Promise<string | null>;
    /** Cloud storage, for the cases about it; a build with no provider configured otherwise. */
    readonly cloud?: CloudStorage;
    /** The paperclip's picker and readers (ADR-0135); nothing picked and nothing readable otherwise. */
    readonly attachments?: { readonly pick: () => Promise<readonly string[]>; readonly readers: AttachmentReaders };
    /** Whether a path names a file (ADR-0143); the kernel's own `readFileIdentity` over the real disk otherwise. */
    readonly fileIdentity?: IdentityReader;
    /** The recent store, for a case about what a previous run left; a fresh one with a fixed clock otherwise. */
    readonly recent?: RecentFiles;
  } = {},
) {
  const capabilities = new CapabilityRegistry();
  const { documents, opened, closed } = serviceAnswering(outcome);
  // RECORDED RATHER THAN IGNORED. Whether a document gets an engine session is
  // decided by this call being made, and the outcomes it must NOT be made for
  // produce exactly the same handler result as the one it must.
  const sessioned: DocId[] = [];
  const revealed: boolean[] = [];
  // THE PATHS `file.reveal` asked to show, for `sessioned`'s reason: a handler that showed nothing answers as one that
  // showed the wrong file would, unless the path itself is read.
  const shown: string[] = [];
  // RECORDED for `sessioned`'s reason: the handler forwards one argument, and a handler that dropped
  // it would answer exactly what a correct one answers.
  const webPages: string[] = [];
  const settings = createEphemeralSettings();
  const secrets = createEphemeralSecrets();
  // RETURNED, like `settings`, so a case can read what the handlers recorded
  // rather than assert that a call was made.
  // A FIXED CLOCK, so a case asserts the instant an opening was stamped with rather than that one was.
  const recent = overrides.recent ?? createRecentFiles(createEphemeralSettings(), () => OPENED_AT);
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
  // THE RATING PROMPT over a real record, launched twice ten days after install so it is due, and an opener
  // that RECORDS what it was asked to open rather than answering yes blind.
  const engagementFile = createEphemeralSettings();
  engagementFile.write({ installDate: OPENED_AT.getTime() - 10 * 86_400_000, sessions: 1 });
  const storeOpened: string[] = [];
  const prompt = reviewPrompt(
    createEngagement(engagementFile, { now: () => OPENED_AT, enabled: () => true }),
    () => {
      storeOpened.push('store review');
      return Promise.resolve(true);
    },
  );
  const handlers = createContractHandlers({
    assistant: INERT_ASSISTANT,
    appInfo,
    capabilities,
    commands: overrides.commands ?? unusedCommands,
    documents,
    ...(launchDocuments === undefined ? {} : { launchDocuments }),
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
    fileIdentity: overrides.fileIdentity ?? readFileIdentity,
    library: overrides.library ?? unusedLibrarySurface(),
    reviewPrompt: prompt,
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
    openSettingsFile: overrides.openSettingsFile ?? (() => Promise.resolve(null)),
    // COUNTED, so a case can assert the handler asked exactly once rather than
    // that it answered something.
    titleBarOverlay: () => false,
    confirmClose: () => false,
    edit: () => false,
    copyText: () => false,
    openWebPage: (page) => {
      webPages.push(page);
      return Promise.resolve(true);
    },
    openStore: () => Promise.resolve(false),
    closeListening: () => false,
    cloud: overrides.cloud ?? unconfiguredCloud(),
    attachments: overrides.attachments ?? NO_ATTACHMENTS,
    revealLog: () => {
      revealed.push(true);
      return Promise.resolve(true);
    },
    revealPath: (path) => {
      shown.push(path);
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
    components: () => Promise.resolve([]),
  });
  return {
    capabilities,
    closed,
    engagementFile,
    handlers,
    opened,
    pictureFolder,
    recent,
    revealed,
    secrets,
    sessioned,
    settings,
    shown,
    storeOpened,
    webPages,
  };
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

describe('the Store rating prompt (E3)', () => {
  it('is DUE for a record ten days old on its second session, and asking counts as the prompt shown', async () => {
    const { engagementFile, handlers } = harness({ kind: 'absent' }, () => Promise.resolve(null));

    expect(await handlers['app.reviewPrompt']({})).toStrictEqual({ ok: true, value: { due: true } });
    expect(await handlers['app.reviewPrompt']({})).toStrictEqual({ ok: true, value: { due: false } });
    expect(engagementFile.read()['promptCount']).toBe(1);
  });

  it('RATE opens the Store page through the one opener and never asks again', async () => {
    const { handlers, storeOpened } = harness({ kind: 'absent' }, () => Promise.resolve(null));

    expect(await handlers['app.review']({ action: 'rate' })).toStrictEqual({ ok: true, value: { opened: true } });
    expect(storeOpened).toStrictEqual(['store review']);
    expect(await handlers['app.reviewPrompt']({})).toStrictEqual({ ok: true, value: { due: false } });
  });

  it('LATER opens nothing, and the prompt waits', async () => {
    const { handlers, storeOpened } = harness({ kind: 'absent' }, () => Promise.resolve(null));

    expect(await handlers['app.review']({ action: 'later' })).toStrictEqual({ ok: true, value: { opened: false } });
    expect(storeOpened).toStrictEqual([]);
    expect(await handlers['app.reviewPrompt']({})).toStrictEqual({ ok: true, value: { due: false } });
  });
});

describe('the person’s library (library.*, and document.placeImage with a kept picture)', () => {
  const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 5);

  /** A library surface over a memory folder whose picker answers `picked` and whose reads are recorded. */
  function libraryPicking(
    picked: string | null,
    size: number,
    bytes: Uint8Array = PNG,
  ): {
    readonly surface: ReturnType<typeof unusedLibrarySurface>;
    readonly read: string[];
  } {
    const read: string[] = [];
    const surface = {
      ...unusedLibrarySurface(),
      pick: () => Promise.resolve(picked),
      size: () => Promise.resolve(size),
      read: (path: string) => {
        read.push(path);
        return Promise.resolve({ kind: 'read' as const, bytes });
      },
    } as unknown as ReturnType<typeof unusedLibrarySurface>;
    return { surface, read };
  }

  it('KEEPS a picked picture, named from the FILE’S name alone — never its folder', async () => {
    const { surface } = libraryPicking(join('C:', 'Users', 'someone', 'Pictures', 'Paid in full.png'), PNG.byteLength);
    const { handlers } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, { library: surface });
    const added = await handlers['library.addPicture']({ kind: 'stamp' });
    expect(added.ok && added.value.kind === 'added' ? added.value.entry.look : undefined).toStrictEqual({
      kind: 'picture',
      name: 'Paid in full',
    });
    const listed = await handlers['library.list']({ kind: 'stamp' });
    expect(listed.ok ? listed.value.entries : undefined).toHaveLength(1);
  });

  it('refuses a picture past the library’s bound by its SIZE, before reading it — CONTROL: one within it is read', async () => {
    const large = libraryPicking('big.png', MAX_LIBRARY_PICTURE_BYTES + 1);
    const refused = await harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
      library: large.surface,
    }).handlers['library.addPicture']({ kind: 'stamp' });
    expect(refused.ok ? refused.value : undefined).toStrictEqual({ kind: 'too-large', limitBytes: MAX_LIBRARY_PICTURE_BYTES });
    expect(large.read).toStrictEqual([]);

    const small = libraryPicking('small.png', MAX_LIBRARY_PICTURE_BYTES);
    await harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, { library: small.surface }).handlers[
      'library.addPicture'
    ]({ kind: 'stamp' });
    expect(small.read).toStrictEqual(['small.png']);
  });

  /**
   * The library surface with Upload's source answering `picked` — its read answering `read` and recording each path, its
   * scan answering `scan` and recording the bytes it was handed.
   */
  function signaturePicking(
    picked: string,
    read: ImageRead,
    scan: ScannedSignaturePicture | null = null,
  ): { readonly surface: ReturnType<typeof unusedLibrarySurface>; readonly read: string[]; readonly scanned: Uint8Array[] } {
    const reads: string[] = [];
    const scanned: Uint8Array[] = [];
    const surface = {
      ...unusedLibrarySurface(),
      held: createHeldPicture(),
      signaturePicture: {
        pick: () => Promise.resolve(picked),
        read: (path: string) => {
          reads.push(path);
          return Promise.resolve(read);
        },
        scan:
          scan === null
            ? null
            : (bytes: Uint8Array) => {
                scanned.push(bytes);
                return Promise.resolve(scan);
              },
      },
    };
    return { surface, read: reads, scanned };
  }

  it('signature.pickPicture HOLDS the bytes it answers, under the handle it answers (ADR-0133’s second correction)', async () => {
    const held = createHeldPicture();
    const { surface } = signaturePicking(join('C:', 'Users', 'someone', 'My signature.png'), { kind: 'read', bytes: PNG });
    const { handlers } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
      library: { ...surface, held },
    });
    const answer = await handlers['signature.pickPicture']({});
    if (!answer.ok || answer.value.kind !== 'picked') throw new Error(`no picture was picked: ${JSON.stringify(answer)}`);
    expect(answer.value.name).toBe('My signature.png');
    expect(answer.value.mediaType).toBe('image/png');
    // THE PREVIEW IS OF WHAT WILL BE PLACED: the slot holds exactly the bytes answered, under exactly that handle.
    expect(held.held(answer.value.handle)?.bytes).toStrictEqual(answer.value.bytes);
    expect(answer.value.bytes).toStrictEqual(PNG);
  });

  it('signature.pickPicture refuses what is not a picture BY ITS BYTES and holds nothing — CONTROL: past the bound, the read’s answer', async () => {
    const held = createHeldPicture();
    // NAMED .png AND READ IN FULL: the bytes are a PDF's header, so only a type read from the bytes refuses it — and a
    // .png is never sent to the compose host, whose scan here would answer a picture.
    const notAPicture = signaturePicking('a picture.png', { kind: 'read', bytes: Uint8Array.of(0x25, 0x50, 0x44, 0x46) }, {
      kind: 'drawn',
      png: PNG,
    });
    const refused = await harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
      library: { ...notAPicture.surface, held },
    }).handlers['signature.pickPicture']({});
    expect(refused.ok ? refused.value : undefined).toStrictEqual({ kind: 'unreadable' });
    expect(notAPicture.scanned).toStrictEqual([]);
    // THE BOUND IS THE READ'S, `readImage`'s, which sizes a file before reading it: one opinion about it, not two.
    const large = signaturePicking('huge.png', { kind: 'too-large', byteLength: MAX_IMAGE_BYTES + 1 });
    const tooLarge = await harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
      library: { ...large.surface, held },
    }).handlers['signature.pickPicture']({});
    expect(tooLarge.ok ? tooLarge.value : undefined).toStrictEqual({ kind: 'too-large', limitBytes: MAX_IMAGE_BYTES });
    // NOTHING HELD by either refusal, so no later placement can find a picture the person was told was refused.
    expect(held.held(asFileHandle('anything'))).toBeUndefined();
  });

  it('signature.pickPicture sends a SCANNED PDF to the compose host and holds the PNG it answers, never the PDF (G3d)', async () => {
    const held = createHeldPicture();
    const pdf = new TextEncoder().encode('%PDF-1.7 a scanned signature');
    const picking = signaturePicking(join('C:', 'Scans', 'Signature.PDF'), { kind: 'read', bytes: pdf }, { kind: 'drawn', png: PNG });
    const answer = await harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
      library: { ...picking.surface, held },
    }).handlers['signature.pickPicture']({});
    if (!answer.ok || answer.value.kind !== 'picked') throw new Error(`no picture was picked: ${JSON.stringify(answer)}`);
    // AN UPPER-CASE EXTENSION routes the same way, and the PDF's own bytes are what the host was handed.
    expect(picking.scanned).toStrictEqual([pdf]);
    expect(answer.value).toMatchObject({ name: 'Signature.PDF', mediaType: 'image/png', bytes: PNG });
    expect(held.held(answer.value.handle)?.bytes).toStrictEqual(PNG);
  });

  it('signature.pickPicture says a scanned PDF with no ink, or a password, and holds nothing', async () => {
    const pdf = new TextEncoder().encode('%PDF-1.7');
    for (const kind of ['blank', 'locked'] as const) {
      const held = createHeldPicture();
      const picking = signaturePicking('scan.pdf', { kind: 'read', bytes: pdf }, { kind });
      const answer = await harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
        library: { ...picking.surface, held },
      }).handlers['signature.pickPicture']({});
      expect(answer.ok ? answer.value : undefined).toStrictEqual({ kind: `scan-${kind}` });
      expect(held.held(asFileHandle('anything'))).toBeUndefined();
    }
  });

  it('FORWARDS a kept picture’s id to the placement — the delegate that could drop it, asserted at the handler', async () => {
    const requested: unknown[] = [];
    const commands = {
      placeImage: (_docId: DocId, request: unknown) => {
        requested.push(request);
        return Promise.resolve({ kind: 'absent' as const });
      },
    } as unknown as DocumentCommands;
    const { handlers } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, { commands });
    const picture = '00000000-0000-4000-8000-0000000000e1';
    const answer = await handlers['document.placeImage']({
      docId: asDocId('00000000-0000-4000-8000-0000000000e2'),
      pages: [0],
      rect: { x0: 1, y0: 1, x1: 20, y1: 20 },
      stamp: { author: 'A. Tester', created: '2026-09-28T12:00:00Z' },
      picture,
    });
    expect(answer.ok ? answer.value : undefined).toStrictEqual({ kind: 'absent' });
    expect(requested).toStrictEqual([
      { pages: [0], rect: { x0: 1, y0: 1, x1: 20, y1: 20 }, stamp: { author: 'A. Tester', created: '2026-09-28T12:00:00Z' }, picture },
    ]);
  });

  /**
   * `document.placeSignature`'s handler (ADR-0133), between the renderer's dispatch and main's placement. The renderer
   * half asserts the channel is called and the main half runs `placeSignature` directly; this is the step neither
   * crosses. `keep: true` and an outcome that is not the default `kept` are the inputs a handler dropping a field, or
   * answering for main, would get wrong.
   */
  it('FORWARDS a plain signature’s every field to main, answers main’s outcome as named, and says a busy document is busy', async () => {
    const docId = asDocId('00000000-0000-4000-8000-0000000000e3');
    const request = {
      page: 2,
      rect: { x0: 10, y0: 20, x1: 160, y1: 70 },
      // A TYPED NAME as the renderer sends it, its outline (ADR-0150).
      mark: {
        kind: 'outlined',
        text: 'Ada Lovelace',
        font: 'allura',
        outline: { ops: [0, 1, 1, 1, 4], points: [0, 100, 1000, 100, 1000, 400, 0, 400], frame: [0, 0, 1000, 500] },
      },
      keep: true,
      stamp: { author: 'A. Tester', created: '2026-10-02T12:00:00Z' },
    } satisfies Parameters<DocumentCommands['placeSignature']>[1];
    const PLACED = { kind: 'placed', version: asDocVersion(4), byteLength: 2048, historyDropped: 0, kept: 'not-keepable' } as const;
    const requested: unknown[] = [];
    let busy = false;
    const commands = {
      placeSignature: (on: DocId, made: unknown) => {
        requested.push({ on, made });
        if (busy) return Promise.reject(new DocumentBusyError(on, 64));
        return Promise.resolve(PLACED);
      },
    } as unknown as DocumentCommands;
    const { handlers } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, { commands });

    const answer = await handlers['document.placeSignature']({ docId, ...request });
    expect(answer).toStrictEqual({ ok: true, value: PLACED });
    expect(requested).toStrictEqual([{ on: docId, made: request }]);

    busy = true;
    expect(await handlers['document.placeSignature']({ docId, ...request })).toStrictEqual({
      ok: false,
      error: { code: 'document-busy' },
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

/**
 * Decision C at the channel: rows of a workbook the PDF does not hold ride with the open, so the person is told — and a
 * document that arrived whole answers exactly what `document.open` does.
 */
describe('document.newFromOffice — the rows a workbook lacks', () => {
  const OPENED = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'Budget.pdf' } as const;
  const converting = (missing: readonly { sheet: string; from: number; to: number }[]): DocumentCommands =>
    ({
      convertOfficeFile: () => Promise.resolve({ kind: 'written', destination: 'C:/docs/Budget.pdf', missing }),
    }) as unknown as DocumentCommands;

  it('answers opened-incomplete, naming each block, where the converter reported rows missing', async () => {
    const missing = [{ sheet: 'Data', from: 38_251, to: 50_000 }];
    const { handlers, opened } = harness(OPENED, () => Promise.resolve(null), undefined, { commands: converting(missing) });

    const result = await handlers['document.newFromOffice']({});

    expect(result).toStrictEqual({
      ok: true,
      value: { kind: 'opened-incomplete', docId: A_DOC, version: 1, byteLength: 1024, name: 'Budget.pdf', missing, more: 0 },
    });
    expect(opened).toHaveLength(1);
  });

  it('opens a workbook with more blocks missing than it names, naming the first and COUNTING the rest (table A row 12)', async () => {
    // Until 2026-10-02 the 65th block failed the import of a workbook whose every other row had converted.
    const missing = Array.from({ length: MAX_OFFICE_MISSING_BLOCKS + 5 }, (_, index) => ({
      sheet: 'Data',
      from: index * 10 + 1,
      to: index * 10 + 5,
    }));
    const { handlers } = harness(OPENED, () => Promise.resolve(null), undefined, { commands: converting(missing) });

    const result = await handlers['document.newFromOffice']({});

    expect(result).toStrictEqual({
      ok: true,
      value: {
        ...OPENED,
        version: 1,
        kind: 'opened-incomplete',
        missing: missing.slice(0, MAX_OFFICE_MISSING_BLOCKS),
        more: 5,
      },
    });
    // AND THE ANSWER PASSES THE CHANNEL'S OWN SCHEMA, which bounds the named list.
    expect(channels['document.newFromOffice'].result.safeParse(result.ok ? result.value : null).success).toBe(true);
  });

  it('CONTROL: answers plain opened where nothing is missing', async () => {
    const { handlers } = harness(OPENED, () => Promise.resolve(null), undefined, { commands: converting([]) });

    const result = await handlers['document.newFromOffice']({});

    expect(result).toStrictEqual({ ok: true, value: { kind: 'opened', docId: A_DOC, version: 1, byteLength: 1024, name: 'Budget.pdf' } });
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
          recentPictures: NO_RECENT_PICTURES, fileIdentity: readFileIdentity, library: unusedLibrarySurface(),
          reviewPrompt: NO_REVIEW_PROMPT,
          settings: createEphemeralSettings(),
          secrets: createEphemeralSecrets(),
          chatHistory: NO_HISTORY,
          pickSettingsFile: () => Promise.resolve(null), openSettingsFile: () => Promise.resolve(null),
          revealLog: () => Promise.resolve(false),
          revealPath: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      edit: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      openStore: () => Promise.resolve(false),
      closeListening: () => false,
    cloud: unconfiguredCloud(),
    attachments: NO_ATTACHMENTS,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
      components: () => Promise.resolve([]),
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

describe('document.editCopy — an edit of a signed document made on a copy (ADR-0149)', () => {
  const COPY_PATH = resolve('copies', 'signed copy.pdf');
  const COPY: DocId = asDocId('doc-copy');
  const OPENED: OpenOutcome = { kind: 'opened', docId: COPY, version: asDocVersion(1), byteLength: 1024, name: 'signed copy.pdf' };
  const NO_PICKER: PickDocument = () => Promise.reject(new Error('a copy for editing never runs the open picker'));
  // A COMMAND THAT NAMES A VERSION, so the case can see it re-bound: the original was at 3 when it was composed.
  const NAMED = { kind: 'removeAnnotation', page: 0, indices: [0], version: asDocVersion(3) } as const;

  /** The commands the handler calls, recording each `execute` and throwing what a case says the copy's edit throws. */
  function commandsFor(edit: () => Promise<unknown>): {
    commands: DocumentCommands;
    executed: unknown[][];
    copied: unknown[][];
  } {
    const executed: unknown[][] = [];
    const copied: unknown[][] = [];
    const commands = {
      copyForEditing: (...args: unknown[]) => {
        copied.push(args);
        return Promise.resolve({ outcome: { kind: 'copied', bytes: 1024 }, destination: COPY_PATH });
      },
      execute: (...args: unknown[]) => {
        executed.push(args);
        return edit();
      },
    } as unknown as DocumentCommands;
    return { commands, executed, copied };
  }

  it('writes the copy, opens it by the one route, and applies the SAME edit there, its version re-bound and agreed', async () => {
    const { commands, executed, copied } = commandsFor(() =>
      Promise.resolve({ version: asDocVersion(2), byteLength: 2048, historyDropped: 0 }),
    );
    const { capabilities, handlers, opened, sessioned, closed } = harness(OPENED, NO_PICKER, undefined, { commands });

    const result = await handlers['document.editCopy']({ docId: A_DOC, command: NAMED });

    expect(result).toStrictEqual({
      ok: true,
      value: { kind: 'edited', docId: COPY, version: 2, byteLength: 2048, name: 'signed copy.pdf', historyDropped: 0 },
    });
    // THE ORIGINAL IS ASKED FOR A COPY, AND NOTHING ELSE: no `execute` names it.
    expect(copied).toStrictEqual([[A_DOC, NAMED]]);
    expect(capabilities.resolve(handleOpened(opened))).toBe(COPY_PATH);
    expect(sessioned).toStrictEqual([COPY]);
    expect(executed).toStrictEqual([[COPY, { ...NAMED, version: 1 }, { breakSignatures: true }]]);
    expect(closed).toStrictEqual([]);
    // WHAT CROSSES IS THE CHANNEL'S OWN SHAPE: the spread of the open's answer and the edit's must parse as declared.
    if (!result.ok) throw new Error('the case answered a failure');
    expect(channels['document.editCopy'].result.safeParse(result.value).success).toBe(true);
  });

  it('a refusal the person can act on leaves the copy OPEN and says why', async () => {
    const { commands } = commandsFor(() => Promise.reject(new TextNotWritableError()));
    const { handlers, closed } = harness(OPENED, NO_PICKER, undefined, { commands });

    const result = await handlers['document.editCopy']({ docId: A_DOC, command: NAMED });

    expect(result).toMatchObject({ ok: true, value: { kind: 'edit-refused', docId: COPY, problem: 'text-not-writable' } });
    expect(closed).toStrictEqual([]);
  });

  it('a DEFECT in the copy’s edit closes the copy before it is rethrown, so no document is open that no tab shows', async () => {
    const { commands } = commandsFor(() => Promise.reject(new Error('a defect')));
    const { handlers, closed } = harness(OPENED, NO_PICKER, undefined, { commands });

    await expect(handlers['document.editCopy']({ docId: A_DOC, command: NAMED })).rejects.toThrow('a defect');
    expect(closed).toStrictEqual([COPY]);
  });

  it('a dismissed picker is CANCELLED and opens nothing — CONTROL: a stale command is the declared stale-target', async () => {
    const dismissed = {
      copyForEditing: () => Promise.resolve(undefined),
      execute: () => Promise.reject(new Error('nothing may run after a dismissed picker')),
    } as unknown as DocumentCommands;
    const cancelled = harness(OPENED, NO_PICKER, undefined, { commands: dismissed });
    expect(await cancelled.handlers['document.editCopy']({ docId: A_DOC, command: NAMED })).toStrictEqual({
      ok: true,
      value: { kind: 'cancelled' },
    });
    expect(cancelled.opened).toStrictEqual([]);

    const stale = {
      copyForEditing: () => Promise.reject(new StaleTargetError('removeAnnotation', asDocVersion(3), asDocVersion(4))),
    } as unknown as DocumentCommands;
    const refused = harness(OPENED, NO_PICKER, undefined, { commands: stale });
    expect(await refused.handlers['document.editCopy']({ docId: A_DOC, command: NAMED })).toStrictEqual({
      ok: false,
      error: { code: 'stale-target' },
    });
    expect(refused.opened).toStrictEqual([]);
  });
});

describe('document.openWaiting — the command line’s documents', () => {
  const LAUNCHED = resolve('launched', 'a.pdf');
  const OPENED: OpenOutcome = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' };
  const NO_PICKER: PickDocument = () => Promise.reject(new Error('a launch must never run the picker'));

  it('opens each held path by the ONE route — that handle, the recent list and a session — and hands it over once', async () => {
    const { capabilities, handlers, opened, recent, sessioned } = harness(OPENED, NO_PICKER, createLaunchDocuments([LAUNCHED]));

    expect(await handlers['document.openWaiting']({})).toStrictEqual({
      ok: true,
      value: { opened: [{ kind: 'opened', docId: A_DOC, version: 1, byteLength: 1024, name: 'a.pdf' }] },
    });
    // THE HANDLE RESOLVES TO THE LAUNCHED PATH, and it went where a drop's goes.
    expect(capabilities.resolve(handleOpened(opened))).toBe(LAUNCHED);
    expect(recent.list()).toStrictEqual([{ path: LAUNCHED, name: 'a.pdf', openedAt: OPENED_AT.toISOString() }]);
    expect(sessioned).toStrictEqual([A_DOC]);

    // CONTROL: asked again, nothing is waiting and nothing is opened a second time.
    expect(await handlers['document.openWaiting']({})).toStrictEqual({ ok: true, value: { opened: [] } });
    expect(opened).toHaveLength(1);
  });

  it('a graph with no launch queue opens nothing', async () => {
    const { handlers, opened } = harness(OPENED, NO_PICKER);
    expect(await handlers['document.openWaiting']({})).toStrictEqual({ ok: true, value: { opened: [] } });
    expect(opened).toStrictEqual([]);
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

  it('KEEPS an entry whose file has gone, and lists it as unavailable — never hidden (ADR-0143)', async () => {
    // Until 2026-10-03 an `absent` open FORGOT the entry, which lost a file on a drive that was only disconnected.
    // CONTROL in the same case: the open itself still answers `absent`, so the renderer still says it could not open.
    const { capabilities, handlers, recent } = harness({ kind: 'absent' }, () => Promise.resolve(null));
    recent.record({ path: 'C:/docs/gone.pdf', name: 'gone.pdf' });
    const handle = capabilities.mint('C:/docs/gone.pdf');

    const opened = await handlers['document.openRecent']({ handle });

    expect(opened).toStrictEqual({ ok: true, value: { kind: 'absent' } });
    expect(recent.list().map((entry) => entry.name)).toStrictEqual(['gone.pdf']);
    const listed = await handlers['document.recent']({});
    expect(listed.ok ? listed.value.entries.map((entry) => [entry.name, entry.availability]) : listed).toStrictEqual([
      ['gone.pdf', 'unavailable'],
    ]);
  });

  describe('which entries are there (ADR-0143)', () => {
    /** A folder holding `here.pdf`, and the path of a `gone.pdf` beside it that does not exist. */
    function aFolder(): { readonly here: string; readonly gone: string } {
      const folder = mkdtempSync(join(tmpdir(), 'monstera-recent-'));
      const here = join(folder, 'here.pdf');
      writeFileSync(here, '%PDF-1.7\n');
      return { here, gone: join(folder, 'gone.pdf') };
    }
    const availability = async (handlers: ReturnType<typeof harness>['handlers']): Promise<unknown> => {
      const listed = await handlers['document.recent']({});
      return listed.ok ? listed.value.entries.map((entry) => [entry.name, entry.availability]) : listed;
    };

    it('reads each by the OPEN’S OWN RULE: a file on disk is available, a missing one is listed and not', async () => {
      // BOTH DIRECTIONS IN ONE FIXTURE, so neither *always available* nor *never available* passes: the first is the
      // missing file drawn as one that opens, the second a list that disables everything.
      const { here, gone } = aFolder();
      const { handlers, recent } = harness({ kind: 'absent' }, () => Promise.resolve(null));
      recent.record({ path: gone, name: 'gone.pdf' });
      recent.record({ path: here, name: 'here.pdf' });

      expect(await availability(handlers)).toStrictEqual([
        ['here.pdf', 'available'],
        ['gone.pdf', 'unavailable'],
      ]);
    });

    it('is read AT EACH ASK, never stored: a file deleted between two reads is unavailable on the second', async () => {
      const { here } = aFolder();
      const { handlers, recent } = harness({ kind: 'absent' }, () => Promise.resolve(null));
      recent.record({ path: here, name: 'here.pdf' });
      expect(await availability(handlers)).toStrictEqual([['here.pdf', 'available']]);

      rmSync(here);

      expect(await availability(handlers)).toStrictEqual([['here.pdf', 'unavailable']]);
    });

    it('a check that THROWS is unavailable, and the rest of the list is still answered', async () => {
      // A refused permission or a device error: an open would fail on it too, so it is not drawn as one that opens.
      // THE LOCKED FILE EXISTS ON DISK, so only the injected check makes it unavailable: a handler that read the disk
      // its own way, ignoring the check it is given, would report it available and fail here.
      const { here } = aFolder();
      const locked = join(dirname(here), 'locked.pdf');
      writeFileSync(locked, '%PDF-1.7\n');
      const { handlers, recent } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
        fileIdentity: (path) => (path === locked ? Promise.reject(new Error('EACCES: permission denied')) : readFileIdentity(path)),
      });
      recent.record({ path: locked, name: 'locked.pdf' });
      recent.record({ path: here, name: 'here.pdf' });

      expect(await availability(handlers)).toStrictEqual([
        ['here.pdf', 'available'],
        ['locked.pdf', 'unavailable'],
      ]);
    });

    /** A check for `slow` that answers only when the case says, and counts how many times it was asked. */
    function slowCheck(slow: string): {
      readonly fileIdentity: IdentityReader;
      readonly asked: () => number;
      readonly answer: (there: boolean) => void;
    } {
      let asked = 0;
      let settle: ((there: boolean) => void) | undefined;
      return {
        fileIdentity: (path) => {
          if (path !== slow) return readFileIdentity(path);
          asked += 1;
          return new Promise((resolve, reject) => {
            settle = (there) => {
              if (there) void readFileIdentity(path).then(resolve, reject);
              else resolve(null);
            };
          });
        },
        asked: () => asked,
        answer: (there) => {
          settle?.(there);
        },
      };
    }

    it('answers within the CAP, the slow file CHECKING and the others read, and the next ask after it lands has it (7d)', async () => {
      const { here } = aFolder();
      const slow = join(dirname(here), 'network.pdf');
      writeFileSync(slow, '%PDF-1.7\n');
      const check = slowCheck(slow);
      const { handlers, recent } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
        fileIdentity: check.fileIdentity,
      });
      recent.record({ path: slow, name: 'network.pdf' });
      recent.record({ path: here, name: 'here.pdf' });

      const started = Date.now();
      expect(await availability(handlers)).toStrictEqual([
        ['here.pdf', 'available'],
        ['network.pdf', 'checking'],
      ]);
      // THE LIST DID NOT WAIT FOR THE SLOW FILE: it answered at the cap, not when the check did (which is never, yet).
      expect(Date.now() - started).toBeLessThan(RECENT_CHECK_CAP_MS + 1000);

      // A SECOND ASK WHILE IT RUNS SHARES IT: still checking, and the disk was asked once, not twice.
      expect(await availability(handlers)).toStrictEqual([
        ['here.pdf', 'available'],
        ['network.pdf', 'checking'],
      ]);
      expect(check.asked()).toBe(1);

      // IT LANDS BETWEEN TWO ASKS, and the next ask has its answer without asking the disk again.
      check.answer(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await availability(handlers)).toStrictEqual([
        ['here.pdf', 'available'],
        ['network.pdf', 'available'],
      ]);
      expect(check.asked()).toBe(1);
      // AND HAVING ANSWERED IT IS DROPPED: the ask after asks the disk again, the rule above (read at each ask).
      await availability(handlers);
      expect(check.asked()).toBe(2);
    });

    it('the CRASH OFFER’S entries carry the same reading, so a file that has gone is not offered (7c)', async () => {
      const { here, gone } = aFolder();
      // A RUN THAT DIED with two documents open, read by the next run's store over the same file.
      const file = createEphemeralSettings();
      const before = createRecentFiles(file, () => OPENED_AT);
      before.opened(asDocId('00000000-0000-4000-8000-0000000000a1'), { path: here, name: 'here.pdf' });
      before.opened(asDocId('00000000-0000-4000-8000-0000000000b2'), { path: gone, name: 'gone.pdf' });
      const { handlers } = harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
        recent: createRecentFiles(file, () => OPENED_AT),
      });
      const listed = await handlers['document.recent']({});
      expect(listed.ok ? listed.value.lastExitClean : listed).toBe(false);
      expect(listed.ok ? listed.value.lastSession.map((entry) => [entry.name, entry.availability]) : listed).toStrictEqual([
        ['here.pdf', 'available'],
        ['gone.pdf', 'unavailable'],
      ]);
    });
  });
});

describe('file.reveal — a toast’s Show in folder', () => {
  it('shows the path a handle this process minted names, and only that path', async () => {
    const { handlers, capabilities, shown } = harness({ kind: 'absent' }, () => Promise.resolve(null));
    const handle = capabilities.mint('C:\\Users\\reader\\Documents\\report.docx');
    expect(await handlers['file.reveal']({ handle })).toEqual({ ok: true, value: { revealed: true } });
    expect(shown).toStrictEqual(['C:\\Users\\reader\\Documents\\report.docx']);
  });

  it('CONTROL: a handle this process never minted shows nothing, and asks the file manager for nothing', async () => {
    // A WELL-FORMED HANDLE from another registry, so the schema passes it and only the resolve can refuse it.
    const { handlers, shown } = harness({ kind: 'absent' }, () => Promise.resolve(null));
    const stranger = new CapabilityRegistry().mint('C:\\elsewhere\\secret.pdf');
    expect(await handlers['file.reveal']({ handle: stranger })).toEqual({ ok: true, value: { revealed: false } });
    expect(shown).toStrictEqual([]);
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
      recentPictures: NO_RECENT_PICTURES, fileIdentity: readFileIdentity, library: unusedLibrarySurface(),
      reviewPrompt: NO_REVIEW_PROMPT,
settings: createEphemeralSettings(),
      secrets: createEphemeralSecrets(),
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null), openSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      revealPath: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      edit: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      openStore: () => Promise.resolve(false),
      closeListening: () => false,
    cloud: unconfiguredCloud(),
    attachments: NO_ATTACHMENTS,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
      components: () => Promise.resolve([]),
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
      setting: (definition) => definition.fallback,
      send: () => undefined,
      openInBrowser: () => Promise.resolve(),
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
      recentPictures: NO_RECENT_PICTURES, fileIdentity: readFileIdentity, library: unusedLibrarySurface(),
      reviewPrompt: NO_REVIEW_PROMPT,
settings: createEphemeralSettings(),
      secrets,
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null), openSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      revealPath: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      edit: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      openStore: () => Promise.resolve(false),
      closeListening: () => false,
      cloud: unconfiguredCloud(),
    attachments: NO_ATTACHMENTS,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
      components: () => Promise.resolve([]),
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
    expect(result).toEqual({ ok: true, value: { accepted: true, checked: true } });
    expect(secrets.read()['ai.openai-key']).toBe('a-new-key');
  });

  it('a provider with NO LIST to ask keeps the key and says it was not checked', async () => {
    const { handlers, secrets, asked } = checking(200);
    const result = await handlers['ai.checkKey']({ provider: 'perplexity', key: 'a-perplexity-key' });
    expect(result).toEqual({ ok: true, value: { accepted: true, checked: false } });
    expect(secrets.read()['ai.perplexity-key']).toBe('a-perplexity-key');
    // NOTHING WAS ASKED, which is what makes `checked: false` the truth rather than a pessimism.
    expect(asked).toStrictEqual([]);
  });

  it('an Azure OpenAI address that is not Azure’s own is asked NOTHING from main, and its key is not kept', async () => {
    // THE CHANNEL TAKES ANY STRING, so main is what refuses: without the check this is a request from main, with the
    // typed key, to whatever the renderer named — and the provider answering 200 would keep the key.
    const { handlers, secrets, asked } = checking(200);
    for (const endpoint of ['https://example.test', 'http://mine.openai.azure.com', 'https://127.0.0.1:8080']) {
      const result = await handlers['ai.checkKey']({ provider: 'azure-openai', key: 'a-key', endpoint });
      expect({ endpoint, result }).toEqual({ endpoint, result: { ok: true, value: { accepted: false, problem: 'not-the-service' } } });
    }
    expect(asked).toStrictEqual([]);
    expect(secrets.read()['ai.azure-openai-key']).toBeUndefined();
  });

  it('CONTROL: the same check at an Azure OpenAI resource is asked once, and keeps the key', async () => {
    const { handlers, secrets, asked } = checking(200);
    const result = await handlers['ai.checkKey']({ provider: 'azure-openai', key: 'a-key', endpoint: 'https://mine.openai.azure.com' });
    expect(result).toEqual({ ok: true, value: { accepted: true, checked: true } });
    expect(asked).toHaveLength(1);
    expect(secrets.read()['ai.azure-openai-key']).toBe('a-key');
  });

  it('ai.models.held answers every provider from what main holds, and asks no provider (ADR-0117)', async () => {
    const { handlers, asked } = checking(200);

    const before = await handlers['ai.models.held']({});
    // NOTHING FETCHED YET, and nothing asked to answer: the unasked list, with no request made.
    expect(before.ok && before.value.openai).toStrictEqual({ source: 'fallback', models: [] });
    expect(asked).toStrictEqual([]);

    await handlers['ai.checkKey']({ provider: 'openai', key: 'a-new-key' });
    const after = await handlers['ai.models.held']({});

    expect(after.ok && after.value.openai.source).toBe('fetched');
    expect(after.ok && after.value.openai.models.map((model) => model.id)).toStrictEqual(['gpt-x']);
    expect(after.ok && Object.keys(after.value).length).toBe(10);
    // ONE REQUEST, the check's: the held query itself reached nobody.
    expect(asked).toHaveLength(1);
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
      setting: (definition) => definition.fallback,
      send: () => undefined,
      openInBrowser: () => Promise.resolve(),
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
      recentPictures: NO_RECENT_PICTURES, fileIdentity: readFileIdentity, library: unusedLibrarySurface(),
      reviewPrompt: NO_REVIEW_PROMPT,
settings: createEphemeralSettings(),
      secrets,
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null), openSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      revealPath: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      edit: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      openStore: () => Promise.resolve(false),
      closeListening: () => false,
      cloud: unconfiguredCloud(),
    attachments: NO_ATTACHMENTS,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
      components: () => Promise.resolve([]),
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
      value: { kind: 'translated', version: 7, edit: blockEditOf([{ lines: [[3]], text: 'Facture' }]) },
    });
    expect(asked).toHaveLength(1);
    // THE BLOCKS AS THE KERNEL WILL DIFF THEM: runs joined as they are, lines by a line break.
    expect(JSON.parse(asked[0]?.user ?? '[]')).toStrictEqual(['Invoice', 'Payment is due\nwithin 30 days.']);
    expect(asked[0]?.system).toContain('into French');
  });

  it('a translated paragraph past 4,096 characters is answered whole, not refused (table A row 10)', async () => {
    // It was refused as an unreadable answer — blaming the provider for an ordinary page — because one block's text
    // was bounded at 4,096. A block is bounded only by the page's text now (ADR-0142).
    const long = 'Le paiement est dû dans les trente jours suivant la réception. '.repeat(80);
    expect(long.length).toBeGreaterThan(4096);
    const { handlers } = translating(BLOCKS, JSON.stringify([long, 'Payment is due\nwithin 30 days.']));
    expect(await handlers['ai.translatePage'](ASK)).toStrictEqual({
      ok: true,
      value: { kind: 'translated', version: 7, edit: blockEditOf([{ lines: [[3]], text: long }]) },
    });
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
      value: { kind: 'translated', version: 7, edit: blockEditOf([{ lines: [[3]], text: 'Facture' }]) },
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
      recentPictures: NO_RECENT_PICTURES, fileIdentity: readFileIdentity, library: unusedLibrarySurface(),
      reviewPrompt: NO_REVIEW_PROMPT,
settings,
      secrets: createEphemeralSecrets(),
      chatHistory: history,
      pickSettingsFile: () => Promise.resolve(null), openSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      revealPath: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      edit: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      openStore: () => Promise.resolve(false),
      closeListening: () => false,
      cloud: unconfiguredCloud(),
    attachments: NO_ATTACHMENTS,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
      components: () => Promise.resolve([]),
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
describe('cloud.pick (ADR-0091, corrected 2026-09-29)', () => {
  /** A cloud whose Picker answers a working copy's path, or refuses; every link recorded. */
  function cloudPicking(answer: string | CloudOutcomeRefused): { cloud: CloudStorage; links: unknown[] } {
    const links: unknown[] = [];
    return {
      links,
      cloud: {
        ...unconfiguredCloud(),
        pick: () => (typeof answer === 'string' ? Promise.resolve(answer) : Promise.reject(answer)),
        link: (docId, path) => {
          links.push([docId, path]);
        },
      },
    };
  }

  it('opens the chosen working copy through the one open, and LINKS it to its cloud file for Save back', async () => {
    const { cloud, links } = cloudPicking('C:/work/google-drive/abc/chosen.pdf');
    const opened = { kind: 'opened' as const, docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'chosen.pdf' };
    const { handlers } = harness(opened, () => Promise.resolve(null), undefined, { cloud });

    expect(await handlers['cloud.pick']({ provider: 'google-drive' })).toStrictEqual({ ok: true, value: opened });
    expect(links).toStrictEqual([[A_DOC, 'C:/work/google-drive/abc/chosen.pdf']]);
  });

  it('CONTROL: a Picker that chose nothing is refused by name, and opens and links nothing', async () => {
    const { cloud, links } = cloudPicking(new CloudOutcomeRefused('nothing-picked'));
    const { handlers, opened } = harness(
      { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'x.pdf' },
      () => Promise.resolve(null),
      undefined,
      { cloud },
    );
    expect(await handlers['cloud.pick']({ provider: 'google-drive' })).toStrictEqual({
      ok: true,
      value: { kind: 'refused', reason: 'nothing-picked' },
    });
    expect(opened).toStrictEqual([]);
    expect(links).toStrictEqual([]);
  });

  it('the channel refuses a provider with no Picker, and CONTROL: accepts Google', () => {
    const params = channels['cloud.pick'].params;
    expect(params.safeParse({ provider: 'onedrive' }).success).toBe(false);
    expect(params.safeParse({ provider: 'google-drive' }).success).toBe(true);
  });
});

describe('settings.import (BUILD-PROMPT.md:630)', () => {
  /** A real file in a folder of its own, so the handler reads and sizes what is on disk. */
  function fileHolding(content: string | Uint8Array): string {
    const folder = mkdtempSync(join(tmpdir(), 'monstera-settings-import-'));
    const path = join(folder, 'settings.json');
    writeFileSync(path, content);
    return path;
  }

  const importing = (path: string | null) =>
    harness({ kind: 'absent' }, () => Promise.resolve(null), undefined, {
      openSettingsFile: () => Promise.resolve(path),
    }).handlers['settings.import']({});

  it('answers the file’s values, and leaves out a SECRET id — a key never arrives by a file', async () => {
    const path = fileHolding(JSON.stringify({ 'appearance.theme': 'dark', [AZURE_KEY_SETTING_ID]: 'a-key' }));
    expect(await importing(path)).toStrictEqual({ ok: true, value: { kind: 'read', values: { 'appearance.theme': 'dark' } } });
  });

  it('a file that is not a JSON OBJECT is unreadable — an array, and text that is not JSON', async () => {
    expect(await importing(fileHolding('[1, 2]'))).toStrictEqual({ ok: true, value: { kind: 'unreadable' } });
    expect(await importing(fileHolding('not json'))).toStrictEqual({ ok: true, value: { kind: 'unreadable' } });
  });

  it('a file over the bound is refused BY ITS SIZE — valid JSON, one byte past it', async () => {
    // VALID JSON on purpose: a file refused because it failed to parse would pass this case without the size check.
    const padding = 'x'.repeat(MAX_SETTINGS_FILE_BYTES);
    const path = fileHolding(JSON.stringify({ 'appearance.theme': padding }));
    expect(await importing(path)).toStrictEqual({ ok: true, value: { kind: 'unreadable' } });
  });

  it('CONTROL: a dismissed picker is cancelled, and reads nothing', async () => {
    expect(await importing(null)).toStrictEqual({ ok: true, value: { kind: 'cancelled' } });
  });
});

describe('cloud.saveBack', () => {
  const DOC = asDocId('00000000-0000-4000-8000-0000000000b1');

  function withCloud(upload: () => Promise<void>, saved: 'saved' | 'write-failed') {
    const uploaded: Uint8Array[] = [];
    // A DOCUMENT WITH A CLOUD ORIGIN, faked at the surface: which provider it came from and what
    // happens to the upload are the only two things this handler asks of it.
    const cloud = {
      ...unconfiguredCloud(),
      originOf: (docId: DocId) => (docId === DOC ? ('onedrive' as const) : null),
      canEdit: (docId: DocId) => (docId === DOC ? false : undefined),
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
      recentPictures: NO_RECENT_PICTURES, fileIdentity: readFileIdentity, library: unusedLibrarySurface(),
      reviewPrompt: NO_REVIEW_PROMPT,
settings: createEphemeralSettings(),
      secrets: createEphemeralSecrets(),
      chatHistory: NO_HISTORY,
      pickSettingsFile: () => Promise.resolve(null), openSettingsFile: () => Promise.resolve(null),
      revealLog: () => Promise.resolve(false),
      revealPath: () => Promise.resolve(false),
      titleBarOverlay: () => false,
      confirmClose: () => false,
      edit: () => false,
      copyText: () => false,
      openWebPage: () => Promise.resolve(false),
      openStore: () => Promise.resolve(false),
      closeListening: () => false,
      cloud,
      attachments: NO_ATTACHMENTS,
      readDictionary: () => Promise.resolve(null),
      ocrLanguages: () => Promise.resolve([]),
      components: () => Promise.resolve([]),
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

  it('a view-only refusal crosses BY NAME with the version saved here, for the renderer to offer the copy', async () => {
    const { handlers } = withCloud(() => Promise.reject(new CloudOutcomeRefused('read-only')), 'saved');
    await expect(handlers['cloud.saveBack']({ docId: DOC })).resolves.toEqual({
      ok: true,
      value: { kind: 'refused', reason: 'read-only', version: asDocVersion(9) },
    });
  });

  it('cloud.access answers the provider and the edit access the session holds; CONTROL: another document is not from the cloud', async () => {
    const { handlers } = withCloud(() => Promise.resolve(), 'saved');
    await expect(handlers['cloud.access']({ docId: DOC })).resolves.toEqual({
      ok: true,
      value: { kind: 'from-cloud', provider: 'onedrive', canEdit: false },
    });
    await expect(handlers['cloud.access']({ docId: asDocId('00000000-0000-4000-8000-0000000000b3') })).resolves.toEqual({
      ok: true,
      value: { kind: 'not-from-cloud' },
    });
  });
});

/**
 * The three lists that cross in parts (ADR-0130 Decision 2), through the REAL handlers: `main` reads the whole list
 * and cuts the part. A list of 5,000 is past one part of each (4,096), so the first answer names a next and the second
 * is the last — and a handler that answered the whole list, or the first part with no next, fails here.
 */
describe('a document-wide list answers in parts', () => {
  const OPENED = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' } as const;
  const LENGTH = 5000;
  const numbered = Array.from({ length: LENGTH }, (_, at) => at);
  // THE WALK'S FLAG IS SET, so the case separates a handler that carries it on every part from one that carries it
  // on the last only — a list cut mid-way has not stopped at a bound.
  const commands = {
    annotations: () => Promise.resolve({ version: asDocVersion(7), annotations: numbered, truncated: true }),
    formFields: () => Promise.resolve({ version: asDocVersion(7), fields: numbered, truncated: true }),
    destinations: () => Promise.resolve({ version: asDocVersion(7), destinations: numbered, truncated: true }),
  } as unknown as DocumentCommands;
  const { handlers } = harness(OPENED, () => Promise.resolve(null), undefined, { commands });

  const cases = [
    ['document.annotations', (value: object) => (value as { annotations: unknown[] }).annotations],
    ['document.formFields', (value: object) => (value as { fields: unknown[] }).fields],
    ['document.destinations', (value: object) => (value as { destinations: unknown[] }).destinations],
  ] as const;

  for (const [name, itemsOf] of cases) {
    it(`${name}: the first part names the next, the second is the last, and together they are the list`, async () => {
      const first = await handlers[name]({ docId: A_DOC, from: 0 });
      const second = await handlers[name]({ docId: A_DOC, from: 4096 });
      if (!first.ok || !second.ok) throw new Error(`${name} refused a part`);
      expect(first.value).toMatchObject({ version: 7, next: 4096, truncated: false });
      expect(second.value).toMatchObject({ version: 7, next: null, truncated: true });
      expect([...itemsOf(first.value), ...itemsOf(second.value)]).toStrictEqual(numbered);
    });
  }
});

/**
 * A PAGE PAST ONE PART of its text blocks or its objects (finding AAAAAAA-1, ADR-0130): the real handlers answer it a
 * part at a time, and EVERY PART PASSES THE CONTRACT'S OWN RESULT SCHEMA — the check that refused such a page as
 * `internal` when it crossed whole. The fixtures are the breaking sizes: 600 blocks (a dense table page) and 8,400
 * objects (a page drawn one glyph per object, measured 2026-10-02).
 */
describe('a dense page’s blocks and objects answer in parts the contract accepts', () => {
  const OPENED = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' } as const;
  const box = { x0: 10, y0: 10, x1: 40, y1: 20 };
  const cell = { size: 9, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
  const blocks = Array.from({ length: 600 }, (_, at) => ({
    box,
    lines: [{ runs: [{ index: at, text: `cell ${String(at)}`, style: cell }], box }],
    style: cell,
  }));
  const objects = Array.from({ length: 8400 }, (_, at) => ({
    index: at,
    kind: 'text' as const,
    left: 10,
    bottom: 10,
    right: 12,
    top: 20,
    fill: null,
  }));
  const commands = {
    textBlocks: () => Promise.resolve({ version: asDocVersion(7), blocks, truncated: false, rotated: 0, unaddressable: 2 }),
    pageObjects: () => Promise.resolve({ version: asDocVersion(7), objects, truncated: false }),
  } as unknown as DocumentCommands;
  const { handlers } = harness(OPENED, () => Promise.resolve(null), undefined, { commands });

  /** Every part from the first, each checked against the channel's own result schema as it arrives. */
  async function walk(name: 'document.textBlocks' | 'document.pageObjects', itemsOf: (value: object) => readonly unknown[]) {
    const items: unknown[] = [];
    let parts = 0;
    let from: number | null = 0;
    while (from !== null) {
      const at: number = from;
      const answer: { readonly ok: boolean; readonly value?: object & { readonly next: number | null } } = await handlers[name]({
        docId: A_DOC,
        page: 0,
        from: at,
      });
      if (!answer.ok || answer.value === undefined) throw new Error(`${name} refused the part from ${String(at)}`);
      expect(channels[name].result.safeParse(answer.value).success, `${name} part from ${String(at)}`).toBe(true);
      items.push(...itemsOf(answer.value));
      from = answer.value.next;
      parts += 1;
    }
    return { items, parts };
  }

  it('600 text blocks: two parts, both valid, and together the page', async () => {
    const { items, parts } = await walk('document.textBlocks', (value) => (value as { blocks: unknown[] }).blocks);
    expect(parts).toBe(2);
    expect(items).toStrictEqual(blocks);
  });

  it('8,400 page objects: seventeen parts, all valid, and together the page', async () => {
    const { items, parts } = await walk('document.pageObjects', (value) => (value as { objects: unknown[] }).objects);
    expect(parts).toBe(17);
    expect(items).toStrictEqual(objects);
  });

  it('CONTROL: the same page answered WHOLE is refused by the contract — the fixture is at the breaking size', () => {
    const whole = { version: asDocVersion(7), next: null, truncated: false };
    expect(channels['document.textBlocks'].result.safeParse({ ...whole, blocks, rotated: 0, unaddressable: 2 }).success).toBe(false);
    expect(channels['document.pageObjects'].result.safeParse({ ...whole, objects }).success).toBe(false);
  });
});

describe('a CAD export’s layers answer in parts the contract accepts', () => {
  const OPENED = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' } as const;
  const layers = Array.from({ length: 2500 }, (_, index) => ({ index, name: `Level ${String(index)}`, visible: true }));
  const commands = {
    layers: () => Promise.resolve({ version: asDocVersion(4), layers, truncated: false }),
  } as unknown as DocumentCommands;
  const { handlers } = harness(OPENED, () => Promise.resolve(null), undefined, { commands });

  it('2,500 layers: three parts, each valid, and together every layer', async () => {
    const items: unknown[] = [];
    let parts = 0;
    let from: number | null = 0;
    while (from !== null) {
      const answer = await handlers['document.layers']({ docId: A_DOC, from });
      if (!answer.ok) throw new Error(`the part from ${String(from)} was refused`);
      expect(channels['document.layers'].result.safeParse(answer.value).success).toBe(true);
      items.push(...answer.value.layers);
      from = answer.value.next;
      parts += 1;
    }
    expect(parts).toBe(3);
    expect(items).toStrictEqual(layers);
  });

  it('CONTROL: the same layers answered WHOLE are refused by the contract — the fixture is at the breaking size', () => {
    const whole = { version: asDocVersion(4), layers, next: null, truncated: false };
    expect(channels['document.layers'].result.safeParse(whole).success).toBe(false);
  });
});

describe('a link-heavy page’s links answer in parts the contract accepts', () => {
  const OPENED = { kind: 'opened', docId: A_DOC, version: asDocVersion(1), byteLength: 1024, name: 'a.pdf' } as const;
  const bounds = { x0: 1, y0: 2, x1: 3, y1: 4 };
  const links = Array.from({ length: 5000 }, (_, index) => ({ kind: 'external' as const, uri: `https://example.org/${String(index)}`, bounds }));
  const commands = {
    pageLinks: () => Promise.resolve({ version: asDocVersion(4), links, truncated: false }),
  } as unknown as DocumentCommands;
  const { handlers } = harness(OPENED, () => Promise.resolve(null), undefined, { commands });

  it('5,000 links: two parts, each valid, and together every link', async () => {
    const items: unknown[] = [];
    let parts = 0;
    let from: number | null = 0;
    while (from !== null) {
      const answer = await handlers['document.pageLinks']({ docId: A_DOC, page: 0, from });
      if (!answer.ok) throw new Error(`the part from ${String(from)} was refused`);
      expect(channels['document.pageLinks'].result.safeParse(answer.value).success).toBe(true);
      items.push(...answer.value.links);
      from = answer.value.next;
      parts += 1;
    }
    expect(parts).toBe(2);
    expect(items).toStrictEqual(links);
  });

  it('CONTROL: the same links answered WHOLE are refused by the contract — the fixture is at the breaking size', () => {
    const whole = { version: asDocVersion(4), links, next: null, truncated: false };
    expect(channels['document.pageLinks'].result.safeParse(whole).success).toBe(false);
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
