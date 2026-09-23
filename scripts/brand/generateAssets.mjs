// @ts-check
/**
 * Derives every logo size the project needs from the owner's three masters.
 *
 * Each output has exactly one master, named in {@link OUTPUTS} (B3): a size can never drift from
 * the artwork it represents, and adding a size is a line here rather than a new binary in the
 * repository. The masters are the owner's (ADR-0002, and its note of 2026-09-19): this script
 * resizes and converts them and never alters a mark.
 *
 * - `monstera_new_logo.png` — the mark with its wordmark, for where the name is legible;
 * - `monstera_logo_no_text.png` — the mark alone, for sizes where a word cannot be read, and for
 *   the application icon.
 *
 * **There were three, and `monstera_logo_square.png` was retired on 2026-09-23** by the owner's
 * order: the mark alone is the icon, the taskbar button, the title bar, the Store tiles and the PDF
 * file-type icon. It fed nothing but `logo.ico`, so retiring it is one role and one master fewer
 * rather than a size to re-point.
 *
 * Which master feeds which output is this build's reading of those names, recorded in ADR-0002's
 * note so the owner can move a line rather than rediscover the choice.
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
import { shapeProblem } from './brandShape.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRAND = join(REPO_ROOT, 'assets', 'brand');

/** The owner's masters, by the role each plays. */
const MASTERS = {
  wordmark: 'monstera_new_logo.png',
  mark: 'monstera_logo_no_text.png',
};

/**
 * Committed outputs, each from one master.
 *
 * `logo-256.png` is what README.md displays: 256 px keeps a 132 px render crisp on a 2x display
 * without shipping a megabyte to every reader of the front page. `logo-hero.png` and
 * `logo-title.png` are what the RENDERER draws — the start screen's hero at 84 px and the title
 * bar at 26 px (`tokens.css`) — each at twice that so a 2x display draws real pixels. The masters
 * are square, so each is a square of `size`; the title bar takes the mark without its word, which
 * at 26 px is a smudge rather than a name.
 *
 * @type {readonly {file: string, master: keyof typeof MASTERS, size: number}[]}
 */
const OUTPUTS = [
  { file: 'logo-256.png', master: 'wordmark', size: 256 },
  { file: 'logo-hero.png', master: 'wordmark', size: 168 },
  { file: 'logo-title.png', master: 'mark', size: 52 },
];

/** Square sizes packed into the Windows `.ico` the packaged application carries, from the mark. */
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

  /** @type {Record<keyof typeof MASTERS, Buffer>} */
  const masters = {
    wordmark: await readFile(join(BRAND, MASTERS.wordmark)),
    mark: await readFile(join(BRAND, MASTERS.mark)),
  };
  for (const [role, bytes] of Object.entries(masters)) {
    const problem = await shapeProblem(bytes);
    if (problem !== null) stale.push(`${MASTERS[/** @type {keyof typeof MASTERS} */ (role)]} (${problem})`);
  }

  for (const { file, master, size } of OUTPUTS) {
    const generated = await square(masters[master], size);
    const path = join(BRAND, file);
    if (check) {
      const existing = await readFile(path).catch(() => null);
      if (existing === null || digest(existing) !== digest(generated)) stale.push(file);
      continue;
    }
    await writeFile(path, generated);
    process.stderr.write(`  wrote ${file} (${String(size)} px from ${MASTERS[master]}, ${String(generated.length)} bytes)\n`);
  }

  const icoPath = join(BRAND, 'logo.ico');
  const ico = await pngToIco(await Promise.all(ICO_SIZES.map((size) => square(masters.mark, size))));
  if (check) {
    const existing = await readFile(icoPath).catch(() => null);
    if (existing === null || digest(existing) !== digest(ico)) stale.push('logo.ico');
  } else {
    await writeFile(icoPath, ico);
    process.stderr.write(`  wrote logo.ico (${ICO_SIZES.join(', ')} px from ${MASTERS.mark}, ${String(ico.length)} bytes)\n`);
  }

  if (stale.length > 0) {
    process.stderr.write(
      `\nBrand assets are not what their masters produce: ${stale.join(', ')}\n\n` +
        `  Run:  node scripts/brand/generateAssets.mjs\n\n` +
        `A committed output that no longer matches its master is the drift one source per ` +
        `output exists to prevent; a master of the wrong shape is the owner's to replace.\n`,
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
