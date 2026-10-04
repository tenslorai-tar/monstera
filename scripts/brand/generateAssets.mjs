// @ts-check
/**
 * Derives every logo size the project needs from the owner's one master, `monstera_logo.png`
 * ({@link MASTER}): the mark alone, a green document with a folded corner and the leaf in a white
 * circle, with no wordmark.
 *
 * Every output comes from that master (B3): a size can never drift from the artwork it represents,
 * and adding a size is a line in {@link OUTPUTS} rather than a new binary in the repository. The
 * master is the owner's (ADR-0002): this script resizes and converts it and never alters a mark.
 *
 * **ONE MASTER SINCE 2026-10-04**, by the owner's decision in ADR-0002's note of that day. There were
 * three until 2026-09-23 and two until then — the mark with its wordmark for the start screen,
 * About and the README, and the mark alone for the small sizes and the icon. The start screen and
 * About already set the name as text, so the picture no longer carries it, and nothing is left to
 * choose between: there is no master column here, because a column with one value is a choice the
 * next reader has to rediscover is not one.
 *
 * Some outputs are committed rather than built on demand, and the reason is specific: GitHub
 * renders README.md with no build step, the renderer imports its two sizes, and packaging needs an
 * `.ico` on disk. Committing a *generated* file is acceptable where regenerating it is one command
 * and CI proves it matches; committing a hand-made one is not.
 *
 * Usage: node scripts/brand/generateAssets.mjs [--check]
 *   --check  regenerate into memory and fail if a committed file differs, or if a master is not
 *            the shape every output assumes — an alpha channel and transparent corners.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

import { formatError } from '../lib/reportError.mjs';
import { MASTER, MASTER_FILE } from './brandMaster.mjs';
import { shapeProblem } from './brandShape.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = join(REPO_ROOT, 'assets', 'brand');

/**
 * Committed outputs, each a square of `size` from the master.
 *
 * `logo-256.png` is what README.md displays: 256 px keeps a 132 px render crisp on a 2x display
 * without shipping a megabyte to every reader of the front page. `logo-hero.png`,
 * `logo-hero@2x.png` and `logo-title.png` are what the RENDERER draws — the start screen's hero
 * at 142 px (`--logo-hero`), from the 1x file on a 1x display and the 2x file on a 2x one so each
 * draws real pixels without downscaling twice its size, and the mark at 18 px in the menu bar
 * (ADR-0107), at least twice that.
 *
 * @type {readonly {file: string, size: number}[]}
 */
const OUTPUTS = [
  { file: 'logo-256.png', size: 256 },
  { file: 'logo-hero.png', size: 142 },
  { file: 'logo-hero@2x.png', size: 284 },
  { file: 'logo-title.png', size: 52 },
];

/** Square sizes packed into the Windows `.ico` the packaged application carries. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * A square of `size` from a master. `fit: 'contain'` preserves the aspect ratio and pads with
 * transparency; the alternative, `fill`, would stretch a mark, which ADR-0002 rules out.
 *
 * @param {Buffer} master
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
function square(master, size) {
  return sharp(master)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const check = process.argv.includes('--check');
  /** @type {string[]} */
  const stale = [];

  const master = await readFile(MASTER);
  const problem = await shapeProblem(master);
  if (problem !== null) stale.push(`${MASTER_FILE} (${problem})`);

  for (const { file, size } of OUTPUTS) {
    const generated = await square(master, size);
    const path = join(BRAND, file);
    if (check) {
      const existing = await readFile(path).catch(() => null);
      if (existing === null || digest(existing) !== digest(generated)) stale.push(file);
      continue;
    }
    await writeFile(path, generated);
    process.stderr.write(`  wrote ${file} (${String(size)} px from ${MASTER_FILE}, ${String(generated.length)} bytes)\n`);
  }

  const icoPath = join(BRAND, 'logo.ico');
  const ico = await pngToIco(await Promise.all(ICO_SIZES.map((size) => square(master, size))));
  if (check) {
    const existing = await readFile(icoPath).catch(() => null);
    if (existing === null || digest(existing) !== digest(ico)) stale.push('logo.ico');
  } else {
    await writeFile(icoPath, ico);
    process.stderr.write(`  wrote logo.ico (${ICO_SIZES.join(', ')} px from ${MASTER_FILE}, ${String(ico.length)} bytes)\n`);
  }

  if (stale.length > 0) {
    process.stderr.write(
      `\nBrand assets are not what their masters produce: ${stale.join(', ')}\n\n` +
        `  Run:  node scripts/brand/generateAssets.mjs\n\n` +
        `A committed output that no longer matches the master is the drift one source ` +
        `exists to prevent; a master of the wrong shape is the owner's to replace.\n`,
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
