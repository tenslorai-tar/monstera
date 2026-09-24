import {
  AI_PROVIDER_KEY_SETTING_IDS,
  type AnnotationRect,
  ANTHROPIC_KEY_SETTING_ID,
  AZURE_KEY_SETTING_ID,
  CHAT_HISTORY_SETTING_ID,
  type ContractClient,
  DOCUSIGN_INTEGRATION_KEY_SETTING_ID,
  type SecretSettingId,
  type FieldFill,
  type MeasureScale,
  type RenderableCommand,
} from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';

import {
  applyDocumentCommand,
  imagePagesFor,
  placeImage,
  signDocument,
  snapshotRegion,
  findCommand,
  movePageCommand,
  showPanelCommand,
  showSearchPanel,
  fitCommand,
  deletePageCommand,
  cropPagesCommand,
  protectDocumentCommand,
  applyRedactionsCommand,
  redactMatchesCommand,
  sanitizeDocumentCommand,
  signDocumentCommand,
  signaturesCommand,
  docusignRetrieveCommand,
  docusignSendCommand,
  watermarkPagesCommand,
  headerFooterCommand,
  batesNumberCommand,
  saveCopyCommand,
  exportFormDataFdfCommand,
  exportFormDataJsonCommand,
  exportFormDataXfdfCommand,
  importFormDataFdfCommand,
  importFormDataJsonCommand,
  importFormDataXfdfCommand,
  detectFlatFieldsCommand,
  EDIT_TEXT_TOOL_ID,
  commitTextBlock,
  editTextCommand,
  promoteTextOnPage,
  reportProblem,
  editPageObjectCommand,
  pageTransitionCommand,
  pageBackgroundCommand,
  resizePagesCommand,
  deskewPagesCommand,
  generateTocCommand,
  insertImageCommand,
  extractPagesCommand,
  insertFromPdfCommand,
  mergeDocumentCommand,
  replacePageCommand,
  importPageAsLayerCommand,
  splitDocumentCommand,
  exportPageImagesCommand,
  exportLayoutTextCommand,
  exportExcelCommand,
  printCommand,
  emailCommand,
  exportPdfaCommand,
  optimizeCommand,
  exportPowerPointCommand,
  exportTextCommand,
  exportWordCommand,
  deletePagesCommand,
  duplicatePageCommand,
  findDuplicatePagesCommand,
  insertBlankPageCommand,
  rotatePageCommand,
  closeTabCommand,
  closeOthersCommand,
  openSideBySideCommand,
  saveCommand,
  saveDocument,
  undoCommand,
  redoCommand,
  zoomCommand,
} from './commands/documentCommands.js';
import { DEFAULT_ZOOM, type ZoomMode } from './zoom.js';
import {
  commandPaletteCommand,
  toggleDarkPageCommand,
  toggleGridCommand,
  toggleLoupeCommand,
  toggleSplitViewCommand,
  toggleRulersCommand,
} from './commands/viewCommands.js';
import {
  layoutModeCommands,
  toggleContextPanelCommand,
  togglePanelCommand,
  toggleQuickToolbarCommand,
} from './commands/chromeCommands.js';
import {
  CONTEXT_PANEL_OPEN_SETTING,
  CONTEXT_PANEL_TAB_SETTING,
  LAYOUT_MODE_SETTING,
} from './settings/layout.js';
import type { AskAssistant, AssistantRequest } from './assistantRequest.js';
import {
  assistantSelectionCommands,
  draftReplyCommand,
  summariseCommentsCommand,
  openAssistantCommand,
} from './commands/assistantCommands.js';
import { CommandPalette } from './CommandPalette.js';
import { ComparePane } from './ComparePane.js';
import { goToCommand, historyCommand, pageMoveCommand } from './commands/navigationCommands.js';
import { syncConversation } from './chatHistorySync.js';
import { DocumentStores } from './documentStores.js';
import { Thumbnails } from './Thumbnails.js';
import { StatusBar } from './surfaces/StatusBar.js';
import { LinksPanel } from './LinksPanel.js';
import { DestinationsPanel } from './DestinationsPanel.js';
import { LayersPanel } from './LayersPanel.js';
import { AnnotationsPanel } from './AnnotationsPanel.js';
import { FormsPanel } from './FormsPanel.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { FindBar } from './FindBar.js';
import type { SearchHighlight } from './searchHighlight.js';
import { type RunningTask, trackerOver } from './runningTask.js';
import { checkSpellingCommand } from './commands/checkSpelling.js';
import {
  enhanceScansCommand,
  exportSearchableCommand,
  straightenScansCommand,
  recogniseTextCommand,
} from './commands/recogniseText.js';
import { featureShortcutCommands } from './commands/featureShortcuts.js';
import { type OpenProblem, openDocument, openDocumentCommand } from './commands/openDocument.js';
import { revealLogCommand } from './commands/revealLog.js';
import { donateCommand } from './commands/donate.js';
import { showAboutCommand } from './commands/showAbout.js';
import { showSettingsCommand } from './commands/showSettings.js';
import { SETTINGS_DIALOG } from './dialogs/settings.js';
import { showWordCountCommand } from './commands/showWordCount.js';
import { inspectPageStructureCommand } from './commands/inspectPageStructure.js';
import { accessibilityCheckCommand } from './commands/accessibilityCheck.js';
import { ACCESSIBILITY_DIALOG } from './dialogs/accessibilityCheck.js';
import { placeBarcode, readBarcodesCommand } from './commands/barcodes.js';
import { ABOUT_DIALOG } from './dialogs/about.js';
import { DONATE_DIALOG } from './dialogs/donate.js';
import { AI_SETUP_DIALOG } from './dialogs/aiSetup.js';
import { CLOUD_DIALOG } from './dialogs/cloudStorage.js';
import { CLOUD_OUTCOME_DIALOG } from './dialogs/cloudOutcome.js';
import { cloudStorageCommand, saveBackCommand } from './commands/cloudStorage.js';
import { aiSetupCommand } from './commands/aiSetup.js';
import { AI_SETUP_AT_START_SETTING } from './settings/ai.js';
import { KEYBOARD_SHORTCUTS_DIALOG } from './dialogs/keyboardShortcuts.js';
import { WORD_COUNT_DIALOG } from './dialogs/wordCount.js';
import { PAGE_STRUCTURE_DIALOG } from './dialogs/pageStructure.js';
import { SPELL_CHECK_DIALOG } from './dialogs/spellCheck.js';
import { COMPARE_DOCUMENTS_DIALOG, COMPARE_RESULT_DIALOG } from './dialogs/compareDocuments.js';
import { compareDocumentsCommand } from './commands/compareDocuments.js';
import { OCR_DIALOG } from './dialogs/ocr.js';
import { TRANSLATE_PAGE_DIALOG } from './dialogs/translatePage.js';
import { translatePageCommand } from './commands/translatePage.js';
import { OCR_OUTCOME_DIALOG } from './dialogs/ocrOutcome.js';
import { ENHANCE_OUTCOME_DIALOG } from './dialogs/enhanceOutcome.js';
import { SCAN_OUTCOME_DIALOG } from './dialogs/scanOutcome.js';
import { COMMAND_PROBLEM_DIALOG, COMMAND_PROBLEM_DIALOG_ID } from './dialogs/commandProblem.js';
import { CROP_PAGES_DIALOG } from './dialogs/cropPages.js';
import { WATERMARK_PAGES_DIALOG } from './dialogs/watermarkPages.js';
import { HEADER_FOOTER_DIALOG } from './dialogs/headerFooter.js';
import { BATES_NUMBER_DIALOG } from './dialogs/batesNumber.js';
import { PAGE_TRANSITION_DIALOG } from './dialogs/pageTransition.js';
import { RESIZE_PAGES_DIALOG } from './dialogs/resizePages.js';
import { GENERATE_TOC_PROBLEM_DIALOG } from './dialogs/generateTocProblem.js';
import { FLAT_FIELDS_DIALOG } from './dialogs/flatFields.js';
import { EDIT_PAGE_OBJECT_DIALOG } from './dialogs/editPageObject.js';
import { IMPORT_FORM_DATA_PROBLEM_DIALOG } from './dialogs/importFormDataProblem.js';
import { IMPORT_ANNOTATIONS_PROBLEM_DIALOG } from './dialogs/importAnnotationsProblem.js';
import {
  exportAnnotationsFdfCommand,
  exportAnnotationsJsonCommand,
  exportAnnotationsXfdfCommand,
  importAnnotationsFdfCommand,
  importAnnotationsJsonCommand,
  importAnnotationsXfdfCommand,
  pasteAnnotationsCommand,
} from './commands/annotationData.js';
import { INSERT_IMAGE_PROBLEM_DIALOG } from './dialogs/insertImageProblem.js';
import { MARKDOWN_IMPORT_PROBLEM_DIALOG } from './dialogs/markdownImportProblem.js';
import { OPEN_FROM_URL_DIALOG } from './dialogs/openFromUrl.js';
import { CAMERA_CAPTURE_DIALOG } from './dialogs/cameraCapture.js';
import { URL_OPEN_PROBLEM_DIALOG } from './dialogs/urlOpenProblem.js';
import { openFromUrlCommand } from './commands/openFromUrl.js';
import { editPageExternallyCommand } from './commands/editPageExternally.js';
import {
  type OpenedDocument,
  appendMarkdownCommand,
  newFromCaptureCommand,
  newFromCsvCommand,
  newFromImagesCommand,
  newFromMarkdownCommand,
} from './commands/importMarkdown.js';
import { EXTRACT_PAGES_DIALOG } from './dialogs/extractPages.js';
import { SPLIT_DOCUMENT_DIALOG } from './dialogs/splitDocument.js';
import { EXPORT_PAGE_IMAGES_DIALOG } from './dialogs/exportPageImages.js';
import { EXPORT_EXCEL_DIALOG } from './dialogs/exportExcel.js';
import { SERVICE_REFUSED_DIALOG } from './dialogs/serviceRefused.js';
import { OPTIMIZE_DIALOG } from './dialogs/optimize.js';
import { PDFA_REMOVALS_DIALOG } from './dialogs/pdfaRemovals.js';
import { PAGE_BARCODES_DIALOG } from './dialogs/pageBarcodes.js';
import { PLACE_BARCODE_DIALOG } from './dialogs/placeBarcode.js';
import { PRINT_DIALOG } from './dialogs/print.js';
import { EXPORT_WORD_DIALOG } from './dialogs/exportWord.js';
import { INSERT_FROM_PDF_DIALOG } from './dialogs/insertFromPdf.js';
import { MERGE_DOCUMENT_DIALOG } from './dialogs/mergeDocument.js';
import { REPLACE_PAGE_DIALOG } from './dialogs/replacePage.js';
import { IMPORT_PAGE_AS_LAYER_DIALOG } from './dialogs/importPageAsLayer.js';
import { REIMPORT_EXTERNAL_EDIT_DIALOG } from './dialogs/reimportExternalEdit.js';
import { EXTERNAL_EDIT_PROBLEM_DIALOG } from './dialogs/externalEditProblem.js';
import { MERGE_DOCUMENT_NONE_DIALOG } from './dialogs/mergeDocumentNone.js';
import { LINK_ADDRESS_DIALOG, LINK_PAGE_DIALOG } from './dialogs/annotationLink.js';
import {
  DOCUMENT_PASSWORD_DIALOG,
  DOCUMENT_PASSWORD_DIALOG_ID,
  DOCUMENT_PASSWORD_RESULT,
} from './dialogs/documentPassword.js';
import { PROTECT_DOCUMENT_DIALOG } from './dialogs/protectDocument.js';
import { APPLY_REDACTIONS_DIALOG } from './dialogs/applyRedactions.js';
import { REDACT_MATCHES_DIALOG } from './dialogs/redactMatches.js';
import { SANITIZE_DOCUMENT_DIALOG } from './dialogs/sanitizeDocument.js';
import { SIGN_DOCUMENT_DIALOG } from './dialogs/signDocument.js';
import { SIGN_PROBLEM_DIALOG } from './dialogs/signProblem.js';
import { DOCUSIGN_NOTICE_DIALOG } from './dialogs/docusignNotice.js';
import { DOCUSIGN_SEND_DIALOG } from './dialogs/docusignSend.js';
import { SIGNATURES_DIALOG } from './dialogs/signatures.js';
import { ANNOTATION_NOTE_DIALOG } from './dialogs/annotationNote.js';
import { ANNOTATION_EDIT_DIALOG } from './dialogs/annotationEdit.js';
import { ANNOTATION_REPLY_DIALOG } from './dialogs/annotationReply.js';
import { CALLOUT_DIALOG } from './dialogs/callout.js';
import { TYPEWRITER_DIALOG } from './dialogs/typewriter.js';
import { ANNOTATION_TEXT_DIALOG } from './dialogs/annotationText.js';
import { FORM_FIELD_DIALOGS } from './dialogs/formField.js';
import { DELETE_PAGES_DIALOG } from './dialogs/deletePages.js';
import { DUPLICATE_PAGES_DIALOG } from './dialogs/duplicatePages.js';
import { HISTORY_TRIMMED_DIALOG } from './dialogs/historyTrimmed.js';
import { SETTINGS_PROBLEM_DIALOG } from './dialogs/settingsProblem.js';
import { persistSettings } from './settingsSync.js';
import { SAVE_PROBLEM_DIALOG } from './dialogs/saveProblem.js';
import {
  CLOSE_UNSAVED_DIALOG,
  CLOSE_UNSAVED_DIALOG_ID,
  CLOSE_UNSAVED_RESULT,
} from './dialogs/closeUnsaved.js';
import { useDocumentView } from './useDocumentView.js';
import { CLOSE_LABEL, SPLIT_SECOND_LABEL, TOAST_DISMISS } from './messages/en.js';
import { annotationTools } from './annotations/annotationTools.js';
import type { AnnotationStyle } from './annotations/annotationStyle.js';
import { styleFrom } from './annotations/annotationStyle.js';
import { stickyNoteCommand } from './annotations/pointTools.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { SELECT_TOOL_ID } from './annotations/selectTool.js';
import {
  deleteSelectionCommand,
  editSelectionCommand,
  replySelectionCommand,
  copyAnnotationsCommand,
  nudgeSelectionCommands,
  selectionPropertiesCommand,
  shapeToolCommands,
} from './commands/annotationCommands.js';
import { CommandRegistry, type CommandContext } from './registries/commands.js';
import { ToolRegistry } from './registries/tools.js';
import { DialogRegistry } from './registries/dialogs.js';
import { DialogHost, useDialogHost } from './surfaces/DialogHost.js';
import {
  HIGH_CONTRAST_QUERIES,
  THEME_SETTING,
  type Theme,
  applyAppearance,
  highContrastWanted,
} from './settings/appearance.js';
import { ACCENT_SETTING, applyAccent } from './settings/accent.js';
import {
  DARK_PAGE_SETTING,
  GRID_SETTING,
  LOUPE_SETTING,
  RULERS_SETTING,
  RULER_UNIT_SETTING,
  SECOND_RENDERER_SETTING,
  SPLIT_VIEW_SETTING,
  applyDarkPage,
} from './settings/viewing.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_FONT_SIZE_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  IMAGE_PAGES_SETTING,
  MEASURE_SCALE_SETTING,
  MEASURE_UNIT_SETTING,
  AZURE_DI_ENDPOINT_SETTING,
  OCR_LANGUAGE_SETTING,
} from './settings/editing.js';
import { CommentStylesPanel } from './CommentStylesPanel.js';
import { AssistantPanel } from './AssistantPanel.js';
import type { EventSubscriber } from './bridge.js';
import { StylePanel } from './StylePanel.js';
import type { RulerUnit } from './rulerGeometry.js';
import { useSetting } from './useSetting.js';
import type { SettingsStore } from './settingsStore.js';
import { type ShowToast, TOAST_LIFETIME, createToastStore } from './toasts.js';
import { ToastStrip } from './primitives/Toast.js';
import { isDirty, savedState, savedTick } from './savedState.js';
import { FIRST_PAGE, kernelPageOf } from './pageNumbering.js';
import { PageList, type PageListProps } from './PageList.js';
import { QuickToolbar } from './surfaces/QuickToolbar.js';
import { ContextMenuArea } from './surfaces/ContextMenu.js';
import { type TextSelection, readTextSelection } from './TextLayer.js';
import {
  type TextSelectionDeps,
  copySelectionCommand,
  markupSelectionCommands,
  commentSelectionCommand,
  redactSelectionCommand,
  searchSelectionCommand,
} from './commands/textSelectionCommands.js';
import { Ribbon } from './surfaces/Ribbon.js';
import { ContextPanel } from './surfaces/ContextPanel.js';
import { DocumentBody } from './surfaces/DocumentBody.js';
import { DocumentPanel, type DocumentPanelProps } from './surfaces/DocumentPanel.js';
import { dispatchChord, fieldOwnsChord, shortcutsFor } from './surfaces/shortcuts.js';
import { RecentFiles } from './RecentFiles.js';
import { DocumentTabs } from './surfaces/DocumentTabs.js';
import { keyboardShortcutsCommand } from './commands/keyboardShortcuts.js';
import { shortcutListModel } from './surfaces/projections.js';
import { StartFooter } from './surfaces/StartFooter.js';
import { TitleBar } from './surfaces/TitleBar.js';
import { useWindowControlsOverlay } from './windowControlsOverlay.js';
import { StartScreen } from './surfaces/StartScreen.js';
import { ViewProblem } from './surfaces/ViewProblem.js';

/**
 * The renderer's root component.
 *
 * ## What it is, and what it deliberately is not
 *
 * A start screen that is a **projection of the command registry**, and a canvas
 * that shows page 1 of whatever is open. No ribbon, no toolbar, no palette:
 * those are projections too, and each lands with the commands that populate it
 * rather than as an empty container that looks like a surface under
 * construction (§10.4's wired-tools rule).
 *
 * ## The client is a prop
 *
 * It is built from the preload bridge in `main.tsx` and handed in, so this
 * component is renderable against a client built from the contract in a test.
 * A component that reached for the bridge itself would be untestable and would
 * make the bridge's absence a render-time crash rather than a composition
 * decision.
 */

/** What the renderer knows about one open document. */
interface OpenDocument {
  readonly docId: DocId;
  readonly version: DocVersion;
  /**
   * The newest version watched to reach the FILE, and when.
   *
   * ## Beside `version` and NOT in the document store, which was the first attempt
   *
   * `documentStores.ts` also holds a `version`, and it looked like the place for this. It is
   * not: `observed` has no production caller, so that number never leaves the version the
   * document opened at. A `savedVersion` compared against it would read CLEAN for ever — the
   * dot would vanish on the first save and never come back, which is the display-only sin in
   * the direction that costs a person work. The number that actually moves is this one, which
   * `applied` advances on every command, so both halves of the comparison live here.
   *
   * ## Two numbers MAIN minted, compared here — not a second opinion about dirtiness
   *
   * `document.unsaved` is main's own answer and stays the authority `requestClose` asks (B3a).
   * This is the pair the coordinate-systems remedy asks for: `document.open` states the version
   * the file holds, `document.save` states the version it wrote, both from main, and the
   * renderer compares them and invents neither.
   *
   * It agrees with `isDirty`'s conservatism for free: an undo mints a NEW version, so undoing
   * back to the saved content still reads dirty — the same trade `document.unsaved` records. It
   * fails towards a dot nobody needed, never towards a silent loss.
   *
   * Seeded with the opening version, because a document arrives from a file and so opens clean.
   */
  readonly savedVersion: DocVersion;
  /**
   * When a save last landed IN THIS WINDOW, or `undefined` before the first.
   *
   * **A renderer fact, not a document one.** It is not *when the file was written* — the file
   * may be far older than this window — it is when this person watched their save complete,
   * which is the only thing "Saved 2 min ago" can honestly mean here. A modification time read
   * off the filesystem would be a different claim wearing the same words, and would need a path.
   */
  readonly savedAt: number | undefined;
  readonly byteLength: number;
  /**
   * What to call it on screen — the file's name, stated by main.
   *
   * The renderer holds no path (invariant L2), so this is not something it
   * could derive; a renderer that could produce a name would be a renderer
   * holding the thing L2 keeps out.
   */
  readonly name: string;
}

export interface AppProps {
  readonly client: ContractClient;
  /**
   * The live settings values.
   *
   * A prop for the same reason the client is: composition builds it, so a test
   * can hand one with a different value and watch the application follow.
   */
  readonly settings: SettingsStore;
  /**
   * Listens for `main`'s pushed events
   * ([ADR-0082](../../../docs/DECISIONS/0082-main-may-push-on-declared-event-channels.md)).
   *
   * A prop for the client's reason: composition builds the real one over the bridge, and a
   * case hands one it drives itself. **Defaulted to a subscriber that receives nothing**,
   * so every existing case — and the browser shim, where `main` pushes nothing — keeps
   * working without knowing this exists.
   */
  readonly subscribe?: EventSubscriber;
}

/** A subscriber that never delivers: the state a surface with no `main` behind it is in. */
const NO_EVENTS: EventSubscriber = () => () => undefined;

/**
 * The subscription for *no document is open*.
 *
 * Module-level so its identity is stable: `useSyncExternalStore` re-subscribes
 * whenever this changes, and a fresh arrow per render would tear down and
 * rebuild the subscription on every one.
 */
const NO_DOCUMENT_SUBSCRIBE = (): (() => void) => (): void => undefined;

/**
 * How far in from the page's top-right corner an answer's note is placed, in PDF points: half an
 * inch, which clears a note icon of either anchoring — its corner or its centre — inside the page.
 */
const NOTE_MARGIN = 36;

export function App({ client, settings, subscribe = NO_EVENTS }: AppProps): ReactElement {
  /**
   * Every open document, in the order they were opened.
   *
   * ## A LIST AND A SEPARATE ACTIVE ID, not a list with a flag on one entry
   *
   * *Two documents both marked active* and *none marked* are both
   * representable in a list of flagged entries, and every reader would have to
   * rule them out. One id beside the list makes the first unrepresentable; the
   * second is a real state — no documents open — and `undefined` says it (B5).
   *
   * ## An id and not an index
   *
   * Closing a tab renumbers every index after it. An id that no longer names a
   * tab is a state something has to notice; an index that quietly means a
   * *different* document is not.
   */
  const [tabs, setTabs] = useState<readonly OpenDocument[]>([]);
  const [activeId, setActiveId] = useState<DocId | undefined>(undefined);
  /**
   * The document the second pane compares against, or none.
   *
   * App-shell state and not a setting: which two documents a reader is
   * comparing is about this moment, and a comparison that survived a restart
   * would name documents that are not open. Split view IS a setting — that one
   * is *how I like to read* — and the two live in different places for that
   * reason rather than by oversight.
   */
  const [compareId, setCompareId] = useState<DocId | undefined>(undefined);
  /**
   * The page the compare pane is on, and a page the assistant asked it to go to — the RIGHT
   * document's own position, for the assistant's *Right* and *Both* (ADR-0089). Never the status
   * bar's: its commands act on the tab's document, and this is a page of another one. Held with
   * the document it is a page of, so a pick of a different document reads as page 1 until its
   * pane reports, rather than as the last document's page.
   */
  const [comparePage, setComparePage] = useState<{ readonly docId: DocId; readonly page: number } | undefined>(undefined);
  const [compareGoTo, setCompareGoTo] = useState<number | undefined>(undefined);
  const comparedAt = useCallback(
    (docId: DocId, page: number) => {
      setComparePage((current) => (current?.docId === docId && current.page === page ? current : { docId, page }));
    },
    [],
  );
  const compareWentTo = useCallback(() => {
    setCompareGoTo(undefined);
  }, []);
  /**
   * What the find bar last answered, for the text layers to paint.
   *
   * **Here rather than inside `FindBar`**, because the two components that need
   * it are siblings: the bar knows what was searched and the scroller owns the
   * pages. App-shell state for `compareId`'s reason — it is about this moment,
   * and a highlight that survived a restart would be painted for a search
   * nobody ran.
   *
   * Not per document: only the focused document's pages are mounted, and the
   * bar clears this when the document closes.
   */
  const [search, setSearch] = useState<SearchHighlight | null>(null);
  /**
   * What the find field is asked to search for by the selected-text menu's *Search* (§7) — a text
   * and a counter, so the same text asked twice searches twice.
   */
  const [findSeed, setFindSeed] = useState<{ readonly text: string; readonly nonce: number } | undefined>(undefined);
  /**
   * The text selected in the focused document's text layer, as `readTextSelection` answers it on
   * every `selectionchange`. State rather than a read at the moment of the right-click, because the
   * menu's groups are decided when the region renders: a selection that re-renders nothing would
   * leave the selected-text items out of the menu opened over it.
   */
  const [textSelection, setTextSelection] = useState<TextSelection | undefined>(undefined);
  useEffect(() => {
    const read = (): void => {
      const next = readTextSelection();
      // THE SAME SELECTION IS NOT A NEW ONE: `selectionchange` fires on every step of a drag, and a
      // new object each time would re-render the shell for a selection that did not change.
      setTextSelection((current) =>
        current?.page === next?.page &&
        current?.text === next?.text &&
        current?.from.x === next?.from.x &&
        current?.from.y === next?.from.y &&
        current?.to.x === next?.to.x &&
        current?.to.y === next?.to.y
          ? current
          : next,
      );
    };
    document.addEventListener('selectionchange', read);
    return (): void => {
      document.removeEventListener('selectionchange', read);
    };
  }, []);
  /**
   * The long command currently running, for the status bar.
   *
   * One at a time, and that is what the state shape says rather than something
   * enforced: two walks at once would be two four-hundred-page reads competing
   * in one document lane, and the second's report would replace the first's
   * with nothing saying so. A queue is the answer if that ever becomes
   * reachable; today every long command is started from a surface that is
   * blocked by the dialog the previous one opened.
   */
  const [task, setTask] = useState<RunningTask | undefined>(undefined);
  /**
   * `useMemo` rather than a fresh tracker per render: it goes into the command
   * registry's own memo, and a new identity every render would rebuild every
   * command on every keystroke. `setTask` is stable, so this never recomputes.
   */
  const track = useMemo(() => trackerOver(setTask), []);
  const open = tabs.find((tab) => tab.docId === activeId);
  /**
   * The clock the saved-state text is read against, and the timer that moves it.
   *
   * ## A TICK, because "2 min ago" goes stale on its own
   *
   * Every other value on screen changes when something happens. This one changes when nothing
   * happens, so the only thing that can move it is a timer — and a status bar that said *Saved
   * just now* for twenty minutes would be the same defect this whole change is about, one step
   * further along.
   *
   * **The interval is derived from the age** (`savedTick`): a half-minute while the words are
   * counting minutes, a half-hour once they are counting hours, and no timer at all before the
   * first save, when the text cannot change by itself. A fixed interval has to be the fastest
   * the worst case needs and then pays it for ever.
   */
  const [now, setNow] = useState(() => Date.now());
  const savedAt = open?.savedAt;
  // THE BAND, not the clock, is what the effect depends on. `savedTick` answers the same number
  // for every moment inside a band, so this changes only when the text starts counting a coarser
  // unit — which is exactly when the timer should be rebuilt, and never on a tick. Depending on
  // `now` instead would tear the timer down and start it again every time it fired, and a timer
  // that restarts its own countdown never fires at the interval it claims.
  const every = savedTick(savedAt, now);
  useEffect(() => {
    if (every === undefined) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, every);
    return () => {
      clearInterval(timer);
    };
  }, [every]);
  const saved = savedState(open?.version ?? 0, open?.savedVersion ?? 0, savedAt, now);
  // THE DOT PER TAB, from the same rule the bar's words come from. It takes no clock — a dot is
  // not a duration — so this is rebuilt when a version moves and never on the tick above.
  const tabStrip = useMemo(
    () => tabs.map((tab) => ({ ...tab, dirty: isDirty(tab.version, tab.savedVersion) })),
    [tabs],
  );

  /**
   * One store per open document, minted with its tab and dropped with it.
   *
   * Declared here rather than beside the state it serves, because the callback
   * that adds a tab is the one that mints a store and the compiler is right
   * that the order has to say so.
   */
  const [stores] = useState(() => new DocumentStores());
  /**
   * The window's toast queue, and the two callbacks a file-writing command takes.
   *
   * **`toast` is stable and `onSaved` is stable**, which is why both are `useCallback` over the
   * store rather than values read during render: the command registry is rebuilt when its
   * dependencies change, and a callback minted fresh each render would rebuild every command on
   * every keystroke — the shape that put the ribbon behind the error boundary on 2026-09-23.
   */
  const [toastStore] = useState(() => createToastStore());
  const toasts = useSyncExternalStore(toastStore.subscribe, () => toastStore.getState().toasts);
  const toast = useCallback<ShowToast>(
    (kind, message) => {
      toastStore.getState().show(kind, message);
    },
    [toastStore],
  );
  const dismissToast = useCallback(
    (id: number) => {
      toastStore.getState().dismiss(id);
    },
    [toastStore],
  );
  // THE CLOCK IS READ HERE, at the moment the save landed, and nowhere downstream: `savedState`
  // is a function of its arguments so that its boundaries are testable (59 seconds against 60).
  //
  // NAMED, not the focused tab: the close path saves each document in turn and activates it to
  // ask, so "the active one" would be right by accident there and wrong the moment it is not.
  const onSaved = useCallback((docId: DocId, version: DocVersion) => {
    const at = Date.now();
    setTabs((current) =>
      current.map((tab) =>
        // MONOTONIC, for `observed`'s reason: two saves can be in flight — the Save command and
        // the close path's — and replies are not ordered. An older one landing late would mark
        // a document dirty again over content that is on disk.
        tab.docId === docId && version >= tab.savedVersion
          ? { ...tab, savedVersion: version, savedAt: at }
          : tab,
      ),
    );
  }, []);
  // SAVED CONVERSATIONS (ADR-0093) start with a document's store and stop with it — before the close
  // reaches `main`, so a save still settling is finished while the document is open there. The
  // setting is read at each save, so turning it off stops the next one with nothing restarted.
  useEffect(() => {
    const syncs = new Map<DocId, () => void>();
    const stop = stores.watch({
      opened: (docId, store) => {
        syncs.set(docId, syncConversation(client, docId, store, () => settings.get(CHAT_HISTORY_SETTING_ID) === true));
      },
      closed: (docId) => {
        syncs.get(docId)?.();
        syncs.delete(docId);
      },
    });
    return () => {
      stop();
      for (const end of syncs.values()) end();
    };
  }, [client, settings, stores]);
  /**
   * The last open that produced no document and something to say.
   *
   * Held here rather than inside the start screen because the COMMAND produces
   * it and the command is registered here — a surface that owned this would
   * have to be reachable from the registry, which is the second wiring place.
   */
  const [openProblem, setOpenProblem] = useState<OpenProblem | undefined>(undefined);

  // ONE registry instance, and the dialog host's state feeds the command that
  // opens it. `useDialogHost` owns `ask`, so the command captures it the same
  // way it captures the client — composition, not a global.
  const dialogs = useMemo(
    () =>
      new DialogRegistry([
        ABOUT_DIALOG,
        AI_SETUP_DIALOG,
        DONATE_DIALOG,
        CLOUD_DIALOG,
        CLOUD_OUTCOME_DIALOG,
        KEYBOARD_SHORTCUTS_DIALOG,
        WORD_COUNT_DIALOG,
        PAGE_STRUCTURE_DIALOG,
        SPELL_CHECK_DIALOG,
        OCR_DIALOG,
        TRANSLATE_PAGE_DIALOG,
        OCR_OUTCOME_DIALOG,
        ENHANCE_OUTCOME_DIALOG,
        SCAN_OUTCOME_DIALOG,
        SAVE_PROBLEM_DIALOG,
        CLOSE_UNSAVED_DIALOG,
        COMMAND_PROBLEM_DIALOG,
        HISTORY_TRIMMED_DIALOG,
        DELETE_PAGES_DIALOG,
        ANNOTATION_TEXT_DIALOG,
        ANNOTATION_NOTE_DIALOG,
        ANNOTATION_EDIT_DIALOG,
        ANNOTATION_REPLY_DIALOG,
        DOCUMENT_PASSWORD_DIALOG,
        PROTECT_DOCUMENT_DIALOG,
        APPLY_REDACTIONS_DIALOG,
        REDACT_MATCHES_DIALOG,
        SANITIZE_DOCUMENT_DIALOG,
        SIGN_DOCUMENT_DIALOG,
        SIGN_PROBLEM_DIALOG,
        SIGNATURES_DIALOG,
        DOCUSIGN_SEND_DIALOG,
        DOCUSIGN_NOTICE_DIALOG,
        LINK_ADDRESS_DIALOG,
        LINK_PAGE_DIALOG,
        CALLOUT_DIALOG,
        TYPEWRITER_DIALOG,
        CROP_PAGES_DIALOG,
        WATERMARK_PAGES_DIALOG,
        HEADER_FOOTER_DIALOG,
        BATES_NUMBER_DIALOG,
        PAGE_TRANSITION_DIALOG,
        RESIZE_PAGES_DIALOG,
        FLAT_FIELDS_DIALOG,
        EDIT_PAGE_OBJECT_DIALOG,
        IMPORT_FORM_DATA_PROBLEM_DIALOG,
        IMPORT_ANNOTATIONS_PROBLEM_DIALOG,
        INSERT_IMAGE_PROBLEM_DIALOG,
        MARKDOWN_IMPORT_PROBLEM_DIALOG,
        OPEN_FROM_URL_DIALOG,
        URL_OPEN_PROBLEM_DIALOG,
        CAMERA_CAPTURE_DIALOG,
        GENERATE_TOC_PROBLEM_DIALOG,
        MERGE_DOCUMENT_DIALOG,
        MERGE_DOCUMENT_NONE_DIALOG,
        INSERT_FROM_PDF_DIALOG,
        REPLACE_PAGE_DIALOG,
        IMPORT_PAGE_AS_LAYER_DIALOG,
        REIMPORT_EXTERNAL_EDIT_DIALOG,
        EXTERNAL_EDIT_PROBLEM_DIALOG,
        EXTRACT_PAGES_DIALOG,
        SPLIT_DOCUMENT_DIALOG,
        EXPORT_PAGE_IMAGES_DIALOG,
        EXPORT_WORD_DIALOG,
        EXPORT_EXCEL_DIALOG,
        SERVICE_REFUSED_DIALOG,
        PRINT_DIALOG,
        PDFA_REMOVALS_DIALOG,
        OPTIMIZE_DIALOG,
        PAGE_BARCODES_DIALOG,
        COMPARE_DOCUMENTS_DIALOG,
        ACCESSIBILITY_DIALOG,
        COMPARE_RESULT_DIALOG,
        PLACE_BARCODE_DIALOG,
        DUPLICATE_PAGES_DIALOG,
        SETTINGS_PROBLEM_DIALOG,
        SETTINGS_DIALOG,
        ...FORM_FIELD_DIALOGS,
      ]),
    [],
  );
  const { open: openDialog, ask, close, resolve: resolveDialog, report: reportDialog } = useDialogHost(dialogs);

  // A FAILED WRITE NEEDS A DIALOG, so the subscription lives where `ask` does.
  //
  // It subscribed in `main.tsx` until 2026-09-02, before the hydrate, so a
  // change during startup could not be lost. Nothing is lost by moving it: the
  // only callers of `set` are registered commands, which do not exist until
  // this component has built the registry above.
  useEffect(() => persistSettings(client, settings, ask), [client, settings, ask]);

  /**
   * Asks for an encrypted document's password
   * ([ADR-0055](../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
   *
   * Here because `ask` is here. It answers `undefined` for a dismissal — the
   * schema refuses an empty string, so a parse failure and a closed dialog are
   * one outcome, which is the honest reading: neither produced a password.
   *
   * **What this function must not do is remember one.** The value goes to its
   * caller and nowhere else; nothing here stores it, and the settings store two
   * lines up is exactly where it must never go.
   */
  const requestPassword = useCallback(
    async (name: string, retry: boolean): Promise<string | undefined> => {
      const answered = DOCUMENT_PASSWORD_RESULT.safeParse(
        await ask(DOCUMENT_PASSWORD_DIALOG_ID, { name, retry }),
      );
      return answered.success ? answered.data.password : undefined;
    },
    [ask],
  );

  // WHAT A COMMAND LEFT BEHIND, applied to the open document.
  //
  // A command rewrites the canonical image, so both halves move: the version
  // says the view is stale and the byte length is what the replacement transport
  // is built around. Merging rather than replacing, because `docId` is not the
  // command's to change — a rotate that returned a document identity would be a
  // different operation.
  //
  // Guarded on `previous`, and not because it might be undefined in practice: a
  // command can only run with a focused document. It is the type saying that a
  // result arriving after a close belongs to nothing, which is the same
  // late-answer hazard `DocumentRangeTransport` drops bytes for.
  const applied = useCallback(
    (next: { readonly version: DocVersion; readonly byteLength: number }) => {
      setTabs((current) =>
        current.map((tab) => (tab.docId === activeId ? { ...tab, ...next } : tab)),
      );
    },
    [activeId],
  );

  /**
   * Reorders the document, from the thumbnail strip.
   *
   * ## Dispatched from a SURFACE rather than the registry, and why that is right
   *
   * A registered command's `run` takes the application's state and no
   * arguments, because a menu, a chord and the palette all invoke it and none
   * can supply a pair of page indices — the same constraint that makes
   * `goToCommand` send the caret to a field instead of carrying a number. A
   * drag carries two indices, so it dispatches directly.
   *
   * What it must NOT do is dispatch differently. `applyDocumentCommand` is the
   * four steps `rotatePageCommand` had inline — report a declared refusal, move
   * the version only when it moved, raise invariant 18's dialog — and both
   * callers take them from there rather than each having a copy (B3a).
   */
  const movePage = useCallback(
    (from: number, to: number): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand(
        { client, onApplied: applied, ask },
        activeId,
        { kind: 'movePage', from, to },
      ).then((moved) => {
        // THE REMAP CONTRACT'S CALLER, and it runs only when the document
        // actually moved — `applyDocumentCommand` answers `false` for a refused
        // command, and remapping a history across a move that did not happen
        // would send the reader to a page the document never reordered.
        //
        // The back-stack is the ONE renderer-side consumer that needs this:
        // destinations and the outline are re-queried after a version bump and
        // resolve fresh, where a history is a record of where the reader has
        // been and nothing re-reads it.
        if (!moved) return;
        const count = stores.get(activeId)?.getState().pageCount;
        if (count === undefined) return;
        stores.get(activeId)?.getState().movedPages(count, { from, to });
      });
    },
    [activeId, applied, ask, client, stores],
  );

  /**
   * Removing one annotation, from a row of the annotations panel.
   *
   * `movePage`'s dispatcher on a different surface and for its stated reason: a
   * registered command's `run` takes the application's state and no arguments,
   * because a menu, a chord and the palette all invoke it and none of them can
   * supply a handle naming one annotation. A row can.
   *
   * **The handle arrives whole and nothing here rebuilds it.** In particular the
   * version is the panel's — the one the list it drew was read at — and not
   * `open?.version`, which is this component's current one. They are equal
   * whenever the panel is showing a fresh list, and using the current one would
   * make them equal *always*: the refusal in the kernel would be unreachable and
   * would read exactly like a guard that works.
   *
   * So this spreads the handle into the payload and adds nothing. The one thing
   * it must not do is be clever about a stale one, because being refused is the
   * correct outcome and the panel re-reads on the version it is told about.
   */
  const removeAnnotation = useCallback(
    (handle: { page: number; index: number; version: DocVersion }): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, {
        kind: 'removeAnnotation',
        page: handle.page,
        // A ROW NAMES ONE. The payload is plural because a selection can be
        // several, and this surface is a list of rows with a control each — the
        // one place where *these* would have to be invented rather than
        // collected.
        indices: [handle.index],
        version: handle.version,
      });
    },
    [activeId, applied, ask, client],
  );

  /**
   * Filling one form field, from the row that names it.
   *
   * `removeAnnotation`'s shape on the other walk, and the same reasons: the
   * handle is spread into the payload and nothing here is clever about a stale
   * one — being refused is the correct outcome, and the panel re-reads on the
   * version it is told about.
   *
   * **Singular where its neighbour is plural**, and that is the payload rather
   * than this call site: nobody fills two fields with one gesture, which is
   * also what makes the command invertible.
   */
  const fillFormField = useCallback(
    (handle: {
      page: number;
      index: number;
      version: DocVersion;
      value: FieldFill;
    }): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, {
        kind: 'fillFormField',
        page: handle.page,
        index: handle.index,
        value: handle.value,
        version: handle.version,
      });
    },
    [activeId, applied, ask, client],
  );

  /**
   * Deleting one form field, from the row that names it.
   *
   * `removeAnnotation`'s shape on the widget walk. The payload is plural
   * because a person can select several rows and remove them together, and this
   * surface is a list of rows with a control each — the one place where *these*
   * would have to be invented rather than collected.
   */
  const deleteFormField = useCallback(
    (handle: { page: number; index: number; version: DocVersion }): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, {
        kind: 'deleteFormFields',
        page: handle.page,
        indices: [handle.index],
        version: handle.version,
      });
    },
    [activeId, applied, ask, client],
  );

  /**
   * Flattening the whole form.
   *
   * **Takes no handle**, unlike its two neighbours, and that is not this call
   * site simplifying: MuPDF's `bake` acts on the document and names neither a
   * page nor a field, so there is no answer this could be composed against and
   * therefore no version to be refused on. `targets: 'none'` says the same
   * thing from the declaration side.
   */
  const flattenForm = useCallback((): void => {
    if (activeId === undefined) return;
    void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, {
      kind: 'flattenFormFields',
    });
  }, [activeId, applied, ask, client]);

  /**
   * Removing everything the select tool has picked.
   *
   * ONE COMMAND FOR THE WHOLE SELECTION, which is why `removeAnnotation`'s
   * payload is plural. A loop here would be one version bump per mark — five
   * undo steps for one decision, and four handles stale after the first.
   *
   * The version comes from the selection, exactly as the panel's row hands over
   * the version its list was read at: the selection was built from one walk and
   * carries that walk's version, so a document that has moved refuses rather
   * than deleting by arithmetic.
   */
  const removeSelection = useCallback(
    (chosen: AnnotationSelection): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, {
        kind: 'removeAnnotation',
        page: chosen.page,
        indices: chosen.items.map((item) => item.index),
        version: chosen.version,
      });
    },
    [activeId, applied, ask, client],
  );

  /**
   * Sending a command the surface built, through the one dispatcher.
   *
   * `onCommand`'s body without the overlay around it: the nudge commands build a
   * `placeAnnotation` from the selection they can read, and a second route to
   * `document.execute` is the thing `applyDocumentCommand` exists to prevent.
   */
  const dispatch = useCallback(
    (command: RenderableCommand): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, command);
    },
    [activeId, applied, ask, client],
  );

  /**
   * Exchanging two pages, from the thumbnail strip's Shift+click.
   *
   * `movePage`'s dispatcher one command along, and it goes through
   * `applyDocumentCommand` for that function's own reason: the refusal report,
   * the version move and invariant 18's dialog are four steps this must not
   * have its own copy of.
   */
  const swapPages = useCallback(
    (a: number, b: number): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand(
        { client, onApplied: applied, ask },
        activeId,
        { kind: 'swapPages', a, b },
      );
    },
    [activeId, applied, ask, client],
  );

  /**
   * A page the reader asked to be taken to, cleared once the scroller has.
   *
   * ## Why a REQUEST and not just the current page
   *
   * The scroller reports which page is visible and the commands say which page
   * to go to, and collapsing those into one number makes a loop: the observer
   * sets it, which the scroller reads as an instruction, which moves the
   * observer. Two names, one flowing each way, is the shape that has no loop.
   *
   * Cleared by the scroller rather than by a timer, so a jump to a page that is
   * already visible is still consumed — otherwise the next unrelated render
   * would scroll again.
   */
  const [goTo, setGoTo] = useState<number | undefined>(undefined);

  /**
   * Brings a document to the front, and takes the reader back to its page.
   *
   * ## Why activation is one callback rather than `setActiveId` in four places
   *
   * Only the ACTIVE document's view is mounted, so activating a tab mounts a
   * scroller. `PageList` seeds one page visible and reports it as the current
   * one, which is how a document draws something before any intersection has
   * fired — and a scroller mounting at the top would tell that document's own
   * store the reader had gone back to page 1, a moment after the store was
   * asked where they were.
   *
   * `startAt` is what stops that: the scroller seeds the page it is mounting
   * at, so its first report is the truth, and reveals it itself on mount. That
   * reveal was a `goTo` issued here until 2026-09-18, and the route it did not
   * cover — a new version, which remounts the scroller on every edit — is why
   * it moved into the scroller (`PageList`'s `revealedStart`). Every route that
   * changes the active document still comes through here rather than calling
   * `setActiveId`, so there is one name for it.
   *
   * ## Only the active view is mounted, and that is a BUDGET decision
   *
   * Keeping every tab's scroller mounted would preserve the scroll position
   * for free, and would hold one set of page bitmaps per open document — which
   * is the first thing in this build that looks like the cache §9.17's
   * renderer budget is written about. Unmounting keeps that budget a statement
   * about one document, and this callback is what it costs.
   */
  const activate = useCallback((docId: DocId): void => {
    setActiveId(docId);
  }, []);


  /**
   * A document main has opened, added as a tab and brought to the front.
   *
   * **Deduped by `docId`**, which is not defensiveness: `document.openRecent`
   * can answer with a document that is already open, and appending would put a
   * second tab in front of the reader for the file they asked to look at. The
   * dedupe and the activation together are what make *open the thing I already
   * have* mean *show it to me*.
   */
  const opened = useCallback(
    // TAKES WHAT A COMMAND CAN REPORT — `OpenedDocument`, which is `main`'s answer — and seeds
    // the saved state here. A command has nothing to say about it: opening a document is the one
    // moment its content and its file are the same by construction, so the seed is a fact about
    // the event and not a field anyone could get wrong at a call site.
    (document: OpenedDocument): void => {
      // THE STORE IS MINTED HERE, beside the tab, because the two have the same
      // lifetime and `stores.open` refuses a second one for a document that
      // already has it. Guarded by the same `get`-misses read the render uses,
      // so re-opening an open document activates its tab rather than throwing.
      if (stores.get(document.docId) === undefined) {
        stores.open(document.docId, document.version);
      }
      setTabs((current) =>
        current.some((tab) => tab.docId === document.docId)
          ? current
          : // THE FILE HOLDS THIS VERSION, and `savedAt` stays undefined: this window has not
            // watched a save, so the bar reads "Saved" with no time rather than claiming one.
            [...current, { ...document, savedVersion: document.version, savedAt: undefined }],
      );
      activate(document.docId);
    },
    [activate, stores],
  );

  /**
   * The open document's own store, which is where the back-stack lives.
   *
   * ## THE FIRST REAL CALLER of `documentStores.ts`, and that is deliberate
   *
   * That module has been correct and unused since it landed: its own header
   * says a page or a selection would be *"state nothing reads — the display-only
   * sin, in a store"*. Navigation reads it, so it stops being an invention, and
   * a per-document lifetime is exactly what a back-stack needs: one that
   * outlived its document would offer to return a reader to page 40 of a file
   * they closed.
   *
   * Keyed on the document rather than kept in a ref, so closing and reopening
   * the same file starts a fresh history — which is what a reader expects and
   * what §6 makes automatic.
   */
  /**
   * The active document's store, read rather than held.
   *
   * ## THE LIFETIME MOVED WITH TABS, and that is the finding this row exists to
   * produce
   *
   * A store used to be opened by an effect keyed on the focused `docId` and
   * dropped by that effect's cleanup — correct while focus and existence were
   * the same event. With tabs they are two: switching away from a document does
   * not close it, and an effect written that way would drop the store of every
   * tab the reader looked away from, taking its history and its zoom with it
   * and re-minting them empty on the way back. The reader would see a
   * back-stack that forgets and a magnification that resets, with nothing in
   * the code saying *close*.
   *
   * So a store's lifetime is now the TAB's, and it is opened and closed by the
   * two callbacks that add and remove one. `get` misses rather than creates —
   * `documentStores.ts` insists on that — so reading here can never mint a
   * store for a document that is gone.
   */
  const store = activeId === undefined ? undefined : stores.get(activeId);

  /**
   * The active document's view state, live.
   *
   * ## WHY THESE THREE MOVED OUT OF `useState` AND INTO THE STORE
   *
   * The page, the magnification and the page count were `useState` here while
   * there was one document, where *the application's page* and *this
   * document's page* are the same sentence. Tabs separate them, and the
   * separation is not cosmetic: a reader on page 40 of one file who looks at
   * another and comes back expects page 40, and a status bar reading
   * "Page 1 of 10" over a two-page document is a wrong statement rather than a
   * stale one.
   *
   * The alternative — keep them here and copy them in and out on every switch —
   * is a restore, and a restore is a mechanism that can be wrong where a
   * position cannot. This is §10.5a's own lesson applied a second time in the
   * same day: put the state where its lifetime is, rather than moving it about
   * correctly.
   *
   * `useSyncExternalStore` rather than a subscription effect, because the
   * subscribe function is the store's own and re-subscribing when the active
   * store changes is exactly what switching tabs must do. With no document the
   * subscribe is a no-op whose unsubscribe is a no-op, and the snapshot is a
   * stable `undefined` — returning a fresh object there would spin React.
   */
  const view = useSyncExternalStore(
    store?.subscribe ?? NO_DOCUMENT_SUBSCRIBE,
    () => store?.getState(),
  );
  const currentPage = view?.page ?? FIRST_PAGE.kernel;
  const pageCount = view?.pageCount;
  const zoomMode = view?.zoom ?? DEFAULT_ZOOM;

  /**
   * Releases documents: each tab, its store, and what main holds for it.
   *
   * ## It RELEASES and never asks, and only `requestClose` below calls it
   *
   * Called directly it was the defect of 2026-09-18: a tab's × dropped a document holding
   * unsaved changes with no question. So the asking lives in one place and every route — the
   * ×, Ctrl+W, the window's close, quitting — goes through that place.
   *
   * ## All three, and the third is the one a renderer-only close would miss
   *
   * Dropping the tab and the store leaves `main` holding the canonical image
   * against the capacity ceiling that `at-capacity` reports — so a reader who
   * opened and closed several large files would be refused the next one by a
   * budget spent on documents nothing can reach. `document.close` exists for
   * that, and this is its only caller.
   *
   * ## The neighbour to the LEFT, and it is decided before the list changes
   *
   * Closing the focused tab has to leave the reader somewhere. The nearest surviving
   * tab to its left is what every editor does and what a reader reaches for next; the
   * first tab would send someone closing the fifth of six back to the start.
   * Reading the index from the order before the filter is what makes that
   * expressible: after the filter, the position is gone. The active tab is updated
   * from its CURRENT value, since the close path may have activated another since;
   * the ORDER is the one the close began with, which a modal question keeps still.
   *
   * ## The failure is REPORTED rather than swallowed
   *
   * The channel declares no codes, so the only way this ends badly is
   * `internal` — a defect with an incident id. The tab still goes, because the
   * reader asked for it and leaving it would put a document on screen that
   * this build has already stopped tracking; what must not happen is that the
   * incident goes nowhere.
   */
  const releaseTabs = useCallback(
    async (docIds: readonly DocId[]): Promise<void> => {
      const released = new Set(docIds);
      const order = tabs;
      setTabs((current) => current.filter((tab) => !released.has(tab.docId)));
      setActiveId((current) => {
        if (current === undefined || !released.has(current)) return current;
        const at = order.findIndex((tab) => tab.docId === current);
        const left = order
          .slice(0, Math.max(0, at))
          .reverse()
          .find((tab) => !released.has(tab.docId));
        // `undefined` for the LAST tab: there is no document to arrive at.
        return (left ?? order.find((tab) => !released.has(tab.docId)))?.docId;
      });

      for (const docId of docIds) {
        stores.close(docId);
        const answer = await client['document.close']({ docId });
        if (!answer.ok) void ask(COMMAND_PROBLEM_DIALOG_ID, answer.error);
      }
    },
    [ask, client, stores, tabs],
  );

  /**
   * THE ONE CLOSE PATH: every way a document closes goes through here (owner, 2026-09-19).
   *
   * ## Save / Don't save / Cancel, for each document with unsaved changes
   *
   * Each document is asked about in turn, with its tab brought to the front so the question
   * is about something on screen. **Nothing is released until every answer is in**: a Cancel
   * at the third of four documents leaves all four open, which is *Cancel leaves everything
   * open* read for the several-document case. *Save* runs the one save (`saveDocument`) and a
   * save that does not land stops the close — invariant 18's *a failed save never loses work*
   * — with the save's own problem dialog saying why. *Don't save* discards that document only.
   *
   * **One question per document rather than one list**, for quitting with several: each
   * answer can fail on its own (a save refused because another tab holds the file), and a
   * refusal has to be reported against the document it belongs to, on screen, before the next
   * question — a list would need a result per row and a second dialog to explain it.
   *
   * *Save As* for a document with no file is not a branch here because the state does not
   * exist: every document `DocumentService` opens comes from a file, and every import saves
   * before it opens (`document.newFromMarkdown`' shape).
   *
   * ## Main answers "unsaved", inside the document's lane
   *
   * The renderer tracks no dirty flag of its own — that would be a second opinion about what
   * main holds (B3a), and the stale answer is *clean*, which closes without asking.
   * `document-not-open` means nothing is there to lose; any other failure is read as unsaved,
   * which fails towards a question rather than towards a loss.
   *
   * @returns whether every document named was released — `false` after a Cancel, a dismissed
   *   question or a save that did not land.
   */
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(
    async (docIds: readonly DocId[]): Promise<boolean> => {
      // ONE AT A TIME: a second close while a question is on screen — the caption's × pressed
      // twice — would ask about the same document twice. State rather than a ref, because this
      // function is handed to a command built during render; the question is asynchronous, so
      // the re-render that carries `true` lands before anyone can press again.
      if (closing) return false;
      setClosing(true);
      try {
        for (const docId of docIds) {
          const tab = tabs.find((candidate) => candidate.docId === docId);
          if (tab === undefined) continue;
          const answer = await client['document.unsaved']({ docId });
          const unsaved = answer.ok
            ? answer.value.unsaved
            : answer.error.code !== 'document-not-open';
          if (!unsaved) continue;

          activate(docId);
          const choice = CLOSE_UNSAVED_RESULT.safeParse(
            await ask(CLOSE_UNSAVED_DIALOG_ID, { name: tab.name }),
          );
          // DISMISSED IS CANCEL: the platform's × or Escape must never be the destructive answer.
          if (!choice.success || choice.data === 'cancel') return false;
          // THE SAME TWO CALLBACKS the Save command passes, because this is the same save
          // (B3a): the document is about to close, so the dot and the bar go with it, but a
          // save that landed is still worth confirming — and the toast outlives the tab.
          if (
            choice.data === 'save' &&
            !(await saveDocument({ client, ask, toast, onSaved }, docId))
          ) {
            return false;
          }
        }
        await releaseTabs(docIds);
        return true;
      } finally {
        setClosing(false);
      }
    },
    [activate, ask, client, closing, onSaved, releaseTabs, tabs, toast],
  );

  // THE WINDOW'S CLOSE, held by main until this answers (`windowClose.ts`): every open
  // document through the one path, then `window.close`. A Cancel answers nothing and the
  // window stays.
  useEffect(() => {
    const stop = subscribe('window.close-requested', () => {
      void (async (): Promise<void> => {
        if (await requestClose(tabs.map((tab) => tab.docId))) {
          await client['window.close']({});
        }
      })();
    });
    // AND MAIN IS TOLD THERE IS NOW SOMEBODY TO ASK. A pushed request reaches whoever is
    // listening when it is sent, so until this arrives the gate lets a close through rather than
    // holding the window for an answer that was delivered to nobody (`windowClose.ts`).
    void client['window.closeListening']({});
    return stop;
  }, [client, requestClose, subscribe, tabs]);

  /**
   * The magnification the reader asked for, as a MODE.
   *
   * Held here for the current page's reason: the commands that change it are
   * registered here, and the surface that draws at it is a child. It is
   * deliberately **not** a setting — a zoom that survived a restart would be a
   * preference, and §10.4's settings registry is where a preference goes.
   *
   * **A mode and not a number, because this component cannot resolve a fit** —
   * it has no idea how wide the scroller is, and giving it one would move
   * layout measurement up here to serve two commands. `PageList` resolves it
   * and reports what it resolved to.
   */
  /**
   * The scale actually on screen, which is the mode's number or a fit's answer.
   *
   * The ± commands step from THIS, not from the mode: a reader at fit-width has
   * no number in their mode, and stepping from the last explicit scale would
   * jump to somewhere they cannot see.
   */
  const [shownZoom, setShownZoom] = useState(1);

  // The three reading aids, live. Read here rather than in the scroller because
  // the scroller takes a `SettingsStore` from nobody — it is handed what it
  // needs, which keeps it testable without a store.
  /**
   * What the navigation commands act through.
   *
   * **The store decides, and this only carries the answer to the scroller.**
   * `back` returns the page it moved to or `undefined` at the start, so the
   * decision of whether there is anywhere to go is made once, in the store,
   * rather than by a caller re-reading the history and reaching its own
   * conclusion (B3a).
   *
   * Stable across renders where the store is, so the registry below is not
   * rebuilt on every page change.
   */
  const navigator = useMemo(
    () => ({
      jumpTo: (page: number): void => {
        store?.getState().jumpTo(page);
        setGoTo(page);
      },
      back: (): void => {
        const target = store?.getState().back();
        if (target !== undefined) setGoTo(target);
      },
      forward: (): void => {
        const target = store?.getState().forward();
        if (target !== undefined) setGoTo(target);
      },
    }),
    [store],
  );

  /**
   * What a command last asked of the assistant (ADR-0088), and the one way to ask it.
   *
   * It opens the right panel on the Assistant tab through the same two settings the style
   * command uses to reveal Properties, so a person who shut the panel sees the answer arrive.
   */
  const [assistantRequest, setAssistantRequest] = useState<AssistantRequest | undefined>(undefined);
  // WHICH REQUEST WAS ACTED ON, here rather than in the panel: the panel unmounts with no document
  // open, and a marker it held reset on remount and replayed the last request.
  const [assistantHandled, setAssistantHandled] = useState<number | undefined>(undefined);
  const askAssistant = useCallback<AskAssistant>(
    (about, prompt, replyTo) => {
      settings.set(CONTEXT_PANEL_OPEN_SETTING.id, true);
      settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');
      setAssistantRequest((last) => ({
        serial: (last?.serial ?? 0) + 1,
        about,
        ...(prompt === undefined ? {} : { prompt }),
        ...(replyTo === undefined ? {} : { replyTo }),
      }));
    },
    [settings],
  );

  /**
   * Reveals the assistant and puts the cursor in its composer. The composer mounts with the panel,
   * so focus is taken on the next frame rather than now.
   */
  const openAssistant = useCallback(() => {
    settings.set(CONTEXT_PANEL_OPEN_SETTING.id, true);
    settings.set(CONTEXT_PANEL_TAB_SETTING.id, 'assistant');
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-assistant-draft]')?.focus();
    });
  }, [settings]);

  // Stable, so the scroller's consume-the-request effect does not re-run on
  // every parent render and scroll again to a page it has already reached.
  const wentTo = useCallback(() => {
    setGoTo(undefined);
  }, []);

  // THE READER'S OWN SCROLLING, told to the store so the history has a place to
  // return to. It does NOT push — see `DocumentState.history`.
  const viewed = useCallback(
    (page: number): void => {
      store?.getState().viewing(page);
    },
    [store],
  );

  // The parser's answer, told to the document it is about. Idempotent by value
  // in the store, because the scroller reports on every mount.
  const counted = useCallback(
    (pages: number): void => {
      store?.getState().counted(pages);
    },
    [store],
  );

  /**
   * Whether the command palette is open.
   *
   * App-shell state, so it lives here rather than in a document's store — §6 is
   * explicit that the two do not mix, and a palette that closed when a document
   * did would be a surface with a lifetime it has no reason to have.
   */
  const [palette, setPalette] = useState(false);
  const togglePalette = useCallback(() => {
    setPalette((shown) => !shown);
  }, []);
  const closePalette = useCallback(() => {
    setPalette(false);
  }, []);

  /**
   * The drawing tool selected, by id, or `undefined` for none.
   *
   * ## App-shell state, and NOT a setting
   *
   * `palette`'s argument on the placement: §6 keeps shell state out of a
   * document's store, and a tool that switched off when a tab did would be a
   * mode with a lifetime it has no reason to have — a reader annotating two
   * documents is annotating, not annotating one of them.
   *
   * It is not a **setting** either, and that is the sharper half. A setting
   * survives a restart, which is right for *show rulers* and wrong here: the
   * application would open in drawing mode, where the first click on a page
   * leaves a rectangle nobody asked for. A tool is a mode a person is in for as
   * long as they are drawing, which is exactly what React state expresses.
   *
   * ## An id, resolved once, rather than the tool
   *
   * The command registry can only carry a string — its `run(context)` takes the
   * application's state and no arguments — so an id is what a command can set.
   * The registry resolves it to the tool here, once, and the scroller is handed
   * the tool itself so nothing below this point knows a registry exists.
   */
  const [toolId, setToolId] = useState<string | undefined>(undefined);
  const readTool = useCallback(() => toolId, [toolId]);
  /**
   * What the select tool has picked, or `undefined` for nothing.
   *
   * **Held here rather than in the tool**, which is what let the select tool
   * land as a registration: a selection outlives every gesture and a controller
   * is a value (ADR-0029 Decision 1). `SelectionLayer` draws it and
   * `deleteSelectionCommand` acts on it, so the two surfaces read one state.
   */
  const [picked, setPicked] = useState<AnnotationSelection | undefined>(undefined);
  /**
   * Reading every annotation in the open document, for the eraser.
   *
   * **A read, not a dispatch**, which is why it is here rather than a second
   * path through `applyDocumentCommand`: the tool has to find out what is under
   * the pointer before it can name it, and the answer carries the version its
   * own handle needs. `AnnotationsPanel` asks the same channel for its own
   * reasons — many readers of one authority is what B3a permits, and neither
   * derives anything the other does.
   *
   * `undefined` covers *no document* and *the read was refused* together,
   * because the tool has nothing different to do with them: both mean there is
   * nothing to erase, and a refusal is reported where every other one is.
   */
  const listAnnotations = useCallback(async () => {
    if (activeId === undefined) return undefined;
    const answer = await client['document.annotations']({ docId: activeId });
    return answer.ok ? answer.value : undefined;
  }, [activeId, client]);
  /**
   * The selection, if it still describes the document on screen.
   *
   * ## DERIVED rather than cleared, which is `AnnotationsPanel`'s own rule
   *
   * A selection's indices are positions in one walk at one version
   * ([ADR-0041](../../../docs/DECISIONS/0041-an-annotation-is-named-by-its-place-in-a-walk-and-a-version.md)),
   * so a version bump turns them into arithmetic pointing at whatever is now
   * there. Kept, they would draw boxes in the right places over the wrong
   * annotations, and `Delete` would name the wrong ones. The kernel refuses a
   * stale handle so nothing corrupt lands; what it produces is a refusal a
   * person cannot act on, over marks that look selected.
   *
   * An effect that cleared the state on a version change would be a render
   * behind — for one frame the boxes are drawn against the new document — and
   * the panel already rejects that shape for exactly this reason. Comparing the
   * two versions here means a stale selection is never read at all.
   *
   * **And it is scoped to the tool.** Leaving boxes on the page while somebody
   * draws a rectangle shows a selection nothing on screen belongs to; the delete
   * command's shortcut is not tool-scoped, so *nothing is selected* has to be
   * true rather than merely invisible.
   */
  const selection = useMemo(
    () =>
      picked !== undefined && picked.version === open?.version && toolId === SELECT_TOOL_ID
        ? picked
        : undefined,
    [open?.version, picked, toolId],
  );
  const readSelection = useCallback(() => selection, [selection]);
  /**
   * Which document is ON SHOW, for a command that also receives a different one.
   *
   * `readSelection`'s shape and its reason. Inside the tab menu a command's
   * `context.docId` is the tab that was right-clicked, so *the document on show*
   * is a second fact the context cannot carry — and a closure over `activeId`
   * built inside the registry's `useMemo` would answer with whichever tab was
   * focused when that memo last ran.
   */
  const readActiveId = useCallback(() => activeId, [activeId]);
  /**
   * How many marks main's clipboard holds, as the last copy reported it — the COUNT and never the
   * marks, which stay in main because a paste is a command the renderer may not send.
   *
   * App state and not a setting, for `compareId`'s reason: main's clipboard is empty at every
   * start, so a count that survived a restart would show *Paste* over nothing. Application-wide
   * rather than per document, which is what lets a copy in one tab be pasted into another.
   */
  const [copiedCount, setCopiedCount] = useState(0);
  const readHasCopied = useCallback(() => copiedCount > 0, [copiedCount]);

  /**
   * What a new annotation is drawn in — the four editing settings, resolved.
   *
   * ## Resolved HERE and not in each tool
   *
   * Twelve tools reading four settings would be twelve implementations of *what
   * colour is a new mark*, agreeing today. This is the one answer, and the tool
   * registry is rebuilt when it moves — fourteen entries in a `Map`, which is
   * what the memo below already costs when the selection changes.
   *
   * `'auto'` is unpacked here for the same reason: the tri-state has one reader,
   * and a tool asks for a colour by handing over the one it would use itself.
   */
  const styleColour = useSetting(settings, ANNOTATION_COLOUR_SETTING);
  // §10.3'S CHROME MODE, read here because the surface is marked with it.
  const layoutMode = useSetting(settings, LAYOUT_MODE_SETTING);

  // THE RUNNING BUILD'S VERSION, for the start screen's footer (§10.3). Asked once per client.
  const [appVersion, setAppVersion] = useState<string | undefined>(undefined);
  useEffect(() => {
    // `RecentFiles`' shape: a flag read inside the answer's callback, and a rejection handled rather than thrown —
    // `createClient`'s methods are `async`, so even a transport that throws arrives here as a rejection.
    let cancelled = false;
    client['app.info']({}).then(
      (answer) => {
        if (cancelled || !answer.ok) return;
        setAppVersion(answer.value.version);
      },
      () => {
        // SWALLOWED ON PURPOSE: a version that cannot be read leaves the footer without its version line, which
        // `StartFooter` draws as no line at all. Nothing else reads it, and an error on the first screen a reader sees
        // over a courtesy line would be worse than the line's absence.
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [client]);
  const styleOpacity = useSetting(settings, ANNOTATION_OPACITY_SETTING);
  const styleLineWidth = useSetting(settings, ANNOTATION_LINE_WIDTH_SETTING);
  const styleFontSize = useSetting(settings, ANNOTATION_FONT_SIZE_SETTING);
  // THE RESOLUTION IS `styleFrom`'s, where its cases are — a stored value it cannot
  // read, `'auto'` among them, hands each tool its own colour.
  const style = useMemo<AnnotationStyle>(
    () =>
      styleFrom({
        colour: styleColour,
        opacity: styleOpacity,
        lineWidth: styleLineWidth,
        fontSize: styleFontSize,
      }),
    [styleColour, styleFontSize, styleLineWidth, styleOpacity],
  );

  /**
   * Each drawn page's visible box in PDF user space, for the document on screen — what the page
   * list reported. Replaced per document, because a box belongs to one document's page.
   */
  const pageBoxes = useRef<{ docId: DocId | undefined; boxes: Map<number, readonly [number, number, number, number]> }>({
    docId: undefined,
    boxes: new Map(),
  });
  const pageBoxed = useCallback(
    (page: number, crop: readonly [number, number, number, number]): void => {
      if (pageBoxes.current.docId !== activeId) pageBoxes.current = { docId: activeId, boxes: new Map() };
      pageBoxes.current.boxes.set(page, crop);
    },
    [activeId],
  );

  /**
   * The assistant's *Add as note*: the answer as a sticky note on the page the reader is on, in the
   * page's top-right corner — the margin a note icon is looked for in, and inside the visible box
   * the page list drew, so it is never off the page. The note is an ordinary command: undoable, and
   * saved with the document.
   */
  const noteFromAnswer = useCallback(
    (text: string): boolean => {
      if (activeId === undefined || pageBoxes.current.docId !== activeId) return false;
      const crop = pageBoxes.current.boxes.get(currentPage);
      if (crop === undefined) return false;
      const [, , x1, y1] = crop;
      dispatch(stickyNoteCommand(currentPage, { x: x1 - NOTE_MARGIN, y: y1 - NOTE_MARGIN }, text, style));
      return true;
    },
    [activeId, currentPage, dispatch, style],
  );

  /**
   * What one PDF point measures on this drawing.
   *
   * Two settings and one payload field, joined here rather than in the tool: the
   * measurement tools take a calibration the way every other tool takes a style,
   * and a tool reading the settings store itself would be the second reader of a
   * value this component already owns.
   */
  const scalePerPoint = useSetting(settings, MEASURE_SCALE_SETTING);
  const scaleUnit = useSetting(settings, MEASURE_UNIT_SETTING);
  const imagePages = useSetting(settings, IMAGE_PAGES_SETTING);
  // THE REGION TOOL'S LANGUAGE, read here because this is where settings are read
  // and handed to the registries. The OCR dialog offers the provisioned list and
  // writes this value; the tool has no dialog and reads it.
  const ocrLanguage = useSetting(settings, OCR_LANGUAGE_SETTING);
  /**
   * Whether the cloud engine can be OFFERED: an endpoint in the settings, and a
   * key stored in the credential store.
   *
   * **The key is not read here, and until 2026-09-12 it was read from the wrong
   * place.** This took the key from the renderer's settings store, which is
   * hydrated from `settings.load` and so can never hold a secret — the tool could
   * not appear whatever was stored. What is asked now is main's answer to *which
   * secrets are stored*, an id list with no value in it
   * ([ADR-0056](../../../docs/DECISIONS/0056-the-settings-dialog-derives-a-control-from-a-schema-and-a-secret-is-write-only.md)),
   * and main reads the key itself when it makes the call.
   */
  const azureEndpoint = useSetting(settings, AZURE_DI_ENDPOINT_SETTING);
  // THE IDS OF STORED SECRETS, from which each network engine's readiness is
  // derived — never a key (ADR-0056). One state rather than a boolean per engine,
  // so a second provider's key is a derived line rather than a second setter.
  const [storedSecrets, setStoredSecrets] = useState<readonly SecretSettingId[]>([]);
  const [secretsKnown, setSecretsKnown] = useState(false);
  const azureKeyStored = storedSecrets.includes(AZURE_KEY_SETTING_ID);
  const claudeKeyStored = storedSecrets.includes(ANTHROPIC_KEY_SETTING_ID);
  const docusignKeyStored = storedSecrets.includes(DOCUSIGN_INTEGRATION_KEY_SETTING_ID);
  /**
   * Azure Document Intelligence is usable only with its endpoint AND its key: an endpoint with no
   * key reaches the service and comes back unauthorised, which a reader reads as a wrong key
   * rather than a missing one. ONE NAME for the pair, which the region tool, the Excel engines and
   * the OCR dialog's handwriting sentence all ask.
   */
  const azureReady = azureEndpoint !== '' && azureKeyStored;

  /**
   * Asks main which secrets are stored, and answers in a CALLBACK rather than by
   * awaiting.
   *
   * `react-hooks/set-state-in-effect` traces a named async function called from
   * an effect body and rejects it — correctly, and the rule's own second clause
   * says what the legal shape is: *subscribe for updates from some external
   * system, calling setState in a callback*. Main is that external system and
   * this is the subscription's one-shot form. The `live` flag keeps a slow
   * answer from overwriting a newer one, and a refusal is not a stored key.
   */
  const refreshSecrets = useCallback((): (() => void) => {
    let live = true;
    void client['settings.loadSecrets']({}).then(
      (answer) => {
        if (!live) return;
        setStoredSecrets(answer.ok ? answer.value.stored : []);
        // KNOWN only from an answer: a refusal is not *no key stored*, and the first-run setup
        // must not be offered to a person whose keys main simply could not list.
        setSecretsKnown(answer.ok);
      },
      () => {
        if (live) setStoredSecrets([]);
      },
    );
    return (): void => {
      live = false;
    };
  }, [client]);
  useEffect(() => refreshSecrets(), [refreshSecrets]);
  const scale = useMemo<MeasureScale>(
    () => ({ perPoint: scalePerPoint, unit: scaleUnit }),
    [scalePerPoint, scaleUnit],
  );

  /**
   * Where a dragged region goes.
   *
   * **A CHANNEL CALL AND NOT A COMMAND**, because a snapshot does not change the
   * document — there is nothing for the log to hold and nothing an undo could
   * reverse, a file having already been written. So this reaches
   * `snapshotRegion` rather than `applyDocumentCommand`, and the reporting lives
   * there beside every other write's for the same reason that one does.
   *
   * The region is dropped if no document is focused, which cannot happen — the
   * tool is only reachable while one is — and is written as a return rather
   * than an assertion for the reason `listAnnotations` is.
   */
  const onSnapshot = useCallback(
    (page: number, rect: AnnotationRect, snapshotScale: number): void => {
      if (activeId === undefined) return;
      void snapshotRegion({ client, ask }, activeId, page, rect, snapshotScale);
    },
    [activeId, ask, client],
  );

  /**
   * Where a dragged box for an image goes.
   *
   * {@link onSnapshot}'s shape and the opposite reason: this DOES change the
   * document, and it is still a channel call rather than a command, because the
   * command carries an image the renderer may not hold and main mints it
   * ([ADR-0044](../../../docs/DECISIONS/0044-an-image-reaches-the-engine-the-way-the-document-does.md)).
   * `placeImage` is where the version and the dropped-history dialog are
   * handled, beside every other write's.
   *
   * **WHICH PAGES IS A SETTING, and it is read here rather than in the tool.**
   * The tool knows where the box is; *this page or every page* is a mode the
   * person is in, and reading it here is what keeps the tool a description of a
   * gesture. `pageCount` comes from the view model, so *every page* means every
   * page of the document as it is now — the command is one call whatever the
   * answer, which is the stamps row's multi-page apply.
   */
  const onPlaceImage = useCallback(
    (page: number, rect: AnnotationRect): void => {
      if (activeId === undefined) return;
      void placeImage(
        { client, ask, onApplied: applied },
        activeId,
        imagePagesFor(imagePages, page, pageCount),
        rect,
      );
    },
    [activeId, applied, ask, client, imagePages, pageCount],
  );

  /**
   * Where a visible signature goes.
   *
   * `onPlaceImage`'s shape with one page and no setting: a signature is one
   * widget on the page the box was drawn on, so there is no *every page* mode
   * to read. The dialog, the certificate and the outcome are `signDocument`'s,
   * which the ribbon's invisible signing calls too.
   */
  const onPlaceSignature = useCallback(
    (page: number, rect: AnnotationRect): void => {
      if (activeId === undefined) return;
      void signDocument({ client, ask, onApplied: applied }, activeId, { page, rect });
    },
    [activeId, applied, ask, client],
  );

  /**
   * Where a barcode goes: `onPlaceSignature`'s shape — one page, the one the box was drawn on —
   * ending in the barcode dialog (ADR-0076).
   */
  const onPlaceBarcode = useCallback(
    (page: number, rect: AnnotationRect): void => {
      if (activeId === undefined) return;
      void placeBarcode({ client, ask, onApplied: applied }, activeId, page, rect);
    },
    [activeId, applied, ask, client],
  );

  /**
   * Restyling everything the select tool has picked.
   *
   * `removeSelection`'s shape with an appearance instead of a deletion, and the
   * same two rules: ONE command for the whole selection, because five marks
   * restyled is one decision; and the version comes from the selection rather
   * than from this component's, so a document that has moved refuses instead of
   * restyling by arithmetic.
   *
   * The style is the authoring controls' — `colour([0, 0, 0])` resolves the
   * tri-state by handing over a colour used only when nobody has chosen, and
   * black is the honest *no tool asked* here, this not being a tool.
   */
  const restyleSelection = useCallback(
    (chosen: AnnotationSelection): void => {
      if (activeId === undefined) return;
      void applyDocumentCommand({ client, onApplied: applied, ask }, activeId, {
        kind: 'styleAnnotation',
        page: chosen.page,
        indices: chosen.items.map((item) => item.index),
        colour: style.colour([0, 0, 0]),
        opacity: style.opacity,
        borderWidth: style.lineWidth,
        version: chosen.version,
      });
    },
    [activeId, applied, ask, client, style],
  );

  /** What the selection commands need, composed once so nine entries share it. */
  const selectionDeps = useMemo(
    () => ({ selection: readSelection, onDelete: removeSelection, onPlace: dispatch }),
    [dispatch, readSelection, removeSelection],
  );

  // THE TEXT TOOL IS CONSTRUCTED WITH `ask`, which is what makes it different
  // from the six beside it and the only thing about it this line knows. A tool
  // whose intent is not complete until a person supplies part of it holds the
  // means to ask, exactly as `deletePagesCommand(deps)` does — see
  // `textTools.ts` for why that is not a fourth parameter on `commit`.
  //
  // THE REGISTRY IS REBUILT WHEN THE SELECTION MOVES, and that is cheap and
  // deliberate: the select tool needs to know what is already selected to tell a
  // drag on it from a marquee, and a ref read during render would be the same
  // coupling with a rule about React attached. Fourteen entries in a `Map`.
  const tools = useMemo(
    () =>
      new ToolRegistry(
        annotationTools({
          ask,
          annotations: listAnnotations,
          onSelect: setPicked,
          selected: readSelection,
          style,
          scale,
          onSnapshot,
          // THE SETTING IS A DEPENDENCY, and the callback shape alone is not
          // enough — which `react-hooks/exhaustive-deps` is what said so. A
          // thunk closing over a render value reads that render's value for
          // ever if the memo does not re-run, so `() => ocrLanguage` without
          // the dependency below would have recognised in whatever language was
          // stored when the document opened while the tool's own case proved it
          // reads at commit. The tool keeps the thunk because that is what makes
          // a stale capture unrepresentable on its side; this list is what keeps
          // the value it reads current.
          language: () => ocrLanguage,
          onPlaceImage,
          onPlaceSignature,
          onPlaceBarcode,
        }),
      ),
    [
      ask,
      listAnnotations,
      ocrLanguage,
      onPlaceBarcode,
      onPlaceImage,
      onPlaceSignature,
      onSnapshot,
      readSelection,
      scale,
      style,
    ],
  );

  const rulers = useSetting(settings, RULERS_SETTING);
  const showGrid = useSetting(settings, GRID_SETTING);
  const unit = useSetting(settings, RULER_UNIT_SETTING);
  const loupe = useSetting(settings, LOUPE_SETTING);
  const split = useSetting(settings, SPLIT_VIEW_SETTING);
  /** The document the second pane compares against, while it is still open. */
  const compared = tabs.find((tab) => tab.docId === compareId);
  const secondRenderer = useSetting(settings, SECOND_RENDERER_SETTING);

  /**
   * The updater the zoom commands are given.
   *
   * It closes over the shown scale rather than taking it as an argument at the
   * call, because a command's `run(context)` cannot carry one — the same
   * constraint that makes `findCommand` send the caret to a surface instead of
   * taking a query.
   */
  const changeZoom = useCallback(
    (next: (shown: number) => ZoomMode): void => {
      store?.getState().zoomed(next(shownZoom));
    },
    [shownZoom, store],
  );

  /**
   * The open command, built once and read by two things.
   *
   * The registry projects it onto the start screen; the tab strip triggers the
   * same `run` for *open another*. Hoisting it here rather than placing it on
   * a second surface is what keeps that from being a second wiring place —
   * there is one implementation, and the strip holds no opinion about how a
   * document is opened.
   */
  // ONE SET OF OPEN DEPENDENCIES, for the Open command and the start screen's feature shortcuts, which run the same open.
  const openDeps = useMemo(
    () => ({ client, onOpened: opened, onProblem: setOpenProblem, onAlreadyOpen: activate }),
    [activate, client, opened],
  );
  const openCommand = useMemo(() => openDocumentCommand(openDeps), [openDeps]);

  /**
   * *Set up AI…*, held here as well as registered, because the first run starts it by itself —
   * `openCommand`'s shape: the registered command's own `run`, never a second route to the dialog.
   */
  const aiSetup = useMemo(
    () =>
      aiSetupCommand({
        client,
        settings,
        ask,
        onSecretsChanged: () => {
          refreshSecrets();
        },
      }),
    [ask, client, refreshSecrets, settings],
  );

  /**
   * THE FIRST RUN offers the AI setup once — BUILD-PROMPT E5's onboarding step — and only when all
   * three are known: the stored settings have loaded (a Skip is a stored `false`, and the fallback
   * before the load is `true`), main has answered which keys are stored, and none of the ten
   * providers has one. Once per launch, by a ref, so a key removed later in this session does not
   * reopen it.
   */
  const settingsLoaded = useSyncExternalStore(
    (listener) => settings.subscribe(listener),
    () => settings.hydrated,
  );

  const registry = useMemo(() => {
    // THE SHORTCUTS COMMAND LISTS THE REGISTRY THAT CONTAINS IT. The holder is LOCAL to this memo, filled before the
    // memo returns, and read only when the command runs — never during render (the refs rule that refused G1's first
    // layout memory) and never from module state two mounted shells would share.
    const holder: { registry?: CommandRegistry } = {};
    const built = new CommandRegistry([
        keyboardShortcutsCommand({
          ask,
          shortcuts: () => (holder.registry === undefined ? [] : shortcutListModel(holder.registry)),
        }),
        openCommand,
        // §10.3's six start-screen shortcuts: the same open, then the feature's section.
        ...featureShortcutCommands({ open: () => openDocument(openDeps), settings }),
        showAboutCommand({ client, ask }),
        donateCommand({ client, ask }),
        // RE-ASKS MAIN WHICH SECRETS ARE STORED when a key moved, so the cloud
        // tool appears the moment its key lands rather than on the next launch.
        showSettingsCommand({
          client,
          settings,
          ask,
          onSecretsChanged: () => {
            refreshSecrets();
          },
        }),
        aiSetup,
        showWordCountCommand({ client, ask, track }),
        compareDocumentsCommand({ client, ask, track }),
        translatePageCommand({ client, onApplied: applied, ask, toast, track, storedSecrets: () => storedSecrets }),
        inspectPageStructureCommand({ client, ask }),
        accessibilityCheckCommand({ client, ask }),
        readBarcodesCommand({ client, ask }),
        // TAKES THE SETTINGS STORE, which no other command here does. The
        // personal dictionary is what makes this feature manageable rather than
        // fixed, and it is a preference rather than document state — so it
        // lives in §10.4's registry, and the command that adds to it is the one
        // that has to reach it.
        checkSpellingCommand({ client, settings, ask, track }),
        revealLogCommand({ client }),
        // THREE ROTATIONS, one factory. D2's row is a surface over the command
        // Stage 0 already declared — `rotatePages` takes the quarter turns, so
        // 180 and 270 needed no new command and no new contract entry.
        rotatePageCommand({ client, onApplied: applied, ask }, 1),
        rotatePageCommand({ client, onApplied: applied, ask }, 2),
        rotatePageCommand({ client, onApplied: applied, ask }, 3),
        // THE FIRST DESTRUCTIVE COMMAND, and it registers exactly like the
        // three above it. What is different is invisible here and deliberately
        // so: its log entry is terminal, and undoing it restores the checkpoint
        // the bus took rather than an inverse (ADR-0037).
        insertBlankPageCommand({ client, onApplied: applied, ask }),
        duplicatePageCommand({ client, onApplied: applied, ask }),
        deletePageCommand({ client, onApplied: applied, ask }),
        // THE FIRST COMMAND WHOSE ARGUMENTS COME FROM A DIALOG. Its `run`
        // awaits an answer and dispatches only if there was one, which is the
        // whole of the mutation-dialog gate (ADR-0038).
        deletePagesCommand({ client, onApplied: applied, ask }),
        cropPagesCommand({ client, onApplied: applied, ask }),
        protectDocumentCommand({ client, onApplied: applied, ask }),
        sanitizeDocumentCommand({ client, onApplied: applied, ask }),
        signDocumentCommand({ client, onApplied: applied, ask }),
        signaturesCommand({ client, onApplied: applied, ask }),
        docusignSendCommand({
          client,
          onApplied: applied,
          ask,
          docusignReady: () => docusignKeyStored,
        }),
        docusignRetrieveCommand({
          client,
          onApplied: applied,
          ask,
          docusignReady: () => docusignKeyStored,
        }),
        redactMatchesCommand({ client, onApplied: applied, ask }),
        applyRedactionsCommand({ client, onApplied: applied, ask }),
        watermarkPagesCommand({ client, onApplied: applied, ask }),
        headerFooterCommand({ client, onApplied: applied, ask }),
        batesNumberCommand({ client, onApplied: applied, ask }),
        pageTransitionCommand({ client, onApplied: applied, ask }),
        pageBackgroundCommand({ client, onApplied: applied, ask }),
        resizePagesCommand({ client, onApplied: applied, ask }),
        deskewPagesCommand({ client, onApplied: applied, ask }),
        // TAKES `track` AS WELL AS THE THREE ABOVE, and it is the first mutating
        // command to: recognition is 3.8–4.4 s per page and this one dispatches
        // once per page, so the status bar is where a reader watches it and where
        // the cancel lives.
        // THE SAME TWO FACTS the region tools are offered on (`cloudReady`, `claudeReady`
        // below), so the dialog's handwriting sentence names a tool that is there.
        recogniseTextCommand({
          client,
          onApplied: applied,
          ask,
          track,
          servicesReady: () => azureReady || claudeKeyStored,
        }),
        // THE SAME WALK AND ONE MORE CHANNEL. D6 row 5 is *export searchable PDF*,
        // and once rows 2 and 3 landed there was nothing left but the sequence —
        // which is why it registers beside the command it shares a walk with
        // rather than growing a pipeline of its own.
        exportSearchableCommand({
          client,
          onApplied: applied,
          ask,
          track,
          servicesReady: () => azureReady || claudeKeyStored,
        }),
        // D2's ENHANCE-SCANS ROW, whose trigger fires in this stage. It needs no
        // dialog — the levels come from each image's own histogram — and it reads the
        // page kinds for the same reason the OCR commands do: levelling is only
        // meaningful where the page's content is a raster.
        enhanceScansCommand({ client, onApplied: applied, ask, track }),
        // D9's DOCUMENT SCAN ROW, enhance's shape and its walk: the image-only pages,
        // one command, one undo.
        straightenScansCommand({ client, onApplied: applied, ask, track }),
        insertImageCommand({ client, onApplied: applied, ask }),
        // D9's MARKDOWN ROW. The new document arrives as a tab by `openCommand`'s
        // callbacks; the append also adds a tab, then returns to the document it
        // changed (ADR-0060's correction).
        newFromMarkdownCommand({ client, ask, onOpened: opened, onAlreadyOpen: activate }),
        // D9's CSV ROW, the same callbacks: a composed table arrives as a tab.
        newFromCsvCommand({ client, ask, onOpened: opened, onAlreadyOpen: activate }),
        // D9's IMAGES ROW, the same callbacks: the composed pages arrive as a tab.
        newFromImagesCommand({ client, ask, onOpened: opened, onAlreadyOpen: activate }),
        // D9's OPEN FROM URL, the same callbacks: a fetched document arrives as a tab.
        openFromUrlCommand({ client, ask, onOpened: opened, onAlreadyOpen: activate }),
        // CLOUD STORAGE (ADR-0091): the same two callbacks, so a cloud file arrives as a tab.
        cloudStorageCommand({ client, ask, onOpened: opened, onAlreadyOpen: activate }),
        saveBackCommand({ client, ask, toast, onSaved }),
        // D9's WEBCAM ROW, the same callbacks: the pictures arrive as a tab.
        newFromCaptureCommand({ client, ask, onOpened: opened, onAlreadyOpen: activate }),
        appendMarkdownCommand({
          client,
          onApplied: applied,
          ask,
          onOpened: opened,
          onActivate: activate,
        }),
        mergeDocumentCommand({ client, onApplied: applied, ask }),
        insertFromPdfCommand({ client, onApplied: applied, ask }),
        replacePageCommand({ client, onApplied: applied, ask }),
        importPageAsLayerCommand({ client, onApplied: applied, ask }),
        // D9's EDIT PAGE IN ANOTHER APP: its reimport opens the edited page as a tab, so it takes
        // `appendMarkdownCommand`'s two callbacks as well as `replacePageCommand`'s (ADR-0062).
        editPageExternallyCommand({
          client,
          onApplied: applied,
          ask,
          onOpened: opened,
          onActivate: activate,
        }),
        extractPagesCommand({ client, onApplied: applied, ask, toast }),
        splitDocumentCommand({ client, onApplied: applied, ask }),
        exportPageImagesCommand({ client, onApplied: applied, ask }),
        exportTextCommand({ client, onApplied: applied, ask }),
        exportLayoutTextCommand({ client, onApplied: applied, ask }),
        exportWordCommand({ client, onApplied: applied, ask }),
        exportPowerPointCommand({ client, onApplied: applied, ask }),
        exportExcelCommand({
          client,
          onApplied: applied,
          ask,
          // THE SAME TWO FACTS the OCR tool's engines are offered on (`cloudReady`, `claudeReady`
          // below): a service is offered where its key is stored, and nowhere else (ADR-0086).
          tableEngines: () => [
            'automatic',
            ...(azureReady ? (['azure'] as const) : []),
            ...(claudeKeyStored ? (['claude'] as const) : []),
          ],
        }),
        printCommand({ client, onApplied: applied, ask }),
        emailCommand({ client, onApplied: applied, ask }),
        exportPdfaCommand({ client, onApplied: applied, ask }),
        optimizeCommand({ client, onApplied: applied, ask, track, toast }),
        generateTocCommand({ client, onApplied: applied, ask }),
        findDuplicatePagesCommand({ client, onApplied: applied, ask }),
        undoCommand({ client, onApplied: applied, ask }),
        redoCommand({ client, onApplied: applied, ask }),
        saveCommand({ client, ask, toast, onSaved }),
        closeTabCommand({ close: (docId) => requestClose([docId]) }),
        closeOthersCommand({ close: requestClose }),
        // THE SHELL'S OWN `activeId` AND `setCompareId`, which is what keeps this a second ROUTE
        // to the compare pane rather than a second owner of it: the picker writes the same value.
        openSideBySideCommand({ focused: readActiveId, compare: setCompareId, settings }),
        saveCopyCommand({ client, onApplied: applied, ask, toast }),
        exportFormDataJsonCommand({ client, onApplied: applied, ask }),
        exportFormDataXfdfCommand({ client, onApplied: applied, ask }),
        exportFormDataFdfCommand({ client, onApplied: applied, ask }),
        importFormDataJsonCommand({ client, onApplied: applied, ask }),
        importFormDataXfdfCommand({ client, onApplied: applied, ask }),
        importFormDataFdfCommand({ client, onApplied: applied, ask }),
        // THE COMMENTS' FILES, Review › Comment files (ADR-0077).
        importAnnotationsXfdfCommand({ client, onApplied: applied, ask }),
        importAnnotationsFdfCommand({ client, onApplied: applied, ask }),
        importAnnotationsJsonCommand({ client, onApplied: applied, ask }),
        // THE CLIPBOARD'S PASTE, beside the import it is: main mints the same command.
        pasteAnnotationsCommand({ client, onApplied: applied, ask, hasCopied: readHasCopied }),
        exportAnnotationsXfdfCommand({ client, onApplied: applied, ask }),
        exportAnnotationsFdfCommand({ client, onApplied: applied, ask }),
        exportAnnotationsJsonCommand({ client, onApplied: applied, ask }),
        detectFlatFieldsCommand({ client, onApplied: applied, ask }),
        // EDIT TEXT, a MODE in the tool slot (ADR-0096): it toggles as a drawing
        // tool's command does, and `editing` below is what the mode draws.
        editTextCommand({ activeTool: readTool, onSelect: setToolId }),
        editPageObjectCommand({ client, onApplied: applied, ask }),
        // NO DEPS: it takes the caret to the find bar and searches nothing, so
        // there is no client for it to hold. A command needing none is what a
        // command that acts on a surface looks like.
        findCommand({ settings }),
        // THE TWO LISTS, from their own ribbon sections (the placement audit, 2026-09-23).
        showPanelCommand({ settings }, 'comments'),
        showPanelCommand({ settings }, 'forms'),
        movePageCommand({ client, onApplied: applied, ask }, 'earlier'),
        movePageCommand({ client, onApplied: applied, ask }, 'later'),
        // §7's SELECTED-TEXT MENU. The markups dispatch through the one dispatcher, drawn in the
        // tools' own style; *Search* opens the Search panel and seeds the find field.
        ...(() => {
          const textDeps: TextSelectionDeps = {
            selection: () => textSelection,
            place: dispatch,
            style: () => style,
            // THE BROWSER'S OWN COPY, run by main on this window: the selection is still the
            // page's (the menu keeps it), and what it copies as is what the chord would copy.
            copy: () => {
              void client['window.copy']({});
            },
            search: (text) => {
              showSearchPanel(settings);
              setFindSeed((previous) => ({ text, nonce: (previous?.nonce ?? 0) + 1 }));
            },
          };
          return [
            copySelectionCommand(textDeps),
            ...markupSelectionCommands(textDeps),
            // ASK IS THIS COMMAND'S ALONE, not a member of `TextSelectionDeps`: it is the only
            // item in this menu that opens a dialog, and widening the shared interface would
            // hand five commands a capability none of them may use.
            commentSelectionCommand({ ...textDeps, ask }),
            redactSelectionCommand(textDeps),
            searchSelectionCommand(textDeps),
            // THE ASSISTANT'S FOUR (ADR-0088), after the menu's own seven: each names the words
            // and a question, and `askAssistant` reveals the panel that asks it.
            ...assistantSelectionCommands({ selection: () => textSelection, ask: askAssistant }),
          ];
        })(),
        zoomCommand('in', { onZoom: changeZoom }),
        zoomCommand('out', { onZoom: changeZoom }),
        fitCommand('width', { onZoom: changeZoom }),
        fitCommand('page', { onZoom: changeZoom }),
        // STAGE 3's SHAPE TOOLS, registered in both registries under one id
        // each. What these commands do is select; what the drag does is
        // `registries/tools.ts`' business, and the shared id is the join.
        // SPREAD from one list rather than named individually, so the set of
        // tools has one place it is written down.
        ...shapeToolCommands({
          activeTool: readTool,
          onSelect: setToolId,
          // THE PAIR, `azureReady` above — one name for it, not a second spelling here.
          cloudReady: () => azureReady,
          // ONE INPUT: the Anthropic API needs no endpoint setting (ADR-0057).
          claudeReady: () => claudeKeyStored,
        }),
        deleteSelectionCommand(selectionDeps),
        // ASK IS PASSED PER COMMAND, `commentSelectionCommand`'s rule: only the
        // annotation-menu items that open a dialog receive it, and widening
        // `SelectionCommandDeps` would hand every selection command a
        // capability none of the others may use. *Corrected 2026-09-21:* this
        // said *this command's alone*, which stopped being true when *Reply*
        // joined it — the rule was never about there being one.
        editSelectionCommand({ ...selectionDeps, ask }),
        replySelectionCommand({ ...selectionDeps, ask }),
        draftReplyCommand({ selection: readSelection, ask: askAssistant }),
        summariseCommentsCommand({ ask: askAssistant }),
        openAssistantCommand({ open: openAssistant }),
        copyAnnotationsCommand({ ...selectionDeps, client, ask, onCopied: setCopiedCount }),
        selectionPropertiesCommand({ ...selectionDeps, settings }),
        ...nudgeSelectionCommands(selectionDeps),
        toggleRulersCommand({ settings }),
        toggleGridCommand({ settings }),
        toggleDarkPageCommand({ settings }),
        toggleLoupeCommand({ settings }),
        toggleSplitViewCommand({ settings }),
        commandPaletteCommand({ onToggle: togglePalette }),
        // §7's CHROME VISIBILITY, as commands: a hidden surface is restorable from the palette and
        // a chord because these exist, not because its own control survives being hidden.
        toggleQuickToolbarCommand({ settings }),
        togglePanelCommand({ settings }),
        toggleContextPanelCommand({ settings }),
        // §7'S LAYOUT-MODE SWITCH and §10.3's "Esc returns": one command per mode, and Leave Focus.
        ...layoutModeCommands({ settings }),
        pageMoveCommand('next', { navigator }),
        pageMoveCommand('previous', { navigator }),
        pageMoveCommand('first', { navigator }),
        pageMoveCommand('last', { navigator }),
        historyCommand('back', { navigator }),
        historyCommand('forward', { navigator }),
        goToCommand(),
      ]);
    holder.registry = built;
    return built;
  }, [
      activate,
      aiSetup,
      applied,
      ask,
      // THE DOCUMENT ON SHOW, which *open side by side* needs beside the one the
      // tab menu hands it. Rebuilding the registry when the focused tab changes
      // is the same cheap, deliberate cost the selection already pays.
      readActiveId,
      // WHETHER *PASTE ANNOTATIONS* EXISTS, which changes when a copy succeeds.
      readHasCopied,
      // THE PREDICATES' INPUTS: `cloudReady` and the others close over this
      // render's answers, so without these a service's tools would stay hidden
      // however many keys were entered. Each is main's answer to *is a key
      // stored*, never the key.
      azureReady,
      claudeKeyStored,
      docusignKeyStored,
      // *TRANSLATE THIS PAGE* offers the providers with a key, read from this list when it runs.
      storedSecrets,
      changeZoom,
      client,
      navigator,
      openCommand,
      openDeps,
      requestClose,
      togglePalette,
      opened,
      readTool,
      // THE SETTINGS COMMAND'S `onSecretsChanged` closes over it, so a key
      // entered in Settings is what the predicates above read next.
      refreshSecrets,
      selectionDeps,
      settings,
      track,
      // THE FILE-WRITING COMMANDS' TWO CALLBACKS. Both are stable — `useCallback` over a store
      // and over `setTabs` — so listing them rebuilds the registry never rather than on every
      // render, which is the property that matters here and not their presence in the list.
      toast,
      onSaved,
      // THE SELECTED-TEXT MENU reads these three: the selection its `when` asks about, the one
      // dispatcher, and the style a markup is drawn in.
      textSelection,
      dispatch,
      style,
      // THE ASSISTANT'S ITEMS (ADR-0088): the one way to ask, and the annotation selection
      // *Draft a reply* reads.
      askAssistant,
      readSelection,
      openAssistant,
    ]);

  /**
   * What the scroller needs to let a reader draw: the active tool, and where a
   * finished gesture's command goes.
   *
   * ## The THIRD caller of `applyDocumentCommand`, and it is a surface
   *
   * `movePage`'s note names the shape: a drag carries values a registered
   * `run(context)` cannot, so it dispatches outside the registry — and it must
   * do the same four things, or the two drift. An overlay is the same case with
   * a rectangle instead of two indices.
   *
   * ## `undefined` whenever there is nothing to draw on
   *
   * No tool selected, or no document focused, and no overlay is mounted at all.
   * The second half matters as much as the first: a tool left active while the
   * reader closes every tab would otherwise reach for a `docId` that is gone.
   */
  const drawing = useMemo(() => {
    const tool = tools.get(toolId);
    if (tool === undefined || open === undefined) return undefined;
    const docId = open.docId;
    return {
      tool,
      onCommand: (command: RenderableCommand): void => {
        void applyDocumentCommand({ client, onApplied: applied, ask }, docId, command);
      },
      selection,
    };
  }, [applied, ask, client, open, selection, toolId, tools]);

  /**
   * Edit text's mode on the document on show, or `undefined` when it is off
   * (ADR-0096).
   *
   * ## The tool slot, not a slot of its own
   *
   * `EDIT_TEXT_TOOL_ID` lives in `toolId`, so choosing a drawing tool leaves
   * the mode and choosing Edit text leaves the drawing tool — one question,
   * *what does a press on the page do*, with one answer.
   *
   * ## A refused read says so ONCE, and leaves the mode
   *
   * Every visible page asks for its blocks, so a machine without the editing
   * engine would otherwise raise the same sentence once per page. The first
   * refusal is reported and the mode is left; the others see the mode gone.
   */
  const editing = useMemo<PageListProps['editing']>(() => {
    if (toolId !== EDIT_TEXT_TOOL_ID || open === undefined) return undefined;
    const { docId } = open;
    /** Whether this mode has reported a refused read already — once per entry into it. */
    const refusal = { reported: false };
    const deps = { client, onApplied: applied, ask };
    return {
      version: open.version,
      read: async (page) => {
        const answer = await client['document.textBlocks']({ docId, page });
        if (answer.ok) return answer.value;
        if (!refusal.reported) {
          refusal.reported = true;
          reportProblem(deps, answer.error);
          setToolId(undefined);
        }
        return undefined;
      },
      onCommit: (page, block, text, version) =>
        commitTextBlock(deps, docId, page, block, text, version),
      onPromote: (page) => {
        void promoteTextOnPage(deps, docId, page);
      },
      onLeave: () => {
        setToolId(undefined);
      },
    };
  }, [applied, ask, client, open, toolId]);

  // The start screen's context: no document focused. `hasSelection` and `dirty`
  // are false because there is nothing to select in and nothing to dirty — not
  // because they are unknown.
  const context = useMemo(
    () => ({
      docId: open?.docId,
      version: open?.version,
      // TEXT SELECTED in the focused document's text layer — the selected-text menu's condition.
      hasSelection: textSelection !== undefined,
      dirty: false,
      // WHERE THE READER IS, told by the scroller. `undefined` with no document
      // rather than a defaulted `FIRST_PAGE.kernel`: a command that ran against
      // page 0 of a document nobody opened is exactly the plausible-looking
      // action this type exists to make unrepresentable.
      page: open === undefined ? undefined : currentPage,
      // FROM THE PARSER, threaded up by the scroller, for the reason the
      // scroller takes it from there: the view model needs an engine session
      // and this number must exist wherever PDF.js can read the file.
      pageCount: open === undefined ? undefined : pageCount,
      // THE SAME `tabs` THE COMPARE PICKER TAKES, not a second list. ADR-0040's
      // commands name a second document by `DocId` and the shell is what holds
      // the ids; a command reading them from anywhere else would be the second
      // answer `pageCount`'s note above is about.
      openDocuments: tabs,
    }),
    [currentPage, open, pageCount, tabs, textSelection],
  );

  useShortcuts(registry, context);
  useTheme(settings);

  // THE FIRST-RUN AI SETUP (see `settingsLoaded` above), offered once per launch.
  const offeredSetup = useRef(false);
  useEffect(() => {
    if (offeredSetup.current || !settingsLoaded || !secretsKnown) return;
    offeredSetup.current = true;
    if (settings.get(AI_SETUP_AT_START_SETTING.id) !== true) return;
    if (AI_PROVIDER_KEY_SETTING_IDS.some((id) => storedSecrets.includes(id))) return;
    void aiSetup.run(context);
  }, [aiSetup, context, secretsKnown, settings, settingsLoaded, storedSecrets]);
  // THE WINDOW'S OWN CONTROLS, painted like the title bar they sit over, from what the bar computed.
  useWindowControlsOverlay(client);

  // A SEPARATE ATTRIBUTE AND A SEPARATE EFFECT, because it is a separate
  // concern: the theme paints the shell and this paints the document. Folding
  // it into `useTheme` would put two unrelated triggers behind one subscription
  // and make a reader work out which of them a change was about.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      applyDarkPage(root, settings.get(DARK_PAGE_SETTING.id) === true);
    };
    apply();
    // `watch`, not `subscribe`: a stored value arrives as a hydrate, after this runs.
    return settings.watch([DARK_PAGE_SETTING.id], apply);
  }, [settings]);

  return (
    // THE WINDOW'S BOUNDARY, the outermost one, and INSIDE this component for the reason the
    // page area's is (§10.5a): the tabs, the focused document and the dialog state live above
    // it, so a retry redraws the window around what was open. Before it, the page area's was
    // the only one, so a throw in the title bar, the ribbon, the start screen or a panel
    // outside the view reached the root and React unmounted everything — a blank window,
    // measured 2026-09-21. A throw in THIS function's own body is still out of reach: a
    // boundary catches its children, never its parent.
    <ErrorBoundary
      fallback={({ reset }) => (
        <main className="m-document-surface">
          <div className="m-window-problem">
            <ViewProblem scope="window" onRetry={reset} />
          </div>
        </main>
      )}
    >
    <main className="m-document-surface" data-layout={layoutMode}>
      {/* THE TITLE BAR, drawn in every mode and with no document too: the
          command search and the layout switcher are the application's, not a
          document's. It carries the open documents, which is what the rest of
          the surface is about — the strip names which document every panel, the
          status bar and every command below refer to. */}
      <TitleBar registry={registry} context={context} settings={settings}>
        <DocumentTabs
          // §7's TAB MENU, with the right-clicked tab's document as the context's — so *Close* closes
          // that tab. Its page and version are the focused document's only when it IS the focused
          // one: a tab in the background has no page on show, and an item must not act on another's.
          menu={(docId, contents) => (
            <ContextMenuArea
              registry={registry}
              context={docId === context.docId ? context : { ...context, docId, version: undefined, page: undefined, pageCount: undefined }}
              menus={['tab']}
            >
              {contents}
            </ContextMenuArea>
          )}
          tabs={tabStrip}
          activeId={activeId}
          onSelect={activate}
          onClose={(docId) => {
            void requestClose([docId]);
          }}
          // THE REGISTERED COMMAND'S OWN `run`, not a second way to open a
          // document. The strip is where *open another* belongs — it exists
          // exactly when a document is open, which is exactly when the start
          // screen's copy is gone.
          onOpen={() => {
            void openCommand.run(context);
          }}
        />
      </TitleBar>
      {/* THE RAIL AND THE RIBBON, directly under the title bar, which is §10.3's
          order — and INSIDE the document branch, not above it.

          Above it, the ribbon rendered beside the start screen, and `Open a
          document` is placed on both: two buttons with one name, on screen at
          once. That is the duplication this whole surface is supposed to remove,
          arriving through the seam rather than through a hand-written list. A
          `when` on the open command would have been the wrong fix — the command
          is available with no document open, which is exactly when the start
          screen offers it. The ribbon is DOCUMENT chrome; the start screen is
          what there is instead. */}
      {open === undefined ? (
        // ONE GRID AREA for the start screen and its recent list, spanning the rail's
        // column: no rail is drawn with no document (`Ribbon` renders nothing).
        <div className="m-start-area">
          <StartScreen registry={registry} context={context} problem={openProblem} />
          {/* BESIDE the projection, not inside it: a recent file is data with a
              control, not a registered command, and registering one per row
              would mean rebuilding the registry whenever the list changed. */}
          <RecentFiles client={client} onOpened={opened} />
          {/* THE FOOTER, after the recent list because §10.3 puts it there (see `StartFooter`). */}
          <StartFooter registry={registry} context={context} version={appVersion} />
        </div>
      ) : (
        // THE ERROR BOUNDARY, AND ITS POSITION IS THE GUARANTEE (§10.5a).
        //
        // It sits HERE — inside this component, around the view — rather than
        // around `<App>`, and that placement is what makes "reload is cheap"
        // true rather than hopeful. `open`, `zoomMode`, `currentPage` and the
        // scroll request all live in this component, ABOVE the boundary, so a
        // reset re-renders the view from state the failure never touched: the
        // same document, the same page, the same zoom. A boundary around the
        // whole app would have to restore all three, and a restore is a
        // mechanism that can be wrong where a position cannot (B5).
        //
        // `key` on the document, so opening a different file clears a caught
        // error rather than showing the previous document's failure over the
        // new one — a boundary that latches is a document you cannot open.
        //
        // THE RETRY'S REMOUNT STARTS WHERE THE READER WAS, because the scroller
        // reveals its `startAt` itself on mount. Holding the state above the
        // boundary was not enough alone — measured: a reset remounts the scroller,
        // which seeded its first page and reported it, so a reader who threw on
        // page 40 came back to page 1 with every piece of state intact. The retry
        // re-issued a `goTo` for that until 2026-09-18, when the reveal moved into
        // the scroller because an edit remounts it too and no caller's request can
        // reach the scroller that mounts after it (`PageList`'s `revealedStart`).
        <>
        <Ribbon registry={registry} context={context} settings={settings} />
        {/* THE BODY AREA, one element whatever the view renders: a scroller, a
            loading placeholder or a failed canvas. Each of those is otherwise a
            grid item the shell would have to name, and a new state would land in
            no area. */}
        <div className="m-body-area">
        <ErrorBoundary
          key={open.docId}
          fallback={({ reset }) => (
            <ViewProblem
              onRetry={() => {
                reset();
              }}
            />
          )}
        >
        <PageCanvas
          client={client}
          document={open}
          onVersionMoved={opened}
          onCurrentPage={viewed}
          onPageBox={pageBoxed}
          mode={zoomMode}
          onZoom={changeZoom}
          onShownZoom={setShownZoom}
          goTo={goTo}
          onWentTo={wentTo}
          onPageCount={counted}
          current={currentPage}
          onJump={navigator.jumpTo}
          onMove={movePage}
          onSwap={swapPages}
          loupe={loupe}
          rulers={rulers}
          showGrid={showGrid}
          unit={unit}
          split={split}
          // COMPARE, and the second pane is where it lives: it is the split
          // view's pane showing a different document rather than a third
          // surface. `others` is every open document, including this one —
          // *this document* is a choice a reader returns to, not an absence.
          compare={compared}
          onComparePage={comparedAt}
          compareGoTo={compareGoTo}
          onCompareWentTo={compareWentTo}
          drawing={drawing}
          editing={editing}
          others={tabs}
          onCompare={setCompareId}
          search={search ?? undefined}
          secondRenderer={secondRenderer}
          requestPassword={requestPassword}
          settings={settings}
          // §10.3's RIGHT CONTEXTUAL PANEL, built here where its state lives, and hosted by
          // `PageCanvas`' row beside the page area (design pass D).
          // §10.3's FLOATING QUICK TOOLBAR, placed inside the page area it floats over (pass F).
          quickToolbar={<QuickToolbar registry={registry} context={context} settings={settings} />}
          // §7's PAGE MENU, with the page right-clicked as the context's page — so every item acts on
          // that page and every `when` is asked about it. On the page holding the selected annotations
          // the annotation group comes first: the selection's page is where its actions belong.
          pageMenu={(page, element) => (
            <ContextMenuArea
              registry={registry}
              context={{ ...context, page }}
              menus={[
                ...(textSelection?.page === page ? (['selection'] as const) : []),
                ...(selection?.page === page ? (['annotation'] as const) : []),
                'page',
              ]}
            >
              {element}
            </ContextMenuArea>
          )}
          contextPanel={
            <ContextPanel
              assistant={
                // THE ASSISTANT TAB (ADR-0083). It takes the same stored-secret list the
                // other key-gated surfaces take, so *which providers have a key* is
                // answered in one place, and the event subscriber `App` was given.
                //
                // THE FOCUSED DOCUMENT AND ITS STORE (ADR-0088): the conversation lives in the
                // store, and a citation goes to its page through the navigator every other
                // jump takes, so Back returns from it.
                <AssistantPanel
                  client={client}
                  focused={
                    activeId === undefined || store === undefined
                      ? undefined
                      : { docId: activeId, store, page: currentPage }
                  }
                  onGoTo={navigator.jumpTo}
                  // THE DOCUMENT ON THE RIGHT, only while split view is showing a compared one:
                  // that is when two documents are side by side and the owner's *Left · Right ·
                  // Both* has something to choose between (ADR-0089).
                  beside={
                    split && compared !== undefined
                      ? {
                          docId: compared.docId,
                          page: comparePage?.docId === compared.docId ? comparePage.page : FIRST_PAGE.kernel,
                        }
                      : undefined
                  }
                  onGoToBeside={setCompareGoTo}
                  onReply={dispatch}
                  onNote={noteFromAnswer}
                  request={assistantRequest}
                  handled={assistantHandled}
                  onHandled={setAssistantHandled}
                  storedSecrets={storedSecrets}
                  subscribe={subscribe}
                />
              }
              settings={settings}
            >
              {/* THE STYLE CONTROLS, which take no document at all: they set what the
                  NEXT annotation is drawn in, so they do not change when the version
                  moves. That is what makes them settings rather than document state. */}
              <StylePanel settings={settings} />
              {/* THE OTHER HALF: what the selected annotations look like now, and the
                  command that changes them. Takes the same resolved style the tools
                  take, so *Apply* writes what the controls above say. */}
              <CommentStylesPanel onApply={restyleSelection} selection={selection} style={style} />
            </ContextPanel>
          }
          // §10.3's DOCUMENT PANELS other than Pages, built here where their state lives.
          // `PageCanvas` hosts them beside the thumbnail strip, which needs its document
          // view; one of the six shows at a time (`DocumentPanel`).
          panels={{
            // THE OUTLINE, keyed on the document rather than the page — it is a
            // property of the document — and the links on the page beside it: both
            // are things a person jumps to, which is what a bookmark is.
            bookmarks: (
              <>
                <DestinationsPanel
                  client={client}
                  docId={open.docId}
                  version={open.version}
                  onJump={navigator.jumpTo}
                />
                <LinksPanel
                  client={client}
                  docId={open.docId}
                  page={context.page}
                  onJump={navigator.jumpTo}
                />
              </>
            ),
            // Keyed on the version: every drawing tool moves it, so the list is re-read
            // after the rectangle just drawn and after an undo of it.
            comments: (
              <AnnotationsPanel
                client={client}
                docId={open.docId}
                onJump={navigator.jumpTo}
                onRemove={removeAnnotation}
                version={open.version}
              />
            ),
            // Keyed on the version, and every control writes, so a row from a previous
            // version's walk would fill a field by arithmetic.
            forms: (
              <FormsPanel
                client={client}
                docId={open.docId}
                onDelete={deleteFormField}
                onFill={fillFormField}
                onFlatten={flattenForm}
                onJump={navigator.jumpTo}
                version={open.version}
              />
            ),
            // Keyed on the version: its own toggle is a command that moves it.
            layers: <LayersPanel client={client} docId={open.docId} version={open.version} />,
            // E2's substrate, reached by a person. `onHighlight` is the setter itself,
            // which React keeps stable, and `commands` are the three every dispatch takes.
            search: (
              <FindBar
                client={client}
                docId={open.docId}
                page={context.page}
                pageCount={pageCount}
                onJump={navigator.jumpTo}
                onHighlight={setSearch}
                seed={findSeed}
                commands={{ client, onApplied: applied, ask }}
              />
            ),
          }}
        />
        </ErrorBoundary>
        </div>
        </>
      )}
      {palette ? (
        <CommandPalette registry={registry} context={context} onClose={closePalette} />
      ) : null}
      {/* NOTHING WITH NO DOCUMENT, for `QuickToolbar`'s reason: a status bar
          reporting page 1 of 0 at 100% over the start screen is a control that
          describes nothing. */}
      {open === undefined || pageCount === undefined ? null : (
        <StatusBar
          name={open.name}
          page={currentPage}
          pageCount={pageCount}
          zoom={shownZoom}
          // THE SAME `jumpTo` a key, a thumbnail and an outline entry dispatch,
          // so a typed page is recorded in the history exactly as those are.
          onGoTo={navigator.jumpTo}
          // THE SAME setter the zoom commands take, so the slider has no second owner.
          onZoom={changeZoom}
          // The bar's buttons are projected from here (ADR-0067).
          registry={registry}
          context={context}
          task={task}
          saved={saved}
        />
      )}
      {/* ALWAYS MOUNTED, unlike the status bar above and deliberately so: a live region
          announces what changes inside it, so a strip that arrived with its first message
          would be the change itself and a screen reader would hear nothing. It is also
          outside the `open === undefined` guard because a toast outlives the document that
          raised it — the close path's *Save* confirms a save whose tab is already gone. */}
      <ToastStrip
        toasts={toasts}
        dismissLabel={TOAST_DISMISS}
        onDismiss={dismissToast}
        lifetime={TOAST_LIFETIME}
      />
      {/* The ONE mount point. `DialogHost` renders nothing when none is open —
          not a hidden dialog — so this is not a control that renders and does
          nothing; it is the seam every dialog arrives through. */}
      <DialogHost
        registry={dialogs}
        closeLabel={CLOSE_LABEL}
        open={openDialog}
        onClose={close}
        onResolve={resolveDialog}
        onUpdate={reportDialog}
      />
    </main>
    </ErrorBoundary>
  );
}

/**
 * Dispatches a registered chord from a real key press.
 *
 * ## The map is built once per registry, not once per key
 *
 * `shortcutsFor` walks every command and throws on a collision, so building it
 * inside the handler would turn a startup error into one that fires on the first
 * keystroke — and would rebuild it on every press for a set that cannot change
 * between them.
 *
 * ## `preventDefault` only when the chord was CLAIMED
 *
 * `dispatchChord` answers `unclaimed` for a chord no available command declares,
 * and the browser must keep that one: an application that swallowed every
 * shortcut to run nothing is the bug report nobody can reproduce. So the answer
 * decides, which is why `run` is not awaited — the caller needs the verdict
 * before the event finishes, and a promise arrives too late for
 * `preventDefault`.
 *
 * Bound to the document rather than to the surface: a shortcut is an application
 * affordance, and one that only worked while a particular element had focus
 * would be a shortcut users report as intermittent.
 */
function useShortcuts(registry: CommandRegistry, context: CommandContext): void {
  const map = useMemo(() => shortcutsFor(registry), [registry]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A KEY THE FOCUSED FIELD ANSWERS ITSELF is left to it — `fieldOwnsChord`
      // says which, once.
      if (fieldOwnsChord(event.target, event)) return;
      if (dispatchChord(registry, map, event, context).kind === 'ran') {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [context, map, registry]);
}

/**
 * Applies the theme setting to the root element, and keeps applying it.
 *
 * **This is what makes the setting a setting rather than a registered key.**
 * §10.4's rule for a setting is the wired-tools rule one layer down — a key
 * nothing reads is the display-only sin — so the first one has to be read by a
 * shipped path. It is: `tokens.css` remaps every token under `[data-theme]`, so
 * writing the attribute is the whole of applying it and no component consults
 * this value again.
 *
 * Subscribed rather than read once. The store is not React state, so a value
 * changed by a settings dialog would otherwise take effect on the next unrelated
 * render — which is the shape where a preference appears to work intermittently.
 */
function useTheme(settings: SettingsStore): void {
  // A LAYOUT effect, and the difference is a frame the user can see.
  //
  // Stored settings arrive one IPC round trip after the first paint — nothing
  // waits for them, because a renderer whose first paint depends on main shows a
  // blank window when main is absent. So the theme arrives late by construction,
  // and `useEffect` would apply it AFTER the browser paints, making the
  // correction a visible flash rather than an invisible one. `useLayoutEffect`
  // runs before paint, so the frame that would have shown the wrong theme is
  // never presented.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const highContrast = highContrastWanted();
      applyAppearance(root, settings.get(THEME_SETTING.id) as Theme, highContrast);
      // THE ACCENT IS NOT APPLIED UNDER HIGH CONTRAST. `tokens.css`' `hc` block
      // picks colours that clear against a black ground deliberately, and a
      // user accent layered over them would be the one colour in that theme
      // nobody has checked. Cleared rather than skipped, so turning the
      // platform setting on removes an accent that was already applied.
      const refusal = applyAccent(
        root,
        highContrast ? 'theme' : (settings.get(ACCENT_SETTING.id) as string),
      );
      // A REFUSED ACCENT IS NOT SILENT, and it is not a dialog either: the
      // setting is stored and the theme is correct without it, so the user's
      // next action is unaffected. What a refusal needs is to be findable, and
      // the log is where a diagnostic goes.
      if (refusal !== undefined) console.warn(`Accent not applied: ${refusal}`);
    };
    apply();

    // RE-APPLIED WHEN THE PLATFORM CHANGES ITS MIND, which is the half a
    // settings subscription cannot see: high contrast is turned on outside this
    // application, and a shell that only re-read on a settings change would
    // keep the old theme until the reader happened to change something.
    const watched = HIGH_CONTRAST_QUERIES.map((query) => window.matchMedia(query));
    for (const query of watched) query.addEventListener('change', apply);

    // `watch`, not `subscribe`: the stored theme arrives as a hydrate one round trip
    // after this first applies the fallback, and a hydrate names no single id.
    const unsubscribe = settings.watch([THEME_SETTING.id, ACCENT_SETTING.id], apply);

    return (): void => {
      for (const query of watched) query.removeEventListener('change', apply);
      unsubscribe();
    };
  }, [settings]);
}

/**
 * Page 1 of the open document, rasterised.
 *
 * ## The view is owned by an effect, and torn down by its cleanup
 *
 * A parser, a worker and a transport are resources with a lifetime, and the
 * lifetime that matters is *this component is showing this document at this
 * version*. Opening in an effect and closing in its cleanup makes that the
 * language's job rather than a rule somebody follows — including on the paths
 * that are easy to forget: a version bump, an unmount mid-parse, and a second
 * document opened before the first finished.
 *
 * ## `cancelled` exists because `await` has no undo
 *
 * React can unmount between the `await` and the render, and the view opened by
 * an effect that has already been cleaned up would never be closed by anything.
 * The flag is read after every suspension point for that reason.
 */
function PageCanvas({
  client,
  document: open,
  requestPassword,
  onVersionMoved,
  onCurrentPage,
  onPageBox,
  mode,
  onZoom,
  onShownZoom,
  goTo,
  onWentTo,
  onPageCount,
  loupe,
  current,
  onJump,
  onMove,
  onSwap,
  rulers,
  showGrid,
  unit,
  split,
  compare,
  onComparePage,
  compareGoTo,
  onCompareWentTo,
  others,
  onCompare,
  drawing,
  editing,
  search,
  secondRenderer,
  settings,
  panels,
  contextPanel,
  quickToolbar,
  pageMenu,
}: {
  readonly client: ContractClient;
  readonly document: OpenDocument;
  /** Each drawn page's visible box, for the assistant's *Add as note* — `PageList.onPageBox`. */
  readonly onPageBox: (page: number, crop: readonly [number, number, number, number]) => void;
  readonly onVersionMoved: (next: OpenedDocument) => void;
  /**
   * Wraps a thumbnail or a page slot in the page context menu for that page (§7), built by `App`
   * where the registry is. Handed to this document's thumbnails and both of its panes; never to the
   * compare pane, whose pages belong to another document.
   */
  readonly pageMenu: (page: number, element: ReactElement) => ReactNode;
  readonly onCurrentPage: (page: number) => void;
  readonly mode: ZoomMode;
  readonly onZoom: (next: (shown: number) => ZoomMode) => void;
  readonly onShownZoom: (shown: number) => void;
  readonly goTo: number | undefined;
  readonly onWentTo: () => void;
  readonly onPageCount: (count: number) => void;
  readonly loupe: boolean;
  /** The page the reader is on, so the thumbnail strip can mark it. */
  readonly current: number;
  /** Takes the reader to a page, recording the jump — click-to-jump's other half. */
  readonly onJump: (page: number) => void;
  /** Reorders the document. See the strip's own header for why it is a command. */
  readonly onMove: (from: number, to: number) => void;
  /** Exchanges two pages, from the strip's Shift+click. */
  readonly onSwap: (a: number, b: number) => void;
  readonly rulers: boolean;
  readonly showGrid: boolean;
  readonly unit: RulerUnit;
  /** Whether a second viewport onto the same document is shown. */
  readonly split: boolean;
  /**
   * The document the second pane compares against, or `undefined` for a second
   * view of this one.
   */
  readonly compare: OpenDocument | undefined;
  /** Told the page the compare pane is on — for the assistant's *Right*, never the status bar. */
  readonly onComparePage: (docId: DocId, page: number) => void;
  /** A page of the compared document to go to, from an answer's right-hand citation. */
  readonly compareGoTo: number | undefined;
  readonly onCompareWentTo: () => void;
  /** Every open document, as the compare picker's choices. */
  readonly others: readonly OpenDocument[];
  readonly onCompare: (docId: DocId | undefined) => void;
  /** The active tool and where its commands go. Both panes take it. */
  readonly drawing: PageListProps['drawing'];
  /** Edit text's mode, or `undefined` when it is off. Both panes take it. */
  readonly editing: PageListProps['editing'];
  /** What the find bar last answered, painted over both panes' text layers. */
  readonly search: SearchHighlight | undefined;
  /** Whether §6.1's second engine draws the pages. `viewing.second-renderer`. */
  readonly secondRenderer: boolean;
  /** The settings store, for the document panel's which-panel and open state. */
  readonly settings: SettingsStore;
  /** The document panels other than Pages, built by `App` where their state lives. */
  readonly panels: DocumentPanelProps['panels'];
  /** §10.3's right contextual panel, built by `App` where its state lives. */
  readonly contextPanel: ReactNode;
  /** §10.3's floating quick toolbar, placed inside the page area by `DocumentBody`. */
  readonly quickToolbar: ReactNode;
  /**
   * Asks for an encrypted document's password, or `undefined` on a dismissal.
   *
   * A PROP rather than a dialog opened here, for the reason the tool
   * registrations give: `ask` is bound to the dialog host for that render and
   * cannot be captured by a composition. The name travels with it so the prompt
   * can say which document is asking, which matters with tabs (ADR-0055).
   */
  readonly requestPassword: (name: string, retry: boolean) => Promise<string | undefined>;
}): ReactElement {
  const moved = useCallback(
    (next: { readonly version: DocVersion; readonly byteLength: number }) => {
      // THE NAME IS CARRIED THROUGH, and it is not the command's to change: a
      // rotate that returned a document identity would be a different
      // operation, and dropping the field here would empty the status bar every
      // time a command ran.
      onVersionMoved({
        docId: open.docId,
        name: open.name,
        version: next.version,
        byteLength: next.byteLength,
      });
    },
    [onVersionMoved, open.docId, open.name],
  );

  // THE LIFETIME LIVES IN A HOOK NOW, because compare gave it a second caller.
  // Every hazard it carries — the call-not-variable cancellation flag, the
  // close on the late path, the clear before the close — is stated there.
  // BOUND TO THIS DOCUMENT'S NAME here rather than inside the hook, because the
  // hook holds a `DocId` and a `DocId` is not something a person can read. The
  // name is the one thing about the file the renderer has (invariant L2).
  const askPassword = useCallback(
    (retry: boolean) => requestPassword(open.name, retry),
    [open.name, requestPassword],
  );

  const { ready, failed } = useDocumentView(client, open, moved, askPassword);

  /**
   * Whether the second pane of a split is the one the reader is working in — *focus follows the
   * pane*.
   *
   * ## ONE REPORTER AT A TIME, and the reader decides which
   *
   * The page, the shown zoom and the go-to request have one owner in `App`, and two panes
   * reporting into it would make the status bar follow whichever scrolled last. So the reports
   * are ROUTED: the pane last pressed or focused gets the owner's callbacks and the other gets
   * none. Swapping a callback re-runs the reporting effects in `PageList`, so the newly active
   * pane reports its own page and zoom the moment it is chosen.
   *
   * ## Split view only, never compare
   *
   * A compared document's page is a page of ANOTHER document, and the commands the status bar
   * and the page field drive act on this one — rotate the current page would rotate this
   * document's page by the other's number. So the compare pane keeps its own position and the
   * first pane stays the reporter.
   *
   * Leaving the split hands the reports back to the first pane at once: the value is kept, and
   * read through `split` below, so there is no moment with no reporter.
   */
  const [secondActive, setSecondActive] = useState(false);
  const reporting: 'first' | 'second' = split && compare === undefined && secondActive ? 'second' : 'first';
  const activateFirst = useCallback(() => {
    setSecondActive(false);
  }, []);
  const activateSecond = useCallback(() => {
    setSecondActive(true);
  }, []);

  /**
   * §6.1's second engine, or `undefined` where the setting is off.
   *
   * ## EVERY refusal answers `null`, which is what keeps a page drawn
   *
   * The setting can be on while the engine is not reachable — a build with no
   * `pdfium.dll`, a page too large at this zoom, a document main will not open.
   * All of them mean *PDF.js draws this one*, and none of them means a blank
   * page. So the failures are read and dropped here rather than reported: a
   * dialog for each page of a scroll would be a hundred dialogs, and what a
   * person sees instead is the page, drawn by the other engine.
   *
   * That is a deliberate silence and the only one in this file. It is
   * defensible because the outcome is the ordinary render rather than nothing —
   * a control that silently did nothing would be the wired-tools defect, and
   * this silently does what it did before the setting existed.
   *
   * ## `useCallback`, because `PageList`'s draw effect depends on it
   *
   * An inline arrow would be a new dependency every render, and every page
   * would redraw — through a contained host — on every state change in this
   * component.
   */
  const secondRasteriser = useCallback(
    async (pageNumber: number, width: number, height: number): Promise<ImageBitmap | null> => {
      const answer = await client['document.renderPage']({
        docId: open.docId,
        // ZERO-BASED ON THE WIRE. `pageNumber` is PDF.js's 1-based number
        // because that is what the canvas holds, and `pageNumbering.ts` is the
        // one place that converts — `SHOWN_PAGE`'s whole reason.
        page: kernelPageOf(pageNumber),
        width,
        height,
      });
      if (!answer.ok) return null;
      // `createImageBitmap` IS CHROMIUM'S OWN DECODER, and it is asynchronous
      // and can fail on its own — a truncated PNG throws here rather than
      // drawing something wrong.
      return createImageBitmap(new Blob([answer.value.png], { type: 'image/png' })).catch(
        () => null,
      );
    },
    [client, open.docId],
  );

  // THE COUNT GOES UP, because the navigation commands are registered in `App`
  // and need an end to clamp against. It cannot be read there: the number is
  // the parser's, and the parser lives here.
  //
  // In an effect above the early returns, because a hook cannot be called
  // conditionally — and reporting during render would be a parent state update
  // inside a child's render, which React refuses.
  const pages = ready?.document.numPages;
  useEffect(() => {
    if (pages !== undefined) onPageCount(pages);
  }, [onPageCount, pages]);

  if (failed) {
    // A CANVAS, and the element is the contract rather than the appearance.
    // `canvasHarness.ts` reads `data-failed` off `canvas.m-page` to tell a parse
    // that threw from a render that has not finished — and moving the marker
    // onto a container turned every failure into a sixty-second wait, which is
    // what a working renderer with no display also produces. The two must not
    // share an output.
    //
    // THE DOCUMENT PANEL STAYS BESIDE IT (design pass C). The outline, the annotations, the
    // form fields, the layers and the find field come from main, not from PDF.js, so a
    // document PDF.js cannot parse still has all five. Only the Pages panel is empty,
    // because it is the one that draws through the view that failed.
    return (
      <DocumentBody
        settings={settings}
        panel={<DocumentPanel settings={settings} panels={panels} pages={null} />}
        page={<canvas className="m-page" data-failed="true" />}
        contextPanel={contextPanel} quickToolbar={quickToolbar}
      />
    );
  }

  if (ready === undefined) {
    // NOT A SPINNER: the parser is what knows how many pages there are, so
    // until it opens there is nothing honest to lay out. The failure case above
    // is the one that carries a marker. The document panel is already there, for the
    // failure case's reason: five of its six panels do not wait for PDF.js.
    return (
      <DocumentBody
        settings={settings}
        panel={<DocumentPanel settings={settings} panels={panels} pages={null} />}
        page={<div className="m-page-list" />}
        contextPanel={contextPanel} quickToolbar={quickToolbar}
      />
    );
  }

  return (
    // THE SIDEBAR IS A SIBLING OF THE SPINE, inside this component, because it
    // needs the same parser: a strip that opened its own would parse the
    // document twice and hold two copies of every page it drew.
    //
    // THE PAGE SIDE IS BOTH PANES. `DocumentBody` makes the panel the resizable pane and the rest
    // of the row the other, so split view's second pane shares the page side exactly as it shared
    // the row before.
    <DocumentBody
      settings={settings}
      contextPanel={contextPanel} quickToolbar={quickToolbar}
      panel={
      <DocumentPanel
        settings={settings}
        panels={panels}
        pages={
          <Thumbnails
            client={client}
            docId={open.docId}
            version={open.version}
            view={ready}
            pageCount={ready.document.numPages}
            current={current}
            onJump={onJump}
            onMove={onMove}
            onSwap={onSwap}
            pageMenu={pageMenu}
          />
        }
      />
      }
      page={
      <>
      <PageList
        client={client}
        view={ready}
      // FROM THE PARSER, NOT FROM THE VIEW MODEL, and this is a correction
      // rather than a preference. The count came from `document.viewModel` for
      // one build, which made the whole surface depend on an **engine session**:
      // where none can be created the model is refused, and a viewer that
      // rendered nothing then would show an empty window for a document PDF.js
      // can read perfectly.
      //
      // Measured by `proof:canvaspixels`, which waited 60 seconds for a page
      // that could not arrive. The single-page version never had the coupling —
      // it drew unconditionally and treated the model as advisory — and the
      // scroller reintroduced it by needing a count before it could lay out.
      // PDF.js has the count and needs nobody's permission for it.
        pageCount={ready.document.numPages}
        docId={open.docId}
        version={open.version}
        onCurrentPage={reporting === 'first' ? onCurrentPage : ignorePage}
        onPageBox={onPageBox}
        mode={mode}
        onZoom={onZoom}
        onShownZoom={reporting === 'first' ? onShownZoom : ignoreZoom}
        goTo={reporting === 'first' ? goTo : undefined}
        onActivate={split && compare === undefined ? activateFirst : undefined}
        // WHERE THIS SCROLLER IS MOUNTING, which with tabs is wherever the
        // reader left this document. Seeding page 1 here reported them back to
        // the top of a document they were forty pages into.
        startAt={current}
        onWentTo={onWentTo}
        loupe={loupe}
        rulers={rulers}
        showGrid={showGrid}
        unit={unit}
        drawing={drawing}
        editing={editing}
        search={search}
        // `undefined` WHERE THE SETTING IS OFF, which is what makes the setting
        // the only thing that decides. `PageList` falls back to PDF.js for an
        // absent rasteriser and for one that answers `null`, so the two states
        // reach the same code and neither can leave a page blank.
        secondRasteriser={secondRenderer ? secondRasteriser : undefined}
        pageMenu={pageMenu}
      />
      {/* THE SECOND VIEWPORT, over the SAME parser.
          One document, two scrollers: a pane that opened its own view would
          parse the document twice, start a second worker and hold a second copy
          of every page it drew — which is the sidebar's argument one component
          out, and §9.17's renderer budget is a bitmap cache.

          BOTH PANES MAY RENDER THE SAME PAGE AT ONCE, and that is the property
          this arrangement rests on. Read from the shipped library rather than
          assumed: `PDFPageProxy.render` holds its in-flight tasks in a **Set**
          and adds to it (`pdfjs-dist/build/pdf.mjs:15747`, 6.2.108), completing
          each against its own canvas from one shared operator list. READ, not
          run — happy-dom has no 2d context, so no test here can execute two
          concurrent rasterisations, and this is the first caller that asks for
          them.

          ONE PANE REPORTS AT A TIME. `onCurrentPage`, `onShownZoom` and the
          go-to request have one owner in `App`, and two reporters would make
          the status bar follow whichever pane scrolled last — a reader in the
          left pane pressing PageDown and watching the right one move. So they
          go to the pane the reader last pressed or focused (`reporting`,
          above): *focus follows the pane*. */}
      {split ? (
        // THE PANE IS THE SAME SEAM AND THE PARSER IS THE DIFFERENCE. With
        // nothing chosen this is split view — the second viewport over `ready`,
        // one parse for two panes. With a document chosen it is compare, and a
        // second document is a second parse by necessity: reading one
        // document's pages through the other's parser is not an optimisation
        // available to anybody.
        //
        // The picker is rendered either way, because a control that appears
        // only once you have done the thing it is for is a control nobody
        // finds. With one document open it offers *this document* alone, which
        // is a truthful list of the choices.
        <div className="m-second-pane">
          <ComparePane
            client={client}
            against={compare}
            onCurrentPage={onComparePage}
            goTo={compareGoTo}
            onWentTo={onCompareWentTo}
            others={others}
            onPick={onCompare}
            mode={mode}
            onZoom={onZoom}
            loupe={loupe}
            rulers={rulers}
            showGrid={showGrid}
            unit={unit}
          />
          {compare === undefined ? (
            <PageList
              client={client}
              view={ready}
              pageCount={ready.document.numPages}
              docId={open.docId}
              version={open.version}
              onCurrentPage={reporting === 'second' ? onCurrentPage : ignorePage}
              onPageBox={onPageBox}
              mode={mode}
              onZoom={onZoom}
              onShownZoom={reporting === 'second' ? onShownZoom : ignoreZoom}
              goTo={reporting === 'second' ? goTo : undefined}
              // The same page the first pane starts at, so a split opens on
              // what the reader is looking at rather than at the top.
              startAt={current}
              onWentTo={reporting === 'second' ? onWentTo : ignoreWentTo}
              onActivate={activateSecond}
              loupe={loupe}
              rulers={rulers}
              showGrid={showGrid}
              unit={unit}
              label={SPLIT_SECOND_LABEL}
              // BOTH PANES DRAW, and they are the same document — so an
              // annotation made in one appears in the other on the next render,
              // which is what one document in two viewports means. A pane that
              // could not draw would be a surface where a selected tool
              // silently does nothing.
              drawing={drawing}
              editing={editing}
              // BOTH PANES PAINT the same matches, for the same reason: it is
              // one document, and a split where the search highlighted one half
              // would read as the second pane showing a different document.
              search={search}
              // AND BOTH DRAW WITH THE SAME ENGINE, which is the same argument
              // again: one document in two viewports, and a split where the
              // halves were rasterised differently would show a difference the
              // document does not have.
              secondRasteriser={secondRenderer ? secondRasteriser : undefined}
              // THE SAME DOCUMENT, so the same page menu: a page right-clicked in either pane is a
              // page of this document.
              pageMenu={pageMenu}
            />
          ) : null}
        </div>
      ) : null}
      </>
      }
    />
  );
}

/**
 * The second pane's callbacks, as module constants.
 *
 * Stable identities, so the pane's effects do not re-run on every render of its
 * parent — a fresh arrow per render is a new dependency each time, and the
 * scroller's observer is torn down and rebuilt by exactly that.
 */
const ignorePage = (_page: number): void => undefined;
const ignoreZoom = (_shown: number): void => undefined;
const ignoreWentTo = (): void => undefined;
