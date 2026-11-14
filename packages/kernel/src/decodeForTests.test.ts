import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { PLAIN_NODE_VARIABLE, decodeForTests } from './decodeForTests.js';

/** A PNG of two pixels, red then blue, written by hand so no encoder under test is involved. */
function twoPixels(): Buffer {
  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.from([0, 255, 0, 0, 0, 0, 255]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const underHosts = process.env['MONSTERA_EXPECTED_RUNTIME'] === 'electron-as-node';

describe('decodeForTests', () => {
  it('decodes the pixels, with alpha when asked', async () => {
    const plain = await decodeForTests(twoPixels());
    expect(plain.info).toEqual({ width: 2, height: 1, channels: 3 });
    expect([...plain.data]).toEqual([255, 0, 0, 0, 0, 255]);
    const alpha = await decodeForTests(twoPixels(), { ensureAlpha: true });
    expect([...alpha.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  // THE DECISION, asserted where its absence differs: decoding in Electron would succeed, so a decode that refuses
  // for want of a plain Node is one that did not load sharp here.
  it.runIf(underHosts)('under the hosts’ runtime never decodes in Electron: with no plain Node named it refuses', async () => {
    const named = process.env['MONSTERA_PLAIN_NODE'];
    delete process.env['MONSTERA_PLAIN_NODE'];
    try {
      await expect(decodeForTests(twoPixels())).rejects.toThrow(PLAIN_NODE_VARIABLE);
    } finally {
      process.env['MONSTERA_PLAIN_NODE'] = named;
    }
  });

  it('is the only way a kernel or nodemode test reaches sharp', () => {
    const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
    const sources = ['kernel', 'nodemode'].flatMap((name) =>
      readdirSync(join(root, name, 'src'), { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.ts'))
        .map((file) => ({ file: `${name}/src/${file.replaceAll('\\', '/')}`, text: readFileSync(join(root, name, 'src', file), 'utf8') })),
    );
    // EITHER QUOTE, and a dynamic import or a require with spaces (IIIIIIIII-22): no lint rule fixes the quote style, and
    // kernel sources import with double quotes too, so a pattern of single quotes alone missed an import it exists to see.
    const SHARP = /from\s*["']sharp["']|import\(\s*["'`]sharp["'`]\s*\)|require\(\s*["']sharp["']\s*\)/u;
    // CONTROL: the pattern sees every spelling, so the empty-but-for-the-helper answer below is not a narrow one.
    for (const spelling of ["import sharp from 'sharp';", 'import sharp from "sharp";', "await import( 'sharp' )", 'require("sharp")']) {
      expect(SHARP.test(spelling), spelling).toBe(true);
    }
    // This file is left out by name: its pattern is the text it searches for.
    const reaching = sources
      .filter(({ file, text }) => file !== 'kernel/src/decodeForTests.test.ts' && SHARP.test(text))
      .map(({ file }) => file);
    // CONTROL: the scan sees the helper's own import, so an empty answer is not a blind one.
    expect(reaching).toContain('kernel/src/decodeForTests.ts');
    expect(reaching).toEqual(['kernel/src/decodeForTests.ts']);
  });
});
