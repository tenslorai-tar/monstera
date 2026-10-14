import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

/**
 * ONE HARFBUZZ BUFFER PER FACE. harfbuzzjs 1.6.2 frees a buffer only through a `FinalizationRegistry`, which never runs
 * while a composition holds the thread, so a buffer per shape grew HarfBuzz's memory for a whole CSV part (`textShaping.ts`).
 * Every buffer made is counted by wrapping the library's own class.
 */
const made = vi.hoisted(() => ({ buffers: 0 }));
vi.mock('harfbuzzjs', async (original) => {
  const real = await original<typeof import('harfbuzzjs')>();
  class CountedBuffer extends real.Buffer {
    constructor() {
      super();
      made.buffers += 1;
    }
  }
  return { ...real, Buffer: CountedBuffer };
});

const { ShapingFace } = await import('./textShaping.js');

/** A bundled face; ABSENT IS A FAILURE, never a skip, `fontSubset.test.ts`' rule. */
function bundled(file: string): Uint8Array {
  const folder = process.env['MONSTERA_FONTS_DIRECTORY'] ?? '';
  const path = join(folder, file);
  if (folder === '' || !existsSync(path)) throw new Error(`${file} is not provisioned at ${path}. Run: npm run provision:fonts`);
  return new Uint8Array(readFileSync(path));
}

const ARIMO = bundled('Arimo[wght].ttf');

describe('ShapingFace: one buffer for every shape', () => {
  it('makes one buffer however many times it shapes', () => {
    const before = made.buffers;
    const face = new ShapingFace(ARIMO, 0, {});
    for (let cell = 0; cell < 1000; cell += 1) face.shape(`Customer ${String(cell)}`, false);
    expect(made.buffers - before).toBe(1);
  });

  // CONTROL: the buffer is RESET between shapes, so a shape after a longer one and after one set right to left is the
  // shape a face that never shaped anything gives. A reuse that kept the last text or direction fails here.
  it('shapes after a longer text and after a right-to-left one exactly as a fresh face does', () => {
    const used = new ShapingFace(ARIMO, 0, {});
    used.shape('a much longer line of text, with punctuation.', false);
    used.shape('abc', true);
    const fresh = new ShapingFace(ARIMO, 0, {});
    expect(used.shape('Office', false)).toStrictEqual(fresh.shape('Office', false));
    expect(used.shape('Office', false).map((glyph) => glyph.text).join('')).toBe('Office');
  });
});
