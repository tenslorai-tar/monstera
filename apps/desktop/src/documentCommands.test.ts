import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

import { strFromU8, unzipSync } from 'fflate';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type Command,
  channels,
  type Incident,
  wrapHandler,
  IncidentLog,
  MAX_MARKDOWN_BYTES,
  MAX_CSV_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMPORT_IMAGES,
  MAX_IMPORT_IMAGE_BYTES,
} from '@monstera/contract';
import {
  AzureRecognitionRefused,
  ClaudeRecognitionRefused,
  CapabilityRegistry,
  localPdfLibWriter,
  CommandBus,
  DocumentNotOpenError,
  type PageImageRequest,
  type PageStructure,
  DocumentService,
  EngineCallFailed,
  EngineSessionGone,
  type MupdfSession,
  nodeFileSurface,
  parsePageStructure,
  parsePageTables,
  readDocumentRange,
  type RecognisedTable,
  type RegisteredWriter,
  SignatureAppearanceRefusedError,
  SignatureCredentialRefusedError,
  SignatureTooLargeError,
  TimestampRefusedError,
  TimestampUnreachableError,
  UrlFetchRefused,
  siblingNames,
  StaleTargetError,
} from '@monstera/kernel';
// See the note in `engineSessions.test.ts`: a local engine in main's process is
// the pre-host arrangement, and `/engine` is what makes that import say so
// (ADR-0026).
import {
  copyAnnotationData,
  findDuplicatePages,
  readAnnotations,
  readFormFields,
  localMupdfWriter,
  mupdfWriter,
  readPageGeometry,
  readDestinations,
  extractPages,
  readLayers,
  readPageLinks,
  readPageText,
  readPageTextJson,
  detectFlatFields,
  readInterchangeAnnotations,
  serialiseAnnotationData,
  checkAccessibility,
  readPageBarcodes,
  readFormData,
  serialiseFormData,
  rasterisePageImage,
  snapshotRegion,
  withDocument,
} from '@monstera/kernel/engine';
import { type DocId, type DocVersion, asDocId, asDocVersion } from '@monstera/shared';

/** Large enough that capacity is never what these tests are measuring. */
const AMPLE_CEILING = 64 * 1024 * 1024;

import { executeCommandHandler } from './commandHandlers.js';
import { createAssistant } from './assistant.js';
import { createContractHandlers } from './contractHandlers.js';
import { createRecentFiles } from './recentFiles.js';
import {
  DocumentCommands,
  NetworkKeyMissing,
  type DocumentCommandsParts,
  type DocumentGeometry,
  type DocumentDestinationsReader,
  type DocumentOcrReader,
  type DocumentExtractReader,
  type DocumentPageImageReader,
  pageImageName,
  suggestedTextName,
  type PickDirectory,
  type DocumentLayersReader,
  type DocumentPageLinksReader,
  type CopySource,
  type CertificateSource,
  type ImageFilesSource,
  type ImageSource,
  type ImportSource,
  type DocumentAnnotationsReader,
  type DocumentAnnotationCopyReader,
  type DocumentFlatFieldsReader,
  type DocumentBarcodesReader,
  type AnnotationDataSource,
  type BarcodeWriter,
  lazyBarcodeWriter,
  type DocumentTextLinesReader,
  type DocumentPageObjectsReader,
  type DocumentPageRasteriser,
  EngineUnavailableError,
  suggestedComposedName,
  suggestedUrlName,
  type DocumentFormFieldsReader,
  type DocumentDuplicatesReader,
  type DocumentPageText,
  type DocumentPageStructure,
  type DocumentPageTables,
  type ExcelReview,
  type NetworkTableReader,
  type OptimizeSource,
  DocumentPoisonedError,
  type DocumentRestore,
  type DocumentFlush,
  MissingSessionError,
  type FormDataSource,
  type SaveSource,
  type SnapshotSource,
} from './documentCommands.js';
import { DocusignOutcomeRefused, type DocusignSession } from './docusignSession.js';
import { EngineSessions } from './engineSessions.js';
import { EDIT_QUIET_MS, type EditWatchSurface } from './externalEditWatch.js';
import { LayoutTextFailedError, type LayoutTextSource } from './layoutText.js';
import { type PdfaSource, PdfaFailedError } from './pdfaConversion.js';
import { type PrintDestination, PrintFailedError } from './printing.js';
import { type ShareDestination, ShareFailedError, type ShareOffer } from './sharing.js';
import { nodeEditWatchSurface } from './nodeEditWatch.js';

/**
 * The composition point and the first handler, driven end to end against a real
 * engine.
 *
 * Every collaborator here is the production one — a real `DocumentService` over
 * a real file, a real `CommandBus` with the real MuPDF adapter, a real
 * `wrapHandler`. The one thing that is not is the **session lookup**, because
 * nothing owns engine session lifetime yet (ADR-0009 §8's open question, held
 * behind its own trigger). That is a seam this unit deliberately does not fill,
 * not a collaborator being avoided.
 */

let directory: string;
let file: string;
let service: DocumentService;
let docId: DocId;
let openedBytes: number;
let session: MupdfSession;

/** The rotation MuPDF currently reports for a page, or `null` if it has none. */
async function ownRotation(page: number): Promise<number | null> {
  return withDocument(session, (document) => {
    const own = document.loadPage(page).getObject().get('Rotate');
    return own.isNull() ? null : own.asNumber();
  });
}

async function openDocument(): Promise<void> {
  const registry = new CapabilityRegistry();
  service = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
  const outcome = await service.open(registry.mint(file));
  if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
  docId = outcome.docId;
  // KEPT, so a command's answer can be compared against the document it
  // replaced. Without this the only available assertion is "greater than zero",
  // which a length captured before the command satisfies too.
  openedBytes = outcome.byteLength;
  session = await mupdfWriter.open(await pdfBytes());
}

async function pdfBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  return document.save();
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'monstera-compose-'));
  file = join(directory, 'fixture.pdf');
  writeFileSync(file, await pdfBytes());
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * The production bus, with the one adapter that exists.
 *
 * `localMupdfWriter` rather than `mupdfWriter` since ADR-0023 Decision 10: a
 * registered writer is a session lifecycle **and** the execution of commands
 * against one of its sessions, and the local assembly is what a process holding
 * the session registers.
 */
function bus(): CommandBus {
  return new CommandBus({ mupdf: localMupdfWriter });
}

/**
 * The production supervisor state, holding this document's session.
 *
 * The real component rather than an inline lookup: an arrow that answers
 * `{ mupdf: session }` is a second implementation of get-or-miss, and it would
 * keep passing after the real one stopped agreeing with it.
 */
function engine(): EngineSessions {
  const held = new EngineSessions();
  held.hold(docId, { mupdf: session });
  return held;
}

/** The same component holding nothing — the miss path, not a stub of it. */
function noSessions(): EngineSessions {
  return new EngineSessions();
}

const rotateOnce: Command = { kind: 'rotatePages', pages: [0], quarterTurns: 1 };

/**
 * A save source for the cases that are not about saving.
 *
 * Every member REFUSES rather than returning something plausible. These cases
 * exercise `execute` and `undo`, and a save source that quietly worked would let
 * one of them reach the filesystem without any case saying it should — the
 * failure being that nothing would ever report it. A throw names the file.
 */
const noSaving: SaveSource = {
  deps: {
    checkWriteTarget: () => Promise.reject(new Error('this case does not save')),
    surface: {
      write: () => Promise.reject(new Error('this case does not save')),
      writeStream: () => Promise.reject(new Error('this case does not save')),
      sync: () => Promise.reject(new Error('this case does not save')),
      rename: () => Promise.reject(new Error('this case does not save')),
      copy: () => Promise.reject(new Error('this case does not save')),
      remove: () => Promise.reject(new Error('this case does not save')),
      exists: () => Promise.reject(new Error('this case does not save')),
    },
    names: (target) => ({ temp: `${target}.tmp`, backup: `${target}.bak` }),
    wait: () => Promise.resolve(),
  },
  flush: () => Promise.reject(new Error('this case does not save')),
};

/**
 * The flush a command declared `'image'` now calls (ADR-0084): the document's real MuPDF bytes.
 *
 * Not {@link noSaving}'s refusal, because a command whose effect PDF.js draws makes the session's
 * bytes main's image before its version moves — so running one IS a flush, and a case that
 * refused it would be refusing the renderer its document.
 */
const sessionFlush: DocumentFlush = (_docId, sessions) => {
  const session: MupdfSession | undefined = sessions.mupdf;
  if (session === undefined) throw new Error('the fixture holds a MuPDF session');
  return mupdfWriter.serialise(session);
};

/**
 * A geometry source for the cases that are not about the view model.
 *
 * Refuses for the same reason {@link noSaving} does: a reader that quietly
 * worked would let a case reach the engine's page tree without any case saying
 * it should, and nothing would ever report it.
 */
const noGeometry: DocumentGeometry = () =>
  Promise.reject(new Error('this case does not read the view model'));

/**
 * The production composition of the geometry read, assembled the way
 * `composition.ts` assembles it — a session lookup and `readPageGeometry`.
 *
 * The real reader rather than a stub returning a plausible array: what the
 * view-model cases below claim is that the number a renderer would draw with is
 * the one the ENGINE holds after a command, and a stub is the one thing that
 * cannot say so.
 */
const localGeometry: DocumentGeometry = (id, sessions, pages) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readPageGeometry(held, pages);
};

/** Refuses, for {@link noGeometry}'s reason: a case must say it reads text. */
const noPageText: DocumentPageText = () =>
  Promise.reject(new Error('this case does not read page text'));

const noPageStructure: DocumentPageStructure = () =>
  Promise.reject(new Error('this case does not read page structure'));

const noPageTables: DocumentPageTables = () =>
  Promise.reject(new Error('this case does not read page tables'));

const noPageLinks: DocumentPageLinksReader = () =>
  Promise.reject(new Error('this case does not read page links'));

const noDestinations: DocumentDestinationsReader = () =>
  Promise.reject(new Error('this case does not read the outline'));

const noOcr: DocumentOcrReader = () =>
  Promise.reject(new Error('this case does not recognise a page'));

const noLayers: DocumentLayersReader = () =>
  Promise.reject(new Error('this case does not read the layers'));

/**
 * A restore that refuses, for every case whose log holds no terminal entry.
 *
 * Rejecting rather than resolving, like every stub above it: a quiet one would
 * let a bus that restored on **every** undo pass this whole file, and the
 * undo cases here are the only thing standing between that mutation and green.
 */
const noRestore: DocumentRestore = () =>
  Promise.reject(new Error('this case undoes nothing terminal and must not restore'));

/** Refuses, for {@link noGeometry}'s reason: a case must say it walks the pages. */
const noDuplicates: DocumentDuplicatesReader = () =>
  Promise.reject(new Error('this case does not look for duplicate pages'));

/**
 * A copy source neither member of which any case here reaches.
 *
 * Both REFUSE, for {@link noGeometry}'s reason and with more at stake: a picker
 * that answered with a path would let a case write a real file, and a
 * `checkTarget` that answered `writable` would make a contested destination
 * look safe. A case that writes a copy supplies its own.
 */
const noCopying: CopySource = {
  pick: () => Promise.reject(new Error('this case does not write a copy')),
  checkTarget: () => Promise.reject(new Error('this case does not check a copy target')),
};

/**
 * An image source neither member of which any case here reaches.
 *
 * {@link noCopying}'s shape and its reason, with the read mattering as much as
 * the picker: a `read` that answered with bytes would let a case insert a page
 * into a document another case then measures, and every count downstream would
 * be one out for a reason nothing names. A case that inserts an image supplies
 * its own.
 */
const noImages: ImageSource = {
  pick: () => Promise.reject(new Error('this case does not insert an image')),
  read: () => Promise.reject(new Error('this case does not read an image')),
};

/** An import source neither member of which a case reaches unless it supplies its own. */
const noImportFile: ImportSource = {
  pick: () => Promise.reject(new Error('this case does not import a file')),
  read: () => Promise.reject(new Error('this case does not read an imported file')),
};

/** An image import source none of whose members any case here reaches unless it supplies one. */
const noImageFiles: ImageFilesSource = {
  pick: () => Promise.reject(new Error('this case does not import images')),
  size: () => Promise.reject(new Error('this case does not size an image')),
  read: () => Promise.reject(new Error('this case does not read an imported image')),
};

/** A certificate source neither member of which any case here reaches. */
const noCertificates: CertificateSource = {
  pick: () => Promise.reject(new Error('this case does not sign')),
  read: () => Promise.reject(new Error('this case does not read a certificate')),
};

/**
 * The production composition of the extract, the way `composition.ts` assembles
 * it — a session lookup and `extractPages`.
 *
 * The real builder rather than a stub answering plausible bytes, for
 * {@link localDuplicates}' reason: what an extract case claims is that the
 * written file is a document made of THOSE pages, and a stub is the one thing
 * that cannot say so.
 */
/**
 * The folder picker, refusing. {@link noCopying}'s shape and its reason: a case
 * that splits supplies its own, and every other case reaching this is a command
 * asking for a folder it had no business asking for.
 */
const noDirectory: PickDirectory = () =>
  Promise.reject(new Error('this case does not split into a directory'));

const localExtract: DocumentExtractReader = (id, sessions, pages) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return extractPages(held, pages);
};

/**
 * The production composition of the snapshot, and a picker that refuses.
 *
 * {@link localExtract} for the reader and {@link noCopying} for the picker,
 * each for its own reason: the raster is the real one because a case claiming
 * a PNG describes THIS page cannot be satisfied by a stub, and the dialog
 * refuses because a case that writes one supplies its own.
 */
const localSnapshot: SnapshotSource = {
  pick: () => Promise.reject(new Error('this case does not write a snapshot')),
  region: async (id, sessions, request) => {
    const held = sessions.mupdf;
    if (held === undefined) throw new MissingSessionError(id, 'mupdf');
    // THE PNG ALONE, as the composition root's own does: the frame that travels
    // with a snapshot is for the OCR path, and a source that handed it on here
    // would be answering a different shape from the one this seam declares.
    return (await snapshotRegion(held, request)).png;
  },
};

/** The form-data source composed the way `composition.ts` composes it. */
const localFormData: FormDataSource = {
  pick: () => Promise.reject(new Error('this case does not write a form data file')),
  encode: async (id, sessions, format) => {
    const held = sessions.mupdf;
    if (held === undefined) throw new MissingSessionError(id, 'mupdf');
    return serialiseFormData(await readFormData(held), format);
  },
  // BOTH REFUSE, for `noCopying`'s reason: a picker answering a path would let
  // a case read a real file, and a `read` answering bytes would let one import
  // into a document another case then measures.
  open: () => Promise.reject(new Error('this case does not pick a form data file')),
  read: () => Promise.reject(new Error('this case does not read a form data file')),
};

/** {@link localFormData}'s shape for the annotations, with the real reader and encoder. */
const localAnnotationData: AnnotationDataSource = {
  pick: () => Promise.reject(new Error('this case does not write an annotation file')),
  encode: async (id, sessions, format) => {
    const held = sessions.mupdf;
    if (held === undefined) throw new MissingSessionError(id, 'mupdf');
    return serialiseAnnotationData(await readInterchangeAnnotations(held), format);
  },
  open: () => Promise.reject(new Error('this case does not pick an annotation file')),
  read: () => Promise.reject(new Error('this case does not read an annotation file')),
};

/**
 * The page image composed the way `composition.ts` composes it: the real
 * rasteriser, for {@link localSnapshot}'s reason — a case claiming an image
 * shows THIS page cannot be satisfied by a stub.
 */
const localPageImage: DocumentPageImageReader = (id, sessions, request) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return rasterisePageImage(held, request);
};

/**
 * The production composition of the duplicate report, the way `composition.ts`
 * assembles it — a session lookup and `findDuplicatePages`.
 *
 * The real finder rather than a stub answering plausible groups: what the cases
 * below claim is that the report describes THIS document, and a stub is the one
 * thing that cannot say so.
 */
const noAnnotations: DocumentAnnotationsReader = () =>
  Promise.reject(new Error('this case does not list annotations'));

/**
 * The production composition of the annotation list, the way `composition.ts`
 * assembles it — a session lookup and `readAnnotations`.
 *
 * The real reader rather than a stub answering plausible rows, for
 * `localDuplicates`' reason: what a case claims is that the list describes THIS
 * document, and a stub is the one thing that cannot say so.
 */
const localAnnotations: DocumentAnnotationsReader = (id, sessions) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readAnnotations(held);
};

const noAnnotationCopy: DocumentAnnotationCopyReader = () =>
  Promise.reject(new Error('this case does not copy annotations'));

/**
 * The production composition of the clipboard's copy — a session lookup and `copyAnnotationData`,
 * the way `composition.ts` assembles it — for `localAnnotations`' reason: what a case claims is
 * that the clipboard holds THIS document's marks.
 */
const localAnnotationCopy: DocumentAnnotationCopyReader = (id, sessions, page, indices) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return copyAnnotationData(held, page, indices);
};

const noFormFields: DocumentFormFieldsReader = () =>
  Promise.reject(new Error('this case does not list form fields'));

/** The annotation list's composition, over the widget walk. */
const localFormFields: DocumentFormFieldsReader = (id, sessions) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readFormFields(held);
};

const noFlatFields: DocumentFlatFieldsReader = () =>
  Promise.reject(new Error('this case does not propose flat fields'));

/**
 * The reader an installation with no PDFium supplies.
 *
 * It REFUSES with the shipped class rather than with a bare `Error`, unlike
 * every other `no…` here, and the difference is the point: those absences are
 * *no case exercises this*, and this one is a state the product ships in — the
 * composition root builds exactly this when `pdfiumPlatform` is `null`. A case
 * that reached it and saw a bare `Error` would be reading a fixture; seeing
 * `EngineUnavailableError` it is reading the boundary's own input.
 */
const noTextLines: DocumentTextLinesReader = () =>
  Promise.reject(new EngineUnavailableError('reading a page’s text'));

/** {@link noTextLines}' sibling on the object read, and for its reason. */
const noPageObjects: DocumentPageObjectsReader = () =>
  Promise.reject(new EngineUnavailableError('reading a page’s objects'));

/** The same on the raster, which needs both a PDFium host and an encoder. */
const noRenderPage: DocumentPageRasteriser = () =>
  Promise.reject(new EngineUnavailableError('rendering a page with the second engine'));

/** The candidate proposal's composition, per page. */
const noBarcodes: DocumentBarcodesReader = () =>
  Promise.reject(new Error('this case does not read barcodes'));

/** REFUSES BY NAME, like every inert surface: a case that places a barcode supplies the writer. */
const noBarcodeWriter: BarcodeWriter = () =>
  Promise.reject(new Error('INERT: this case writes no barcode'));

const localBarcodes: DocumentBarcodesReader = async (id, sessions, page) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  // TRUNCATION IS THE CHANNEL'S, `localDuplicates`' reason: the bound lives in the host handler.
  return { barcodes: await readPageBarcodes(held, page), truncated: false };
};

const localFlatFields: DocumentFlatFieldsReader = (id, sessions, page) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return detectFlatFields(held, page);
};

const localDuplicates: DocumentDuplicatesReader = async (id, sessions) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  // TRUNCATION IS THE CHANNEL'S and this is the local composition, so it is
  // always false here — the bound lives in the host handler, which is where the
  // walk happens in the shipped application.
  return { groups: await findDuplicatePages(held), truncated: false };
};

/**
 * The production composition of the text read, the way `composition.ts`
 * assembles it — a session lookup and `readPageText`.
 *
 * The real reader rather than a stub answering plausible lines: what the search
 * cases below claim is that a query finds what is IN the document, and a stub
 * is the one thing that cannot say so.
 */
const localPageText: DocumentPageText = async (id, sessions, page) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  const { pages } = await readPageText(held, [page]);
  const only = pages[0];
  if (only === undefined) throw new Error('one page was requested');
  return only;
};

/**
 * The production composition of the structure read, the way `composition.ts`
 * assembles it — the host's own reader under the `structure` name, then the one
 * walk. The real reader for `localPageText`'s reason: what the structure cases
 * claim is about the tags IN the document.
 */
const localPageStructure: DocumentPageStructure = async (id, sessions, page) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return parsePageStructure(await readPageTextJson(held, page, 'structure'));
};

/** The table read, composed as `composition.ts` composes it. */
const localPageTables: DocumentPageTables = async (id, sessions, page) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return parsePageTables(await readPageTextJson(held, page, 'table'));
};

/**
 * The production composition of the link read, the way `composition.ts`
 * assembles it — a session lookup and `readPageLinks`.
 *
 * The real reader, for `localPageText`'s reason: what a case can then claim is
 * that the lane answers with the links the DOCUMENT carries, and a stub
 * answering plausible ones would prove only that the plumbing returns whatever
 * it was handed.
 */
const localPageLinks: DocumentPageLinksReader = (id, sessions, page) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readPageLinks(held, page);
};

/** The production composition of the outline read. See {@link localPageLinks}. */
const localDestinations: DocumentDestinationsReader = (id, sessions) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readDestinations(held);
};

/** The production composition of the layer read. See {@link localPageLinks}. */
const localLayers: DocumentLayersReader = (id, sessions) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readLayers(held);
};

/** Every page of the three-page fixture, in order. */
const ALL_PAGES = [0, 1, 2];

/** What a case supplies for itself: the three that vary between them. */
type Varying = Pick<DocumentCommandsParts, 'documents' | 'bus' | 'engine'>;

/**
 * Every read inert — a graph where nothing answers.
 *
 * ## Two named baselines rather than fifteen arguments per case
 *
 * `DocumentCommands` took fifteen positional parameters until 2026-09-06, so
 * every case here spelt all fifteen and varied two or three of them. What that
 * cost was not typing: a reader could not see which dependency a case was
 * about, because the twelve that never change looked exactly like the three
 * that do.
 *
 * The spread is the remedy and it is a real one — NNN-1's finding is that a
 * value held CONSTANT across a whole file is invisible, and naming the constant
 * is what makes it visible. `INERT` and `LOCAL_READS` say what a case's
 * background is, and what follows the spread is what the case is about.
 *
 * `localExtract` is here rather than a `noExtract` because no case exercises a
 * refusing extract and one that did would say so by overriding it.
 */
const INERT = {
  save: noSaving,
  // DOCUSIGN REFUSES BY NAME here, like every inert surface: a case that reached it
  // without meaning to fails at the call rather than sending anything anywhere.
  docusign: {
    send: () => Promise.reject(new Error('INERT: no DocuSign session in this case')),
    retrieve: () => Promise.reject(new Error('INERT: no DocuSign session in this case')),
    hasSent: () => false,
  },
  geometry: noGeometry,
  pageText: noPageText,
  pageStructure: noPageStructure,
  pageTables: noPageTables,
  pageLinks: noPageLinks,
  destinations: noDestinations,
  // REFUSES IN BOTH SETS, for the reason `textLines` gives below: recognition is
  // the engine host's, and a fixture answering plausible words would be this file
  // inventing one. `ocrTextLayer.test.ts` is where the write is proven and
  // `commandBus.test.ts` is where the pre-read's resolution is.
  ocr: noOcr,
  layers: noLayers,
  signatures: () => Promise.reject(new Error('this case does not read signatures')),
  restore: noRestore,
  annotations: noAnnotations,
  annotationCopy: noAnnotationCopy,
  formFields: noFormFields,
  flatFields: noFlatFields,
  barcodes: noBarcodes,
  writeBarcode: noBarcodeWriter,
  accessibility: () => Promise.reject(new Error('this case does not check accessibility')),
  textLines: noTextLines,
  pageObjects: noPageObjects,
  renderPage: noRenderPage,
  duplicates: noDuplicates,
  copy: noCopying,
  image: noImages,
  imports: { markdown: noImportFile, csv: noImportFile },
  // NO COMPOSE HOST, which is the state a build with no Win32 platform is in — so a
  // case that reached the import without meaning to is refused by name.
  compose: null,
  imageFiles: noImageFiles,
  composeImages: null,
  // REFUSES BY NAME, like every inert surface: a case that reached the network without
  // meaning to fails at the call rather than fetching anything.
  fetchUrl: () => Promise.reject(new Error('INERT: this case does not fetch a URL')),
  // REFUSES BY NAME for the same reason: a table export through a service supplies its own.
  networkTables: () => Promise.reject(new Error('INERT: this case sends no page to a service')),
  certificate: noCertificates,
  extract: localExtract,
  snapshot: localSnapshot,
  formData: localFormData,
  annotationData: localAnnotationData,
  pageImage: localPageImage,
  // REFUSES BY NAME, like every inert picker: a case that exports text supplies its own.
  pickText: () => Promise.reject(new Error('INERT: this case does not export text')),
  layoutText: null,
  // NO PRINT DIALOG, the state a platform without one is in; a print case supplies its own.
  print: null,
  // NO SHARE SHEET, the state a platform without one is in; an email case supplies its own.
  share: null,
  // NO PDF/A CONVERTER, the state of a machine that has not provisioned one.
  pdfa: null,
  // NO COMPOSE HOST, the state of a platform without one; an Optimize case supplies its own.
  optimizer: null,
  pickOffice: () => Promise.reject(new Error('INERT: this case does not export to Office')),
  directory: noDirectory,
  // REFUSES BY NAME, like every inert surface: a case that reached a page sent to another
  // application without meaning to fails at the call rather than opening or watching anything.
  externalEdit: {
    pick: () => Promise.reject(new Error('INERT: this case sends no page to another application')),
    open: () => Promise.reject(new Error('INERT: this case opens no external editor')),
    watch: {
      watchDirectory: () => {
        throw new Error('INERT: this case watches no folder');
      },
      digest: () => Promise.reject(new Error('INERT: this case reads no edited page')),
      after: () => {
        throw new Error('INERT: this case starts no edit timer');
      },
    },
  },
} as const satisfies Omit<DocumentCommandsParts, keyof Varying>;

/** The same, with every read answering from the session the case holds. */
const LOCAL_READS = {
  ...INERT,
  geometry: localGeometry,
  pageText: localPageText,
  pageStructure: localPageStructure,
  pageTables: localPageTables,
  pageLinks: localPageLinks,
  destinations: localDestinations,
  layers: localLayers,
  annotations: localAnnotations,
  annotationCopy: localAnnotationCopy,
  formFields: localFormFields,
  flatFields: localFlatFields,
  barcodes: localBarcodes,
  accessibility: async (id, sessions) => {
    const held = sessions.mupdf;
    if (held === undefined) throw new MissingSessionError(id, 'mupdf');
    return checkAccessibility(held);
  },
  // STAYS THE REFUSING ONE even in the local-reads set, and that is not an
  // omission. Every other reader here has a local composition because MuPDF is
  // in this process for these cases; PDFium is not, and a fixture that answered
  // plausible lines would be this file inventing an engine.
  textLines: noTextLines,
  pageObjects: noPageObjects,
  renderPage: noRenderPage,
  duplicates: localDuplicates,
} as const satisfies Omit<DocumentCommandsParts, keyof Varying>;

describe('the composition point owns DocumentService.run -> CommandBus.execute', () => {
  beforeAll(openDocument);

  it('applies the command and returns the version the LANE stamped', async () => {
    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: engine() });

    // Opened at 1; one applied mutation makes it 2 (ADR-0009 §5).
    const applied = await commands.execute(docId, rotateOnce);
    expect(applied.version).toBe(2);

    // THE BYTE LENGTH, and two findings meet at this assertion.
    //
    // NNNNN-1: it said `toBeGreaterThan(0)`, which a length captured at lane
    // entry satisfies just as well — the pre-command document also has bytes.
    // So the one property `DocumentContext.byteLength` has an argument written
    // about, *read after the bus and not before*, was the one property nothing
    // here separated. `Versioned`'s hazard with the sign flipped, in a case
    // written an hour after the mechanism it guards.
    //
    // The assertion was going to be `not.toBe(openedBytes)`: only the correct
    // path produces a post-command length. MEASURED before it was written,
    // because *they differ* is an assumption about MuPDF rather than a rule —
    // and they do not differ. THEY ARE EQUAL, and that is finding OOOOO-1.
    //
    // A `DocumentRecord`'s `bytes` is `readonly` and a command never replaces
    // it: the mutation lands in the ENGINE SESSION, and main's canonical image
    // stays the bytes that were opened. So `context.byteLength` is correct and
    // **constant**, `document.readRange` serves the pre-command document, and
    // the renderer's view cannot show a rotation whatever it rebinds to.
    //
    // That is a gap between the code and ADR-0031, which argues staleness from
    // *"answering a stale offset out of the new bytes"* — there are no new
    // bytes. This assertion is the evidence, and it is deliberately written as
    // the equality rather than deleted: an equality that passes is what says the
    // mechanism above has nothing to act on yet.
    expect(applied.byteLength).toBeGreaterThan(0);
    expect(applied.byteLength).toBe(openedBytes);

    await expect(ownRotation(0)).resolves.toBe(90);
  });

  it('THE ORDERING CONTROL: two concurrent commands do not interleave their captures', async () => {
    // This is what running the bus INSIDE the lane buys, and the failure it
    // prevents is invisible in the document's final state — both orderings
    // leave page 0 at 180. The evidence is in the second entry's INVERSE.
    //
    // Serialised, the second command captures after the first applied, so its
    // inverse records `{ present: true, raw: 90 }`. Interleaved, both capture
    // before either applies and BOTH inverses record the pre-command state —
    // so undoing twice would leave the page at 90 rather than back where it
    // started, and the document would be in a state it was never in.
    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: engine() });

    await Promise.all([commands.execute(docId, rotateOnce), commands.execute(docId, rotateOnce)]);

    await expect(ownRotation(0)).resolves.toBe(180 + 90);

    const entries = await service.run(docId, (context) => Promise.resolve(context.log.entries));
    const inverses = entries.value.map((entry) =>
      entry.kind === 'invertible' ? entry.inverse : null,
    );

    // COUPLED TO THE TEST ABOVE, deliberately and with a cost worth stating.
    // The service, the session and the document are module-level, so these
    // figures encode the first test's effect: 90 is what it left, 180 is what
    // the first of this pair produced. Run alone, this case fails loudly rather
    // than passing — so it is not vacuous — but a change to the first test moves
    // this one's expectations for a reason that has nothing to do with what it
    // asserts. Left as it is because the alternative is computing the expected
    // values from the observed ones, which is the assertion agreeing with
    // itself.
    //
    // Three commands have run in this describe block: the first test's, and the
    // two above. Read the LAST TWO, and they must differ — which is the whole
    // assertion, because interleaving makes them identical.
    expect(inverses.at(-2)).toStrictEqual([{ page: 0, prior: { present: true, raw: 90 } }]);
    expect(inverses.at(-1)).toStrictEqual([{ page: 0, prior: { present: true, raw: 180 } }]);
  });

  it('a session that cannot be found is a DEFECT, not an outcome', async () => {
    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: noSessions() });

    await expect(commands.execute(docId, rotateOnce)).rejects.toThrow(MissingSessionError);
  });

  it('a POISONED document is refused before the session is looked up', async () => {
    // Built through the real state transitions, so the fixture is the one a
    // poisoned document is actually in — including that the deaths took its
    // session with them.
    //
    // Which is why the assertion is on the CLASS and not merely on rejecting:
    // with the two reads in the other order this document's missing session
    // wins and the failure arrives as MissingSessionError, a `internal` defect
    // rather than the declared outcome the supervisor decided. Those are the
    // two errors this ordering exists to choose between, so an assertion that
    // accepted either would separate nothing.
    const poisoned = noSessions();
    poisoned.hold(docId, { mupdf: session });
    poisoned.recordFailure([docId], 'host-death');
    poisoned.recordFailure([docId], 'host-death');

    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: poisoned });

    await expect(commands.execute(docId, rotateOnce)).rejects.toThrow(DocumentPoisonedError);
  });

  it('CONTROL: the same document, unpoisoned, reaches the engine and applies', async () => {
    // Without this the case above is satisfied by an `execute` that refuses
    // everything, and by a supervisor whose `poisoned` answers a count for a
    // document it has never heard of.
    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: engine() });

    const applied = await commands.execute(docId, rotateOnce);
    expect(applied.version).toBeGreaterThan(0);
  });
});

describe('the view model is the route a mutation reaches the screen by (OOOOO-1)', () => {
  beforeAll(openDocument);

  it('reports the geometry the session holds, stamped with the lane version', async () => {
    const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: engine() });

    const model = await commands.viewModel(docId, ALL_PAGES);

    expect(model.pageCount).toBe(3);
    expect(model.rotations).toHaveLength(ALL_PAGES.length);
    expect(model.version).toBeGreaterThan(0);
  });

  it('THE CLAIM: a rotate moves the view model while the BYTE ROUTE reports nothing', async () => {
    const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: engine() });

    const before = await commands.viewModel(docId, ALL_PAGES);
    const applied = await commands.execute(docId, rotateOnce);
    const after = await commands.viewModel(docId, ALL_PAGES);

    // The two halves of the finding, side by side, which is the only place they
    // can be compared. `byteLength` is main's canonical image and it does NOT
    // move — a `DocumentRecord`'s bytes are `readonly` — so everything the
    // renderer reads through `document.readRange` is the document it opened.
    expect(applied.byteLength).toBe(openedBytes);
    expect(after.rotations[0]).toBe((before.rotations[0] ?? 0) + 90);
    // AND THE REST OF THE MODEL DID NOT MOVE. Without this, an implementation
    // that reported the last command's rotation for every page passes, and so
    // does one that rebuilt the model from the command's intent rather than
    // from the engine.
    expect(after.rotations.slice(1)).toStrictEqual(before.rotations.slice(1));
    expect(after.version).toBe(applied.version);
  });

  it('a POISONED document refuses the READ rather than answering an empty model', async () => {
    const poisoned = new EngineSessions();
    poisoned.hold(docId, { mupdf: session });
    poisoned.recordFailure([docId], 'host-death');
    poisoned.recordFailure([docId], 'host-death');

    const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: poisoned });

    // The asymmetry this rejects: refusing every command while answering reads
    // would draw a document nobody can act on, and a plausible-looking model is
    // exactly what a caller cannot tell from a current one.
    await expect(commands.viewModel(docId, ALL_PAGES)).rejects.toThrow(DocumentPoisonedError);
  });

  it('a document with no session is a DEFECT here, as it is for a command', async () => {
    const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: noSessions() });

    await expect(commands.viewModel(docId, ALL_PAGES)).rejects.toThrow(MissingSessionError);
  });
});

describe('signatures: only a signature that could not be read answers unreadable (GGGGGG-1)', () => {
  function reading(signatures: () => Promise<never>): DocumentCommands {
    return new DocumentCommands({ ...LOCAL_READS, signatures, documents: service, bus: bus(), engine: engine() });
  }

  it('answers UNREADABLE for the host’s signatures-unreadable refusal', async () => {
    const commands = reading(() =>
      Promise.reject(new EngineCallFailed('engine/signatures', 'signatures-unreadable')),
    );
    await expect(commands.signatures(docId)).resolves.toStrictEqual({ signatures: [], unreadable: true });
  });

  // THE DECISION IS THE ASSERTION: each of these used to resolve to the answer
  // above, which is a sentence about the document. They must reject instead.
  it.each([
    ['another refusal from the host', new EngineCallFailed('engine/signatures', 'signatures-failed')],
    ['a lost session', new EngineSessionGone('engine/signatures')],
    ['a plain throw', new Error('the host went away')],
  ])('PROPAGATES %s rather than calling it an unreadable signature', async (_name, thrown) => {
    const commands = reading(() => Promise.reject(thrown));
    await expect(commands.signatures(docId)).rejects.toBe(thrown);
  });
});

describe('the handler answers ADR-0009 §9 rather than assuming wrapHandler did', () => {
  /** Discards a diagnostic, for the cases that are not about where it went. */
  function ignore(_incident: Incident): void {
    // The sink is required rather than defaulted, so "not interested" has to be
    // written down. See `incident.ts`.
  }

  /** The real boundary, so what is asserted is what would cross a process. */
  function wrapped(commands: DocumentCommands, sink: (incident: Incident) => void = ignore) {
    return wrapHandler(
      channels,
      'document.execute',
      executeCommandHandler(commands),
      new IncidentLog(sink),
    );
  }

  function recorder(): { sink: (incident: Incident) => void; seen: Incident[] } {
    const seen: Incident[] = [];
    return { sink: (incident) => seen.push(incident), seen };
  }

  it('a document that is not open is a DECLARED code, carrying no incident id', async () => {
    const closed = new DocumentService(new CapabilityRegistry(), { documentBytesCeiling: AMPLE_CEILING });
    const commands = new DocumentCommands({ ...INERT, documents: closed, bus: bus(), engine: engine() });
    const result = await wrapped(commands)({ docId, command: rotateOnce });

    // The whole failure, asserted as a whole: a declared outcome hides nothing,
    // so there is no log entry for an id to point at.
    expect(result).toStrictEqual({ ok: false, error: { code: 'document-not-open' } });
  });

  it('CONTROL: a defect becomes `internal` with an id the log actually minted', async () => {
    // Without this, the case above is satisfied by a handler that reports
    // `document-not-open` for everything.
    const { sink, seen } = recorder();
    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: noSessions() });
    const result = await wrapped(commands, sink)({ docId, command: rotateOnce });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal');
    if (result.error.code !== 'internal') return;
    expect(seen[0]?.id).toBe(result.error.incident);
  });

  describe('a region recognition the SERVICE refused is a declared code, not `internal`', () => {
    /** The Claude region tool's command, as `ocrRegionTool.ts` builds it. */
    const claudeRegion: Command = {
      kind: 'ocrPage',
      page: 0,
      language: 'eng',
      engine: 'claude',
      region: { x0: 72, y0: 72, x1: 300, y1: 200 },
    };

    /** Commands whose recognition pre-read answers with `thrown`, counting the calls. */
    function refusedBy(thrown: Error): { commands: DocumentCommands; asked: () => number } {
      let asked = 0;
      const commands = new DocumentCommands({
        ...LOCAL_READS,
        ocr: () => {
          asked += 1;
          return Promise.reject(thrown);
        },
        documents: service,
        // PDF-LIB AND A REAL FLUSH, because pdf-lib writes the recognised layer from the
        // document's bytes: without either the bus refuses before the pre-read, and the service
        // is never asked — which the count below is there to catch.
        save: { ...noSaving, flush: sessionFlush },
        bus: new CommandBus({ mupdf: localMupdfWriter, 'pdf-lib': localPdfLibWriter }),
        engine: engine(),
      });
      return { commands, asked: () => asked };
    }

    it.each([
      [new ClaudeRecognitionRefused('out-of-credit', 'the Anthropic account is out of credit (400)'), 'service-out-of-credit'],
      [new ClaudeRecognitionRefused('unauthorised', 'the Claude API refused the key (401)'), 'service-unauthorised'],
      [new AzureRecognitionRefused('timed-out', 'Azure did not finish'), 'service-unavailable'],
      [new ClaudeRecognitionRefused('truncated', 'the answer was cut off'), 'service-refused'],
      [new NetworkKeyMissing('claude'), 'service-no-key'],
    ])('%s reaches the renderer as %s, with nothing logged', async (thrown, code) => {
      const { sink, seen } = recorder();
      const { commands, asked } = refusedBy(thrown);

      const result = await wrapped(commands, sink)({ docId, command: claudeRegion });

      // THE PRE-READ RAN: without it the code could come from anywhere upstream of the service.
      expect(asked()).toBe(1);
      expect(result).toStrictEqual({ ok: false, error: { code } });
      expect(seen).toStrictEqual([]);
    });

    it('CONTROL: an ordinary throw from the same pre-read is still a defect, with an incident', async () => {
      const { sink, seen } = recorder();
      const { commands, asked } = refusedBy(new Error('not a service answer'));

      const result = await wrapped(commands, sink)({ docId, command: claudeRegion });

      expect(asked()).toBe(1);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('internal');
      expect(seen).toHaveLength(1);
    });
  });

  describe('the VIEW MODEL handler maps the same classes, and nothing had checked (RRRRR-1)', () => {
    /**
     * The real boundary again, for the read rather than the command.
     *
     * A separate wrapper because `wrapHandler` is bound to one channel: it
     * validates against that channel's schemas, so asserting the view model's
     * codes through `document.execute`'s wrapper would prove nothing about the
     * channel a renderer actually calls.
     */
    function wrappedRead(commands: DocumentCommands, sink: (incident: Incident) => void = ignore) {
      return wrapHandler(
        channels,
        'document.viewModel',
        createContractHandlers({
          // INERT: this case is about a document command, and an assistant with no key
          // and nowhere to push answers the state a machine without one is in.
          assistant: createAssistant({ secret: () => undefined, setting: () => undefined, send: () => undefined }),
          appInfo: { version: '0.0.0', installChannel: 'development' },
          capabilities: new CapabilityRegistry(),
          commands,
          documents: service,
          openedDocument: () => Promise.resolve(),
          unlockDocument: () => Promise.resolve({ kind: 'not-locked' as const }),
          pickDocument: () => Promise.resolve(null),
          recent: createRecentFiles({ read: () => ({}), write: () => undefined }),
          settings: { read: () => ({}), write: () => undefined },
          secrets: { available: () => false, read: () => ({}), write: () => undefined },
          revealLog: () => Promise.resolve(false),
          titleBarOverlay: () => false,
          confirmClose: () => false,
          copySelection: () => false,
          closeListening: () => false,
          readDictionary: () => Promise.resolve(null),
          ocrLanguages: () => Promise.resolve([]),
        })['document.viewModel'],
        new IncidentLog(sink),
      );
    }

    it('a POISONED document reaches the renderer as a declared code, not as `internal`', async () => {
      // The mapping is what `commandHandlers.ts` exists to do, and its failure
      // mode is a class that stops being matched and arrives as `internal` with
      // its diagnostic withheld — an unexplained defect for the one refusal a
      // user can be told about. `documentCommands.test.ts` proved the METHOD
      // throws; nothing proved the handler answers.
      const poisoned = new EngineSessions();
      poisoned.hold(docId, { mupdf: session });
      poisoned.recordFailure([docId], 'host-death');
      poisoned.recordFailure([docId], 'host-death');
      const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: poisoned });

      const result = await wrappedRead(commands)({ docId, pages: [0] });

      expect(result).toStrictEqual({ ok: false, error: { code: 'document-poisoned' } });
    });

    it('CONTROL: the same handler ANSWERS for a document that is fine', async () => {
      // Without this, the case above is satisfied by a handler that refuses
      // everything — which would blank the renderer while looking like careful
      // error mapping.
      const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: engine() });

      const result = await wrappedRead(commands)({ docId, pages: [0] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.pageCount).toBe(3);
      expect(result.value.rotations).toHaveLength(1);
    });

    it('a defect is `internal` with an id, so the two are not one bucket', async () => {
      const { sink, seen } = recorder();
      const commands = new DocumentCommands({ ...LOCAL_READS, documents: service, bus: bus(), engine: noSessions() });

      const result = await wrappedRead(commands, sink)({ docId, pages: [0] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('internal');
      if (result.error.code !== 'internal') return;
      expect(seen[0]?.id).toBe(result.error.incident);
    });
  });

  describe('THE PATH DOES NOT CROSS, and the control proves it was there to cross', () => {
    /**
     * The measured shape, constructed directly so it holds on every platform.
     *
     * A rethrown `EPERM` from the kernel's identity read looks exactly like
     * this, with the same path in the stack — and the main-side diagnostic
     * copies the message, copies the stack, and recurses into the cause with
     * itself, so all three carry it.
     *
     * The function that does that copying is deliberately **not named here**.
     * The advisory register's reachability walk is a text search over this
     * glob and cannot tell a comment from a call, so naming it would expire
     * the verdict this file exists to evidence. That is the instrument being
     * right rather than blunt: a comment in a scanned file is scanned text,
     * and `mupdfWriter.ts` learned the same thing about the format dispatcher.
     */
    const SECRET = 'C:\\Users\\someone\\Documents\\salary-review.pdf';

    function throwsWithPath(): DocumentCommands {
      return new DocumentCommands({
        ...INERT,
        documents: service,
        bus: bus(),
        engine: {
          poisoned: () => undefined,
          sessions: () => {
            const cause = new Error(`EPERM: operation not permitted, stat '${SECRET}'`);
            cause.stack = `Error: EPERM: operation not permitted, stat '${SECRET}'\n    at readFileIdentity (${SECRET}:1:1)`;
            const thrown = new Error(`Could not read ${SECRET}`, { cause });
            thrown.stack = `Error: Could not read ${SECRET}\n    at sessionFor (${SECRET}:2:2)`;
            throw thrown;
          },
        },
      });
    }

    it('the renderer-facing failure carries the path in NO field', async () => {
      const result = await wrapped(throwsWithPath())({ docId, command: rotateOnce });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      // Serialised, so a field nobody thought to name is covered too.
      expect(JSON.stringify(result.error)).not.toContain(SECRET);
      expect(JSON.stringify(result.error)).not.toContain('salary-review');
      // And by name, one at a time: a sanitiser that missed one of the three
      // would pass a test that checked the other two.
      const asRecord = result.error as unknown as Record<string, unknown>;
      expect(asRecord['message']).toBeUndefined();
      expect(asRecord['stack']).toBeUndefined();
      expect(asRecord['cause']).toBeUndefined();
      expect(Object.keys(result.error).sort()).toStrictEqual(['code', 'incident']);
    });

    it('CONTROL: and the path IS in message, stack and a NESTED cause, main-side', async () => {
      // B2's control: this reproduces the leak the case above asserts is
      // closed. Without it that case passes against an error that never
      // carried a path — the vacuous shape, in the exact place §9 is about.
      const { sink, seen } = recorder();
      await wrapped(throwsWithPath(), sink)({ docId, command: rotateOnce });

      const diagnostic = seen[0]?.diagnostic;
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.message).toContain(SECRET);
      expect(diagnostic?.stack).toContain(SECRET);
      expect(diagnostic?.cause?.message).toContain(SECRET);
      expect(diagnostic?.cause?.stack).toContain(SECRET);
    });
  });

  it('everything this channel puts on the wire survives structuredClone, deep-equal', async () => {
    // The hard shape an in-process test cannot see (audit item 2): the
    // transport clones, and a value carrying anything unclonable passes every
    // function call and dies at the first Electron call.
    const commands = new DocumentCommands({ ...INERT, documents: service, bus: bus(), engine: engine() });
    const params = { docId, command: rotateOnce };
    expect(structuredClone(params)).toStrictEqual(params);

    const success = await wrapped(commands)(params);
    expect(structuredClone(success)).toStrictEqual(success);

    const closed = new DocumentService(new CapabilityRegistry(), { documentBytesCeiling: AMPLE_CEILING });
    const declined = await wrapped(
      new DocumentCommands({ ...INERT, documents: closed, bus: bus(), engine: engine() }),
    )(params);
    expect(structuredClone(declined)).toStrictEqual(declined);
  });

  describe('save, through the real service and the real filesystem', () => {
    /** Names each case's own file. A counter rather than a clock: same run, same names. */
    let savables = 0;

    /**
     * ITS OWN FILE AND ITS OWN SERVICE, deliberately.
     *
     * These cases WRITE, and the shared fixture is opened once in `beforeAll`
     * and read by every other case in this file. A save over it would leave
     * later cases running against bytes MuPDF produced rather than the bytes
     * `pdfBytes` wrote — which would not fail, and that is the problem: a
     * fixture quietly replaced mid-file is the kind of coupling that surfaces
     * as an unrelated case going red weeks later.
     */
    async function aSavableDocument(): Promise<{
      commands: DocumentCommands;
      saved: DocId;
      path: string;
      before: Uint8Array;
    }> {
      savables += 1;
      const path = join(directory, `save-${String(savables)}.pdf`);
      const before = await pdfBytes();
      writeFileSync(path, before);

      const registry = new CapabilityRegistry();
      const own = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
      const outcome = await own.open(registry.mint(path));
      if (outcome.kind !== 'opened') throw new Error(`fixture did not open: ${outcome.kind}`);

      const held = new EngineSessions();
      held.hold(outcome.docId, { mupdf: session });

      return {
        path,
        before,
        saved: outcome.docId,
        commands: new DocumentCommands({
          ...LOCAL_READS,
          documents: own,
          bus: bus(),
          engine: held,
          save: {
            // THE REAL SURFACE AND THE REAL CHECK. Every other case in this
            // file is about a decision; this one is the first caller, and a
            // seam whose every test injects its surfaces is unproven against a
            // filesystem that has opinions about renaming open files on
            // Windows.
            deps: {
              checkWriteTarget: (id) => own.checkWriteTarget(id),
              surface: nodeFileSurface,
              names: siblingNames,
              wait: () => Promise.resolve(),
            },
            flush: (_docId, sessions) => {
              const held_ = sessions.mupdf;
              if (held_ === undefined) throw new Error('the fixture holds a session');
              return mupdfWriter.serialise(held_);
            },
          },
        }),
      };
    }

    it('writes the engine bytes to the document own file, and leaves a .bak', async () => {
      const { commands, saved, path, before } = await aSavableDocument();

      const outcome = await commands.save(saved);

      expect(outcome.kind).toBe('saved');
      if (outcome.kind !== 'saved') throw new Error('the save did not happen');
      expect(outcome.backedUp).toBe(true);

      // THE BYTES ON DISK ARE THE ENGINE'S, not the ones the fixture wrote.
      // Asserting only that the file still exists would pass for a pipeline
      // that wrote nothing at all — and for one that copied the original over
      // itself, which is the failure a save silently produces when the flush
      // is wired to the wrong thing.
      const after = readFileSync(path);
      expect(after.byteLength).toBe(outcome.bytes);
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
      // It is still a PDF, which is what separates "MuPDF serialised" from
      // "something wrote bytes".
      expect(after.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      // §4's `.bak`: the user's previous version, surviving a successful save.
      const backup = readFileSync(siblingNames(path).backup);
      expect(Buffer.from(backup).equals(Buffer.from(before))).toBe(true);
    });

    it('CONTROL: the check RUNS — a target that vanished refuses, and does not flush', async () => {
      // The case that proves `checkWriteTarget` is wired in at all. Without it
      // a pipeline that never called the check passes the case above, since a
      // sole-writer verdict and no verdict lead to the same successful write.
      //
      // `target-absent` rather than `contested`, and the reason is a fact about
      // the service worth recording: `DocumentService` DEDUPLICATES — one file
      // is one document — so opening the same path twice returns the same
      // `DocId` and cannot produce a contest. That needs two paths naming one
      // file, which is a hard link, and it is `documentService.test.ts`'
      // territory rather than this seam's.
      const { commands, saved, path } = await aSavableDocument();
      rmSync(path);

      const outcome = await commands.save(saved);

      expect(outcome.kind).toBe('refused');
      if (outcome.kind !== 'refused') throw new Error('the save should have been refused');
      expect(outcome.verdict.kind).toBe('target-absent');
      // NOT RECREATED. A pipeline that treated `target-absent` as permission
      // would leave a file here, and the user's document would have been
      // silently re-established at a path something else had removed.
      expect(existsSync(path)).toBe(false);
    });
  });
});

/**
 * The KERNEL half of search's wired pair (`CLAUDE.md`'s wired-tools rule).
 *
 * A UI test can only say a control dispatched `document.searchPage`. What it
 * cannot say is that the command finds text that is really in the document, in
 * the order a reader meets it — and a search that dispatched perfectly into a
 * handler answering nothing is the display-only sin one layer down.
 *
 * So these run against a **real MuPDF session over a real document whose text
 * this file placed**, through the production composition: `DocumentCommands`,
 * the real `EngineSessions`, and `readPageText` behind `localPageText`.
 */
describe('search is E2s first consumer, through the composition point', () => {
  /** Two pages, with the needle only on the second. */
  const PAGE_LINES = [
    ['alpha on the first page', 'beta on the first page'],
    ['gamma on the second page', 'the needle sits here', 'delta on the second page'],
  ];

  let searchable: DocId;
  let searchSession: MupdfSession;
  let searchService: DocumentService;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const lines of PAGE_LINES) {
      const sheet = document.addPage([612, 792]);
      for (const [index, text] of lines.entries()) {
        sheet.drawText(text, { x: 72, y: 700 - index * 24, size: 12, font });
      }
    }
    const bytes = await document.save({ useObjectStreams: false });

    const path = join(directory, 'searchable.pdf');
    writeFileSync(path, bytes);
    const registry = new CapabilityRegistry();
    searchService = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await searchService.open(registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    searchable = outcome.docId;
    searchSession = await mupdfWriter.open(bytes);
  });

  function searchCommands(): DocumentCommands {
    const held = new EngineSessions();
    held.hold(searchable, { mupdf: searchSession });
    return new DocumentCommands({
      ...LOCAL_READS,
      documents: searchService,
      bus: bus(),
      engine: held,
    });
  }

  it('finds text that is really in the document, on the page it is on', async () => {
    const found = await searchCommands().searchPage(searchable, 1, 'needle', 10);

    expect(found.matches).toHaveLength(1);
    expect(found.matches[0]?.text).toBe('the needle sits here');
    // The page comes back stamped with the page that was searched, so a caller
    // holding results from several pages needs no bookkeeping of its own.
    expect(found.matches[0]?.page).toBe(1);
    expect(found.matches[0]?.line).toBe(1);
    expect(found.truncated).toBe(false);
  });

  it('CONTROL: the same query on the page WITHOUT it finds nothing', async () => {
    // Without this, the case above passes for a search that ignores its page
    // argument and scans the document — which is precisely what ADR-0035
    // forbids and what a page-at-a-time channel exists to prevent.
    const found = await searchCommands().searchPage(searchable, 0, 'needle', 10);
    expect(found.matches).toStrictEqual([]);
  });

  it('stamps the version the LANE read at, as every query here does', async () => {
    const found = await searchCommands().searchPage(searchable, 1, 'needle', 10);
    expect(found.version).toBeGreaterThan(0);
  });

  it('reports truncation, and does NOT report it for a page holding exactly the limit', async () => {
    // THE OFF-BY-ONE THIS PAIR EXISTS FOR. `matches.length === limit` cannot
    // tell a full page from a truncated one, so a results surface built on it
    // pages past the end of the document for ever.
    const commands = searchCommands();

    // 'the' appears on both lines 0 and 2 of page 1, and in 'the needle sits
    // here' — three occurrences, so a limit of 3 is exactly full.
    const exact = await commands.searchPage(searchable, 1, 'the', 3);
    expect(exact.matches).toHaveLength(3);
    expect(exact.truncated).toBe(false);

    const cut = await commands.searchPage(searchable, 1, 'the', 2);
    expect(cut.matches).toHaveLength(2);
    expect(cut.truncated).toBe(true);
  });

  it('REFUSES a page outside the document rather than answering with no matches', async () => {
    // An empty result list is what a user reads as "your word is not in this
    // document", so a bad page index must never produce one.
    await expect(searchCommands().searchPage(searchable, 9, 'needle', 10)).rejects.toThrow(
      RangeError,
    );
  });

  it('refuses a poisoned document, as every command and query here does', async () => {
    // Poisoned the way the supervisor poisons: two consecutive failures, which
    // is Decision 9a's bound. Reaching for a shortcut here would test a state
    // the real component cannot produce.
    const poisonedHost = new EngineSessions();
    poisonedHost.hold(searchable, { mupdf: searchSession });
    poisonedHost.recordFailure([searchable], 'host-death');
    poisonedHost.recordFailure([searchable], 'host-death');
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      documents: searchService,
      bus: bus(),
      engine: poisonedHost,
    });

    // The asymmetry this prevents: a search answering while every command is
    // refused tells the user their word is absent from a document nobody can
    // act on.
    await expect(commands.searchPage(searchable, 1, 'needle', 10)).rejects.toBeInstanceOf(
      DocumentPoisonedError,
    );
  });
});

/**
 * The MIDDLE of the form-data export's wired pair, and it is the half neither
 * end can see.
 *
 * `formData.test.ts` proves the three encoders produce three different files
 * from the same fields. `commands/documentCommands.test.ts` proves the three
 * controls dispatch three different `format` values. **Both are green if the
 * composition drops the argument** — three controls that all write JSON, a
 * correct encoder table nobody reaches with anything but `'json'`, and two
 * tests on opposite sides of the boundary each correct in its own frame.
 *
 * That is the pair's blind spot with a string enum in place of a page index.
 * So this drives the real `DocumentCommands` against a real session, writes
 * two formats to two files, and reads what landed.
 */
describe('barcodes — placed from typed text and read back, through the lane (ADR-0076)', () => {
  beforeAll(openDocument);

  it('places the symbol the production writer makes, in its own proportions, and the page reads it back', async () => {
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      // A PLACED IMAGE IS DRAWN FROM THE BYTES, so placing one flushes (ADR-0084).
      save: { ...noSaving, flush: sessionFlush },
      writeBarcode: lazyBarcodeWriter,
      documents: service,
      bus: bus(),
      engine: engine(),
    });

    const before = await commands.pageBarcodes(docId, 0);
    expect(before.barcodes).toStrictEqual([]);

    // A WIDE BOX, so a placement that filled it would squeeze the symbol.
    const placed = await commands.placeBarcode(docId, [0], { x0: 40, y0: 40, x1: 440, y1: 200 }, 'MONSTERA 42', 'QRCode');
    expect(placed.kind).toBe('placed');

    const after = await commands.pageBarcodes(docId, 0);
    expect(after.barcodes).toStrictEqual([{ format: 'QRCode', text: 'MONSTERA 42' }]);
    // The read is stamped with the version the placement produced, so a list can be discarded
    // when the page it describes has moved.
    expect(after.version).toBe(before.version + 1);

    // AND IT IS A /Stamp OF A SQUARE BOX, which is what the fit is for.
    const stamped = await readAnnotations(session);
    const box = stamped.annotations.at(-1)?.rect;
    expect(box).toBeDefined();
    if (box === undefined || box === null) return;
    expect(box.x1 - box.x0).toBeCloseTo(box.y1 - box.y0, 6);
  });

  it('a text the symbology cannot carry is REFUSED and the document does not move', async () => {
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      // A PLACED IMAGE IS DRAWN FROM THE BYTES, so placing one flushes (ADR-0084).
      save: { ...noSaving, flush: sessionFlush },
      writeBarcode: lazyBarcodeWriter,
      documents: service,
      bus: bus(),
      engine: engine(),
    });
    const before = await commands.pageBarcodes(docId, 0);
    expect(await commands.placeBarcode(docId, [0], { x0: 40, y0: 40, x1: 440, y1: 200 }, 'letters', 'EAN13')).toStrictEqual({
      kind: 'refused',
    });
    expect((await commands.pageBarcodes(docId, 0)).version).toBe(before.version);
  });
});

describe('pageStructure — a tagged page’s elements, never its words (ADR-0065)', () => {
  /**
   * One page whose structure tree lists its second-drawn paragraph FIRST.
   *
   * Assembled by hand because pdf-lib writes no marked content. These are the
   * objects the 2026-09-14 probe read MuPDF 1.28.0's tree order from: stream order
   * is *drawn first, drawn second*, and the tree says the reverse.
   */
  function taggedPdf(): Uint8Array {
    const content =
      '/P <</MCID 0>> BDC BT /F1 14 Tf 72 200 Td (drawn first) Tj ET EMC\n' +
      '/P <</MCID 1>> BDC BT /F1 14 Tf 72 600 Td (drawn second) Tj ET EMC\n';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R /MarkInfo << /Marked true >> /StructTreeRoot 5 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R /StructParents 0 >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /StructTreeRoot /K 6 0 R /ParentTree << /Nums [0 [9 0 R 8 0 R]] >> >>',
      '<< /Type /StructElem /S /Document /P 5 0 R /K [8 0 R 9 0 R] >>',
      `<< /Length ${String(content.length)} >>\nstream\n${content}endstream`,
      '<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K 1 >>',
      '<< /Type /StructElem /S /P /P 6 0 R /Pg 3 0 R /K 0 >>',
    ];
    let body = '%PDF-1.7\n';
    const offsets: number[] = [];
    for (const [index, object] of objects.entries()) {
      offsets.push(body.length);
      body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
    }
    const xref = body.length;
    body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
    return new TextEncoder().encode(body);
  }

  let tagged: DocId;
  let taggedSession: MupdfSession;
  let untagged: DocId;
  let untaggedSession: MupdfSession;
  let structureService: DocumentService;

  beforeAll(async () => {
    const registry = new CapabilityRegistry();
    structureService = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });

    const taggedBytes = taggedPdf();
    const taggedPath = join(directory, 'tagged.pdf');
    writeFileSync(taggedPath, taggedBytes);
    const openedTagged = await structureService.open(registry.mint(taggedPath));
    if (openedTagged.kind !== 'opened') throw new Error(`Fixture did not open: ${openedTagged.kind}`);
    tagged = openedTagged.docId;
    taggedSession = await mupdfWriter.open(taggedBytes);

    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([612, 792]).drawText('an untagged line', { x: 72, y: 700, size: 12, font });
    const untaggedBytes = await document.save({ useObjectStreams: false });
    const untaggedPath = join(directory, 'untagged.pdf');
    writeFileSync(untaggedPath, untaggedBytes);
    const openedUntagged = await structureService.open(registry.mint(untaggedPath));
    if (openedUntagged.kind !== 'opened') {
      throw new Error(`Fixture did not open: ${openedUntagged.kind}`);
    }
    untagged = openedUntagged.docId;
    untaggedSession = await mupdfWriter.open(untaggedBytes);
  });

  function structureCommands(): DocumentCommands {
    const held = new EngineSessions();
    held.hold(tagged, { mupdf: taggedSession });
    held.hold(untagged, { mupdf: untaggedSession });
    return new DocumentCommands({
      ...LOCAL_READS,
      documents: structureService,
      bus: bus(),
      engine: held,
    });
  }

  it('answers the elements in TREE order, each with its own lines', async () => {
    const answer = await structureCommands().pageStructure(tagged, 0);

    expect(answer.nodes).toStrictEqual([
      { role: 'Document', raw: 'Document', depth: 0, lines: 0 },
      { role: 'P', raw: 'P', depth: 1, lines: 1 },
      { role: 'P', raw: 'P', depth: 1, lines: 1 },
    ]);
    expect(answer.untaggedLines).toBe(0);
    expect(answer.truncated).toBe(false);
  });

  it('CONTROL: the same lane’s TEXT read of that page follows the stream, not the tree', async () => {
    // What separates the two reads. If the substrate read also followed the tree,
    // an answer above could have come from either name, and a reader that asked
    // for the wrong one would pass.
    const found = await structureCommands().searchPage(tagged, 0, 'drawn', 10);
    expect(found.matches.map((match) => match.text)).toStrictEqual(['drawn first', 'drawn second']);
  });

  it('carries NONE of the page’s words', async () => {
    // The control above shows the page does hold `drawn`, so an absence here is
    // the lane dropping the text rather than a page with none (ADR-0035).
    const answer = await structureCommands().pageStructure(tagged, 0);
    expect(JSON.stringify(answer)).not.toContain('drawn');
  });

  it('an untagged page answers no elements, and counts its line as outside every tag', async () => {
    const answer = await structureCommands().pageStructure(untagged, 0);
    expect(answer.nodes).toStrictEqual([]);
    expect(answer.untaggedLines).toBe(1);
  });
});

describe('the form data export carries the format all the way to the file', () => {
  let formDoc: DocId;
  let formSession: MupdfSession;
  let formService: DocumentService;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 600]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    const fields = document.getForm();
    const text = fields.createTextField('applicant.name');
    // A VALUE CARRYING THE CONSTRUCT, so a file written by an unescaped
    // encoder is a file this case can tell apart from a correct one.
    text.setText('Ada ) Lovelace');
    text.addToPage(page, { x: 20, y: 540, width: 200, height: 18, font, borderWidth: 0 });
    const bytes = await document.save();

    const path = join(directory, 'form.pdf');
    writeFileSync(path, bytes);
    const registry = new CapabilityRegistry();
    formService = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await formService.open(registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    formDoc = outcome.docId;
    formSession = await mupdfWriter.open(bytes);
  });

  /** The production composition, with a picker answering a path this case owns. */
  function exportingTo(destination: string): DocumentCommands {
    const held = new EngineSessions();
    held.hold(formDoc, { mupdf: formSession });
    return new DocumentCommands({
      ...LOCAL_READS,
      documents: formService,
      bus: bus(),
      engine: held,
      // THE REAL WRITE PATH, for the save cases' reason: what this claims is
      // that a file lands, and an injected surface cannot say so.
      save: {
        deps: {
          checkWriteTarget: (id) => formService.checkWriteTarget(id),
          surface: nodeFileSurface,
          names: siblingNames,
          wait: () => Promise.resolve(),
        },
        flush: () => Promise.reject(new Error('an export does not flush the document')),
      },
      copy: {
        pick: () => Promise.reject(new Error('this case does not write a copy')),
        checkTarget: (target) => formService.checkCopyTarget(target),
      },
      formData: { ...localFormData, pick: () => Promise.resolve(destination) },
    });
  }

  it('writes FDF and JSON to two files, and the two differ', async () => {
    const asFdf = join(directory, 'exported.fdf');
    const asJson = join(directory, 'exported.json');

    expect((await exportingTo(asFdf).exportFormData(formDoc, 'fdf'))?.kind).toBe('copied');
    expect((await exportingTo(asJson).exportFormData(formDoc, 'json'))?.kind).toBe('copied');

    const fdf = readFileSync(asFdf).toString('latin1');
    const json = readFileSync(asJson).toString('utf8');

    // EACH FILE IS THE FORMAT THAT WAS ASKED FOR. A composition that dropped
    // the argument writes the same bytes twice, and asserting only that files
    // exist would pass for it.
    expect(fdf.startsWith('%FDF-')).toBe(true);
    expect(JSON.parse(json)).toMatchObject({ format: 'monstera-form-data' });

    // AND THE VALUE SURVIVED, escaped. Without this the case passes for an
    // export that wrote a well-formed file holding no fields — which is the
    // shape a wrong session or an empty read produces.
    expect(fdf).toContain('Ada \\) Lovelace');
    expect(json).toContain('Ada ) Lovelace');
  });

  it('CONTROL: the picker runs FIRST, so a dismissal writes nothing', async () => {
    // `undefined` is the dismissal, and it is an outcome rather than a failure.
    // Without this the case above passes for a command that ignored the picker
    // and wrote wherever it liked.
    const untouched = join(directory, 'never-written.fdf');
    const held = new EngineSessions();
    held.hold(formDoc, { mupdf: formSession });
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      documents: formService,
      bus: bus(),
      engine: held,
      formData: {
        ...localFormData,
        pick: () => Promise.resolve(null),
        encode: () => Promise.reject(new Error('a dismissed picker must not reach the encoder')),
      },
    });

    expect(await commands.exportFormData(formDoc, 'fdf')).toBeUndefined();
    expect(existsSync(untouched)).toBe(false);
  });
});

describe('annotations exported to a file and imported from it, through the lane (ADR-0077)', () => {
  let annotatedDoc: DocId;
  let annotatedSession: MupdfSession;
  let blankDoc: DocId;
  let blankSession: MupdfSession;
  let exchangeService: DocumentService;

  beforeAll(async () => {
    const annotated = await PDFDocument.create();
    const page = annotated.addPage([400, 600]);
    const square = annotated.context.register(
      annotated.context.obj({
        Type: 'Annot',
        Subtype: 'Square',
        Rect: [20, 20, 120, 80],
        C: [1, 0, 0],
        Contents: PDFString.of('Check this (twice)'),
      }),
    );
    page.node.set(PDFName.of('Annots'), annotated.context.obj([square]));
    const annotatedBytes = await annotated.save();
    const blank = await PDFDocument.create();
    blank.addPage([400, 600]);
    const blankBytes = await blank.save();

    const registry = new CapabilityRegistry();
    exchangeService = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const annotatedPath = join(directory, 'annotated.pdf');
    const blankPath = join(directory, 'blank-for-annotations.pdf');
    writeFileSync(annotatedPath, annotatedBytes);
    writeFileSync(blankPath, blankBytes);
    const first = await exchangeService.open(registry.mint(annotatedPath));
    const second = await exchangeService.open(registry.mint(blankPath));
    if (first.kind !== 'opened' || second.kind !== 'opened') throw new Error('a fixture did not open');
    annotatedDoc = first.docId;
    blankDoc = second.docId;
    annotatedSession = await mupdfWriter.open(annotatedBytes);
    blankSession = await mupdfWriter.open(blankBytes);
  });

  /**
   * `flushes` counts what the flush was asked for. It REFUSED until 2026-09-18, which asserted
   * *an export does not flush*; an import now flushes by design (ADR-0084), so the count keeps
   * the export's half and states the import's.
   */
  function commandsWith(annotationData: AnnotationDataSource, flushes: DocId[] = []): DocumentCommands {
    const held = new EngineSessions();
    held.hold(annotatedDoc, { mupdf: annotatedSession });
    held.hold(blankDoc, { mupdf: blankSession });
    return new DocumentCommands({
      ...LOCAL_READS,
      documents: exchangeService,
      bus: bus(),
      engine: held,
      save: {
        deps: {
          checkWriteTarget: (id) => exchangeService.checkWriteTarget(id),
          surface: nodeFileSurface,
          names: siblingNames,
          wait: () => Promise.resolve(),
        },
        flush: (docId, sessions) => {
          flushes.push(docId);
          return sessionFlush(docId, sessions);
        },
      },
      copy: {
        pick: () => Promise.reject(new Error('this case does not write a copy')),
        checkTarget: (target) => exchangeService.checkCopyTarget(target),
      },
      annotationData,
    });
  }

  for (const format of ['xfdf', 'fdf', 'json'] as const) {
    it(`${format}: one document's comments land in a file, and the file adds them to another`, async () => {
      const file = join(directory, `comments.${format}`);
      const exportFlushes: DocId[] = [];
      const exported = await commandsWith(
        { ...localAnnotationData, pick: () => Promise.resolve(file) },
        exportFlushes,
      ).exportAnnotations(annotatedDoc, format);
      expect(exported?.kind).toBe('copied');
      // AN EXPORT READS THE ANNOTATIONS AND FLUSHES NOTHING.
      expect(exportFlushes).toStrictEqual([]);

      const importFlushes: DocId[] = [];
      const imported = await commandsWith(
        {
          ...localAnnotationData,
          open: () => Promise.resolve(file),
          read: (path) => Promise.resolve({ kind: 'read', bytes: new Uint8Array(readFileSync(path)) }),
        },
        importFlushes,
      ).importAnnotations(blankDoc, format);
      expect(imported.kind).toBe('imported');
      // AN IMPORT IS DRAWN FROM THE BYTES, so it hands main the document once (ADR-0084).
      expect(importFlushes).toStrictEqual([blankDoc]);

      const landed = await readInterchangeAnnotations(blankSession);
      expect(landed.at(-1)).toMatchObject({
        subtype: 'Square',
        rect: [20, 20, 120, 80],
        colour: [1, 0, 0],
        contents: 'Check this (twice)',
      });
    });
  }

  it('a file that is not annotation data is UNREADABLE, and the document does not move', async () => {
    const file = join(directory, 'not-comments.json');
    writeFileSync(file, '{"format":"monstera-form-data","version":1,"fields":[]}');
    const commands = commandsWith({
      ...localAnnotationData,
      open: () => Promise.resolve(file),
      read: (path) => Promise.resolve({ kind: 'read', bytes: new Uint8Array(readFileSync(path)) }),
    });
    const before = (await readInterchangeAnnotations(blankSession)).length;
    expect(await commands.importAnnotations(blankDoc, 'json')).toStrictEqual({ kind: 'unreadable' });
    expect(await readInterchangeAnnotations(blankSession)).toHaveLength(before);
  });

  /*
   * THE ANNOTATION CLIPBOARD (2026-09-21) — held here in main because a paste is an
   * `importAnnotations`, which the renderer may not send. These run LAST in this block: they add
   * marks to the shared sessions, so they count before and after rather than assuming a page is
   * empty, and the export cases above have already read what they needed.
   */
  const refuseData: AnnotationDataSource = {
    ...localAnnotationData,
    open: () => Promise.reject(new Error('a clipboard case picks no file')),
  };

  it('PASTE WITH NOTHING COPIED is empty, and adds nothing', async () => {
    const commands = commandsWith(refuseData);
    const before = (await readInterchangeAnnotations(blankSession)).length;
    expect(await commands.pasteAnnotations(blankDoc, 0)).toStrictEqual({ kind: 'empty' });
    expect(await readInterchangeAnnotations(blankSession)).toHaveLength(before);
  });

  it('a copy at a version the document has left is STALE, and the clipboard stays empty', async () => {
    // The handles are positions in the walk the renderer's selection was read at. A document that
    // has moved renumbers that walk, so a copy that went ahead would take a different mark.
    const commands = commandsWith(refuseData);
    const { version } = await commands.annotations(annotatedDoc);
    const moved = asDocVersion(Number(version) + 1);
    expect(await commands.copyAnnotations(annotatedDoc, 0, [0], moved)).toStrictEqual({ kind: 'stale' });
    expect(await commands.pasteAnnotations(blankDoc, 0)).toStrictEqual({ kind: 'empty' });
  });

  it('COPIES a mark and PASTES it into ANOTHER document, where it lands un-nudged', async () => {
    const commands = commandsWith(refuseData);
    const { version } = await commands.annotations(annotatedDoc);
    expect(await commands.copyAnnotations(annotatedDoc, 0, [0], version)).toStrictEqual({
      kind: 'copied',
      copied: 1,
      skipped: 0,
    });
    const before = await readInterchangeAnnotations(blankSession);
    const outcome = await commands.pasteAnnotations(blankDoc, 0);
    expect(outcome.kind).toBe('pasted');
    const after = await readInterchangeAnnotations(blankSession);
    expect(after).toHaveLength(before.length + 1);
    // THE NEWEST MARK IS LAST: the importer appends to `/Annots`, and the walk is `/Annots` order.
    const added = after[after.length - 1];
    expect(added?.contents).toBe('Check this (twice)');
    // THE SAME PAGE NUMBER, A DIFFERENT DOCUMENT: exactly where the square was. This is the case
    // the kernel's first rule failed, which inferred "its own page" from the page number alone.
    expect(added?.rect).toStrictEqual([20, 20, 120, 80]);
  });

  it('pasted BACK onto its own page of its own document, it is NUDGED so it can be seen', async () => {
    const commands = commandsWith(refuseData);
    const { version } = await commands.annotations(annotatedDoc);
    await commands.copyAnnotations(annotatedDoc, 0, [0], version);
    const before = (await readInterchangeAnnotations(annotatedSession)).length;
    expect((await commands.pasteAnnotations(annotatedDoc, 0)).kind).toBe('pasted');
    const after = await readInterchangeAnnotations(annotatedSession);
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]?.rect).toStrictEqual([32, 8, 132, 68]);
  });
});

describe('pageImageName — the file a page is exported under', () => {
  it('replaces the document’s extension, counts from 1, and spells JPEG as .jpg', () => {
    expect(pageImageName('report.pdf', 0, 'png')).toBe('report 1.png');
    expect(pageImageName('report.pdf', 2, 'jpeg')).toBe('report 3.jpg');
    // A WEBP IS NOT A PNG. The name was a ternary that called every non-JPEG a
    // PNG, so this line is the case that ternary fails.
    expect(pageImageName('report.pdf', 4, 'webp')).toBe('report 5.webp');
    // THE LAST DOT, so a dotted stem survives whole.
    expect(pageImageName('a.b.pdf', 9, 'png')).toBe('a.b 10.png');
    // A DOTFILE has no extension to replace.
    expect(pageImageName('.pdf', 0, 'png')).toBe('.pdf 1.png');
  });
});

describe('exportPageImages — one image per page, in a folder, all or nothing', () => {
  /**
   * THREE PAGES OF THREE SIZES, and that is the fixture's whole point.
   *
   * The file-level fixture's pages are identical blank Letter sheets, and against
   * it a main that rasterised page 0 into every file passed all four cases — the
   * names came from the request and every image was the same picture (mutation F,
   * 2026-09-14). A size per page makes *which page is in which file* readable
   * from each PNG's own header.
   */
  const SIZES = [
    [100, 100],
    [200, 300],
    [400, 500],
  ] as const;
  let sizedService: DocumentService;
  let sizedDoc: DocId;
  let sizedSession: MupdfSession;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    for (const size of SIZES) document.addPage([...size]);
    const bytes = await document.save();
    const path = join(directory, 'sized.pdf');
    writeFileSync(path, bytes);
    const registry = new CapabilityRegistry();
    sizedService = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await sizedService.open(registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    sizedDoc = outcome.docId;
    sizedSession = await mupdfWriter.open(bytes);
  });

  function sizedEngine(): EngineSessions {
    const held = new EngineSessions();
    held.hold(sizedDoc, { mupdf: sizedSession });
    return held;
  }

  /** A PNG's size, from its own IHDR. */
  function pngSize(path: string): readonly number[] {
    const png = readFileSync(path);
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  }

  /** The production composition, with a folder picker answering `folder`. */
  function exportingInto(
    folder: string | null,
    checkTarget: CopySource['checkTarget'] = (target) => sizedService.checkCopyTarget(target),
  ): DocumentCommands {
    return new DocumentCommands({
      ...LOCAL_READS,
      documents: sizedService,
      bus: bus(),
      engine: sizedEngine(),
      // THE REAL WRITE PATH, for the form export's reason: what this claims is
      // that files land, and an injected surface cannot say so.
      save: {
        deps: {
          checkWriteTarget: (id) => service.checkWriteTarget(id),
          surface: nodeFileSurface,
          names: siblingNames,
          wait: () => Promise.resolve(),
        },
        flush: () => Promise.reject(new Error('an image export does not flush the document')),
      },
      copy: {
        pick: () => Promise.reject(new Error('an image export picks a folder, not a file')),
        checkTarget,
      },
      directory: () => Promise.resolve(folder),
    });
  }

  it('writes the named pages as JPEGs, named by page, and nothing else', async () => {
    const folder = mkdtempSync(join(directory, 'images-'));

    const outcome = await exportingInto(folder).exportPageImages(sizedDoc, {
      pages: [0, 2],
      format: 'jpeg',
      dpi: 72,
      quality: 80,
    });

    expect(outcome).toEqual({ kind: 'split', files: 2 });
    const first = readFileSync(join(folder, 'sized 1.jpg'));
    const third = readFileSync(join(folder, 'sized 3.jpg'));
    expect([...first.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect([...third.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    // THE PAGE NOT ASKED FOR IS NOT WRITTEN, which is what separates this from
    // an export that ignored the list and wrote every page.
    expect(existsSync(join(folder, 'sized 2.jpg'))).toBe(false);
  });

  it('puts EACH page in the file named for it', async () => {
    const folder = mkdtempSync(join(directory, 'images-'));

    await exportingInto(folder).exportPageImages(sizedDoc, {
      pages: [0, 2],
      format: 'png',
      dpi: 72,
      quality: 90,
    });

    // Page 1 is 100×100 and page 3 is 400×500. A main that rasterised one page
    // for every name writes two images of the same size.
    expect(pngSize(join(folder, 'sized 1.png'))).toEqual([...SIZES[0]]);
    expect(pngSize(join(folder, 'sized 3.png'))).toEqual([...SIZES[2]]);
  });

  it('writes a PNG at the DPI asked for', async () => {
    const folder = mkdtempSync(join(directory, 'images-'));

    await exportingInto(folder).exportPageImages(sizedDoc, {
      pages: [1],
      format: 'png',
      dpi: 144,
      quality: 90,
    });

    // 200×300 points at 144 dpi is scale 2. A DPI that went nowhere answers 200×300.
    expect(pngSize(join(folder, 'sized 2.png'))).toEqual([400, 600]);
  });

  it('CONTROL: a dismissed folder picker writes nothing and reaches no page', async () => {
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      documents: sizedService,
      bus: bus(),
      engine: sizedEngine(),
      pageImage: () => Promise.reject(new Error('a dismissed picker must not rasterise')),
      directory: () => Promise.resolve(null),
    });

    expect(
      await commands.exportPageImages(sizedDoc, { pages: [0], format: 'png', dpi: 72, quality: 90 }),
    ).toBeUndefined();
  });

  it('refuses a contested name before the FIRST page is written', async () => {
    const folder = mkdtempSync(join(directory, 'images-'));
    const contested = join(folder, 'sized 2.png');

    const outcome = await exportingInto(folder, (target) =>
      Promise.resolve(
        target === contested
          ? { kind: 'contested' as const, others: [asDocId('other')] }
          : { kind: 'writable' as const },
      ),
    ).exportPageImages(sizedDoc, { pages: [0, 1], format: 'png', dpi: 72, quality: 90 });

    expect(outcome?.kind).toBe('refused');
    // PAGE 1's NAME WAS FREE and it is still not written: every name is checked
    // before anything lands, so a refusal leaves no partial export behind.
    expect(existsSync(join(folder, 'sized 1.png'))).toBe(false);
  });
});

describe('exportText — the document’s words, streamed one page at a time', () => {
  /** Two pages, each carrying words nothing else in the file has. */
  let textService: DocumentService;
  let textDoc: DocId;
  let textSession: MupdfSession;

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([300, 200]).drawText('first page words', { x: 20, y: 150, size: 12, font });
    document.addPage([300, 200]).drawText('second page words', { x: 20, y: 150, size: 12, font });
    const bytes = await document.save();
    const path = join(directory, 'words.pdf');
    writeFileSync(path, bytes);
    const registry = new CapabilityRegistry();
    textService = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await textService.open(registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    textDoc = outcome.docId;
    textSession = await mupdfWriter.open(bytes);
  });

  function textEngine(): EngineSessions {
    const held = new EngineSessions();
    held.hold(textDoc, { mupdf: textSession });
    return held;
  }

  /**
   * The production composition with the real write path, and a page-text read that
   * COUNTS its calls — which is what lets a case see the order of reads and writes.
   */
  function exportingTo(
    destination: string | null,
    options: {
      readonly checkTarget?: CopySource['checkTarget'];
      readonly surface?: typeof nodeFileSurface;
      readonly layoutText?: LayoutTextSource | null;
      readonly flush?: () => Promise<Uint8Array>;
      readonly picked?: string[];
      readonly print?: PrintDestination | null;
      readonly share?: ShareDestination | null;
      readonly images?: PageImageRequest[];
      readonly pdfa?: PdfaSource | null;
      readonly optimizer?: OptimizeSource | null;
      /** Where the copy picker answers; absent, it refuses, for an export that uses its own. */
      readonly copyTo?: string | null;
      /** A page's structure nodes in place of the real read; absent, the real read. */
      readonly structure?: (page: number) => PageStructure['nodes'];
    } = {},
  ): { readonly commands: DocumentCommands; readonly reads: number[] } {
    const reads: number[] = [];
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      documents: textService,
      bus: bus(),
      engine: textEngine(),
      print: options.print ?? null,
      share: options.share ?? null,
      pdfa: options.pdfa ?? null,
      optimizer: options.optimizer ?? null,
      ...(options.structure === undefined
        ? {}
        : {
            pageStructure: (_id: DocId, _sessions: unknown, page: number) =>
              Promise.resolve({ nodes: options.structure?.(page) ?? [], untaggedLines: 0, images: 0 }),
          }),
      pageImage: async (id, sessions, request) => {
        options.images?.push(request);
        return await LOCAL_READS.pageImage(id, sessions, request);
      },
      pageText: async (id, sessions, page) => {
        reads.push(page);
        return await LOCAL_READS.pageText(id, sessions, page);
      },
      save: {
        deps: {
          checkWriteTarget: (id) => textService.checkWriteTarget(id),
          surface: options.surface ?? nodeFileSurface,
          names: siblingNames,
          wait: () => Promise.resolve(),
        },
        flush:
          options.flush ?? (() => Promise.reject(new Error('a plain text export does not flush the document'))),
      },
      copy: {
        pick:
          options.copyTo === undefined
            ? () => Promise.reject(new Error('a text export uses its own picker'))
            : () => Promise.resolve(options.copyTo ?? null),
        checkTarget: options.checkTarget ?? ((target) => textService.checkCopyTarget(target)),
      },
      pickText: (name) => {
        options.picked?.push(name);
        return Promise.resolve(destination);
      },
      layoutText: options.layoutText ?? null,
      pickOffice: (name) => {
        options.picked?.push(name);
        return Promise.resolve(destination);
      },
    });
    return { commands, reads };
  }

  it('writes every page’s text, in order, with a form feed between pages', async () => {
    const destination = join(mkdtempSync(join(directory, 'text-')), 'words.txt');
    const { commands, reads } = exportingTo(destination);

    const outcome = await commands.exportText(textDoc, 'plain');

    const written = readFileSync(destination, 'utf8');
    expect(outcome).toEqual({ kind: 'copied', bytes: Buffer.byteLength(written, 'utf8') });
    expect(written).toBe('first page words\fsecond page words');
    expect(reads).toEqual([0, 1]);
  });

  it('STREAMS: each page reaches the file before the next page is read (ADR-0035)', async () => {
    // The decision is the ORDER of reads and writes, and the end state cannot show
    // it: an export that read every page first writes the identical file. So the
    // surface records how many pages had been read when each chunk arrived.
    const readsAtChunk: number[] = [];
    let reads: number[] = [];
    const destination = join(mkdtempSync(join(directory, 'text-')), 'words.txt');
    const built = exportingTo(destination, {
      surface: {
        ...nodeFileSurface,
        writeStream: async (path, chunks) => {
          const parts: Uint8Array[] = [];
          for await (const chunk of chunks) {
            readsAtChunk.push(reads.length);
            parts.push(chunk);
          }
          await nodeFileSurface.write(path, Buffer.concat(parts));
        },
      },
    });
    reads = built.reads;

    await built.commands.exportText(textDoc, 'plain');

    // Chunk 1 arrived after ONE read and chunk 2 after TWO. Reading everything
    // first answers [2, 2].
    expect(readsAtChunk).toEqual([1, 2]);
  });

  it('CONTROL: a dismissed picker returns nothing and reads no page', async () => {
    const { commands, reads } = exportingTo(null);

    expect(await commands.exportText(textDoc, 'plain')).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it('refuses a contested destination before reading a single page', async () => {
    const destination = join(mkdtempSync(join(directory, 'text-')), 'words.txt');
    const { commands, reads } = exportingTo(destination, {
      checkTarget: () =>
        Promise.resolve({ kind: 'contested' as const, others: [asDocId('other')] }),
    });

    expect((await commands.exportText(textDoc, 'plain'))?.kind).toBe('refused');
    // THE DECISION, not the end state: no file either way, but a refusal that came
    // after extracting the document would still have read both pages.
    expect(reads).toEqual([]);
    expect(existsSync(destination)).toBe(false);
  });

  describe('as a Word file (ADR-0072)', () => {
    it('writes a package whose document holds every page’s text, in order, read through the substrate', async () => {
      const destination = join(mkdtempSync(join(directory, 'word-')), 'words.docx');
      const { commands, reads } = exportingTo(destination);

      const outcome = await commands.exportWord(textDoc, 'text');

      expect(outcome?.kind).toBe('copied');
      const files = unzipSync(readFileSync(destination));
      const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
      // Both pages' words, the first before the second, with one page break
      // between — the same reading the plain export makes, encoded differently.
      expect(xml.indexOf('first page words')).toBeGreaterThan(0);
      expect(xml.indexOf('second page words')).toBeGreaterThan(xml.indexOf('first page words'));
      expect(xml.match(/<w:br w:type="page"\/>/gu)).toHaveLength(1);
      expect(reads).toEqual([0, 1]);
    });

    it('CONTROL: a dismissed picker returns nothing and reads no page', async () => {
      const { commands, reads } = exportingTo(null);

      expect(await commands.exportWord(textDoc, 'layout')).toBeUndefined();
      expect(reads).toEqual([]);
    });
  });

  describe('as a PowerPoint deck (ADR-0072)', () => {
    it('writes a slide per page, each picture from the page-image read for THAT page', async () => {
      const destination = join(mkdtempSync(join(directory, 'deck-')), 'deck.pptx');
      const { commands } = exportingTo(destination);

      const outcome = await commands.exportPowerPoint(textDoc);

      expect(outcome?.kind).toBe('copied');
      const files = unzipSync(readFileSync(destination));
      // The fixture's two pages rasterised by the real engine: two PNGs, and
      // different ones, since the pages carry different words.
      const first = files['ppt/media/image1.png'];
      const second = files['ppt/media/image2.png'];
      expect(first?.subarray(1, 4)).toStrictEqual(Uint8Array.of(0x50, 0x4e, 0x47));
      expect(second?.subarray(1, 4)).toStrictEqual(Uint8Array.of(0x50, 0x4e, 0x47));
      expect(Buffer.from(first ?? []).equals(Buffer.from(second ?? []))).toBe(false);
      expect(files['ppt/media/image3.png']).toBeUndefined();
    });
  });

  describe('with layout (ADR-0071)', () => {
    /** The save's flushed image, distinct from the fixture's own bytes. */
    const FLUSHED = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x32);

    it('hands the converter the SAVE’S FLUSH and writes its chunks, reading no page itself', async () => {
      const destination = join(mkdtempSync(join(directory, 'text-')), 'layout.txt');
      const given: Uint8Array[] = [];
      const { commands, reads } = exportingTo(destination, {
        flush: () => Promise.resolve(FLUSHED),
        layoutText: (pdf) => {
          given.push(pdf);
          // Each chunk crosses an await, as a file read's does.
          return Promise.resolve(
            (async function* () {
              for (const part of ['col one      col two\n', '\f']) {
                yield await Promise.resolve(new TextEncoder().encode(part));
              }
            })(),
          );
        },
      });

      const outcome = await commands.exportText(textDoc, 'layout');

      expect(outcome).toEqual({ kind: 'copied', bytes: 22 });
      expect(readFileSync(destination, 'utf8')).toBe('col one      col two\n\f');
      // What the converter read is what a save would write — not the file on disk,
      // and not MuPDF's text: the plain path's page reads never happened.
      expect(given).toEqual([FLUSHED]);
      expect(reads).toEqual([]);
    });

    it('with NO CONVERTER answers unavailable BEFORE the dialog', async () => {
      const picked: string[] = [];
      const { commands } = exportingTo('unused.txt', { layoutText: null, picked });

      expect(await commands.exportText(textDoc, 'layout')).toEqual({ kind: 'unavailable' });
      expect(picked).toEqual([]);
    });

    it('a converter that FAILED answers failed and writes no file', async () => {
      const destination = join(mkdtempSync(join(directory, 'text-')), 'layout.txt');
      const { commands } = exportingTo(destination, {
        flush: () => Promise.resolve(FLUSHED),
        layoutText: () =>
          Promise.reject(new LayoutTextFailedError({ stage: 'exit-code', code: 1, said: 'Syntax Error' })),
      });

      const outcome = await commands.exportText(textDoc, 'layout');

      expect(outcome?.kind).toBe('failed');
      expect(existsSync(destination)).toBe(false);
    });

    it('CONTROL: a contested destination never runs the converter', async () => {
      const destination = join(mkdtempSync(join(directory, 'text-')), 'layout.txt');
      let ran = 0;
      const { commands } = exportingTo(destination, {
        checkTarget: () => Promise.resolve({ kind: 'contested' as const, others: [asDocId('other')] }),
        flush: () => Promise.resolve(FLUSHED),
        layoutText: () => {
          ran += 1;
          return Promise.reject(new Error('the converter ran for a contested destination'));
        },
      });

      expect((await commands.exportText(textDoc, 'layout'))?.kind).toBe('refused');
      expect(ran).toBe(0);
    });
  });

  describe('as PDF/A-2b (ADR-0075)', () => {
    /** The save's flushed image, distinct from the fixture's own bytes, so the case sees which bytes reached the converter. */
    const FLUSHED = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37);

    function converter(answer: 'converted' | 'failed'): { readonly source: PdfaSource; readonly given: Uint8Array[] } {
      const given: Uint8Array[] = [];
      return {
        given,
        source: (pdf) => {
          given.push(pdf);
          if (answer === 'failed') return Promise.reject(new PdfaFailedError({ stage: 'reverted', said: 'reverting to normal PDF output' }));
          return Promise.resolve({
            removed: ['not permitted in PDF/A, annotation will not be present in output file'],
            output: (async function* () {
              yield await Promise.resolve(new TextEncoder().encode('%PDF-1.7 as PDF/A'));
            })(),
          });
        },
      };
    }

    it('hands the converter the SAVE’S FLUSH, writes what it produced, and answers what it removed', async () => {
      const destination = join(mkdtempSync(join(directory, 'pdfa-')), 'archive.pdf');
      const { source, given } = converter('converted');
      const { commands, reads } = exportingTo(null, { pdfa: source, flush: () => Promise.resolve(FLUSHED), copyTo: destination });

      const outcome = await commands.exportPdfa(textDoc);

      expect(outcome).toStrictEqual({
        kind: 'copied',
        bytes: 17,
        removed: ['not permitted in PDF/A, annotation will not be present in output file'],
        // THE REAL STRUCTURE READ on this untagged fixture: nothing to lose, nothing said.
        tagsDropped: false,
      });
      expect(readFileSync(destination, 'latin1')).toBe('%PDF-1.7 as PDF/A');
      expect(given).toStrictEqual([FLUSHED]);
      expect(reads).toStrictEqual([]);
    });

    it('says the TAGS were dropped when any page carries structure, which Ghostscript never prints', async () => {
      const destination = join(mkdtempSync(join(directory, 'pdfa-')), 'tagged.pdf');
      const { source } = converter('converted');
      const asked: number[] = [];
      const { commands } = exportingTo(null, {
        pdfa: source,
        flush: () => Promise.resolve(FLUSHED),
        copyTo: destination,
        // PAGE 2 TAGGED, page 1 not: a check of the first page alone is red here.
        structure: (page) => {
          asked.push(page);
          return page === 1 ? [{ role: 'P', raw: 'P', depth: 0, lines: 1 }] : [];
        },
      });

      const outcome = await commands.exportPdfa(textDoc);

      expect(outcome?.kind === 'copied' && outcome.tagsDropped).toBe(true);
      expect(asked).toStrictEqual([0, 1]);
    });

    it('answers FAILED and writes no file when the conversion produced no PDF/A', async () => {
      const destination = join(mkdtempSync(join(directory, 'pdfa-')), 'archive.pdf');
      const { source } = converter('failed');
      const { commands } = exportingTo(null, { pdfa: source, flush: () => Promise.resolve(FLUSHED), copyTo: destination });

      expect(await commands.exportPdfa(textDoc)).toStrictEqual({ kind: 'failed' });
      expect(existsSync(destination)).toBe(false);
    });

    it('CONTROL: answers UNAVAILABLE before any dialog where no converter is provisioned', async () => {
      const { commands } = exportingTo(null, { pdfa: null });
      expect(await commands.exportPdfa(textDoc)).toStrictEqual({ kind: 'unavailable' });
    });
  });

  describe('a smaller copy (ADR-0087)', () => {
    const FLUSHED = new Uint8Array(1000).fill(0x25);
    const COPY = '%PDF-1.7 smaller';

    /** A rewriter answering `bytes`, recording what it was given and every discard. */
    function rewriter(answer: 'optimized' | 'unreadable' | 'unavailable', bytes = COPY.length) {
      const given: { pdf: Uint8Array; setting: string }[] = [];
      let discards = 0;
      const source: OptimizeSource = (pdf, setting) => {
        given.push({ pdf, setting });
        if (answer !== 'optimized') return Promise.resolve({ kind: answer });
        return Promise.resolve({
          kind: 'optimized',
          bytes,
          output: (async function* () {
            yield await Promise.resolve(new TextEncoder().encode(COPY));
          })(),
          discard: () => {
            discards += 1;
            return Promise.resolve();
          },
        });
      };
      return { source, given, discards: () => discards };
    }

    const versionOf = async (commands: DocumentCommands): Promise<DocVersion> =>
      (await commands.pageTables(textDoc, 0)).version;

    it('MEASURES the save’s flush at the setting asked, answers both sizes and the version, and keeps nothing', async () => {
      const { source, given, discards } = rewriter('optimized', 600);
      const { commands } = exportingTo(null, { optimizer: source, flush: () => Promise.resolve(FLUSHED) });

      const measured = await commands.optimizeMeasure(textDoc, 'medium');

      expect(measured).toStrictEqual({ kind: 'measured', version: await versionOf(commands), before: 1000, after: 600 });
      expect(given).toStrictEqual([{ pdf: FLUSHED, setting: 'medium' }]);
      expect(discards()).toBe(1);
    });

    it('WRITES the copy when it is smaller, at the version measured, and discards it after', async () => {
      const destination = join(mkdtempSync(join(directory, 'optimize-')), 'smaller.pdf');
      const { source, discards } = rewriter('optimized');
      const { commands } = exportingTo(null, { optimizer: source, flush: () => Promise.resolve(FLUSHED), copyTo: destination });

      const outcome = await commands.optimize(textDoc, 'high', await versionOf(commands));

      expect(outcome).toStrictEqual({ kind: 'copied', bytes: COPY.length, before: 1000 });
      expect(readFileSync(destination, 'latin1')).toBe(COPY);
      expect(discards()).toBe(1);
    });

    it('writes NOTHING for a copy that is not smaller, answering both sizes', async () => {
      const destination = join(mkdtempSync(join(directory, 'optimize-')), 'larger.pdf');
      const { source, discards } = rewriter('optimized', 1000);
      const { commands } = exportingTo(null, { optimizer: source, flush: () => Promise.resolve(FLUSHED), copyTo: destination });

      expect(await commands.optimize(textDoc, 'high', await versionOf(commands))).toStrictEqual({
        kind: 'not-smaller',
        before: 1000,
        after: 1000,
      });
      expect(existsSync(destination)).toBe(false);
      expect(discards()).toBe(1);
    });

    it('answers CHANGED before any picker, rewriting nothing, for a version the document is not at', async () => {
      const { source, given } = rewriter('optimized');
      // NO `copyTo`: the picker REFUSES, so reaching it fails this case rather than passing it.
      const { commands } = exportingTo(null, { optimizer: source, flush: () => Promise.resolve(FLUSHED) });

      const moved = asDocVersion(Number(await versionOf(commands)) + 1);
      expect(await commands.optimize(textDoc, 'high', moved)).toStrictEqual({ kind: 'changed' });
      expect(given).toStrictEqual([]);
    });

    it('discards the copy when the destination is CONTESTED, which answers before the stream opens', async () => {
      const destination = join(mkdtempSync(join(directory, 'optimize-')), 'held.pdf');
      const { source, discards } = rewriter('optimized');
      const { commands } = exportingTo(null, {
        optimizer: source,
        flush: () => Promise.resolve(FLUSHED),
        copyTo: destination,
        checkTarget: () => Promise.resolve({ kind: 'contested', others: [asDocId('other')] }),
      });

      expect((await commands.optimize(textDoc, 'high', await versionOf(commands)))?.kind).toBe('refused');
      expect(discards()).toBe(1);
    });

    it('passes on the HOST’S unreadable and unavailable, and answers unavailable itself with no host', async () => {
      for (const answer of ['unreadable', 'unavailable'] as const) {
        const { commands } = exportingTo(null, { optimizer: rewriter(answer).source, flush: () => Promise.resolve(FLUSHED) });
        expect(await commands.optimizeMeasure(textDoc, 'low')).toStrictEqual({ kind: answer });
      }
      const { commands } = exportingTo(null, { optimizer: null });
      expect(await commands.optimizeMeasure(textDoc, 'low')).toStrictEqual({ kind: 'unavailable' });
    });
  });

  describe('printed (ADR-0074)', () => {
    /** A print destination that records what reached it, answering `pages` for the dialog. */
    function recordingPrinter(
      pages: readonly number[] | null,
      refuse: { readonly start?: boolean; readonly page?: boolean } = {},
    ): { readonly destination: PrintDestination; readonly log: string[]; readonly drawn: Uint8Array[] } {
      const log: string[] = [];
      const drawn: Uint8Array[] = [];
      return {
        log,
        drawn,
        destination: {
          choose: (pageCount) => {
            log.push(`dialog for ${String(pageCount)} page(s)`);
            if (pages === null) return null;
            return {
              pages,
              start: (name) => {
                log.push(`start ${name}`);
                if (refuse.start === true) throw new PrintFailedError('the document', 0);
                return {
                  page: (png) => {
                    if (refuse.page === true) throw new PrintFailedError('a page', 0);
                    drawn.push(png);
                    log.push('page');
                  },
                  finish: () => log.push('finish'),
                  abort: () => log.push('abort'),
                };
              },
              release: () => log.push('release'),
            };
          },
        },
      };
    }

    it('rasterises EACH page the dialog chose, in its order, at the DPI asked, and finishes the document', async () => {
      const printer = recordingPrinter([1, 0]);
      const images: PageImageRequest[] = [];
      const { commands } = exportingTo(null, { print: printer.destination, images });

      expect(await commands.print(textDoc, 150)).toStrictEqual({ kind: 'printed', pages: 2 });

      expect(printer.log).toStrictEqual(['dialog for 2 page(s)', 'start words.pdf', 'page', 'page', 'finish', 'release']);
      expect(images).toStrictEqual([
        { page: 1, format: 'png', scale: 150 / 72, quality: 90 },
        { page: 0, format: 'png', scale: 150 / 72, quality: 90 },
      ]);
      // TWO DIFFERENT PICTURES, the second page's first: the pages carry different
      // words, so a print that sent one page twice is red here.
      expect(Buffer.from(printer.drawn[0] ?? []).equals(Buffer.from(printer.drawn[1] ?? []))).toBe(false);
    });

    it('prints nothing and reads no page when the dialog is dismissed', async () => {
      const printer = recordingPrinter(null);
      const images: PageImageRequest[] = [];
      const { commands } = exportingTo(null, { print: printer.destination, images });

      expect(await commands.print(textDoc, 300)).toBeUndefined();
      expect(printer.log).toStrictEqual(['dialog for 2 page(s)']);
      expect(images).toStrictEqual([]);
    });

    it('ABANDONS the document when the printer refuses a page, and releases the printer', async () => {
      const printer = recordingPrinter([0, 1], { page: true });
      const { commands } = exportingTo(null, { print: printer.destination });

      expect(await commands.print(textDoc, 300)).toStrictEqual({ kind: 'failed' });
      expect(printer.log).toStrictEqual(['dialog for 2 page(s)', 'start words.pdf', 'abort', 'release']);
    });

    it('answers FAILED and releases the printer when the document cannot be started', async () => {
      const printer = recordingPrinter([0], { start: true });
      const { commands } = exportingTo(null, { print: printer.destination });

      expect(await commands.print(textDoc, 300)).toStrictEqual({ kind: 'failed' });
      expect(printer.log).toStrictEqual(['dialog for 2 page(s)', 'start words.pdf', 'release']);
    });

    it('CONTROL: answers UNAVAILABLE with no print dialog on the platform, reading nothing', async () => {
      const images: PageImageRequest[] = [];
      const { commands } = exportingTo(null, { print: null, images });

      expect(await commands.print(textDoc, 300)).toStrictEqual({ kind: 'unavailable' });
      expect(images).toStrictEqual([]);
    });
  });

  describe('emailed (ADR-0080)', () => {
    /** The save's flush, recognisable: a document whose bytes are exactly these. */
    const FLUSHED = new TextEncoder().encode('%PDF-1.7 the flush\n%%EOF\n');

    function recordingSheet(refuse = false): { readonly destination: ShareDestination; readonly offers: ShareOffer[] } {
      const offers: ShareOffer[] = [];
      return {
        offers,
        destination: {
          offer: (offer) => {
            offers.push(offer);
            return refuse ? Promise.reject(new ShareFailedError('the share sheet', 0x80004005)) : Promise.resolve();
          },
        },
      };
    }

    it('offers the SAVE’S FLUSH, named as the document is, with its name as the title', async () => {
      const sheet = recordingSheet();
      const { commands } = exportingTo(null, { share: sheet.destination, flush: () => Promise.resolve(FLUSHED) });

      expect(await commands.email(textDoc)).toStrictEqual({ kind: 'offered' });
      expect(sheet.offers).toStrictEqual([{ fileName: 'words.pdf', title: 'words', bytes: FLUSHED }]);
    });

    it('answers FAILED when a step before the sheet refuses', async () => {
      const sheet = recordingSheet(true);
      const { commands } = exportingTo(null, { share: sheet.destination, flush: () => Promise.resolve(FLUSHED) });

      expect(await commands.email(textDoc)).toStrictEqual({ kind: 'failed' });
      expect(sheet.offers).toHaveLength(1);
    });

    it('CONTROL: answers UNAVAILABLE with no sheet on the platform, and takes no bytes', async () => {
      let flushed = 0;
      const { commands } = exportingTo(null, {
        share: null,
        flush: () => {
          flushed += 1;
          return Promise.resolve(FLUSHED);
        },
      });

      expect(await commands.email(textDoc)).toStrictEqual({ kind: 'unavailable' });
      expect(flushed).toBe(0);
    });
  });
});

describe('exportExcel — the tables MuPDF finds, as a workbook (ADR-0073)', () => {
  const registry = new CapabilityRegistry();
  const service = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
  /** Page 1 prose, pages 2 and 3 each a ruled three-column table. */
  let tablesDoc: DocId;
  /** Page 1 a picture and no text, page 2 blank. */
  let pictureDoc: DocId;
  const held = new EngineSessions();

  async function opened(bytes: Uint8Array, name: string): Promise<DocId> {
    const path = join(directory, name);
    writeFileSync(path, bytes);
    const outcome = await service.open(registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    held.hold(outcome.docId, { mupdf: await mupdfWriter.open(bytes) });
    return outcome.docId;
  }

  beforeAll(async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([612, 792]).drawText('a paragraph and no table', { x: 72, y: 700, size: 12, font });
    for (const rows of [
      [['Item', 'Qty', 'Price'], ['Bolt', '12', '0.45']],
      [['Name', 'Share', 'Note'], ['North', '12.5%', 'first']],
    ]) {
      const drawn = document.addPage([612, 792]);
      rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          const x = 72 + c * 120;
          const y = 700 - r * 24;
          drawn.drawRectangle({ x, y: y - 6, width: 120, height: 24, borderColor: rgb(0, 0, 0), borderWidth: 1 });
          drawn.drawText(cell, { x: x + 6, y, size: 11, font });
        });
      });
    }
    tablesDoc = await opened(await document.save(), 'tables.pdf');

    // A JPEG's start-of-frame alone, which pdf-lib embeds and MuPDF reports as an
    // image block — measured 2026-09-17 against a blank page, which reports none.
    const pictures = await PDFDocument.create();
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 40, 0, 40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9);
    pictures.addPage([300, 300]).drawImage(await pictures.embedJpg(jpeg), { x: 0, y: 0, width: 300, height: 300 });
    pictures.addPage([300, 300]);
    pictureDoc = await opened(await pictures.save(), 'pictures.pdf');
  });

  function exportingTo(
    destination: string | null,
    networkTables: NetworkTableReader = LOCAL_READS.networkTables,
  ): {
    readonly commands: DocumentCommands;
    readonly picked: string[];
  } {
    const picked: string[] = [];
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      networkTables,
      documents: service,
      bus: bus(),
      engine: held,
      save: {
        deps: {
          checkWriteTarget: (id) => service.checkWriteTarget(id),
          surface: nodeFileSurface,
          names: siblingNames,
          wait: () => Promise.resolve(),
        },
        flush: () => Promise.reject(new Error('an Excel export does not flush the document')),
      },
      copy: {
        pick: () => Promise.reject(new Error('an Excel export uses its own picker')),
        checkTarget: (target) => service.checkCopyTarget(target),
      },
      pickOffice: (name, format) => {
        picked.push(`${name}:${format}`);
        return Promise.resolve(destination);
      },
    });
    return { commands, picked };
  }

  /** Each sheet's name and the inline strings on it, read back out of the zip. */
  function sheetsOf(path: string): { readonly name: string; readonly strings: readonly string[] }[] {
    const files = unzipSync(readFileSync(path));
    const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
    return [...workbook.matchAll(/<sheet name="([^"]*)"/gu)].map((match, index) => ({
      name: match[1] ?? '',
      strings: [
        ...strFromU8(files[`xl/worksheets/sheet${String(index + 1)}.xml`] ?? new Uint8Array()).matchAll(
          /<t xml:space="preserve">([^<]*)<\/t>/gu,
        ),
      ].map((cell) => cell[1] ?? ''),
    }));
  }

  it('writes a sheet for EACH page with a table, holding every column of it', async () => {
    const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'tables.xlsx');
    const { commands, picked } = exportingTo(destination);

    const outcome = await commands.exportExcel(tablesDoc, 'sheet-per-page', await unreviewed(commands, tablesDoc));

    expect(outcome?.kind).toBe('copied');
    expect(picked).toStrictEqual(['tables.pdf:xlsx']);
    // THE THIRD COLUMN is the separating assertion: the table-hunt flag without
    // `vectors` returns this grid two columns wide, and `Price` and `Note` outside it.
    expect(sheetsOf(destination)).toStrictEqual([
      { name: '2', strings: ['Item', 'Qty', 'Price', 'Bolt'] },
      { name: '3', strings: ['Name', 'Share', 'Note', 'North', 'first'] },
    ]);
  });

  it('writes every table on ONE sheet when asked, named by the pages it spans', async () => {
    const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'combined.xlsx');
    const { commands } = exportingTo(destination);

    expect((await commands.exportExcel(tablesDoc, 'one-sheet', await unreviewed(commands, tablesDoc)))?.kind).toBe(
      'copied',
    );
    expect(sheetsOf(destination)).toStrictEqual([
      { name: '2-3', strings: ['Item', 'Qty', 'Price', 'Bolt', 'Name', 'Share', 'Note', 'North', 'first'] },
    ]);
  });

  it('answers NO TABLES before any picker, counting the picture page and not the blank one', async () => {
    const { commands, picked } = exportingTo(null);

    expect(await commands.exportExcel(pictureDoc, 'sheet-per-page', await unreviewed(commands, pictureDoc))).toStrictEqual({
      kind: 'no-tables',
      picturePages: 1,
    });
    expect(picked).toStrictEqual([]);
  });

  /** No edits, at the version the review grid's first read answers — the export a person makes without correcting anything. */
  async function unreviewed(commands: DocumentCommands, doc: DocId): Promise<ExcelReview> {
    return { version: (await commands.pageTables(doc, 0)).version, edits: [] };
  }

  it('the review grid reads a page’s cells, and an EDIT replaces that cell’s text in the workbook', async () => {
    const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'edited.xlsx');
    const { commands } = exportingTo(destination);

    const grid = await commands.pageTables(tablesDoc, 1);
    expect(grid.pageCount).toBe(3);
    expect(grid.tables.map((table) => table.rows.map((row) => row.map((cell) => cell.text)))).toStrictEqual([
      [
        ['Item', 'Qty', 'Price'],
        ['Bolt', '12', '0.45'],
      ],
    ]);

    const outcome = await commands.exportExcel(tablesDoc, 'sheet-per-page', {
      version: grid.version,
      edits: [{ page: 1, table: 0, row: 1, column: 0, text: 'Hex bolt' }],
    });

    expect(outcome?.kind).toBe('copied');
    // THE EDITED CELL AND NO OTHER: page 3's first data cell, at the same table,
    // row and column on another page, is unchanged — so an edit applied by address
    // alone, ignoring its page, is red here.
    expect(sheetsOf(destination)).toStrictEqual([
      { name: '2', strings: ['Item', 'Qty', 'Price', 'Hex bolt'] },
      { name: '3', strings: ['Name', 'Share', 'Note', 'North', 'first'] },
    ]);
  });

  it('answers CHANGED before any picker for an edit naming a cell the page does not have', async () => {
    const { commands, picked } = exportingTo(null);
    const { version } = await commands.pageTables(tablesDoc, 1);

    expect(
      await commands.exportExcel(tablesDoc, 'sheet-per-page', {
        version,
        edits: [{ page: 1, table: 0, row: 1, column: 3, text: 'no such cell' }],
      }),
    ).toStrictEqual({ kind: 'changed' });
    expect(picked).toStrictEqual([]);
  });

  it('answers CHANGED before any picker for a review made at another version', async () => {
    const { commands, picked } = exportingTo(null);
    const { version } = await commands.pageTables(tablesDoc, 1);

    expect(
      await commands.exportExcel(tablesDoc, 'sheet-per-page', {
        version: asDocVersion(Number(version) + 1),
        edits: [],
      }),
    ).toStrictEqual({ kind: 'changed' });
    expect(picked).toStrictEqual([]);
  });

  describe('through a SERVICE (ADR-0086) — each page read as the workbook streams', () => {
    /** A header cell spanning both columns, over a row of two: the merge is the separating shape. */
    const SPANNED: RecognisedTable = {
      kind: 'recognised',
      rows: 2,
      columns: 2,
      cells: [
        { row: 0, column: 0, rowSpan: 1, columnSpan: 2, text: 'Totals' },
        { row: 1, column: 0, rowSpan: 1, columnSpan: 1, text: 'North' },
        { row: 1, column: 1, rowSpan: 1, columnSpan: 1, text: '12' },
      ],
    };

    it('asks the service for EVERY page, in order, and writes its span as a merge', async () => {
      const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'service.xlsx');
      const asked: string[] = [];
      const { commands, picked } = exportingTo(destination, (_doc, _sessions, page, engine) => {
        asked.push(`${engine}:${String(page)}`);
        return Promise.resolve(page === 1 ? [SPANNED] : []);
      });

      const outcome = await commands.exportExcel(tablesDoc, 'sheet-per-page', await unreviewed(commands, tablesDoc), 'azure');

      expect(outcome?.kind).toBe('copied');
      expect(picked).toStrictEqual(['tables.pdf:xlsx']);
      expect(asked).toStrictEqual(['azure:0', 'azure:1', 'azure:2']);
      // THE SERVICE'S TABLE, NOT MUPDF'S: page 2's ruled grid would put `Item` here.
      // `12` is a NUMBER cell, as MuPDF's `12` is above, so it is not among the inline strings.
      expect(sheetsOf(destination)).toStrictEqual([{ name: '2', strings: ['Totals', 'North'] }]);
      const sheet = strFromU8(unzipSync(readFileSync(destination))['xl/worksheets/sheet1.xml'] ?? new Uint8Array());
      expect(sheet).toContain('<v>12</v>');
      expect(sheet).toContain('<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>');
    });

    it('stops at the FIRST page the service refuses, names it, sends nothing after, and writes nothing', async () => {
      const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'refused.xlsx');
      const asked: number[] = [];
      const { commands } = exportingTo(destination, (_doc, _sessions, page) => {
        asked.push(page);
        return page === 1
          ? Promise.reject(new AzureRecognitionRefused('rejected', 'Azure answered 400: the page was refused'))
          : Promise.resolve([SPANNED]);
      });

      expect(
        await commands.exportExcel(tablesDoc, 'one-sheet', await unreviewed(commands, tablesDoc), 'azure'),
      ).toStrictEqual({
        kind: 'service-refused',
        engine: 'azure',
        page: 1,
        reason: 'rejected',
        detail: 'Azure answered 400: the page was refused',
      });
      expect(asked).toStrictEqual([0, 1]);
      expect(existsSync(destination)).toBe(false);
    });

    it('answers NO TABLES, writing nothing, when the service finds none on any page', async () => {
      const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'none.xlsx');
      const { commands } = exportingTo(destination, () => Promise.resolve([]));

      expect(
        await commands.exportExcel(tablesDoc, 'sheet-per-page', await unreviewed(commands, tablesDoc), 'claude'),
      ).toStrictEqual({ kind: 'no-tables', picturePages: 0 });
      expect(existsSync(destination)).toBe(false);
    });

    it('CONTROL: a thrown value that is no service refusal is a DEFECT, and is not dressed as one', async () => {
      const destination = join(mkdtempSync(join(directory, 'xlsx-')), 'defect.xlsx');
      const { commands } = exportingTo(destination, () => Promise.reject(new TypeError('a bug in this build')));

      await expect(
        commands.exportExcel(tablesDoc, 'sheet-per-page', await unreviewed(commands, tablesDoc), 'claude'),
      ).rejects.toThrow('a bug in this build');
      expect(existsSync(destination)).toBe(false);
    });

    it('answers CHANGED before any picker, sending nothing, for a review at another version', async () => {
      const asked: number[] = [];
      const { commands, picked } = exportingTo(null, (_doc, _sessions, page) => {
        asked.push(page);
        return Promise.resolve([]);
      });
      const { version } = await commands.pageTables(tablesDoc, 0);

      expect(
        await commands.exportExcel(tablesDoc, 'sheet-per-page', { version: asDocVersion(Number(version) + 1), edits: [] }, 'azure'),
      ).toStrictEqual({ kind: 'changed' });
      expect(picked).toStrictEqual([]);
      expect(asked).toStrictEqual([]);
    });
  });
});

describe('suggestedTextName — the name a text export is offered under', () => {
  it('replaces the extension with .txt, and leaves a dotfile whole', () => {
    expect(suggestedTextName('report.pdf')).toBe('report.txt');
    expect(suggestedTextName('a.b.pdf')).toBe('a.b.txt');
    expect(suggestedTextName('.pdf')).toBe('.pdf.txt');
  });
});

describe('DocuSign — main flushes, the session sends, and a refusal is named', () => {
  beforeAll(openDocument);

  /** The flushed image a send must carry, distinct from any fixture's own bytes. */
  const FLUSHED = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);

  /** A save source whose flush answers {@link FLUSHED} and refuses everything else. */
  const flushing: SaveSource = { ...noSaving, flush: () => Promise.resolve(FLUSHED) };

  /** A copy source that records whether its picker was opened, and cancels. */
  function recordingCopy(): { readonly source: CopySource; readonly picked: string[] } {
    const picked: string[] = [];
    return {
      picked,
      source: {
        pick: (suggested) => {
          picked.push(suggested);
          return Promise.resolve(null);
        },
        checkTarget: () => Promise.reject(new Error('a cancelled picker checks no target')),
      },
    };
  }

  /** A session that answers `retrieve` with `answer` and `send` with `send`. */
  function session(parts: {
    readonly send?: DocusignSession['send'];
    readonly retrieve?: DocusignSession['retrieve'];
  }): DocusignSession {
    return {
      send: parts.send ?? (() => Promise.reject(new Error('this case does not send'))),
      retrieve: parts.retrieve ?? (() => Promise.reject(new Error('this case does not retrieve'))),
      hasSent: () => false,
    };
  }

  it('send hands the session the FLUSHED image, the document’s name and the dialog’s words', async () => {
    const received: unknown[] = [];
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      save: flushing,
      docusign: session({
        send: (request) => {
          received.push(request);
          return Promise.resolve('envelope-1');
        },
      }),
    });
    const signers = [{ name: 'Grace Hopper', email: 'grace@example.com' }];

    expect(
      await commands.docusignSend(docId, { emailSubject: 'Please sign', signers }),
    ).toStrictEqual({ kind: 'sent', envelopeId: 'envelope-1' });
    expect(received).toStrictEqual([
      {
        docId,
        pdf: FLUSHED,
        documentName: service.nameOf(docId),
        emailSubject: 'Please sign',
        signers,
      },
    ]);
  });

  it('a refusal the session NAMES is answered by kind, and CONTROL: an unnamed failure is thrown', async () => {
    // THE CONTROL IS THE SECOND HALF: a command that mapped every failure to a
    // refusal would pass the first and hide a defect as a person's situation.
    const named = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      save: flushing,
      docusign: session({ send: () => Promise.reject(new DocusignOutcomeRefused('sign-in-denied')) }),
    });
    const unnamed = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      save: flushing,
      docusign: session({ send: () => Promise.reject(new Error('a defect, not a refusal')) }),
    });
    const request = { emailSubject: 'Please sign', signers: [{ name: 'A', email: 'a@example.com' }] };

    expect(await named.docusignSend(docId, request)).toStrictEqual({ kind: 'sign-in-denied' });
    await expect(unnamed.docusignSend(docId, request)).rejects.toThrow('a defect, not a refusal');
  });

  it('retrieve answers an unfinished envelope BEFORE any picker opens', async () => {
    // THE DECISION IS THE ASSERTION: the picker was never asked. The outcome
    // alone would also be the answer of a build that asked where to save first.
    const copy = recordingCopy();
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      copy: copy.source,
      docusign: session({
        retrieve: () => Promise.resolve({ kind: 'not-completed', status: 'delivered' }),
      }),
    });

    expect(await commands.docusignRetrieve(docId)).toStrictEqual({
      kind: 'not-completed',
      status: 'delivered',
    });
    expect(copy.picked).toStrictEqual([]);
  });

  it('CONTROL: a completed envelope does open the picker, and a cancel writes nothing', async () => {
    const copy = recordingCopy();
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      copy: copy.source,
      docusign: session({
        retrieve: () => Promise.resolve({ kind: 'completed', bytes: FLUSHED }),
      }),
    });

    expect(await commands.docusignRetrieve(docId)).toBeUndefined();
    expect(copy.picked).toHaveLength(1);
  });

  it('a retrieve refusal is answered by kind', async () => {
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      docusign: session({ retrieve: () => Promise.reject(new DocusignOutcomeRefused('unreachable')) }),
    });

    expect(await commands.docusignRetrieve(docId)).toStrictEqual({ kind: 'unreachable' });
  });
});

describe('sign — a visible signature', () => {
  beforeAll(openDocument);

  /** A certificate source that records every time it is asked anything. */
  function recordingCertificate(): {
    readonly source: CertificateSource;
    readonly asked: string[];
  } {
    const asked: string[] = [];
    return {
      asked,
      source: {
        pick: () => {
          asked.push('pick');
          return Promise.resolve('certificate.p12');
        },
        read: () => {
          asked.push('read');
          return Promise.resolve({ kind: 'read' as const, bytes: Uint8Array.of(1) });
        },
      },
    };
  }

  /**
   * A signer that refuses with the error it is given.
   *
   * The refusal is the subject: what these cases assert is how MAIN names a
   * failure, and `documentSign.test.ts` is where the real appearance refuses.
   */
  function refusingSigner(error: Error): RegisteredWriter<'signpdf'> {
    return {
      serialise: (session) => Promise.resolve(session),
      apply: () => Promise.reject(error),
      capture: () =>
        Promise.resolve({ captured: false as const, reason: 'the refusing signer records nothing' }),
      invert: () => Promise.reject(new Error('a refused signature is never inverted')),
    };
  }

  const placement = { page: 0, rect: { x0: 10, y0: 10, x1: 110, y1: 60 } };

  it('asks for the PICTURE first, and an unreadable one never asks for a credential', async () => {
    // THE DECISION IS THE ASSERTION — that the certificate picker was never
    // opened — and not the outcome alone: `image-unreadable` would also be the
    // answer of a build that asked for the certificate first and then failed on
    // the picture, having had somebody type a password for nothing.
    const certificate = recordingCertificate();
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      image: {
        pick: () => Promise.resolve('signature.gif'),
        read: () => Promise.reject(new Error('an extension with no decoder must not be read')),
      },
      certificate: certificate.source,
    });

    expect(
      await commands.sign(docId, {
        passphrase: '',
        appearance: { ...placement, mark: { kind: 'image' } },
      }),
    ).toStrictEqual({ kind: 'image-unreadable' });
    expect(certificate.asked).toStrictEqual([]);
  });

  it('a CANCELLED picture asks for no credential either', async () => {
    const certificate = recordingCertificate();
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      image: {
        pick: () => Promise.resolve(null),
        read: () => Promise.reject(new Error('a cancelled picker must not read')),
      },
      certificate: certificate.source,
    });

    expect(
      await commands.sign(docId, {
        passphrase: '',
        appearance: { ...placement, mark: { kind: 'image' } },
      }),
    ).toStrictEqual({ kind: 'cancelled' });
    expect(certificate.asked).toStrictEqual([]);
  });

  it('CONTROL: a typed look opens no picture picker and goes straight to the certificate', async () => {
    // `noImages` REJECTS, so reaching it fails this case — which is what
    // separates *the picture comes first* from *a picture is always asked for*.
    const certificate = recordingCertificate();
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      certificate: {
        ...certificate.source,
        pick: () => {
          certificate.asked.push('pick');
          return Promise.resolve(null);
        },
      },
    });

    expect(
      await commands.sign(docId, {
        passphrase: '',
        appearance: {
          ...placement,
          mark: { kind: 'typed', text: 'Grace Hopper', font: 'courier' },
        },
      }),
    ).toStrictEqual({ kind: 'cancelled' });
    expect(certificate.asked).toStrictEqual(['pick']);
  });

  it('names each refusal by its CLASS, and CONTROL: an unnamed failure is not called a wrong password', async () => {
    // THE FIXTURE REACHES THE SIGNER, which the first draft of this case did
    // not: a byte-image command's bytes come from the save source's `flush`,
    // `INERT`'s refuses, and that refusal arrived at the catch and was answered
    // `wrong-passphrase` — for all three inputs, so the control passed by the
    // same route as the defect. The flush below serialises the held session,
    // exactly as the save cases' real one does.
    const signing = (error: Error): Promise<unknown> => {
      const commands = new DocumentCommands({
        ...INERT,
        documents: service,
        bus: new CommandBus({ mupdf: localMupdfWriter, signpdf: refusingSigner(error) }),
        engine: engine(),
        certificate: recordingCertificate().source,
        save: {
          ...noSaving,
          flush: (_docId, sessions) => {
            const held = sessions.mupdf;
            if (held === undefined) throw new Error('the fixture holds a session');
            return mupdfWriter.serialise(held);
          },
        },
      });
      return commands.sign(docId, {
        passphrase: '',
        appearance: {
          ...placement,
          mark: { kind: 'typed', text: 'Grace Hopper', font: 'courier' },
        },
      });
    };

    expect(
      await signing(new SignatureAppearanceRefusedError('unencodable-text', 'refused by the case')),
    ).toStrictEqual({ kind: 'unencodable-text' });
    expect(
      await signing(new SignatureAppearanceRefusedError('unreadable-image', 'refused by the case')),
    ).toStrictEqual({ kind: 'image-unreadable' });
    expect(await signing(new SignatureCredentialRefusedError())).toStrictEqual({
      kind: 'wrong-passphrase',
    });
    // TOO LARGE IS NOT A WRONG PASSWORD, which is what this catch's predecessor
    // would have said for it: `@signpdf` refuses an oversized signature with the
    // same error type as its other input refusals.
    expect(await signing(new SignatureTooLargeError(40_000, 32_768))).toStrictEqual({
      kind: 'signature-too-large',
    });
    // THE AUTHORITY'S THREE FAILURES, three answers — and the refused/unverifiable
    // pair is split by the error's REASON, so a mapping that read only the class
    // would answer one of them for both and fail here.
    expect(await signing(new TimestampUnreachableError())).toStrictEqual({
      kind: 'timestamp-unreachable',
    });
    expect(await signing(new TimestampRefusedError('refused', 'refused by the case'))).toStrictEqual({
      kind: 'timestamp-refused',
    });
    expect(
      await signing(new TimestampRefusedError('unverifiable', 'refused by the case')),
    ).toStrictEqual({ kind: 'timestamp-unverifiable' });
    // THE CONTROL, and it is the one the old catch fails: a failure nobody named
    // is not a person's mistake, so it propagates to the handler — which turns
    // it into `internal` — instead of telling them their password was wrong.
    await expect(signing(new Error('an install that failed'))).rejects.toThrow(
      'an install that failed',
    );
  });
});

describe('composeMarkdownFile: what an import answers before anything is written', () => {
  beforeAll(openDocument);

  /** A source that records what was asked of it, answering from what the case gives. */
  function markdownFrom(
    picked: string | null,
    read: Awaited<ReturnType<ImportSource['read']>>,
  ): { readonly source: ImportSource; readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      source: {
        pick: () => {
          calls.push('pick');
          return Promise.resolve(picked);
        },
        read: (path) => {
          calls.push(`read:${path}`);
          return Promise.resolve(read);
        },
      },
    };
  }

  const TEXT = { kind: 'read' as const, bytes: new TextEncoder().encode('# Title\n') };

  it('REFUSES BEFORE THE PICKER where no compose host can exist', async () => {
    // THE DECISION IS THE CALL NOT MADE: an answer of `engine-unavailable` after a
    // picker would read the same at the boundary, and would have asked a person to
    // choose a file for an import that could not happen.
    const markdown = markdownFrom('notes.md', TEXT);
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: noImportFile },
      compose: null,
    });

    await expect(commands.composeImportFile('markdown')).rejects.toBeInstanceOf(EngineUnavailableError);
    expect(markdown.calls).toStrictEqual([]);
  });

  it('REFUSES A CLOSED TARGET before the picker, for append', async () => {
    const markdown = markdownFrom('notes.md', TEXT);
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: noImportFile },
      compose: () => Promise.reject(new Error('this case composes nothing')),
    });

    await expect(commands.composeImportFile('markdown', asDocId('never-opened'))).rejects.toBeInstanceOf(
      DocumentNotOpenError,
    );
    expect(markdown.calls).toStrictEqual([]);
  });

  it('answers the bound, not the file, when the read refuses it — and composes nothing', async () => {
    const composed: number[] = [];
    const markdown = markdownFrom('notes.md', { kind: 'too-large', byteLength: MAX_MARKDOWN_BYTES + 1 });
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: noImportFile },
      compose: (_format, source) => {
        composed.push(source.length);
        return Promise.reject(new Error('unreachable'));
      },
    });

    // THE LIMIT IS MAIN'S CONSTANT, never the file's size: a sentence reading *larger
    // than 4.0000002 MB* would state the file rather than the rule.
    expect(await commands.composeImportFile('markdown')).toStrictEqual({
      kind: 'too-large',
      limitBytes: MAX_MARKDOWN_BYTES,
    });
    expect(markdown.calls).toStrictEqual(['pick', 'read:notes.md']);
    expect(composed).toStrictEqual([]);
  });

  it('CARRIES THE HOST’S REFUSAL AND ITS LINE, and asks for no destination', async () => {
    const markdown = markdownFrom('notes.md', TEXT);
    const pages: unknown[] = [];
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: noImportFile },
      // `noCopying` rejects its picker, so a refusal that went on to ask for a
      // destination fails here rather than answering.
      compose: (_format, _source, page) => {
        pages.push(page);
        return Promise.resolve({ kind: 'refused', reason: 'unencodable-text', line: 7, item: null });
      },
    });

    expect(await commands.composeImportFile('markdown')).toStrictEqual({
      kind: 'composition-refused',
      reason: 'unencodable-text',
      line: 7,
      file: null,
    });
    // US LETTER, the one size both routes compose at, stated in points.
    expect(pages).toStrictEqual([{ width: 612, height: 792 }]);
  });

  it('CONTROL: a dismissed picker reads nothing and composes nothing', async () => {
    const composed: number[] = [];
    const markdown = markdownFrom(null, TEXT);
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: noImportFile },
      compose: (_format, source) => {
        composed.push(source.length);
        return Promise.reject(new Error('unreachable'));
      },
    });

    expect(await commands.composeImportFile('markdown')).toStrictEqual({ kind: 'cancelled' });
    expect(markdown.calls).toStrictEqual(['pick']);
    expect(composed).toStrictEqual([]);
  });

  it('A CSV IMPORT uses the CSV picker and the CSV bound, and asks the composer for CSV', async () => {
    // THE FORMAT IS THE DECISION, three ways at once: which picker opened, which limit
    // a refusal carries, and which format reached the composer. A command that used
    // Markdown's source or bound for CSV would answer plausibly on every other case.
    const markdown = markdownFrom('notes.md', TEXT);
    const csv = markdownFrom('table.csv', { kind: 'too-large', byteLength: MAX_CSV_BYTES + 1 });
    const formats: string[] = [];
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: csv.source },
      compose: (format) => {
        formats.push(format);
        return Promise.reject(new Error('unreachable'));
      },
    });

    expect(await commands.composeImportFile('csv')).toStrictEqual({
      kind: 'too-large',
      limitBytes: MAX_CSV_BYTES,
    });
    expect(csv.calls).toStrictEqual(['pick', 'read:table.csv']);
    expect(markdown.calls).toStrictEqual([]);
    expect(formats).toStrictEqual([]);

    // AND A CSV SOURCE THAT READS reaches the composer as CSV.
    const readable = markdownFrom('table.csv', { kind: 'read', bytes: new TextEncoder().encode('a,b\n') });
    const second = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imports: { markdown: markdown.source, csv: readable.source },
      compose: (format) => {
        formats.push(format);
        return Promise.resolve({ kind: 'refused', reason: 'nothing-to-draw', line: null, item: null });
      },
    });
    expect(await second.composeImportFile('csv')).toStrictEqual({
      kind: 'composition-refused',
      reason: 'nothing-to-draw',
      line: null,
      file: null,
    });
    expect(formats).toStrictEqual(['csv']);
  });
});

describe('DocumentCommands.composeImageFiles', () => {
  beforeAll(openDocument);

  /** An image source recording every call, with each file's size from a table. */
  function imagesFrom(
    picked: readonly string[] | null,
    sizeOf: (path: string) => number | null,
  ): { readonly source: ImageFilesSource; readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      source: {
        pick: () => {
          calls.push('pick');
          return Promise.resolve(picked);
        },
        size: (path) => {
          calls.push(`size:${path}`);
          return Promise.resolve(sizeOf(path));
        },
        read: (path) => {
          calls.push(`read:${path}`);
          return Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode(path) });
        },
      },
    };
  }

  function commandsWith(
    images: ImageFilesSource,
    composeImages: DocumentCommandsParts['composeImages'],
  ): DocumentCommands {
    return new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      imageFiles: images,
      composeImages,
    });
  }

  it('REFUSES BEFORE THE PICKER where no compose host can exist', async () => {
    const images = imagesFrom(['a.png'], () => 1);
    await expect(commandsWith(images.source, null).composeImageFiles()).rejects.toBeInstanceOf(
      EngineUnavailableError,
    );
    expect(images.calls).toStrictEqual([]);
  });

  it('makes pages in NAME ORDER with digits as numbers, and names the file a refusal is about', async () => {
    // THE PICKER'S ORDER IS DELIBERATELY NOT NAME ORDER, and plain string order would
    // put `scan 10` before `scan 2`. The host refuses POSITION 3, so only a command that
    // sent the sorted list and mapped back through it names `scan 10.png`.
    const images = imagesFrom(['C:\\s\\scan 10.png', 'C:\\s\\scan 2.jpg', 'C:\\s\\Scan 1.JPEG'], () => 8);
    const sent: string[] = [];
    const commands = commandsWith(images.source, async (items) => {
      for (const item of items) {
        const read = await item.read();
        if (read.kind !== 'read') throw new Error('the fixture reads every file');
        sent.push(`${item.mediaType}:${new TextDecoder().decode(read.bytes)}`);
      }
      return { kind: 'refused', reason: 'too-many-pixels', line: null, item: 3 };
    });

    // `noCopying` rejects its picker, so a refusal that went on to ask for a destination
    // fails here rather than answering.
    expect(await commands.composeImageFiles()).toStrictEqual({
      kind: 'composition-refused',
      reason: 'too-many-pixels',
      line: null,
      file: 'scan 10.png',
    });
    expect(sent).toStrictEqual([
      'image/jpeg:C:\\s\\Scan 1.JPEG',
      'image/jpeg:C:\\s\\scan 2.jpg',
      'image/png:C:\\s\\scan 10.png',
    ]);
  });

  it('decides every bound it can BEFORE ANY FILE IS READ, and composes nothing', async () => {
    // THE DECISION IS THE CALLS NOT MADE. Each refusal below is also what the host or
    // the bounded read would eventually say, so only the absent `read:` calls separate
    // deciding up front from finding out later.
    let composed = 0;
    const composer: DocumentCommandsParts['composeImages'] = () => {
      composed += 1;
      return Promise.reject(new Error('unreachable'));
    };

    const many = imagesFrom(
      Array.from({ length: MAX_IMPORT_IMAGES + 1 }, (_, at) => `${String(at)}.png`),
      () => 1,
    );
    expect(await commandsWith(many.source, composer).composeImageFiles()).toStrictEqual({
      kind: 'too-many-images',
      limit: MAX_IMPORT_IMAGES,
    });
    expect(many.calls).toStrictEqual(['pick']);

    const gif = imagesFrom(['a.png', 'b.gif'], () => 1);
    expect(await commandsWith(gif.source, composer).composeImageFiles()).toStrictEqual({
      kind: 'composition-refused',
      reason: 'image-unreadable',
      line: null,
      file: 'b.gif',
    });

    const oneLarge = imagesFrom(['a.png', 'b.png'], (path) => (path === 'b.png' ? MAX_IMAGE_BYTES + 1 : 1));
    expect(await commandsWith(oneLarge.source, composer).composeImageFiles()).toStrictEqual({
      kind: 'too-large',
      limitBytes: MAX_IMAGE_BYTES,
    });

    // EVERY FILE UNDER ITS OWN BOUND, and the set over its: only the running total refuses.
    // FIVE FILES, not four: the set's bound is four times a file's, so four files over it
    // are each over their own bound too, and the per-file refusal answers first — the
    // assertion on the line after this caught exactly that when it said four.
    const perFile = Math.floor(MAX_IMPORT_IMAGE_BYTES / 5) + 1;
    const set = imagesFrom(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'], () => perFile);
    expect(perFile).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(await commandsWith(set.source, composer).composeImageFiles()).toStrictEqual({
      kind: 'images-too-large',
      limitBytes: MAX_IMPORT_IMAGE_BYTES,
    });

    const unstated = imagesFrom(['a.png'], () => null);
    expect(await commandsWith(unstated.source, composer).composeImageFiles()).toStrictEqual({
      kind: 'unreadable',
    });

    const reads = [...many.calls, ...gif.calls, ...oneLarge.calls, ...set.calls, ...unstated.calls];
    expect(reads.filter((call) => call.startsWith('read:'))).toStrictEqual([]);
    expect(composed).toBe(0);
  });

  it('CONTROL: a dismissed picker, or an empty pick, sizes nothing and composes nothing', async () => {
    for (const picked of [null, []]) {
      const images = imagesFrom(picked, () => 1);
      const commands = commandsWith(images.source, () => Promise.reject(new Error('unreachable')));
      expect(await commands.composeImageFiles()).toStrictEqual({ kind: 'cancelled' });
      expect(images.calls).toStrictEqual(['pick']);
    }
  });

  it('THROWS for a refused position past the list it sent, rather than naming some file', async () => {
    const images = imagesFrom(['a.png'], () => 1);
    const commands = commandsWith(images.source, () =>
      Promise.resolve({ kind: 'refused', reason: 'image-unreadable', line: null, item: 2 }),
    );
    await expect(commands.composeImageFiles()).rejects.toThrow('image 2 of 1');
  });
});

describe('DocumentCommands.composeCapturedFrames', () => {
  beforeAll(openDocument);

  const FRAME = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x01);

  it('REFUSES BEFORE COMPOSING where no compose host can exist', async () => {
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      composeImages: null,
    });
    await expect(commands.composeCapturedFrames([FRAME])).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it('composes every frame AS JPEG, in order, and a refusal names no file and asks for no destination', async () => {
    // TWO FRAMES THAT DIFFER, so a binding that sent one frame twice is visible. `noCopying`
    // rejects its picker, so a refusal that went on to ask for a destination fails here.
    const second = Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x02);
    const sent: string[] = [];
    const commands = new DocumentCommands({
      ...INERT,
      documents: service,
      bus: bus(),
      engine: engine(),
      composeImages: async (items) => {
        for (const item of items) {
          const read = await item.read();
          if (read.kind !== 'read') throw new Error('a frame always reads');
          sent.push(`${item.mediaType}:${[...read.bytes].join(',')}`);
        }
        return { kind: 'refused', reason: 'image-unreadable', line: null, item: 2 };
      },
    });

    expect(await commands.composeCapturedFrames([FRAME, second])).toStrictEqual({
      kind: 'composition-refused',
      reason: 'image-unreadable',
      line: null,
      file: null,
    });
    expect(sent).toStrictEqual(['image/jpeg:255,216,255,224,1', 'image/jpeg:255,216,255,219,2']);
  });
});

describe('DocumentCommands — a page edited in another application (ADR-0062)', () => {
  /**
   * The copy path over the real disk, `openFromUrl`'s `realSave`.
   *
   * `flushes` counts the flush. It REFUSED until 2026-09-18, asserting *a page sent out flushes
   * no document*; bringing the edit back replaces a page, which PDF.js draws from the bytes, so
   * the reimport now flushes once by design (ADR-0084) and the count keeps the send-out's half.
   */
  function realSave(flushes: DocId[]): SaveSource {
    return {
      deps: {
        checkWriteTarget: () => Promise.reject(new Error('a page sent out writes a copy, never a save')),
        surface: nodeFileSurface,
        names: siblingNames,
        wait: () => Promise.resolve(),
      },
      flush: (docId, sessions) => {
        flushes.push(docId);
        return sessionFlush(docId, sessions);
      },
    };
  }

  /**
   * A watch surface a case drives: the REAL SHA-256 over the real file, with the event and the
   * quiet second supplied by hand, so a save is exact rather than timed.
   */
  function drivenWatch() {
    let onEvent: ((name: string) => void) | null = null;
    let watched = 0;
    let closed = 0;
    const quiet: { run: () => void; live: boolean }[] = [];
    const surface: EditWatchSurface = {
      watchDirectory: (_directory, event) => {
        watched += 1;
        onEvent = event;
        return {
          close: () => {
            closed += 1;
          },
        };
      },
      digest: (path) => nodeEditWatchSurface.digest(path),
      after: (ms, run) => {
        const timer = { run, live: ms === EDIT_QUIET_MS };
        quiet.push(timer);
        return {
          cancel: () => {
            timer.live = false;
          },
        };
      },
    };
    return {
      surface,
      /** An editor's save of `name`: the event, then a quiet second passing. */
      saved: (name: string): void => {
        onEvent?.(name);
        for (const timer of quiet.splice(0)) {
          if (timer.live) {
            timer.live = false;
            timer.run();
          }
        }
      },
      watched: () => watched,
      closed: () => closed,
    };
  }

  /** A three-page target with its own service and registry, so a second document can open beside it. */
  async function target(name: string) {
    const bytes = await pdfBytes();
    const path = join(directory, name);
    writeFileSync(path, bytes);
    const registry = new CapabilityRegistry();
    const documents = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await documents.open(registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`the target did not open: ${outcome.kind}`);
    const held = new EngineSessions();
    const session = await mupdfWriter.open(bytes);
    held.hold(outcome.docId, { mupdf: session });
    // THE CURRENT VERSION, read the one way the service offers: a `run` answers the version its
    // work finished at, and an empty work finishes at the version the document is at.
    const { version } = await documents.run(outcome.docId, () => Promise.resolve(null));
    return { registry, documents, held, session, id: outcome.docId, version };
  }

  function commandsFor(
    t: Awaited<ReturnType<typeof target>>,
    destination: string,
    watch: EditWatchSurface,
    open: (path: string) => Promise<string | null>,
  ): { readonly commands: DocumentCommands; readonly picked: string[]; readonly flushes: DocId[] } {
    const picked: string[] = [];
    const flushes: DocId[] = [];
    return {
      picked,
      flushes,
      commands: new DocumentCommands({
        ...INERT,
        documents: t.documents,
        bus: bus(),
        engine: t.held,
        save: realSave(flushes),
        copy: {
          pick: () => Promise.reject(new Error('this case writes no copy')),
          checkTarget: (path) => t.documents.checkCopyTarget(path),
        },
        externalEdit: {
          pick: (suggested) => {
            picked.push(suggested);
            return Promise.resolve(destination);
          },
          open,
          watch,
        },
      }),
    };
  }

  /** Each page's width, read back through pdf-lib — a different parser than the one that wrote it. */
  async function widths(session: MupdfSession): Promise<number[]> {
    const document = await PDFDocument.load(await mupdfWriter.serialise(session));
    return document.getPages().map((page) => page.getWidth());
  }

  /** The other application's save: a one-page, 300-point-square PDF written over the page sent out. */
  async function editedElsewhere(path: string): Promise<void> {
    const document = await PDFDocument.create();
    document.addPage([300, 300]);
    writeFileSync(path, await document.save());
  }

  /** Opens the edited file beside the target, as the reimport's one open route would. */
  async function openEdited(
    t: Awaited<ReturnType<typeof target>>,
    path: string,
  ): Promise<{ readonly id: DocId; readonly session: MupdfSession }> {
    const outcome = await t.documents.open(t.registry.mint(path));
    if (outcome.kind !== 'opened') throw new Error(`the edited file did not open: ${outcome.kind}`);
    const session = await mupdfWriter.open(readFileSync(path));
    t.held.hold(outcome.docId, { mupdf: session });
    return { id: outcome.docId, session };
  }

  it('REFUSES a name not ending .pdf BEFORE anything is written, and opens and watches nothing', async () => {
    const t = await target('refuse-target.pdf');
    const destination = join(directory, 'page 2.exe');
    const driven = drivenWatch();
    const opened: string[] = [];
    const { commands } = commandsFor(t, destination, driven.surface, (path) => {
      opened.push(path);
      return Promise.resolve(null);
    });

    expect(await commands.editPageExternally(t.id, 1, t.version)).toStrictEqual({ kind: 'not-pdf' });
    // THE DECISION IS WHAT DID NOT HAPPEN: the same refusal after the write would answer the same.
    expect(existsSync(destination)).toBe(false);
    expect(opened).toStrictEqual([]);
    expect(driven.watched()).toBe(0);
  });

  it('SENDS one page as a one-page PDF where the person chose, suggests its number, and opens and watches it', async () => {
    const t = await target('send-target.pdf');
    const destination = join(directory, 'sent page.pdf');
    const driven = drivenWatch();
    const opened: string[] = [];
    const { commands, picked } = commandsFor(t, destination, driven.surface, (path) => {
      opened.push(path);
      return Promise.resolve(null);
    });

    expect(await commands.editPageExternally(t.id, 1, t.version)).toStrictEqual({ kind: 'sent' });
    // A PERSON COUNTS FROM ONE: index 1 is page 2.
    expect(picked).toStrictEqual(['send-target page 2.pdf']);
    expect((await PDFDocument.load(readFileSync(destination))).getPageCount()).toBe(1);
    expect(opened).toStrictEqual([destination]);
    expect(driven.watched()).toBe(1);

    commands.endExternalEdit(t.id);
    expect(driven.closed()).toBe(1);
    await expect(commands.awaitExternalEdit(t.id)).resolves.toBe('ended');
  });

  it('a launch that FAILS closes the watch it started and leaves no page out', async () => {
    const t = await target('launch-target.pdf');
    const driven = drivenWatch();
    const { commands } = commandsFor(t, join(directory, 'unopened.pdf'), driven.surface, () =>
      Promise.resolve('No application is associated with the specified file'),
    );

    expect(await commands.editPageExternally(t.id, 0, t.version)).toStrictEqual({ kind: 'launch-failed' });
    expect(driven.watched()).toBe(1);
    expect(driven.closed()).toBe(1);
    await expect(commands.awaitExternalEdit(t.id)).resolves.toBe('ended');
  });

  it('END TO END: a save in the other application comes back IN PLACE OF the page sent out, and reads back that way', async () => {
    const t = await target('roundtrip-target.pdf');
    const destination = join(directory, 'roundtrip page.pdf');
    const driven = drivenWatch();
    const { commands, flushes } = commandsFor(t, destination, driven.surface, () => Promise.resolve(null));
    try {
      expect(await commands.editPageExternally(t.id, 1, t.version)).toStrictEqual({ kind: 'sent' });
      // SENDING A PAGE OUT FLUSHES NOTHING.
      expect(flushes).toStrictEqual([]);

      // THE WAIT IS OPEN BEFORE THE SAVE, so the edit is announced to it rather than raced.
      const waiting = commands.awaitExternalEdit(t.id);
      await editedElsewhere(destination);
      driven.saved(basename(destination));
      await expect(waiting).resolves.toBe('changed');
      expect(commands.externalEditToReimport(t.id)).toBe(destination);

      const edited = await openEdited(t, destination);
      const applied = await commands.reimportExternalEdit(t.id, edited.id);

      // PAGE 2 IS THE EDIT and the pages either side are untouched, read by a different parser.
      expect(await widths(t.session)).toStrictEqual([612, 300, 612]);
      // AND THE WINDOW IS HANDED IT (ADR-0084): the bytes main serves at the new version, read
      // through the range reader the renderer's transport calls, are the edited document — before
      // this, they were the document as opened, and the edit appeared only after a reopen.
      expect(flushes).toStrictEqual([t.id]);
      const served = readDocumentRange(t.documents, t.id, applied.version, 0, applied.byteLength);
      if (served.kind !== 'bytes') throw new Error(`main refused its own current version: ${served.kind}`);
      const shown = await PDFDocument.load(served.bytes);
      expect(shown.getPages().map((page) => page.getWidth())).toStrictEqual([612, 300, 612]);
      // ACCEPTED: the same save is not offered again.
      expect(commands.externalEditToReimport(t.id)).toBeUndefined();
    } finally {
      commands.endExternalEdit(t.id);
    }
  });

  it('CONTROL: a document that MOVED after the page left is refused inside the lane, and page 2 is untouched', async () => {
    const t = await target('moved-target.pdf');
    const destination = join(directory, 'moved page.pdf');
    const driven = drivenWatch();
    const { commands } = commandsFor(t, destination, driven.surface, () => Promise.resolve(null));
    try {
      expect(await commands.editPageExternally(t.id, 1, t.version)).toStrictEqual({ kind: 'sent' });
      // THE DOCUMENT MOVES while the page is out.
      await commands.execute(t.id, rotateOnce);

      const waiting = commands.awaitExternalEdit(t.id);
      await editedElsewhere(destination);
      driven.saved(basename(destination));
      await expect(waiting).resolves.toBe('changed');

      const edited = await openEdited(t, destination);
      await expect(commands.reimportExternalEdit(t.id, edited.id)).rejects.toThrow(StaleTargetError);
      expect(await widths(t.session)).toStrictEqual([612, 612, 612]);
      // NOT ACCEPTED: nothing came back, so the edit is still the one waiting.
      expect(commands.externalEditToReimport(t.id)).toBe(destination);
    } finally {
      commands.endExternalEdit(t.id);
    }
  });
});

/**
 * ADR-0064's two owed readings, taken through the lane rather than the writer alone:
 * the application's save path with a reopen, and undo removing all five structures.
 *
 * `pageLayerImport.test.ts` proves the writer. What it cannot say is that the command
 * survives the route a person's click takes — the bus resolving the source through
 * `#sourcesFor`, the checkpoint the bus takes because `CommandPrior` is `never`, the
 * save pipeline's flush and rename, and a restore that rebuilds the session.
 */
describe('importPageAsLayer — saved and reopened, and undone, through the lane (ADR-0064)', () => {
  let opened = 0;

  /** A one-page 400 × 200 source with a mark, so its Form XObject has content. */
  async function sourceBytes(): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.addPage([400, 200]).drawRectangle({ x: 10, y: 10, width: 50, height: 50 });
    return document.save({ useObjectStreams: false });
  }

  /** A target on disk and a source beside it, one service, both sessions held, a real save and restore. */
  async function twoDocuments() {
    opened += 1;
    const targetPath = join(directory, `layer-target-${String(opened)}.pdf`);
    const sourcePath = join(directory, `layer-source-${String(opened)}.pdf`);
    writeFileSync(targetPath, await pdfBytes());
    writeFileSync(sourcePath, await sourceBytes());

    const registry = new CapabilityRegistry();
    const documents = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const target = await documents.open(registry.mint(targetPath));
    const source = await documents.open(registry.mint(sourcePath));
    if (target.kind !== 'opened' || source.kind !== 'opened') throw new Error('a fixture did not open');

    const held = new EngineSessions();
    held.hold(target.docId, { mupdf: await mupdfWriter.open(readFileSync(targetPath)) });
    held.hold(source.docId, { mupdf: await mupdfWriter.open(readFileSync(sourcePath)) });

    let restores = 0;
    const commands = new DocumentCommands({
      ...LOCAL_READS,
      documents,
      bus: bus(),
      engine: held,
      save: {
        deps: {
          checkWriteTarget: (id) => documents.checkWriteTarget(id),
          surface: nodeFileSurface,
          names: siblingNames,
          wait: () => Promise.resolve(),
        },
        flush: (docId, sessions) => {
          const mupdf = sessions.mupdf;
          if (mupdf === undefined) throw new Error('the target holds a session');
          // A RELEASED SESSION IS REFUSED, as the host's registry refuses its token: *"This
          // session token was not adopted by this registry, or it has already been
          // released"*. A local session serialises after a recycle all the same, so without
          // this the harness passed the flush of a stale set that the application refused
          // (measured 2026-09-18, undoing a rectangle in the running app).
          if (held.sessions(docId)?.mupdf !== mupdf) {
            throw new Error('flushed a session this document no longer holds');
          }
          return mupdfWriter.serialise(mupdf);
        },
      },
      // THE SUPERVISOR'S OWN RECYCLE, with the checkpoint written where a host's granted
      // directory would be: `DocumentRestore`'s contract, composed locally.
      restore: (id, write) =>
        held.recycle(id, async () => {
          restores += 1;
          const path = join(directory, `layer-restore-${String(opened)}-${String(restores)}.pdf`);
          await write(path);
          return { mupdf: await mupdfWriter.open(readFileSync(path)) };
        }),
    });
    const { version } = await documents.run(target.docId, () => Promise.resolve(null));
    return {
      commands,
      documents,
      held,
      targetPath,
      target: target.docId,
      source: source.docId,
      version,
      restores: () => restores,
    };
  }

  /** The five structures ADR-0064 names, read with pdf-lib — a different parser than the writer. */
  function structures(document: PDFDocument, page: number) {
    const properties = document.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
    const ocgs = properties?.lookupMaybe(PDFName.of('OCGs'), PDFArray)?.size() ?? 0;
    const order =
      properties?.lookupMaybe(PDFName.of('D'), PDFDict)?.lookupMaybe(PDFName.of('Order'), PDFArray)?.size() ?? 0;

    const node = document.getPage(page).node;
    const xobjects = node
      .lookupMaybe(PDFName.of('Resources'), PDFDict)
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    const entries = xobjects === undefined ? [] : xobjects.keys().map((key) => key.decodeText());

    // EVERY Form XObject carrying `/OC` in the whole file, not only those a page names: an
    // undo that dropped the resource entry and left the object would pass a page-scoped read.
    let governedForms = 0;
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (object instanceof PDFRawStream && object.dict.get(PDFName.of('OC')) !== undefined) governedForms += 1;
    }

    const contents = node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFArray ? contents.asArray() : contents === undefined ? [] : [contents];
    const drawn = refs.some((ref) => {
      const stream = document.context.lookup(ref);
      return (
        stream instanceof PDFRawStream &&
        /\/MonsteraLayer\d+ Do/u.test(new TextDecoder().decode(decodePDFRawStream(stream).decode()))
      );
    });

    return { ocgs, order, entries, governedForms, drawn };
  }

  const PRESENT = { ocgs: 1, order: 1, entries: ['MonsteraLayer0'], governedForms: 1, drawn: true };
  const ABSENT = { ocgs: 0, order: 0, entries: [], governedForms: 0, drawn: false };

  it('SAVED AND REOPENED: the file on disk carries all five, and a new session lists the layer', async () => {
    const t = await twoDocuments();
    // PAGE 1 OF 3, for `pageLayerImport.test.ts`' rotate lesson.
    await t.commands.execute(t.target, {
      kind: 'importPageAsLayer',
      source: t.source,
      name: 'Letterhead',
      at: 1,
      version: t.version,
    });

    const saved = await t.commands.save(t.target);
    expect(saved.kind).toBe('saved');

    // THE FILE, NOT THE SESSION: a save that wrote the original bytes back would leave the
    // session carrying the layer and this reading empty.
    const onDisk = readFileSync(t.targetPath);
    expect(structures(await PDFDocument.load(onDisk), 1)).toStrictEqual(PRESENT);
    expect(structures(await PDFDocument.load(onDisk), 0)).toStrictEqual({ ...ABSENT, ocgs: 1, order: 1, governedForms: 1 });

    // A REOPEN, through a session that never saw the command: the Layers panel's own reader.
    const reopened = await mupdfWriter.open(onDisk);
    try {
      const layers = await readLayers(reopened);
      expect(layers.map((layer) => layer.name)).toStrictEqual(['Letterhead']);
    } finally {
      await mupdfWriter.close(reopened);
    }
  });

  it('SAVED TWICE: the second save of the same document is written, not refused as replaced', async () => {
    // THE MEASURED CASE (2026-09-18): a save renames a temporary file over the target, so
    // the file at the path afterwards is a new file. Compared against the identity read at
    // open, the second save was refused as `replaced` — a document could be saved once.
    const t = await twoDocuments();
    await t.commands.execute(t.target, {
      kind: 'importPageAsLayer',
      source: t.source,
      name: 'First',
      at: 1,
      version: t.version,
    });
    expect((await t.commands.save(t.target)).kind).toBe('saved');

    const { version } = await t.documents.run(t.target, () => Promise.resolve(null));
    await t.commands.execute(t.target, { kind: 'importPageAsLayer', source: t.source, name: 'Second', at: 0, version });
    const second = await t.commands.save(t.target);
    expect(second.kind).toBe('saved');

    // AND THE FILE HOLDS THE SECOND EDIT: a refusal reported as a save would leave it out.
    const reopened = await mupdfWriter.open(readFileSync(t.targetPath));
    try {
      expect((await readLayers(reopened)).map((layer) => layer.name).sort()).toStrictEqual(['First', 'Second']);
    } finally {
      await mupdfWriter.close(reopened);
    }
  });

  it('CONTROL: a file replaced from OUTSIDE between two saves is still refused', async () => {
    // What re-recording the identity must not disarm: the guard exists for this.
    const t = await twoDocuments();
    await t.commands.execute(t.target, {
      kind: 'importPageAsLayer',
      source: t.source,
      name: 'First',
      at: 1,
      version: t.version,
    });
    expect((await t.commands.save(t.target)).kind).toBe('saved');

    // ANOTHER PROGRAM'S SAVE: its own temporary file renamed over the target.
    const outside = `${t.targetPath}.outside`;
    writeFileSync(outside, readFileSync(t.targetPath));
    renameSync(outside, t.targetPath);

    const { version } = await t.documents.run(t.target, () => Promise.resolve(null));
    await t.commands.execute(t.target, { kind: 'importPageAsLayer', source: t.source, name: 'Second', at: 0, version });
    const refused = await t.commands.save(t.target);
    expect(refused).toMatchObject({ kind: 'refused', verdict: { kind: 'replaced' } });
  });

  it('UNDONE: all five structures are gone, from a checkpoint the lane restored', async () => {
    const t = await twoDocuments();
    await t.commands.execute(t.target, {
      kind: 'importPageAsLayer',
      source: t.source,
      name: 'Letterhead',
      at: 1,
      version: t.version,
    });

    // THE CONTROL FOR THE ABSENCE BELOW, read from the same session and the same reader: an
    // import that wrote nothing would make every "gone" hold before the undo ran.
    const before = t.held.sessions(t.target)?.mupdf;
    if (before === undefined) throw new Error('the target holds a session');
    expect(structures(await PDFDocument.load(await mupdfWriter.serialise(before)), 1)).toStrictEqual(PRESENT);

    const undone = await t.commands.undo(t.target);
    if (undone === undefined) throw new Error('the undo stepped nothing');

    // THE RESTORE RAN: undo reversed a checkpoint, not an inverse nobody captured.
    expect(t.restores()).toBe(1);
    const after = t.held.sessions(t.target)?.mupdf;
    if (after === undefined) throw new Error('the restore held no session');
    expect(structures(await PDFDocument.load(await mupdfWriter.serialise(after)), 1)).toStrictEqual(ABSENT);
    expect(await readLayers(after)).toStrictEqual([]);

    // AND THE WINDOW IS HANDED THE RESTORED DOCUMENT (ADR-0084): the bytes main serves at the
    // undo's version, taken from the session the restore REBUILT — the flush above refuses the
    // one it released, which is the failure the running application met.
    const served = readDocumentRange(t.documents, t.target, undone.version, 0, undone.byteLength);
    if (served.kind !== 'bytes') throw new Error(`main refused its own current version: ${served.kind}`);
    expect(structures(await PDFDocument.load(served.bytes), 1)).toStrictEqual(ABSENT);
  });
});

describe('DocumentCommands.openFromUrl', () => {
  beforeAll(openDocument);

  /** A save source over the real disk, for the cases that write a fetched body. */
  function realSave(): SaveSource {
    return {
      deps: {
        checkWriteTarget: () => Promise.reject(new Error('a fetch writes a copy, never a save')),
        surface: nodeFileSurface,
        names: siblingNames,
        wait: () => Promise.resolve(),
      },
      flush: () => Promise.reject(new Error('a fetch flushes no document')),
    };
  }

  function commandsFetching(
    fetchUrl: DocumentCommandsParts['fetchUrl'],
    destination: string,
  ): { readonly commands: DocumentCommands; readonly picked: string[] } {
    const picked: string[] = [];
    const copy: CopySource = {
      pick: (suggested) => {
        picked.push(suggested);
        return Promise.resolve(destination);
      },
      checkTarget: () => Promise.resolve({ kind: 'writable' }),
    };
    return {
      picked,
      commands: new DocumentCommands({
        ...INERT,
        documents: service,
        bus: bus(),
        engine: engine(),
        save: realSave(),
        copy,
        fetchUrl,
      }),
    };
  }

  async function* body(...parts: string[]): AsyncIterable<Uint8Array> {
    for (const part of parts) {
      await Promise.resolve();
      yield new TextEncoder().encode(part);
    }
  }

  it('REFUSES a blocked address BEFORE the save dialog, and fetches nothing', async () => {
    // THE DECISION IS THE CALLS NOT MADE: the same refusal after a save dialog would read
    // the same at the boundary, and would have asked a person to name a file for nothing.
    let fetched = 0;
    const { commands, picked } = commandsFetching(() => {
      fetched += 1;
      return Promise.resolve(body('%PDF-'));
    }, join(directory, 'never.pdf'));

    expect(await commands.openFromUrl('https://127.0.0.1/a.pdf')).toStrictEqual({
      kind: 'url-refused',
      reason: 'blocked-address',
    });
    expect(await commands.openFromUrl('http://example.com/a.pdf')).toStrictEqual({
      kind: 'url-refused',
      reason: 'not-https',
    });
    expect(picked).toStrictEqual([]);
    expect(fetched).toBe(0);
  });

  it('writes a fetched body to the chosen destination, byte for byte, suggesting its name', async () => {
    const destination = join(directory, 'fetched-report.pdf');
    const { commands, picked } = commandsFetching(
      () => Promise.resolve(body('%PDF-1.7 ', 'the body')),
      destination,
    );

    expect(await commands.openFromUrl('https://example.com/files/Q3%20report.pdf')).toStrictEqual({
      kind: 'written',
      destination,
    });
    expect(readFileSync(destination, 'latin1')).toBe('%PDF-1.7 the body');
    expect(picked).toStrictEqual(['Q3 report.pdf']);
  });

  it('answers a guard refusal met WHILE THE BODY ARRIVES by its reason, leaving no file and no temp', async () => {
    const destination = join(directory, 'too-large.pdf');
    async function* refusing(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode('%PDF-1.7 ');
      await Promise.resolve();
      throw new UrlFetchRefused('too-large', 'refused for the case');
    }
    const { commands } = commandsFetching(() => Promise.resolve(refusing()), destination);

    expect(await commands.openFromUrl('https://example.com/big.pdf')).toStrictEqual({
      kind: 'url-refused',
      reason: 'too-large',
    });
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(siblingNames(destination).temp)).toBe(false);
  });

  it('CONTROL: a failure that is NOT the guard’s propagates, rather than blaming the address', async () => {
    const { commands } = commandsFetching(
      () => Promise.reject(new Error('a defect in this build')),
      join(directory, 'defect.pdf'),
    );
    await expect(commands.openFromUrl('https://example.com/a.pdf')).rejects.toThrow('a defect in this build');
  });
});

describe('suggestedUrlName', () => {
  it('takes the last path segment, decoded, as a PDF name — and the whole host with no path', () => {
    expect(suggestedUrlName(new URL('https://example.com/files/Q3%20report.pdf'))).toBe('Q3 report.pdf');
    expect(suggestedUrlName(new URL('https://example.com/download.php?id=1'))).toBe('download.pdf');
    expect(suggestedUrlName(new URL('https://example.com/'))).toBe('example.com.pdf');
    // A SEPARATOR DECODED FROM THE PATH would suggest a folder, so it is replaced.
    expect(suggestedUrlName(new URL('https://example.com/a%2Fb.pdf'))).toBe('a_b.pdf');
    // A MALFORMED ESCAPE keeps the segment as written rather than throwing.
    expect(suggestedUrlName(new URL('https://example.com/100%25%E0.pdf'))).toBe('100%25%E0.pdf');
  });
});

describe('suggestedComposedName', () => {
  it('takes the file name after either separator and replaces its extension', () => {
    expect(suggestedComposedName('C:\\notes\\draft.md')).toBe('draft.pdf');
    expect(suggestedComposedName('/home/someone/read.me.markdown')).toBe('read.me.pdf');
    expect(suggestedComposedName('C:\\notes\\README')).toBe('README.pdf');
    // A NAME THAT IS ONLY AN EXTENSION keeps it, rather than suggesting a hidden `.pdf`.
    expect(suggestedComposedName('C:\\notes\\.md')).toBe('.md.pdf');
  });
});
