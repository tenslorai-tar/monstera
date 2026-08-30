import type { ContractClient } from '@monstera/contract';
import type { DocVersion } from '@monstera/shared';

import { ROTATE_PAGE_TITLE, SAVE_TITLE, UNDO_TITLE } from '../messages/en.js';
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
 * ## Page 1, and the honest reason
 *
 * The renderer shows page 1 and has no page navigation, so *the page on screen*
 * is page 1. Rotating "the current page" is what this will mean when there is a
 * current page; today the two are the same value and the command says the true
 * one rather than the aspirational one.
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
export function rotatePageCommand(deps: DocumentCommandDeps): UiCommand {
  return {
    id: 'document.rotate-page',
    title: ROTATE_PAGE_TITLE,
    placements: [{ surface: 'quick-toolbar', order: 10 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      const answer = await deps.client['document.execute']({
        docId: context.docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      });
      // A DECLARED FAILURE IS AN OUTCOME AND CHANGES NOTHING. `document-busy`,
      // `document-not-open` and `document-poisoned` all leave the document
      // exactly as it was, so telling the caller the view moved would make it
      // rebuild for nothing — and a rebuild is a visible reparse.
      if (!answer.ok) return;
      deps.onApplied(answer.value);
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
      if (!answer.ok) return;
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
 * an error here. What is owed is telling the user, which needs a dialog nothing
 * has registered yet; until then a refused save is silent, and the FEATURES row
 * says so rather than this comment implying it is handled.
 */
export function saveCommand(deps: { readonly client: ContractClient }): UiCommand {
  return {
    id: 'document.save',
    title: SAVE_TITLE,
    shortcut: 'Ctrl+S',
    placements: [{ surface: 'quick-toolbar', order: 30 }],
    when: hasDocument,
    run: async (context): Promise<void> => {
      if (context.docId === undefined) return;
      await deps.client['document.save']({ docId: context.docId });
    },
  };
}
