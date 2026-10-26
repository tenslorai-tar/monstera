import type { BlockFormatting, EditedBlock, FormPath, PageInsert, WindowEditAction } from '@monstera/contract';
import { type DocVersion, newTextBox, pdfPoint, toPdf, toViewport, viewportPoint } from '@monstera/shared';

import { type OverlayPage, overlayTransform } from '../annotations/annotationSpace.js';
import type { BlockCommit, BlocksRead, PageBlocksRead, RunFonts } from '../commands/documentCommands.js';
import type { EditorSpelling } from '../editorKit/EditorMenu.js';
import type { TextBlock } from '../textBlock.js';
import type { FaceKind } from './runFaces.js';

/**
 * What Edit text's pages share: the read a page's blocks arrive as, what the mode hands each page, and the pure rules
 * about a block's place on the page that the layer and its tests both take.
 */

/** One page's blocks, stamped with the version the read answered at and the writer it named. */
export interface PageBlocks extends BlocksRead {
  readonly blocks: readonly TextBlock[];
  readonly truncated: boolean;
  readonly rotated: number;
  /** `rotated` by kind, which the note names (ADR-0181 Decision 7). */
  readonly angled: { readonly turned: number; readonly vertical: number; readonly slanted: number; readonly mirrored: number };
  readonly unaddressable: number;
}

/** What the mode hands each page: where blocks come from and where an edit goes. */
export interface TextEditing {
  /** Which of the page list's two modes this is (ADR-0153 Decision 1). */
  readonly mode: 'text';
  /** The document version on screen; a new one is a new read. */
  readonly version: DocVersion;
  /** Reads one page's blocks, or `undefined` where the read was refused. */
  readonly read: (page: number) => Promise<PageBlocks | undefined>;
  readonly onCommit: (page: number, block: TextBlock, text: string, read: PageBlocksRead, formatting?: BlockFormatting) => Promise<BlockCommit>;
  /** The fonts one block's runs are drawn in, as the host rebuilt them, from the read that named the block (ADR-0175, ADR-0232). */
  readonly runFonts: (page: number, block: TextBlock, read: BlocksRead) => Promise<RunFonts>;
  /** Recognises a page that has no text (the one `document.ocr` command), so a scan's words can be edited. */
  readonly onRecognise: (page: number) => void;
  readonly onLeave: () => void;
  /** Whether a press on the empty page opens a box of new text: Edit text's ADD flavour (ADR-0180 Decision 6). */
  readonly adding: boolean;
  /** Adds a box of new text to a page. */
  readonly onInsert: (page: number, insert: PageInsert, read: BlocksRead) => Promise<BlockCommit>;
  /** A box was added or abandoned: back to editing what is on the page. */
  readonly onAdded: () => void;
  /** The browser's own edit verbs, run by main on the window. */
  readonly native: (action: WindowEditAction) => void;
  /** The spelling checker's answers for the editor's right-click menu. */
  readonly spell: EditorSpelling;
  /** Writes blocks joined or split, in one command; `kept` where a join set words in the upper block's family. */
  readonly onRestructure: (page: number, edits: EditedBlock[], read: BlocksRead, form: FormPath | null, kept?: boolean) => Promise<BlockCommit>;
  /** The family each page font name stands for (`listedFamiliesFor`), for a join to carry the lower block's. */
  readonly familiesOf?: () => Promise<(font: string) => string | undefined>;
  /**
   * The boxes of a page's pictures and drawings (everything but text, which the blocks are), at the version they were
   * read, for the note that a written block now runs over one (B1.6); `undefined` where the read was refused.
   */
  readonly objects: (page: number) => Promise<{ readonly version: DocVersion; readonly boxes: readonly TextBlock['box'][] } | undefined>;
  /** The kind of face a letter is drawn in where nothing closer is known (`editing.fallback-face`); sans where absent. */
  readonly fallbackFace?: FaceKind;
}

/** A box in the overlay's CSS pixels, and the turn the page is drawn at. */
export interface Placed {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/**
 * Where a PDF box lands on the drawn page: the box's top-left IN PDF SPACE is placed, and the width and height are the
 * box's own at the zoom; a page drawn turned is then turned by CSS about that corner, so the editor's text runs the way
 * the page's does. Placing the four corners' bounding box instead would give a rotated page a box of the right size
 * holding text that reads the wrong way.
 */
export function place(box: TextBlock['box'], geometry: OverlayPage): Placed {
  const corner = toViewport(pdfPoint(box.x0, box.y1), overlayTransform(geometry));
  return {
    left: corner.x,
    top: corner.y,
    width: (box.x1 - box.x0) * geometry.zoom,
    height: (box.y1 - box.y0) * geometry.zoom,
    rotation: geometry.rotation,
  };
}

/** The CSS a placed box is drawn with. */
export function boxStyle(placed: Placed): { left: number; top: number; width: number; height: number; transform?: string } {
  return {
    left: placed.left,
    top: placed.top,
    width: placed.width,
    height: placed.height,
    ...(placed.rotation === 0 ? {} : { transform: `rotate(${String(placed.rotation)}deg)` }),
  };
}

/**
 * How far, in points, a block's ink may cross the page's edge before it is said not to fit: a quarter of a point, under
 * anything a reader sees and over the rounding of a glyph's box set flush against the edge.
 */
const PAGE_EDGE_TOLERANCE = 0.25;

/**
 * Whether a block's words run past the page's visible box, so some of them are written and cannot be seen (the owner's
 * Q7). Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build: a block typed past the foot of the page is saved whole
 * and PDFium's reading answers every line, its box reaching below the page, while MuPDF's reading of the same bytes drops
 * the lines past the edge, so the read this layer outlines is the one that can see them.
 */
export function pastItsPage(box: TextBlock['box'], crop: OverlayPage['crop']): boolean {
  const [x0, y0, x1, y1] = crop;
  return (
    box.x0 < x0 - PAGE_EDGE_TOLERANCE || box.y0 < y0 - PAGE_EDGE_TOLERANCE || box.x1 > x1 + PAGE_EDGE_TOLERANCE || box.y1 > y1 + PAGE_EDGE_TOLERANCE
  );
}

/**
 * Whether two boxes share any area: how a new read finds the block a write grew. Its first line stays where it was and
 * the rest grows down, so the new block covers the old one's top; a corner is not enough, since a box is its glyphs' ink
 * and a first line that gains a capital or an accent moves its own top.
 */
export function overlaps(a: TextBlock['box'], b: TextBlock['box']): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * How many of `others` a block grown from `before` to `after` now covers that it did not cover before (B1.6). A thing the
 * block already lay over is not counted: only what the growth reached. The block itself is not among `others`.
 */
export function newlyCovered(before: TextBlock['box'], after: TextBlock['box'], others: readonly TextBlock['box'][]): number {
  return others.filter((box) => overlaps(after, box) && !overlaps(before, box)).length;
}

/** The distinct names of the fonts a page's blocks are drawn in, in reading order: the picker's *In this document*. */
export function fontsOfPage(blocks: readonly TextBlock[]): string[] {
  const names = new Set<string>();
  for (const block of blocks) {
    for (const line of block.lines) for (const run of line.runs) if (run.style.font !== undefined) names.add(run.style.font);
  }
  return [...names];
}

/** The style a new box's words start in on a page with none. */
const NEW_TEXT_STYLE: TextBlock['style'] = { size: 12, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };

/** A box of new text as the editor opens it: a synthetic block holding one empty run, and where it goes on the page. */
export interface FreshBox {
  readonly block: TextBlock;
  readonly left: number;
  readonly baseline: number;
  readonly measure: number;
}

/**
 * The style of the block nearest a point of the page (the owner's B4.3: added text picks up the nearby font, size and
 * colour), by the distance from the point to each block's box, which is nothing inside one. `undefined` on a page with
 * no block, where the new words take {@link NEW_TEXT_STYLE}.
 */
export function nearbyStyle(blocks: readonly TextBlock[], at: { readonly x: number; readonly y: number }): TextBlock['style'] | undefined {
  let nearest: { style: TextBlock['style']; far: number } | undefined;
  for (const block of blocks) {
    const dx = Math.max(block.box.x0 - at.x, 0, at.x - block.box.x1);
    const dy = Math.max(block.box.y0 - at.y, 0, at.y - block.box.y1);
    const far = Math.hypot(dx, dy);
    if (nearest === undefined || far < nearest.far) nearest = { style: block.style, far };
  }
  return nearest?.style;
}

/**
 * The family a block's class reads as, for an added box's `base`: the block read names its words' kind and not their
 * font, so the class's standard family is what the resolver is asked for where the page names no font.
 */
function familyOfClass(style: TextBlock['style']): string {
  return style.mono ? 'Courier New' : style.serif ? 'Times New Roman' : 'Arial';
}

/**
 * The box a press at `css` (the layer's pixels) begins: its top left where the person pressed, the measure the page's
 * margin leaves it and a first baseline one ascent below its top, in the style of the nearest words on the page. The block
 * it is drawn as has a run no page holds (index 0 names no object: a box is written by its words alone).
 */
export function freshBox(css: { readonly x: number; readonly y: number }, geometry: OverlayPage, blocks: readonly TextBlock[]): FreshBox {
  const [x0, y0, x1, y1] = geometry.crop;
  const at = toPdf(viewportPoint(css.x, css.y), overlayTransform(geometry));
  const style = nearbyStyle(blocks, at) ?? NEW_TEXT_STYLE;
  // THE WHOLE BOX ON THE PAGE, at every turn (`newTextBox`, the one rule the kernel's proof takes too).
  const { left, measure, top, baseline, bottom } = newTextBox(at, { x0, y0, x1, y1 }, style.size);
  const box = { x0: left, y0: bottom, x1: left + measure, y1: top };
  return {
    block: {
      box,
      lines: [{ runs: [{ index: 0, text: '', style }], box, soft: false, baseline }],
      style,
      shape: { align: 'left', firstIndent: 0 },
    },
    left,
    baseline,
    measure,
  };
}

/** The wire's box from what the editor says of it: its words, with the marks and paragraph settings the person gave them. */
export function insertOf(made: FreshBox, text: string, formatting: BlockFormatting): PageInsert {
  const { style } = made.block;
  return {
    left: made.left,
    baseline: made.baseline,
    measure: made.measure,
    size: style.size,
    // THE STYLE THE BOX OPENED IN, the nearby words' (B4.3): the font by the run's own name where the read gave one.
    base: { family: style.font ?? familyOfClass(style), bold: style.bold, italic: style.italic, colour: style.colour },
    text,
    ...(formatting.marks === undefined ? {} : { marks: [...formatting.marks] }),
    ...(formatting.paragraphs === undefined ? {} : { paragraphs: [...formatting.paragraphs] }),
  };
}
