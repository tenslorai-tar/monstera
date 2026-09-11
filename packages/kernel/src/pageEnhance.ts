import type { CommandOfKind } from '@monstera/contract';
import * as mupdf from 'mupdf';
import type { PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { pagesOf } from './pageScope.js';
import { otsu } from './pageSkew.js';

/**
 * Enhancing a scan: the page's own image, levelled from its own histogram.
 *
 * ## THE CODEC THIS ROW WAITED FOR WAS ALREADY HERE, measured 2026-09-11
 *
 * `docs/FEATURES.md`' enhance-scans row was deferred to Stage 6 on one premise —
 * *this needs a decoder and an encoder for whatever that image is, and this build
 * has neither* — with a correction a day later saying `sharp` is in the
 * devDependencies and reaching for it is a promotion plus a native-addon packaging
 * decision. Both readings were wrong about the engine that ships, and the premise
 * is withdrawn rather than worked around:
 *
 * | what the row said was missing | what the shipped MuPDF does |
 * |---|---|
 * | a decoder for the embedded image | `new Image(obj.readRawStream()).toPixmap()` — measured at 600×800, 1 component, 8 bpc |
 * | an encoder to put it back | `Pixmap.asJPEG()`, and `PDFObject.writeRawStream` replaces the stream |
 * | a round trip that survives a save | read back **from the saved bytes**: same size, the changed pixel |
 *
 * So nothing is promoted. **And promoting `sharp` would not have closed the row
 * anyway**, which is the part worth keeping: it decodes JPEG, PNG, TIFF and WebP —
 * the same JPEG MuPDF already decodes — and it does not decode `/CCITTFaxDecode`
 * or `/JBIG2Decode`, which are the filters a 1-bit fax scan actually uses. The
 * promotion would have bought a second decoder for the easy case and still failed
 * the hard one.
 *
 * ## LEVELS, not binarisation, and the choice is about photographs
 *
 * The operation is a greyscale conversion and a contrast stretch anchored on
 * **Otsu's two class means** — both derived from the image's own histogram, so
 * there is no tunable in it (`pageSkew.ts` owns that split; this is its second
 * caller). A scan's grey paper goes white and its ink goes black.
 *
 * Binarisation was the obvious alternative and is refused on the set this command
 * is offered over: `pageKindOf` answers `'image-only'` for *a raster and no text*,
 * which is a scanned page **and a photograph and a full-page diagram** — the row
 * that named those three states said so for this reason. A threshold improves the
 * first and destroys the other two; a levels pass improves the first and leaves the
 * others recognisable.
 *
 * ## What it REFUSES, per image, and counts
 *
 * An image this engine cannot build a standalone `Image` from — raw samples behind
 * `/FlateDecode`, a fax behind `/CCITTFaxDecode`, a stencil `/ImageMask`, or one
 * carrying an `/SMask` whose transparency a re-encode would strip — is **skipped
 * and counted**, not thrown on and not silently mangled. The count is what the
 * surface reports, because *nothing changed* and *this page's image is a kind I
 * cannot read* are different answers and a user meeting the second one deserves it.
 */

/**
 * How hard the re-encode compresses.
 *
 * **90, and the number is a decision rather than a measurement**: an enhancement
 * pass must not be the thing that degrades the scan, and a JPEG re-encode is
 * generational loss whatever the quality. High enough to be visually lossless on
 * text, low enough that a levelled page does not grow. The source's own quality is
 * not discoverable from a decoded pixmap, so *keep what it had* is not available.
 */
const JPEG_QUALITY = 90;

/** What one page's enhancement did. */
export interface EnhancedPage {
  readonly page: number;
  /** How many image XObjects were levelled. */
  readonly enhanced: number;
  /** How many were left alone because this engine cannot round-trip them. */
  readonly skipped: number;
}

/**
 * The image XObjects a page's resources name, with their keys.
 *
 * Resources are inheritable, and this reads the page's **resolved** dictionary for
 * `pageBoxes.ts`' reason one key along: a page that inherits its resources from the
 * pages tree has images, and a reader that only looked at the page's own
 * dictionary would report it as having none.
 */
function imagesOf(page: PDFObject): readonly { readonly key: string; readonly object: PDFObject }[] {
  const resources = page.getInheritable('Resources');
  if (!resources.isDictionary()) return [];
  const xobjects = resources.get('XObject');
  if (!xobjects.isDictionary()) return [];
  const found: { key: string; object: PDFObject }[] = [];
  xobjects.forEach((value, key) => {
    if (String(value.get('Subtype')) === '/Image') found.push({ key: String(key), object: value });
  });
  return found;
}

/**
 * Whether this engine can round-trip the image, asked of the OBJECT before any
 * decoding is attempted.
 *
 * Two of the three are properties a re-encode would destroy rather than fail on,
 * which is why they are refused here rather than left to throw: a stencil mask has
 * no greys to level, and an image with a soft mask carries its transparency in a
 * second stream that a replaced base would no longer agree with.
 */
function roundTrippable(object: PDFObject): boolean {
  if (object.get('ImageMask').asBoolean()) return false;
  if (!object.get('SMask').isNull()) return false;
  return !object.get('Mask').isNull() ? false : true;
}

/**
 * Levels one image in place, or answers `false` where this engine cannot.
 *
 * The decode is `new Image(raw)`, which needs the stream's bytes to be a format
 * MuPDF recognises on their own — true of `/DCTDecode` and `/JPXDecode`, false of
 * raw samples behind `/FlateDecode`. That refusal arrives as a throw from the
 * engine, so it is caught here and reported as a skip: this is a property of the
 * document rather than a defect.
 */
function level(object: PDFObject): boolean {
  if (!roundTrippable(object)) return false;

  let pixmap;
  try {
    const raw = object.readRawStream();
    const image = new mupdf.Image(raw);
    pixmap = image.toPixmap();
  } catch {
    return false;
  }

  try {
    // GREY FIRST, so the histogram is over one channel and the stretch cannot
    // shift a colour cast. A scan's information is its ink.
    const grey =
      pixmap.getNumberOfComponents() === 1
        ? pixmap
        : pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceGray, true);
    const samples = grey.getPixels();
    const threshold = otsu(samples);
    const { dark, light } = classMeans(samples, threshold);
    // A HISTOGRAM WITH NO SPREAD IS LEFT ALONE rather than stretched by a
    // division by something near zero: a blank page and a solid black one both
    // arrive here, and both are already as levelled as they can be.
    if (light - dark < 1) return false;

    const scale = 255 / (light - dark);
    for (let index = 0; index < samples.length; index += 1) {
      const value = ((samples[index] ?? 0) - dark) * scale;
      samples[index] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
    }

    const encoded = new Uint8Array(grey.asJPEG(JPEG_QUALITY, false));
    object.writeRawStream(encoded);
    // THE DICTIONARY HAS TO AGREE WITH THE BYTES. The stream is now one-component
    // DCT data whatever it was before, so the colour space, the component depth and
    // the filter are restated and `/DecodeParms` — which described the old filter's
    // parameters — is removed. A left-behind `/DecodeParms` is how a correct stream
    // renders as noise.
    object.put('Filter', 'DCTDecode');
    object.put('ColorSpace', 'DeviceGray');
    object.put('BitsPerComponent', 8);
    object.put('Width', grey.getWidth());
    object.put('Height', grey.getHeight());
    object.delete('DecodeParms');
    object.delete('Decode');
    return true;
  } finally {
    pixmap.destroy();
  }
}

/**
 * Otsu's two class means — the dark level and the light level, both derived.
 *
 * The means rather than the extremes, which is what makes this robust without a
 * percentile: one black speck on a white page pins a minimum, and a single
 * blown-out pixel pins a maximum, where a class mean moves only with the class.
 */
function classMeans(
  // `Uint8ClampedArray` IS WHAT A PIXMAP ANSWERS, and the union is stated rather
  // than cast: `otsu` takes the same pair for the same reason, and `pageSkew`'s own
  // raster is a plain `Uint8Array`.
  samples: Uint8Array | Uint8ClampedArray,
  threshold: number,
): { readonly dark: number; readonly light: number } {
  let darkSum = 0;
  let darkCount = 0;
  let lightSum = 0;
  let lightCount = 0;
  for (const value of samples) {
    if (value <= threshold) {
      darkSum += value;
      darkCount += 1;
    } else {
      lightSum += value;
      lightCount += 1;
    }
  }
  return {
    dark: darkCount === 0 ? 0 : darkSum / darkCount,
    light: lightCount === 0 ? 255 : lightSum / lightCount,
  };
}

/**
 * Capture — **refuses, because the prior state is the images themselves**.
 *
 * `captureWatermarkPages`' shape and §4's reserved list: restoring a levelled scan
 * means restoring every image stream it carried, which is document-scaled and is
 * exactly what an invertible entry may not retain.
 */
export const captureEnhancePages: (
  session: MupdfSession,
  command: CommandOfKind<'enhancePages'>,
) => Promise<CaptureResult<never>> = (_session, _command) =>
  Promise.resolve({
    captured: false,
    reason:
      'a levelled scan has no recordable prior state: restoring it means restoring the image ' +
      'streams themselves, which are document-scaled and would be counted by nothing',
  });

/**
 * Invert — **unreachable by the type**, like every other checkpoint command's.
 *
 * `CommandPrior['enhancePages']` is `never`, so nothing can construct an argument
 * for the `inverse` parameter.
 */
export const invertEnhancePages: Invert<'mupdf', 'enhancePages'> = (_session, _inverse) => {
  throw new Error(
    'enhancePages has no inverse and this is unreachable: its prior state is `never`, so no ' +
      'caller can build an argument for it. Undo restores the checkpoint the bus took.',
  );
};

/**
 * Levels every round-trippable image on the named pages.
 *
 * ## Every page is validated before the first is written
 *
 * `applyWatermarkPages`' rule and `applyDeskewPages`': a command naming a page the
 * document does not have must change nothing at all, rather than enhancing the
 * pages before it and then refusing.
 *
 * ## A page whose images are all skipped is not an error
 *
 * It is the answer. The counts come back so the surface can say *this page's image
 * is a kind I cannot read* rather than leaving a reader to wonder what happened —
 * and the document is unchanged for that page, which is what makes the sentence
 * true.
 */
export const applyEnhancePages: Apply<'mupdf', 'enhancePages'> = async (session, command) => {
  const report = await enhancedPages(session, command);
  void report;
};

/**
 * The same write, reporting what it did — for the test and the instrument.
 *
 * `applyEnhancePages` answers `void` because `Apply` does, and a caller that needs
 * the counts would otherwise have to re-derive them by comparing documents. Two
 * functions rather than a second walk (B3a).
 */
export function enhancedPages(
  session: MupdfSession,
  command: CommandOfKind<'enhancePages'>,
): Promise<readonly EnhancedPage[]> {
  return withDocument(session, (document) => {
    const total = document.countPages();
    const targets = pagesOf(command.pages, total);
    for (const page of targets) {
      if (!Number.isInteger(page) || page < 0 || page >= total) {
        throw new RangeError(
          `Page ${String(page)} is outside this document, which has ${String(total)} page(s). ` +
            'Page indices are zero-based.',
        );
      }
    }

    const report: EnhancedPage[] = [];
    for (const page of targets) {
      let enhanced = 0;
      let skipped = 0;
      for (const image of imagesOf(document.loadPage(page).getObject())) {
        if (level(image.object)) enhanced += 1;
        else skipped += 1;
      }
      report.push({ page, enhanced, skipped });
    }
    return report;
  });
}
