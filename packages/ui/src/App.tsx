import type {
  AnnotationRect,
  ContractClient,
  FieldFill,
  MeasureScale,
  RenderableCommand,
} from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';

import {
  applyDocumentCommand,
  imagePagesFor,
  placeImage,
  snapshotRegion,
  findCommand,
  fitCommand,
  deletePageCommand,
  cropPagesCommand,
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
  pageTransitionCommand,
  pageBackgroundCommand,
  resizePagesCommand,
  generateTocCommand,
  insertImageCommand,
  extractPagesCommand,
  insertFromPdfCommand,
  mergeDocumentCommand,
  replacePageCommand,
  splitDocumentCommand,
  deletePagesCommand,
  duplicatePageCommand,
  findDuplicatePagesCommand,
  insertBlankPageCommand,
  rotatePageCommand,
  saveCommand,
  undoCommand,
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
import { CommandPalette } from './CommandPalette.js';
import { ComparePane } from './ComparePane.js';
import { goToCommand, historyCommand, pageMoveCommand } from './commands/navigationCommands.js';
import { DocumentStores } from './documentStores.js';
import { Thumbnails } from './Thumbnails.js';
import { StatusBar } from './StatusBar.js';
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
import { type OpenProblem, openDocumentCommand } from './commands/openDocument.js';
import { revealLogCommand } from './commands/revealLog.js';
import { showAboutCommand } from './commands/showAbout.js';
import { showWordCountCommand } from './commands/showWordCount.js';
import { ABOUT_DIALOG } from './dialogs/about.js';
import { WORD_COUNT_DIALOG } from './dialogs/wordCount.js';
import { SPELL_CHECK_DIALOG } from './dialogs/spellCheck.js';
import { COMMAND_PROBLEM_DIALOG, COMMAND_PROBLEM_DIALOG_ID } from './dialogs/commandProblem.js';
import { CROP_PAGES_DIALOG } from './dialogs/cropPages.js';
import { WATERMARK_PAGES_DIALOG } from './dialogs/watermarkPages.js';
import { HEADER_FOOTER_DIALOG } from './dialogs/headerFooter.js';
import { BATES_NUMBER_DIALOG } from './dialogs/batesNumber.js';
import { PAGE_TRANSITION_DIALOG } from './dialogs/pageTransition.js';
import { RESIZE_PAGES_DIALOG } from './dialogs/resizePages.js';
import { GENERATE_TOC_PROBLEM_DIALOG } from './dialogs/generateTocProblem.js';
import { FLAT_FIELDS_DIALOG } from './dialogs/flatFields.js';
import { IMPORT_FORM_DATA_PROBLEM_DIALOG } from './dialogs/importFormDataProblem.js';
import { INSERT_IMAGE_PROBLEM_DIALOG } from './dialogs/insertImageProblem.js';
import { EXTRACT_PAGES_DIALOG } from './dialogs/extractPages.js';
import { SPLIT_DOCUMENT_DIALOG } from './dialogs/splitDocument.js';
import { INSERT_FROM_PDF_DIALOG } from './dialogs/insertFromPdf.js';
import { MERGE_DOCUMENT_DIALOG } from './dialogs/mergeDocument.js';
import { REPLACE_PAGE_DIALOG } from './dialogs/replacePage.js';
import { MERGE_DOCUMENT_NONE_DIALOG } from './dialogs/mergeDocumentNone.js';
import { LINK_ADDRESS_DIALOG, LINK_PAGE_DIALOG } from './dialogs/annotationLink.js';
import { ANNOTATION_NOTE_DIALOG } from './dialogs/annotationNote.js';
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
import { useDocumentView } from './useDocumentView.js';
import { CLOSE_LABEL, SPLIT_SECOND_LABEL } from './messages/en.js';
import { annotationTools } from './annotations/annotationTools.js';
import type { AnnotationStyle } from './annotations/annotationStyle.js';
import { colourFromHex } from './annotations/annotationStyle.js';
import type { AnnotationSelection } from './annotations/selectTool.js';
import { SELECT_TOOL_ID } from './annotations/selectTool.js';
import {
  deleteSelectionCommand,
  nudgeSelectionCommands,
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
} from './settings/editing.js';
import { CommentStylesPanel } from './CommentStylesPanel.js';
import { StylePanel } from './StylePanel.js';
import type { RulerUnit } from './rulerGeometry.js';
import { useSetting } from './useSetting.js';
import type { SettingsStore } from './settingsStore.js';
import { FIRST_PAGE } from './pageNumbering.js';
import { PageList, type PageListProps } from './PageList.js';
import { QuickToolbar } from './surfaces/QuickToolbar.js';
import { Ribbon } from './surfaces/Ribbon.js';
import { dispatchChord, shortcutsFor } from './surfaces/shortcuts.js';
import { RecentFiles } from './RecentFiles.js';
import { DocumentTabs } from './surfaces/DocumentTabs.js';
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
}

/**
 * The subscription for *no document is open*.
 *
 * Module-level so its identity is stable: `useSyncExternalStore` re-subscribes
 * whenever this changes, and a fresh arrow per render would tear down and
 * rebuild the subscription on every one.
 */
const NO_DOCUMENT_SUBSCRIBE = (): (() => void) => (): void => undefined;

export function App({ client, settings }: AppProps): ReactElement {
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
   * One store per open document, minted with its tab and dropped with it.
   *
   * Declared here rather than beside the state it serves, because the callback
   * that adds a tab is the one that mints a store and the compiler is right
   * that the order has to say so.
   */
  const [stores] = useState(() => new DocumentStores());
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
        WORD_COUNT_DIALOG,
        SPELL_CHECK_DIALOG,
        SAVE_PROBLEM_DIALOG,
        COMMAND_PROBLEM_DIALOG,
        HISTORY_TRIMMED_DIALOG,
        DELETE_PAGES_DIALOG,
        ANNOTATION_TEXT_DIALOG,
        ANNOTATION_NOTE_DIALOG,
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
        IMPORT_FORM_DATA_PROBLEM_DIALOG,
        INSERT_IMAGE_PROBLEM_DIALOG,
        GENERATE_TOC_PROBLEM_DIALOG,
        MERGE_DOCUMENT_DIALOG,
        MERGE_DOCUMENT_NONE_DIALOG,
        INSERT_FROM_PDF_DIALOG,
        REPLACE_PAGE_DIALOG,
        EXTRACT_PAGES_DIALOG,
        SPLIT_DOCUMENT_DIALOG,
        DUPLICATE_PAGES_DIALOG,
        SETTINGS_PROBLEM_DIALOG,
        ...FORM_FIELD_DIALOGS,
      ]),
    [],
  );
  const { open: openDialog, ask, close, resolve: resolveDialog } = useDialogHost(dialogs);

  // A FAILED WRITE NEEDS A DIALOG, so the subscription lives where `ask` does.
  //
  // It subscribed in `main.tsx` until 2026-09-02, before the hydrate, so a
  // change during startup could not be lost. Nothing is lost by moving it: the
  // only callers of `set` are registered commands, which do not exist until
  // this component has built the registry above.
  useEffect(() => persistSettings(client, settings, ask), [client, settings, ask]);

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
   * at, so its first report is the truth. This supplies the other half — the
   * `goTo` request that actually moves it there — and the two belong together,
   * which is why every route that changes the active document comes through
   * here rather than calling `setActiveId`.
   *
   * ## Only the active view is mounted, and that is a BUDGET decision
   *
   * Keeping every tab's scroller mounted would preserve the scroll position
   * for free, and would hold one set of page bitmaps per open document — which
   * is the first thing in this build that looks like the cache §9.17's
   * renderer budget is written about. Unmounting keeps that budget a statement
   * about one document, and this callback is what it costs.
   */
  const activate = useCallback(
    (docId: DocId): void => {
      setActiveId(docId);
      const page = stores.get(docId)?.getState().page;
      if (page !== undefined) setGoTo(page);
    },
    [stores],
  );

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
    (document: OpenDocument): void => {
      // THE STORE IS MINTED HERE, beside the tab, because the two have the same
      // lifetime and `stores.open` refuses a second one for a document that
      // already has it. Guarded by the same `get`-misses read the render uses,
      // so re-opening an open document activates its tab rather than throwing.
      if (stores.get(document.docId) === undefined) {
        stores.open(document.docId, document.version);
      }
      setTabs((current) =>
        current.some((tab) => tab.docId === document.docId) ? current : [...current, document],
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
   * Closes one document: the tab, its store, and what main holds for it.
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
   * Closing the focused tab has to leave the reader somewhere. The tab to its
   * left is what every editor does and what a reader reaches for next; the
   * first tab would send someone closing the fifth of six back to the start.
   * Reading the index from `tabs` rather than from the filtered list is what
   * makes that expressible: after the filter, the position is gone.
   *
   * ## The failure is REPORTED rather than swallowed
   *
   * The channel declares no codes, so the only way this ends badly is
   * `internal` — a defect with an incident id. The tab still goes, because the
   * reader asked for it and leaving it would put a document on screen that
   * this build has already stopped tracking; what must not happen is that the
   * incident goes nowhere.
   */
  const closeTab = useCallback(
    async (docId: DocId): Promise<void> => {
      const at = tabs.findIndex((tab) => tab.docId === docId);
      if (at < 0) return;

      const remaining = tabs.filter((tab) => tab.docId !== docId);
      setTabs(remaining);
      if (docId === activeId) {
        const neighbour = remaining[Math.max(0, at - 1)]?.docId;
        // `setActiveId` directly for the LAST tab, because there is no document
        // to activate and `activate` is about arriving somewhere.
        if (neighbour === undefined) setActiveId(undefined);
        else activate(neighbour);
      }
      stores.close(docId);

      const answer = await client['document.close']({ docId });
      if (!answer.ok) void ask(COMMAND_PROBLEM_DIALOG_ID, answer.error);
    },
    [activate, activeId, ask, client, stores, tabs],
  );

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
  const openPalette = useCallback(() => {
    setPalette(true);
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
  const styleOpacity = useSetting(settings, ANNOTATION_OPACITY_SETTING);
  const styleLineWidth = useSetting(settings, ANNOTATION_LINE_WIDTH_SETTING);
  const styleFontSize = useSetting(settings, ANNOTATION_FONT_SIZE_SETTING);
  const style = useMemo<AnnotationStyle>(() => {
    // A STORED VALUE THIS CANNOT PARSE FALLS BACK TO THE TOOL'S OWN, which is
    // the same outcome as `'auto'`. The setting's schema refuses a malformed
    // hex on the way in, so reaching this means a stored value from a build
    // whose regex was different — and each tool's own colour is a mark a person
    // recognises, where black would be a silent restyle.
    const chosen = styleColour === 'auto' ? undefined : colourFromHex(styleColour);
    return {
      colour: (own) => chosen ?? own,
      opacity: styleOpacity,
      lineWidth: styleLineWidth,
      fontSize: styleFontSize,
    };
  }, [styleColour, styleFontSize, styleLineWidth, styleOpacity]);

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
          onPlaceImage,
        }),
      ),
    [ask, listAnnotations, onPlaceImage, onSnapshot, readSelection, scale, style],
  );

  const rulers = useSetting(settings, RULERS_SETTING);
  const showGrid = useSetting(settings, GRID_SETTING);
  const unit = useSetting(settings, RULER_UNIT_SETTING);
  const loupe = useSetting(settings, LOUPE_SETTING);
  const split = useSetting(settings, SPLIT_VIEW_SETTING);

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
  const openCommand = useMemo(
    () =>
      openDocumentCommand({
        client,
        onOpened: opened,
        onProblem: setOpenProblem,
        onAlreadyOpen: activate,
      }),
    [activate, client, opened],
  );

  const registry = useMemo(
    () =>
      new CommandRegistry([
        openCommand,
        showAboutCommand({ client, ask }),
        showWordCountCommand({ client, ask, track }),
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
        watermarkPagesCommand({ client, onApplied: applied, ask }),
        headerFooterCommand({ client, onApplied: applied, ask }),
        batesNumberCommand({ client, onApplied: applied, ask }),
        pageTransitionCommand({ client, onApplied: applied, ask }),
        pageBackgroundCommand({ client, onApplied: applied, ask }),
        resizePagesCommand({ client, onApplied: applied, ask }),
        insertImageCommand({ client, onApplied: applied, ask }),
        mergeDocumentCommand({ client, onApplied: applied, ask }),
        insertFromPdfCommand({ client, onApplied: applied, ask }),
        replacePageCommand({ client, onApplied: applied, ask }),
        extractPagesCommand({ client, onApplied: applied, ask }),
        splitDocumentCommand({ client, onApplied: applied, ask }),
        generateTocCommand({ client, onApplied: applied, ask }),
        findDuplicatePagesCommand({ client, onApplied: applied, ask }),
        undoCommand({ client, onApplied: applied, ask }),
        saveCommand({ client, ask }),
        saveCopyCommand({ client, onApplied: applied, ask }),
        exportFormDataJsonCommand({ client, onApplied: applied, ask }),
        exportFormDataXfdfCommand({ client, onApplied: applied, ask }),
        exportFormDataFdfCommand({ client, onApplied: applied, ask }),
        importFormDataJsonCommand({ client, onApplied: applied, ask }),
        importFormDataXfdfCommand({ client, onApplied: applied, ask }),
        importFormDataFdfCommand({ client, onApplied: applied, ask }),
        detectFlatFieldsCommand({ client, onApplied: applied, ask }),
        // NO DEPS: it takes the caret to the find bar and searches nothing, so
        // there is no client for it to hold. A command needing none is what a
        // command that acts on a surface looks like.
        findCommand(),
        zoomCommand('in', { onZoom: changeZoom }),
        zoomCommand('out', { onZoom: changeZoom }),
        fitCommand('width', { onZoom: changeZoom }),
        fitCommand('page', { onZoom: changeZoom }),
        // STAGE 3's SHAPE TOOLS, registered in both registries under one id
        // each. What these commands do is select; what the drag does is
        // `registries/tools.ts`' business, and the shared id is the join.
        // SPREAD from one list rather than named individually, so the set of
        // tools has one place it is written down.
        ...shapeToolCommands({ activeTool: readTool, onSelect: setToolId }),
        deleteSelectionCommand(selectionDeps),
        ...nudgeSelectionCommands(selectionDeps),
        toggleRulersCommand({ settings }),
        toggleGridCommand({ settings }),
        toggleDarkPageCommand({ settings }),
        toggleLoupeCommand({ settings }),
        toggleSplitViewCommand({ settings }),
        commandPaletteCommand({ onOpen: openPalette }),
        pageMoveCommand('next', { navigator }),
        pageMoveCommand('previous', { navigator }),
        pageMoveCommand('first', { navigator }),
        pageMoveCommand('last', { navigator }),
        historyCommand('back', { navigator }),
        historyCommand('forward', { navigator }),
        goToCommand(),
      ]),
    [
      applied,
      ask,
      changeZoom,
      client,
      navigator,
      openCommand,
      openPalette,
      readTool,
      selectionDeps,
      settings,
      track,
    ],
  );

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

  // The start screen's context: no document focused. `hasSelection` and `dirty`
  // are false because there is nothing to select in and nothing to dirty — not
  // because they are unknown.
  const context = useMemo(
    () => ({
      docId: open?.docId,
      version: open?.version,
      hasSelection: false,
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
    [currentPage, open, pageCount, tabs],
  );

  useShortcuts(registry, context);
  useTheme(settings);

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
    return settings.subscribe((id) => {
      if (id === DARK_PAGE_SETTING.id) apply();
    });
  }, [settings]);

  return (
    <main className="m-document-surface">
      {/* THE OPEN DOCUMENTS. First in the surface because it is what the rest
          of it is about — the strip names which document every panel, the
          status bar and every command below refer to. */}
      <DocumentTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={activate}
        onClose={(docId) => {
          void closeTab(docId);
        }}
        // THE REGISTERED COMMAND'S OWN `run`, not a second way to open a
        // document. The strip is where *open another* belongs — it exists
        // exactly when a document is open, which is exactly when the start
        // screen's copy is gone.
        onOpen={() => {
          void openCommand.run(context);
        }}
      />
      {/* THE RAIL AND THE RIBBON, directly under the tabs, which is §10.3's
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
        <>
          <StartScreen registry={registry} context={context} problem={openProblem} />
          {/* BESIDE the projection, not inside it: a recent file is data with a
              control, not a registered command, and registering one per row
              would mean rebuilding the registry whenever the list changed. */}
          <RecentFiles client={client} onOpened={opened} />
        </>
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
        // THE RETRY RE-ISSUES THE SCROLL REQUEST, and holding the state above
        // the boundary is not enough without it. Measured: a reset remounts the
        // scroller, which seeds its first page as visible and reports it — so
        // `currentPage` was preserved across the failure and then overwritten
        // by the fresh view a moment later, and a reader who threw on page 40
        // came back to page 1 with every piece of state intact. `goTo` is the
        // seam that already exists for *put the reader here*, so the retry sets
        // it in the same event as the reset and the remounted view starts where
        // the reader was.
        <>
        <Ribbon registry={registry} context={context} />
        <ErrorBoundary
          key={open.docId}
          fallback={({ reset }) => (
            <ViewProblem
              onRetry={() => {
                setGoTo(currentPage);
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
          compare={tabs.find((tab) => tab.docId === compareId)}
          drawing={drawing}
          others={tabs}
          onCompare={setCompareId}
          search={search ?? undefined}
        />
        </ErrorBoundary>
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
          task={task}
        />
      )}
      {/* THE LINKS PANEL, which renders nothing with no document for the find
          bar's reason. It is the third source of a jump, after the keys and the
          thumbnails, and it dispatches the same one. */}
      {/* THE OUTLINE, keyed on the document rather than the page — it is a
          property of the document, and re-asking on every scroll would be the
          same round trip for the same answer. */}
      <DestinationsPanel
        client={client}
        docId={open?.docId}
        version={open?.version}
        onJump={navigator.jumpTo}
      />
      <LinksPanel
        client={client}
        docId={open?.docId}
        page={context.page}
        onJump={navigator.jumpTo}
      />
      {/* THE LAYERS PANEL, keyed on the version rather than the page because
          its own toggle moves the version — a command, not a view preference,
          so what it shows is re-read from the document after every mutation
          including an undo of its own. */}
      {/* THE STYLE CONTROLS, which take no document at all: they set what the
          NEXT annotation is drawn in, so they are useful before anything is
          open and they do not change when the version moves. That is what makes
          them settings rather than document state. */}
      <StylePanel settings={settings} />
      {/* THE OTHER HALF: what the selected annotations look like now, and the
          command that changes them. Takes the same resolved style the tools
          take, so *Apply* writes what the controls above say. */}
      <CommentStylesPanel onApply={restyleSelection} selection={selection} style={style} />
      <LayersPanel client={client} docId={open?.docId} version={open?.version} />
      {/* THE ANNOTATIONS PANEL, keyed on the version for the layers panel's
          reason: every drawing tool moves it, so the list is re-read after the
          rectangle that was just drawn and after an undo of it. Keyed on the
          document rather than the page, unlike the links, because it lists the
          whole document and the page number is what a row carries. */}
      <AnnotationsPanel
        client={client}
        docId={open?.docId}
        onJump={navigator.jumpTo}
        onRemove={removeAnnotation}
        version={open?.version}
      />
      {/* THE FORMS PANEL, keyed on the version for the annotations panel's
          reason and with one more of its own: every control on it writes, so a
          row built from a previous version's walk would fill a field by
          arithmetic. It lists the whole document because a form is a thing a
          person works through rather than a property of the page they are on. */}
      <FormsPanel
        client={client}
        docId={open?.docId}
        onDelete={deleteFormField}
        onFill={fillFormField}
        onFlatten={flattenForm}
        onJump={navigator.jumpTo}
        version={open?.version}
      />
      {/* E2's substrate, reached by a person. It renders nothing with no
          document open, for `QuickToolbar`'s reason: a find field over no
          document is a control that cannot work. */}
      <FindBar
        client={client}
        docId={open?.docId}
        page={context.page}
        pageCount={pageCount}
        // THE SAME `jumpTo` the thumbnails, the outline and the status bar's
        // field dispatch — a match is one more thing that names a page, not a
        // second way to move the reader.
        onJump={navigator.jumpTo}
        // THE SETTER ITSELF, which React guarantees is stable. The find bar
        // calls this from an effect keyed on its own answer, so an inline arrow
        // here would be a new dependency every render and the effect would run
        // in a loop.
        onHighlight={setSearch}
      />
      {/* A projection, like the start screen, and it renders nothing when its
          model is empty — which is every moment no document is focused, because
          each command placed on it declares `when`. */}
      <QuickToolbar registry={registry} context={context} />
      {/* The ONE mount point. `DialogHost` renders nothing when none is open —
          not a hidden dialog — so this is not a control that renders and does
          nothing; it is the seam every dialog arrives through. */}
      <DialogHost
        registry={dialogs}
        closeLabel={CLOSE_LABEL}
        open={openDialog}
        onClose={close}
        onResolve={resolveDialog}
      />
    </main>
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

    const unsubscribe = settings.subscribe((id) => {
      if (id === THEME_SETTING.id || id === ACCENT_SETTING.id) apply();
    });

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
  onVersionMoved,
  onCurrentPage,
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
  others,
  onCompare,
  drawing,
  search,
}: {
  readonly client: ContractClient;
  readonly document: OpenDocument;
  readonly onVersionMoved: (next: OpenDocument) => void;
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
  /** Every open document, as the compare picker's choices. */
  readonly others: readonly OpenDocument[];
  readonly onCompare: (docId: DocId | undefined) => void;
  /** The active tool and where its commands go. Both panes take it. */
  readonly drawing: PageListProps['drawing'];
  /** What the find bar last answered, painted over both panes' text layers. */
  readonly search: SearchHighlight | undefined;
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
  const { ready, failed } = useDocumentView(client, open, moved);

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
    return <canvas className="m-page" data-failed="true" />;
  }

  if (ready === undefined) {
    // NOT A SPINNER: the parser is what knows how many pages there are, so
    // until it opens there is nothing honest to lay out. The failure case above
    // is the one that carries a marker.
    return <div className="m-page-list" />;
  }

  return (
    // THE SIDEBAR IS A SIBLING OF THE SPINE, inside this component, because it
    // needs the same parser: a strip that opened its own would parse the
    // document twice and hold two copies of every page it drew.
    <div className="m-document-body">
      <Thumbnails
        view={ready}
        pageCount={ready.document.numPages}
        current={current}
        onJump={onJump}
        onMove={onMove}
        onSwap={onSwap}
      />
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
        onCurrentPage={onCurrentPage}
        mode={mode}
        onZoom={onZoom}
        onShownZoom={onShownZoom}
        goTo={goTo}
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
        search={search}
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

          It reports NOTHING back. `onCurrentPage`, `onShownZoom` and
          `onPageCount` all have one owner in `App`, and a second reporter would
          make the status bar and the navigation commands follow whichever pane
          scrolled last — a reader in the left pane pressing PageDown and
          watching the right one move. What that costs is stated on the row:
          the commands act on the first pane, and *focus follows the pane* is
          owed rather than done. */}
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
              onCurrentPage={ignorePage}
              mode={mode}
              onZoom={onZoom}
              onShownZoom={ignoreZoom}
              goTo={undefined}
              // The same page the first pane starts at, so a split opens on
              // what the reader is looking at rather than at the top.
              startAt={current}
              onWentTo={ignoreWentTo}
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
              // BOTH PANES PAINT the same matches, for the same reason: it is
              // one document, and a split where the search highlighted one half
              // would read as the second pane showing a different document.
              search={search}
            />
          ) : null}
        </div>
      ) : null}
    </div>
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
