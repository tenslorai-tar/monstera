// `MonsteraBridge` is deliberately NOT re-exported here. It lives in
// `@monstera/contract`, which both this package and the preload import; a
// re-export would give consumers a second name for one shape and a second place
// to look when it changes.
export { BridgeUnavailableError, createRendererClient } from './bridge.js';
export {
  type DocumentActions,
  type DocumentState,
  type DocumentStore,
  DocumentStores,
  createDocumentStore,
} from './documentStores.js';
