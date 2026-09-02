import { type FitzPoint, fitzPoint } from '@monstera/shared';

/**
 * The one place that asks MuPDF for text, and the one shape its answer takes.
 *
 * ## What this module owns, and what it deliberately does not
 *
 * It owns the **options** and the **normalisation**. It implements no
 * clustering — not glyphs into lines, not lines into reading order — because
 * MuPDF already does both and was measured doing them correctly
 * ([ADR-0034](../../../docs/DECISIONS/0034-the-text-substrate-owns-the-engines-options-not-its-own-clusterer.md),
 * `docs/ARCHITECTURE.md` §3.2).
 *
 * `BUILD-PROMPT.md` Part E2 asks for one implementation so that no consumer
 * re-derives clustering "with constants required to mirror exactly across
 * copies". Owning the options delivers that guarantee more strongly than owning
 * an algorithm would: there is no algorithm here for a second consumer to copy,
 * and the regression E2 calls K.0 becomes **a second set of stext options
 * anywhere**, which is a grep rather than a judgement.
 *
 * ## Coordinates are FitzPoint, and that is not a formality
 *
 * MuPDF's structured text is **y-down from the page top** — measured: a run
 * drawn at PDF user y=700 on a 792pt page comes back at y=92, which is
 * `792 - 700` exactly. Handing that out as a bare `{x, y}` is precisely the
 * invisible bug invariant L3 exists to prevent, because it renders correctly on
 * every page whose CropBox starts at the origin and wrongly on the rest.
 *
 * So every coordinate leaving here is a {@link FitzPoint}, and a consumer that
 * wants viewport or PDF space converts through `PageTransform`. This module
 * performs no flip: it has no rotation and no CropBox in hand, which is the
 * whole reason the flip lives in one place.
 */

/**
 * The options this application asks MuPDF for, and the only place they are
 * named.
 *
 * `SEGMENT` is on because it is the reading-order fix: measured 2026-09-02, it
 * turns row-major into column-major on a two-column page at both a 268pt and a
 * 60pt gutter, and leaves single-column prose byte-for-byte unchanged.
 *
 * `TABLE_HUNT` is off because it **damages prose**: on a single-column fixture
 * it split one line into two, inventing a table, and it undid `SEGMENT`'s
 * column ordering. It is a per-consumer opt-in, and the first feature whose
 * subject is a table owes the reading ADR-0034 did for prose before turning it
 * on.
 *
 * The numbers are MuPDF's own, from `include/mupdf/fitz/structured-text.h`.
 * They are spelt as literals with their names beside them rather than imported,
 * because the shim's ABI carries an `int` and there is no header to import from
 * — and a bare `4096` at a call site is the thing this constant exists to stop.
 */
export const STEXT_OPTIONS = {
  /** `FZ_STEXT_SEGMENT` — segment the page into reading-order regions. */
  segment: 4096,
  /** `FZ_STEXT_TABLE_HUNT` — off; see the note above. */
  tableHunt: 16384,
} as const;

/** The flag word every caller passes, so no consumer chooses its own. */
export const STEXT_FLAGS: number = STEXT_OPTIONS.segment;

/** A rectangle in MuPDF's space, as two corners rather than a size. */
export interface FitzRect {
  readonly topLeft: FitzPoint;
  readonly bottomRight: FitzPoint;
}

/** One run of text MuPDF placed on a single baseline. */
export interface TextLine {
  readonly text: string;
  readonly box: FitzRect;
  /** The line's origin, which is its left edge on the baseline. */
  readonly origin: FitzPoint;
  /** Point size, as MuPDF reports it for the line's font. */
  readonly size: number;
}

/** A group of lines MuPDF placed together, in the reading order it chose. */
export interface TextBlock {
  readonly lines: readonly TextLine[];
  readonly box: FitzRect;
}

/** One page's text, in reading order. */
export interface PageText {
  readonly blocks: readonly TextBlock[];
}

/**
 * MuPDF's JSON, as much of it as this module reads.
 *
 * Declared as the loose shape it is rather than validated: it is the engine's
 * own serialisation crossing an in-process boundary, and a schema here would be
 * this module's opinion about a format MuPDF owns. What it does instead is
 * refuse anything it cannot read — see {@link parsePageText}.
 */
/**
 * Every field is `unknown`, and the readers below are the only narrowing.
 *
 * Typing them as their expected shapes would be a claim this module cannot
 * check — the payload arrives as text from a C boundary — and `Array.isArray`
 * on a declared `readonly T[]` narrows to `any[]`, which B7 forbids for the
 * good reason that it hands every downstream read an unchecked type.
 */
type RawNode = Readonly<Record<string, unknown>>;

/** @returns the number, or `fallback` where MuPDF omitted or nulled it. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** @returns the object, or null — the one narrowing for a nested member. */
function node(value: unknown): RawNode | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawNode)
    : null;
}

/** @returns the array's members as nodes, or null where it is not an array. */
function nodes(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

/**
 * One field of a raw node.
 *
 * A named reader rather than a bracket at each site: `noPropertyAccessFromIndexSignature`
 * makes every read of an unchecked payload visibly a lookup, and spelling that
 * as `block['bbox']` eleven times invites somebody to widen the type instead.
 */
function field(from: RawNode | null, name: string): unknown {
  return from === null ? undefined : from[name];
}

function rectOf(value: unknown): FitzRect {
  const box = node(value);
  const x = num(field(box, 'x'), 0);
  const y = num(field(box, 'y'), 0);
  return {
    topLeft: fitzPoint(x, y),
    bottomRight: fitzPoint(x + num(field(box, 'w'), 0), y + num(field(box, 'h'), 0)),
  };
}

/**
 * Flattens MuPDF's block tree into blocks, **in document order**.
 *
 * ## The recursion is where the reading order lives
 *
 * Under `FZ_STEXT_SEGMENT` MuPDF nests text blocks inside `structure` blocks —
 * `{"type":"structure","contents":[…]}` — and the column-major order it
 * computed is the order of that tree walked depth-first. A reader that took
 * `page.blocks` at face value sees one structure block and no lines at all.
 *
 * That is not hypothetical: the spike's first summariser did exactly that and
 * reported **0 lines, 0 merged**, which is indistinguishable from a page that
 * segmented perfectly. Nothing about the number looked wrong, because zero
 * merges is the answer the measurement was hoping for.
 *
 * **So the flattening must never re-sort.** Any ordering of ours here would be
 * the block clusterer ADR-0034 rejected, arriving as a tidy-up.
 *
 * @param nodes MuPDF's `blocks` or a structure block's `contents`
 * @param into the accumulator, appended in place to keep the walk order exact
 */
function collectBlocks(source: readonly unknown[], into: TextBlock[]): void {
  for (const entry of source) {
    const block = node(entry);
    if (block === null) continue;

    const contents = nodes(field(block, 'contents'));
    if (contents !== null) {
      collectBlocks(contents, into);
      continue;
    }

    const rawLines = nodes(field(block, 'lines'));
    if (rawLines === null) continue;

    const lines: TextLine[] = [];
    for (const rawLine of rawLines) {
      const line = node(rawLine);
      const text = str(field(line, 'text'));
      if (line === null || text === null) continue;
      lines.push({
        text,
        box: rectOf(field(line, 'bbox')),
        origin: fitzPoint(num(field(line, 'x'), 0), num(field(line, 'y'), 0)),
        size: num(field(node(field(line, 'font')), 'size'), 0),
      });
    }
    // A TEXT BLOCK WITH NO LINES IS DROPPED, not kept empty: MuPDF emits image
    // and vector blocks through the same array, and an empty block in a reading
    // order is a gap a consumer has to know to skip.
    if (lines.length > 0) into.push({ lines, box: rectOf(field(block, 'bbox')) });
  }
}

/**
 * MuPDF's structured-text JSON for one page, as this project's shape.
 *
 * **Refuses rather than returning an empty page.** A parse that answered
 * `{blocks: []}` for malformed input would be indistinguishable from a blank
 * page, and blank is the reassuring answer for every consumer here: search
 * finds nothing, extraction yields nothing, and none of them reports a problem.
 * The audit's corollary in one line — an empty intermediate result is a broken
 * parse, not a clean input.
 *
 * A page that genuinely holds no text is representable and legal: it arrives as
 * `{"blocks":[]}` from MuPDF and answers `{blocks: []}` here. The distinction is
 * between *MuPDF said there is nothing* and *this could not read what MuPDF
 * said*.
 *
 * @param json the payload from the engine's structured-text call
 * @throws if the payload is not JSON, or is not a page-shaped object
 */
export function parsePageText(json: string): PageText {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new Error('structured text was not JSON, so this page was not read', { cause });
  }

  const page = node(parsed);
  const source = nodes(field(page, 'blocks'));
  if (source === null) {
    throw new Error(
      'structured text carried no `blocks` array. Returning an empty page here would be ' +
        'indistinguishable from a page with no text, and every consumer treats that as a ' +
        'clean result.',
    );
  }

  const blocks: TextBlock[] = [];
  collectBlocks(source, blocks);
  return { blocks };
}

/** Every line of a page, in reading order, with its block boundaries dropped. */
export function linesOf(page: PageText): readonly TextLine[] {
  return page.blocks.flatMap((block) => block.lines);
}

/**
 * A page's text as one string, blocks separated by a blank line.
 *
 * The separator is the block boundary rather than the line one, because a line
 * break inside a block is a wrap and a break between blocks is a paragraph —
 * which is the distinction `FZ_STEXT_SEGMENT` was turned on to preserve.
 */
export function plainTextOf(page: PageText): string {
  return page.blocks.map((block) => block.lines.map((line) => line.text).join('\n')).join('\n\n');
}
