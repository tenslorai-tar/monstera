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
  /** The colour a style is drawn in: its own, or the words' a person sees where it paints nothing itself (ADR-0289). */
  readonly inkOf: (style: RunStyle) => Rgb;
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
  span.style.color = rgb(look.inkOf(style));
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
 *
 * ## Letter by letter where the read places its letters
 *
 * A word fitted whole keeps the stand-in's letter widths inside it, so a caret between two of its letters stood a fraction
 * of a letter off the page's (item 2). The places a caller gives are the read's LETTERS where it has them (`blockModel.ts`'
 * `drawnPlaces`), each fitted the same way, and its words where it has not.
 */
/**
 * WHERE A RANGE STANDS ALONG ITS LINE, in the paragraph's own CSS pixels: its start and its length along the line's
 * direction, whatever the box is turned through.
 *
 * A screen rectangle is measured along the screen's axes, and on a turned page the editor is drawn through a rotation
 * (`editing.ts`' `boxStyle`), so its width was the letters' HEIGHT: a page turned a quarter fitted each untouched line to
 * the wrong length, and its caret stood up to 11 pt off the page's letters (Chromium 151, `editTextCaret.pw.ts`,
 * 2026-11-02). The line's direction on screen is the composed transforms' image of the paragraph's own x axis. A box
 * turned other than by quarters is measured by its upright bounds, as before: such text carries no letter places.
 */
interface Along {
  readonly start: (rect: DOMRect) => number;
  readonly length: (rect: DOMRect) => number;
}

function alongLine(element: HTMLElement): Along {
  let a = 1;
  let b = 0;
  const view = element.ownerDocument.defaultView;
  if (view !== null && typeof view.DOMMatrixReadOnly === 'function') {
    let c = 0;
    let d = 1;
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const transform = view.getComputedStyle(at).transform;
      if (transform === '' || transform === 'none') continue;
      const m = new view.DOMMatrixReadOnly(transform);
      [a, b, c, d] = [m.a * a + m.c * b, m.b * a + m.d * b, m.a * c + m.c * d, m.b * c + m.d * d];
    }
  }
  const scale = Math.hypot(a, b) || 1;
  const x = a / scale;
  const y = b / scale;
  if (Math.abs(y) > 0.99) {
    return y > 0
      ? { start: (rect) => rect.top / scale, length: (rect) => rect.height / scale }
      : { start: (rect) => -rect.bottom / scale, length: (rect) => rect.height / scale };
  }
  if (x < -0.99) return { start: (rect) => -rect.right / scale, length: (rect) => rect.width / scale };
  return { start: (rect) => rect.left / scale, length: (rect) => rect.width / scale };
}

/** One paragraph of the editor to fit: its element, each line's drawn width, and each line's word places. */
export interface DrawnRow {
  readonly element: HTMLElement;
  readonly widths: readonly number[];
  readonly words: readonly (readonly DrawnWordPlace[])[];
}

/** {@link fitDrawnRows} for one paragraph. */
export function fitDrawnLines(element: HTMLElement, widths: readonly number[], zoom: number, words: readonly (readonly DrawnWordPlace[])[] = []): void {
  fitDrawnRows([{ element, widths, words }], zoom);
}

/** A line's words as the page places them, each with its own spans, and the spaces between them that are fitted. */
interface WordPlan {
  readonly groups: readonly { readonly word: DrawnWordPlace; readonly spans: readonly HTMLElement[] }[];
  readonly gaps: readonly { readonly spans: readonly HTMLElement[]; readonly width: number; readonly letters: number }[];
}

interface LineFit {
  readonly spans: readonly HTMLElement[];
  readonly target: number | undefined;
  readonly along: Along;
  /** Fitted by its words, where every place has spans of its own; else the line is fitted whole. */
  readonly plan: WordPlan | undefined;
}

/**
 * Each line of `rows` as wide as the page draws it: where the page places its words, each word's letters spaced to its
 * drawn width and each word after the first moved by its left margin to stand where the page draws it; else the line's
 * letters spaced to its drawn width.
 *
 * TWO LAYOUTS FOR THE WHOLE BLOCK, never two a line: every reset is written, then every width read, then every spacing
 * written, then every word's left read, then every margin written. One line read after another's writes laid the editor
 * out again for it, twice a line: a dense block's open spent about 470 ms in `getBoundingClientRect`, and about 220 ms
 * batched (`editOpenCost.mjs --profile`, document 2, round 2, 2026-11-14). Batching gives the same answer: the paragraph
 * is `white-space: pre` and its lines are parted by forced breaks, so one line's spacing moves no other line's letters
 * along it, and a line's lefts are measured from its own first word.
 */
export function fitDrawnRows(rows: readonly DrawnRow[], zoom: number): void {
  const lines: LineFit[] = [];
  for (const { element, widths, words } of rows) {
    // READ BEFORE ANY WRITE: the transforms, from computed style.
    const along = alongLine(element);
    const parted: HTMLElement[][] = [[]];
    /** Where each span's letters begin in the paragraph's words. */
    const starts = new Map<HTMLElement, number>();
    let offset = 0;
    for (const child of Array.from(element.children)) {
      if (child instanceof HTMLElement && child.dataset['kitWrap'] !== undefined) parted.push([]);
      else if (child instanceof HTMLElement && child.dataset['kitRun'] !== undefined) {
        parted.at(-1)?.push(child);
        starts.set(child, offset);
        offset += child.textContent.length;
      }
    }
    for (const [at, spans] of parted.entries()) {
      const placed = words[at] ?? [];
      lines.push({ spans, target: widths[at], along, plan: placed.length > 0 ? planWords(spans, starts, placed) : undefined });
    }
  }

  // 1. WRITE: every line as its runs set it.
  for (const { spans } of lines) {
    for (const span of spans) {
      span.style.marginLeft = '';
      span.style.letterSpacing = span.dataset['kitSpacing'] ?? '';
    }
  }

  // 2. READ, ONE LAYOUT: each place's and gap's width, and each line's whole width where it is fitted whole or its words
  // cannot be (a place that measures nothing).
  const read = lines.map(({ spans, target, along, plan }) => {
    if (plan !== undefined) {
      const naturals = plan.groups.map(({ spans: own }) => lengthOf(own, along));
      const gapNaturals = plan.gaps.map(({ spans: own }) => lengthOf(own, along));
      // NO LAYOUT, NOTHING TO FIT: a document with no layout engine measures every range as nothing.
      if (naturals.every((natural) => natural > 0)) return { kind: 'words' as const, plan, naturals, gapNaturals };
    }
    if (target === undefined || spans.length === 0) return undefined;
    const whole = wholeLine(spans);
    if (whole === undefined) return undefined;
    const natural = along.length(whole.range.getBoundingClientRect());
    return natural > 0 ? { kind: 'whole' as const, target, natural, letters: whole.letters } : undefined;
  });

  // 3. WRITE: every spacing.
  const spaceBy = (spans: readonly HTMLElement[], extra: number): void => {
    for (const span of spans) {
      const own = span.dataset['kitSpacing'] ?? '';
      span.style.letterSpacing = own === '' ? `${String(extra)}px` : `calc(${own} + ${String(extra)}px)`;
    }
  };
  for (const [at, fit] of read.entries()) {
    const line = lines[at];
    if (fit === undefined || line === undefined) continue;
    if (fit.kind === 'whole') {
      spaceBy(line.spans, (fit.target * zoom - fit.natural) / fit.letters);
      continue;
    }
    // THE SPACES BETWEEN TWO PLACES, fitted to the gap the page draws there: no place covers a space, so it kept the
    // stand-in's own width, and the next place's margin put that place right while the space's END stood off — Courier's
    // stand-in draws a space 0.05 em narrower, and a caret at the end of one stood 0.60 pt short at 12 pt (Chromium 151,
    // `editTextCaret.pw.ts`' end side, 2026-11-04). A gap the page draws as nothing or less is left to the margin.
    for (const [index, { spans: own, width, letters }] of fit.plan.gaps.entries()) {
      const natural = fit.gapNaturals[index] ?? 0;
      if (natural > 0) spaceBy(own, (width * zoom - natural) / letters);
    }
    // EACH PLACE AS WIDE AS THE PAGE DRAWS IT.
    for (const [index, { word, spans: own }] of fit.plan.groups.entries()) {
      spaceBy(own, ((word.x1 - word.x0) * zoom - (fit.naturals[index] ?? 0)) / (word.to - word.from));
    }
  }

  // 4. READ, THE SECOND LAYOUT: each placed word's left after the spacing. READ, never worked out from the spacing: a
  // spacing that is not zero changes how the browser shapes the letters (its ligatures are dropped), so a width does not
  // grow by its letters times the spacing. Worked out, the kerning control in `editTextCaret.pw.ts` put its worst caret
  // at the 18th boundary and not the kerned one (run 2026-11-14), which is that error made visible.
  const lefts = read.map((fit, at) => {
    const line = lines[at];
    if (fit?.kind !== 'words' || line === undefined) return undefined;
    return fit.plan.groups.map(({ spans: own }) => {
      const range = rangeOf(own);
      return range === undefined ? undefined : line.along.start(range.getBoundingClientRect());
    });
  });

  // 5. WRITE: EACH PLACE WHERE THE PAGE DRAWS IT FROM THE LINE'S FIRST, each margin less what the margins before it
  // already moved it, since on one line a margin moves everything after it by its own size.
  for (const [at, fit] of read.entries()) {
    const starts = lefts[at];
    if (fit?.kind !== 'words' || starts === undefined) continue;
    const first = fit.plan.groups[0];
    const origin = starts[0];
    if (first === undefined || origin === undefined) continue;
    let moved = 0;
    for (const [index, { word, spans: own }] of fit.plan.groups.entries()) {
      if (index === 0) continue;
      const lead = own[0];
      const left = starts[index];
      if (lead === undefined || left === undefined) break;
      const margin = origin + (word.x0 - first.word.x0) * zoom - (left + moved);
      lead.style.marginLeft = `${String(margin)}px`;
      moved += margin;
    }
  }
}

/**
 * A line's words as the page places them, or `undefined` where a word has no spans of its own (the words were cut
 * elsewhere than these), and the line is then fitted whole. Reads no layout.
 */
function planWords(spans: readonly HTMLElement[], starts: ReadonlyMap<HTMLElement, number>, placed: readonly DrawnWordPlace[]): WordPlan | undefined {
  const groups = placed.map((word) => ({
    word,
    spans: spans.filter((span) => {
      const from = starts.get(span) ?? -1;
      return from >= word.from && from + span.textContent.length <= word.to && span.textContent.length > 0;
    }),
  }));
  if (groups.some(({ word, spans: own }) => own.reduce((sum, span) => sum + span.textContent.length, 0) !== word.to - word.from)) return undefined;
  const placedSpans = new Set(groups.flatMap(({ spans: own }) => own));
  const gaps = groups.slice(1).flatMap((after, at) => {
    const before = groups[at];
    if (before === undefined) return [];
    const width = after.word.x0 - before.word.x1;
    const own = spans.filter((span) => {
      const from = starts.get(span) ?? -1;
      return !placedSpans.has(span) && span.textContent.length > 0 && from >= before.word.to && from + span.textContent.length <= after.word.from;
    });
    const letters = own.reduce((sum, span) => sum + span.textContent.length, 0);
    return width > 0 && letters > 0 && letters === after.word.from - before.word.to ? [{ spans: own, width, letters }] : [];
  });
  return { groups, gaps };
}

/** The range from the first span's first letter to the last span's last. */
function rangeOf(own: readonly HTMLElement[]): Range | undefined {
  const first = own[0]?.firstChild;
  const last = own.at(-1)?.firstChild;
  if (!(first instanceof Text) || !(last instanceof Text)) return undefined;
  const range = first.ownerDocument.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.data.length);
  return range;
}

function lengthOf(own: readonly HTMLElement[], along: Along): number {
  const range = rangeOf(own);
  return range === undefined ? 0 : along.length(range.getBoundingClientRect());
}

/** The line from its first letter to its last that is not a space, and how many letters that holds. */
function wholeLine(spans: readonly HTMLElement[]): { readonly range: Range; readonly letters: number } | undefined {
  const texts = spans.map((span) => span.firstChild).filter((node): node is Text => node instanceof Text && node.data !== '');
  const first = texts[0];
  let last: { readonly node: Text; readonly end: number } | undefined;
  for (const node of [...texts].reverse()) {
    const end = node.data.trimEnd().length;
    if (end > 0) {
      last = { node, end };
      break;
    }
  }
  if (first === undefined || last === undefined) return undefined;
  const range = first.ownerDocument.createRange();
  range.setStart(first, 0);
  range.setEnd(last.node, last.end);
  return { range, letters: range.toString().length };
}

function wrapBreak(owner: Document): HTMLElement {
  const wrap = owner.createElement('br');
  wrap.dataset['kitWrap'] = '';
  return wrap;
}
