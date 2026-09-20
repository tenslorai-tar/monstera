import type { RenderableCommand } from '@monstera/contract';

import { type MarkupType, markupCommand } from '../annotations/textMarkupTools.js';
import type { AnnotationStyle } from '../annotations/annotationStyle.js';
import {
  COPY_SELECTION_TITLE,
  HIGHLIGHT_SELECTION_TITLE,
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
  readonly place: (command: RenderableCommand) => void;
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
