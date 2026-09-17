import { type ViewportPoint, viewportPoint } from '@monstera/shared';

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
 * ## Coordinates are branded, and that is not a formality
 *
 * MuPDF's structured text is **y-down from the page top** — measured: a run
 * drawn at PDF user y=700 on a 792pt page comes back at y=92, which is
 * `792 - 700` exactly. Handing that out as a bare `{x, y}` is precisely the
 * invisible bug invariant L3 exists to prevent, because it renders correctly on
 * every page whose CropBox starts at the origin and wrongly on the rest.
 *
 * So every coordinate leaving here is branded and a consumer converts through
 * `PageTransform`. This module performs no conversion of its own: it has no
 * rotation and no CropBox in hand, which is the whole reason the conversion
 * lives in one place.
 *
 * **THE BRAND WAS `FitzPoint` UNTIL 2026-09-08 AND THAT WAS THE WRONG SPACE.**
 * It is `ViewportPoint` at scale 1 — display space, with `/Rotate` already
 * applied. The measurement, the table and why nothing caught it are on
 * {@link DisplayedRect}. The paragraph above is unchanged and was never the
 * error: y **is** down from the page top, and it was measured on an upright
 * page, where the two spaces coincide.
 */

/**
 * The options this application asks MuPDF for, and the only place they are
 * named.
 *
 * `SEGMENT` is on because it is the reading-order fix: measured 2026-09-02, it
 * turns row-major into column-major on a two-column page at both a 268pt and a
 * 60pt gutter, and leaves single-column prose byte-for-byte unchanged.
 *
 * `TABLE_HUNT` is off. Measured 2026-09-02 on a single-column fixture it split
 * one line into two, inventing a table, and undid `SEGMENT`'s column ordering.
 * Measured again 2026-09-10 against real documents — `npm run proof:lineagreement`
 * over the eleven-document corpus, `segment,table-hunt` against `segment`,
 * scored on the same PDFium reading — **two of the six documents carrying text
 * change at all, at −1.5 and −17.5 points of line agreement, and none
 * improves**.
 *
 * The delta is not the whole argument and the comment says so rather than
 * letting a number stand in for one: the option emits **cells**, a cell is not a
 * line, so part of that fall is the option working. What settles it here is that
 * every consumer of this substrate reads lines — the text layer, search, spell
 * check, word count. It stays a per-consumer opt-in, and the first feature whose
 * subject is a table owes a reading against table structure, which agreement
 * with a line-oriented reader cannot supply.
 *
 * The names are MuPDF's own, from `source/fitz/stext-device.c`'s
 * `fz_parse_stext_options`.
 *
 * ## ONE ENCODING, as of 2026-09-02, and that is the point of this shape
 *
 * This module carried the choice **twice** until then: a flag word `4096` for
 * the C shim's `mz_stext_json`, and the string `'segment'` for the npm
 * package's `toStructuredText`. Two independent literals, with nothing deriving
 * one from the other and nothing comparing them — and the argument for it was
 * that living in one module makes drift *visible to a reader*, which is a
 * paragraph someone has to read and act on rather than a state that cannot
 * arise. QQQ-3's ruling exactly, and worse here because the flag word had **no
 * product caller**: drift would have run toward the side nothing exercises.
 *
 * The shim export is gone and so is the flag word. ADR-0034's K.0 bans *"a
 * second set of stext options anywhere"*, and two encodings of one set is that
 * shape one step short of it. What remains is a set of option NAMES, which is
 * how the engine's own parser spells them, so adding `tableHunt` to what this
 * application asks for is one edit here and nothing else anywhere (B5).
 */
export const STEXT_OPTIONS = {
  /** `FZ_STEXT_SEGMENT` — segment the page into reading-order regions. */
  segment: 'segment',
  /** `FZ_STEXT_TABLE_HUNT` — off; see the note above. */
  tableHunt: 'table-hunt',
  /** `FZ_STEXT_PRESERVE_IMAGES` — on; see {@link PageText.images}. */
  preserveImages: 'preserve-images',
  /**
   * `structured` — follow a tagged document's structure tree. **Never part of the
   * shared read**, and asked for only by the structure read
   * ([ADR-0065](../../../docs/DECISIONS/0065-a-tagged-documents-structure-is-the-engines-read-on-its-own-request.md)):
   * measured 2026-09-14 over the corpus's tagged documents, it gives a different
   * line sequence from the shared read on every one of the 12 pages carrying text,
   * and breaks the same characters into different lines on 8 of them. Search, the
   * text layer, word count and spell check asked for neither.
   */
  structured: 'structured',
  /**
   * `FZ_STEXT_COLLECT_VECTORS` — the page's vector paths as blocks. **Asked for only
   * by the table read**, where it is what lets a ruling line propose a table:
   * `stext-table.c` proposes one per raft of vectors, and without them every
   * generated grid came back two columns wide
   * ([ADR-0073](../../../docs/DECISIONS/0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md)).
   */
  vectors: 'vectors',
  /** `FZ_STEXT_ACCURATE_BBOXES` — asked for only by the table read, as MuPDF's CSV writer asks. */
  accurateBboxes: 'accurate-bboxes',
} as const;

/**
 * What this application asks `toStructuredText` for.
 *
 * `tableHunt` is ABSENT rather than written `table-hunt=0`, so turning it on is
 * visibly a change to this line. Composed from the set above rather than spelt,
 * because a literal here would be the second opinion the set exists to prevent.
 *
 * ## `preserveImages` was added 2026-09-10, and it changes no existing answer
 *
 * Without it MuPDF reports no image blocks at all, so *this page has no text*
 * and *this page is a picture of text* are the same empty reading — which is
 * what D6's scanned-page row needs to separate, and it needs it from **the read
 * that already happens** rather than from a second one.
 *
 * Measured before it was turned on (`scripts/research/pageComposition.mjs`) on
 * four constructed pages, with the option off and on:
 *
 * | page | off | on |
 * |---|---|---|
 * | text only | 32 chars, `{text: 1}` | 32 chars, `{text: 1}` |
 * | image only | 0 chars, `{}` | 0 chars, **`{image: 1}`** |
 * | empty | 0 chars, `{}` | 0 chars, `{}` |
 * | both | 21 chars, `{text: 1}` | 21 chars, **`{image: 1, text: 1}`** |
 *
 * The text is identical either way, and {@link parsePageText} drops any block
 * with no `lines`, so no consumer sees a new kind of block. What arrives is one
 * extra number.
 *
 * ## IT IS NOT INERT, AND THE CONTROL IS WHAT SAID SO
 *
 * The sentence above originally ended *"so search, word count and the text
 * layer read exactly what they read before"*, which was written from the
 * fixtures and was false the moment it was written. Re-running
 * `proof:lineagreement` over the corpus with the option on is the control, and
 * it separates three things that the fixtures could not:
 *
 * - **Characters: unchanged.** 99.92% mean, and identical per document.
 * - **Line boundaries: unchanged.** Every line count and every agreement figure
 *   is the same to a tenth of a point.
 * - **Reading ORDER: changed on two of the six documents carrying text**, from
 *   28.2% to 46.6% positional agreement with PDFium on one and from 14.9% to
 *   13.2% on the other.
 *
 * The mechanism is `FZ_STEXT_SEGMENT`: an image is a region, so a page that has
 * one is segmented differently once the engine can see it. That is MuPDF's own
 * model of such a page rather than a defect, and the direction is not evidence
 * either way — PDFium's order is content-stream order, which `SEGMENT` exists
 * to depart from.
 *
 * What it costs is stated rather than discovered: on a page carrying pictures,
 * selection order and search-result order may differ from what this build
 * produced before 2026-09-10. Nothing about a *line* moved.
 */
export const STEXT_OPTION_STRING: string = [
  STEXT_OPTIONS.segment,
  STEXT_OPTIONS.preserveImages,
].join(',');

/**
 * The reads a caller may ask the engine for, by NAME.
 *
 * A closed set rather than an option string, so nothing crossing a boundary can
 * carry an option to `fz_parse_stext_options`: the engine host maps a name to the
 * string {@link stextOptionsFor} composes, and nothing else composes one (ADR-0065).
 */
export const PAGE_TEXT_READS = ['substrate', 'structure', 'table'] as const;

/** One of {@link PAGE_TEXT_READS}. */
export type PageTextRead = (typeof PAGE_TEXT_READS)[number];

/**
 * The option string for a named read.
 *
 * ## `structure` is the shared set PLUS one option, never `structured` alone
 *
 * Measured 2026-09-14 on a generated tagged page: the shared set plus `structured`
 * gives the tag roles in tree order exactly as `structured` alone does, and keeps
 * `preserve-images` — without which a page tagged only as a Figure reads as a page
 * with nothing on it. So the two reads differ by the one option this read exists
 * for, and a difference between them is that option's doing.
 */
export function stextOptionsFor(read: PageTextRead): string {
  switch (read) {
    case 'substrate':
      return STEXT_OPTION_STRING;
    case 'structure':
      return [STEXT_OPTION_STRING, STEXT_OPTIONS.structured].join(',');
    // THE CSV WRITER'S SET, not the flag alone: `output-csv.c` asks for vectors,
    // accurate boxes, segmentation and the hunt, and the hunt without vectors
    // splits every table at its gutters (ADR-0073).
    case 'table':
      return [
        STEXT_OPTION_STRING,
        STEXT_OPTIONS.vectors,
        STEXT_OPTIONS.accurateBboxes,
        STEXT_OPTIONS.tableHunt,
      ].join(',');
  }
}

/**
 * A rectangle in the page's **display space**, as two corners rather than a size.
 *
 * ## This said `FitzRect` and `FitzPoint` until 2026-09-08, and that was wrong
 *
 * `FitzPoint` in `@monstera/shared` is the **unrotated** y-down space:
 * `toFitz` is `(x − crop.x0, crop.y1 − y)` and touches rotation nowhere. MuPDF's
 * structured text is not in that space. It comes off the page's display list,
 * which has already applied `/Rotate`.
 *
 * Measured at all four turns (`scripts/research/textFrames.mjs`), with the same
 * ink at the same user-space position on every fixture so the pre-image cannot
 * move. A run drawn at user `(60, 600)`, 14pt, on a 400×700 page:
 *
 * | `/Rotate` | the box reported here | `fromFitz` | `toPdf` |
 * |---|---|---|---|
 * | 0 | (60, 84)–(161, 103) | on the run | on the run |
 * | 90 | (595, 60)–(614, 161) | **elsewhere** | on the run |
 * | 180 | (238, 595)–(339, 614) | **elsewhere** | on the run |
 * | 270 | (84, 238)–(103, 339) | **elsewhere** | on the run |
 *
 * **At `/Rotate 0` the two conversions are arithmetically the same operation**,
 * which is why nothing caught it: every fixture in this repository that touches
 * the substrate is upright, and the wrong type agrees with the right one on all
 * of them.
 *
 * So the corners are {@link ViewportPoint} at scale 1 — the same reading
 * `flatFields.ts` already takes of MuPDF's device output, whose `Displayed`
 * box goes through `toPdf(viewportPoint(…), transform)`. One answer to *what
 * frame does this engine report in*, not two (B3a).
 *
 * **Nothing in the product converted one of these**, which is why this was a
 * latent claim rather than a live defect: search carries `line`, `offset` and
 * `text` and no geometry. The text layer is the first caller, and it would have
 * placed every line of every rotated page somewhere the text is not — a failure
 * that looks exactly like a working feature until someone opens a landscape
 * scan.
 */
export interface DisplayedRect {
  readonly topLeft: ViewportPoint;
  readonly bottomRight: ViewportPoint;
}

/** One run of text MuPDF placed on a single baseline. */
export interface TextLine {
  readonly text: string;
  readonly box: DisplayedRect;
  /**
   * The line's origin, which is its left edge on the baseline.
   *
   * Display space, for {@link DisplayedRect}'s reason and measured in the same
   * run — it comes from the same node of the same JSON.
   */
  readonly origin: ViewportPoint;
  /** Point size, as MuPDF reports it for the line's font. */
  readonly size: number;
  /**
   * The line's font as MuPDF names and classifies it, from the same `font` node
   * the size comes from.
   *
   * MuPDF's classification, not ours: `bold` and `italic` are its reading of the
   * font's weight and style, and a rich export uses them as given rather than
   * guessing from a name like `Helvetica-Bold` (B3a).
   */
  readonly font: TextFont;
}

/** A line's font, as MuPDF reports it. */
export interface TextFont {
  readonly name: string;
  /** MuPDF's generic family: `serif`, `sans-serif` or `monospace`. */
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** A group of lines MuPDF placed together, in the reading order it chose. */
export interface TextBlock {
  readonly lines: readonly TextLine[];
  readonly box: DisplayedRect;
}

/** One page's text, in reading order. */
export interface PageText {
  readonly blocks: readonly TextBlock[];
  /**
   * How many image blocks MuPDF reported on this page.
   *
   * **A count and not the images.** What a consumer asks is whether there is
   * anything here to recognise, and a page's rasters are the largest thing on
   * it — ADR-0035's rule about extracted text applies to pixels with more force.
   * Nothing in this build needs their boxes yet, and a field nothing reads is a
   * payload waiting to be justified after the fact.
   *
   * Zero for a page asked for without `preserve-images`, which is why the option
   * is part of {@link STEXT_OPTION_STRING} rather than a per-consumer opt-in: a
   * zero that means *nobody asked* is indistinguishable from a page with no
   * pictures on it, and the whole point of this number is to separate two
   * readings that are otherwise both empty.
   */
  readonly images: number;
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

function rectOf(value: unknown): DisplayedRect {
  const box = node(value);
  const x = num(field(box, 'x'), 0);
  const y = num(field(box, 'y'), 0);
  return {
    topLeft: viewportPoint(x, y),
    bottomRight: viewportPoint(x + num(field(box, 'w'), 0), y + num(field(box, 'h'), 0)),
  };
}

/**
 * What {@link walkBlocks} reports, in document order.
 *
 * ## ONE WALK, TWO VIEWS
 *
 * {@link parsePageText} flattens the tree into blocks and
 * {@link parsePageStructure} keeps the structure elements that flattening drops.
 * Both take this one traversal, so they cannot disagree about which lines a page
 * holds or where the engine put them. A second walk over the same JSON would be a
 * second reader of MuPDF's format (§3.2), and `flatFields.ts` already shows the
 * shape: correct under the options it asks for, and blind the day those change.
 */
interface BlockVisitor {
  /** A block carrying `contents`, before them. */
  readonly enter: (block: RawNode) => void;
  /** The same block, after its contents. */
  readonly leave: () => void;
  readonly image: () => void;
  /** A block carrying `lines`, with the ones this module could read — possibly none. */
  readonly text: (block: RawNode, lines: readonly TextLine[]) => void;
  /** A `grid` block: the positions and cell flags `FZ_STEXT_TABLE_HUNT` found. */
  readonly grid: (block: RawNode) => void;
}

/**
 * Walks MuPDF's block tree, **in document order**.
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
 * @param source MuPDF's `blocks` or a structure block's `contents`
 * @param visitor told about each block in the order the engine put it
 */
function walkBlocks(source: readonly unknown[], visitor: BlockVisitor): void {
  for (const entry of source) {
    const block = node(entry);
    if (block === null) continue;

    const contents = nodes(field(block, 'contents'));
    if (contents !== null) {
      visitor.enter(block);
      walkBlocks(contents, visitor);
      visitor.leave();
      continue;
    }

    // COUNTED IN THIS WALK, not in a second pass over the same tree. An image
    // may sit inside a `structure` block like any other, so a top-level count
    // would miss exactly the segmented pages this option was turned on for.
    if (str(field(block, 'type')) === 'image') visitor.image();
    if (str(field(block, 'type')) === 'grid') visitor.grid(block);

    const rawLines = nodes(field(block, 'lines'));
    if (rawLines === null) continue;

    const lines: TextLine[] = [];
    for (const rawLine of rawLines) {
      const line = node(rawLine);
      const text = str(field(line, 'text'));
      if (line === null || text === null) continue;
      const font = node(field(line, 'font'));
      lines.push({
        text,
        box: rectOf(field(line, 'bbox')),
        origin: viewportPoint(num(field(line, 'x'), 0), num(field(line, 'y'), 0)),
        size: num(field(font, 'size'), 0),
        font: {
          name: str(field(font, 'name')) ?? '',
          family: str(field(font, 'family')) ?? '',
          bold: str(field(font, 'weight')) === 'bold',
          italic: str(field(font, 'style')) === 'italic',
        },
      });
    }
    visitor.text(block, lines);
  }
}

/**
 * The page's top-level `blocks`, or a refusal.
 *
 * Shared by both views, so *could not read what MuPDF said* is refused the same
 * way whichever view was asked for.
 *
 * @throws if the payload is not JSON, or is not a page-shaped object
 */
function blocksOf(json: string): readonly unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new Error('structured text was not JSON, so this page was not read', { cause });
  }

  const source = nodes(field(node(parsed), 'blocks'));
  if (source === null) {
    throw new Error(
      'structured text carried no `blocks` array. Returning an empty page here would be ' +
        'indistinguishable from a page with no text, and every consumer treats that as a ' +
        'clean result.',
    );
  }
  return source;
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
  const blocks: TextBlock[] = [];
  let images = 0;
  walkBlocks(blocksOf(json), {
    // A STRUCTURE BLOCK IS WALKED THROUGH and leaves nothing here: its lines
    // arrive through `text` in the order the tree holds them.
    enter: () => undefined,
    leave: () => undefined,
    image: () => {
      images += 1;
    },
    // A TEXT BLOCK WITH NO LINES IS DROPPED, not kept empty: MuPDF emits image
    // and vector blocks through the same array, and an empty block in a reading
    // order is a gap a consumer has to know to skip.
    text: (block, lines) => {
      if (lines.length > 0) blocks.push({ lines, box: rectOf(field(block, 'bbox')) });
    },
    grid: () => undefined,
  });
  return { blocks, images };
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

/**
 * The raw name MuPDF gives the structure blocks `FZ_STEXT_SEGMENT` makes.
 *
 * **Segmentation's, not the document's.** Measured 2026-09-14 under the structure
 * read over the whole corpus, first five pages of each document: on every page of
 * the seven untagged documents every structure block is raw `Split`, standard
 * `Div`, and on every page of the four tagged ones not one is. A generated
 * untagged two-column page gives three `Split` blocks and its tagged twin none.
 *
 * **Stated limit:** a document that names one of its own elements `Split` has that
 * element read as segmentation's, and its children appear one level up. The raw
 * name is the only thing that separates the two in MuPDF's output.
 */
export const SEGMENTATION_RAW_ROLE = 'Split';

/** One element of a tagged page's structure, in tree order. */
export interface StructureNode {
  /**
   * The standard role — `P`, `H1`, `Table` — as MuPDF resolved it through the
   * document's role map. Empty where it gave none.
   */
  readonly role: string;
  /** The document's own name for the element, before the role map. */
  readonly raw: string;
  /** Nesting depth: zero for an element with no tagged ancestor on this page. */
  readonly depth: number;
  /** Text lines directly inside this element, not inside a tagged child of it. */
  readonly lines: number;
}

/** A page's structure as the engine read it under the structure read. */
export interface PageStructure {
  /**
   * The elements, in PREORDER — which is the structure tree's order, and the order
   * a reader of a tagged document is meant to follow. Flat with a depth, so a
   * consumer indents rather than rebuilding a tree.
   */
  readonly nodes: readonly StructureNode[];
  /** Text lines on the page inside no tagged element. */
  readonly untaggedLines: number;
  /** Image blocks, for {@link PageText.images}' reason. */
  readonly images: number;
}

/**
 * MuPDF's structured-text JSON under the `structure` read, as the elements it
 * carries.
 *
 * The other view over {@link walkBlocks}: nothing here re-reads a line or re-sorts
 * an element, so the order is the engine's and the lines are the ones
 * {@link parsePageText} would find in the same payload.
 *
 * **No text leaves.** A node carries a role, a name, a depth and a count — which is
 * what an inspection of a page's tagging shows, and what lets the answer cross to
 * the renderer without a page's words
 * ([ADR-0035](../../../docs/DECISIONS/0035-extracted-text-is-never-resident-in-main.md)).
 *
 * @param json the payload from the engine's structured-text call under `structure`
 * @throws for {@link parsePageText}'s reasons
 */
export function parsePageStructure(json: string): PageStructure {
  const found: { role: string; raw: string; depth: number; lines: number }[] = [];
  // ONE ENTRY PER OPEN BLOCK, `null` for a block that is not an element — so
  // `leave` knows whether the block it closes moved the depth.
  const open: (number | null)[] = [];
  let depth = 0;
  let untaggedLines = 0;
  let images = 0;

  walkBlocks(blocksOf(json), {
    enter: (block) => {
      const raw = str(field(block, 'raw'));
      if (str(field(block, 'type')) !== 'structure' || raw === SEGMENTATION_RAW_ROLE) {
        open.push(null);
        return;
      }
      found.push({ role: str(field(block, 'std')) ?? '', raw: raw ?? '', depth, lines: 0 });
      open.push(found.length - 1);
      depth += 1;
    },
    leave: () => {
      const closed = open.pop();
      if (closed !== null && closed !== undefined) depth -= 1;
    },
    image: () => {
      images += 1;
    },
    text: (_block, lines) => {
      // THE NEAREST OPEN ELEMENT owns the lines: a segmentation block between
      // them is walked through, not counted as a parent.
      let owner: number | undefined;
      for (let at = open.length - 1; at >= 0; at -= 1) {
        const index = open[at];
        if (index !== null && index !== undefined) {
          owner = index;
          break;
        }
      }
      const element = owner === undefined ? undefined : found[owner];
      if (element === undefined) untaggedLines += lines.length;
      else element.lines += lines.length;
    },
    grid: () => undefined,
  });

  return { nodes: found, untaggedLines, images };
}

/** One cell of a found table: the lines the engine moved into it, in its order. */
export interface TableCell {
  readonly lines: readonly TextLine[];
}

/** Which edges of a cell the engine found a ruling line on. */
export interface CellBorders {
  readonly top: boolean;
  readonly left: boolean;
  readonly bottom: boolean;
  readonly right: boolean;
}

/** One table `FZ_STEXT_TABLE_HUNT` found, as rows of cells. */
export interface PageTable {
  /** The engine's grid width, in columns. */
  readonly columns: number;
  /**
   * The engine's `TR` elements, each its `TD` elements, in the engine's order.
   *
   * **A spanning cell is ONE cell, and its row is shorter.** The engine decides
   * spans and writes them into each cell's box, and its JSON carries no box for a
   * structure element — so which grid columns a cell covers does not reach this
   * reader. Placing a cell by its text's position would be this build's rule for
   * something the engine already decided (B3a), so a row is its cells as given.
   */
  readonly rows: readonly (readonly TableCell[])[];
  /**
   * Each cell's ruled edges, from the grid's own flags — **only when every row has
   * exactly {@link columns} cells and there is one row per grid row**, which is
   * the one shape where a cell's place in its row IS its grid column. Otherwise
   * `null`, for {@link rows}' reason.
   */
  readonly borders: readonly (readonly CellBorders[])[] | null;
}

/** One page under the `table` read. */
export interface PageTables {
  readonly tables: readonly PageTable[];
  /** Every line on the page, inside a table or not — so *no table* and *no text* stay two answers. */
  readonly lines: number;
  /** Image blocks, for {@link PageText.images}' reason. */
  readonly images: number;
}

/** `FZ_STEXT_GRID_T_BORDER` and `FZ_STEXT_GRID_L_BORDER`, from `structured-text.h`. */
const GRID_TOP_BORDER = 8;
const GRID_LEFT_BORDER = 4;

/**
 * A grid block's cell flags as edges, or null where its shape is not the one the
 * table's rows imply.
 *
 * The flags hold one entry per grid POINT — `(rows + 1) × (columns + 1)` — each
 * naming the line along its cell's top and left, so a cell's bottom is the top of
 * the point below it and its right the left of the point beside it.
 */
function bordersOf(
  grid: RawNode,
  rows: readonly (readonly TableCell[])[],
  columns: number,
): readonly (readonly CellBorders[])[] | null {
  const height = num(field(grid, 'h'), -1);
  if (rows.length !== height || rows.some((row) => row.length !== columns)) return null;
  const flags = (nodes(field(grid, 'flags')) ?? []).map((row) =>
    (nodes(row) ?? []).map((value) => num(value, 0)),
  );
  if (flags.length !== height + 1 || flags.some((row) => row.length !== columns + 1)) return null;
  const at = (x: number, y: number, bit: number): boolean =>
    ((flags[y]?.[x] ?? 0) & bit) !== 0;
  return rows.map((row, y) =>
    row.map((_cell, x) => ({
      top: at(x, y, GRID_TOP_BORDER),
      left: at(x, y, GRID_LEFT_BORDER),
      bottom: at(x, y + 1, GRID_TOP_BORDER),
      right: at(x + 1, y, GRID_LEFT_BORDER),
    })),
  );
}

/**
 * MuPDF's structured-text JSON under the `table` read, as the tables it found.
 *
 * The third view over {@link walkBlocks}
 * ([ADR-0073](../../../docs/DECISIONS/0073-a-table-is-the-engines-table-read-asked-as-its-own-table-writer-asks.md)).
 * A table is the engine's `Table` element, a row its `TR`, a cell its `TD`; the
 * lines in a cell are the ones the engine moved there, reached through whatever
 * segmentation blocks it left between. Nothing here groups a line.
 *
 * @param json the payload from the engine's structured-text call under `table`
 * @throws for {@link parsePageText}'s reasons
 */
export function parsePageTables(json: string): PageTables {
  interface OpenTable {
    readonly kind: 'table';
    grid: RawNode | null;
    readonly rows: (readonly TableCell[])[];
  }
  interface OpenRow {
    readonly kind: 'row';
    readonly cells: TableCell[];
  }
  interface OpenCell {
    readonly kind: 'cell';
    readonly lines: TextLine[];
  }
  type Open = OpenTable | OpenRow | OpenCell | null;

  const tables: PageTable[] = [];
  const open: Open[] = [];
  let lines = 0;
  let images = 0;
  const nearest = <K extends 'table' | 'row' | 'cell'>(kind: K): Extract<Open, { kind: K }> | undefined => {
    for (let at = open.length - 1; at >= 0; at -= 1) {
      const entry = open[at];
      if (entry?.kind === kind) return entry as Extract<Open, { kind: K }>;
    }
    return undefined;
  };

  walkBlocks(blocksOf(json), {
    enter: (block) => {
      const role = str(field(block, 'type')) === 'structure' ? str(field(block, 'std')) : null;
      if (role === 'Table') open.push({ kind: 'table', grid: null, rows: [] });
      else if (role === 'TR') open.push({ kind: 'row', cells: [] });
      else if (role === 'TD') open.push({ kind: 'cell', lines: [] });
      else open.push(null);
    },
    leave: () => {
      const closed = open.pop();
      if (closed === null || closed === undefined) return;
      if (closed.kind === 'cell') nearest('row')?.cells.push({ lines: closed.lines });
      else if (closed.kind === 'row') nearest('table')?.rows.push(closed.cells);
      else {
        const columns = closed.grid === null ? 0 : num(field(closed.grid, 'w'), 0);
        tables.push({
          columns: Math.max(columns, ...closed.rows.map((row) => row.length)),
          rows: closed.rows,
          borders: closed.grid === null ? null : bordersOf(closed.grid, closed.rows, columns),
        });
      }
    },
    image: () => {
      images += 1;
    },
    text: (_block, found) => {
      lines += found.length;
      nearest('cell')?.lines.push(...found);
    },
    grid: (block) => {
      const table = nearest('table');
      if (table !== undefined) table.grid = block;
    },
  });

  return { tables, lines, images };
}
