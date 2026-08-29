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
// §7's registries (ADR-0029). A feature is finished when it is REGISTERED, so
// these are the seam a feature lands in — and the projections below are the
// only way a surface may learn what to show.
export { CommandRegistry, type CommandContext, type UiCommand } from './registries/commands.js';
export {
  DialogNotRegistered,
  DialogPropsRejected,
  DialogRegistry,
  type DialogEntry,
} from './registries/dialogs.js';
export {
  SECTION_IDS,
  type MenuContext,
  type Placement,
  type SectionId,
  type SurfaceId,
} from './registries/placement.js';
export {
  SettingsRegistry,
  type SettingCategory,
  type SettingDefinition,
} from './registries/settings.js';
export { SettingsStore } from './settingsStore.js';
export { DialogHost, type DialogHostProps, useDialogHost } from './surfaces/DialogHost.js';
export {
  type Dispatch,
  type KeyChord,
  chordOf,
  dispatchChord,
  shortcutsFor,
} from './surfaces/shortcuts.js';
export {
  ShortcutConflict,
  type OrderedEntry,
  type RibbonEntry,
  type RibbonGroup,
  type RibbonSection,
  contextMenuModel,
  normaliseChord,
  paletteModel,
  quickToolbarModel,
  ribbonModel,
  shortcutMapOf,
  startScreenModel,
} from './surfaces/projections.js';
