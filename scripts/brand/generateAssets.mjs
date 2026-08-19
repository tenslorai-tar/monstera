// @ts-check
/**
 * Derives every logo size the project needs from the one master.
 *
 * `assets/brand/logo.png` is the single source of truth (B3). Everything below
 * is generated from it, so a size can never drift from the artwork it is
 * supposed to represent, and adding a size is a line here rather than a new
 * binary in the repository.
 *
 * Two of the outputs are committed rather than built on demand, and the reason
 * is specific: GitHub renders README.md with no build step, so a display asset
 * has to exist as a file. Committing a *generated* file is acceptable where
 * regenerating it is one command and CI can prove it matches; committing a
 * hand-made one is not, because nothing then ties it to the master.
 *
 * The artwork is portrait (aspect ratio 0.806) and ADR-0002 forbids distorting
 * it. Square outputs are produced by fitting inside the box and padding with
 * transparency — never by stretching.
 *
 * Usage: node scripts/brand/generateAssets.mjs [--check]
 *   --check  regenerate into memory and fail if the committed files differ.
 *            This is what stops a derived asset silently going stale.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

import { formatError } from '../lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = join(REPO_ROOT, 'assets', 'brand');
const MASTER = join(BRAND, 'logo.png');

/**
 * Committed derivatives.
 *
 * `logo-256.png` is what README.md and the docs display: 256 px on its long
 * edge keeps a 132 px render crisp on a 2x display without shipping a
 * multi-megabyte image to every reader of the repository front page.
 *
 * @type {readonly {file: string, width: number}[]}
 */
const DERIVATIVES = [{ file: 'logo-256.png', width: 206 }];

/** Square sizes packed into the Windows .ico used by the packaged app. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Fits the portrait artwork inside a square of `size`, padding with
 * transparency. `fit: 'contain'` preserves the aspect ratio; the alternative,
 * 'fill', would stretch it, which ADR-0002 rules out.
 *
 * @param {Buffer} master
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
function square(master, size) {
  return sharp(master)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * @param {Buffer} master
 * @param {number} width
 * @returns {Promise<Buffer>}
 */
function scaled(master, width) {
  return sharp(master).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const master = await readFile(MASTER);
  const meta = await sharp(master).metadata();
  process.stderr.write(`master: ${meta.width ?? '?'}x${meta.height ?? '?'}\n`);

  const check = process.argv.includes('--check');
  /** @type {string[]} */
  const stale = [];

  for (const { file, width } of DERIVATIVES) {
    const generated = await scaled(master, width);
    const path = join(BRAND, file);

    if (check) {
      const existing = await readFile(path).catch(() => null);
      if (existing === null || digest(existing) !== digest(generated)) {
        stale.push(file);
      }
      continue;
    }

    await writeFile(path, generated);
    process.stderr.write(`  wrote ${file} (${width}px wide, ${generated.length} bytes)\n`);
  }

  const icoPath = join(BRAND, 'logo.ico');
  const squares = await Promise.all(ICO_SIZES.map((size) => square(master, size)));
  const ico = await pngToIco(squares);

  if (check) {
    const existing = await readFile(icoPath).catch(() => null);
    if (existing === null || digest(existing) !== digest(ico)) stale.push('logo.ico');
  } else {
    await writeFile(icoPath, ico);
    process.stderr.write(`  wrote logo.ico (${ICO_SIZES.join(', ')} px, ${ico.length} bytes)\n`);
  }

  if (check && stale.length > 0) {
    process.stderr.write(
      `\nGenerated brand assets are out of date: ${stale.join(', ')}\n\n` +
        `  Run:  node scripts/brand/generateAssets.mjs\n\n` +
        `They are committed only because GitHub renders README.md with no build ` +
        `step. A committed derivative that no longer matches its master is the ` +
        `drift that having one source of truth exists to prevent.\n`,
    );
    return 1;
  }

  return 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  },
);
