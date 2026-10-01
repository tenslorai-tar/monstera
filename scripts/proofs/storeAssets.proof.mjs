// @ts-check
/**
 * Proves the Store images are the set Microsoft's page names, at the sizes it gives, and derived from the mark without
 * stretching it or inventing a background.
 *
 * ## The anchor is a literal, and why
 *
 * `STORE_ASSETS` is derived from loops over sizes and scales, so a count computed from it agrees with a loop that lost
 * a size — the shrinkage a derived count cannot see (CLAUDE.md item 4c). The case below compares it with 73, read off
 * Microsoft's lists (14 target sizes × 3 forms, 5 app-list scales, 5 StoreLogo scales, 4 tiles × 5 scales, and the
 * listing's app tile icon), and names the three files the page marks as required to publish.
 *
 * ## Every image is READ BACK
 *
 * The sizes are asserted on the written files' own headers, not on the table that asked for them: a resize that
 * rounded differently, or a composite that grew its canvas, is only visible in the output.
 *
 * Usage: node scripts/proofs/storeAssets.proof.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';

import { STORE_ASSETS, writeStoreAssets } from '../brand/storeAssets.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * The alpha of one pixel of a written image.
 *
 * @param {string} path
 * @param {number} x
 * @param {number} y
 */
async function alphaAt(path, x, y) {
  const { data, info } = await sharp(readFileSync(path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3] ?? -1;
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-store-assets-'));

try {
  const written = await writeStoreAssets(scratch);

  check(
    'the set is Microsoft’s: 73 images, the three the Store requires among them',
    written === 73 &&
      STORE_ASSETS.length === 73 &&
      ['AppList.targetsize-256_altform-unplated.png', 'StoreLogo.scale-100.png', 'MedTile.scale-100.png'].every((file) =>
        STORE_ASSETS.some((asset) => asset.file === file),
      ),
    `wrote ${String(written)}, lists ${String(STORE_ASSETS.length)}.`,
  );

  /** @type {string[]} */
  const wrongSize = [];
  /** @type {string[]} */
  const noAlpha = [];
  for (const asset of STORE_ASSETS) {
    const meta = await sharp(readFileSync(join(scratch, asset.file))).metadata();
    if (meta.width !== asset.width || meta.height !== asset.height) {
      wrongSize.push(`${asset.file}: ${String(meta.width)}×${String(meta.height)}, wanted ${String(asset.width)}×${String(asset.height)}`);
    }
    if (meta.hasAlpha !== true) noAlpha.push(asset.file);
  }
  check('every image, read back, has the size Microsoft’s table gives it', wrongSize.length === 0, wrongSize.join('; '));
  check('every image keeps the master’s transparency — no background is invented', noAlpha.length === 0, noAlpha.join('; '));

  // THE TABLE'S ROUNDING, at the scales where it rounds: 150 at 125% is 188, 71 at 150% is 107.
  const med = STORE_ASSETS.find((asset) => asset.file === 'MedTile.scale-125.png');
  const small = STORE_ASSETS.find((asset) => asset.file === 'SmallTile.scale-150.png');
  check(
    'a scale is rounded as Microsoft’s table rounds it',
    med?.width === 188 && small?.width === 107,
    `MedTile at 125%: ${String(med?.width)}, SmallTile at 150%: ${String(small?.width)}.`,
  );

  // A TILE CARRIES THE MARK WITH ROOM ROUND IT, and the wide tile is not a stretched square: its left edge, a sixth
  // of the way in, is clear.
  const wide = join(scratch, 'WideTile.scale-100.png');
  check('the wide tile centres the mark and leaves its sides clear', (await alphaAt(wide, 20, 75)) === 0, 'alpha at (20, 75) is not zero.');

  // CONTROL for the case above: an ICON is filled by the mark, so its centre is not clear — a generator that wrote
  // empty canvases would pass the tile's case and fail this one.
  const icon = join(scratch, 'AppList.targetsize-256.png');
  check('CONTROL: an icon is filled by the mark — its centre is drawn', (await alphaAt(icon, 128, 128)) > 0, 'the icon’s centre is clear.');

  // AN ICON'S MARK RUNS ITS SQUARE'S FULL HEIGHT, as a first-party portrait icon does (Notepad's, on the owner's taskbar,
  // 2026-10-01): the master's transparent margin is trimmed before the fit. Fitting the master's canvas left the mark
  // 87–88% tall, so both rows below read clear — which the wide tile's case above shows a tile still does, on purpose.
  const unplated = join(scratch, 'AppList.targetsize-256_altform-unplated.png');
  /** @param {number} y */
  const rowDrawn = async (y) => {
    const { data, info } = await sharp(readFileSync(unplated)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let x = 0; x < info.width; x += 1) if ((data[(y * info.width + x) * info.channels + 3] ?? 0) > 0) return true;
    return false;
  };
  check(
    'an icon’s mark touches its square’s top and bottom rows — no margin of the master’s canvas is kept',
    (await rowDrawn(0)) && (await rowDrawn(255)),
    `top row drawn: ${String(await rowDrawn(0))}, bottom row drawn: ${String(await rowDrawn(255))}.`,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nStore-assets proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('Store-assets case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
