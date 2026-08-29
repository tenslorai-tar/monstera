// `MonsteraBridge` is deliberately NOT re-exported here. It lives in
// `@monstera/contract`, which both this package and the preload import; a
// re-export would give consumers a second name for one shape and a second place
// to look when it changes.
export { BridgeUnavailableError, createRendererClient } from './bridge.js';
// The message resolver (ADR-0005's Lingui, ADR-0029 Decision 6's MessageKey).
export { MessageMissing, activateCatalogue, i18n, resolve } from './i18n.js';
// The renderer's byte-range read path (ADR-0031). PDF.js asks; these answer.
export { DocumentRangeTransport, type OnVersionMoved } from './documentTransport.js';
export { type DocumentView, openDocumentView } from './documentView.js';
export { type RasterisedPage, renderPage } from './renderPage.js';
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
  // The only way to build an entry, and the only place the schema-to-component
  // tie is erased — see EEEEE-2 in that module.
  declareDialog,
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
export { StartScreen, type StartScreenProps } from './surfaces/StartScreen.js';
// The first registered command, and the catalogue its title is resolved from.
export { openDocumentCommand } from './commands/openDocument.js';
export { EN } from './messages/en.js';
export { App, type AppProps } from './App.js';
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
