import {
  type Fmt,
  type FormatState,
  allWords,
  formatRange,
  indentParagraphs,
  setParagraphs,
  stateAt,
  toggleList,
} from './textFormatting.js';
import type { Nudge } from './textPlacement.js';

/**
 * The open in-place editor, as the commands that format it see it
 * ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)).
 *
 * ## One editor at a time, and a command asks *is there one*
 *
 * A formatting command is a projection like any other (ribbon, shortcut, palette), and a projection has no editor to
 * hand: the editor lives in a component. This holds the one that is open, registered by the editor for its life, so a
 * command's `when` can say *an editor is open* and its `run` can act on it, with no second wiring place (B3a).
 *
 * ## The selection is the editor's, remembered
 *
 * A button press takes the focus from the editor, and with it the browser's selection. The editor keeps the range it
 * last had (`selectionchange`) so a press on a control that does take focus — a size field, a colour — still formats
 * the words that were chosen.
 */
export interface OpenEditor {
  readonly root: HTMLElement;
  /** The editor's zoom, which a style it draws is multiplied by. */
  readonly zoom: () => number;
  /** What is done to the BLOCK rather than to its words: removed, or placed by one key's step. */
  readonly block: {
    readonly remove: () => void;
    readonly nudge: (nudge: Nudge) => void;
  };
}

let open: OpenEditor | undefined;
let remembered: Range | undefined;
const listeners = new Set<() => void>();

/** Counts every change, which is what a control that re-reads the state subscribes to: the state itself is not a snapshot. */
let revision = 0;
export const editorRevision = (): number => revision;

const announce = (): void => {
  revision += 1;
  for (const listener of [...listeners]) listener();
};

/** Registers the open editor; the answer unregisters it. */
export function registerEditor(editor: OpenEditor): () => void {
  open = editor;
  remembered = undefined;
  const document = editor.root.ownerDocument;
  const keep = (): void => {
    const selection = document.getSelection();
    if (selection === null || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (editor.root.contains(range.commonAncestorContainer)) {
      remembered = range.cloneRange();
      announce();
    }
  };
  document.addEventListener('selectionchange', keep);
  announce();
  return () => {
    document.removeEventListener('selectionchange', keep);
    if (open === editor) {
      open = undefined;
      remembered = undefined;
    }
    announce();
  };
}

/** Removes the open block from the page when the editor next writes: its words go, which is what removes a block. */
export function removeOpenBlock(): boolean {
  if (open === undefined) return false;
  open.block.remove();
  return true;
}

/** Places the open block one step, as a key does a drag. */
export function nudgeOpenBlock(nudge: Nudge): boolean {
  if (open === undefined) return false;
  open.block.nudge(nudge);
  return true;
}

/** Whether an editor is open: what every formatting command's `when` asks. */
export const editorIsOpen = (): boolean => open !== undefined;

/** Subscribes to the editor opening, closing and its selection moving. */
export function onEditorChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The range the formatting acts on: what the editor has selected, else what it last had, else its whole words. */
function target(editor: OpenEditor): Range {
  const selection = editor.root.ownerDocument.getSelection();
  const live = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
  if (live !== undefined && editor.root.contains(live.commonAncestorContainer) && !live.collapsed) return live;
  if (remembered !== undefined && editor.root.contains(remembered.commonAncestorContainer) && !remembered.collapsed) {
    return remembered;
  }
  // NOTHING SELECTED: the paragraph the caret is in, so a press on Bold with the caret in a word bolds the paragraph's
  // words as a word processor does not, but never silently does nothing; the person selects to narrow it.
  const range = editor.root.ownerDocument.createRange();
  const at = live ?? remembered;
  const paragraph = at === undefined ? undefined : paragraphOf(editor.root, at.startContainer);
  range.selectNodeContents(paragraph ?? editor.root);
  return range;
}

function paragraphOf(root: HTMLElement, node: Node): Node | undefined {
  for (let at: Node | null = node; at !== null && at !== root; at = at.parentNode) {
    if (at.parentNode === root && at instanceof HTMLElement && at.tagName === 'DIV') return at;
  }
  return undefined;
}

/** A formatting action: what a command, a chord or the editor's bar asks. */
export type FormatAction =
  | { readonly kind: 'toggle'; readonly property: 'bold' | 'italic' | 'underline' }
  | { readonly kind: 'rise'; readonly rise: 'superscript' | 'subscript' }
  | { readonly kind: 'set'; readonly change: { readonly [K in keyof Fmt]?: Fmt[K] | null } }
  | { readonly kind: 'align'; readonly align: 'left' | 'center' | 'right' }
  | { readonly kind: 'indent'; readonly steps: number }
  | { readonly kind: 'list'; readonly list: 'bullet' | 'number' }
  | { readonly kind: 'spacing'; readonly lineSpacing: number | null };

/** Runs `action` on the open editor, answering whether anything changed. */
export function formatOpenEditor(action: FormatAction): boolean {
  const editor = open;
  if (editor === undefined) return false;
  const range = target(editor);
  const zoom = editor.zoom();
  switch (action.kind) {
    case 'toggle': {
      const on = allWords(editor.root, range, (state) => state[action.property]);
      return formatRange(editor.root, range, { [action.property]: on ? false : true }, zoom);
    }
    case 'rise': {
      const on = allWords(editor.root, range, (state) => state.rise === action.rise);
      return formatRange(editor.root, range, { rise: on ? null : action.rise }, zoom);
    }
    case 'set':
      return formatRange(editor.root, range, action.change, zoom);
    case 'align':
      return setParagraphs(editor.root, range, { align: action.align }, zoom) > 0;
    case 'indent':
      return indentParagraphs(editor.root, range, action.steps, zoom) > 0;
    case 'list':
      return toggleList(editor.root, range, action.list, zoom) > 0;
    case 'spacing':
      return setParagraphs(editor.root, range, { lineSpacing: action.lineSpacing }, zoom) > 0;
  }
}

/** What the words at the selection are now, for the controls that show a state; `undefined` with no editor open. */
export function openEditorState(): FormatState | undefined {
  const editor = open;
  if (editor === undefined) return undefined;
  const range = remembered ?? target(editor);
  const walker = editor.root.ownerDocument.createTreeWalker(editor.root, 4);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (range.intersectsNode(node) && (node as Text).data !== '') return stateAt(node, editor.root);
  }
  return undefined;
}
