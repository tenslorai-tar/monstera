import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from '@cantoo/pdf-lib';

/**
 * Pictures in the encodings PDF.js decodes only through its image decoders — CCITT, JBIG2 and JPEG 2000 — made here,
 * bit by bit, so no fixture is anyone's document ([ADR-0296](../../../docs/DECISIONS/0296-the-renderer-is-served-from-its-own-scheme-and-a-picture-is-never-dropped-silently.md)).
 *
 * One page each, the picture drawn in {@link PICTURE_BOX}, and a fourth page shaped like the user's PDF that drew blank:
 * a colour picture whose soft mask is a one-bit CCITT image. Each is small enough to state exactly what it holds:
 *
 * - **CCITT**: a {@link SIDE}-square bitmap, white on its left half and black on its right, Group 4 (`/K -1`).
 * - **JBIG2**: the same bitmap as an embedded stream: a page, one immediate generic region coded with MMR — which is
 *   Group 4 — and the end of the page.
 * - **JPEG 2000**: a codestream of one grey component whose one packet is empty, so every coefficient is zero and the
 *   picture decodes to the level shift, mid-grey (128).
 * - **A colour picture with a CCITT soft mask**: red, Flate-coded; its mask white (opaque) on the left half and black
 *   (transparent) on the right.
 */

/** The bitmaps' side, in pixels. A multiple of 8, so a row is whole bytes; small, so the runs below are few. */
export const SIDE = 32;

/** Where each picture is drawn on its US Letter page, in PDF points from the bottom left. */
export const PICTURE_BOX = { x: 156, y: 296, width: 300, height: 200 } as const;

export const PAGE = { width: 612, height: 792 } as const;

/** The four pages, in order, as the rendered case names them. */
export const PICTURE_PAGES = ['ccitt', 'jbig2', 'jpx', 'masked'] as const;

/** Bits written most significant first, the order CCITT and JBIG2's MMR read them in. */
class Bits {
  readonly #bytes: number[] = [];
  #current = 0;
  #used = 0;

  write(code: string): void {
    for (const bit of code) {
      this.#current = (this.#current << 1) | (bit === '1' ? 1 : 0);
      this.#used += 1;
      if (this.#used === 8) this.#flush();
    }
  }

  bytes(): Uint8Array {
    if (this.#used > 0) {
      this.#current <<= 8 - this.#used;
      this.#flush();
    }
    return Uint8Array.from(this.#bytes);
  }

  #flush(): void {
    this.#bytes.push(this.#current);
    this.#current = 0;
    this.#used = 0;
  }
}

/**
 * The run-length codes the bitmaps here need, from ITU-T T.4's tables 2 and 3. Only these lengths occur: a row is
 * either all one colour or two halves, so a run is 0, half the side or the whole side.
 */
const WHITE_RUN: ReadonlyMap<number, string> = new Map([
  [0, '00110101'],
  [16, '101010'],
  [32, '00011011'],
]);
const BLACK_RUN: ReadonlyMap<number, string> = new Map([
  [0, '0000110111'],
  [16, '0000010111'],
  [32, '000001101010'],
]);

const VERTICAL: ReadonlyMap<number, string> = new Map([
  [0, '1'],
  [1, '011'],
  [2, '000011'],
  [3, '0000011'],
  [-1, '010'],
  [-2, '000010'],
  [-3, '0000010'],
]);

/** Where `row` changes colour after `from`, to the colour `to`; the row's width where it does not. `true` is black. */
function changeAfter(row: readonly boolean[], from: number, to: boolean): number {
  for (let at = Math.max(from + 1, 0); at < row.length; at += 1) {
    const before = at === 0 ? false : row[at - 1];
    if (row[at] !== before && row[at] === to) return at;
  }
  return row.length;
}

/**
 * `rows` coded as ITU-T T.6 (Group 4), with the end-of-block code: the two-dimensional coding T.6 §2.2 gives, pass,
 * vertical and horizontal modes, each row against the one above and the first against an all-white row.
 */
export function group4(rows: readonly (readonly boolean[])[]): Uint8Array {
  const bits = new Bits();
  const width = rows[0]?.length ?? 0;
  let reference: readonly boolean[] = Array.from({ length: width }, () => false);
  for (const row of rows) {
    let a0 = -1;
    let colour = false;
    while (a0 < width) {
      const a1 = changeAfter(row, a0, !colour);
      const a2 = changeAfter(row, a1, colour);
      const b1 = changeAfter(reference, a0, !colour);
      const b2 = changeAfter(reference, b1, colour);
      if (b2 < a1) {
        bits.write('0001');
        a0 = b2;
        continue;
      }
      const vertical = VERTICAL.get(a1 - b1);
      if (vertical !== undefined) {
        bits.write(vertical);
        a0 = a1;
        colour = !colour;
        continue;
      }
      const first = a1 - Math.max(a0, 0);
      const second = a2 - a1;
      const firstCode = (colour ? BLACK_RUN : WHITE_RUN).get(first);
      const secondCode = (colour ? WHITE_RUN : BLACK_RUN).get(second);
      if (firstCode === undefined || secondCode === undefined) throw new Error(`no run code here for ${String(first)} or ${String(second)}`);
      bits.write(`001${firstCode}${secondCode}`);
      a0 = a2;
    }
    reference = row;
  }
  bits.write('000000000001000000000001');
  return bits.bytes();
}

/** A square bitmap whose pixel at column `x` is black where `black(x)` says. */
function bitmap(black: (x: number) => boolean): boolean[][] {
  return Array.from({ length: SIDE }, () => Array.from({ length: SIDE }, (_unused, x) => black(x)));
}

/**
 * White on the left half and black on the right: the CCITT and JBIG2 pictures, and the mask. TWO HALVES, never one
 * colour (KKKKKKKKK-10): a decoder that answered zeroed bytes draws a one-bit grey picture all black, which an all-black
 * fixture read as a correct decode. As the mask, white is opaque and black transparent.
 */
const RIGHT_BLACK = bitmap((x) => x >= SIDE / 2);

const uint32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const uint16 = (value: number): number[] => [(value >>> 8) & 0xff, value & 0xff];

/** One JBIG2 segment header and its data, as an embedded stream carries them (T.88 §7.2): page 1, nothing referred to. */
function segment(number: number, type: number, data: readonly number[]): number[] {
  return [...uint32(number), type, 0x00, 0x01, ...uint32(data.length), ...data];
}

/** {@link RIGHT_BLACK} as an embedded JBIG2 stream: the page, an immediate generic region coded with MMR, the page's end. */
function jbig2(): Uint8Array {
  const page = [...uint32(SIDE), ...uint32(SIDE), ...uint32(0), ...uint32(0), 0x00, ...uint16(0)];
  const region = [...uint32(SIDE), ...uint32(SIDE), ...uint32(0), ...uint32(0), 0x00, 0x01, ...group4(RIGHT_BLACK)];
  return Uint8Array.from([...segment(0, 48, page), ...segment(1, 38, region), ...segment(2, 49, [])]);
}

/**
 * A JPEG 2000 codestream (T.800 Annex A) of one 8-bit grey component, one tile, no wavelet levels, whose one packet is
 * empty: its header's first bit is 0. Every coefficient decodes to zero, which the DC level shift makes 128.
 */
function jpx(): Uint8Array {
  const siz = [0xff, 0x51, ...uint16(41), ...uint16(0), ...uint32(SIDE), ...uint32(SIDE), ...uint32(0), ...uint32(0), ...uint32(SIDE), ...uint32(SIDE), ...uint32(0), ...uint32(0), ...uint16(1), 0x07, 0x01, 0x01];
  // SCOD 0; LRCP, one layer, no colour transform; no levels, 64 × 64 code-blocks, no style flags, the 5-3 wavelet.
  const cod = [0xff, 0x52, ...uint16(12), 0x00, 0x00, ...uint16(1), 0x00, 0x00, 0x04, 0x04, 0x00, 0x01];
  // No quantization, two guard bits, one sub-band whose exponent is the bit depth.
  const qcd = [0xff, 0x5c, ...uint16(4), 0x40, 8 << 3];
  const data = [0x00];
  const sot = [0xff, 0x90, ...uint16(10), ...uint16(0), ...uint32(12 + 2 + data.length), 0x00, 0x01];
  return Uint8Array.from([0xff, 0x4f, ...siz, ...cod, ...qcd, ...sot, 0xff, 0x93, ...data, 0xff, 0xd9]);
}

/**
 * `pages` pages, each drawing one picture NO decoder can read: a `/JPXDecode` stream of bytes that are not a codestream.
 * What a person is shown when a picture really cannot be decoded (ADR-0296 Decision 4). The page draws only the picture.
 */
export async function undecodablePicturePdf(pages = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const context = document.context;
  const garbage = Uint8Array.from({ length: 64 }, (_unused, at) => (at * 37 + 11) & 0xff);
  // ONE PICTURE, drawn on every page: from the second page PDF.js shares it between pages, as it does a logo (KKKKKKKKK-1).
  const picture = context.register(context.stream(garbage, { Type: 'XObject', Subtype: 'Image', Width: SIDE, Height: SIDE, Filter: 'JPXDecode' }));
  for (let at = 0; at < pages; at += 1) {
    const page = document.addPage([PAGE.width, PAGE.height]);
    const name = page.node.newXObject('Im', picture);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(PICTURE_BOX.width, 0, 0, PICTURE_BOX.height, PICTURE_BOX.x, PICTURE_BOX.y),
      drawObject(name),
      popGraphicsState(),
    );
  }
  return document.save({ useObjectStreams: false });
}

/** The four pages as one PDF. */
export async function picturesPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const context = document.context;
  const bilevel = { Type: 'XObject', Subtype: 'Image', Width: SIDE, Height: SIDE, ColorSpace: 'DeviceGray', BitsPerComponent: 1 };
  const ccittParameters = { K: -1, Columns: SIDE, Rows: SIDE };
  const red = new Uint8Array(SIDE * SIDE * 3);
  for (let at = 0; at < red.length; at += 3) red[at] = 255;
  const mask = context.register(context.stream(group4(RIGHT_BLACK), { ...bilevel, Filter: 'CCITTFaxDecode', DecodeParms: ccittParameters }));
  const pictures = [
    context.register(context.stream(group4(RIGHT_BLACK), { ...bilevel, Filter: 'CCITTFaxDecode', DecodeParms: ccittParameters })),
    context.register(context.stream(jbig2(), { ...bilevel, Filter: 'JBIG2Decode' })),
    context.register(context.stream(jpx(), { Type: 'XObject', Subtype: 'Image', Width: SIDE, Height: SIDE, Filter: 'JPXDecode' })),
    context.register(
      context.flateStream(red, { Type: 'XObject', Subtype: 'Image', Width: SIDE, Height: SIDE, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: mask }),
    ),
  ];
  for (const picture of pictures) {
    const page = document.addPage([PAGE.width, PAGE.height]);
    const name = page.node.newXObject('Im', picture);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(PICTURE_BOX.width, 0, 0, PICTURE_BOX.height, PICTURE_BOX.x, PICTURE_BOX.y),
      drawObject(name),
      popGraphicsState(),
    );
  }
  return document.save({ useObjectStreams: false });
}
