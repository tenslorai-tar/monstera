import { PARAGRAPH_ATTRIBUTE } from './dom.js';
import type { Paragraph, Rgb, RunStyle } from './model.js';

/**
 * How the kit draws its model ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)
 * section 5's layout and paint): a paragraph an element, a run a span, every value from the model at the zoom on screen.
 * The caller says only what the kit cannot know — what CSS face draws a style, and the line pitch the words are set at.
 *
 * ## A paragraph nobody changed is laid out and NOT DRAWN
 *
 * A caller that opens words already drawn somewhere (the page, for Edit text) can say where their lines broke. Such a
 * paragraph is laid out at those breaks and nowhere else, and painted transparent, so the caret, the selection and the
 * keys work over the page's own drawing of the words and no second drawing of them is shown: the browser setting text and
 * a page drawn on a canvas rasterise one glyph differently, measured at 1,451 to 3,403 pixels a block in the editor this
 * replaces (`editorFidelity.pw.ts`, 2026-10-24). A paragraph is drawn the moment it changes.
 */

/** What a surface is told about drawing, beyond the model. */
export interface Look {
  /** CSS pixels per point. */
  readonly zoom: number;
  /** Points between the baselines of a paragraph's lines, or `undefined` for the face's own spacing. */
  readonly pitch: number | undefined;
  /** The CSS `font-family` a style is drawn in. */
  readonly faceCss: (style: RunStyle) => string;
}

export const PARAGRAPH_CLASS = 'm-kit__paragraph';
/** A paragraph still as the words were drawn before the editor opened: laid out at their breaks, not painted. */
export const AS_DRAWN_CLASS = 'm-kit__paragraph--as-drawn';
export const RUN_CLASS = 'm-kit__run';

const rgb = (colour: Rgb): string => `rgb(${String(colour.r)}, ${String(colour.g)}, ${String(colour.b)})`;

/** How small a raised or lowered run is drawn against its size, as the writer sets it. */
const RISEN_SIZE = 0.65;

/** Sets a run's span from its style: the one place a run's inline style is made. */
export function paintRun(span: HTMLElement, style: RunStyle, look: Look): void {
  const risen = style.rise !== 'none';
  span.className = RUN_CLASS;
  span.style.fontFamily = look.faceCss(style);
  span.style.fontSize = `${String((risen ? style.size * RISEN_SIZE : style.size) * look.zoom)}px`;
  span.style.fontWeight = style.bold ? '700' : '400';
  span.style.fontStyle = style.italic ? 'italic' : 'normal';
  span.style.color = rgb(style.colour);
  span.style.textDecoration = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  span.style.backgroundColor = style.highlight === null ? '' : rgb(style.highlight);
  // THE WIRE'S FRACTION OF THE SIZE IS CSS'S `em`, so what is drawn while typing is spaced as the writer spaces it.
  span.style.letterSpacing = style.spacing === 0 ? '' : `${String(style.spacing)}em`;
  // THE RUN'S OWN SPACING, which a fit to the page's width (`fitDrawnLines`) adds to rather than replaces.
  span.dataset['kitSpacing'] = span.style.letterSpacing;
  // RAISED AS CHOSEN, else at the page's own lift; with no height of its own, so a raised run does not heighten its line.
  span.style.verticalAlign = style.rise === 'superscript' ? 'super' : style.rise === 'subscript' ? 'sub' : style.lift === 0 ? '' : `${String(style.lift * look.zoom)}px`;
  span.style.lineHeight = risen || style.lift !== 0 ? '0' : '';
  span.dataset['face'] = style.face;
}

/** A word of a line as the page draws it: its letters `from` to `to` in the paragraph's words, and its left and right in points. */
export interface DrawnWordPlace {
  readonly from: number;
  readonly to: number;
  readonly x0: number;
  readonly x1: number;
}

/**
 * A paragraph's element: its runs, and where `wraps` is given its lines broken at those offsets and the paragraph not
 * painted. `index` is its place in the model, which the selection mapping reads. `cuts` are offsets where a span ends
 * without a break, so each word the page places has spans of its own to fit (`fitDrawnLines`).
 */
export function paragraphElement(
  owner: Document,
  paragraph: Paragraph,
  index: number,
  look: Look,
  wraps: readonly number[] | undefined,
  cuts: readonly number[] = [],
): HTMLElement {
  const element = owner.createElement('div');
  element.className = wraps === undefined ? PARAGRAPH_CLASS : `${PARAGRAPH_CLASS} ${AS_DRAWN_CLASS}`;
  element.setAttribute(PARAGRAPH_ATTRIBUTE, String(index));
  paintParagraph(element, paragraph, look);
  const breaks = new Set(wraps ?? []);
  const ends = [...new Set([...breaks, ...cuts])].sort((a, b) => a - b);
  let at = 0;
  for (const [place, run] of paragraph.runs.entries()) {
    let text = run.text;
    let cutAny = false;
    const span = (part: string): HTMLElement => {
      const made = owner.createElement('span');
      made.textContent = part;
      // WHICH RUN THE SPAN DRAWS, so a new look restyles it in place (`restyleParagraph`).
      made.dataset['kitRun'] = String(place);
      paintRun(made, run.style, look);
      return made;
    };
    // A RUN CROSSING ONE OF THE PAGE'S BREAKS is two spans with the break between them, and one crossing a cut two spans.
    while (ends.length > 0 && (ends[0] ?? 0) <= at + text.length) {
      const end = ends.shift() ?? 0;
      if (end <= at) continue;
      const cut = end - at;
      element.append(span(text.slice(0, cut)));
      if (breaks.has(end)) element.append(wrapBreak(owner));
      at += cut;
      text = text.slice(cut);
      cutAny = true;
    }
    if (cutAny && text === '') continue;
    element.append(span(text));
    at += text.length;
  }
  // A PARAGRAPH WITH NO WORDS KEEPS A LINE: an empty span lays out no line box, and a browser then has nowhere in it to
  // put a caret. The break is the one a browser gives an emptied line itself, and holds no character.
  if (at === 0) element.append(owner.createElement('br'));
  return element;
}

/** Sets a paragraph's element from its settings at the look: the one place a paragraph's inline style is made. */
function paintParagraph(element: HTMLElement, paragraph: Paragraph, look: Look): void {
  element.style.textAlign = paragraph.align;
  element.style.paddingLeft = paragraph.leftIndent === 0 ? '' : `${String(paragraph.leftIndent * look.zoom)}px`;
  element.style.textIndent = paragraph.firstIndent === 0 ? '' : `${String(paragraph.firstIndent * look.zoom)}px`;
  element.style.marginTop = paragraph.spaceBefore === 0 ? '' : `${String(paragraph.spaceBefore * look.zoom)}px`;
  element.style.marginBottom = paragraph.spaceAfter === 0 ? '' : `${String(paragraph.spaceAfter * look.zoom)}px`;
  element.style.lineHeight = look.pitch === undefined ? String(1.2 * paragraph.lineSpacing) : `${String(look.pitch * paragraph.lineSpacing * look.zoom)}px`;
  // THE PARAGRAPH'S OWN FACE AND SIZE, its first run's: every line box holds a strut in the paragraph's font, and a strut
  // in the interface's font, whose ascent is not the run's, set the second line of a block 4 px below the page's at 200 %
  // (Chromium 151, `textEditorGeometry.pw.ts`, measured 2026-10-26).
  const first = paragraph.runs[0]?.style;
  element.style.fontFamily = first === undefined ? '' : look.faceCss(first);
  element.style.fontSize = first === undefined ? '' : `${String(first.size * look.zoom)}px`;
}

/**
 * A paragraph's element drawn at a new look — the faces arrived, the zoom moved — WITHOUT replacing a node. The words and
 * their breaks are the same, so only the inline styles change; replacing the elements instead detached the very node a
 * press in flight had been aimed at, and the press was then judged to be outside the editor and finished it (measured
 * 2026-10-26 in Chromium 151: a double press on a block landing as its fonts loaded closed the editor it had opened).
 */
export function restyleParagraph(element: HTMLElement, paragraph: Paragraph, look: Look): void {
  paintParagraph(element, paragraph, look);
  for (const span of element.querySelectorAll<HTMLElement>('span[data-kit-run]')) {
    const run = paragraph.runs[Number(span.dataset['kitRun'])];
    if (run !== undefined) paintRun(span, run.style, look);
  }
}

/**
 * Fits each line of a paragraph laid out as the page drew it to the width the page draws that line at, by its letter
 * spacing: the caret and the selection land on the page's letters only where the editor's own letters lie under them.
 *
 * ## Why the width has to be imposed rather than trusted
 *
 * The letters are laid out in the CSS face a style is drawn in, and that face is the page's own only where the page's font
 * could be given to the browser. A font the page draws from shapes of its own (Type 3, as a web browser prints) has no
 * such face, so a stand-in lays its letters out at other widths: wider, and the line ran past the visible one, so a press
 * at the visible end landed a word or two short and the last words lay outside the editor; narrower, and the line ended
 * early. Spreading the difference over the line's letters puts its two ends where the page's are, for every font kind,
 * and costs nothing where the face is the page's own, whose difference is nothing.
 *
 * `widths` is the paragraph's lines' drawn widths in points, in order; a line with no width given is left as laid out.
 * Measured from the first letter to the last that is not a space, since a soft wrap's space is not drawn on the page.
 *
 * ## Word by word where the page says where its words are
 *
 * Spread over a line, the difference puts its ENDS right and nothing between them: a stand-in whose letters are narrow
 * where the page's are wide and wide where they are narrow leaves the middle of the line a word or more out, and the word
 * a person highlights is not the word the edit then formats (the owner's video of 1.1.2609.0, a drawn font: the first
 * word highlighted the second and third). So where `words` gives a line's words as drawn, each word is fitted to its own
 * width and moved to its own place from the line's first, and the letters a person presses lie under the page's.
 */
export function fitDrawnLines(element: HTMLElement, widths: readonly number[], zoom: number, words: readonly (readonly DrawnWordPlace[])[] = []): void {
  const owner = element.ownerDocument;
  const lines: HTMLElement[][] = [[]];
  /** Where each span's letters begin in the paragraph's words. */
  const starts = new Map<HTMLElement, number>();
  let offset = 0;
  for (const child of Array.from(element.children)) {
    if (child instanceof HTMLElement && child.dataset['kitWrap'] !== undefined) lines.push([]);
    else if (child instanceof HTMLElement && child.dataset['kitRun'] !== undefined) {
      lines.at(-1)?.push(child);
      starts.set(child, offset);
      offset += child.textContent.length;
    }
  }
  for (const [at, spans] of lines.entries()) {
    const placed = words[at] ?? [];
    for (const span of spans) span.style.marginLeft = '';
    if (placed.length > 0 && fitWords(spans, starts, placed, zoom)) continue;
    for (const span of spans) span.style.marginLeft = '';
    const target = widths[at];
    if (target === undefined || spans.length === 0) continue;
    for (const span of spans) span.style.letterSpacing = span.dataset['kitSpacing'] ?? '';
    const texts = spans.map((span) => span.firstChild).filter((node): node is Text => node instanceof Text && node.data !== '');
    const first = texts[0];
    // THE LAST LETTER THAT IS NOT A SPACE, and its text node.
    let last: { readonly node: Text; readonly end: number } | undefined;
    for (const node of [...texts].reverse()) {
      const end = node.data.trimEnd().length;
      if (end > 0) {
        last = { node, end };
        break;
      }
    }
    if (first === undefined || last === undefined) continue;
    const range = owner.createRange();
    range.setStart(first, 0);
    range.setEnd(last.node, last.end);
    const natural = range.getBoundingClientRect().width;
    // NO LAYOUT, NOTHING TO FIT: a document with no layout engine measures every range as nothing.
    if (!(natural > 0)) continue;
    const letters = range.toString().length;
    const extra = (target * zoom - natural) / letters;
    for (const span of spans) {
      const own = span.dataset['kitSpacing'] ?? '';
      span.style.letterSpacing = own === '' ? `${String(extra)}px` : `calc(${own} + ${String(extra)}px)`;
    }
  }
}

/**
 * {@link fitDrawnLines} for one line whose words the page places: each word's letters spaced to its drawn width, then
 * each word after the first moved by its left margin to stand as far from the first as the page draws it. False where a
 * word has no spans of its own (the words were cut elsewhere than these), and the line is then fitted whole.
 */
function fitWords(spans: readonly HTMLElement[], starts: ReadonlyMap<HTMLElement, number>, placed: readonly DrawnWordPlace[], zoom: number): boolean {
  const owner = spans[0]?.ownerDocument;
  if (owner === undefined) return false;
  const groups = placed.map((word) => ({
    word,
    spans: spans.filter((span) => {
      const from = starts.get(span) ?? -1;
      return from >= word.from && from + span.textContent.length <= word.to && span.textContent.length > 0;
    }),
  }));
  if (groups.some(({ word, spans: own }) => own.reduce((sum, span) => sum + span.textContent.length, 0) !== word.to - word.from)) return false;
  const rangeOf = (own: readonly HTMLElement[]): Range | undefined => {
    const first = own[0]?.firstChild;
    const last = own.at(-1)?.firstChild;
    if (!(first instanceof Text) || !(last instanceof Text)) return undefined;
    const range = owner.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.data.length);
    return range;
  };
  for (const span of spans) span.style.letterSpacing = span.dataset['kitSpacing'] ?? '';
  // EACH WORD AS WIDE AS THE PAGE DRAWS IT.
  for (const { word, spans: own } of groups) {
    const natural = rangeOf(own)?.getBoundingClientRect().width ?? 0;
    // NO LAYOUT, NOTHING TO FIT: a document with no layout engine measures every range as nothing.
    if (!(natural > 0)) return false;
    const extra = ((word.x1 - word.x0) * zoom - natural) / (word.to - word.from);
    for (const span of own) {
      const mine = span.dataset['kitSpacing'] ?? '';
      span.style.letterSpacing = mine === '' ? `${String(extra)}px` : `calc(${mine} + ${String(extra)}px)`;
    }
  }
  // EACH WORD WHERE THE PAGE DRAWS IT FROM THE LINE'S FIRST, in order, since a margin moves every word after it.
  const first = groups[0];
  const origin = first === undefined ? undefined : rangeOf(first.spans)?.getBoundingClientRect().left;
  if (first === undefined || origin === undefined) return false;
  for (const { word, spans: own } of groups.slice(1)) {
    const lead = own[0];
    const left = rangeOf(own)?.getBoundingClientRect().left;
    if (lead === undefined || left === undefined) return false;
    lead.style.marginLeft = `${String(origin + (word.x0 - first.word.x0) * zoom - left)}px`;
  }
  return true;
}

function wrapBreak(owner: Document): HTMLElement {
  const wrap = owner.createElement('br');
  wrap.dataset['kitWrap'] = '';
  return wrap;
}
