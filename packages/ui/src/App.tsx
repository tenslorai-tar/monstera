import type { ContractClient } from '@monstera/contract';
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
  findCommand,
  fitCommand,
  deletePageCommand,
  cropPagesCommand,
  watermarkPagesCommand,
  headerFooterCommand,
  batesNumberCommand,
  saveCopyCommand,
  pageTransitionCommand,
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
import { ErrorBoundary } from './ErrorBoundary.js';
import { FindBar } from './FindBar.js';
import { type OpenProblem, openDocumentCommand } from './commands/openDocument.js';
import { revealLogCommand } from './commands/revealLog.js';
import { showAboutCommand } from './commands/showAbout.js';
import { ABOUT_DIALOG } from './dialogs/about.js';
import { COMMAND_PROBLEM_DIALOG, COMMAND_PROBLEM_DIALOG_ID } from './dialogs/commandProblem.js';
import { CROP_PAGES_DIALOG } from './dialogs/cropPages.js';
import { WATERMARK_PAGES_DIALOG } from './dialogs/watermarkPages.js';
import { HEADER_FOOTER_DIALOG } from './dialogs/headerFooter.js';
import { BATES_NUMBER_DIALOG } from './dialogs/batesNumber.js';
import { PAGE_TRANSITION_DIALOG } from './dialogs/pageTransition.js';
import { DELETE_PAGES_DIALOG } from './dialogs/deletePages.js';
import { DUPLICATE_PAGES_DIALOG } from './dialogs/duplicatePages.js';
import { HISTORY_TRIMMED_DIALOG } from './dialogs/historyTrimmed.js';
import { SETTINGS_PROBLEM_DIALOG } from './dialogs/settingsProblem.js';
import { persistSettings } from './settingsSync.js';
import { SAVE_PROBLEM_DIALOG } from './dialogs/saveProblem.js';
import { useDocumentView } from './useDocumentView.js';
import { CLOSE_LABEL, SPLIT_SECOND_LABEL } from './messages/en.js';
import { CommandRegistry, type CommandContext } from './registries/commands.js';
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
import type { RulerUnit } from './rulerGeometry.js';
import { useSetting } from './useSetting.js';
import type { SettingsStore } from './settingsStore.js';
import { FIRST_PAGE } from './pageNumbering.js';
import { PageList } from './PageList.js';
import { QuickToolbar } from './surfaces/QuickToolbar.js';
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
        SAVE_PROBLEM_DIALOG,
        COMMAND_PROBLEM_DIALOG,
        HISTORY_TRIMMED_DIALOG,
        DELETE_PAGES_DIALOG,
        CROP_PAGES_DIALOG,
        WATERMARK_PAGES_DIALOG,
        HEADER_FOOTER_DIALOG,
        BATES_NUMBER_DIALOG,
        PAGE_TRANSITION_DIALOG,
        DUPLICATE_PAGES_DIALOG,
        SETTINGS_PROBLEM_DIALOG,
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
      );
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
        findDuplicatePagesCommand({ client, onApplied: applied, ask }),
        undoCommand({ client, onApplied: applied, ask }),
        saveCommand({ client, ask }),
        saveCopyCommand({ client, onApplied: applied, ask }),
        // NO DEPS: it takes the caret to the find bar and searches nothing, so
        // there is no client for it to hold. A command needing none is what a
        // command that acts on a surface looks like.
        findCommand(),
        zoomCommand('in', { onZoom: changeZoom }),
        zoomCommand('out', { onZoom: changeZoom }),
        fitCommand('width', { onZoom: changeZoom }),
        fitCommand('page', { onZoom: changeZoom }),
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
    [applied, ask, changeZoom, client, navigator, openCommand, openPalette, settings],
  );

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
    }),
    [currentPage, open, pageCount],
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
          others={tabs}
          onCompare={setCompareId}
        />
        </ErrorBoundary>
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
      <LayersPanel client={client} docId={open?.docId} version={open?.version} />
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
