import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { OPTIMIZE_LADDER, OPTIMIZE_SETTINGS, OPTIMIZE_STEP } from '@monstera/contract';
import { afterAll, describe, expect, it } from 'vitest';

import { ColorSpace, Pixmap, rewriteImages } from './mupdfRaw.js';
import { stepThatFits } from './optimizeFit.js';

/**
 * The rewriter's ladder ([ADR-0298](../../../docs/DECISIONS/0298-a-smaller-copy-may-be-asked-for-by-size.md)) run
 * through MuPDF's own image rewriter, the one the compose host calls: a page carrying a 400 dpi picture, rewritten at
 * every step. What it proves is what the size search leans on: the copies come out smaller step by step, so the first
 * step that fits is the lightest one that does, and a size between two steps is met by the lighter of them.
 */

const SIDE = 1200;
/** Drawn three inches wide, so its 1200 pixels are 400 per inch: past every step's threshold. */
const DRAWN = 216;

const scratch = mkdtempSync(join(tmpdir(), 'monstera-ladder-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * A one-page PDF carrying a 400 dpi JPEG at quality 95, as a scan or a photo carries one: a shading with grain, encoded
 * by MuPDF. A JPEG and not a lossless picture, measured 2026-11-19: MuPDF keeps a lossless picture lossless and halves it
 * by a whole factor, so High left a 400 dpi one as it was and the four other steps all made the same copy. A lossy
 * picture is re-encoded at each step's quality, which is where a scan's weight is.
 */
async function picturePage(): Promise<string> {
  const pixmap = new Pixmap(ColorSpace.DeviceRGB, [0, 0, SIDE, SIDE], false);
  const samples = pixmap.getPixels();
  // XORSHIFT GRAIN on a shading: every value new, so the encoder's quality is what the size answers to.
  let state = 0x9e3779b9;
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const at = (y * SIDE + x) * 3 + channel;
        samples[at] = Math.max(0, Math.min(255, Math.round(((x + y * channel) % SIDE) / (SIDE / 200)) + ((state & 0x3f) - 32)));
      }
    }
  }
  // A COPY was read, so the samples go back (`getPixels`' own note).
  pixmap.setPixels(samples);
  const jpeg = pixmap.asJPEG(95);
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([612, 792]);
  const image = await document.embedJpg(jpeg);
  page.drawImage(image, { x: 72, y: 500, width: DRAWN, height: DRAWN });
  const path = join(scratch, 'picture.pdf');
  writeFileSync(path, await document.save({ useObjectStreams: false }));
  return path;
}

/** The size of the copy MuPDF's rewriter makes of `input` at `step`. */
function sizeAt(input: string, step: number): number {
  const setting = OPTIMIZE_LADDER[step];
  if (setting === undefined) throw new RangeError(`no step ${String(step)}`);
  const output = join(scratch, `step-${String(step)}.pdf`);
  rewriteImages(input, output, setting);
  return statSync(output).size;
}

describe('the rewriter’s ladder on MuPDF (ADR-0298)', () => {
  it('each named setting IS its step of the ladder', () => {
    for (const name of ['high', 'medium', 'low'] as const) expect(OPTIMIZE_SETTINGS[name]).toBe(OPTIMIZE_LADDER[OPTIMIZE_STEP[name]]);
  });

  it('makes no step’s copy LARGER than the step before, and the floor’s smaller than the first, on a real picture', async () => {
    // NO LARGER, NOT STRICTLY SMALLER: on a lossless picture, measured 2026-11-19, four steps made the same copy (see
    // `picturePage`). Which is why the search is linear and keeps the first that fits (ADR-0298).
    const input = await picturePage();
    const original = readFileSync(input).length;
    const sizes = OPTIMIZE_LADDER.map((_setting, step) => sizeAt(input, step));
    // MEASURED on this fixture, 2026-11-19: 1,798,130 bytes, then 919,286, 76,137, 55,962, 41,650 and 32,283.
    expect(sizes[0]).toBeLessThan(original);
    for (let step = 1; step < sizes.length; step += 1) expect(sizes[step]).toBeLessThanOrEqual(sizes[step - 1] ?? 0);
    expect(sizes.at(-1)).toBeLessThan(sizes[0] ?? 0);
  });

  it('meets a size between two steps with the LIGHTER of them, and one below the floor with the floor', async () => {
    const input = await picturePage();
    const sizes = OPTIMIZE_LADDER.map((_setting, step) => sizeAt(input, step));
    // THE FIRST STEP THAT WEIGHS LESS than the one before it, and a size halfway between the two.
    const lighter = sizes.findIndex((size, step) => step > 0 && size < (sizes[step - 1] ?? 0));
    expect(lighter).toBeGreaterThan(0);
    const between = Math.round(((sizes[lighter - 1] ?? 0) + (sizes[lighter] ?? 0)) / 2);
    expect(await stepThatFits(sizes.length, between, (step) => Promise.resolve(sizeAt(input, step)))).toStrictEqual({ step: lighter, size: sizes[lighter], fits: true });
    // CONTROL: below the floor nothing fits, and the smallest, the floor's, is offered rather than refused.
    expect(await stepThatFits(sizes.length, 1024, (step) => Promise.resolve(sizeAt(input, step)))).toStrictEqual({ step: 4, size: sizes[4], fits: false });
  });
});
