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
export { type Rgb, channels, contrast, luminance, onColor } from './colour.js';
export { type MessageKey, isDottedName, messageDomain, messageKey } from './messages.js';
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
