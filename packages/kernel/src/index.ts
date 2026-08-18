export { CapabilityRegistry, type HandleBytesSource, handlesEqual } from './capabilityRegistry.js';
export { type FileIdentity, isSameDocument, readFileIdentity } from './documentIdentity.js';
export {
  DocumentService,
  type DocumentTeardown,
  type IdentityReader,
  type OpenOutcome,
  type WriteTargetVerdict,
} from './documentService.js';
export { TOKEN_BYTES, type TokenBytesSource, cryptoBytes, mintToken } from './token.js';
