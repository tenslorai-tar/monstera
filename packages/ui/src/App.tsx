import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import {
  findCommand,
  fitCommand,
  rotatePageCommand,
  saveCommand,
  undoCommand,
  zoomCommand,
} from './commands/documentCommands.js';
import { DEFAULT_ZOOM, type ZoomMode } from './zoom.js';
import { toggleGridCommand, toggleRulersCommand } from './commands/viewCommands.js';
import { historyCommand, pageMoveCommand } from './commands/navigationCommands.js';
import { type DocumentStore, DocumentStores } from './documentStores.js';
import { Thumbnails } from './Thumbnails.js';
import { FindBar } from './FindBar.js';
import { openDocumentCommand } from './commands/openDocument.js';
import { revealLogCommand } from './commands/revealLog.js';
import { showAboutCommand } from './commands/showAbout.js';
import { ABOUT_DIALOG } from './dialogs/about.js';
import { COMMAND_PROBLEM_DIALOG } from './dialogs/commandProblem.js';
import { HISTORY_TRIMMED_DIALOG } from './dialogs/historyTrimmed.js';
import { SETTINGS_PROBLEM_DIALOG } from './dialogs/settingsProblem.js';
import { persistSettings } from './settingsSync.js';
import { SAVE_PROBLEM_DIALOG } from './dialogs/saveProblem.js';
import { type DocumentView, openDocumentView } from './documentView.js';
import { CLOSE_LABEL } from './messages/en.js';
import { CommandRegistry, type CommandContext } from './registries/commands.js';
import { DialogRegistry } from './registries/dialogs.js';
import { DialogHost, useDialogHost } from './surfaces/DialogHost.js';
import { THEME_SETTING, type Theme, applyTheme } from './settings/appearance.js';
import { GRID_SETTING, RULERS_SETTING, RULER_UNIT_SETTING } from './settings/viewing.js';
import type { RulerUnit } from './rulerGeometry.js';
import { useSetting } from './useSetting.js';
import type { SettingsStore } from './settingsStore.js';
import { FIRST_PAGE } from './pageNumbering.js';
import { PageList } from './PageList.js';
import { QuickToolbar } from './surfaces/QuickToolbar.js';
import { dispatchChord, shortcutsFor } from './surfaces/shortcuts.js';
import { StartScreen } from './surfaces/StartScreen.js';

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

/** What the renderer knows about the one open document. */
interface OpenDocument {
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
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

export function App({ client, settings }: AppProps): ReactElement {
  const [open, setOpen] = useState<OpenDocument | undefined>(undefined);

  // ONE registry instance, and the dialog host's state feeds the command that
  // opens it. `useDialogHost` owns `show`, so the command captures it the same
  // way it captures the client — composition, not a global.
  const dialogs = useMemo(
    () =>
      new DialogRegistry([
        ABOUT_DIALOG,
        SAVE_PROBLEM_DIALOG,
        COMMAND_PROBLEM_DIALOG,
        HISTORY_TRIMMED_DIALOG,
        SETTINGS_PROBLEM_DIALOG,
      ]),
    [],
  );
  const { open: openDialog, show, close } = useDialogHost(dialogs);

  // A FAILED WRITE NEEDS A DIALOG, so the subscription lives where `show` does.
  //
  // It subscribed in `main.tsx` until 2026-09-02, before the hydrate, so a
  // change during startup could not be lost. Nothing is lost by moving it: the
  // only callers of `set` are registered commands, which do not exist until
  // this component has built the registry above.
  useEffect(() => persistSettings(client, settings, show), [client, settings, show]);

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
  const applied = useCallback((next: { readonly version: DocVersion; readonly byteLength: number }) => {
    setOpen((previous) => (previous === undefined ? undefined : { ...previous, ...next }));
  }, []);

  /**
   * The page the reader is looking at, zero-based.
   *
   * Held here rather than in the scroller because it is what every **command**
   * means by *this page*, and commands are registered here. It starts at the
   * first page: a document that has just opened is scrolled to the top, and the
   * observer confirms it on the first frame rather than contradicting it.
   */
  const [currentPage, setCurrentPage] = useState<number>(FIRST_PAGE.kernel);
  /**
   * How many pages the open document has, once its parser has answered.
   *
   * Held here rather than only inside the scroller because the navigation
   * commands need an end to clamp against, and they are registered here.
   */
  const [pageCount, setPageCount] = useState<number | undefined>(undefined);
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
  const [stores] = useState(() => new DocumentStores());
  const [store, setStore] = useState<DocumentStore | undefined>(undefined);

  /**
   * The version to open a store AT, without making the store depend on it.
   *
   * A store's lifetime is the DOCUMENT's, not the version's — every command
   * bumps the version, and an effect that depended on it would drop and rebuild
   * the store on every rotate, taking the back-stack with it. But the
   * constructor needs a starting version, so it is read from a ref that a
   * separate effect keeps current.
   *
   * **Written in an effect and never during render.** `react-hooks` reports a
   * ref touched during render and is right to: under a concurrent render the
   * write can happen for a render that is then thrown away.
   */
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  }, [open]);

  const docId = open?.docId;
  useEffect(() => {
    const version = latest.current?.version;
    if (docId === undefined || version === undefined) {
      setStore(undefined);
      return;
    }
    setStore(stores.open(docId, version));
    return (): void => {
      // DROPPED ON CLOSE, which is §6 rather than tidiness: the store is what
      // makes a back-stack unable to outlive its document, and a registry that
      // kept it would put that guarantee back in a caller's hands.
      stores.close(docId);
      setStore(undefined);
    };
  }, [docId, stores]);

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
  const [zoomMode, setZoomMode] = useState<ZoomMode>(DEFAULT_ZOOM);
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
      setCurrentPage(page);
      store?.getState().viewing(page);
    },
    [store],
  );

  const rulers = useSetting(settings, RULERS_SETTING);
  const showGrid = useSetting(settings, GRID_SETTING);
  const unit = useSetting(settings, RULER_UNIT_SETTING);

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
      setZoomMode(next(shownZoom));
    },
    [shownZoom],
  );

  const registry = useMemo(
    () =>
      new CommandRegistry([
        openDocumentCommand({ client, onOpened: setOpen }),
        showAboutCommand({ client, show }),
        revealLogCommand({ client }),
        rotatePageCommand({ client, onApplied: applied, show }),
        undoCommand({ client, onApplied: applied, show }),
        saveCommand({ client, show }),
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
        pageMoveCommand('next', { navigator }),
        pageMoveCommand('previous', { navigator }),
        pageMoveCommand('first', { navigator }),
        pageMoveCommand('last', { navigator }),
        historyCommand('back', { navigator }),
        historyCommand('forward', { navigator }),
      ]),
    [applied, changeZoom, client, navigator, settings, show],
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

  return (
    <main className="m-document-surface">
      {open === undefined ? (
        <StartScreen registry={registry} context={context} />
      ) : (
        <PageCanvas
          client={client}
          document={open}
          onVersionMoved={setOpen}
          onCurrentPage={viewed}
          mode={zoomMode}
          onZoom={changeZoom}
          onShownZoom={setShownZoom}
          goTo={goTo}
          onWentTo={wentTo}
          onPageCount={setPageCount}
          current={currentPage}
          onJump={navigator.jumpTo}
          rulers={rulers}
          showGrid={showGrid}
          unit={unit}
        />
      )}
      {/* E2's substrate, reached by a person. It renders nothing with no
          document open, for `QuickToolbar`'s reason: a find field over no
          document is a control that cannot work. */}
      <FindBar client={client} docId={open?.docId} page={context.page} />
      {/* A projection, like the start screen, and it renders nothing when its
          model is empty — which is every moment no document is focused, because
          each command placed on it declares `when`. */}
      <QuickToolbar registry={registry} context={context} />
      {/* The ONE mount point. `DialogHost` renders nothing when none is open —
          not a hidden dialog — so this is not a control that renders and does
          nothing; it is the seam every dialog arrives through. */}
      <DialogHost registry={dialogs} closeLabel={CLOSE_LABEL} open={openDialog} onClose={close} />
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
    const apply = (): void => {
      applyTheme(document.documentElement, settings.get(THEME_SETTING.id) as Theme);
    };
    apply();
    return settings.subscribe((id) => {
      if (id === THEME_SETTING.id) apply();
    });
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
  current,
  onJump,
  rulers,
  showGrid,
  unit,
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
  /** The page the reader is on, so the thumbnail strip can mark it. */
  readonly current: number;
  /** Takes the reader to a page, recording the jump — click-to-jump's other half. */
  readonly onJump: (page: number) => void;
  readonly rulers: boolean;
  readonly showGrid: boolean;
  readonly unit: RulerUnit;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  /**
   * The live view, once open.
   *
   * In state rather than a local, because the scroller is a CHILD now and a
   * child cannot be rendered from a variable an effect closed over. Cleared by
   * the same cleanup that closes it, so a render can never hold a view that has
   * been torn down.
   */
  const [ready, setReady] = useState<DocumentView | undefined>(undefined);

  const moved = useCallback(
    (next: { readonly version: DocVersion; readonly byteLength: number }) => {
      onVersionMoved({ docId: open.docId, version: next.version, byteLength: next.byteLength });
    },
    [onVersionMoved, open.docId],
  );

  useEffect(() => {
    let cancelled = false;
    /**
     * READ THROUGH A CALL, and the reason is a narrowing that would delete a
     * guard.
     *
     * There are now two suspension points and therefore two reads. After the
     * first `if (cancelled) return`, TypeScript narrows the variable to `false`
     * for the rest of the block — and it does **not** widen it again across an
     * `await`, because it models no concurrent writer. The only assignment it
     * would learn from is in the cleanup below, which flow analysis never
     * connects to this body. The second read then lints as always falsy, and
     * both obvious responses are wrong: deleting the guard removes the check
     * that matters most, and disabling the rule turns off a check that is right
     * about every other line in this file.
     *
     * A call has no narrowing to inherit. Holding the flag on an object does not
     * help — property narrowing survives an `await` the same way.
     */
    const stopped = (): boolean => cancelled;
    let view: DocumentView | undefined;

    const show = async (): Promise<void> => {
      try {
        view = await openDocumentView({
          client,
          docId: open.docId,
          version: open.version,
          byteLength: open.byteLength,
          onVersionMoved: moved,
        });
        // CLOSED HERE, not left to the cleanup, because the cleanup has already
        // run: it read `view` while it was still `undefined` and closed nothing.
        // The original shape returned without closing on this path, which leaked
        // a parser, a worker and a transport every time a document closed while
        // its view was opening — IIIII-1's hazard on the one path that reaches it
        // by ordinary use rather than by a version bump.
        if (stopped()) {
          await view.close();
          return;
        }
        // HANDED TO THE SCROLLER, which draws. This effect's job ends at a live
        // view: the model read moved into `PageList`, because with continuous
        // scroll the pages to read rotations FOR are the ones on screen, and
        // this effect does not know which those are. L11's *name the pages you
        // are about to draw* is a question only the scroller can answer.
        setReady(view);
      } catch {
        // A parse that fails is a document this renderer cannot show. It is not
        // a crash and it is not silence: the surface stays empty and says so
        // through `failed`, and the diagnostic belongs to main, which is the
        // only side that may hold one (ADR-0009 §9).
        if (!stopped()) setFailed(true);
      }
    };

    void show();

    return (): void => {
      cancelled = true;
      // CLEARED BEFORE IT IS CLOSED, so no render can hold a torn-down view.
      // The state update and the close are the same teardown; separating them
      // is how a component ends up drawing through a closed parser for one
      // frame, which reads as an intermittent blank page.
      setReady(undefined);
      void view?.close();
    };
  }, [client, moved, open.byteLength, open.docId, open.version]);

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
      <Thumbnails view={ready} pageCount={ready.document.numPages} current={current} onJump={onJump} />
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
        onWentTo={onWentTo}
        rulers={rulers}
        showGrid={showGrid}
        unit={unit}
      />
    </div>
  );
}
