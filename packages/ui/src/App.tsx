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

import { rotatePageCommand, saveCommand, undoCommand } from './commands/documentCommands.js';
import { openDocumentCommand } from './commands/openDocument.js';
import { revealLogCommand } from './commands/revealLog.js';
import { showAboutCommand } from './commands/showAbout.js';
import { ABOUT_DIALOG } from './dialogs/about.js';
import { COMMAND_PROBLEM_DIALOG } from './dialogs/commandProblem.js';
import { SAVE_PROBLEM_DIALOG } from './dialogs/saveProblem.js';
import { type DocumentView, openDocumentView } from './documentView.js';
import { CLOSE_LABEL } from './messages/en.js';
import { CommandRegistry, type CommandContext } from './registries/commands.js';
import { DialogRegistry } from './registries/dialogs.js';
import { DialogHost, useDialogHost } from './surfaces/DialogHost.js';
import { renderPage } from './renderPage.js';
import { THEME_SETTING, type Theme, applyTheme } from './settings/appearance.js';
import type { SettingsStore } from './settingsStore.js';
import { SHOWN_PAGE } from './shownPage.js';
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
    () => new DialogRegistry([ABOUT_DIALOG, SAVE_PROBLEM_DIALOG, COMMAND_PROBLEM_DIALOG]),
    [],
  );
  const { open: openDialog, show, close } = useDialogHost(dialogs);

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

  const registry = useMemo(
    () =>
      new CommandRegistry([
        openDocumentCommand({ client, onOpened: setOpen }),
        showAboutCommand({ client, show }),
        revealLogCommand({ client }),
        rotatePageCommand({ client, onApplied: applied, show }),
        undoCommand({ client, onApplied: applied, show }),
        saveCommand({ client, show }),
      ]),
    [applied, client, show],
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
    }),
    [open],
  );

  useShortcuts(registry, context);
  useTheme(settings);

  return (
    <main className="m-document-surface">
      {open === undefined ? (
        <StartScreen registry={registry} context={context} />
      ) : (
        <PageCanvas client={client} document={open} onVersionMoved={setOpen} />
      )}
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
}: {
  readonly client: ContractClient;
  readonly document: OpenDocument;
  readonly onVersionMoved: (next: OpenDocument) => void;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

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
        // THE MODEL IS READ FIRST, and the order is the finding rather than a
        // preference. A parser opened against bytes that carry the old rotation
        // renders correctly only if the rotation it is given comes from the
        // kernel — so the read that supplies it has to have happened before the
        // draw, and reading it after would put one frame of the wrong geometry
        // on screen every time a command lands.
        //
        // Read here rather than lifted into `App`: the model belongs to a
        // (document, version) pair, and this effect's dependencies ARE that
        // pair. Holding it one level up would make a late answer's arrival a
        // question about which render it belonged to.
        const model = await client['document.viewModel']({
          docId: open.docId,
          pages: [SHOWN_PAGE.kernel],
        });
        if (stopped()) return;

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
        if (canvas.current === null) return;
        // `undefined` where the read was refused, which hands `renderPage` the
        // page's own rotation rather than a flat zero. A model that could not be
        // read is a document this renderer knows less about — not one it knows
        // is upright — and the two are a quarter turn apart on any document that
        // arrives already turned.
        await renderPage(
          view.document,
          SHOWN_PAGE.pdfjs,
          canvas.current,
          1,
          rotationFor(model, open.version),
        );
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
      void view?.close();
    };
  }, [client, moved, open.byteLength, open.docId, open.version]);

  return <canvas className="m-page" data-failed={failed ? 'true' : undefined} ref={canvas} />;
}

/**
 * The shown page's rotation out of a view-model answer, or `undefined`.
 *
 * Four states collapse to `undefined` and each is *this renderer does not know*
 * rather than *this page is upright*: the read was refused, the document has no
 * pages, the array is shorter than the page count it reported, or the answer
 * describes a **different version**. The third is worth naming on its own —
 * `rotations[0]` on an empty array is `undefined` in JavaScript and `0` in almost
 * any hand-written guard, and the difference is a document drawn flat because a
 * message lost an entry.
 *
 * ## The version comparison is finding RRRRR-2, and it was argued before it existed
 *
 * The channel's own comment says the version travels back *"so a caller can
 * recognise a **late** answer — a command can bump while this is in flight"*.
 * Nothing read it. What dropped a stale read was the effect's cancel guard, which
 * is a different mechanism with a different reach: the model is read, then the
 * transport is opened, and a command landing between those two awaits leaves a
 * model describing version N+1 about to be drawn over bytes bound to N.
 *
 * That is ADR-0031's own hazard — *a document assembled from two versions* —
 * arriving through geometry instead of through byte offsets, and with nothing
 * thrown, because nothing was comparing anything. `readRange` refuses a range for
 * the wrong version; this refuses a rotation for one, and the refusal is
 * `undefined` rather than `0` for the same reason every other state here is.
 *
 * @param version the version the view is being opened at — not the one the model
 *   arrived with, which is the value under test.
 */
function rotationFor(
  model: Awaited<ReturnType<ContractClient['document.viewModel']>>,
  version: DocVersion,
): number | undefined {
  if (!model.ok) return undefined;
  if (model.value.version !== version) return undefined;
  return model.value.rotations[0];
}
