import { describe, expect, it } from 'vitest';

import { linesOf, parsePageText } from '../textStructure.js';
import { boundPageText } from './pageTextBound.js';

/**
 * A page past one answer's ceiling is answered with the part of it that fits, in MuPDF's own format, and says so
 * (`pageTextBound.ts`). The pages are MuPDF-shaped JSON with one line per run, as textWalk's L6 dense page has.
 */
function page(lines: number): string {
  return JSON.stringify({
    blocks: [
      {
        type: 'text',
        bbox: { x: 72, y: 36, w: 400, h: 700 },
        lines: Array.from({ length: lines }, (_, at) => ({
          wmode: 0,
          bbox: { x: 72, y: 36 + at, w: 6, h: 1, flags: 0 },
          font: { name: 'Helvetica', family: 'sans-serif', weight: 'normal', style: 'normal', size: 12 },
          x: 72,
          y: 37 + at,
          text: at === 0 ? 'Dense page "heading"' : `run ${String(at)}`,
        })),
      },
    ],
  });
}

const writtenBytes = (json: string): number => Buffer.byteLength(JSON.stringify(json), 'utf8');

describe('boundPageText', () => {
  it('answers a page that fits whole, unchanged', () => {
    const json = page(20);
    expect(boundPageText(json, 1 << 20)).toStrictEqual({ json, truncated: false });
  });

  // CONTROL: a page whose own JSON is UNDER the ceiling but whose WRITTEN form is over it — every quote escaped — is
  // the shape the file answer refused. Measuring the raw string would let it through and the frame would refuse it.
  it('cuts a page whose written form is over the ceiling though its own JSON is under it', () => {
    const json = page(200);
    const ceiling = Buffer.byteLength(json) + 1024 + 50;
    expect(Buffer.byteLength(json)).toBeLessThan(ceiling - 1024);
    expect(writtenBytes(json)).toBeGreaterThan(ceiling - 1024);
    const bounded = boundPageText(json, ceiling);
    expect(bounded.truncated).toBe(true);
    expect(writtenBytes(bounded.json)).toBeLessThanOrEqual(ceiling - 1024);
  });

  it('keeps the page in reading order, readable by the one reader, as much of it as fits', () => {
    const json = page(2000);
    const ceiling = 64 * 1024;
    const bounded = boundPageText(json, ceiling);
    const lines = linesOf(parsePageText(bounded.json)).map((line) => line.text);
    expect(bounded.truncated).toBe(true);
    expect(lines[0]).toBe('Dense page "heading"');
    expect(lines.slice(1, 4)).toStrictEqual(['run 1', 'run 2', 'run 3']);
    // AS MUCH AS FITS: one more line would not.
    const more = page(lines.length + 1);
    const oneMore = JSON.stringify({ blocks: [{ ...(JSON.parse(more) as { blocks: [Record<string, unknown>] }).blocks[0] }] });
    expect(writtenBytes(bounded.json)).toBeLessThanOrEqual(ceiling - 1024);
    expect(writtenBytes(oneMore)).toBeGreaterThan(ceiling - 1024);
  });
});
