import { type ClipWindow, type Matrix, SETTING_SLOTS, type StateAt, multiply } from './textOperators.js';

/**
 * What an edit of one object in a page's content writes with
 * ([ADR-0264](../../../docs/DECISIONS/0264-edit-object-returns-and-an-edit-changes-only-the-bytes-of-the-object-it-names.md)):
 * a number as a content stream says one, a matrix's inverse, a box, and THE ONE WAY a piece of the content is carried
 * to another place in it and drawn there as it was drawn where it stood (Decision 3), for a drawn object and a text
 * block alike (B3a).
 *
 * ## What is carried, in a `q … Q` around the piece
 *
 * An arrange moves an object one step in the drawing order, and the state in force one step on is not the state it was
 * drawn under. So, before the piece:
 *
 * 1. **The `gs` parameters reset** where the new place has one in force the old place had not: opacity, blend mode and
 *    soft mask have no operator of their own, so a plain graphics state resets them, and the caller puts it in the
 *    page's resources. Asked for only where needed, so a page is not given a resource it does not use.
 * 2. **The initial value of every other parameter** the new place sets and the old one left alone: a fill colour, a line
 *    width, a dash, a text state.
 * 3. **The instructions in effect where it stood**, in order: `textOperators.ts`' `settings`, the list Edit text
 *    replays, which reproduces the state when said again.
 * 4. **The clip windows it stood in** that are not in force at the new place, each its own path said again under its
 *    own CTM with `W n`.
 * 5. **The CTM it stood under**, as the `cm` from the new place's.
 *
 * ## The one thing that cannot be carried
 *
 * A clip in force at the new place and not at the old would cut the piece off where it does not hold the piece's box.
 * Nothing inside a `q` can widen a clip, so that is refused (Decision 4): `'cropped'`.
 */

/** A box in page space. */
export interface PageBox {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

/**
 * A number as a content stream writes one: no exponent, no trailing zeros, and TEN decimals, because a matrix in an
 * object's own space is scaled by that space: six decimals under a 120-point photo moved it by 6e-5 pt (ADR-0240).
 */
export function written(value: number): string {
  const fixed = value.toFixed(10).replace(/\.?0+$/u, '');
  return fixed === '-0' ? '0' : fixed;
}

/** A matrix's inverse, or `null` for one that collapses the page. */
export function inverse([a, b, c, d, e, f]: Matrix): Matrix | null {
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** The box of some points. */
export function boxOfPoints(points: readonly (readonly [number, number])[]): PageBox {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}

/** The initial value of each slot (ISO 32000 Table 51 and §9.3), said where the new place sets a slot the old did not. */
const INITIAL: Readonly<Record<string, string>> = {
  Tc: '0 Tc',
  Tw: '0 Tw',
  Tz: '100 Tz',
  TL: '0 TL',
  Tr: '0 Tr',
  Ts: '0 Ts',
  w: '1 w',
  J: '0 J',
  j: '0 j',
  M: '10 M',
  d: '[] 0 d',
  ri: '/RelativeColorimetric ri',
  // ZERO IS THE DEVICE'S OWN FLATNESS (§10.6.2), which is the initial value.
  i: '0 i',
  // `g` and `G` set the space with the colour, so one instruction answers both slots of each.
  'fill space': '0 g',
  fill: '0 g',
  'stroke space': '0 G',
  stroke: '0 G',
};

/**
 * The parameters a plain graphics state resets: every one with no operator of its own that changes how a mark looks, at
 * its initial value (ISO 32000 Table 58). The caller adds it to the page's `ExtGState` resources under a free name.
 */
export const PLAIN_STATE: Readonly<Record<string, string | number | boolean>> = {
  Type: 'ExtGState',
  CA: 1,
  ca: 1,
  BM: 'Normal',
  SMask: 'None',
  AIS: false,
  TK: true,
  OP: false,
  op: false,
  OPM: 0,
  SA: false,
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const SAME = 1e-9;

/** How far a window may fall short of the box and still hold it: below a hundredth of a point, the listing's rounding. */
const HOLDS = 0.01;

/** Whether a clip window lets all of `box` through. Its path's box is what is known of it, which a curve may overstate. */
function holds(window: ClipWindow, box: PageBox): boolean {
  const around = boxOfPoints(window.points);
  return around.left <= box.left + HOLDS && around.bottom <= box.bottom + HOLDS && around.right >= box.right - HOLDS && around.top >= box.top - HOLDS;
}

/** The `cm` that takes the CTM from `current` to `wanted` (empty where they are the same), or `null` for a collapsed one. */
function cmFrom(current: Matrix, wanted: Matrix): string | null {
  const back = inverse(current);
  if (back === null) return null;
  const change = multiply(wanted, back);
  return change.every((value, at) => Math.abs(value - (IDENTITY[at] ?? 0)) < SAME) ? '' : `${change.map(written).join(' ')} cm`;
}

/**
 * The `q` and the instructions before a carried piece, and the `Q` after it, that draw the piece at a place in state
 * `to` as it was drawn in state `from`; `'cropped'` where a clip at the new place would cut `box` off, or the CTM at
 * either place collapses the page (nothing drawn there could be the piece).
 *
 * @param content the content both states were read from, whose bytes the settings and windows name
 * @param plainState the name of the plain graphics state the caller adds to the page's resources where `plain` is set
 */
export function carried(
  content: Uint8Array,
  from: StateAt,
  to: StateAt,
  box: PageBox,
  plainState: string,
): { readonly before: string; readonly after: string; readonly plain: boolean } | 'cropped' {
  const fromWindows = new Set(from.windows.map((window) => window.start));
  const toWindows = new Set(to.windows.map((window) => window.start));
  if (to.windows.some((window) => !fromWindows.has(window.start) && !holds(window, box))) return 'cropped';
  const latin1 = new TextDecoder('latin1');
  const bytes = (start: number, end: number): string => latin1.decode(content.subarray(start, end));
  const fromSpans = new Set(from.settings.map((setting) => `${String(setting.start)}:${String(setting.end)}`));
  const added = to.settings.filter((setting) => !fromSpans.has(`${String(setting.start)}:${String(setting.end)}`));
  const parts: string[] = ['q'];
  const plain = added.some((setting) => setting.slot === null);
  if (plain) parts.push(`/${plainState} gs`);
  const fromSlots = new Set(from.settings.map((setting) => setting.slot));
  parts.push(
    ...new Set(
      SETTING_SLOTS.filter((slot) => !fromSlots.has(slot) && added.some((setting) => setting.slot === slot)).flatMap((slot) => {
        const initial = INITIAL[slot];
        return initial === undefined ? [] : [initial];
      }),
    ),
  );
  parts.push(...from.settings.map((setting) => bytes(setting.start, setting.end)));
  // THE WINDOWS IT STOOD IN and the new place lacks, outermost first, each under the CTM its path was built in.
  let current = to.ctm;
  for (const window of from.windows) {
    if (toWindows.has(window.start)) continue;
    const change = cmFrom(current, window.ctm);
    if (change === null) return 'cropped';
    if (change !== '') parts.push(change);
    current = window.ctm;
    parts.push(`${bytes(window.start, window.segmentsEnd).trimEnd()} ${window.evenOdd ? 'W*' : 'W'} n`);
  }
  const placed = cmFrom(current, from.ctm);
  if (placed === null) return 'cropped';
  if (placed !== '') parts.push(placed);
  return { before: `${parts.join('\n')}\n`, after: '\nQ\n', plain };
}
