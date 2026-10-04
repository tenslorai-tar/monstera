// @ts-check
/**
 * Proves the brand masters' shape check can see, refuse and separate.
 *
 * `brand:check` refuses a master with no alpha channel or an opaque corner (`brandShape.mjs`).
 * Its reassuring answer is *no problem*, which a check that could not see would also give — so
 * case 1 holds the owner's master to `null`, and cases 2 and 3 build the two refusals from
 * images that are otherwise fine. Case 4 is the control on what the check keys on: an image whose
 * CENTRE is opaque and whose corners are clear must pass, or the rule has become *any opaque
 * pixel*, which every real mark would fail.
 *
 * Usage: node scripts/proofs/brandShape.proof.mjs
 */

import { readFile } from 'node:fs/promises';

import sharp from 'sharp';

// ONE SINCE 2026-10-04, by the owner's decision (ADR-0002's note of that day), and named where the
// generator and the Store's images take it, so this case cannot hold a master nothing reads.
import { MASTER, MASTER_FILE } from '../brand/brandMaster.mjs';
import { shapeProblem } from '../brand/brandShape.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * A 64 × 64 image, transparent unless `paint` says otherwise for a pixel.
 *
 * @param {(x: number, y: number) => boolean} paint
 * @param {boolean} [alpha]
 */
async function built(paint, alpha = true) {
  const channels = alpha ? 4 : 3;
  const data = Buffer.alloc(64 * 64 * channels);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const at = (y * 64 + x) * channels;
      data[at] = 40;
      data[at + 1] = 160;
      data[at + 2] = 60;
      if (alpha) data[at + 3] = paint(x, y) ? 255 : 0;
    }
  }
  return sharp(data, { raw: { width: 64, height: 64, channels } }).png().toBuffer();
}

try {
  const answer = await shapeProblem(await readFile(MASTER));
  check("the owner's master has the shape every output assumes", answer === null, `${MASTER_FILE}: ${String(answer)}`);

  const noAlpha = await shapeProblem(await built(() => true, false));
  check('an image with no alpha channel is refused, by name', noAlpha === 'it has no alpha channel', `got ${String(noAlpha)}`);

  const corner = await shapeProblem(await built((x, y) => x === 63 && y === 0));
  check(
    'ONE opaque corner is refused, and counted',
    corner === '1 of its corners are not transparent',
    `got ${String(corner)}. The fixture is transparent everywhere except that corner.`,
  );

  const centre = await shapeProblem(await built((x, y) => x > 8 && x < 56 && y > 8 && y < 56));
  check(
    'CONTROL: an opaque centre with clear corners PASSES — the rule is about corners, not any pixel',
    centre === null,
    `got ${String(centre)}. Every real mark is opaque in the middle.`,
  );

  if (failures.length > 0) {
    process.stderr.write(`\nBrand-shape proof — ${failures.length} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('brand-shape case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
