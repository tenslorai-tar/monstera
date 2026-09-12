// @ts-check
/**
 * One recognition against the LIVE Claude API — D6's Claude row's trigger.
 *
 * `azureLive.mjs`' shape and its reasons, for the second network engine
 * ([ADR-0057](../../docs/DECISIONS/0057-a-network-recogniser-is-keyed-by-engine-and-a-providers-key-is-the-providers.md)).
 *
 * ## Why a person has to run it
 *
 * `ocrClaude.test.ts` drives the protocol through an injected `fetch` written from
 * Anthropic's documentation, so it asserts a reading of the documented request and
 * answer. Anthropic calls its coordinates *approximate*; only a real call says how
 * approximate, and that needs a key this repository must never hold (B10). No
 * workflow runs anything under `scripts/probes/`.
 *
 * ## Where the key comes from, and where it never goes
 *
 * One environment variable, read once: `MONSTERA_ANTHROPIC_KEY`. **Never a file and
 * never this repository.** It is not printed, logged or put in a URL — it travels
 * only in the `x-api-key` header `recogniseThroughClaude` sets — and this script
 * writes nothing to disk.
 *
 * **Absent, it reports UNVERIFIABLE and never a pass**, through `unverifiable.mjs`.
 * `--require-claude` turns the same absence into a failure.
 *
 * ## What it asserts, and its control
 *
 * The page is DRAWN here — a known word at a known point, never a corpus document.
 * The raster is sized the way main sizes it, by `claudeRasterScale` within the
 * snapshot floor, and produced by the same `snapshotRegion` the host runs.
 *
 * - a recognised word contains the drawn text;
 * - its box lies inside the region it was read from;
 * - its box sits over where the word was drawn.
 *
 * Usage, in one shell, for one run:
 *
 *     MONSTERA_ANTHROPIC_KEY=<key> npm run probe:claude
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { AZURE_RASTER_SCALE } from '../../packages/kernel/dist/ocrAzure.js';
import {
  ClaudeRecognitionRefused,
  claudeRasterScale,
  recogniseThroughClaude,
} from '../../packages/kernel/dist/ocrClaude.js';
import { MIN_SNAPSHOT_SCALE, snapshotRegion } from '../../packages/kernel/dist/pageSnapshot.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { unverifiableOutcome } from '../lib/unverifiable.mjs';

const KEY_VARIABLE = 'MONSTERA_ANTHROPIC_KEY';
const REQUIRE_FLAG = '--require-claude';

/** `azureLive.mjs`' drawn word and page, so the two engines are measured on one input. */
const WORD = 'MONSTERA';
const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 300;
const DRAWN_X = 40;
const DRAWN_BASELINE = 230;
const DRAWN_SIZE = 28;
const REGION = { x0: 20, y0: 200, x1: 380, y1: 270 };
const SLACK = 2;

const ROOT = repoRoot();

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/ocrClaude.ts', 'packages/kernel/dist/ocrClaude.js', 'tsc'],
    ['packages/kernel/src/pageSnapshot.ts', 'packages/kernel/dist/pageSnapshot.js', 'tsc'],
    ['packages/kernel/src/mupdfWriter.ts', 'packages/kernel/dist/mupdfWriter.js', 'tsc'],
  ],
  3,
);

const key = process.env[KEY_VARIABLE] ?? '';

if (key === '') {
  const outcome = unverifiableOutcome({
    required: process.argv.includes(REQUIRE_FLAG),
    subject: 'Claude recognition against the live API',
    why: `${KEY_VARIABLE} is not set, so no request was sent.`,
    flag: REQUIRE_FLAG,
  });
  (outcome.stream === 'stderr' ? process.stderr : process.stdout).write(outcome.text);
  process.exit(outcome.code);
}

// THE SCALE MAIN WOULD CHOOSE, by the function main calls, within the floor the
// host refuses below.
const scale = claudeRasterScale(
  REGION.x1 - REGION.x0,
  REGION.y1 - REGION.y0,
  AZURE_RASTER_SCALE,
  MIN_SNAPSHOT_SCALE,
);
if (scale === null) {
  process.stderr.write('\nFAILED — the drawn region does not fit Claude’s image limits at any scale.\n');
  process.exit(1);
}

/** The drawn word's region, rasterised the way the contained host rasterises one. */
async function rasterOfDrawnWord() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(WORD, { x: DRAWN_X, y: DRAWN_BASELINE, size: DRAWN_SIZE, font });
  const session = await mupdfWriter.open(await document.save());
  try {
    return await snapshotRegion(session, { page: 0, rect: REGION, scale: Number(scale) });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The one real call. A refusal is reported BY ITS REASON and nothing else.
 *
 * @param {Awaited<ReturnType<typeof rasterOfDrawnWord>>} raster
 */
async function recognise(raster) {
  try {
    return await recogniseThroughClaude(
      { key },
      {
        png: raster.png,
        crop: raster.crop,
        rotation: raster.rotation,
        origin: raster.origin,
        scale: Number(scale),
      },
    );
  } catch (error) {
    if (error instanceof ClaudeRecognitionRefused) {
      process.stderr.write(
        `\nFAILED — the API refused or could not be read: ${error.reason}. Nothing about the ` +
          'live service is proven by this run.\n',
      );
      process.exit(1);
    }
    throw error;
  }
}

const recognised = await recognise(await rasterOfDrawnWord());
const words = recognised.lines.flatMap((line) => line.words);
const found = words.find((word) => word.text.toUpperCase().includes(WORD));

/** @type {string[]} */
const failures = [];
if (found === undefined) {
  failures.push(
    `no recognised word contains the drawn text — ${String(words.length)} word(s) came back`,
  );
} else {
  const [x0, y0, x1, y1] = found.box;
  const box = `[${found.box.map((value) => value.toFixed(1)).join(', ')}]`;
  if (
    x0 < REGION.x0 - SLACK ||
    x1 > REGION.x1 + SLACK ||
    y0 < REGION.y0 - SLACK ||
    y1 > REGION.y1 + SLACK
  ) {
    failures.push(`the word's box ${box} is not inside the region it was read from`);
  }
  if (x0 > DRAWN_X + DRAWN_SIZE || y1 < DRAWN_BASELINE || y0 > DRAWN_BASELINE + DRAWN_SIZE) {
    failures.push(`the word's box ${box} does not sit over where the word was drawn`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`\nFAILED — ${String(failures.length)} check(s):\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `\nPASSED — the live API read the drawn word, at ${String(words.length)} word(s) returned, ` +
    'with its box inside the region and over the drawing.\n',
);
