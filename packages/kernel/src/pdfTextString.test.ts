import { describe, expect, it } from 'vitest';

import { pdfTextString } from './pdfTextString.js';

describe('pdfTextString, a PDF text string’s bytes as its text', () => {
  it('reads UTF-16BE after its byte-order mark: two spaces as two spaces, never NUL, space, NUL', () => {
    expect(pdfTextString(Uint8Array.of(0xfe, 0xff, 0x00, 0x20, 0x00, 0x20))).toBe('  ');
    expect(pdfTextString(Uint8Array.of(0xfe, 0xff, 0x00, 0x09))).toBe('\t');
    expect(pdfTextString(Uint8Array.of(0xfe, 0xff, 0x05, 0xd0))).toBe('א');
  });

  it('reads UTF-8 after its mark, and PDFDocEncoding otherwise, where its bytes are not Latin-1’s', () => {
    expect(pdfTextString(Uint8Array.of(0xef, 0xbb, 0xbf, 0xe2, 0x82, 0xac))).toBe('€');
    expect(pdfTextString(Uint8Array.of(0x20, 0x20))).toBe('  ');
    expect(pdfTextString(Uint8Array.of(0x80, 0x93, 0xa0, 0xe9))).toBe('•ﬁ€é');
  });

  it('CONTROL: the UTF-16 string read as UTF-8, as PDFium’s string call reads it, is the NULs the edit read back', () => {
    // WHAT `FPDFPageObjMark_GetParamStringValue` ANSWERED for this string, measured 2026-10-27: the mark dropped and each
    // unit's zero byte kept, so a reader that trusted it read NUL, space, NUL, space.
    const asUtf8 = new TextDecoder('utf-8').decode(Uint8Array.of(0xfe, 0xff, 0x00, 0x20, 0x00, 0x20)).replace(/�/gu, '');
    expect(Array.from({ length: asUtf8.length }, (_, at) => asUtf8.charCodeAt(at))).toStrictEqual([0, 32, 0, 32]);
    expect(pdfTextString(Uint8Array.of(0xfe, 0xff, 0x00, 0x20, 0x00, 0x20))).not.toBe(asUtf8);
  });
});
