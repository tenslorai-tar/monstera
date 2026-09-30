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

  it('gives getPixels as a LIVE view: a write through it is what the pixmap then holds', () => {
    // Enhance levels samples in place and the scan straightener warps into them, then each encodes the pixmap; a
    // copy would lose every write without an error.
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, 4, 4], false);
    try {
      pixmap.clear(200);
      const first = pixmap.getPixels();
      first[5] = 17;
      expect(pixmap.getPixels()[5]).toBe(17);
      // CONTROL: the untouched sample kept the clear, so the read is of the pixmap and not of zeroed memory.
      expect(pixmap.getPixels()[4]).toBe(200);
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
});
