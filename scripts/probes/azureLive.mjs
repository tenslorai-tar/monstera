// @ts-check
/**
 * One recognition against the LIVE Azure Document Intelligence service — the
 * trigger D6 row 8 has carried since it was built.
 *
 * ## Why a person has to run it
 *
 * All twelve of `ocrAzure.test.ts`' cases drive the protocol through an injected
 * `fetch` shaped from the documentation, so they assert a reading of the schema
 * rather than the service. Only a real call against a real resource can say the
 * reading was right, and that needs a key this repository must never hold (B10).
 * So CI never runs this — nothing under `scripts/probes/` is in a workflow — and
 * the owner runs it once, in one shell.
 *
 * ## Where the endpoint and key come from, and where they never go
 *
 * Two named environment variables, read once. **Never a file and never this
 * repository**: there is no `.env` here and there must not be one. Neither value
 * is printed, logged or put in a URL — the key travels only in the request
 * header `recogniseThroughAzure` sets, and this script writes nothing to disk.
 *
 * **Absent either one, it reports UNVERIFIABLE and never a pass** — through
 * `unverifiable.mjs`, the one owner of that verdict. `--require-azure` turns the
 * same absence into a failure, for a run whose whole purpose is the call.
 *
 * ## What it asserts, and its control
 *
 * The page is DRAWN here — a known word at a known point, never a corpus
 * document, whose content may not be quoted. That word is the positive control:
 * a service that answered nothing, or answered a correct text at the wrong place,
 * cannot satisfy it. The region is rasterised by the same `snapshotRegion` the
 * contained host runs, at the same `AZURE_RASTER_SCALE` main sends, so what is
 * proven is the shipped route rather than a harness's own.
 *
 * - a recognised word contains the drawn text;
 * - its box lies inside the region it was read from;
 * - its box sits over where the word was drawn — which is what separates a frame
 *   conversion that is right from one that is right about the text alone.
 *
 * Usage, in one shell, for one run:
 *
 *     MONSTERA_AZURE_DI_ENDPOINT=https://<resource>.cognitiveservices.azure.com \
 *     MONSTERA_AZURE_DI_KEY=<key> npm run probe:azure
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import {
  AZURE_RASTER_SCALE,
  AzureRecognitionRefused,
  recogniseThroughAzure,
} from '../../packages/kernel/dist/ocrAzure.js';
import { snapshotRegion } from '../../packages/kernel/dist/pageSnapshot.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { unverifiableOutcome } from '../lib/unverifiable.mjs';

const ENDPOINT_VARIABLE = 'MONSTERA_AZURE_DI_ENDPOINT';
const KEY_VARIABLE = 'MONSTERA_AZURE_DI_KEY';
const REQUIRE_FLAG = '--require-azure';

/** The drawn word and where it is drawn: `ocrRecognise.proof.mjs`' page, which rasterises legibly. */
const WORD = 'MONSTERA';
const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 300;
const DRAWN_X = 40;
const DRAWN_BASELINE = 230;
const DRAWN_SIZE = 28;

/** The region sent: the line the word is on, with room either side. */
const REGION = { x0: 20, y0: 200, x1: 380, y1: 270 };

/** How far outside a box may fall and still be the same box, in points. */
const SLACK = 2;

const ROOT = repoRoot();

// THE BUILT KERNEL IS THE SUBJECT, so a stale one would send last week's code to
// the service and print the answer under this week's name.
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/ocrAzure.ts', 'packages/kernel/dist/ocrAzure.js', 'tsc'],
    ['packages/kernel/src/pageSnapshot.ts', 'packages/kernel/dist/pageSnapshot.js', 'tsc'],
    ['packages/kernel/src/mupdfWriter.ts', 'packages/kernel/dist/mupdfWriter.js', 'tsc'],
  ],
  3,
);

const endpoint = (process.env[ENDPOINT_VARIABLE] ?? '').trim();
const key = process.env[KEY_VARIABLE] ?? '';

if (endpoint === '' || key === '') {
  const outcome = unverifiableOutcome({
    required: process.argv.includes(REQUIRE_FLAG),
    subject: 'Azure Document Intelligence against the live service',
    why: `${ENDPOINT_VARIABLE} and ${KEY_VARIABLE} are not both set, so no request was sent.`,
    flag: REQUIRE_FLAG,
  });
  (outcome.stream === 'stderr' ? process.stderr : process.stdout).write(outcome.text);
  process.exit(outcome.code);
}

/** The drawn word's region, rasterised the way the contained host rasterises one. */
async function rasterOfDrawnWord() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(WORD, { x: DRAWN_X, y: DRAWN_BASELINE, size: DRAWN_SIZE, font });
  const session = await mupdfWriter.open(await document.save());
  try {
    return await snapshotRegion(session, { page: 0, rect: REGION, scale: AZURE_RASTER_SCALE });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * The one real call. A refusal is reported BY ITS REASON and nothing else: the
 * message can name the endpoint's host, and this output is one a person may paste.
 *
 * @param {Awaited<ReturnType<typeof rasterOfDrawnWord>>} raster
 */
async function recognise(raster) {
  try {
    return await recogniseThroughAzure(
      { endpoint, key },
      {
        png: raster.png,
        crop: raster.crop,
        rotation: raster.rotation,
        origin: raster.origin,
        scale: AZURE_RASTER_SCALE,
      },
    );
  } catch (error) {
    if (error instanceof AzureRecognitionRefused) {
      process.stderr.write(
        `\nFAILED — the service refused the request: ${error.reason}. Nothing about the live ` +
          'service is proven by this run.\n',
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
  // OVER THE DRAWING: it starts near the drawn x, and it spans the baseline band
  // the glyphs occupy. A box inside the region but at its far end would pass the
  // check above and not this one.
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
  `\nPASSED — the live service read the drawn word, at ${String(words.length)} word(s) ` +
    'returned, with its box inside the region and over the drawing.\n',
);
