import type { BlockFormatting, BlockMarkSet } from '@monstera/contract';

/**
 * The in-place editor's formatting, kept in the DOM it is drawn in
 * ([ADR-0180](../../../docs/DECISIONS/0180-formatting-is-marks-over-a-blocks-words-and-a-block-is-moved-resized-and-added-by-its-own-commands.md)).
 *
 * ## One walk, for the words and for the marks
 *
 * A mark names a span of the person's words by offsets into the text that is sent, so the text and the offsets must
 * come from ONE reading of the editor. {@link readEditor} is that reading: the editor's paragraphs (a `div` each, a line
 * break inside one a paragraph too), the text of every text node in order, and each node's effective formatting. A
 * second reading of the words (`innerText`) beside it would be a second opinion about where a paragraph ends, and every
 * offset after the first disagreement would name the wrong word (B3a).
 *
 * ## Formatting is a `data-fmt` on a span, and what is drawn is made from it
 *
 * Formatting a selection splits the text it covers into spans of their own and writes what the person chose into each as
 * `data-fmt`; the inline style is derived from that and is never read back. Nested spans merge inner over outer, so
 * formatting a part of an already formatted span needs no unpicking. The page's own run spans are not touched: what the
 * run IS is the page's, and a mark says what the words become.
 */

/** What a span of words is, where the person chose; a missing key is the run's own. */
export type Fmt = BlockMarkSet;

/** The class of a span the formatting made. */
export const FORMAT_CLASS = 'm-text-editor__fmt';

/** Points a list's hanging indent and one step of indent move a paragraph. */
export const INDENT_STEP = 18;

/** The bullet and the number a list starts its words with (ADR-0180 Decision 3). */
const BULLET = /^•\s/u;
const NUMBER = /^\d+\.\s/u;

/** How a paragraph the person set is carried in its element. */
interface ParagraphSetting {
  align?: 'left' | 'center' | 'right';
  leftIndent?: number;
  firstIndent?: number;
  lineSpacing?: number;
  spaceBefore?: number;
}

const FMT = 'fmt';

function fmtOf(element: Element): Fmt {
  const raw = (element as HTMLElement).dataset[FMT];
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw) as Fmt;
  } catch {
    return {};
  }
}

/** The formatting a text node has: every ancestor's `data-fmt` up to `root`, inner over outer. */
export function effectiveFmt(node: Node, root: HTMLElement): Fmt {
  const chain: Fmt[] = [];
  for (let at: Node | null = node.parentNode; at !== null && at !== root; at = at.parentNode) {
    if (at instanceof HTMLElement && at.dataset[FMT] !== undefined) chain.unshift(fmtOf(at));
  }
  return Object.assign({}, ...chain) as Fmt;
}

/** The page's own style of the run a node is in: weight, slant and size, read from the run's inline style. */
function runBase(node: Node, root: HTMLElement): { bold: boolean; italic: boolean; size: number | undefined } {
  for (let at: Node | null = node.parentNode; at !== null && at !== root; at = at.parentNode) {
    if (at instanceof HTMLElement && at.dataset['size'] !== undefined && at.classList.contains('m-text-editor__run')) {
      return {
        bold: Number(at.style.fontWeight) >= 600,
        italic: at.style.fontStyle === 'italic',
        size: Number(at.dataset['size']),
      };
    }
  }
  return { bold: false, italic: false, size: undefined };
}

/** What words ARE at a point of the editor: the run's own look with the person's formatting over it. */
export interface FormatState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly size?: number;
  readonly colour?: { readonly r: number; readonly g: number; readonly b: number };
  readonly family?: string;
  readonly rise?: 'superscript' | 'subscript';
}

/** What the words at a node ARE now: the run's own, with the person's formatting over it. */
export function stateAt(node: Node, root: HTMLElement): FormatState {
  const base = runBase(node, root);
  const fmt = effectiveFmt(node, root);
  return {
    bold: fmt.bold ?? base.bold,
    italic: fmt.italic ?? base.italic,
    underline: fmt.underline ?? false,
    ...((fmt.size ?? base.size) === undefined ? {} : { size: fmt.size ?? base.size ?? 0 }),
    ...(fmt.colour === undefined ? {} : { colour: fmt.colour }),
    ...(fmt.family === undefined ? {} : { family: fmt.family }),
    ...(fmt.rise === undefined ? {} : { rise: fmt.rise }),
  };
}

/** Draws a formatting span from its `data-fmt`: the one place the inline style is made. */
function paint(span: HTMLElement, root: HTMLElement, zoom: number): void {
  const fmt = fmtOf(span);
  const base = runBase(span, root);
  span.classList.add(FORMAT_CLASS);
  span.style.fontWeight = fmt.bold === undefined ? '' : fmt.bold ? '700' : '400';
  span.style.fontStyle = fmt.italic === undefined ? '' : fmt.italic ? 'italic' : 'normal';
  span.style.textDecoration = fmt.underline === true ? 'underline' : '';
  span.style.color = fmt.colour === undefined ? '' : `rgb(${String(fmt.colour.r)}, ${String(fmt.colour.g)}, ${String(fmt.colour.b)})`;
  span.style.fontFamily = fmt.family ?? '';
  const size = fmt.size ?? (fmt.rise === undefined ? undefined : base.size);
  if (size === undefined) {
    delete span.dataset['size'];
    span.style.fontSize = '';
  } else {
    const shown = fmt.rise === undefined ? size : size * 0.65;
    span.dataset['size'] = String(shown);
    span.style.fontSize = `${String(shown * zoom)}px`;
  }
  span.style.verticalAlign = fmt.rise === 'superscript' ? 'super' : fmt.rise === 'subscript' ? 'sub' : '';
}

/** The text nodes of `root` a range touches, each with the part of it the range covers. */
function covered(root: HTMLElement, range: Range): { node: Text; from: number; to: number }[] {
  const found: { node: Text; from: number; to: number }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue;
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : node.length;
    if (to > from) found.push({ node, from, to });
  }
  return found;
}

/** Splits `node` so the part `[from, to)` is a text node of its own, and answers it. */
function isolate(node: Text, from: number, to: number): Text {
  const middle = from === 0 ? node : node.splitText(from);
  if (to - from < middle.length) middle.splitText(to - from);
  return middle;
}

/**
 * Applies `change` to the words `range` covers: a key set to a value is that formatting, a key set to `null` is the
 * formatting taken off (the run's own again). Answers whether any word was covered.
 */
export function formatRange(root: HTMLElement, range: Range, change: { readonly [K in keyof Fmt]?: Fmt[K] | null }, zoom = 1): boolean {
  const parts = covered(root, range).map(({ node, from, to }) => isolate(node, from, to));
  for (const part of parts) {
    const own = part.parentElement;
    // A SPAN THIS FORMATTING MADE AND THAT HOLDS ONLY THESE WORDS is updated in place; any other is wrapped.
    const span =
      own !== null && own.classList.contains(FORMAT_CLASS) && own.childNodes.length === 1
        ? own
        : (() => {
            const made = root.ownerDocument.createElement('span');
            part.replaceWith(made);
            made.append(part);
            return made;
          })();
    const next = new Map<string, unknown>(Object.entries(fmtOf(span)));
    for (const [key, value] of Object.entries(change)) {
      if (value === null) next.delete(key);
      else if (value !== undefined) next.set(key, value);
    }
    if (next.size === 0) span.removeAttribute('data-fmt');
    else span.dataset[FMT] = JSON.stringify(Object.fromEntries(next));
    paint(span, root, zoom);
  }
  return parts.length > 0;
}

/** Whether every word `range` covers is already what `has` says: a toggle's question, asked before it flips. */
export function allWords(root: HTMLElement, range: Range, has: (state: FormatState) => boolean): boolean {
  const nodes = covered(root, range);
  return nodes.length > 0 && nodes.every(({ node }) => has(stateAt(node, root)));
}

/** One paragraph of the editor: its element, and where its words begin in the text. */
interface Paragraph {
  readonly element: HTMLElement | undefined;
  readonly start: number;
  readonly nodes: Text[];
}

/** The paragraphs of the editor in order: a `div` each, with a line break inside one starting another. */
function paragraphsOf(root: HTMLElement): { text: string; paragraphs: Paragraph[] } {
  let text = '';
  const paragraphs: Paragraph[] = [];
  const units: { element: HTMLElement | undefined; children: Node[] }[] = [];
  const loose: Node[] = [];
  const flush = (): void => {
    if (loose.length > 0) units.push({ element: undefined, children: [...loose] });
    loose.length = 0;
  };
  for (const child of Array.from(root.childNodes)) {
    if (child instanceof HTMLElement && child.tagName === 'DIV') {
      flush();
      units.push({ element: child, children: [child] });
    } else loose.push(child);
  }
  flush();
  for (const [at, unit] of units.entries()) {
    if (at > 0) text += '\n';
    let open: Paragraph = { element: unit.element, start: text.length, nodes: [] };
    paragraphs.push(open);
    for (const child of unit.children) {
      const walker = root.ownerDocument.createTreeWalker(child, 1 | 4);
      const nodes: Node[] = child.nodeType === 3 ? [child] : [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node);
      for (const [index, node] of nodes.entries()) {
        if (node instanceof Text) {
          text += node.data;
          open.nodes.push(node);
        } else if (node instanceof HTMLElement && node.tagName === 'BR') {
          // A BREAK THAT ENDS ITS PARAGRAPH is the placeholder an empty line keeps; any other starts another.
          const last = nodes.slice(index + 1).every((later) => !(later instanceof Text) || later.data === '');
          if (!last) {
            text += '\n';
            open = { element: undefined, start: text.length, nodes: [] };
            paragraphs.push(open);
          }
        }
      }
    }
  }
  return { text, paragraphs };
}

/** What the editor says: the words, the marks over them, and how the paragraphs the person set are set. */
export function readEditor(root: HTMLElement): { text: string; formatting: BlockFormatting } {
  const { text, paragraphs } = paragraphsOf(root);
  const marks: { from: number; to: number; set: BlockMarkSet }[] = [];
  for (const paragraph of paragraphs) {
    let at = paragraph.start;
    for (const node of paragraph.nodes) {
      const set = effectiveFmt(node, root);
      const length = node.data.length;
      if (Object.keys(set).length > 0 && length > 0) {
        const last = marks.at(-1);
        // ADJACENT WORDS UNDER ONE FORMATTING ARE ONE MARK, so a word split into nodes by typing is not sent as many.
        if (last?.to === at && JSON.stringify(last.set) === JSON.stringify(set)) last.to = at + length;
        else marks.push({ from: at, to: at + length, set });
      }
      at += length;
    }
  }
  const settings: ({ paragraph: number } & ParagraphSetting)[] = [];
  for (const [place, paragraph] of paragraphs.entries()) {
    const element = paragraph.element;
    if (element === undefined) continue;
    const setting = settingOf(element);
    if (Object.keys(setting).length > 0) settings.push({ paragraph: place, ...setting });
  }
  return {
    text,
    formatting: { ...(marks.length === 0 ? {} : { marks }), ...(settings.length === 0 ? {} : { paragraphs: settings }) },
  };
}

function settingOf(element: HTMLElement): ParagraphSetting {
  const { align, left, first, spacing, before } = element.dataset;
  return {
    ...(align === 'left' || align === 'center' || align === 'right' ? { align } : {}),
    ...(left === undefined ? {} : { leftIndent: Number(left) }),
    ...(first === undefined ? {} : { firstIndent: Number(first) }),
    ...(spacing === undefined ? {} : { lineSpacing: Number(spacing) }),
    ...(before === undefined ? {} : { spaceBefore: Number(before) }),
  };
}

/** The paragraph elements a range touches, in order. */
function paragraphElementsIn(root: HTMLElement, range: Range): HTMLElement[] {
  return Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === 'DIV' && range.intersectsNode(child),
  );
}

/** Draws a paragraph's settings from its `data-*`: the one place its inline style is made. */
function paintParagraph(element: HTMLElement, zoom: number): void {
  const { align, left, first, spacing, before } = element.dataset;
  element.style.textAlign = align ?? '';
  const leftIndent = left === undefined ? undefined : Number(left);
  const firstIndent = first === undefined ? undefined : Number(first);
  element.style.paddingLeft = leftIndent === undefined ? '' : `${String(leftIndent * zoom)}px`;
  element.style.textIndent = firstIndent === undefined ? '' : `${String(firstIndent * zoom)}px`;
  element.style.lineHeight = spacing === undefined ? '' : String(Number(spacing) * 1.2);
  element.style.marginTop = before === undefined ? '' : `${String(Number(before) * zoom)}px`;
}

/** Sets how the paragraphs `range` touches are set: a key set to `null` takes the person's setting off. */
export function setParagraphs(
  root: HTMLElement,
  range: Range,
  change: { readonly [K in keyof ParagraphSetting]?: ParagraphSetting[K] | null },
  zoom = 1,
): number {
  const elements = paragraphElementsIn(root, range);
  const keys: Record<keyof ParagraphSetting, string> = {
    align: 'align',
    leftIndent: 'left',
    firstIndent: 'first',
    lineSpacing: 'spacing',
    spaceBefore: 'before',
  };
  for (const element of elements) {
    for (const [key, value] of Object.entries(change) as [keyof ParagraphSetting, string | number | null | undefined][]) {
      const name = `data-${keys[key]}`;
      if (value === null || value === undefined) element.removeAttribute(name);
      else element.setAttribute(name, String(value));
    }
    paintParagraph(element, zoom);
  }
  return elements.length;
}

/** Steps the left indent of the paragraphs `range` touches by `steps` of {@link INDENT_STEP}, never below none. */
export function indentParagraphs(root: HTMLElement, range: Range, steps: number, zoom = 1): number {
  const elements = paragraphElementsIn(root, range);
  for (const element of elements) {
    const next = Math.max(0, Number(element.dataset['left'] ?? 0) + steps * INDENT_STEP);
    if (next === 0) delete element.dataset['left'];
    else element.dataset['left'] = String(next);
    paintParagraph(element, zoom);
  }
  return elements.length;
}

/**
 * Makes the paragraphs `range` touches a list of `kind`, or takes them out of one when every one already is: the words
 * start with a bullet or a number and the paragraph hangs by one step (ADR-0180 Decision 3). Answers the paragraphs
 * changed.
 */
export function toggleList(root: HTMLElement, range: Range, kind: 'bullet' | 'number', zoom = 1): number {
  const elements = paragraphElementsIn(root, range);
  const marker = kind === 'bullet' ? BULLET : NUMBER;
  const first = (element: HTMLElement): Text | undefined => {
    const walker = root.ownerDocument.createTreeWalker(element, 4);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node instanceof Text && node.data !== '') return node;
    }
    return undefined;
  };
  const listed = elements.every((element) => marker.test(first(element)?.data ?? ''));
  for (const [at, element] of elements.entries()) {
    const node = first(element);
    if (listed) {
      if (node !== undefined) node.data = node.data.replace(marker, '');
      delete element.dataset['left'];
      delete element.dataset['first'];
    } else {
      // ANOTHER KIND OF LIST IS REPLACED, not stacked on: its marker comes off first.
      const bare = (node?.data ?? '').replace(BULLET, '').replace(NUMBER, '');
      const prefix = kind === 'bullet' ? '• ' : `${String(at + 1)}. `;
      if (node === undefined) element.prepend(root.ownerDocument.createTextNode(prefix));
      else node.data = prefix + bare;
      element.dataset['left'] = String(INDENT_STEP);
      element.dataset['first'] = String(-INDENT_STEP);
    }
    paintParagraph(element, zoom);
  }
  return elements.length;
}

/** Points between tab stops, from the editor's left edge (ADR-0180 Decision 8): the half inch word processors use. */
export const TAB_STOP = 36;

/** Inserts `text` where the caret is, replacing a selection, and tells the editor it changed as typing does. */
function insertAtCaret(root: HTMLElement, text: string): void {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const node = root.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  root.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * A Tab: spaces to the next tab stop, measured from where the caret is, because a page's text has no tab character to
 * set and a run of spaces is what a tab becomes on paper (ADR-0180 Decision 8). Where the caret has no measurable place
 * (no layout), four spaces.
 */
export function insertTab(root: HTMLElement, zoom: number): void {
  const selection = root.ownerDocument.getSelection();
  if (selection === null || selection.rangeCount === 0) return;
  const stop = TAB_STOP * zoom;
  const caretX = (): number | undefined => {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && rect.left === 0) return undefined;
    return rect.left - root.getBoundingClientRect().left;
  };
  const at = caretX();
  if (at === undefined) {
    insertAtCaret(root, '    ');
    return;
  }
  const target = (Math.floor(at / stop) + 1) * stop;
  for (let spaces = 0; spaces < 24 && (caretX() ?? target) < target - 0.5; spaces += 1) insertAtCaret(root, ' ');
}

/**
 * Whether the editor holds anything BEYOND ITS WORDS: marks, paragraph settings, or a place the block was put. The one
 * answer to what makes a commit with unchanged words still a write, so the editor's commit and the command's agree.
 */
export function isFormatted(formatting: BlockFormatting): boolean {
  return (formatting.marks?.length ?? 0) > 0 || (formatting.paragraphs?.length ?? 0) > 0 || formatting.place !== undefined;
}
