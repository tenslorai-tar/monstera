import type { Apply, Capture, Invert } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { recordedSettings, removeMarks } from './pageMarks.js';
import { pageInDocument, pagesOf } from './pageScope.js';
import { PageStamps } from './pageStampDraw.js';

/**
 * Drawing a text watermark across pages, by the MuPDF writer in the text boxes' faces
 * ([ADR-0235](../../../docs/DECISIONS/0235-stamps-are-drawn-by-the-mupdf-writer-in-the-text-boxes-faces.md), the owner's
 * L3). It was the first command routed to the pdf-lib byte-image writer (ADR-0039), in three standard fonts; the words
 * are now set by `settersFor`, so every face the picker offers draws, and `PageStamps` appends the drawing.
 */

/**
 * The colour a watermark is drawn in where the command names none: the one colour every watermark had before ADR-0246
 * gave it a choice.
 *
 * A mid grey reads against white paper and against a dark scan, and it is not a
 * design token: tokens govern **components**, and this is content written into
 * a document that will be opened in other readers. `docs/ARCHITECTURE.md`
 * §10.2's rule is scoped to components in its own words, and CLAUDE.md's
 * digest carried a wider reading until 2026-08-31, which is the mistake this
 * comment exists to not repeat.
 */
const WATERMARK_GREY = 0.5;

/**
 * The height a watermark is centred by, as a share of its size: the em, which every face is designed on. pdf-lib's
 * `heightAtSize` was its standard fonts' ascent less descent; a catalogue face carries its own, and centring by each face's
 * would move the same words between families, which is the one thing a slanted watermark's centre should not do.
 */
const CENTRED_HEIGHT = 1;

/**
 * Capture — **which always refuses**, and cannot do anything else.
 *
 * `CommandPrior['watermarkPages']` is `never`, so `CaptureResult<never>` has no
 * constructible `{ captured: true }` member. The bus answers a refusal by taking a checkpoint, which ADR-0235 Decision 4
 * keeps: an inverse that restored `/Contents` would leave the faces and graphics states this added in the page's resources.
 */
export const captureWatermarkPages: Capture<'mupdf', 'watermarkPages'> = (_session, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a page that has been drawn on has no recordable prior state: restoring it means ' +
      'restoring its whole content stream, which is document-scaled and would be counted by ' +
      'nothing',
  });

/**
 * Invert — **unreachable by the type**, and present because the table's shape requires it: `CommandPrior['watermarkPages']`
 * is `never`, so nothing can construct an argument for the `inverse` parameter.
 */
export const invertWatermarkPages: Invert<'mupdf', 'watermarkPages'> = (_session, _inverse) => {
  throw new Error(
    'watermarkPages has no inverse and this is unreachable: its prior state is `never`, so no ' +
      'caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Draws the watermark.
 *
 * ## Centred on the page's own box, which is why no geometry crosses
 *
 * Each page is measured where it is drawn, so a document of mixed page sizes watermarks correctly with nothing per-page on
 * the wire. A position in the command would be a renderer-supplied coordinate, which invariant L3's branding exists to stop
 * travelling as a bare pair of numbers.
 *
 * ## Rotation is applied about the text's own centre
 *
 * Text turns about its origin, its baseline start, so a turned string drawn at the centred origin swings away from the
 * middle of the page. The origin is therefore offset by the turned half-extent, which puts the TEXT's centre on the
 * PAGE's centre for every angle. Drawing it at the unturned origin is the version that looks right at 0° and at nothing
 * else — and 0° is the angle a hurried fixture uses.
 *
 * ## Every page is validated, and placed, before anything is written
 *
 * A command naming one page this document does not have, or a page that displays nothing, must change nothing rather
 * than watermark the pages before it and then throw: this is a live session, so a throw half way would keep what was
 * drawn. `PageStamps` holds the drawing until `finish`.
 */
export const applyWatermarkPages: Apply<'mupdf', 'watermarkPages'> = (session, command) =>
  withDocument(session, (document) => {
    const total = document.countPages();
    const targets = pagesOf(command.pages, total);
    for (const page of targets) pageInDocument(page, total);

    const stamps = new PageStamps(document, command.family, { kind: 'watermark', settings: recordedSettings(command) });
    // EDIT (ADR-0246 Decision 3): the watermarks already there go in the same command, so one undo restores them.
    if (command.replace === true) removeMarks(document, 'watermark');
    const [r, g, b] = command.colour ?? [WATERMARK_GREY, WATERMARK_GREY, WATERMARK_GREY];
    const set = stamps.set(command.text, command.fontSize);
    const radians = (command.rotationDegrees * Math.PI) / 180;
    const halfWidth = set.width / 2;
    const halfHeight = (command.fontSize * CENTRED_HEIGHT) / 2;
    // THE TURNED HALF-EXTENT, so the TEXT's centre lands on the PAGE's centre. At 0° this is half the width and half the
    // height, which is why a fixture at 0° cannot tell a correct implementation from one that ignores the turn.
    const offsetX = halfWidth * Math.cos(radians) - halfHeight * Math.sin(radians);
    const offsetY = halfWidth * Math.sin(radians) + halfHeight * Math.cos(radians);

    for (const index of targets) {
      // THE PAGE AS THE READER SEES IT (CR-COR-01): the centre and the slant are the displayed page's.
      const { width, height } = stamps.frame(index).viewport;
      stamps.draw(index, set, command.fontSize, {
        x: width / 2 - offsetX,
        fromTop: height / 2 + offsetY,
        turn: command.rotationDegrees,
        colour: { r, g, b },
        opacity: command.opacity,
        artifact: 'Watermark',
      });
    }
    stamps.finish();
  });
