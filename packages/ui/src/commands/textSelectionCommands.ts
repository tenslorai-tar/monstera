import type { DispatchableCommand } from '@monstera/contract';

import { stickyNoteCommand } from '../annotations/pointTools.js';
import { type MarkupType, markupCommand, redactTextCommand } from '../annotations/textMarkupTools.js';
import type { AnnotationStyle } from '../annotations/annotationStyle.js';
import { writeAnnotationWords } from '../annotations/textTools.js';
import {
  COMMENT_SELECTION_TITLE,
  COPY_SELECTION_TITLE,
  HIGHLIGHT_SELECTION_TITLE,
  REDACT_SELECTION_TITLE,
  SEARCH_SELECTION_TITLE,
  STRIKEOUT_SELECTION_TITLE,
  UNDERLINE_SELECTION_TITLE,
  WRITE_NOTE_LABEL,
} from '../messages/en.js';
import type { Write } from '../pageWriting.js';
import { TOASTS, type UiCommand, VISIBLE } from '../registries/commands.js';
import type { TextSelection } from '../TextLayer.js';

/**
 * The selected-text menu (§7; the owner's list, 2026-09-19: copy, highlight, underline,
 * strikethrough, comment, redact, search).
 *
 * ## The selection is read, never held
 *
 * `selection()` answers what the browser has selected in one page's text layer NOW
 * (`readTextSelection`, through `App`'s tracked state), so an item acts on the text the person sees
 * selected, and `when` hides every item where nothing is.
 *
 * ## A markup names its run by two ends, as the drag tools do
 *
 * Highlight, underline and strikethrough dispatch `markupCommand` — the drag tools' own builder —
 * with the selection's two ends, and MuPDF resolves the text between them. So a highlight made from
 * the menu and one made by dragging the tool are the same command, and neither decides where the
 * run starts or stops.
 */
export interface TextSelectionDeps {
  /** The selection in the focused document, or `undefined`. */
  readonly selection: () => TextSelection | undefined;
  /**
   * Dispatches a command against the FOCUSED document — `App`'s one dispatcher, which every
   * annotation tool's commit takes. The focused document is the one whose text layer holds the
   * selection, because a text selection is only tracked there.
   */
  readonly place: (command: DispatchableCommand) => void;
  /** The style the next annotation is drawn in — the markup tools' own. */
  readonly style: () => AnnotationStyle;
  /** Opens the find field searching for `text`. */
  readonly search: (text: string) => void;
  /** Copies the current selection, as Ctrl+C does. */
  readonly copy: () => void;
}

const selected = (deps: TextSelectionDeps) => (): boolean => deps.selection() !== undefined;

/** Copies the selected text — the platform's own copy of what is selected, as Ctrl+C is. */
export function copySelectionCommand(deps: TextSelectionDeps): UiCommand {
  return {
    id: 'text.copy',
    // THROUGH `windowEdit`, which confirms on main's word (`confirmCopied`).
    feedback: TOASTS,
    title: COPY_SELECTION_TITLE,
    // NO CHORD OF ITS OWN: Ctrl+C is `edit.copy`'s, which runs this when the page's text is what is selected (ADR-0107).
    icon: 'Copy',
    // THE SELECTION'S MENU ONLY. Edit › Text's *Copy* is `edit.copy`, which copies the page's selected text first: two
    // commands both called Copy put the action in the Edit menu twice (item 5b), which the registry now refuses.
    placements: [{ surface: 'context-menu', context: 'selection', order: 10 }],
    when: selected(deps),
    run: (): void => {
      deps.copy();
    },
  };
}

const MARKUPS: readonly { readonly type: MarkupType; readonly id: string; readonly order: number; readonly title: typeof HIGHLIGHT_SELECTION_TITLE }[] = [
  { type: 'highlight', id: 'text.highlight', order: 20, title: HIGHLIGHT_SELECTION_TITLE },
  { type: 'underline', id: 'text.underline', order: 30, title: UNDERLINE_SELECTION_TITLE },
  { type: 'strikeout', id: 'text.strikeout', order: 40, title: STRIKEOUT_SELECTION_TITLE },
];

/** Highlight, underline and strikethrough of the selected text, one command each. */
export function markupSelectionCommands(deps: TextSelectionDeps): readonly UiCommand[] {
  return MARKUPS.map(({ type, id, order, title }) => ({
    id,
    feedback: VISIBLE,
    title,
    placements: [{ surface: 'context-menu', context: 'selection', order }] as const,
    when: selected(deps),
    run: (context): void => {
      const selection = deps.selection();
      if (context.docId === undefined || selection === undefined) return;
      deps.place(markupCommand(type, selection.page, selection.from, selection.to, deps.style()));
    },
  }));
}

/**
 * A COMMENT on the selected text — the sticky note, placed where the selection begins.
 *
 * ## It is the note tool's feature reached a second way, not a second feature
 *
 * The same box on the page collects the text, and {@link stickyNoteCommand} builds the same draft, so a note
 * written from the menu and one placed with the tool are one command with one colour rule. The
 * markups' arrangement exactly — a menu item that decided what a note was would be the second
 * wiring place the registry exists to forbid.
 *
 * ## WHERE it goes: the selection's start, which is where the person began
 *
 * A note is an icon at a point, not a run — MuPDF normalises a `/Text` to a fixed 20-by-20 box —
 * so a selection has to be reduced to one point and there is no arrangement in which it covers the
 * words. `from` is that point for `stickyNoteTool`'s own reason: it is where the gesture started
 * rather than where it ended, and a hand that selected right-to-left still meant the word it began
 * on.
 *
 * **What this gives up, stated rather than discovered later:** the note is anchored beside the text
 * and not TO it, so editing the page does not carry it along, and nothing in the file records which
 * run it was about. A markup carrying `/Contents` would — and text markups in this contract carry
 * no text field, so that is a contract change with no row asking for one. This row asked for
 * *comment*, and a note at the selection is the feature this platform already has.
 *
 * ## Asked, then placed, and nothing typed leaves nothing
 *
 * The selection is read BEFORE the box opens, which is `stickyNoteTool`'s rule about the
 * transform arriving one gesture earlier: a person who types nothing has changed nothing, and a
 * person who selects something else while it is open still gets the note they asked for.
 */
export function commentSelectionCommand(deps: TextSelectionDeps & { readonly write: Write }): UiCommand {
  return {
    id: 'text.comment',
    feedback: VISIBLE,
    title: COMMENT_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'selection', order: 50 }],
    when: selected(deps),
    run: async (context): Promise<void> => {
      const selection = deps.selection();
      if (context.docId === undefined || selection === undefined) return;
      const style = deps.style();
      const at = selection.from;
      // THE NOTE TOOL'S REQUEST, through the one helper that asks for an annotation's words: a card at
      // the point the note will sit, in the application's face, since a comment is not drawn there.
      const text = await writeAnnotationWords(
        { write: deps.write, style },
        {
          page: selection.page,
          box: { x0: at.x, y0: at.y, x1: at.x, y1: at.y },
          label: WRITE_NOTE_LABEL,
          colour: undefined,
          grows: false,
        },
      );
      // NOTHING TYPED IS NOTHING TO BUILD FROM, which is the platform's gate and `stickyNoteTool`'s.
      if (text === undefined) return;
      deps.place(stickyNoteCommand(selection.page, at, text, style));
    },
  };
}

/**
 * MARKS the selected text for removal — the redact tool's kind, placed by a selection.
 *
 * ## It marks, and marking is the whole of it
 *
 * The burn-in is a different command with a different save mode (ADR-0008 rule 1), and this one
 * must never be mistaken for it: the words are still in the file until *Apply redactions* runs.
 *
 * ## Two ends rather than a box, and the engine decides the lines
 *
 * `markupSelectionCommands`' rule, and for a redaction it is the difference between removing what
 * somebody selected and removing the rectangle their selection swept — which over two part-width
 * lines is everything between them. Measured 2026-09-20, MuPDF 1.28.0: the stored quads are what
 * `applyRedactions` acts on, so the marked run is what goes.
 */
export function redactSelectionCommand(deps: TextSelectionDeps): UiCommand {
  return {
    id: 'text.redact',
    feedback: VISIBLE,
    title: REDACT_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'selection', order: 60 }],
    when: selected(deps),
    run: (context): void => {
      const selection = deps.selection();
      if (context.docId === undefined || selection === undefined) return;
      // THE REDACT TEXT TOOL'S OWN BUILDER, so a mark made from the menu and one made with the tool are one command.
      deps.place(redactTextCommand(selection.page, selection.from, selection.to, deps.style()));
    },
  };
}

/** Searches the document for the selected text, in the Search panel. */
export function searchSelectionCommand(deps: TextSelectionDeps): UiCommand {
  return {
    id: 'text.search',
    feedback: VISIBLE,
    title: SEARCH_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'selection', order: 70 }],
    when: selected(deps),
    run: (): void => {
      const selection = deps.selection();
      if (selection !== undefined) deps.search(selection.text);
    },
  };
}
