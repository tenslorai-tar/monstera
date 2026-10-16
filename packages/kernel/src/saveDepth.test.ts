import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as mupdf from './mupdfRaw.js';
import { SAVE_DEPTH_MAX, savedBuffer, savedWithoutOutline, saveDepth, StructureTooDeep, throughOutline } from './saveDepth.js';

/**
 * The owner's decision of 2026-10-16: a document too deep for MuPDF's collecting save is refused BEFORE the save, by
 * measuring the depth `markobj` would recurse to, never by counting bookmarks.
 *
 * The control for the refusal is the case just past the limit: without the guard, a chain 8,005 frames deep SAVES on
 * this platform (the crash is at 10,888), so deleting the measurement turns that case red rather than ending the run.
 * The case just below is the other side: the guard must not refuse what a save holds.
 */

/** A one-page document whose outline is a `/Next` chain of `links` entries; its save recurses `links + 5` deep. */
function outlineChain(links: number): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>';
  objects[4] = `<< /Type /Outlines /First 5 0 R /Last ${String(links + 4)} 0 R /Count ${String(links)} >>`;
  for (let i = 0; i < links; i += 1) {
    const id = i + 5;
    const next = i + 1 < links ? ` /Next ${String(id + 1)} 0 R` : '';
    const prev = i > 0 ? ` /Prev ${String(id - 1)} 0 R` : '';
    objects[id] = `<< /Title (Item ${String(i + 1)}) /Parent 4 0 R${prev}${next} /Dest [3 0 R /Fit] >>`;
  }
  return assembled(objects);
}

/** A one-page document with no outline whose catalog holds a `/N` chain of `links` dictionaries under `/Deep`. */
function catalogChain(links: number): Uint8Array {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R /Deep 4 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>';
  for (let i = 0; i < links; i += 1) {
    const id = i + 4;
    objects[id] = i + 1 < links ? `<< /N ${String(id + 1)} 0 R /A [1 2 (x)] >>` : '<< /End true >>';
  }
  return assembled(objects);
}

function assembled(objects: readonly string[]): Uint8Array {
  const parts = ['%PDF-1.7\n'];
  let offset = 9;
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    const text = `${String(id)} 0 obj\n${objects[id] ?? 'null'}\nendobj\n`;
    offsets[id] = offset;
    parts.push(text);
    offset += Buffer.byteLength(text, 'latin1');
  }
  parts.push(`xref\n0 ${String(objects.length)}\n`, '0000000000 65535 f \n');
  for (let id = 1; id < objects.length; id += 1) parts.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  parts.push(`trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\nstartxref\n${String(offset)}\n%%EOF\n`);
  return new Uint8Array(Buffer.from(parts.join(''), 'latin1'));
}

function opened(bytes: Uint8Array): mupdf.PDFDocument {
  return mupdf.PDFDocument.openDocument(bytes, 'application/pdf').asPDF() ?? expect.fail('not a PDF');
}

function outlineLength(bytes: Uint8Array): number {
  const document = opened(bytes);
  try {
    let count = 0;
    let item = document.getTrailer().get('Root').get('Outlines').get('First');
    while (!item.isNull()) {
      count += 1;
      item = item.get('Next');
    }
    return count;
  } finally {
    document.destroy();
  }
}

/**
 * `markobj` itself, recursively, through MuPDF's object API rather than its printed text: the oracle {@link saveDepth}
 * must agree with, frame for frame. Only for small documents — it needs the stack it counts.
 */
function oracleDepth(document: mupdf.PDFDocument): number {
  const marked = new Set<number>();
  let deepest = 0;
  const mark = (object: mupdf.PDFObject, depth: number): void => {
    deepest = Math.max(deepest, depth);
    let value = object;
    if (value.isIndirect()) {
      const number = value.asIndirect();
      if (marked.has(number)) return;
      value = value.resolve();
      if (value.isNull()) return;
      marked.add(number);
    }
    if (value.isDictionary()) {
      value.forEach((child) => {
        mark(child, depth + 1);
      });
    }
    else if (value.isArray()) for (let i = 0; i < value.length; i += 1) mark(value.get(i), depth + 1);
  };
  mark(document.getTrailer(), 1);
  return deepest;
}

describe('saveDepth', () => {
  it('AN OUTLINE CHAIN OF N LINKS IS N + 5 DEEP, the calibration the limit was read against', () => {
    const document = opened(outlineChain(40));
    try {
      const measured = saveDepth(document);
      expect(measured.depth).toBe(45);
      expect(measured.path.slice(0, 4)).toStrictEqual(['Root', 'Outlines', 'First', 'Next']);
      expect(throughOutline(measured)).toBe(true);
    } finally {
      document.destroy();
    }
  });

  it('AGREES WITH MARKOBJ walked through the object API, on an outline, a catalog chain and arrays', () => {
    for (const bytes of [outlineChain(60), catalogChain(70), outlineChain(1)]) {
      const document = opened(bytes);
      try {
        expect(saveDepth(document).depth).toBe(oracleDepth(document));
      } finally {
        document.destroy();
      }
    }
  });

  it('A DEEP CHAIN OUTSIDE THE OUTLINE is measured too, and is not blamed on bookmarks', () => {
    const document = opened(catalogChain(SAVE_DEPTH_MAX));
    try {
      expect(() => savedBuffer(document, 'garbage')).toThrow(StructureTooDeep);
      try {
        savedBuffer(document, 'garbage');
      } catch (error) {
        expect(error).toBeInstanceOf(StructureTooDeep);
        expect((error as StructureTooDeep).throughOutline).toBe(false);
      }
    } finally {
      document.destroy();
    }
  });
});

describe('savedBuffer', () => {
  it('REFUSES A SAVE JUST PAST THE LIMIT, through the outline, writing nothing', () => {
    const document = opened(outlineChain(SAVE_DEPTH_MAX - 4));
    try {
      expect(saveDepth(document).depth).toBe(SAVE_DEPTH_MAX + 1);
      let thrown: unknown;
      try {
        savedBuffer(document, 'garbage,compress');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StructureTooDeep);
      expect((thrown as StructureTooDeep).throughOutline).toBe(true);
    } finally {
      document.destroy();
    }
  });

  it('CONTROL: SAVES A CHAIN JUST BELOW THE LIMIT, and it reopens with every bookmark', () => {
    const links = SAVE_DEPTH_MAX - 5;
    const document = opened(outlineChain(links));
    try {
      expect(saveDepth(document).depth).toBe(SAVE_DEPTH_MAX);
      const written = savedBuffer(document, 'garbage,compress').asUint8Array().slice();
      expect(outlineLength(written)).toBe(links);
    } finally {
      document.destroy();
    }
  });

  it('AN INCREMENTAL SAVE marks nothing, so it is not measured and not refused', () => {
    const document = opened(outlineChain(SAVE_DEPTH_MAX - 4));
    try {
      expect(() => savedBuffer(document, 'incremental')).not.toThrow();
    } finally {
      document.destroy();
    }
  });
});

describe('savedWithoutOutline', () => {
  it('WRITES THE TOO-DEEP DOCUMENT WITHOUT ITS BOOKMARKS, and the open document keeps them', () => {
    const links = SAVE_DEPTH_MAX - 4;
    const document = opened(outlineChain(links));
    try {
      const written = savedWithoutOutline(document, 'garbage,compress').asUint8Array().slice();
      const copy = opened(written);
      try {
        expect(copy.getTrailer().get('Root').get('Outlines').isNull()).toBe(true);
        expect(copy.countPages()).toBe(1);
      } finally {
        copy.destroy();
      }
      expect(document.getTrailer().get('Root').get('Outlines').isNull()).toBe(false);
      expect(saveDepth(document).depth).toBe(SAVE_DEPTH_MAX + 1);
    } finally {
      document.destroy();
    }
  });
});

describe('the one place a MuPDF document is written', () => {
  it('NO KERNEL SOURCE but saveDepth.ts calls saveToBuffer, so no save can skip the measurement', () => {
    const folder = import.meta.dirname;
    const calling: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/u.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          if (readFileSync(path, 'utf8').includes('.saveToBuffer(')) calling.push(path.slice(folder.length + 1));
        }
      }
    };
    walk(folder);
    // THE POSITIVE CONTROL is saveDepth.ts itself: a scan that sees nothing reports an empty list, which is the answer
    // this case hopes for, so it must find the one call it is known to hold. `mupdfRaw.ts` is MuPDF's own binding,
    // which defines the method and calls it from its `save(filename)` — a route that takes a path, which no kernel
    // module holds — so it is named here rather than filtered out of the walk.
    expect(calling.map((one) => one.replaceAll('\\', '/')).sort()).toStrictEqual(['mupdfRaw.ts', 'saveDepth.ts']);
  });
});
