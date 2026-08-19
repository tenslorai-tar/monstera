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
  type Failure,
  type Result,
  type StructuredError,
  ok,
  err,
  toStructuredError,
} from './result.js';
