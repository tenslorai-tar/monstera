/**
 * The editor kit's store: the model, the selection, the style the person chose for the next letters, and the undo
 * history, held in one place (B3) for the life of one open editor.
 *
 * ## The format state is SUBSCRIBED, never read in render
 *
 * The controls that show a state — bold on, off or mixed, the size field — read {@link EditorStore.format} through
 * `useSyncExternalStore`. The state is derived once per change and kept, so a snapshot is the same object until something
 * a control shows has moved: the React Compiler memoises a component by its inputs, and a value read imperatively during
 * render was what left a pressed button unpressed until a tab switch in the editor this replaces (ADR-0258's correction).
 *
 * ## Undo inside the editor is by keystroke
 *
 * Each change pushes the state before it; letters typed one after another into one word are one step, as a word
 * processor joins them, so Ctrl+Z takes back a word, not a letter. Undo after the editor has finished is the document's
 * command history, one step for the whole edit, and is not this store's.
 */

import { formatState, isCollapsed, sameModel, type Edited, type FormatState, type Model, type RunStyle, type Selection } from './model.js';

export interface EditorSnapshot {
  readonly model: Model;
  readonly selection: Selection;
  /** The style the next letters take, where the person chose one with a caret; cleared when the caret moves. */
  readonly pending: RunStyle | undefined;
}

/** How a change joins the step before it in the undo history. */
export type ChangeKind = 'typing' | 'other';

export interface EditorStore {
  readonly get: () => EditorSnapshot;
  readonly format: () => FormatState;
  readonly subscribe: (listener: () => void) => () => void;
  /** A change to the words or their styles. */
  readonly change: (edited: Edited, kind: ChangeKind, typed?: string) => void;
  /** The caret or selection moved, nothing else. */
  readonly select: (selection: Selection) => void;
  /** The style the next letters take, with a caret. */
  readonly setPending: (style: RunStyle | undefined) => void;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  /** Whether the words or their styles differ from the model the editor opened with. */
  readonly changed: () => boolean;
}

/** How many steps the history keeps: a long session of typing in one block, and no more. */
const HISTORY = 500;

export function createEditorStore(opened: Edited): EditorStore {
  let snapshot: EditorSnapshot = { model: opened.model, selection: opened.selection, pending: undefined };
  let format = formatState(snapshot.model, snapshot.selection);
  const listeners = new Set<() => void>();
  const past: EditorSnapshot[] = [];
  const future: EditorSnapshot[] = [];
  let lastKind: ChangeKind | undefined;

  const publish = (next: EditorSnapshot): void => {
    snapshot = next;
    // THE SAME OBJECT WHILE THE ANSWER IS THE SAME, so a control subscribed to it renders only when what it shows moves.
    const derived = formatState(next.model, next.selection, next.pending);
    if (JSON.stringify(derived) !== JSON.stringify(format)) format = derived;
    for (const listener of listeners) listener();
  };

  return {
    get: () => snapshot,
    format: () => format,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    change: (edited, kind, typed = '') => {
      // TYPING INTO THE SAME WORD is one step: the step before stays the one before the word began, and a space typed
      // ends the word, so the next letter starts a step of its own.
      const joins = kind === 'typing' && lastKind === 'typing' && isCollapsed(snapshot.selection);
      if (!joins) {
        past.push(snapshot);
        if (past.length > HISTORY) past.shift();
      }
      future.length = 0;
      lastKind = kind === 'typing' && /\s$/u.test(typed) ? undefined : kind;
      publish({ model: edited.model, selection: edited.selection, pending: kind === 'typing' ? snapshot.pending : undefined });
    },
    select: (selection) => {
      lastKind = undefined;
      publish({ ...snapshot, selection, pending: undefined });
    },
    setPending: (style) => {
      publish({ ...snapshot, pending: style });
    },
    undo: () => {
      const previous = past.pop();
      if (previous === undefined) return false;
      future.push(snapshot);
      lastKind = undefined;
      publish(previous);
      return true;
    },
    redo: () => {
      const next = future.pop();
      if (next === undefined) return false;
      past.push(snapshot);
      lastKind = undefined;
      publish(next);
      return true;
    },
    changed: () => !sameModel(snapshot.model, opened.model),
  };
}
