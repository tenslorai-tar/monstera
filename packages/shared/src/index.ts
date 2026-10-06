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
  EDIT_STEPS,
  type EditStep,
  type Failure,
  type FailureDetails,
  type InternalFailure,
  PDFIUM_PASSWORD_ERROR,
  type Result,
  type StructuredError,
  INTERNAL_FAILURE,
  ok,
  err,
  toStructuredError,
} from './result.js';
export {
  HIGH_CONTRAST_THEME,
  type Rgb,
  channels,
  channelsWithAlpha,
  contrast,
  luminance,
  onColor,
  onColorRounded,
  textContrastFloor,
} from './colour.js';
export { ACCENT_LIGHTS, type LightTurn, NO_TURN, TURNED_STRENGTH, turnFor, turnLight } from './lights.js';
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
// HERE FOR `findInLines`' REASON, one file over: the browser shim answers
// `document.pageWordCount` and may not import the kernel, so a counting rule in
// the kernel would be re-stated in the shim and the two would agree until one
// of them changed — which is exactly what happened to the matching rule above.
export { type TextToken, type WordCount, countWords, tokensOf, wordsOf } from './wordCount.js';
export { EDGE_HANDLE_WIDTH, MINIMUM_WINDOW, PAGE_AREA_MIN_WIDTH, minimumWindowFor } from './windowSize.js';
// A DOCUMENT'S PASSWORD AS MAIN HOLDS IT, here because a kernel type carries it and the holder is in `apps/desktop`
// (ADR-0171's addendum).
export { HELD_PASSWORD_REDACTION, HeldPassword } from './heldPassword.js';
// WHERE A KEY MAY GO when a person typed the address, once: the model list, the chat, the recogniser, and the hosts
// whose own answers name the next address (DocuSign's base URI, a cloud upload session) all take it.
export { type AddressedService, SERVICE_DOMAINS, hostWithin, onOrigin, serviceOrigin } from './serviceAddress.js';
export { type AlignmentStep, type LineChange, alignSequences, comparableLine, diffLines } from './lineDiff.js';
export {
  type CompareAnnotation,
  type CompareBox,
  type CompareLine,
  type ComparePage,
  type CompareRaster,
  type PageAlignment,
  type PageSignature,
  type PairChange,
  type WalkedWordLine,
  CHANGE_TEXT_LIMIT,
  alignPages,
  comparePair,
  needsPicture,
  pairWordBoxes,
  signPage,
} from './pageCompare.js';
// WHICH RUNS AN EDITED LINE REWRITES, once. The kernel's `editTextBlock` owns
// the write and the renderer only shows the words; neither may carry a second
// opinion about which object a typed character belongs to (ADR-0096).
export { type LineRun, type RunReplacement, lineText, replacementsForLine } from './lineEdit.js';
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
  snapRotation,
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
// THE REMAP CONTRACT, moved here 2026-09-05 from `packages/kernel`. It is pure
// arithmetic over two numbers and a page count, and its one real consumer is
// the renderer's back-stack — which `eslint.config.js` gives the reach
// `['shared', 'contract']`, so it could not import the engine subpath these
// lived on. The kernel re-exports them, so the permutation a tree rewrite is
// built from and the one a consumer asks about are the same function (B3a).
export {
  type PriorPageOrder,
  keptPermutation,
  movePermutation,
  remapPageIndex,
  remapPageIndexAfterDelete,
  swapPermutation,
} from './pageRemap.js';
