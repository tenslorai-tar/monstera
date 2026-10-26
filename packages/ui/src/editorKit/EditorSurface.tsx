import type React from 'react';
import { type ReactElement, useEffect, useLayoutEffect, useRef } from 'react';

import { readSelection, selectionOfRange, writeSelection } from './dom.js';
import {
  type Edited,
  type Model,
  type Paragraph,
  type Selection,
  caret,
  comparePositions,
  deleteFrom,
  insertText,
  isCollapsed,
  ordered,
  paragraphText,
  selectedText,
  wholeBlock,
  wordStep,
} from './model.js';
import { AS_DRAWN_CLASS, type Look, paragraphElement, restyleParagraph } from './paint.js';
import type { EditorStore } from './store.js';

/**
 * The kit's editable surface ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)
 * section 5's input): the model drawn, and every change the person asks for made to the MODEL, never to the DOM.
 *
 * ## The browser proposes, the model decides
 *
 * The surface is `contenteditable` so the platform gives what only it can — a caret, selection by pointer and keys, the
 * input method, the spelling checker, the clipboard — and every `beforeinput` is cancelled and done to the model instead:
 * typing, deleting by letter, word or line, a line break, a paste, a drop, a spelling correction (each at the range the
 * browser names for it, `getTargetRanges`). The store publishes, and the paragraphs that changed are drawn again from the
 * model. So the DOM is always a drawing of the model and never a second copy of the words that can disagree with it.
 *
 * ## An input method draws its candidate itself
 *
 * A composition cannot be cancelled: the browser inserts and replaces its candidate in the DOM until it ends. The
 * surface stops drawing for it, and at `compositionend` puts the committed text into the model where the composition
 * began and draws the paragraph it touched again from the model, so what the input method left in the DOM is replaced.
 *
 * ## Built by hand, not rendered
 *
 * React renders the element empty; the paragraphs are drawn here. A paragraph's element is kept while its model object
 * is the same — the model is immutable, so an unchanged paragraph IS the same object — and only a changed one is built
 * again, which is what keeps a keystroke in a long block to one paragraph's work.
 */
export interface EditorSurfaceProps {
  readonly store: EditorStore;
  readonly look: Look;
  /**
   * The paragraphs as the editor opened over a drawing of them, and where that drawing broke each one's lines: a paragraph
   * that is still that object, with every paragraph above it, is laid out at those breaks and not painted (`paint.ts`).
   */
  readonly drawn?: { readonly paragraphs: readonly Paragraph[]; readonly wraps: readonly (readonly number[])[] } | undefined;
  readonly label: string;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  /** False while what was typed is being written: the keys still arrive, and change nothing. */
  readonly editable: boolean;
  /** The caller's own keys, asked first; answers whether it took the key. */
  readonly onKey?: (event: KeyboardEvent) => boolean;
  /** Asked before letters typed are put in the model; answers whether the caller took them to put in later itself. */
  readonly onType?: (text: string) => boolean;
  /** Told after every drawing, with the surface: what a caller measures from the layout (where the words now reach). */
  readonly onPainted?: (root: HTMLElement) => void;
  readonly surfaceRef?: React.RefObject<HTMLDivElement | null>;
}

/** Whether two selections are one. */
function sameSelection(a: Selection, b: Selection): boolean {
  return comparePositions(a.anchor, b.anchor) === 0 && comparePositions(a.focus, b.focus) === 0;
}

/** The selection a deletion by word or line covers, from a caret: to the word's or the paragraph's edge that way. */
function extended(model: Model, selection: Selection, by: 'word' | 'line', direction: -1 | 1): Selection {
  if (!isCollapsed(selection)) return selection;
  const here = selection.focus;
  const paragraph = model.paragraphs[here.paragraph];
  const length = paragraph === undefined ? 0 : paragraphText(paragraph).length;
  const there = by === 'word' ? wordStep(model, here, direction) : { paragraph: here.paragraph, offset: direction === -1 ? 0 : length };
  return { anchor: here, focus: there };
}

export function EditorSurface({ store, look, drawn, label, className, style, editable, onKey, onType, onPainted, surfaceRef }: EditorSurfaceProps): ReactElement {
  const own = useRef<HTMLDivElement>(null);
  const root = surfaceRef ?? own;
  // THE LATEST OF WHAT A HANDLER READS, so the listeners added once for the surface's life never act on a stale one.
  const latest = useRef({ editable, onKey, onType, onPainted, look, drawn });
  useLayoutEffect(() => {
    latest.current = { editable, onKey, onType, onPainted, look, drawn };
  });
  /** Draws the model as it is, for a change of look the store does not publish. */
  const repaint = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return undefined;
    const owner = element.ownerDocument;
    const built = new WeakMap<Paragraph, { readonly element: HTMLElement; readonly asDrawn: boolean; readonly look: Look }>();
    let composing: { readonly selection: Selection } | undefined;

    /**
     * Where each paragraph stood as the editor opened, in points from the surface's top: a paragraph nobody changed is
     * kept as the page drew it only while it still stands there (`paint`).
     */
    let openedTops: readonly number[] | undefined;

    /** The paragraph elements for the model, `moved` drawn by the editor whatever else they are. */
    const lay = (paragraphs: readonly Paragraph[], moved: ReadonlySet<number>): HTMLElement[] => {
      const { look: now, drawn: was } = latest.current;
      return paragraphs.map((paragraph, index) => {
        const wraps = was?.paragraphs[index] === paragraph && !moved.has(index) ? was.wraps[index] : undefined;
        const asDrawn = wraps !== undefined;
        const kept = built.get(paragraph);
        if (kept?.asDrawn === asDrawn) {
          kept.element.setAttribute('data-kit-paragraph', String(index));
          // A NEW LOOK RESTYLES THE SAME NODES (`restyleParagraph`): the words have not changed, and a node replaced under
          // a press in flight turns that press into one outside the editor.
          if (kept.look !== now) {
            restyleParagraph(kept.element, paragraph, now);
            built.set(paragraph, { ...kept, look: now });
          }
          return kept.element;
        }
        const made = paragraphElement(owner, paragraph, index, now, wraps);
        built.set(paragraph, { element: made, asDrawn, look: now });
        return made;
      });
    };

    /**
     * Draws the model. A paragraph is left as the page drew it while it is the paragraph the editor opened with, at the
     * same place in the block, AND still stands where it stood then: a change above that moved it means the page's copy
     * is no longer under it, so it is drawn too. Again until nothing more moves, since a paragraph drawn by the editor
     * may wrap again and move the ones below it. Measured against the editor this kit replaced, which drew every row
     * after a change: typing in one command of a code block redrew the three below it (`editorFidelity.pw.ts`).
     */
    const paint = (): void => {
      if (composing !== undefined) return;
      const { model, selection } = store.get();
      const { look: now } = latest.current;
      const moved = new Set<number>();
      for (let pass = 0; pass <= model.paragraphs.length; pass += 1) {
        const elements = lay(model.paragraphs, moved);
        const children = Array.from(element.children);
        if (children.length !== elements.length || children.some((child, at) => child !== elements[at])) element.replaceChildren(...elements);
        // THE OPENING'S PLACES, read once, in points so a zoom does not move them.
        openedTops ??= elements.map((row) => row.offsetTop / now.zoom);
        let more = false;
        for (const [index, row] of elements.entries()) {
          if (moved.has(index) || !row.classList.contains(AS_DRAWN_CLASS)) continue;
          const was = openedTops[index];
          if (was === undefined || Math.abs(row.offsetTop / now.zoom - was) * now.zoom > 0.5) {
            moved.add(index);
            more = true;
          }
        }
        if (!more) break;
      }
      if (owner.activeElement === element) writeSelection(element, selection);
      latest.current.onPainted?.(element);
    };

    /** The selection to act on: the browser's, which may have moved since the store last heard of it. */
    const current = (): { readonly edited: Edited; readonly pending: ReturnType<EditorStore['get']>['pending'] } => {
      const snapshot = store.get();
      const live = readSelection(element);
      const selection = live ?? snapshot.selection;
      // THE STYLE CHOSEN FOR THE NEXT LETTERS belongs to the caret it was chosen at.
      const pending = sameSelection(selection, snapshot.selection) ? snapshot.pending : undefined;
      return { edited: { model: snapshot.model, selection }, pending };
    };

    const type = (text: string, at?: Selection): void => {
      // LETTERS THE CALLER HOLDS for a layout still settling go in later, by the caller (`onType`).
      if (at === undefined && latest.current.onType?.(text) === true) return;
      const { edited, pending } = current();
      const selection = at ?? edited.selection;
      store.change(insertText(edited.model, selection, text, at === undefined ? pending : undefined), 'typing', text);
    };
    const remove = (selection: Selection, direction: -1 | 1): void => {
      const { edited } = current();
      store.change(deleteFrom(edited.model, selection, direction), 'other');
    };

    const onBeforeInput = (event: InputEvent): void => {
      if (event.inputType === 'insertCompositionText') return;
      event.preventDefault();
      if (!latest.current.editable) return;
      const { edited } = current();
      // AN ENGINE WITHOUT THE CALL (the unit tests' DOM) names no range, and the selection is acted on.
      const [target] = 'getTargetRanges' in event ? event.getTargetRanges() : [];
      const named = target === undefined ? undefined : selectionOfRange(element, target);
      const plain = event.dataTransfer?.getData('text/plain') ?? '';
      switch (event.inputType) {
        case 'insertText':
          type(event.data ?? plain);
          return;
        case 'insertReplacementText':
          // A SPELLING CORRECTION names the misspelt word, which is not the selection.
          type(event.data ?? plain, named);
          return;
        case 'insertParagraph':
        case 'insertLineBreak':
          type('\n');
          return;
        case 'insertFromPaste':
        case 'insertFromDrop':
        case 'insertFromYank':
        case 'insertFromPasteAsQuotation':
          type(plain);
          return;
        case 'deleteContentBackward':
          remove(named !== undefined && !isCollapsed(named) ? named : edited.selection, -1);
          return;
        case 'deleteContentForward':
          remove(named !== undefined && !isCollapsed(named) ? named : edited.selection, 1);
          return;
        case 'deleteWordBackward':
          remove(extended(edited.model, edited.selection, 'word', -1), -1);
          return;
        case 'deleteWordForward':
          remove(extended(edited.model, edited.selection, 'word', 1), 1);
          return;
        case 'deleteSoftLineBackward':
        case 'deleteHardLineBackward':
          remove(extended(edited.model, edited.selection, 'line', -1), -1);
          return;
        case 'deleteSoftLineForward':
        case 'deleteHardLineForward':
          remove(extended(edited.model, edited.selection, 'line', 1), 1);
          return;
        case 'deleteByCut':
        case 'deleteByDrag':
        case 'deleteContent':
          if (!isCollapsed(edited.selection)) remove(edited.selection, 1);
          return;
        case 'historyUndo':
          store.undo();
          return;
        case 'historyRedo':
          store.redo();
          return;
        default:
          // ANY OTHER INPUT — the browser's own bold, a list, an indent — is the caller's formatting to do, by its own path.
          return;
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (latest.current.onKey?.(event) === true) {
        event.preventDefault();
        return;
      }
      const chord = (event.ctrlKey || event.metaKey) && !event.altKey;
      const key = event.key.toLowerCase();
      if (chord && key === 'z') {
        event.preventDefault();
        if (latest.current.editable) {
          if (event.shiftKey) store.redo();
          else store.undo();
        }
        return;
      }
      // CTRL+A IS THE BLOCK, in the model at once: the browser's own select-all reaches the store only by a queued
      // `selectionchange`, after a control the person moves to next has taken the focus.
      if (chord && key === 'a' && !event.shiftKey) {
        event.preventDefault();
        store.select(wholeBlock(store.get().model));
        writeSelection(element, store.get().selection);
        return;
      }
      if (chord && key === 'y' && !event.shiftKey) {
        event.preventDefault();
        if (latest.current.editable) store.redo();
        return;
      }
      // TAB TYPES A TAB, the character, not a move of the focus out of the words (ADR-0228 Decision 2).
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (latest.current.editable) type('\t');
      }
    };

    const onSelectionChange = (): void => {
      if (composing !== undefined) return;
      const live = readSelection(element);
      if (live !== undefined && !sameSelection(live, store.get().selection)) store.select(live);
    };

    const onCompositionStart = (): void => {
      composing = { selection: current().edited.selection };
    };
    const onCompositionEnd = (event: CompositionEvent): void => {
      const began = composing;
      composing = undefined;
      if (began === undefined) return;
      const { model } = store.get();
      // WHAT THE INPUT METHOD LEFT IN THE DOM is drawn again from the model: the paragraphs it may have touched.
      const { from, to } = ordered(began.selection);
      for (let index = from.paragraph; index <= to.paragraph; index += 1) {
        const paragraph = model.paragraphs[index];
        if (paragraph !== undefined) built.delete(paragraph);
      }
      if (event.data !== '' && latest.current.editable) type(event.data, began.selection);
      else paint();
    };

    const onCopy = (event: ClipboardEvent): void => {
      const { edited } = current();
      if (isCollapsed(edited.selection)) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', selectedText(edited.model, edited.selection));
    };
    const onCut = (event: ClipboardEvent): void => {
      onCopy(event);
      const { edited } = current();
      if (!isCollapsed(edited.selection) && latest.current.editable) remove(edited.selection, 1);
    };

    const unsubscribe = store.subscribe(paint);
    repaint.current = paint;
    paint();
    element.addEventListener('beforeinput', onBeforeInput);
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('compositionstart', onCompositionStart);
    element.addEventListener('compositionend', onCompositionEnd);
    // AS THE FOCUS LEAVES THE WORDS, too: `selectionchange` is a queued task that reads the selection when it RUNS, so
    // words chosen and a field focused within one task are read after the selection became the field's (measured in
    // Chromium 151, `textAdd.pw.ts`' spacing case). `focusout` runs inside the focus move, while it is still the words'.
    element.addEventListener('focusout', onSelectionChange);
    // AND AS IT COMES BACK, the model's selection is put back: focus given by script (a panel's field handing it back)
    // lets the browser put its own caret, and the next `selectionchange` would collapse the words the person chose. NOT
    // for focus a press gives: Chromium 151 places the press's caret before the focus arrives (`textFirstClick.pw.ts`),
    // and putting the model's back then undid the press.
    let pressing = false;
    const onPress = (): void => {
      pressing = true;
    };
    const onRelease = (): void => {
      pressing = false;
    };
    const onFocus = (): void => {
      if (!pressing) writeSelection(element, store.get().selection);
    };
    element.addEventListener('pointerdown', onPress, true);
    owner.addEventListener('pointerup', onRelease, true);
    owner.addEventListener('pointercancel', onRelease, true);
    element.addEventListener('focus', onFocus);
    element.addEventListener('copy', onCopy);
    element.addEventListener('cut', onCut);
    owner.addEventListener('selectionchange', onSelectionChange);
    return () => {
      unsubscribe();
      repaint.current = undefined;
      element.removeEventListener('beforeinput', onBeforeInput);
      element.removeEventListener('keydown', onKeyDown);
      element.removeEventListener('compositionstart', onCompositionStart);
      element.removeEventListener('compositionend', onCompositionEnd);
      element.removeEventListener('focusout', onSelectionChange);
      element.removeEventListener('focus', onFocus);
      element.removeEventListener('pointerdown', onPress, true);
      owner.removeEventListener('pointerup', onRelease, true);
      owner.removeEventListener('pointercancel', onRelease, true);
      element.removeEventListener('copy', onCopy);
      element.removeEventListener('cut', onCut);
      owner.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [root, store]);

  // A NEW LOOK (a zoom) OR DRAWING draws the paragraphs again; the store is unchanged, so the drawing is asked for itself.
  useLayoutEffect(() => {
    repaint.current?.();
  }, [look, drawn]);

  useEffect(() => {
    if (!editable) return;
    const element = root.current;
    if (element !== null && element.ownerDocument.activeElement === element) writeSelection(element, store.get().selection);
  }, [editable, root, store]);

  return (
    <div
      aria-label={label}
      aria-multiline="true"
      aria-readonly={!editable}
      className={className}
      contentEditable
      data-kit-surface=""
      ref={root}
      role="textbox"
      spellCheck
      style={style}
      suppressContentEditableWarning
      tabIndex={0}
    />
  );
}

/** The caret at the end of the model's last paragraph: where a key, rather than a press, opens an editor. */
export function caretAtEnd(model: Model): Selection {
  return caret(wholeBlock(model).focus);
}
