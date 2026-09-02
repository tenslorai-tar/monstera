import type { ContractClient } from '@monstera/contract';
import type { DocVersion } from '@monstera/shared';

import type { z } from 'zod';

import { COMMAND_PROBLEM_DIALOG, COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import { HISTORY_TRIMMED_DIALOG_ID } from '../dialogs/historyTrimmed.js';
import { SAVE_PROBLEM_DIALOG_ID } from '../dialogs/saveProblem.js';
import {
  FIND_TITLE,
  ROTATE_PAGE_TITLE,
  SAVE_TITLE,
  UNDO_TITLE,
  ZOOM_IN_TITLE,
  ZOOM_OUT_TITLE,
} from '../messages/en.js';
import type { CommandContext, UiCommand } from '../registries/commands.js';

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
  readonly show: (id: string, props: unknown) => void;
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
 * `show` takes `unknown` and the registry validates at the open call, so a code
 * the dialog cannot render is refused there — by throwing `DialogPropsRejected`,
 * inside a `run` nothing awaits. A refusal would become an unhandled rejection,
 * which is worse than the silence this function exists to end.
 *
 * Typing the parameter as `z.infer` of the dialog's schema moves that to compile
 * time: a channel gaining a code nobody added to the dialog stops building here,
 * at the call site, rather than throwing on the day a user meets it. The runtime
 * validation stays — it guards every other caller of `show` — and this path can
 * no longer reach it (B5).
 *
 * @param failure exactly what the client answered — narrowed by the boundary, so
 *   an `incident` exists precisely when the code is `internal`.
 */
function reportProblem(
  deps: Pick<DocumentCommandDeps, 'show'>,
  failure: z.infer<typeof COMMAND_PROBLEM_DIALOG.props>,
): void {
  deps.show(COMMAND_PROBLEM_DIALOG_ID, failure);
}

/**
 * Whether a document is focused.
 *
 * A named predicate rather than three inline arrows, because it is the same
 * question three times and a fourth command asking it slightly differently is
 * how a control appears on the start screen.
 */
function hasDocument(context: CommandContext): boolean {
  return context.docId !== undefined;
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
 * The steps are the ones every viewer this one replaces offers, and they are
 * closer together near 100% because that is where a reader adjusts.
 */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/** The step above `zoom`, or `zoom` where there is none. */
export function zoomIn(zoom: number): number {
  return ZOOM_STEPS.find((step) => step > zoom) ?? zoom;
}

/** The step below `zoom`, or `zoom` where there is none. */
export function zoomOut(zoom: number): number {
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom) ?? zoom;
}

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
export function zoomCommand(
  direction: 'in' | 'out',
  deps: { readonly onZoom: (next: (current: number) => number) => void },
): UiCommand {
  return {
    id: direction === 'in' ? 'view.zoom-in' : 'view.zoom-out',
    title: direction === 'in' ? ZOOM_IN_TITLE : ZOOM_OUT_TITLE,
    shortcut: direction === 'in' ? 'Ctrl+=' : 'Ctrl+-',
    placements: [{ surface: 'quick-toolbar', order: direction === 'in' ? 50 : 60 }],
    when: hasDocument,
    run: (): void => {
      deps.onZoom(direction === 'in' ? zoomIn : zoomOut);
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

export function rotatePageCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.rotate-page',
    title: ROTATE_PAGE_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 10 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      // BOTH, and neither is redundant. A document with no current page is a
      // state the type allows and the scroller has not produced — rotating page
      // 0 by default would be the plausible wrong action `SHOWN_PAGE`'s own
      // history is about.
      if (context.docId === undefined || context.page === undefined) return;
      const answer = await deps.client['document.execute']({
        docId: context.docId,
        command: { kind: 'rotatePages', pages: [context.page], quarterTurns: 1 },
      });
      // A DECLARED FAILURE IS AN OUTCOME AND CHANGES NOTHING. `document-busy`,
      // `document-not-open` and `document-poisoned` all leave the document
      // exactly as it was, so telling the caller the view moved would make it
      // rebuild for nothing — and a rebuild is a visible reparse. It is still
      // REPORTED: a refusal nobody renders is a control that did nothing.
      if (!answer.ok) {
        reportProblem(deps, answer.error);
        return;
      }
      deps.onApplied(answer.value);

      // INVARIANT 18, AFTER `onApplied` AND NOT INSTEAD OF IT. The command
      // succeeded and the view must move whether or not history was shed —
      // reporting the trim first and returning would leave the renderer showing
      // the pre-rotation page while telling the user about undo.
      //
      // Guarded on a positive count rather than opened unconditionally: the
      // dialog's schema refuses zero, so an unguarded call would be a validation
      // failure on every ordinary command rather than a modal nobody wanted.
      if (answer.value.historyDropped > 0) {
        deps.show(HISTORY_TRIMMED_DIALOG_ID, { dropped: answer.value.historyDropped });
      }
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
        // `checkpoint-restore-not-built` reaches a user here and nowhere else.
        // It is a fact about this build rather than about their document, and
        // §4's answer to it is the checkpoint restore invariant 18 clause (ii)
        // defers — so until that lands, saying so is the whole of the response.
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
  readonly show: (id: string, props: unknown) => void;
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
      deps.show(SAVE_PROBLEM_DIALOG_ID, {
        outcome: answer.value.kind === 'write-failed' ? 'write-failed' : answer.value.reason,
      });
    },
  };
}
