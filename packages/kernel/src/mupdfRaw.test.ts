import { describe, expect, it } from 'vitest';

import * as mupdf from './mupdfRaw.js';

/**
 * The native binding's own behaviour (ADR-0124): what the three kinds of change from upstream — binding, memory,
 * errors — must preserve. Every other kernel test runs through this module; these name the properties the port
 * could break without any of them noticing.
 */

/** A one-page PDF whose content fills one rectangle, built through the engine itself. */
function pageWithOneFill(): mupdf.PDFDocument {
  const document = new mupdf.PDFDocument();
  const page = document.addPage([0, 0, 200, 100], 0, document.newDictionary(), '0 0 1 rg 10 20 30 40 re f');
  document.insertPage(-1, page);
  return document;
}

describe('the native MuPDF binding', () => {
  it('turns a MuPDF error into the Error upstream threw, in MuPDF’s own words, and keeps working after it', () => {
    const document = new mupdf.PDFDocument();
    try {
      expect(() => document.loadPage(5)).toThrow(/page/iu);
      // CONTROL: the error state was cleared, so the next call is not answered with the last one's failure.
      expect(document.countPages()).toBe(0);
    } finally {
      document.destroy();
    }
  });

  it('hands a value a JavaScript device threw back to the caller of the MuPDF call, as that same value', () => {
    const document = pageWithOneFill();
    const thrown = new Error('the device refused');
    try {
      const device = new mupdf.Device({
        fillPath: () => {
          throw thrown;
        },
      });
      let caught: unknown;
      try {
        document.loadPage(0).run(device, mupdf.Matrix.identity);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(thrown);
    } finally {
      document.destroy();
    }
  });

  it('CONTROL: the device is really called back from native code, with the page’s own geometry', () => {
    const document = pageWithOneFill();
    const colours: number[][] = [];
    try {
      const device = new mupdf.Device({
        fillPath: (_path, _evenOdd, _ctm, _colorspace, color) => {
          colours.push(color);
        },
      });
      document.loadPage(0).run(device, mupdf.Matrix.identity);
      device.close();
      expect(colours).toStrictEqual([[0, 0, 1]]);
      // And the engine still works after a device run.
      expect(document.loadPage(0).getBounds()).toStrictEqual([0, 0, 200, 100]);
    } finally {
      document.destroy();
    }
  });

  it('carries a rectangle into native memory and back exactly, fractions included', () => {
    const document = pageWithOneFill();
    try {
      const page = document.loadPage(0);
      const annotation = page.createAnnotation('Square');
      annotation.setRect([10.5, 20.25, 110.75, 60.125]);
      expect(annotation.getRect()).toStrictEqual([10.5, 20.25, 110.75, 60.125]);
    } finally {
      document.destroy();
    }
  });

  it('gives getPixels as a COPY that owns its buffer, so no view over native memory reaches the caller', () => {
    // A view over native memory is an external ArrayBuffer, which aborts the Electron runtime the engine hosts run
    // in; `proof:hostruntime` runs the commands under that runtime. Here, in plain Node, the copy is what can be seen.
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 4, 4], false);
    try {
      pixmap.clear(200);
      const first = pixmap.getPixels();
      expect(first.byteOffset).toBe(0);
      expect(first.buffer.byteLength).toBe(16);
      first[5] = 17;
      // A write into the copy is not a write into the pixmap.
      expect(pixmap.getPixels()[5]).toBe(200);
    } finally {
      pixmap.destroy();
    }
  });

  it('writes samples back through setPixels: what the pixmap then holds, and only those samples', () => {
    // Enhance levels samples and the scan straightener warps into them, then each encodes the pixmap; without the
    // write-back each would encode the unchanged image without an error.
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 4, 4], false);
    try {
      pixmap.clear(200);
      const samples = pixmap.getPixels();
      samples[5] = 17;
      pixmap.setPixels(samples);
      expect(pixmap.getPixels()[5]).toBe(17);
      // CONTROL: the untouched sample kept the clear, so the read is of the pixmap and not of zeroed memory.
      expect(pixmap.getPixels()[4]).toBe(200);
    } finally {
      pixmap.destroy();
    }
  });

  it('refuses setPixels of any length but the pixmap’s own, rather than writing short or past its end', () => {
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 4, 4], false);
    try {
      pixmap.clear(200);
      expect(() => {
        pixmap.setPixels(new Uint8Array(17));
      }).toThrow(RangeError);
      expect(() => {
        pixmap.setPixels(new Uint8Array(15));
      }).toThrow(RangeError);
      // CONTROL: the refused writes left the pixmap as it was.
      expect(Array.from(pixmap.getPixels())).toStrictEqual(new Array<number>(16).fill(200));
    } finally {
      pixmap.destroy();
    }
  });

  it('reads a byte string back whole, through a size_t that is eight bytes native and was four in WASM', () => {
    const document = new mupdf.PDFDocument();
    try {
      const bytes = Uint8Array.from([0x41, 0x00, 0xff, 0x42, 0x00, 0x43]);
      expect(Array.from(document.newByteString(bytes).asByteString())).toStrictEqual(Array.from(bytes));
    } finally {
      document.destroy();
    }
  });

  it('says it is bound, in a process whose setup bound it', () => {
    expect(mupdf.isMupdfShimBound()).toBe(true);
  });

  describe('a callback that throws where MuPDF has no fz_try, or where MuPDF catches it', () => {
    /** One span of three glyphs, built through the engine. */
    function threeGlyphs(): mupdf.Text {
      const text = new mupdf.Text();
      text.showString(new mupdf.Font('Helvetica'), [1, 0, 0, 1, 0, 0], 'abc');
      return text;
    }

    it('a text walker’s throw reaches the caller, and the process lives (CR-NAT-03)', () => {
      // `wasm_walk_text` calls JavaScript from its own loop with no fz_try on MuPDF's stack, and fz_throw there ends
      // the process. On the shim before the fix this case takes its worker down rather than failing.
      const thrown = new Error('the walker refused');
      expect(() => {
        threeGlyphs().walk({
          beginSpan: () => {
            throw thrown;
          },
        });
      }).toThrow(thrown);
      // AND THE BINDING STILL WORKS: the jump landed in the export's wrapper, not past it.
      expect(new mupdf.PDFDocument().countPages()).toBe(0);
    });

    it('CONTROL: a walker that does not throw is called for the span and each glyph', () => {
      const seen: string[] = [];
      threeGlyphs().walk({
        beginSpan: () => seen.push('span'),
        showGlyph: (_font, _trm, _glyph, unicode) => seen.push(String.fromCodePoint(unicode)),
        endSpan: () => seen.push('end'),
      });
      expect(seen).toStrictEqual(['span', 'a', 'b', 'c', 'end']);
    });

    it('a throw MuPDF catches and plays past is thrown by the call that ran it, never by the next one (CR-NAT-04)', () => {
      // MuPDF's display-list player catches a device's error and goes on, so the run returned cleanly and the thrown
      // value waited for the next export that failed, which then threw it in place of its own error.
      const document = pageWithOneFill();
      const thrown = new Error('the device refused');
      try {
        const list = document.loadPage(0).toDisplayList();
        expect(() => {
          list.run(
            new mupdf.Device({
              fillPath: () => {
                throw thrown;
              },
            }),
            [1, 0, 0, 1, 0, 0],
          );
        }).toThrow(thrown);
        // THE NEXT FAILURE IS ITS OWN: a page that does not exist, in MuPDF's words.
        expect(() => document.loadPage(5)).toThrow(/page/iu);
      } finally {
        document.destroy();
      }
    });

    it('CONTROL: the display list really calls the device, and a device that does not throw lets the run return', () => {
      const document = pageWithOneFill();
      try {
        let fills = 0;
        document
          .loadPage(0)
          .toDisplayList()
          .run(new mupdf.Device({ fillPath: () => (fills += 1) }), [1, 0, 0, 1, 0, 0]);
        expect(fills).toBe(1);
      } finally {
        document.destroy();
      }
    });
  });
});
