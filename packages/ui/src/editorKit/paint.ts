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

/**
 * A paragraph's element: its runs, and where `wraps` is given its lines broken at those offsets and the paragraph not
 * painted. `index` is its place in the model, which the selection mapping reads.
 */
export function paragraphElement(owner: Document, paragraph: Paragraph, index: number, look: Look, wraps: readonly number[] | undefined): HTMLElement {
  const element = owner.createElement('div');
  element.className = wraps === undefined ? PARAGRAPH_CLASS : `${PARAGRAPH_CLASS} ${AS_DRAWN_CLASS}`;
  element.setAttribute(PARAGRAPH_ATTRIBUTE, String(index));
  paintParagraph(element, paragraph, look);
  const breaks = [...(wraps ?? [])];
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
    // A RUN CROSSING ONE OF THE PAGE'S BREAKS is two spans with the break between them.
    while (breaks.length > 0 && (breaks[0] ?? 0) <= at + text.length && (breaks[0] ?? 0) > at) {
      const cut = (breaks.shift() ?? 0) - at;
      element.append(span(text.slice(0, cut)), wrapBreak(owner));
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
 */
export function fitDrawnLines(element: HTMLElement, widths: readonly number[], zoom: number): void {
  const owner = element.ownerDocument;
  const lines: HTMLElement[][] = [[]];
  for (const child of Array.from(element.children)) {
    if (child instanceof HTMLElement && child.dataset['kitWrap'] !== undefined) lines.push([]);
    else if (child instanceof HTMLElement && child.dataset['kitRun'] !== undefined) lines.at(-1)?.push(child);
  }
  for (const [at, spans] of lines.entries()) {
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

function wrapBreak(owner: Document): HTMLElement {
  const wrap = owner.createElement('br');
  wrap.dataset['kitWrap'] = '';
  return wrap;
}
