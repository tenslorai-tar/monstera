import type { DispatchableCommand } from '@monstera/contract';

import { stickyNoteCommand } from '../annotations/pointTools.js';
import { STROKE } from '../annotations/shapeTools.js';
import { type MarkupType, markupCommand } from '../annotations/textMarkupTools.js';
import type { AnnotationStyle } from '../annotations/annotationStyle.js';
import { ANNOTATION_NOTE_DIALOG_ID } from '../dialogs/annotationNote.js';
import { ANNOTATION_TEXT_RESULT } from '../dialogs/annotationTextResult.js';
import {
  COMMENT_SELECTION_TITLE,
  COPY_SELECTION_TITLE,
  GROUP_TEXT,
  HIGHLIGHT_SELECTION_TITLE,
  REDACT_SELECTION_TITLE,
  SEARCH_SELECTION_TITLE,
  STRIKEOUT_SELECTION_TITLE,
  UNDERLINE_SELECTION_TITLE,
} from '../messages/en.js';
import type { UiCommand } from '../registries/commands.js';
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
    title: COPY_SELECTION_TITLE,
    shortcut: 'Ctrl+C',
    icon: 'Copy',
    placements: [
      { surface: 'context-menu', context: 'selection', order: 10 },
      // AND EDIT › TEXT, D4's *select and copy*: present while there is a selection to copy.
      { surface: 'ribbon', section: 'edit', group: GROUP_TEXT, order: 50 },
    ],
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
 * The same dialog collects the text, and {@link stickyNoteCommand} builds the same draft, so a note
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
 * ## Asked, then placed, and a dismissal leaves nothing
 *
 * The selection is read BEFORE the dialog opens, which is `stickyNoteTool`'s rule about the
 * transform arriving one gesture earlier: a person who dismisses the dialog has changed nothing,
 * and a person who selects something else while it is open still gets the note they asked for.
 */
export function commentSelectionCommand(
  deps: TextSelectionDeps & { readonly ask: (id: string, props: unknown) => Promise<unknown> },
): UiCommand {
  return {
    id: 'text.comment',
    title: COMMENT_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'selection', order: 50 }],
    when: selected(deps),
    run: async (context): Promise<void> => {
      const selection = deps.selection();
      if (context.docId === undefined || selection === undefined) return;
      const style = deps.style();
      const answered = ANNOTATION_TEXT_RESULT.safeParse(
        await deps.ask(ANNOTATION_NOTE_DIALOG_ID, {}),
      );
      // A DISMISSED DIALOG AND A REFUSED ANSWER ARE BOTH NOTHING TO BUILD FROM, which is the
      // platform's gate and `stickyNoteTool`'s comment on it: a parse failure here means the id
      // resolved to a dialog answering another shape, a registration defect rather than a person's
      // doing, and the page is unchanged either way.
      if (!answered.success) return;
      deps.place(stickyNoteCommand(selection.page, selection.from, answered.data.text, style));
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
    title: REDACT_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'selection', order: 60 }],
    when: selected(deps),
    run: (context): void => {
      const selection = deps.selection();
      if (context.docId === undefined || selection === undefined) return;
      const style = deps.style();
      deps.place({
        kind: 'addAnnotation',
        page: selection.page,
        annotation: {
          type: 'redact',
          over: 'text',
          from: selection.from,
          to: selection.to,
          // THE DRAG TOOL'S OWN DEFAULT, resolved through the style exactly as `redactTool` does,
          // so a mark made from the menu and one swept with the tool are the same colour. No border
          // width: MuPDF refuses one on a Redact, and the draft has no field for it.
          colour: style.colour(STROKE),
          opacity: style.opacity,
        },
      });
    },
  };
}

/** Searches the document for the selected text, in the Search panel. */
export function searchSelectionCommand(deps: TextSelectionDeps): UiCommand {
  return {
    id: 'text.search',
    title: SEARCH_SELECTION_TITLE,
    placements: [{ surface: 'context-menu', context: 'selection', order: 70 }],
    when: selected(deps),
    run: (): void => {
      const selection = deps.selection();
      if (selection !== undefined) deps.search(selection.text);
    },
  };
}
