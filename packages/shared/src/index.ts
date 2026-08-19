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
