// `MonsteraBridge` is deliberately NOT re-exported here. It lives in
// `@monstera/contract`, which both this package and the preload import; a
// re-export would give consumers a second name for one shape and a second place
// to look when it changes.
export { BridgeUnavailableError, createRendererClient } from './bridge.js';
// The Stage 0 primitive set (§10.4). A screen composed of anything other than
// primitives and tokens is not done, so these are exported as the surface a
// feature builds from — never as a starting point to copy.
export { Button, type ButtonProps } from './primitives/Button.js';
export { Dialog, type DialogProps } from './primitives/Dialog.js';
export { IconButton, type IconButtonProps } from './primitives/IconButton.js';
export { Input, type InputProps } from './primitives/Input.js';
export { ICON_SIZES, type IconSize } from './primitives/iconSize.js';
export { useOnColor } from './primitives/useOnColor.js';
export {
  type DocumentActions,
  type DocumentState,
  type DocumentStore,
  DocumentStores,
  createDocumentStore,
} from './documentStores.js';
