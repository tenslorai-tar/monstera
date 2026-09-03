// `brandValue` is deliberately not re-exported. Each branded type owns a
// constructor that validates before branding, so there is no general-purpose
// way to assert a value into a space it does not belong to.
export type { Brand } from './brand.js';
export {
  type DocId,
  type DocVersion,
  type FileHandle,
  asDocId,
  asDocVersion,
  asFileHandle,
} from './ids.js';
export {
  type DeclaredFailure,
  type Failure,
  type InternalFailure,
  type Result,
  type StructuredError,
  INTERNAL_FAILURE,
  ok,
  err,
  toStructuredError,
} from './result.js';
export { type Rgb, channels, contrast, luminance, onColor, onColorRounded } from './colour.js';
export { type MessageKey, isDottedName, messageDomain, messageKey } from './messages.js';
// The matching rule, once. Both the kernel's search and the browser shim's
// answer to `document.searchPage` take it from here — the shim may not import
// the kernel, and a shim with its own rule agrees with the kernel until the day
// it does not (B3a).
export {
  type CompiledQuery,
  type LineMatch,
  type Normalisation,
  type QueryProblem,
  type TextMatchOptions,
  MATCH_TEXT_WINDOW,
  compileQuery,
  findInLines,
  normalised,
} from './textMatch.js';
// The five coordinate spaces and the ONE thing permitted to convert between
// them (invariant L3). The point constructors are exported and `Brand`'s
// `brandValue` is not, deliberately: a caller may build a point in a space, and
// no caller may assert a point INTO one.
export {
  type Box,
  type FitzPoint,
  type PageTransform,
  type PdfPoint,
  type RasterPoint,
  type Rotation,
  type ViewportPoint,
  type XObjectPoint,
  fitzPoint,
  fromFitz,
  fromRaster,
  fromXObject,
  normaliseRotation,
  pageTransform,
  pdfPoint,
  rasterPoint,
  toFitz,
  toPdf,
  toRaster,
  toViewport,
  viewportPoint,
  xObjectPoint,
} from './geometry.js';
