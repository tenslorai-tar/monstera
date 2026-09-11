import {
  type PDFDocument,
  PDFHexString,
  type PDFPage,
  type PDFRef,
  PDFString,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  toDegrees,
} from '@cantoo/pdf-lib';

import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { Apply, ByteImage, Invert } from './engineSeam.js';
import type { RecognisedLine } from './ocrRecognise.js';
import { openForWriting } from './pdfLibSession.js';

/**
 * The invisible text layer a recognition writes — and the font that carries it.
 *
 * `@cantoo/pdf-lib` is the writer of record for content composition (§3), so
 * this is the module that turns `ocrRecognise.ts`' answer into content. Nothing
 * here reads a document: the boxes arrive already in PDF user space, converted
 * once by the module that rasterised the page and holds both frames.
 *
 * ## THE FONT IS GRAFTED, AND THE ALTERNATIVE WAS MEASURED FIRST
 *
 * A text layer is drawn in **render mode 3**, so no glyph is ever painted and
 * every glyph outline in an embedded font file would be dead weight. What the
 * layer needs is the *other* half of a font — the map from the codes in the
 * content stream to Unicode — and that is a `/ToUnicode` CMap, not a typeface.
 *
 * Measured 2026-09-11, `scripts/research/textLayerFont.mjs`: drawn through
 * `StandardFonts.Helvetica` and read back through MuPDF, Cyrillic, Arabic,
 * Hebrew, Han, Devanagari **and the Latin ligature `U+FB01`** each come back as
 * `U+003F`. Nothing throws — 0 of 8 samples refused, 6 of 8 mangled — so the
 * naive layer claims to carry the page's words and carries question marks.
 *
 * `TessPDFRenderer` solves the same problem inside the package this build
 * already ships, with a **glyphless CID font**: a `CIDFontType2` with no
 * `/FontFile2`, `Identity-H` encoding, and an identity `/ToUnicode`. So the
 * decision was *graft that shape* or *adopt a Unicode font file*, and only the
 * second costs megabytes, a provisioning entry with a pinned digest, an
 * installer-budget line against the < 150 MB target, and a NOTICE entry
 * (`BUILD-PROMPT.md`:803-806). Graft was measured before it was chosen
 * (`scripts/research/glyphlessFont.mjs`) and **nothing new ships**.
 *
 * ## What the graft is worth, read back through the reader this build ships
 *
 * Eight samples, written by this module and read through MuPDF 1.28.0:
 * five **verbatim**, including the three scripts a standard font turns into
 * question marks; the two right-to-left samples come back with every codepoint
 * intact in **visual order**, which is MuPDF's bidi reordering of an RTL run and
 * not a loss; and `U+FB01` comes back decomposed to `f` `i`, which is MuPDF
 * normalising a ligature rather than substituting it.
 *
 * **The geometry round-trips exactly.** A word placed in the box
 * `[100, 500, 220, 522]` reads back at `{x: 100, y: 270, w: 120, h: 22}` — the
 * same box in MuPDF's y-down frame, to the point. That is what makes search and
 * selection over a recognised page land on the words rather than near them.
 *
 * ## A COMBINING MARK ADVANCES NOTHING, and the document has to say so
 *
 * Found by the Devanagari case, 2026-09-11. `मोन्स` came back whole and **as two
 * lines**, split between its fourth and fifth codepoints — which reads as lost
 * text in a line comparison and is not.
 *
 * The mechanism: a glyphless font has no glyph program, so a reader substitutes
 * one to measure with, and a substitute gives a combining mark **zero advance**.
 * With every code advancing the same amount in the content stream, MuPDF's idea
 * of where the fourth code ends was 51 points short of where the fifth actually
 * started, and its structured text splits a line on a gap that size. Every
 * script whose clusters carry marks is affected — Devanagari, Thai, vocalised
 * Arabic, Hebrew with niqqud, decomposed Latin — which is most of the set this
 * row exists for.
 *
 * The fix is for the font to **declare its own widths** rather than leave them
 * to whatever font the reader substituted: a `/W` array giving every Unicode
 * mark a width of zero, and a layout that advances only the codes that are not
 * marks. Measured in the same run: one line, `x: 72, w: 128` against a placed
 * box of `[72, …, 200, …]` — the box, exactly.
 *
 * **The ranges are derived from the platform, never typed out** (B3a). *Is this
 * character a combining mark* is Unicode's question and `\p{M}` is the answer
 * the runtime already holds; a hand-kept table would be a second opinion that
 * agreed for the scripts somebody tested.
 *
 * ## Per WORD, not per line, and MuPDF puts the line back together
 *
 * Each word is placed at its own box, which is where its geometry is. Measured
 * in the same run: two words at separate boxes come back as one line reading
 * `"Monstera deliciosa"` — MuPDF synthesises the space from the gap — with the
 * line's bbox spanning both words. So writing words costs nothing in line
 * fidelity and buys per-word geometry, which is what
 * [ADR-0042](../../../docs/DECISIONS/0042-a-gesture-may-span-several-presses-and-the-tool-says-when-it-is-complete.md)'s
 * region work and `searchHighlight.ts` need.
 */

/**
 * The font's name, in the document and in its resource key.
 *
 * **Ours rather than Tesseract's `GlyphLessFont`.** The shape is grafted; the
 * object is written here, and a name claiming to be another tool's font would
 * make provenance unreadable the day one of them changes.
 */
export const GLYPHLESS_FONT_NAME = 'MonsteraGlyphless';

/**
 * Every code's advance, in thousandths of the font size.
 *
 * `/DW 1000` means one code advances exactly the font size, so a run's natural
 * width is `codes × size` and the horizontal squeeze that fits it to a measured
 * box is arithmetic rather than a font metric. A real font's widths would make
 * that fit depend on which glyphs the word contains — which is a text layer
 * whose boxes drift from the image underneath it, word by word.
 */
const GLYPH_ADVANCE = 1000;

/**
 * An identity `/ToUnicode` CMap over the whole BMP.
 *
 * `<0000> <FFFF> <0000>` as a single `bfrange` says *code n means `U+n`*, which
 * is what lets the codes in the content stream be the characters themselves and
 * removes the per-document mapping table a non-identity encoding would need.
 *
 * **This stream is what makes the layer readable, measured rather than
 * assumed.** With it removed and everything else held fixed (2026-09-11, same
 * run): Latin comes back as `6a e7 e5 eb ed c9 ea 7e` — a substituted font's
 * glyph indices read as characters — and Cyrillic, Arabic and Han each come back
 * as `U+FFFD`. So the failure without it is *wrong characters*, not *no
 * characters*, which is the quieter direction and the reason the control asserts
 * a difference rather than an absence.
 */
const TO_UNICODE_CMAP = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<0000> <FFFF>',
  'endcodespacerange',
  '1 beginbfrange',
  '<0000> <FFFF> <0000>',
  'endbfrange',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end',
].join('\n');

/** Whether a character advances the text position at all. */
const MARK = /\p{M}/u;

/**
 * The `/W` entries that give every Unicode mark a width of zero.
 *
 * `c_first c_last w` triples over the BMP, collapsed from `\p{M}` — **190 ranges,
 * 570 numbers, about 2.4 KB of content before the save compresses it** (measured
 * 2026-09-11). Computed once, on the first recognised document in the process:
 * 65,536 property tests is immaterial beside the 3.8–4.4 s the recognition that
 * produced the text took.
 *
 * Above the BMP is deliberately absent rather than silently included: a code
 * there is written as a surrogate pair, and neither half is a mark, so an astral
 * mark advances twice — the stated limit {@link codesOf} carries, on a class
 * Tesseract's fourteen provisioned models do not answer.
 */
let markWidths: readonly number[] | null = null;

function zeroWidthMarks(): readonly number[] {
  if (markWidths !== null) return markWidths;
  const entries: number[] = [];
  let start = -1;
  for (let code = 0; code <= 0xffff; code += 1) {
    const mark = MARK.test(String.fromCharCode(code));
    if (mark && start === -1) start = code;
    if (!mark && start !== -1) {
      entries.push(start, code - 1, 0);
      start = -1;
    }
  }
  if (start !== -1) entries.push(start, 0xffff, 0);
  markWidths = entries;
  return entries;
}

/**
 * Registers the glyphless font in a document and answers the reference.
 *
 * **Once per document, by the caller.** Calling this twice registers two
 * identical fonts, which is a document that grew for nothing — so the command
 * holds the reference and hands it to every page it writes.
 *
 * The `/FontDescriptor` carries the members the format requires of a
 * `CIDFontType2` and no more. `/Flags 5` is symbolic plus fixed-pitch, which is
 * the truthful description of a font whose every code advances the same amount
 * and whose characters are not Latin text in any particular encoding.
 */
export function glyphlessFont(document: PDFDocument): PDFRef {
  const context = document.context;
  const descriptor = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: GLYPHLESS_FONT_NAME,
      Flags: 5,
      FontBBox: [0, 0, GLYPH_ADVANCE, GLYPH_ADVANCE],
      ItalicAngle: 0,
      Ascent: GLYPH_ADVANCE,
      Descent: 0,
      CapHeight: GLYPH_ADVANCE,
      StemV: 80,
    }),
  );
  const descendant = context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: GLYPHLESS_FONT_NAME,
      // LITERAL STRINGS, not hex. Written as hex strings, MuPDF 1.28.0 reports
      // `unknown cid collection` on every page — it reads the registry and
      // ordering to decide what the CIDs mean, and a hex-encoded `Adobe` is not
      // the name it matches. Measured by making exactly that substitution.
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Identity'),
        Supplement: 0,
      },
      FontDescriptor: descriptor,
      DW: GLYPH_ADVANCE,
      // THE WIDTHS THE DOCUMENT DECLARES, so where a character ends is this
      // font's answer and not a substituted font's. See `zeroWidthMarks`.
      W: zeroWidthMarks(),
      CIDToGIDMap: 'Identity',
    }),
  );
  return context.register(
    context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: GLYPHLESS_FONT_NAME,
      Encoding: 'Identity-H',
      DescendantFonts: [descendant],
      ToUnicode: context.register(context.flateStream(TO_UNICODE_CMAP)),
    }),
  );
}

/**
 * The codes for one run: the string's own UTF-16 units, big-endian.
 *
 * `Identity-H` makes a code two bytes and {@link TO_UNICODE_CMAP} maps each to
 * itself, so the content stream carries the text verbatim and there is no
 * encoding table to get wrong.
 *
 * **A character outside the BMP is written as its surrogate pair**, which is
 * what UTF-16 units are. The codes are then two, each mapping to a surrogate,
 * and whether a reader recombines them is the reader's. Tesseract's models for
 * the fourteen provisioned languages answer BMP characters, so this is a stated
 * limit rather than a measured loss.
 */
function codesOf(text: string): string {
  let hex = '';
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return hex;
}

/**
 * How many of a run's codes move the text position.
 *
 * The squeeze that fits a run to its box is computed from this rather than from
 * the string's length, because {@link zeroWidthMarks} declares a mark's width as
 * zero — so a run counted by codes would be laid out wider than the font says it
 * is, which is the gap MuPDF splits a line on.
 */
function advancingCodes(text: string): number {
  let advancing = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!MARK.test(text.charAt(index))) advancing += 1;
  }
  return advancing;
}

/** One run of text and the box it must occupy, in PDF user space. */
interface PlacedRun {
  readonly text: string;
  readonly box: readonly [number, number, number, number];
}

/**
 * The runs a recognition answers, one per word — or per line where a line
 * carries no words.
 *
 * A line without words is rare and real: Tesseract answers a line box and an
 * empty word list for a run it segmented but could not split. Dropping those
 * would lose text from the layer silently, which is the defect this whole module
 * exists to avoid, so the line's own box carries its text instead.
 */
function runsOf(lines: readonly RecognisedLine[]): readonly PlacedRun[] {
  const runs: PlacedRun[] = [];
  for (const line of lines) {
    if (line.words.length === 0) {
      runs.push({ text: line.text, box: line.box });
      continue;
    }
    for (const word of line.words) runs.push({ text: word.text, box: word.box });
  }
  return runs;
}

/**
 * How a run sits on a page with a `/Rotate`, as one entry per legal value.
 *
 * ## Why a table and not a general matrix
 *
 * A recognition's boxes are in **PDF user space** and the words it read are
 * upright in **display** space, which are the same thing only on an unrotated
 * page. Writing a horizontal run on a page rotated 90° puts invisible text
 * across the visible text: the reader's selection, and the search highlight
 * `searchHighlight.ts` computes from the text layer, would both be a rectangle at
 * right angles to the words.
 *
 * So the run is rotated by the page's own `/Rotate`, which PDF 32000-1 §7.7.3.3
 * constrains to a multiple of 90 — four values, four entries, each derived once:
 *
 * | `/Rotate` | the run starts at | advances along | `a b c d` |
 * |---|---|---|---|
 * | 0 | `(x0, y0)` | user +x | `1 0 0 1` |
 * | 90 | `(x1, y0)` | user +y | `0 1 -1 0` |
 * | 180 | `(x1, y1)` | user −x | `-1 0 0 -1` |
 * | 270 | `(x0, y1)` | user −y | `0 -1 1 0` |
 *
 * Each origin is the box corner that MuPDF's page transform takes to the
 * **display** box's bottom-left, and each matrix is that rotation. A general
 * matrix was the alternative and is worse here: the page transform lives in
 * `ocrRecognise.ts` beside the engine that owns it, this module runs in main with
 * pdf-lib and no MuPDF, and four rows that a round trip asserts one by one are
 * checkable in a way a reconstructed matrix is not.
 *
 * **`/Rotate` is also why the size and the squeeze swap.** They are the run's
 * display height and width, and on a quarter-turned page those are the user
 * box's width and height.
 */
const ROTATED_RUN = {
  0: { corner: [0, 1] as const, matrix: [1, 0, 0, 1] as const, turned: false },
  90: { corner: [2, 1] as const, matrix: [0, 1, -1, 0] as const, turned: true },
  180: { corner: [2, 3] as const, matrix: [-1, 0, 0, -1] as const, turned: false },
  270: { corner: [0, 3] as const, matrix: [0, -1, 1, 0] as const, turned: true },
};

/** A page's `/Rotate` as one of the four the table above has an entry for. */
function quarterTurn(page: PDFPage): keyof typeof ROTATED_RUN {
  // NORMALISED RATHER THAN TRUSTED: `/Rotate` may be negative or beyond 360 —
  // `-90` is a legal spelling of 270 — and a value that is not a multiple of 90
  // is a malformed page every reader rounds. `Math.round` over quarter turns is
  // that rounding, in the one place this module needs the answer.
  const quarters = ((Math.round(toDegrees(page.getRotation()) / 90) % 4) + 4) % 4;
  return ([0, 90, 180, 270] as const)[quarters] ?? 0;
}

/**
 * Draws a recognition onto one page as invisible, selectable text.
 *
 * ## Nothing is painted, by the text rendering mode rather than by a colour
 *
 * `3 Tr` is *neither fill nor stroke*. A white fill would be invisible on a
 * white page and a grey smear on a scan, and it would print.
 *
 * ## Each run is fitted to its own box, and the fit is exact by construction
 *
 * The font size is the box's **height** and the horizontal squeeze is the box's
 * width over the run's natural width, so the run starts at the box's left edge
 * and ends at its right one. `/DW 1000` is what makes that arithmetic true for
 * every script (see {@link GLYPH_ADVANCE}).
 *
 * A run whose box has no area, or which advances nothing — empty text, or text
 * that is only combining marks — is **skipped rather than clamped**: the squeeze
 * is a division by the advancing code count, and a run placed at a degenerate box
 * is text the reader can never select. Both are counted out of the return value,
 * so a caller that wrote nothing can tell.
 *
 * @returns how many runs were drawn.
 */
export function writeRecognisedText(
  page: PDFPage,
  font: PDFRef,
  lines: readonly RecognisedLine[],
): number {
  const runs = runsOf(lines).filter(
    (run) =>
      advancingCodes(run.text) > 0 && run.box[2] > run.box[0] && run.box[3] > run.box[1],
  );
  if (runs.length === 0) return 0;

  // THE RESOURCE KEY IS THE PAGE'S TO CHOOSE. `newFontDictionary` asks the
  // page's own resource dictionary for an unused key, so a document whose pages
  // already carry fonts cannot have one shadowed by this one — and it
  // normalises the page's existing content streams into an array wrapped in
  // `q`/`Q` on the way, which is what keeps an unbalanced prior stream from
  // transforming what this appends.
  const name = page.node.newFontDictionary(GLYPHLESS_FONT_NAME, font);

  const operators = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];
  const turn = ROTATED_RUN[quarterTurn(page)];
  const [a, b, c, d] = turn.matrix;
  const [originX, originY] = turn.corner;
  for (const run of runs) {
    // THE RUN'S DISPLAY WIDTH AND HEIGHT, which are the box's the other way round
    // on a quarter-turned page (see {@link ROTATED_RUN}).
    const across = turn.turned ? run.box[3] - run.box[1] : run.box[2] - run.box[0];
    const size = turn.turned ? run.box[2] - run.box[0] : run.box[3] - run.box[1];
    const squeeze = (across / (advancingCodes(run.text) * size)) * 100;
    operators.push(
      setFontAndSize(name, size),
      setCharacterSqueeze(squeeze),
      // AN ABSOLUTE TEXT MATRIX per run, never a relative move. `Td` is relative
      // to the line matrix, so one wrong offset would shift every run after it —
      // and the boxes this is given are absolute, so translating them into
      // offsets is arithmetic with nothing to check it against.
      setTextMatrix(a, b, c, d, run.box[originX], run.box[originY]),
      showText(PDFHexString.of(codesOf(run.text))),
    );
  }
  operators.push(endText(), popGraphicsState());
  page.pushOperators(...operators);
  return runs.length;
}

/**
 * Capture — **refuses, with the reason §4 reserved a checkpoint for**.
 *
 * `captureWatermarkPages`' shape and very nearly its words: restoring a page that
 * has been drawn on means restoring its whole content stream, and a byte-image
 * writer consumes an image and answers one, so there is no handle to the objects
 * the apply added. §4's reserved list is redaction, flatten, encryption and
 * **OCR**.
 */
export const captureOcrPage: (
  image: ByteImage,
  command: CommandOfKind<'ocrPage'>,
) => Promise<CaptureResult<never>> = (_image, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a page that has gained a text layer has no recordable prior state: restoring it means ' +
      'restoring its content streams and its font resources, which is document-scaled — and §4 ' +
      'reserves a checkpoint for OCR by name',
  });

/**
 * Invert — **unreachable by the type**, and present because the table's shape
 * requires it.
 *
 * `CommandPrior['ocrPage']` is `never`, so nothing can construct an argument for
 * the `inverse` parameter. `invertWatermarkPages` is the same shape for the same
 * reason; the throw is what a function with an uninhabited parameter has instead
 * of a body.
 */
export const invertOcrPage: Invert<'pdf-lib', 'ocrPage'> = (_image, _inverse) => {
  throw new Error(
    'ocrPage has no inverse and this is unreachable: its prior state is `never`, so no caller ' +
      'can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Writes one page's recognised text into that page, and answers the new document.
 *
 * ## The recognition arrives as a PRE-READ, which is the whole of ADR-0051
 *
 * A byte-image apply holds no engine session, and the recognition is MuPDF's
 * raster read through Tesseract **inside the engine host**. So the bus resolves it
 * from the declaration's own expression and hands it in — and the third parameter
 * is not optional in this signature, which is what `Apply`'s generalised `reads`
 * branch buys.
 *
 * ## It writes what it is given, and does not second-guess the page
 *
 * No check that the page is image-only. *What is this page made of* is
 * `pageKindOf`'s answer and the **surface** is what reads it — the scope offered
 * is the detector's set — so a check here would be a second opinion about a
 * question row 1 already owns (B3a). It would also foreclose the region row,
 * which recognises a rectangle on a page that may be full of text.
 *
 * A recognition with no lines writes nothing and the document comes back
 * unchanged, which is the truthful outcome rather than a refusal: a page
 * Tesseract read as empty **is** a page with no text to add, and the bus has
 * already taken a checkpoint either way.
 */
export const applyOcrPage: Apply<'pdf-lib', 'ocrPage', 'none', 'ocr'> = async (
  image,
  command,
  read,
) => {
  const document = await openForWriting(image);
  const pages = document.getPages();
  const page = pages[command.page];
  if (page === undefined) {
    throw new RangeError(
      `Page ${String(command.page)} is outside this document, which has ` +
        `${String(pages.length)} page(s). Page indices are zero-based.`,
    );
  }

  // THE RECOGNITION'S OWN LANGUAGE IS ASSERTED AGAINST THE COMMAND'S, because the
  // two arrive by different routes: the command carries what was asked for and the
  // answer echoes what the model was. A mismatch means the pre-read resolved a
  // request this command did not make, which is a wiring defect and not a
  // document's fault — so it throws rather than writing text from the wrong model.
  if (read.language !== command.language) {
    throw new Error(
      `the recognition handed to ocrPage was read with ${read.language} and the command asked ` +
        `for ${command.language}. A pre-read that answers a different request than the command ` +
        'made is a resolver defect; nothing about the document can cause it.',
    );
  }

  writeRecognisedText(page, glyphlessFont(document), read.lines);
  return document.save();
};
