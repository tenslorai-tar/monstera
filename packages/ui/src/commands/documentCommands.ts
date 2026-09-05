import type { ContractClient, RenderableCommand } from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';

import type { z } from 'zod';

import { BATES_NUMBER_DIALOG_ID } from '../dialogs/batesNumber.js';
import type { BatesNumberAnswer } from '../dialogs/batesNumberResult.js';
import { COMMAND_PROBLEM_DIALOG, COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { CROP_PAGES_DIALOG_ID } from '../dialogs/cropPages.js';
import type { CropPagesAnswer } from '../dialogs/cropPagesResult.js';
import { DELETE_PAGES_DIALOG_ID } from '../dialogs/deletePages.js';
import type { DeletePagesAnswer } from '../dialogs/deletePagesResult.js';
import { DUPLICATE_PAGES_DIALOG_ID } from '../dialogs/duplicatePages.js';
import { GENERATE_TOC_PROBLEM_DIALOG_ID } from '../dialogs/generateTocProblem.js';
import { HEADER_FOOTER_DIALOG_ID } from '../dialogs/headerFooter.js';
import type { HeaderFooterAnswer } from '../dialogs/headerFooterResult.js';
import type { DuplicatePagesAnswer } from '../dialogs/duplicatePagesResult.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { INSERT_IMAGE_PROBLEM_DIALOG_ID } from '../dialogs/insertImageProblem.js';
import { PAGE_TRANSITION_DIALOG_ID } from '../dialogs/pageTransition.js';
import type { PageTransitionAnswer } from '../dialogs/pageTransitionResult.js';
import { RESIZE_PAGES_DIALOG_ID } from '../dialogs/resizePages.js';
import type { ResizePagesAnswer } from '../dialogs/resizePagesResult.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import { WATERMARK_PAGES_DIALOG_ID } from '../dialogs/watermarkPages.js';
import type { WatermarkPagesAnswer } from '../dialogs/watermarkPagesResult.js';
import {
  FIND_TITLE,
  FIT_PAGE_TITLE,
  FIT_WIDTH_TITLE,
  ROTATE_PAGE_180_TITLE,
  ROTATE_PAGE_270_TITLE,
  DELETE_PAGE_TITLE,
  BATES_NUMBER_COMMAND_TITLE,
  CROP_PAGES_COMMAND_TITLE,
  DELETE_PAGES_COMMAND_TITLE,
  DUPLICATE_PAGE_TITLE,
  FIND_DUPLICATES_COMMAND_TITLE,
  GENERATE_TOC_COMMAND_TITLE,
  HEADER_FOOTER_COMMAND_TITLE,
  INSERT_BLANK_PAGE_TITLE,
  INSERT_IMAGE_COMMAND_TITLE,
  PAGE_BACKGROUND_COMMAND_TITLE,
  RESIZE_PAGES_COMMAND_TITLE,
  PAGE_TRANSITION_COMMAND_TITLE,
  ROTATE_PAGE_TITLE,
  SAVE_COPY_TITLE,
  SAVE_TITLE,
  UNDO_TITLE,
  WATERMARK_PAGES_COMMAND_TITLE,
  ZOOM_IN_TITLE,
  ZOOM_OUT_TITLE,
} from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';
import { type ZoomMode, zoomInFrom, zoomOutFrom } from '../zoom.js';

/**
 * The three commands that act on the open document.
 *
 * ## Why they are one module and one factory
 *
 * They share exactly one thing and it is the thing that matters: each produces a
 * document the renderer's view no longer describes, so each has to hand back the
 * version and byte length that replace it. Splitting them into three files would
 * put three copies of that sentence in three headers, and the fourth command
 * would get a fourth. `openDocumentCommand` is separate because it produces a
 * document rather than replacing one.
 *
 * ## `when` is what keeps them off the start screen
 *
 * All three require a focused document, so each declares `when: hasDocument`.
 * The registry applies it before any projection, so a surface never has to ask —
 * which is the difference between a control that is absent and a control that is
 * present and does nothing (§10.4).
 *
 * ## THE VIEW IS REBUILT FROM WHAT THE COMMAND RETURNS, not re-derived
 *
 * `document.execute` and `document.undo` answer with the version **and** the
 * byte length, and these commands pass both to `onApplied` rather than bumping a
 * version and hoping. Rebinding on the version alone binds to whatever length
 * the caller last knew — a range past the end is an `internal` failure, and one
 * short of it is a parse of a truncated document.
 *
 * ## AND THE REBUILD SHOWS NOTHING NEW YET, which the row says and this does too
 *
 * Finding OOOOO-1, measured 2026-08-30: a command's effect lands in the engine
 * session, and main's canonical image is `readonly` and never replaced. So
 * `document.readRange` serves the document as it was opened, and reopening the
 * view after a rotate reparses the same bytes. The dispatch is real, the
 * document effect is real — it is in the file after a save — and the live view
 * does not reflect it.
 *
 * That is an architecture question rather than a bug in this file: refreshing
 * the image means asking the engine to serialise on every command, against
 * ADR-0021's budget. Nothing here should be repaired in anticipation of the
 * answer.
 */

/**
 * What the zoom commands need.
 *
 * The updater takes the SHOWN scale and returns a mode: the ladder steps from
 * what a reader can see, and a fit is a mode with no number, so neither
 * direction of that signature can be simplified to a number.
 */
interface ZoomDeps {
  readonly onZoom: (next: (shown: number) => ZoomMode) => void;
}

/** What replaced the view, as the renderer needs to rebuild it. */
export interface Applied {
  readonly version: DocVersion;
  readonly byteLength: number;
}

/** Everything the three share. */
interface DocumentCommandDeps {
  readonly client: ContractClient;
  /**
   * Called when the document moved, with what replaced it.
   *
   * Never called for an outcome that changed nothing — a refused save, an
   * exhausted undo, a failure. A caller told about those would reopen a view
   * that is already correct, and the reopen is visible.
   */
  readonly onApplied: (applied: Applied) => void;
  /** Opens a registered dialog. See {@link reportProblem}. */
  /**
   * Opens a registered dialog and awaits its answer (ADR-0038).
   *
   * `unknown`, because a dependency bag cannot know which dialog a command will
   * open. The caller narrows with the dialog's own result schema at the point
   * it knows the id — which is the same place `openWith` validates the props.
   */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}

/**
 * Tells the user a command was refused, and hands the code to the one place
 * that knows what it means.
 *
 * ## This is ADR-0009 §9's other half
 *
 * §9's design is that a failure crossing to the renderer carries a **code** and
 * never a diagnostic. That is only half a mechanism: a code nothing renders is a
 * refusal the user meets as a control that did nothing, and until 2026-08-30
 * every one of these was swallowed by a bare `if (!answer.ok) return`.
 *
 * The mapping from a code to a sentence is the dialog's, in one place, for the
 * reason the message catalogue exists at all — three commands each writing their
 * own wording is three catalogues (B3).
 *
 * `internal` is passed through **with its incident id**, which is the only part
 * of a diagnostic that exists on this side. Rendering it is what makes minting
 * it worth anything.
 *
 * ## The parameter is the DIALOG's own props type, and that is not decoration
 *
 * `ask` takes `unknown` and the registry validates at the open call, so a code
 * the dialog cannot render is refused there — by throwing `DialogPropsRejected`,
 * inside a `run` nothing awaits. A refusal would become an unhandled rejection,
 * which is worse than the silence this function exists to end.
 *
 * Typing the parameter as `z.infer` of the dialog's schema moves that to compile
 * time: a channel gaining a code nobody added to the dialog stops building here,
 * at the call site, rather than throwing on the day a user meets it. The runtime
 * validation stays — it guards every other caller of `ask` — and this path can
 * no longer reach it (B5).
 *
 * @param failure exactly what the client answered — narrowed by the boundary, so
 *   an `incident` exists precisely when the code is `internal`.
 */
function reportProblem(
  deps: Pick<DocumentCommandDeps, 'ask'>,
  failure: z.infer<typeof COMMAND_PROBLEM_DIALOG.props>,
): void {
  // VOIDED, and the promise is genuinely nothing: this dialog declares no
  // result, so it can only ever settle `undefined` on dismissal. Awaiting it
  // would hold the command open until the user closed a message.
  void deps.ask(COMMAND_PROBLEM_DIALOG_ID, failure);
}

/**
 * Whether a document is focused.
 *
 * A named predicate rather than three inline arrows, because it is the same
 * question three times and a fourth command asking it slightly differently is
 * how a control appears on the start screen.
 */
export function hasDocument(context: CommandContext): boolean {
  return context.docId !== undefined;
}

/**
 * Sends one command and handles every way it can end.
 *
 * ## Extracted for a SECOND caller, which is a surface rather than a command
 *
 * Drag-reorder dispatches `movePage` from the thumbnail strip — not from the
 * command registry, because a drag carries two indices and a registered `run`
 * takes the application's state and no arguments (see `goToCommand`, which
 * sends the caret to a field for exactly that reason).
 *
 * So there is a dispatcher outside the registry, and it must do the same four
 * things `rotatePageCommand` does or they drift: report a declared failure
 * rather than swallowing it, tell the caller the version moved ONLY when it
 * did, and raise invariant 18's dialog when history was shed. A copy would be
 * correct on the day it was written and wrong the first time one of the four
 * changed (B3a).
 *
 * @returns whether the document moved, for a caller that wants to know
 */
export async function applyDocumentCommand(
  deps: DocumentCommandDeps,
  docId: DocId,
  // `RenderableCommand` AND NOT `Command`, which is the narrower of the two and
  // the one this side may hold: `insertImagePage` carries an image main reads
  // from a picked file, and it is absent from this union so a UI command cannot
  // be written that sends one. The type is the mechanism — no runtime check
  // here refuses it, because none can be reached.
  command: RenderableCommand,
): Promise<boolean> {
  const answer = await deps.client['document.execute']({ docId, command });

  // A DECLARED FAILURE IS AN OUTCOME AND CHANGES NOTHING — see
  // `rotatePageCommand`, whose comment this behaviour was extracted from. It is
  // still REPORTED: a refusal nobody renders is a control that did nothing.
  if (!answer.ok) {
    reportProblem(deps, answer.error);
    return false;
  }
  deps.onApplied(answer.value);

  // INVARIANT 18, AFTER `onApplied` and not instead of it, and guarded on a
  // positive count because the dialog's schema refuses zero.
  if (answer.value.historyDropped > 0) {
    void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: answer.value.historyDropped });
  }
  return true;
}

/**
 * Rotates the page on screen a quarter turn clockwise.
 *
 * ## The current page, which stopped being a constant on 2026-09-02
 *
 * This read `SHOWN_PAGE.kernel`, because the renderer drew one page and *the
 * page on screen* had one answer. Continuous scroll ends that: the context now
 * carries the page the reader is looking at, and this command means that one.
 * `SHOWN_PAGE`'s own header predicted the change — *"the day there are several,
 * every caller of this is the list of places that have to learn which one"* —
 * and the list turned out to be two entries, because the context every command
 * already receives is where the answer belongs.
 *
 * **It said `pages: [1]` until 2026-08-30, and that is the page after the one on
 * screen.** The reasoning in that comment was right and the literal was wrong:
 * PDF.js numbers pages from 1, the document model indexes them from 0, and a
 * build with no navigation and no view model had nothing that could disagree —
 * the rotation landed on page 2 of every document and the canvas showed page 1
 * unchanged. The correspondence now lives in `pageNumbering.ts` and the value
 * comes from the scroller, so neither half is a literal at a call site.
 *
 * A rotation of every page would be a different command with a different name,
 * and giving this one a `pages` array the surface cannot populate would be a
 * parameter with no way to set it.
 *
 * ## One quarter turn, clockwise
 *
 * `quarterTurns: 1`. Four presses return the page to where it started, which is
 * the property that makes a single control sufficient — a rotate-left beside it
 * would be a second registration and is one, when somebody wants it.
 */
/**
 * Sends the user to the find bar.
 *
 * ## Why this command does not search
 *
 * A search needs a query, and a registered command's `run(context)` takes the
 * application's state and no arguments — which is right: a command is invoked by
 * a toolbar, a chord and a palette alike, and none of them can supply a string.
 * So the string belongs to a surface and this command's whole job is to put the
 * caret in it. `FindBar` is what searches, and its own dispatch is asserted
 * separately.
 *
 * **That makes this a control with a real effect rather than a stub**: focus
 * moves, observably, which is what `Ctrl+F` means in every application this one
 * replaces. A command that opened a search panel that then did nothing would be
 * the display-only sin; this one hands off to a surface that works.
 *
 * ## Focus by attribute, not by a ref through the registry
 *
 * A command reaching into a component's internals would be the second wiring
 * place the registry exists to forbid — the registry would then carry both a
 * command and a handle to the thing it acts on. `data-find-input` is the
 * surface's own contract with the document, and the query selector is the whole
 * of it.
 */
/**
 * The magnifications the ± controls step through.
 *
 * **A list rather than a multiplier**, and the difference shows up immediately:
 * repeated multiplication lands on 1.0000000000000002 and a control that reads
 * *100%* would then be a rounding artefact away from *fit*. A list has exact
 * members, and a reader stepping out and back arrives at the value they left.
 *
 * **The ladder and the fits MOVED to `zoom.ts` on 2026-09-02**, when fit-width
 * and fit-page arrived. A fit is not a number this module can produce — it is a
 * relationship between the scroller's box and the page's — so what a zoom *is*
 * stopped being expressible here, and leaving half of it behind would be two
 * places deciding it.
 */

/**
 * Zooming in and out, as two registrations rather than one parameterised.
 *
 * A command is invoked by a toolbar, a chord and a palette alike, and none of
 * them can pass a direction — the same reason `findCommand` sends the caret to
 * a surface rather than taking a query. Two commands is what the registry can
 * actually project.
 *
 * **At the ends they are still registered and still run**, holding the zoom
 * where it is. `when` decides *existence*, not enablement (ADR-0029), so hiding
 * the control at 400% would make it vanish from the toolbar and the palette
 * mid-session — which reads as a bug rather than a limit.
 */
export function zoomCommand(direction: 'in' | 'out', deps: ZoomDeps): UiCommand {
  return {
    id: direction === 'in' ? 'view.zoom-in' : 'view.zoom-out',
    title: direction === 'in' ? ZOOM_IN_TITLE : ZOOM_OUT_TITLE,
    shortcut: direction === 'in' ? 'Ctrl+=' : 'Ctrl+-',
    placements: [{ surface: 'quick-toolbar', order: direction === 'in' ? 50 : 60 }],
    when: hasDocument,
    run: (): void => {
      // STEPPED FROM WHAT IS SHOWN, not from the mode. A reader at fit-width is
      // in a mode with no number of its own, and the ladder has to start
      // somewhere a person can see — the scale on screen. `shownScale` is the
      // resolved one, which for a fit is what the scroller computed.
      deps.onZoom(direction === 'in' ? zoomInFrom : zoomOutFrom);
    },
  };
}

/**
 * Fit-width and fit-page, as two registrations for `zoomCommand`'s reason.
 *
 * **These set a MODE, and that is the whole feature.** A command that resolved
 * the fit to a number would have to know the scroller's box, which it does not
 * and must not — and the number would be stale the next time the window moved.
 * The scroller resolves it on every layout, so *fit* stays fitted.
 */
export function fitCommand(fit: 'width' | 'page', deps: ZoomDeps): UiCommand {
  const mode: ZoomMode = fit === 'width' ? { kind: 'fit-width' } : { kind: 'fit-page' };
  return {
    id: fit === 'width' ? 'view.fit-width' : 'view.fit-page',
    title: fit === 'width' ? FIT_WIDTH_TITLE : FIT_PAGE_TITLE,
    shortcut: fit === 'width' ? 'Ctrl+1' : 'Ctrl+0',
    placements: [{ surface: 'quick-toolbar', order: fit === 'width' ? 70 : 80 }],
    when: hasDocument,
    run: (): void => {
      deps.onZoom(() => mode);
    },
  };
}

export function findCommand(): UiCommand {
  return {
    id: 'document.find',
    title: FIND_TITLE,
    shortcut: 'Ctrl+F',
    placements: [{ surface: 'quick-toolbar', order: 40 }],
    when: hasDocument,
    run: (): void => {
      const field = document.querySelector('[data-find-input]');
      // `instanceof` rather than a cast: the selector is a string and the
      // element it finds is whatever the DOM holds, so a surface that renamed
      // its input leaves this doing nothing rather than throwing at a user.
      if (field instanceof HTMLInputElement) field.focus();
    },
  };
}

/**
 * How the three rotations differ, as data.
 *
 * A factory parameterised by quarter turns rather than three near-identical
 * functions, which is the shape `zoomCommand` and `fitCommand` already take —
 * three copies of a dispatch is three places to get the page index wrong, and
 * this build has shipped that index wrong once.
 *
 * **90° keeps the id and the label it has had since Stage 1.** Renaming it to
 * *Rotate page 90°* for symmetry would rename a control three test cases and a
 * toolbar already name, with no reader asking for it. The other two carry their
 * angle because without it they are three controls nobody can tell apart.
 *
 * The order values continue the toolbar's existing spacing, so the three sit
 * together where the single one was.
 */
const ROTATIONS = {
  1: { id: 'document.rotate-page', title: ROTATE_PAGE_TITLE, order: 10 },
  2: { id: 'document.rotate-page-180', title: ROTATE_PAGE_180_TITLE, order: 11 },
  3: { id: 'document.rotate-page-270', title: ROTATE_PAGE_270_TITLE, order: 12 },
} as const satisfies Record<1 | 2 | 3, { id: string; title: MessageKey; order: number }>;

export function rotatePageCommand(
  deps: DocumentCommandDeps,
  quarterTurns: 1 | 2 | 3 = 1,
): UiCommand {
  const { id, title, order } = ROTATIONS[quarterTurns];
  return {
    id,
    title,
    placements: [{ surface: 'quick-toolbar', order }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      // BOTH, and neither is redundant. A document with no current page is a
      // state the type allows and the scroller has not produced — rotating page
      // 0 by default would be the plausible wrong action `SHOWN_PAGE`'s own
      // history is about.
      if (context.docId === undefined || context.page === undefined) return;
      // THE FOUR STEPS ARE IN `applyDocumentCommand`, not here — the refusal
      // report, the version, invariant 18's dialog and their order. They were
      // written inline in this function and moved out when drag-reorder needed
      // the same four from a surface rather than a command.
      await applyDocumentCommand(deps, context.docId, {
        kind: 'rotatePages',
        pages: [context.page],
        quarterTurns,
      });
    },
  };
}

/**
 * Puts an empty page after the one on screen.
 *
 * **After, not before**, and it is the same placement `duplicatePageCommand`
 * uses for the same reason: a reader on page 7 who asks for a blank page is
 * adding to what they have just read, and an insertion *before* moves the page
 * they are looking at out from under them.
 *
 * `context.page + 1` is the only arithmetic any of these commands does, and it
 * is safe for a stated reason rather than an obvious one: `at` is in the
 * DESTINATION frame — `at: pageCount` appends — so the index one past the
 * current page is always legal, including on the last page. Every other bound
 * in `pageOrder.ts` refuses `count`, and this one must not.
 */
export function insertBlankPageCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.insert-blank-page',
    title: INSERT_BLANK_PAGE_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 12 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      await applyDocumentCommand(deps, context.docId, {
        kind: 'insertBlankPage',
        at: context.page + 1,
      });
    },
  };
}

/**
 * Copies the page on screen, placing the copy immediately after it.
 *
 * The same three lines `deletePageCommand` is, and that is the whole shape of a
 * page command once the registry exists — which is what *registered, not wired*
 * means. It sits before delete in the toolbar because a person reaches for it
 * far more often, and because putting the destructive control last is one fewer
 * neighbour for a misclick.
 */
export function duplicatePageCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.duplicate-page',
    title: DUPLICATE_PAGE_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 13 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      await applyDocumentCommand(deps, context.docId, {
        kind: 'duplicatePage',
        page: context.page,
      });
    },
  };
}

/**
 * Removes the page on screen.
 *
 * ## The page comes from the context, exactly as a rotation's does
 *
 * `context.page` is what the scroller reports as current, and both guards below
 * are load-bearing for `rotatePageCommand`'s reason: deleting page 0 because no
 * page was current is the plausible wrong action, and it is worse here than for
 * a rotation, since a rotation can be undone by looking at the screen and a
 * delete cannot.
 *
 * ## No shortcut, deliberately
 *
 * `Delete` is the obvious chord and it is wrong: the same key removes an
 * annotation, a selection and text, and a command registered on it here would
 * fire while the user's attention is on any of them. The first destructive
 * command in the build does not get the key that is about to be contested — D3
 * decides that, with a focus rule rather than a first-come registration.
 *
 * ## It is undone by a CHECKPOINT, which is the reason this row waited
 *
 * `deletePages` is the first command declaring `invertible: false`, so its log
 * entry is terminal and undoing it restores the bytes the bus snapshotted
 * ([ADR-0037](../../../../docs/DECISIONS/0037-checkpoint-restore-and-the-replay-that-is-not-needed.md)).
 * Nothing about this dispatch says so, and that is the point — the surface is
 * the same four steps every other command's is.
 */
export function deletePageCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.delete-page',
    title: DELETE_PAGE_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 14 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      await applyDocumentCommand(deps, context.docId, {
        kind: 'deletePages',
        pages: [context.page],
      });
    },
  };
}

/**
 * Asks which pages to delete, then deletes them.
 *
 * ## The FIRST command whose arguments come from a dialog
 *
 * `deletePages` has always taken an array; nothing could send one. This is the
 * surface that can, and it is the mutation-dialog gate's own subject
 * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
 *
 * **The gate is the `undefined`, and it is not a rule.** A dismissed dialog
 * settles with no value, so there is nothing to build a command from — the
 * early return below is the shape rather than a check somebody could forget.
 * A confirmation flag on the props would have been the version that can be
 * forgotten.
 *
 * ## The answer is already zero-based and already validated
 *
 * `parsePageRanges` converts through `pageNumbering.ts` and the dialog's result
 * schema checks what comes back, so this performs no arithmetic on the pages it
 * receives. That is deliberate: the one place the 1-based and 0-based frames
 * meet is that module, and a `- 1` here would be the second.
 *
 * The cast is the narrowing `ask`'s `unknown` leaves — the value has been
 * through `DELETE_PAGES_DIALOG`'s own result schema in `answerOf`, which is the
 * only thing that can produce it.
 */
export function deletePagesCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.delete-pages',
    title: DELETE_PAGES_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 15 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.pageCount === undefined) return;
      const answer = (await deps.ask(DELETE_PAGES_DIALOG_ID, {
        pageCount: context.pageCount,
      })) as DeletePagesAnswer | undefined;

      // DISMISSED. Nothing was collected, so nothing is dispatched — and the
      // document has not been touched, which is why the case that holds this
      // asserts the CALL that was not made rather than the state.
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'deletePages',
        pages: [...answer.pages],
      });
    },
  };
}

/**
 * Asks for margins and a scope, then crops.
 *
 * `deletePagesCommand`'s shape one command along, which is what the dialog seam
 * being a registry entry buys: the second argument-collecting command is three
 * lines and a cast, not a second mechanism.
 *
 * **The scope is not expanded here.** The dialog answers `'all'` or a list and
 * the command passes it through, because expanding it would put one integer per
 * page back on the wire — invariant L11 — and give the kernel a second opinion
 * about what *all* means.
 */
export function cropPagesCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.crop-pages',
    title: CROP_PAGES_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 16 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = (await deps.ask(CROP_PAGES_DIALOG_ID, { page: context.page })) as
        | CropPagesAnswer
        | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'cropPages',
        pages: answer.pages === 'all' ? 'all' : [...answer.pages],
        margins: answer.margins,
      });
    },
  };
}

/**
 * Draws a text watermark across pages — **the first command in this file whose
 * writer of record is not MuPDF**
 * ([ADR-0039](../../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)).
 *
 * ## Nothing here knows that, and that is the registry working
 *
 * This function is `cropPagesCommand` with a different dialog id and a
 * different command kind. Which engine draws, where its session comes from, and
 * what becomes of the bytes it produces are all decided by the command's
 * declaration and the bus — so a byte-image writer arriving cost the UI layer
 * one entry, which is what *a feature is finished when it is registered* means
 * when it is true rather than aspirational.
 *
 * ## The scope is passed through, not expanded
 *
 * `cropPagesCommand`'s rule and its reason: the dialog answers `'all'` or a
 * list, and expanding it here would put one integer per page on the wire
 * (invariant L11) and give the kernel a second opinion about what *all* means.
 */
/**
 * Draws headers and footers.
 *
 * `watermarkPagesCommand`'s shape with a different dialog id and command kind,
 * and that is the whole of what a second byte-image command costs the UI layer.
 */
export function headerFooterCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.header-footer',
    title: HEADER_FOOTER_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 18 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = (await deps.ask(HEADER_FOOTER_DIALOG_ID, { page: context.page })) as
        | HeaderFooterAnswer
        | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'headerFooterPages',
        pages: answer.pages === 'all' ? 'all' : [...answer.pages],
        header: answer.header,
        footer: answer.footer,
        fontSize: answer.fontSize,
        marginPoints: answer.marginPoints,
      });
    },
  };
}

/**
 * Stamps a Bates sequence.
 *
 * The third byte-image command, and the third time this file's answer to one is
 * a dialog id and a command kind. That is the registry doing its job: adding a
 * writer of record cost the UI layer nothing, and adding commands to it costs
 * an entry each.
 */
export function batesNumberCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.bates-number',
    title: BATES_NUMBER_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 19 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = (await deps.ask(BATES_NUMBER_DIALOG_ID, { page: context.page })) as
        | BatesNumberAnswer
        | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'batesNumberPages',
        pages: answer.pages === 'all' ? 'all' : [...answer.pages],
        prefix: answer.prefix,
        suffix: answer.suffix,
        start: answer.start,
        digits: answer.digits,
        edge: answer.edge,
        slot: answer.slot,
        fontSize: answer.fontSize,
        marginPoints: answer.marginPoints,
      });
    },
  };
}

/**
 * Sets a presentation transition on pages.
 *
 * The fourth argument-collecting command in this file and the first routed to
 * **MuPDF** rather than to pdf-lib — which this function cannot tell and does
 * not need to. Which engine writes a command is its declaration's business, and
 * the registry is what makes that true rather than a convention.
 */
export function pageTransitionCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.page-transition',
    title: PAGE_TRANSITION_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 20 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = (await deps.ask(PAGE_TRANSITION_DIALOG_ID, { page: context.page })) as
        | PageTransitionAnswer
        | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'setPageTransition',
        pages: answer.pages === 'all' ? 'all' : [...answer.pages],
        style: answer.style,
        durationSeconds: answer.durationSeconds,
      });
    },
  };
}

/**
 * Resizes pages to a target size, scaling their content to fit.
 *
 * **The dialog answers the command** (ADR-0038): its result is the two numbers
 * and the scope the command carries, and nothing here recomputes a size from
 * something the dialog also had.
 */
export function resizePagesCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.resize-pages',
    title: RESIZE_PAGES_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 22 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = (await deps.ask(RESIZE_PAGES_DIALOG_ID, { page: context.page })) as
        | ResizePagesAnswer
        | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'resizePages',
        pages: answer.pages === 'all' ? 'all' : [...answer.pages],
        widthPoints: answer.widthPoints,
        heightPoints: answer.heightPoints,
      });
    },
  };
}

/**
 * Inserts an image as a new page, after the page being read.
 *
 * ## IT SENDS TWO NUMBERS AND OPENS NO DIALOG OF ITS OWN
 *
 * The picker is Electron's and runs in **main**, so this command's whole job is
 * to say which document and where. It cannot send an image even by mistake:
 * `applyDocumentCommand` takes `RenderableCommand`, which is the command union
 * with `insertImagePage` removed, so a UI command that tried would not compile.
 *
 * That is why this goes through its own channel rather than
 * `document.execute` — the same shape `saveCopyCommand` uses, and for the same
 * reason: what happens here is *ask main to run a dialog and tell me what it
 * did*, which is not a command the renderer could have built.
 *
 * ## AFTER the page being read, not at it
 *
 * `context.page + 1`, because a person on page 3 inserting a picture means
 * *after this one* — inserting at 3 would push the page they are looking at
 * down and leave them staring at the new one, which reads as the wrong page
 * having been replaced.
 */
export function insertImageCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.insert-image',
    title: INSERT_IMAGE_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 23 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;

      const answer = await deps.client['document.insertImage']({
        docId: context.docId,
        at: context.page + 1,
      });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }

      // A DISMISSAL CHANGES NOTHING AND IS NOT REPORTED. The other two
      // non-success outcomes ARE: a user who picked a file and got nothing
      // needs to know which of the two happened, and silence there is the
      // display-only failure wearing a different hat.
      if (answer.value.kind === 'cancelled') return;
      if (answer.value.kind === 'unreadable') {
        void deps.ask(INSERT_IMAGE_PROBLEM_DIALOG_ID, { reason: 'unreadable' as const });
        return;
      }
      if (answer.value.kind === 'too-large') {
        void deps.ask(INSERT_IMAGE_PROBLEM_DIALOG_ID, {
          reason: 'too-large' as const,
          limitBytes: answer.value.limitBytes,
        });
        return;
      }

      deps.onApplied({ version: answer.value.version, byteLength: answer.value.byteLength });

      // INVARIANT 18, after `onApplied` and guarded on a positive count for
      // `applyDocumentCommand`'s reason: the dialog's schema refuses zero.
      if (answer.value.historyDropped > 0) {
        void deps.ask(HISTORY_TRIMMED_DIALOG_ID, { dropped: answer.value.historyDropped });
      }
    },
  };
}

/**
 * Builds a table of contents from the document's bookmarks, at the front.
 *
 * ## IT READS THE OUTLINE FIRST, and that read is the refusal
 *
 * A document with no bookmarks has no table of contents, and generating a blank
 * page for it is a control that appears to work — the wired-tools rule's own
 * failure. So this asks `document.destinations` before dispatching and opens
 * {@link GENERATE_TOC_PROBLEM_DIALOG_ID} when the answer is empty.
 *
 * **The entries themselves are not sent.** The command carries one index; main
 * re-reads the outline inside the document's lane at apply time (ADR-0040's
 * 2026-09-05 extension). This read decides whether to *offer* the operation,
 * and the one it decides against is a state, not a version — so nothing here
 * depends on the copy still being current. The narrow window where the outline
 * is emptied in between is closed on the other side, by a throw.
 *
 * ## At the FRONT, and that is where it goes until a dialog says otherwise
 *
 * `at: 0`, which is where a table of contents is in every document that has
 * one. `insertBlankPageCommand`'s *after the page being read* is the right rule
 * for a page a person is adding to what they are reading, and the wrong one
 * here: a table of contents in the middle of a document is not a placement
 * anybody chose. `pageBackgroundCommand` carries the same shape of decision —
 * a named default now, a control later.
 */
export function generateTocCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.generate-toc',
    title: GENERATE_TOC_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 24 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;

      const outline = await deps.client['document.destinations']({ docId: context.docId });
      if (!outline.ok) {
        reportProblem(deps, outline.error);
        return;
      }
      if (outline.value.destinations.length === 0) {
        void deps.ask(GENERATE_TOC_PROBLEM_DIALOG_ID, { reason: 'no-outline' as const });
        return;
      }

      await applyDocumentCommand(deps, context.docId, { kind: 'generateToc', at: 0 });
    },
  };
}

/**
 * Fills pages with a background colour.
 *
 * No dialog of its own yet: the colour is the one the style controls will own
 * (Stage 3), so this command carries the neutral page tint every application
 * offers as its default and the picker arrives with the shared surface. That is
 * the same reason `watermarkPages` carries no colour — one place decides what a
 * colour control looks like, rather than four dialogs each inventing one.
 */
export function pageBackgroundCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.page-background',
    title: PAGE_BACKGROUND_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 21 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      await applyDocumentCommand(deps, context.docId, {
        kind: 'setPageBackground',
        pages: 'all',
        // THE VALUES ARE NAMED, not spelt at the call site, so the day the
        // style controls supply a colour there is one thing to replace rather
        // than three numbers to find.
        ...DEFAULT_PAGE_BACKGROUND,
      });
    },
  };
}

/**
 * The tint a background is filled with until Stage 3's style controls exist.
 *
 * A warm off-white, which is what every reader offers as its paper default —
 * and **not** a design token: §10.2's rule is about components, and this is
 * content written into a document another application will open.
 */
const DEFAULT_PAGE_BACKGROUND = { red: 0.98, green: 0.97, blue: 0.94 } as const;

export function watermarkPagesCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.watermark-pages',
    title: WATERMARK_PAGES_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 17 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined || context.page === undefined) return;
      const answer = (await deps.ask(WATERMARK_PAGES_DIALOG_ID, { page: context.page })) as
        | WatermarkPagesAnswer
        | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'watermarkPages',
        pages: answer.pages === 'all' ? 'all' : [...answer.pages],
        text: answer.text,
        opacity: answer.opacity,
        rotationDegrees: answer.rotationDegrees,
        fontSize: answer.fontSize,
      });
    },
  };
}

/**
 * Asks the engine which pages are the same page, then offers to remove the
 * extra copies.
 *
 * ## TWO ROUND TRIPS, and the first one is a read
 *
 * The report is a query and removing the copies is a command, which is why
 * there is no single channel that does both: a mutating read would be the
 * second wiring place, and its changes would be ones no undo could reach.
 *
 * ## The dialog opens even when nothing was found
 *
 * A command that silently did nothing is one a person presses twice. *Found
 * nothing* said out loud is the difference between a measurement and a control
 * that appears broken — the same reason `nothing-to-undo` is an outcome rather
 * than a silence.
 *
 * A failed read is reported and the dialog is not opened: a dialog headed
 * *duplicate pages* over a document that could not be walked is a list of none
 * that means *could not look*.
 */
export function findDuplicatePagesCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.find-duplicate-pages',
    title: FIND_DUPLICATES_COMMAND_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 17 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const found = await deps.client['document.duplicatePages']({ docId: context.docId });
      if (!found.ok) {
        reportProblem(deps, found.error);
        return;
      }

      const answer = (await deps.ask(DUPLICATE_PAGES_DIALOG_ID, {
        groups: found.value.groups.map((group) => ({ pages: [...group.pages] })),
        truncated: found.value.truncated,
      })) as DuplicatePagesAnswer | undefined;
      if (answer === undefined) return;

      await applyDocumentCommand(deps, context.docId, {
        kind: 'deletePages',
        pages: [...answer.pages],
      });
    },
  };
}

/**
 * Steps one entry back in the document's command log.
 *
 * `Ctrl+Z` because that is what every application this one replaces uses, and
 * because a chord is a property of the command rather than an entry in a keymap
 * — declaring it here is the whole of registering it.
 *
 * **`nothing-to-undo` is a success that changed nothing**, which is why the
 * callback is not made for it. The log being empty is where every document
 * starts; treating it as a failure would put a message in front of a user who
 * pressed a key one time too many.
 */
export function undoCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.undo',
    title: UNDO_TITLE,
    shortcut: 'Ctrl+Z',
    placements: [{ surface: 'quick-toolbar', order: 20 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['document.undo']({ docId: context.docId });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      if (answer.value.kind !== 'undone') return;
      deps.onApplied({
        version: answer.value.version,
        byteLength: answer.value.byteLength,
      });
    },
  };
}

/**
 * Writes the document back to the file it came from.
 *
 * ## The view is NOT rebuilt, and that is the whole difference from the other two
 *
 * A save changes the file, not the document. `document.save` bumps the version —
 * §4 bumps it for every applied mutation — but the canonical image main holds is
 * the same bytes the renderer is already showing, so reopening the view would
 * reparse a document that has not changed. `onApplied` is therefore not called.
 *
 * ## `refused` and `write-failed` are outcomes, and invariant 18 is why
 *
 * Both leave the document intact, still dirty, with its command log untouched —
 * *"a failed save never loses work"*. Neither is a failure code and neither is
 * an error here.
 *
 * **They were SILENT until 2026-08-30**, which is worse than an error: the
 * command received the answer and returned, so a user pressed Save and saw
 * exactly what a successful save looks like. Both now open
 * {@link SAVE_PROBLEM_DIALOG}, whose first sentence is that the work is still
 * there — invariant 18's *"never by a dialog whose only option discards their
 * edits"* read as an obligation to say so rather than only as a prohibition.
 *
 * ## A declared FAILURE gets a DIFFERENT dialog, and that is the whole point
 *
 * `document-not-open`, `document-busy` and `document-poisoned` are refusals of a
 * different kind: the first two are transient states a retry resolves, and the
 * third is one the supervisor has decided. Sending them through the save-problem
 * dialog would put *the file was not written* in front of somebody whose
 * document was never attempted — so they go to {@link COMMAND_PROBLEM_DIALOG_ID}
 * with every other command's refusals, where `document-poisoned` gets the
 * sentence invariant 18 clause (i) actually owes.
 *
 * Two dialogs rather than one with a mode: the save-problem dialog's subject is a
 * write that was attempted and did not land, and its first sentence exists to say
 * the work survived it. That is not the same news.
 */
export function saveCommand(deps: {
  readonly client: ContractClient;
  /**
   * Opens a registered dialog and awaits its answer (ADR-0038).
   *
   * `unknown`, because a dependency bag cannot know which dialog a command will
   * open. The caller narrows with the dialog's own result schema at the point
   * it knows the id — which is the same place `openWith` validates the props.
   */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}): UiCommand {
  return {
    id: 'document.save',
    title: SAVE_TITLE,
    shortcut: 'Ctrl+S',
    placements: [{ surface: 'quick-toolbar', order: 30 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['document.save']({ docId: context.docId });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      if (answer.value.kind === 'saved') return;
      // FLATTENED HERE, where both fields exist, rather than in the dialog. The
      // channel answers two shapes describing one thing; the dialog's schema
      // takes one enum, so its body switches once and a sixth outcome is a
      // compile error rather than a branch that renders nothing.
      void deps.ask(SAVE_PROBLEM_DIALOG_ID, {
        outcome: answer.value.kind === 'write-failed' ? 'write-failed' : answer.value.reason,
      });
    },
  };
}

/**
 * Writes a copy of the document to a destination the user picks.
 *
 * ## It takes NO dialog of its own, which is the whole shape of the feature
 *
 * Every other argument-collecting command in this file opens a `<Dialog>` and
 * waits. This one does not: the destination comes from the **platform's** save
 * dialog, which main runs, so the renderer has nothing to collect and nothing
 * to validate. `document.saveCopy` carries a `DocId` and answers with what
 * happened.
 *
 * That also means the mutation-dialog gate does not apply here and is not being
 * evaded. The gate exists because a dismissed dialog must dispatch nothing; here
 * the dismissal happens on main's side of the boundary and comes back as
 * `cancelled`, so the renderer's job is to render nothing for it rather than to
 * guard against dispatching.
 *
 * ## Cancelled renders NOTHING, and that is a decision
 *
 * A person who dismisses a save dialog knows what they did. A toast saying
 * *cancelled* tells them something they just decided, and the one thing worse
 * than no feedback is feedback for an action nobody took.
 *
 * ## `refused` is the one outcome with something to say
 *
 * Another open tab is that file, and writing would lose its unsaved edits. The
 * user can act on it — close the other tab, or pick elsewhere — which is why it
 * reaches the problem dialog and a byte count does not.
 */
export function saveCopyCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.save-copy',
    title: SAVE_COPY_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 31 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['document.saveCopy']({ docId: context.docId });
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      // TWO SILENT OUTCOMES AND TWO SPOKEN ONES. `copied` needs nothing said
      // because the file is where the user put it, and `cancelled` needs
      // nothing said because they are the one who cancelled.
      if (answer.value.kind === 'copied' || answer.value.kind === 'cancelled') return;
      void deps.ask(SAVE_PROBLEM_DIALOG_ID, {
        outcome: answer.value.kind === 'write-failed' ? 'write-failed' : 'contested',
      });
    },
  };
}
