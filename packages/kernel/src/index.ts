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
  EngineWriter,
  Invert,
  MupdfSession,
  PdfiumSession,
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
  CheckpointRestoreNotBuiltError,
  CommandBus,
  type Executed,
  type Undone,
  MissingWriterSessionError,
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
  type HostContainmentProbe,
  type HostFilesystem,
  type HostSession,
  type HostSessions,
  createEngineHandlers,
} from './host/engineHandlers.js';
export {
  EngineOpenFailed,
  EngineSerialiseFailed,
  EngineSerialiseMismatch,
  type RemoteMupdfLifecycle,
  type SessionAreaSurface,
  remoteMupdfLifecycle,
} from './host/remoteLifecycle.js';
export type { SessionsByWriter } from './engineSeam.js';
export { remoteMupdfWriter } from './host/remoteWriter.js';
export {
  EngineCallFailed,
  EngineSessionGone,
  type RemoteSessions,
  type SessionArea,
  UnknownRemoteSession,
  createRemoteSessions,
  remoteMupdfExecution,
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
  type Versioned,
  type WriteTargetVerdict,
} from './documentService.js';
export { TOKEN_BYTES, type TokenBytesSource, cryptoBytes, mintToken } from './token.js';
export {
  PROBE_CODE_MAX_CHARS,
  PROBE_CODE_PATTERN,
  type ContainmentProbePaths,
  type ContainmentProbeRequest,
  type ContainmentReport,
  type ContainmentVerdict,
  type NegativeTarget,
  type ProbeOutcome,
  type ProbeTarget,
  classifyContainment,
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
