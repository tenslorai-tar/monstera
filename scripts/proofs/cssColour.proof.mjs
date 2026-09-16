// @ts-check
/**
 * Proves the colour normaliser SEPARATES, which is the direction its callers cannot check.
 *
 * ## Why this file exists — audit finding IIIIII-1 (2026-09-16)
 *
 * `rgbToHex` began inside `rendererPolicy.proof.mjs` and moved to `scripts/lib/cssColour.mjs` when
 * `canvasPixels.proof.mjs` became its second caller. The consolidation is right — two spellings of
 * *what colour is this* is the shape B3a forbids — and the move carried no case with it.
 *
 * That matters more here than it would for an ordinary helper, because this function is applied to
 * **both operands of an equality**. A normaliser that mangles two different colours the same way
 * does not fail loudly: it makes them compare **equal**, and both proofs then report a match nobody
 * checked — the reassuring answer, produced by the instrument that was supposed to rule it out.
 *
 * So the load-bearing case is case 2, and it is the one a caller structurally cannot make: a proof
 * comparing a window's colour to a token's has nothing to say about two colours that differ by one
 * channel, because it never holds two colours it knows to be different.
 *
 * ## The alpha limit is PINNED rather than assumed
 *
 * The regex accepts `rgba()` and drops the alpha, so two colours differing only in opacity map to
 * one hex. That is safe where both sides are opaque — a window background and a computed chrome
 * surface both are — and it is exactly the false-match shape everywhere else. Case 6 states it, so
 * a caller that starts comparing translucent colours meets a recorded limit rather than a silent
 * agreement.
 *
 * Usage: node scripts/proofs/cssColour.proof.mjs
 */

import { rgbToHex } from '../lib/cssColour.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

try {
  // ---- 1. It JOINS the two notations, which is the whole reason it exists ----
  check(
    'the same colour written as rgb() and as hex normalises to one string',
    rgbToHex('rgb(18, 52, 86)') === rgbToHex('#123456'),
    `rgb(18, 52, 86) → ${rgbToHex('rgb(18, 52, 86)')}, #123456 → ${rgbToHex('#123456')}. ` +
      `getBackgroundColor() answers hex and getComputedStyle answers rgb(); a comparison that ` +
      `normalised neither would report a difference that is only a spelling.`,
  );

  // ---- 2. It SEPARATES, and this is the case a caller cannot make ----
  check(
    'two colours ONE CHANNEL apart do not normalise to the same string',
    rgbToHex('rgb(1, 2, 3)') !== rgbToHex('rgb(1, 2, 4)'),
    `rgb(1, 2, 3) → ${rgbToHex('rgb(1, 2, 3)')}, rgb(1, 2, 4) → ${rgbToHex('rgb(1, 2, 4)')}. ` +
      `This function runs on BOTH sides of every comparison that uses it, so a defect here does ` +
      `not fail loudly — it makes two different colours equal, and the callers report a match.`,
  );

  // ---- 3. Single-digit channels are PADDED, or the join in case 1 is false ----
  check(
    'a single-digit channel is padded, so rgb(1, 2, 3) meets #010203 rather than #123',
    rgbToHex('rgb(1, 2, 3)') === '#010203' && rgbToHex('rgb(1, 2, 3)') === rgbToHex('#010203'),
    `got ${rgbToHex('rgb(1, 2, 3)')}. Without the pad this is #123, which is a different colour ` +
      `in hex — the failure would read as a mismatch between two subsystems rather than as a bug ` +
      `in this line.`,
  );

  // ---- 4. Hex case is not a difference ----
  check(
    'hex is lower-cased, so #AABBCC and #aabbcc are one colour',
    rgbToHex('#AABBCC') === '#aabbcc' && rgbToHex('#AABBCC') === rgbToHex('#aabbcc'),
    `#AABBCC → ${rgbToHex('#AABBCC')}. Chromium reports hex in either case depending on the API.`,
  );

  // ---- 5. Unparseable stays unparseable, and two of them stay apart ----
  check(
    'a value this cannot read is returned unchanged, and two such values stay different',
    rgbToHex('var(--surface)') === 'var(--surface)' &&
      rgbToHex('var(--surface)') !== rgbToHex('var(--bg)'),
    `var(--surface) → ${rgbToHex('var(--surface)')}, var(--bg) → ${rgbToHex('var(--bg)')}. ` +
      `A parse failure that answered a colour — or one constant — would make every unreadable ` +
      `value match every other one, which is the blind-instrument shape with a colour in it.`,
  );

  // ---- 6. THE STATED LIMIT: alpha is dropped ----
  check(
    'alpha is DROPPED, which is a limit rather than a feature: two opacities of one colour agree',
    rgbToHex('rgba(1, 2, 3, 0.5)') === '#010203' &&
      rgbToHex('rgba(1, 2, 3, 0.5)') === rgbToHex('rgb(1, 2, 3)'),
    `rgba(1, 2, 3, 0.5) → ${rgbToHex('rgba(1, 2, 3, 0.5)')}. Pinned rather than assumed: both ` +
      `current callers compare opaque colours, and a caller that starts comparing translucent ` +
      `ones needs to meet this case rather than a silent agreement.`,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nCSS-colour proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('css-colour case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
