import type { Position, Selection } from './model.js';

/**
 * Where the kit's model and the browser's selection meet: a position in the model is a paragraph and an offset into its
 * words, and the browser's is a node and an offset into it. Each paragraph is an element of the surface marked
 * {@link PARAGRAPH_ATTRIBUTE}, holding a span per run and, where a line breaks as the page broke it, a `br` that is no
 * character — so the offset of a point is the length of the paragraph's TEXT before it, which a range's `toString`
 * counts in UTF-16 units exactly as the model does, and nothing else in the paragraph is counted.
 */

/** The attribute every paragraph element of a surface carries, its place in the model. */
export const PARAGRAPH_ATTRIBUTE = 'data-kit-paragraph';

/** The paragraph element holding `node`, inside `root`, or `undefined` where it is in none. */
function paragraphElementOf(root: HTMLElement, node: Node): HTMLElement | undefined {
  for (let at: Node | null = node; at !== null && at !== root; at = at.parentNode) {
    if (at instanceof HTMLElement && at.hasAttribute(PARAGRAPH_ATTRIBUTE)) return at;
  }
  return undefined;
}

/** The paragraph elements of a surface, in order. */
function paragraphElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`:scope > [${PARAGRAPH_ATTRIBUTE}]`));
}

/**
 * The model position of a browser point, or `undefined` where the point is outside every paragraph of `root`. A point
 * on the surface itself, between paragraphs (where a browser may put a caret moved past the last line), is the end of
 * the paragraph before it or the start of the one after.
 */
export function positionOf(root: HTMLElement, node: Node, offset: number): Position | undefined {
  const paragraphs = paragraphElements(root);
  if (node === root) {
    const before = paragraphs[offset - 1];
    if (before !== undefined) return { paragraph: offset - 1, offset: textLength(before) };
    return paragraphs.length === 0 ? undefined : { paragraph: 0, offset: 0 };
  }
  const element = paragraphElementOf(root, node);
  if (element === undefined) return undefined;
  const range = root.ownerDocument.createRange();
  range.setStart(element, 0);
  range.setEnd(node, offset);
  return { paragraph: paragraphs.indexOf(element), offset: range.toString().length };
}

function textLength(element: HTMLElement): number {
  return element.textContent.length;
}

/**
 * The browser point of a model position: inside the text node that holds the letter before it, so a caret at the end of
 * a bold word stands in the bold run as the model types there (`styleAt`); at a paragraph's start, before its first
 * letter; in an empty paragraph, the paragraph itself, before the `br` that keeps its line.
 */
export function pointOf(root: HTMLElement, position: Position): { readonly node: Node; readonly offset: number } | undefined {
  const element = paragraphElements(root)[position.paragraph];
  if (element === undefined) return undefined;
  const walker = root.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let at = 0;
  let first: Text | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.length === 0) continue;
    first ??= text;
    const end = at + text.data.length;
    if (position.offset > at && position.offset <= end) return { node: text, offset: position.offset - at };
    at = end;
  }
  if (first !== undefined) return { node: first, offset: 0 };
  return { node: element, offset: 0 };
}

/** The browser's selection inside `root` as a model selection, or `undefined` where it is not inside `root`. */
export function readSelection(root: HTMLElement): Selection | undefined {
  const selection = root.ownerDocument.getSelection();
  if (selection?.anchorNode == null || selection.focusNode === null) return undefined;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return undefined;
  const anchor = positionOf(root, selection.anchorNode, selection.anchorOffset);
  const focus = positionOf(root, selection.focusNode, selection.focusOffset);
  return anchor === undefined || focus === undefined ? undefined : { anchor, focus };
}

/** A static range the browser named (an input's target) as a model selection, or `undefined` outside `root`. */
export function selectionOfRange(root: HTMLElement, range: StaticRange): Selection | undefined {
  const anchor = positionOf(root, range.startContainer, range.startOffset);
  const focus = positionOf(root, range.endContainer, range.endOffset);
  return anchor === undefined || focus === undefined ? undefined : { anchor, focus };
}

/** Puts the browser's selection where the model's is, unless it is already there. */
export function writeSelection(root: HTMLElement, wanted: Selection): void {
  const now = readSelection(root);
  if (
    now?.anchor.paragraph === wanted.anchor.paragraph &&
    now.anchor.offset === wanted.anchor.offset &&
    now.focus.paragraph === wanted.focus.paragraph &&
    now.focus.offset === wanted.focus.offset
  ) {
    return;
  }
  const anchor = pointOf(root, wanted.anchor);
  const focus = pointOf(root, wanted.focus);
  const selection = root.ownerDocument.getSelection();
  if (anchor === undefined || focus === undefined || selection === null) return;
  selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}
