export {
  type Channel,
  type DeclaredOf,
  type FailureOf,
  INTERNAL_FAILURE,
  type InternalFailure,
  type ChannelMap,
  type ClientApi,
  type Handlers,
  type ParamsOf,
  type ResultOf,
  channel,
} from './channel.js';
export {
  type ChannelId,
  type ChannelParams,
  type ChannelResult,
  type Channels,
  type ContractClient,
  type ContractHandlers,
  // Invariant L11's mechanism. Exported so a caller can size its reads under
  // the bound rather than discover it as a refusal.
  MAX_RANGE_BYTES,
  // The recent list's cap, RESTATED in `apps/desktop` because this package may
  // not import that one. Exported so the case that holds the two together has
  // something to compare against — without it the agreement is a sentence in
  // this file's comment and nothing else, which is what the audit of
  // `87540a5..HEAD` found it to be.
  MAX_RECENT_ENTRIES,
  // NAMED BECAUSE THE KERNEL SEAM NOW READS IT TOO. ADR-0040's extension hands
  // a command's apply the outline as pre-read data, so this shape has a reader
  // that is not a channel; a second declaration there would be two of one thing.
  type OutlineEntry,
  outlineEntrySchema,
  channelIds,
  channels,
} from './channels.js';
export { createClient, wrapHandler, wrapHandlers } from './boundary.js';
export { BRIDGE_KEY, type MonsteraBridge } from './bridge.js';
export {
  ENGINE_HOST_FRAME_MAX_BYTES,
  ENGINE_HOST_MAX_IN_FLIGHT,
  HOST_CORRELATION_ID_MAX_CHARS,
  type HostRequest,
  type HostResponse,
  LARGEST_INTENT_PAYLOAD_BYTES,
  hostRequestSchema,
  hostResponseSchema,
} from './hostProtocol.js';
export {
  FRAME_HEADER_BYTES,
  FRAME_LENGTH_CEILING,
  FrameDecoder,
  type FrameViolation,
  encodeFrame,
} from './frame.js';
export { type Incident, IncidentLog, type IncidentSink } from './incident.js';
export {
  type Command,
  type CommandKind,
  type CommandOfKind,
  batesNumberPagesSchema,
  commandSchema,
  // EVERY MEMBER, not just the first. `rotatePagesSchema` was exported alone
  // because one caller wanted one schema; the engine host's channels need the
  // MuPDF-routed subset as a union of its own, and a subset cannot be built
  // from a union whose members are unreachable
  // ([ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
  cropPagesSchema,
  deletePagesSchema,
  duplicatePageSchema,
  headerFooterPagesSchema,
  insertBlankPageSchema,
  MAX_IMAGE_BYTES,
  type RenderableCommand,
  insertImagePageSchema,
  movePageSchema,
  renderableCommandSchema,
  resizePagesSchema,
  rotatePagesSchema,
  setLayerVisibilitySchema,
  setPageBackgroundSchema,
  setPageTransitionSchema,
  swapPagesSchema,
  watermarkPagesSchema,
} from './commands.js';
export {
  docIdSchema,
  docVersionSchema,
  envelopeSchema,
  fileHandleSchema,
  structuredErrorSchema,
} from './schemas.js';
