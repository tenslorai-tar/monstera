export { CapabilityRegistry, type HandleBytesSource, handlesEqual } from './capabilityRegistry.js';
export {
  type Apply,
  type ByteImage,
  type EngineWriter,
  type Invert,
  type MupdfSession,
  type PdfiumSession,
  type WriterSession,
  type WriterShape,
  type WriterShapeOf,
} from './engineSeam.js';
export { mupdfWriter, withDocument } from './mupdfWriter.js';
export {
  type PriorPageRotation,
  type PriorRotation,
  applyRotatePages,
  captureRotatePages,
  invertRotatePages,
  snapRotation,
} from './rotatePages.js';
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
  UnregisteredWriterError,
  type WriterRegistry,
} from './commandBus.js';
export {
  type CommandExecution,
  type CommandSpec,
  type CommandSpecs,
  type DeclaredSpecs,
  type Invertibility,
  type KindsRoutedTo,
  type RegisteredWriter,
  type Reproducibility,
  type WriterBinding,
  type WriterOf,
  type WriterOfRecord,
  commandSpecs,
  declaredSpecs,
  localMupdfExecution,
} from './commandSpecs.js';
export { localMupdfWriter } from './localEngine.js';
export {
  ENGINE_PATH_MAX_CHARS,
  ENGINE_SESSION_ID_MAX_CHARS,
  type EngineChannels,
  type EngineFailureCode,
  engineChannels,
} from './host/engineChannels.js';
export {
  type HostFilesystem,
  type HostSession,
  type HostSessions,
  createEngineHandlers,
} from './host/engineHandlers.js';
export {
  EngineOpenFailed,
  EngineSerialiseFailed,
  EngineSerialiseMismatch,
  type SessionArea,
  type SessionAreaSurface,
  remoteMupdfLifecycle,
} from './host/remoteLifecycle.js';
export {
  EngineCallFailed,
  EngineSessionGone,
  type RemoteSessions,
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
  type ContainmentProbeRequest,
  type ContainmentReport,
  type ContainmentVerdict,
  type NegativeTarget,
  type ProbeOutcome,
  type ProbeTarget,
  classifyContainment,
  outcomeForErrorCode,
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
