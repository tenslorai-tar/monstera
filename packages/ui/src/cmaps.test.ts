// THE LEGACY BUILD, in Node: the modern one needs a browser's `DOMMatrix` and a typed array's `toHex`, which neither
// Node's globals nor happy-dom's have. The CMap path this proves — the worker asking by name, the factory answering —
// is the same source in both builds, and the factory it is handed is the renderer's own.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { BUNDLED_CMAPS, BUNDLED_CMAP_COUNT, BundledBinaryDataFactory } from './cmaps.js';

/**
 * The bundled CMaps decode text PDF.js could not decode without them (the owner's 27 September list, item 9).
 *
 * ## The document is GENERATED, and names a font nothing embeds
 *
 * Three Japanese characters set in a Type 0 font whose encoding is the predefined `UniJIS-UCS2-H` and whose CID font is
 * not embedded. PDF.js needs that CMap to turn the bytes into CIDs and Adobe-Japan1's to turn the CIDs into text, and
 * both are among the bundled ones. **Text extraction, not rendering**, so no Japanese font on this machine or a
 * runner's is involved: the answer is the characters or it is not, whatever the system has installed.
 *
 * ## The control is the same document with the factory taken away
 *
 * Without it PDF.js has no way to reach a CMap here — which is the renderer's state before this — and the text is not
 * the three characters. A case that passed both ways would be proving PDF.js, not the bundle.
 */

/** 日本語, as the three UCS-2 codes `UniJIS-UCS2-H` maps — the bytes the page's text operator carries. */
const CODES = [0x65e5, 0x672c, 0x8a9e];
const WORDS = String.fromCodePoint(...CODES);

/** A one-page PDF with `WORDS` in a non-embedded CID font under `UniJIS-UCS2-H`, offsets computed, not guessed. */
function nonEmbeddedCidPdf(): Uint8Array {
  const hex = CODES.map((code) => code.toString(16).padStart(4, '0').toUpperCase()).join('');
  const stream = `BT /F1 24 Tf 20 100 Td <${hex}> Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPr6N-Regular /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPr6N-Regular ' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> /FontDescriptor 7 0 R >>',
    '<< /Type /FontDescriptor /FontName /KozMinPr6N-Regular /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 ' +
      '/Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
  ];
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(text.length);
    text += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  // ASCII throughout — the characters are in the hex string — so one byte per character.
  return new TextEncoder().encode(text);
}

// PDF.JS'S WORKER IN THIS THREAD: with `pdfjsWorker` on the global, PDF.js runs its message handler here instead of
// starting a worker it would have to fetch — which a test has no server for. The parsing is the same code the worker runs.
beforeAll(async () => {
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
});

async function textOf(bundled: boolean): Promise<string> {
  const task = getDocument({
    data: nonEmbeddedCidPdf(),
    useWorkerFetch: false,
    useWasm: false,
    verbosity: 0,
    ...(bundled ? { cMapUrl: BUNDLED_CMAPS, cMapPacked: true, BinaryDataFactory: BundledBinaryDataFactory } : {}),
  });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items.map((item) => ('str' in item ? item.str : '')).join('');
  } finally {
    await task.destroy();
  }
}

describe('the bundled CMaps (item 9)', () => {
  it('carry every packed CMap PDF.js ships — 168, so none was left out of the bundle', () => {
    expect(BUNDLED_CMAP_COUNT).toBe(168);
  });

  it('DECODE text set in a non-embedded CID font under a predefined CMap', async () => {
    expect(await textOf(true)).toBe(WORDS);
  });

  it('CONTROL: with the factory taken away, the same document does not yield those characters', async () => {
    expect(await textOf(false)).not.toBe(WORDS);
  });

  it('answer CMaps only, and refuse another kind by name rather than with nothing', async () => {
    const factory = new BundledBinaryDataFactory({ cMapUrl: BUNDLED_CMAPS });
    await expect(factory.fetch({ kind: 'standardFontDataUrl', filename: 'FoxitSans.pfb' })).rejects.toThrow(
      'Only CMaps are bundled',
    );
    await expect(factory.fetch({ kind: 'cMapUrl', filename: 'Nonsense-H.bcmap' })).rejects.toThrow('No bundled CMap');
    expect((await factory.fetch({ kind: 'cMapUrl', filename: 'UniJIS-UCS2-H.bcmap' })).byteLength).toBeGreaterThan(0);
  });
});
