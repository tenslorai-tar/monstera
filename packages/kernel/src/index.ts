export { CapabilityRegistry, type HandleBytesSource, handlesEqual } from './capabilityRegistry.js';
// `export type { … }` rather than `export { type … }`, and the difference is the
// whole of ADR-0026 said in one statement: the second form elides the SPECIFIERS
// and keeps the STATEMENT, emitting `export {} from './engineSeam.js'`, which
// loads that module at runtime in every importer of this barrel. No lint rule
// catches it — `no-import-type-side-effects` visits `ImportDeclaration` only,
// and `consistent-type-exports` treats an inline `type` specifier as already
// satisfying it (finding MMMM-1, measured against the pinned plugin 8.67.0 and
// then executed with a positive control).
export type {
  Apply,
  ByteImage,
  DocumentAccess,
  EngineWriter,
  Invert,
  LockedReason,
  MupdfSession,
  PdfiumSession,
  // FROM HERE SINCE 2026-09-11, and it was `commandBus.ts`' until then: a
  // pre-read's members may now take an argument, so the declarations table
  // declares the expression that calls one, and the seam cannot import the
  // declarations back (ADR-0051).
  PreReadAccess,
  WriterSession,
  WriterShape,
  WriterShapeOf,
} from './engineSeam.js';
// `mupdfWriter` and `withDocument` are NOT here. Every value whose module graph
// binds a native library lives behind `@monstera/kernel/engine` — see
// `engine.ts` and ADR-0026. Re-adding one to this file re-creates the defect in
// full: an export from a barrel is loaded by everything that imports the
// barrel, and `composition.ts` imports the barrel.
// The prior-state TYPES stay — they are erased, and the log's shape is part of
// this surface. The four implementations moved to `@monstera/kernel/engine`:
// `rotatePages.ts` imports `mupdfWriter.ts`, so exporting a function from it
// here binds the native library in every importer of this barrel. That was the
// LAST remaining edge after the declaration split, and it was a plain value
// export rather than a spelling problem (ADR-0026).
export type { PriorPageRotation, PriorRotation } from './rotatePages.js';
// THE TYPE ONLY, for `rotatePages`' reason: `pageTransition.ts` imports
// `mupdfWriter.ts`, so a value export here would bind the native library in
// every importer of this barrel. The prior-state shape is erased.
export type { PriorPageTransition, PriorTransition } from './pageTransition.js';
// The TYPES only, for the same reason: `pageResize.ts` imports `mupdfWriter.ts`.
export type { PriorContents } from './pageContentWrap.js';
export type { PriorBox, PriorPageResize } from './pageResize.js';
// The TYPE only, for the same reason and by the same spelling: `readPageGeometry`
// reaches `mupdfWriter.ts`, so it is on `@monstera/kernel/engine`. The shape is
// what main, the host and the contract all name, and it is erased.
export type { PageGeometry, PageGeometryReader } from './pageGeometry.js';
export {
  type CaptureResult,
  type Checkpoint,
  CommandLog,
  type CommandPrior,
  type LogEntry,
  type LogEntryFor,
  type ReadonlyCommandLog,
} from './commandLog.js';
export {
  type ByteImageAccess,
  type CheckpointRestore,
  CommandBus,
  type CommandInputs,
  type Executed,
  type SnapshotWrite,
  type Undone,
  MissingWriterSessionError,
  StaleTargetError,
  UnregisteredWriterError,
  type WriterRegistry,
} from './commandBus.js';
// TYPES ONLY from the spec table. Its values — `commandSpecs`, `declaredSpecs`
// and `localMupdfExecution` — all reach `rotatePages.ts` → `mupdfWriter.ts`,
// so exporting any of them here would bind the native library in every importer
// of this barrel. They are on `@monstera/kernel/engine` (ADR-0026).
// `export type { … } from`, NOT `export { type … } from`. The second spelling
// elides the BINDINGS and keeps the STATEMENT — `tsc` emits
// `export {} from './commandSpecs.js'`, a side-effect re-export that loads the
// module and everything under it. Measured 2026-08-27: written the wrong way,
// this line alone kept the barrel at +41.4 MB after the whole split, because
// the native edge was in the re-export rather than in anything exported.
//
// The same mechanism as the `import { type X }` trap this repository has paid
// for twice, in a third spelling. `export type { … }` is erased entirely.
export type {
  CommandExecution,
  CommandSpec,
  CommandSpecs,
  DeclaredSpecs,
  KindsRoutedTo,
  RegisteredWriter,
  WriterBinding,
} from './commandSpecs.js';
export {
  type CommandDeclaration,
  type CommandDeclarations,
  type DeclaredCommands,
  type Invertibility,
  type Reproducibility,
  type WriterOf,
  type WriterOfRecord,
  type WriterRouting,
  declaredCommands,
} from './commandDeclarations.js';
export {
  ENGINE_PATH_MAX_CHARS,
  ENGINE_SESSION_ID_MAX_CHARS,
  type EngineChannels,
  type EngineFailureCode,
  engineChannels,
} from './host/engineChannels.js';
export {
  type EngineHandlerParts,
  type HostAnnotationsReader,
  type HostContainmentProbe,
  type HostFilesystem,
  type HostDestinationsReader,
  type HostDuplicatesReader,
  type HostExtract,
  type HostFlatFieldsReader,
  type HostFormDataExport,
  type HostFormFieldsReader,
  type HostLayersReader,
  type HostHandwritingReader,
  type HostOcrReader,
  type HostPageLinksReader,
  type HostPageTextReader,
  type HostSession,
  type HostSessions,
  type HostSnapshot,
  createEngineHandlers,
} from './host/engineHandlers.js';
export {
  EngineDocumentLocked,
  EngineFormDataExportFailed,
  EngineOpenFailed,
  EngineSerialiseFailed,
  EngineSerialiseMismatch,
  type RemoteMupdfLifecycle,
  type SessionAreaSurface,
  remoteMupdfLifecycle,
} from './host/remoteLifecycle.js';
// A TYPE ONLY, which is what keeps it on this barrel: `flatFields.ts` binds the
// native library, and main reads its answers without ever calling it.
export type { FlatFieldCandidate } from './flatFields.js';
// TYPES ONLY, and the rule is sharper here than for the line above:
// `ocrRecognise.ts` instantiates 2.8 MB of Tesseract on its first call, and the
// recognition itself runs in the engine host. Main composes the reader and passes
// the answers through, so it needs the shapes and nothing else.
export type {
  OcrRequest,
  RecognisedLine,
  RecognisedPage,
  RecognisedWord,
  RecognitionRequest,
} from './ocrRecognise.js';
// THE SCOPE, NOT THE REQUEST. `HandwritingRequest` carries the model directory,
// which only the composition root supplies — and the type it supplies it to is
// `HostHandwritingReader`, already on this barrel.
export type { HandwritingScope } from './ocrHandwriting.js';
// ON THE BARREL AS A VALUE, unlike the other two recognisers, and that IS the
// decision: this one executes in `main`, so main imports and calls it. It binds
// no engine — `fetch`, and `pageTransform` from shared — so `proof:kernelload`'s
// property is untouched (ADR-0052's 2026-09-12 addition).
export {
  AZURE_API_VERSION,
  AzureRecognitionRefused,
  type AzureCredentials,
  type AzureRefusal,
  type AzureRequest,
  recogniseThroughAzure,
} from './ocrAzure.js';
export type { SessionAssets } from './host/remoteEngine.js';
export type { SessionsByWriter } from './engineSeam.js';
export { remoteMupdfWriter } from './host/remoteWriter.js';
export type { RemoteMupdfWriter } from './host/remoteWriter.js';
// MAIN'S SIDE OF THE SECOND HOST, and it is on THIS barrel rather than behind
// `@monstera/kernel/pdfium` — which is the split ADR-0026 clause 2 is about, so
// the reason is worth stating. `remotePdfium.ts` and `pdfiumChannels.ts` name
// `pdfiumFfi.ts` in neither their imports nor their types: one builds messages
// and the other declares schemas, and the engine is at the far end of a pipe.
// The subpath exists to keep `koffi` out of main's graph, and nothing here loads
// it — `proof:kernelload` is what says so rather than this comment.
export {
  ENGINE_TEXT_OBJECTS_MAX,
  type PdfiumChannels,
  pdfiumChannels,
} from './host/pdfiumChannels.js';
export {
  type PdfiumArea,
  type PdfiumTransfer,
  remotePdfiumPageObjects,
  remotePdfiumRenderPage,
  remotePdfiumTextRuns,
  remotePdfiumWriter,
} from './host/remotePdfium.js';
// THE GROUPING, and it is on the BARREL rather than behind `pdfium.ts` because
// it binds no engine: it takes runs and answers lines, and `proof:kernelload`'s
// rule is about what a specifier LOADS. Main is its one caller — the
// composition point that feeds `document.textLines` — which is what ADR-0049's
// *does its output reach any consumer other than a dialog?* is asked of.
export { type EditableLine, type GroupableRun, groupIntoLines } from './textLines.js';
export type { RegionRequest } from './pageSnapshot.js';
export {
  EngineCallFailed,
  EngineSessionGone,
  type RemoteSessions,
  type SessionArea,
  UnknownRemoteSession,
  createRemoteSessions,
  remoteMupdfAnnotations,
  remoteMupdfExecution,
  remoteMupdfGeometry,
  remoteMupdfDestinations,
  remoteMupdfDuplicateReport,
  remoteMupdfFlatFields,
  remoteMupdfFormFields,
  remoteMupdfLayers,
  remoteMupdfHandwriting,
  remoteMupdfOcr,
  remoteMupdfPageLinks,
  remoteMupdfPageText,
} from './host/remoteEngine.js';
export {
  type CanonicalPath,
  type FileIdentity,
  isSameDocument,
  readFileIdentity,
} from './documentIdentity.js';
export {
  DocumentBusyError,
  type DocumentContext,
  type BytesWriter,
  DocumentNotOpenError,
  type EngineSupervisor,
  DocumentService,
  type DocumentTeardown,
  type IdentityReader,
  type OpenOutcome,
  type CommandWriter,
  type RangeOutcome,
  type RangeReader,
  type SaveWriter,
  type Versioned,
  type WriteTargetVerdict,
  type CopyTargetVerdict,
} from './documentService.js';
export { readDocumentRange } from './documentRanges.js';
export {
  type AtomicWriteFailure,
  type AtomicWriteSurface,
  RENAME_BACKOFF_MS,
  atomicWrite,
} from './atomicWrite.js';
export { nodeFileSurface, siblingNames } from './fileSurface.js';
export {
  type SaveDependencies,
  type SaveFileNames,
  type CopyOutcome,
  type SaveOutcome,
  type WriteTargetCheck,
  type SplitOutcome,
  type SplitPart,
  saveDocument,
  writeDocumentCopy,
  writeDocumentSplit,
} from './savePipeline.js';
export { TOKEN_BYTES, type TokenBytesSource, cryptoBytes, mintToken } from './token.js';
export {
  PROBE_CODE_MAX_CHARS,
  PROBE_CODE_PATTERN,
  type ContainmentProbePaths,
  type ContainmentProbeRequest,
  type ContainmentReport,
  type ContainmentVerdict,
  type IntegrityReading,
  type JobLimitsReading,
  type NegativeTarget,
  type ProbeOutcome,
  type ProbeTarget,
  type ProcessContainmentVerdict,
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
  classifyContainment,
  classifyProcessContainment,
  outcomeForErrorCode,
  probeCode,
  probeContainment,
  probePath,
} from './host/containment.js';
export {
  type HostRuntime,
  type HostRuntimeOptions,
  type HostRuntimeTransport,
  type HostTermination,
  createHostRuntime,
} from './host/runtime.js';
export {
  type HostClient,
  type HostClientOptions,
  HostConnectionLost,
  createHostClient,
} from './host/client.js';
// THE TEXT SUBSTRATE'S PURE HALF, on the main surface rather than `/engine`:
// parsing, searching and scoring import no engine and bind no native library,
// so a consumer that holds a `PageText` needs no reason to reach for `/engine`
// (ADR-0026). Reading one from a document does, and `readPageText` is there.
export { type TextLayer, type TextLayerLine, textLayerOf } from './textLayer.js';
export { type PageKind, pageKindOf } from './pageKind.js';
export { countPageWords } from './wordCount.js';
export {
  type DisplayedRect,
  type PageText,
  type TextBlock,
  type TextLine,
  STEXT_OPTIONS,
  STEXT_OPTION_STRING,
  linesOf,
  parsePageText,
  plainTextOf,
} from './textStructure.js';
export { type TextAccuracy, scoreAgainstTruth } from './textAccuracy.js';
// THE TYPES ONLY, for the reason above: a shape a consumer holds needs no
// engine, and `readPageLinks` — which does — stays behind `/engine`.
export type { LinkBounds, PageLink } from './pageLinks.js';
export type { Destination } from './destinations.js';
// TYPE ONLY, for the reason above. `readAnnotations` reaches MuPDF and is on
// `@monstera/kernel/engine`; the listed shape is a plain object.
export type { AnnotationKindName, ListedAnnotation } from './pageAnnotations.js';
// TYPE ONLY, for `ListedAnnotation`'s reason: `readFormFields` reaches MuPDF
// and is on `@monstera/kernel/engine`; the listed shape is a plain object.
export type { ListedField } from './formFields.js';
export type { Layer, PriorLayerVisibility } from './layers.js';
// TYPE ONLY. `findDuplicatePages` itself is on `@monstera/kernel/engine` with
// every other value that binds the native library (ADR-0026); the group shape
// is a plain object and a consumer naming it must not pull MuPDF in.
export type { DuplicatePageGroup } from './pageDuplicates.js';
export { type SearchOptions, type TextMatch, findInPages, lineOf } from './textSearch.js';
// A VALUE, from this barrel, and it is the first adapter that may be
// ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
// The rule this file states about `mupdfWriter` — *every value whose module
// graph binds a native library lives behind `@monstera/kernel/engine`* — is
// satisfied rather than excepted: `pdfLibWriter.ts` imports `@cantoo/pdf-lib`,
// which is pure JavaScript, and nothing on its path reaches MuPDF or PDFium.
//
// So the check to run before adding anything beside this is the same one:
// follow the new module's imports and confirm none of them binds native code.
export { localPdfLibWriter, pdfLibWriter } from './pdfLibWriter.js';
export {
  applyWatermarkPages,
  captureWatermarkPages,
  invertWatermarkPages,
} from './pageWatermark.js';
// ON THE BARREL for `watermarkPages`' reason, and it is the first FORM command
// that may be: the other three route to MuPDF and live behind
// `@monstera/kernel/engine`. The import check this file states holds —
// `formFieldCreate.ts` reaches `@cantoo/pdf-lib`, the contract, `@monstera/shared`
// and `pdfLibSession.ts`, and none of those binds native code.
export {
  applyCreateFormField,
  captureCreateFormField,
  invertCreateFormField,
} from './formFieldCreate.js';
export {
  BACKGROUND_MARKER,
  applySetPageBackground,
  captureSetPageBackground,
  invertSetPageBackground,
} from './pageBackground.js';
// ON THE BARREL and not the `/engine` subpath, for `watermarkPages`' reason:
// this routes to a byte-image writer that runs in main, and nothing routed to
// pdf-lib may sit behind the subpath that binds the native library (ADR-0039).
export {
  applyInsertImagePage,
  captureInsertImagePage,
  invertInsertImagePage,
} from './pageImage.js';
// ON THE BARREL for `insertImagePage`'s reason two lines up, and the import
// check it names holds: `pageToc.ts` imports `@cantoo/pdf-lib` and the contract,
// and nothing on that path reaches MuPDF or PDFium.
export {
  applyGenerateToc,
  captureGenerateToc,
  fit,
  invertGenerateToc,
  rowsPerPage,
  shownPageNumber,
  tocPageCount,
} from './pageToc.js';
export {
  applyBatesNumberPages,
  applyHeaderFooterPages,
  batesIdentifier,
  captureBatesNumberPages,
  captureHeaderFooterPages,
  invertBatesNumberPages,
  invertHeaderFooterPages,
  resolveStampTokens,
} from './pageStamp.js';
export { type PageScope, pagesOf } from './pageScope.js';
// ON THE BARREL, and it binds no engine: `node:crypto`, `node:fs`,
// `node:stream` and `fetch`. Its caller is `main`, which imports this file, and
// `proof:kernelload` measures what that import loads rather than trusting this
// comment.
export {
  DownloadRefused,
  type DownloadRefusal,
  type VerifiedDownload,
  downloadVerified,
} from './verifiedDownload.js';
// ON THE BARREL AND THE ENGINE HALF IS NOT. This module is data and two pure
// functions — the URLs, the digests and which tokenizer family each model needs
// — and main is what reads it, because main downloads. `ocrHandwriting.ts`, which
// loads an ONNX runtime, is reached only by the host entry (ADR-0026 clause 2).
export {
  HANDWRITING_HOSTS,
  HANDWRITING_MODELS,
  RUNTIME_ARTEFACTS,
  type HandwritingArtefact,
  type HandwritingModel,
  type TokenizerFamily,
  artefactsFor,
  totalBytes,
} from './handwritingArtefacts.js';
