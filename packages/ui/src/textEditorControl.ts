import type { PARAGRAPH_ALIGNMENTS } from '@monstera/contract';

import {
  type Fmt,
  type FormatState,
  allWords,
  formatRange,
  indentParagraphs,
  paragraphSettingAt,
  setParagraphs,
  stateAt,
  toggleList,
  toggled,
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
  /** Writes the words and closes the editor, as the focus leaving it does. */
  readonly finish: () => void;
  /** The names of the fonts the page's text is drawn in, as the read gave them: the picker's *In this document*. */
  readonly fonts: readonly string[];
}

/** The fonts of the page the open editor is on, or none with no editor open. */
export function openEditorFonts(): readonly string[] {
  return open?.fonts ?? [];
}

/**
 * The attribute that marks an element whose focus is the open editor's own (the owner's K11): the Properties panel's text
 * section. A focus moving from the words into it does not write and close the editor, as a focus moving within the
 * editor's frame does not; the section finishes the editor itself when the focus leaves both ({@link leavesEditor}).
 */
export const KEEPS_EDITOR = 'data-keeps-editor';

/** Whether a focus arriving at `node` stays with the open editor: inside an element marked {@link KEEPS_EDITOR}. */
export function keepsEditor(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(`[${KEEPS_EDITOR}]`) !== null;
}

/**
 * Whether a focus going to `node` leaves the open editor altogether: not into its words, and not into an element that
 * keeps it. `null` (the focus going to nothing focusable) leaves it, as it does the editor's own frame.
 */
export function leavesEditor(node: EventTarget | null): boolean {
  if (keepsEditor(node)) return false;
  const editor = open;
  if (editor === undefined) return false;
  const frame = editor.root.closest('.m-text-editor-frame') ?? editor.root;
  return !(node instanceof Node && frame.contains(node));
}

/** Finishes the open editor, for a surface that keeps it and is left. */
export function finishOpenEditor(): boolean {
  if (open === undefined) return false;
  open.finish();
  return true;
}

/** Puts the focus back in the open editor's words, after a value control that took it was used. */
export function refocusOpenEditor(): void {
  open?.root.focus();
}

let open: OpenEditor | undefined;
let remembered: Range | undefined;
const listeners = new Set<() => void>();

/** Counts every change: the open editor opening, closing, or its selection moving. */
let revision = 0;

/** What a control showing the open editor's words reads: its words' state, its paragraph's, and its page's fonts. */
export interface EditorSnapshot {
  readonly state: FormatState | undefined;
  readonly paragraph: ReturnType<typeof paragraphSettingAt> | undefined;
  readonly fonts: readonly string[];
}

let snapshot: { readonly revision: number; readonly value: EditorSnapshot } | undefined;

/**
 * `useSyncExternalStore`'s snapshot for a control that shows the open editor: ONE OBJECT PER REVISION, read when the
 * revision has moved and the same object until it moves again.
 *
 * A control read the state itself during its render, with a subscription only to be rendered again (ADR-0258): to the
 * React Compiler that read has no inputs, so a compiled panel read it once and kept it — the Bold button stayed
 * unpressed after Ctrl+B (`textFormat.pw.ts`, measured with the compiler on and off, 2026-10-21). What the render reads
 * is now the snapshot itself, which is an input.
 */
export function openEditorSnapshot(): EditorSnapshot {
  if (snapshot?.revision !== revision) {
    snapshot = { revision, value: { state: openEditorState(), paragraph: openParagraphState(), fonts: openEditorFonts() } };
  }
  return snapshot.value;
}

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
  // AS THE FOCUS LEAVES THE WORDS, too: `selectionchange` is a queued task that reads the selection when it RUNS, so words
  // chosen and a field focused within one task are read after the selection became the field's, and the next format
  // fell back to the whole paragraph (measured on pinned Chromium, `textFormat.pw.ts`' same-moment case). `focusout` runs
  // inside the focus move, while the selection is still the words'.
  editor.root.addEventListener('focusout', keep);
  announce();
  return () => {
    document.removeEventListener('selectionchange', keep);
    editor.root.removeEventListener('focusout', keep);
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

/** A formatting action: what a command, a chord or the Properties panel's text section asks. */
export type FormatAction =
  | { readonly kind: 'toggle'; readonly property: 'bold' | 'italic' | 'underline' | 'strike' }
  | { readonly kind: 'rise'; readonly rise: 'superscript' | 'subscript' }
  | { readonly kind: 'set'; readonly change: { readonly [K in keyof Fmt]?: Fmt[K] | null } }
  | { readonly kind: 'align'; readonly align: (typeof PARAGRAPH_ALIGNMENTS)[number] }
  | { readonly kind: 'indent'; readonly steps: number }
  | { readonly kind: 'list'; readonly list: 'bullet' | 'number' }
  | { readonly kind: 'spacing'; readonly lineSpacing: number | null }
  /** Points below the paragraphs, before the next one (ADR-0228), or `null` to take the person's setting off. */
  | { readonly kind: 'space-after'; readonly points: number | null };

/** The sizes a step up or down moves through, a word processor's list. */
const SIZE_STEPS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72] as const;
/** The largest a step goes; past the list it moves by ten, to the contract's bound. */
const MAX_STEPPED_SIZE = 400;

/** The size one step up (`+1`) or down (`-1`) from `size`: the next on the list, then tens past it, never under one. */
export function steppedSize(size: number, direction: 1 | -1): number {
  if (direction === 1) {
    const next = SIZE_STEPS.find((step) => step > size);
    return next ?? Math.min(MAX_STEPPED_SIZE, Math.floor(size / 10) * 10 + 10);
  }
  const top = SIZE_STEPS[SIZE_STEPS.length - 1] ?? 72;
  if (size > top) return Math.max(top, Math.ceil(size / 10) * 10 - 10);
  const previous = [...SIZE_STEPS].reverse().find((step) => step < size);
  return previous ?? Math.max(1, size - 1);
}

/** Runs `action` on the open editor, answering whether anything changed. */
export function formatOpenEditor(action: FormatAction): boolean {
  const editor = open;
  if (editor === undefined) return false;
  const range = target(editor);
  const zoom = editor.zoom();
  /** The words formatted are what the editor has selected now, whichever range they were reached through. */
  const keeping = (changed: boolean): boolean => {
    if (changed && !range.collapsed) remembered = range.cloneRange();
    return changed;
  };
  switch (action.kind) {
    case 'toggle':
      return keeping(formatRange(editor.root, range, toggled(editor.root, range, action.property), zoom));
    case 'rise': {
      const on = allWords(editor.root, range, (state) => state.rise === action.rise);
      return keeping(formatRange(editor.root, range, { rise: on ? null : action.rise }, zoom));
    }
    case 'set':
      return keeping(formatRange(editor.root, range, action.change, zoom));
    case 'align':
      return setParagraphs(editor.root, range, { align: action.align }, zoom) > 0;
    case 'indent':
      return indentParagraphs(editor.root, range, action.steps, zoom) > 0;
    case 'list':
      return toggleList(editor.root, range, action.list, zoom) > 0;
    case 'spacing':
      return setParagraphs(editor.root, range, { lineSpacing: action.lineSpacing }, zoom) > 0;
    case 'space-after':
      return setParagraphs(editor.root, range, { spaceAfter: action.points }, zoom) > 0;
  }
}

/** How the paragraph at the selection is set, for the fields that show a paragraph's setting; `undefined` with none open. */
export function openParagraphState(): ReturnType<typeof paragraphSettingAt> | undefined {
  const editor = open;
  if (editor === undefined) return undefined;
  const range = remembered ?? target(editor);
  return paragraphSettingAt(editor.root, range.startContainer);
}

/**
 * The size most of the words in `range` use, counted by character and leaving white space out (cloud run 21, the owner's
 * C3). The range is the one a size typed into the field applies to (`target`): the characters selected, or at a caret the
 * paragraph it is in, which for a block of one paragraph is the block. `undefined` where no character has a size.
 *
 * ## Why not the size of the first character, as every other value is read
 *
 * A paragraph ending in small raised reference markers opened with its caret after the last marker, and the size field
 * said 7.88, the markers', for a paragraph set at 10 (the owner's video of 2026-10-26). One character speaks for the
 * whole field that way, and a marker is the character least like the rest. The markers keep their own size: this is
 * only what is SHOWN, and a size typed into the field is applied to the selection as before.
 */
function sizeMostUsed(root: HTMLElement, range: Range): number | undefined {
  const counts = new Map<number, number>();
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (!range.collapsed && !range.intersectsNode(text)) continue;
    const from = !range.collapsed && range.startContainer === text ? range.startOffset : 0;
    const to = !range.collapsed && range.endContainer === text ? range.endOffset : text.data.length;
    const characters = text.data.slice(from, to).replace(/\s/gu, '').length;
    const { size } = stateAt(text, root);
    if (characters === 0 || size === undefined) continue;
    counts.set(size, (counts.get(size) ?? 0) + characters);
  }
  let most: number | undefined;
  for (const [size, count] of counts) if (most === undefined || count > (counts.get(most) ?? 0)) most = size;
  return most;
}

/** What the words at the selection are now, for the controls that show a state; `undefined` with no editor open. */
export function openEditorState(): FormatState | undefined {
  const state = stateAtSelection();
  const editor = open;
  if (state === undefined || editor === undefined) return state;
  const size = sizeMostUsed(editor.root, remembered ?? target(editor));
  return size === undefined ? state : { ...state, size };
}

/** What the words at the selection's first character are now, every value as that character has it. */
function stateAtSelection(): FormatState | undefined {
  const editor = open;
  if (editor === undefined) return undefined;
  const range = remembered ?? target(editor);
  const walker = editor.root.ownerDocument.createTreeWalker(editor.root, 4);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (range.intersectsNode(node) && (node as Text).data !== '') return stateAt(node, editor.root);
  }
  // NO LETTER AT THE SELECTION — a new box of Add text before its first key, an emptied line: the run the selection
  // starts in still has a size and a look, and the words typed there take them, so they are what is shown (W4).
  // The node at the start, and where that is a line rather than a run, the line's first run.
  const start = range.startContainer;
  const at = start instanceof Text ? start : (start.childNodes[range.startOffset] ?? start.lastChild ?? start);
  const run = at instanceof Element && at.closest(RUN) === null ? at.querySelector(RUN) : at;
  return run === null || run === editor.root ? undefined : stateAt(run, editor.root);
}

/** A run of the editor, which carries the page's size and look of the words in it (`drawRun`). */
const RUN = '.m-text-editor__run';
