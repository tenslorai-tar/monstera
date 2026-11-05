import { PDFDocument, PDFName } from '@cantoo/pdf-lib';

/**
 * A page whose one font is an embedded CFF subset holding space, `a` and `b` and no ToUnicode, named WinAnsi: the shape a
 * page-description printer writes, and the shape that left the writer with no font on the page (item 5 of 2026-11-05).
 * Built here byte by byte so no document is committed (B10), and so what the subset holds is a fact of this file.
 */

/** A CFF INDEX of one-byte offsets. */
function cffIndex(items: readonly (readonly number[])[]): number[] {
  if (items.length === 0) return [0, 0];
  const offsets = [1];
  for (const item of items) offsets.push((offsets.at(-1) ?? 1) + item.length);
  return [0, items.length, 1, ...offsets, ...items.flat()];
}

/** A Type 2 charstring number. */
function operand(value: number): number[] {
  if (value >= -107 && value <= 107) return [value + 139];
  if (value >= 108 && value <= 1131) return [((value - 108) >> 8) + 247, (value - 108) & 255];
  if (value <= -108 && value >= -1131) return [((-value - 108) >> 8) + 251, (-value - 108) & 255];
  throw new Error(`no fixture needs the number ${String(value)}`);
}

/** A box with ink, so a glyph held draws something. */
const INKED = [...operand(100), ...operand(0), 21, ...operand(300), ...operand(0), 5, ...operand(0), ...operand(500), 5, ...operand(-300), ...operand(0), 5, 14];

/** A DICT integer in its fixed five bytes, so the Top DICT's size does not depend on the offsets it holds. */
const fixed = (value: number): number[] => [29, (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];

/** The CFF program: `.notdef`, space, a, b. */
export function cffSubset(): Uint8Array {
  const header = [1, 0, 4, 1];
  const names = cffIndex([Array.from('SUBSET', (character) => character.charCodeAt(0))]);
  const strings = cffIndex([]);
  const subrs = cffIndex([]);
  // STANDARD STRINGS: space is 1, a is 66, b is 67.
  const charset = [0, 0, 1, 0, 66, 0, 67];
  const charstrings = cffIndex([[14], [14], INKED, INKED]);
  // defaultWidthX 500.
  const privateDict = [...operand(500), 20];
  const topLength = fixed(0).length * 4 + 3;
  const topIndexLength = cffIndex([new Array<number>(topLength).fill(0)]).length;
  const charsetAt = header.length + names.length + topIndexLength + strings.length + subrs.length;
  const charstringsAt = charsetAt + charset.length;
  const privateAt = charstringsAt + charstrings.length;
  const top = [...fixed(charsetAt), 15, ...fixed(charstringsAt), 17, ...fixed(privateDict.length), ...fixed(privateAt), 18];
  return Uint8Array.from([...header, ...names, ...cffIndex([top]), ...strings, ...subrs, ...charset, ...charstrings, ...privateDict]);
}

/** The page: `words` in that font, one show operator, at 10 points. */
export async function pageWithCffSubset(words: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([300, 300]);
  const context = doc.context;
  const program = context.register(context.flateStream(cffSubset(), { Subtype: 'Type1C' }));
  const font = context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: 'ABCDEF+Helvetica',
    FirstChar: 32,
    LastChar: 98,
    Widths: new Array<number>(67).fill(500),
    Encoding: 'WinAnsiEncoding',
    FontDescriptor: context.register(context.obj({ Type: 'FontDescriptor', FontName: 'ABCDEF+Helvetica', Flags: 32, FontBBox: [0, 0, 500, 700], ItalicAngle: 0, Ascent: 700, Descent: 0, CapHeight: 700, StemV: 80, FontFile3: program })),
  });
  page.node.set(PDFName.of('Resources'), context.obj({ Font: context.obj({ F1: context.register(font) }) }));
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(`BT /F1 10 Tf 50 200 Td (${words}) Tj ET`)));
  return doc.save({ useObjectStreams: false });
}
