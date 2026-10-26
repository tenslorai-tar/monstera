import type { BlockMarkSet, PARAGRAPH_ALIGNMENTS } from '@monstera/contract';

import { type FormatAction as KitAction, type StyleValue, format } from './format.js';
import { type Alignment, type FormatState as KitState, type RunStyle, isCollapsed, styleAt } from './model.js';
import type { EditorStore } from './store.js';
import type { Nudge } from '../textPlacement.js';

/**
 * The open kit editor, as the commands and panels that format it see it
 * ([ADR-0180](../../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md),
 * [ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3).
 *
 * ## One editor at a time, and a command asks *is there one*
 *
 * A formatting command is a projection like any other (ribbon, shortcut, palette), and a projection has no editor to
 * hand: the editor lives in a component. This holds the one that is open, registered by it for its life, so a command's
 * `when` can say *an editor is open* and its `run` can act on it, with no second wiring place (B3a).
 *
 * ## The state is the STORE'S, subscribed
 *
 * What the controls show — Bold pressed, the size in the field — is the kit store's format state, published by the
 * store on every change and read through {@link openEditorSnapshot}, one object per change. Nothing reads the DOM: the
 * selection the state is of is the model's, which keeps the words a control acts on when a field takes the focus.
 */
export interface OpenEditor {
  readonly store: EditorStore;
  /** The editable surface, for the focus to go back to. */
  readonly root: () => HTMLElement | null;
  /** What is done to the BLOCK rather than to its words: removed, or placed by one key's step. */
  readonly block: {
    readonly remove: () => void;
    readonly nudge: (nudge: Nudge) => void;
  };
  /** Writes the words and closes the editor, as a press outside it does. */
  readonly finish: () => void;
  /** The names of the fonts the page's text is drawn in: the picker's *In this document*. */
  readonly fonts: readonly string[];
}

/** A formatting action as a command or a panel asks it: the contract's names for the letters' properties. */
export type FormatAction =
  | { readonly kind: 'toggle'; readonly property: 'bold' | 'italic' | 'underline' | 'strike' }
  | { readonly kind: 'rise'; readonly rise: 'superscript' | 'subscript' }
  | { readonly kind: 'set'; readonly change: { readonly [K in 'family' | 'size' | 'colour' | 'highlight' | 'spacing']?: BlockMarkSet[K] | null } }
  | { readonly kind: 'align'; readonly align: (typeof PARAGRAPH_ALIGNMENTS)[number] }
  | { readonly kind: 'indent'; readonly steps: number }
  | { readonly kind: 'list'; readonly list: 'bullet' | 'number' }
  | { readonly kind: 'spacing'; readonly lineSpacing: number | null }
  | { readonly kind: 'space-after'; readonly points: number | null };

/** What the words at the selection are, as the controls show them: a toggle is pressed where every letter has it. */
export interface FormatState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly strike: boolean;
  readonly size?: number;
  readonly colour?: { readonly r: number; readonly g: number; readonly b: number };
  readonly highlight?: { readonly r: number; readonly g: number; readonly b: number };
  readonly spacing?: number;
  readonly family?: string;
  readonly rise?: 'superscript' | 'subscript';
}

/** How the paragraph at the selection is set, for the fields that show a paragraph's setting. */
export interface ParagraphState {
  readonly align?: Alignment;
  readonly lineSpacing?: number;
  readonly spaceAfter?: number;
}

/**
 * The attribute that marks an element whose focus is the open editor's own (the owner's K11): the Properties panel's text
 * section. A focus moving into it does not finish the editor; the section finishes it when the focus leaves both.
 */
export const KEEPS_EDITOR = 'data-keeps-editor';

let open: OpenEditor | undefined;
let unsubscribeStore: (() => void) | undefined;
const listeners = new Set<() => void>();
/** Counts every change: the editor opening, closing, or its store publishing. */
let revision = 0;

const announce = (): void => {
  revision += 1;
  for (const listener of [...listeners]) listener();
};

/** Registers the open editor; the answer unregisters it. */
export function registerEditor(editor: OpenEditor): () => void {
  unsubscribeStore?.();
  open = editor;
  unsubscribeStore = editor.store.subscribe(announce);
  announce();
  return () => {
    if (open !== editor) return;
    unsubscribeStore?.();
    unsubscribeStore = undefined;
    open = undefined;
    announce();
  };
}

/** Whether an editor is open: what every formatting command's `when` asks. */
export const editorIsOpen = (): boolean => open !== undefined;

/** Subscribes to the editor opening, closing and anything it shows changing. */
export function onEditorChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a focus arriving at `node` stays with the open editor: inside an element marked {@link KEEPS_EDITOR}. */
export function keepsEditor(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest(`[${KEEPS_EDITOR}]`) !== null;
}

/** Whether a focus going to `node` leaves the open editor altogether: not into its frame, and not into what keeps it. */
export function leavesEditor(node: EventTarget | null): boolean {
  if (keepsEditor(node)) return false;
  const surface = open?.root();
  if (surface === undefined || surface === null) return false;
  const frame = surface.closest('[data-kit-frame]') ?? surface;
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
  open?.root()?.focus();
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

/** The fonts of the page the open editor is on, or none with no editor open. */
export function openEditorFonts(): readonly string[] {
  return open?.fonts ?? [];
}

/** Runs `action` on the open editor, answering whether anything changed. */
export function formatOpenEditor(action: FormatAction): boolean {
  if (open === undefined) return false;
  return format(open.store, kitAction(action));
}

/** A command's action in the kit's terms: the family a mark names is the face the kit draws and keeps. */
function kitAction(action: FormatAction): KitAction {
  if (action.kind !== 'set') return action;
  const change: { [K in StyleValue]?: RunStyle[K] | null } = {};
  const { family, size, colour, highlight, spacing } = action.change;
  if (family !== undefined) change.face = family;
  if (size !== undefined) change.size = size;
  if (colour !== undefined) change.colour = colour;
  if (highlight !== undefined) change.highlight = highlight;
  if (spacing !== undefined) change.spacing = spacing;
  return { kind: 'set', change };
}

/** The kit's state as the controls show it: a mixed toggle is not pressed, and each value is the one most letters use. */
function shownState(state: KitState, here: RunStyle): FormatState {
  return {
    bold: state.bold === 'on',
    italic: state.italic === 'on',
    underline: state.underline === 'on',
    strike: state.strike === 'on',
    size: state.size.value,
    colour: state.colour.value,
    ...(here.highlight === null ? {} : { highlight: here.highlight }),
    ...(here.spacing === 0 ? {} : { spacing: here.spacing }),
    family: state.face.value,
    ...(state.superscript === 'on' ? { rise: 'superscript' as const } : state.subscript === 'on' ? { rise: 'subscript' as const } : {}),
  };
}

/** What the words at the selection are now, for the controls that show a state; `undefined` with no editor open. */
export function openEditorState(): FormatState | undefined {
  if (open === undefined) return undefined;
  const { model, selection, pending } = open.store.get();
  const here = pending ?? styleAt(model, isCollapsed(selection) ? selection.focus : selection.anchor);
  return shownState(open.store.format(), here);
}

/** How the paragraph at the caret is set; `undefined` with no editor open. */
export function openParagraphState(): ParagraphState | undefined {
  if (open === undefined) return undefined;
  const { model, selection } = open.store.get();
  const paragraph = model.paragraphs[selection.focus.paragraph];
  return paragraph === undefined ? undefined : { align: paragraph.align, lineSpacing: paragraph.lineSpacing, spaceAfter: paragraph.spaceAfter };
}

/** What a control showing the open editor reads: its words' state, its paragraph's, and its page's fonts. */
export interface EditorSnapshot {
  readonly state: FormatState | undefined;
  readonly paragraph: ParagraphState | undefined;
  readonly fonts: readonly string[];
}

let snapshot: { readonly revision: number; readonly value: EditorSnapshot } | undefined;

/** `useSyncExternalStore`'s snapshot: ONE OBJECT PER REVISION, the same object until something it shows changes. */
export function openEditorSnapshot(): EditorSnapshot {
  if (snapshot?.revision !== revision) {
    snapshot = { revision, value: { state: openEditorState(), paragraph: openParagraphState(), fonts: openEditorFonts() } };
  }
  return snapshot.value;
}

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
