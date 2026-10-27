/**
 * A PDF text string's bytes as the text they spell (PDF 32000-1, 7.9.2.2; PDF 32000-2 adds UTF-8): UTF-16BE after the
 * byte-order mark FE FF, UTF-8 after EF BB BF, and PDFDocEncoding otherwise.
 *
 * ## The one reading of the rule, because PDFium's string call does not apply it
 *
 * `FPDFPageObjMark_GetParamStringValue` decodes a parameter's bytes as UTF-8, whatever they are. Measured 2026-10-27 on
 * PDFium 155.0.8044.0: `/ActualText <FEFF00200020>`, two spaces as the operator writer marks them, came back as
 * `[0, 32, 0, 32]` — the mark dropped as invalid UTF-8 and each UTF-16 unit's zero byte a NUL — and an edit's two typed
 * spaces read back as NUL, space, NUL. Any producer's UTF-16 `/ActualText` read the same way. So a text string is read as
 * bytes (`FPDFPageObjMark_GetParamBlobValue`) and decoded here.
 */
export function pdfTextString(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = '';
    for (let at = 2; at + 1 < bytes.length; at += 2) text += String.fromCharCode(((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0));
    return text;
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  let text = '';
  for (const byte of bytes) text += PDF_DOC_ENCODING.get(byte) ?? String.fromCharCode(byte);
  return text;
}

/**
 * Where PDFDocEncoding is not Latin-1 (PDF 32000-1, Annex D.2): every other byte is the Unicode code point of its value.
 * A byte the encoding leaves undefined (0x9F, 0xAD) is read as the replacement character rather than as a character it
 * does not name.
 */
const PDF_DOC_ENCODING: ReadonlyMap<number, string> = new Map([
  [0x18, '˘'],
  [0x19, 'ˇ'],
  [0x1a, 'ˆ'],
  [0x1b, '˙'],
  [0x1c, '˝'],
  [0x1d, '˛'],
  [0x1e, '˚'],
  [0x1f, '˜'],
  [0x80, '•'],
  [0x81, '†'],
  [0x82, '‡'],
  [0x83, '…'],
  [0x84, '—'],
  [0x85, '–'],
  [0x86, 'ƒ'],
  [0x87, '⁄'],
  [0x88, '‹'],
  [0x89, '›'],
  [0x8a, '−'],
  [0x8b, '‰'],
  [0x8c, '„'],
  [0x8d, '“'],
  [0x8e, '”'],
  [0x8f, '‘'],
  [0x90, '’'],
  [0x91, '‚'],
  [0x92, '™'],
  [0x93, 'ﬁ'],
  [0x94, 'ﬂ'],
  [0x95, 'Ł'],
  [0x96, 'Œ'],
  [0x97, 'Š'],
  [0x98, 'Ÿ'],
  [0x99, 'Ž'],
  [0x9a, 'ı'],
  [0x9b, 'ł'],
  [0x9c, 'œ'],
  [0x9d, 'š'],
  [0x9e, 'ž'],
  [0x9f, '�'],
  [0xa0, '€'],
  [0xad, '�'],
]);
