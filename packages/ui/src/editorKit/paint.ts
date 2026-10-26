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
  element.style.textAlign = paragraph.align;
  element.style.paddingLeft = paragraph.leftIndent === 0 ? '' : `${String(paragraph.leftIndent * look.zoom)}px`;
  element.style.textIndent = paragraph.firstIndent === 0 ? '' : `${String(paragraph.firstIndent * look.zoom)}px`;
  element.style.marginTop = paragraph.spaceBefore === 0 ? '' : `${String(paragraph.spaceBefore * look.zoom)}px`;
  element.style.marginBottom = paragraph.spaceAfter === 0 ? '' : `${String(paragraph.spaceAfter * look.zoom)}px`;
  element.style.lineHeight = look.pitch === undefined ? String(1.2 * paragraph.lineSpacing) : `${String(look.pitch * paragraph.lineSpacing * look.zoom)}px`;
  const breaks = [...(wraps ?? [])];
  let at = 0;
  for (const run of paragraph.runs) {
    let text = run.text;
    let cutAny = false;
    // A RUN CROSSING ONE OF THE PAGE'S BREAKS is two spans with the break between them.
    while (breaks.length > 0 && (breaks[0] ?? 0) <= at + text.length && (breaks[0] ?? 0) > at) {
      const cut = (breaks.shift() ?? 0) - at;
      const span = owner.createElement('span');
      span.textContent = text.slice(0, cut);
      paintRun(span, run.style, look);
      element.append(span, wrapBreak(owner));
      at += cut;
      text = text.slice(cut);
      cutAny = true;
    }
    if (cutAny && text === '') continue;
    const span = owner.createElement('span');
    span.textContent = text;
    paintRun(span, run.style, look);
    element.append(span);
    at += text.length;
  }
  // A PARAGRAPH WITH NO WORDS KEEPS A LINE: an empty span lays out no line box, and a browser then has nowhere in it to
  // put a caret. The break is the one a browser gives an emptied line itself, and holds no character.
  if (at === 0) element.append(owner.createElement('br'));
  return element;
}

function wrapBreak(owner: Document): HTMLElement {
  const wrap = owner.createElement('br');
  wrap.dataset['kitWrap'] = '';
  return wrap;
}
