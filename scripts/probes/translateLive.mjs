// @ts-check
/**
 * One page translated against the LIVE Claude API, written into the page, saved and reopened —
 * Translate document text's live test (ADR-0097).
 *
 * `claudeLive.mjs`' shape and its reasons: `contractHandlers.test.ts` drives the request and the
 * reading of the answer through an injected `fetch`, which asserts a reading of the protocol; only a
 * real call says whether a real model answers an array of exactly the blocks sent. That needs a key
 * this repository must never hold (B10), so a person runs it. No workflow runs `scripts/probes/`.
 *
 * ## The CHEAPEST Claude model, by the owner's order
 *
 * *"Every live AI test uses the cheapest Claude model. Take its id from Anthropic's models
 * endpoint."* The endpoint states no prices, so the rule is the family: the first model it lists
 * whose id names Haiku — the list is newest first. Its id is printed, and none is hard-coded here: a
 * name written into this file would be the model that was cheapest on the day it was written.
 *
 * ## Where the key comes from, and where it never goes
 *
 * `MONSTERA_ANTHROPIC_KEY`, read once, sent only in the `x-api-key` header the kernel sets; never
 * printed, logged, written or put in a URL. **Absent, it reports UNVERIFIABLE and never a pass.**
 *
 * ## What it asserts, and its controls
 *
 * The page is DRAWN here, never a corpus document: an English heading and paragraph, and a block of
 * digits that has nothing to translate.
 *
 * - PREMISE: the drawn page reads back in English before anything is written;
 * - the answer is an array of exactly the blocks sent, or the run fails by name;
 * - after the write, the saved and REOPENED page says every translated block, and no longer says the
 *   English words it replaced;
 * - CONTROL: the digits block is unchanged, so a write that blanked the page fails too.
 *
 * Usage, in one shell, for one run:
 *
 *     MONSTERA_ANTHROPIC_KEY=<key> npm run probe:translate
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';

import { listModels } from '../../packages/kernel/dist/aiModels.js';
import { streamChat } from '../../packages/kernel/dist/aiChat.js';
import { openPdfium, pageText, pdfiumWriter, textRuns } from '../../packages/kernel/dist/pdfiumFfi.js';
import { localPdfiumExecution } from '../../packages/kernel/dist/pdfiumSpecs.js';
import { groupIntoBlocks } from '../../packages/kernel/dist/textLines.js';
import { readTranslation, translationInstruction, translationRequest } from '../../packages/kernel/dist/translation.js';
import { lineText } from '../../packages/shared/dist/index.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { unverifiableOutcome } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const KEY_VARIABLE = 'MONSTERA_ANTHROPIC_KEY';
const REQUIRE_FLAG = '--require-claude';
const HEADING = 'Monthly meeting';
const PARAGRAPH = ['The meeting is on Tuesday at noon in the library.', 'Please bring the signed forms with you.'];
const DIGITS = '2026-09-24  14:30  No. 4471';

const ROOT = repoRoot();

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/translation.ts', 'packages/kernel/dist/translation.js', 'tsc'],
    ['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc'],
    ['packages/kernel/src/pdfiumTextEdit.ts', 'packages/kernel/dist/pdfiumTextEdit.js', 'tsc'],
    ['packages/kernel/src/aiChat.ts', 'packages/kernel/dist/aiChat.js', 'tsc'],
  ],
  4,
);

const key = process.env[KEY_VARIABLE] ?? '';
if (key === '') {
  const outcome = unverifiableOutcome({
    required: process.argv.includes(REQUIRE_FLAG),
    subject: 'a page translated against the live Claude API',
    why: `${KEY_VARIABLE} is not set, so no request was sent.`,
    flag: REQUIRE_FLAG,
  });
  (outcome.stream === 'stderr' ? process.stderr : process.stdout).write(outcome.text);
  process.exit(outcome.code);
}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`\nFAILED — ${message}\n`);
  process.exit(1);
}

const listed = await listModels({ provider: 'anthropic', key, endpoint: '' });
if (listed.problem !== undefined) fail(`the models endpoint answered ${listed.problem}.`);
const model = listed.models.find((entry) => /haiku/iu.test(entry.id));
if (model === undefined) fail(`no Haiku model among the ${String(listed.models.length)} the endpoint listed.`);
process.stdout.write(`model: ${model?.id ?? ''} (the first Haiku the models endpoint lists)\n`);

openPdfium(pdfiumLibrary(ROOT));
const document = await PDFDocument.create();
const page = document.addPage([500, 400]);
const font = await document.embedFont(StandardFonts.Helvetica);
page.drawText(HEADING, { x: 60, y: 330, size: 16, font });
for (const [at, line] of PARAGRAPH.entries()) page.drawText(line, { x: 60, y: 290 - at * 14, size: 11, font });
page.drawText(DIGITS, { x: 60, y: 120, size: 11, font });
const bytes = await document.save();

const session = await pdfiumWriter.open(bytes);
const { runs } = await textRuns(session, 0);
const before = await pageText(session, 0);
await pdfiumWriter.close(session);
if (!before.includes('meeting') || !before.includes('Tuesday')) fail('PREMISE — the drawn page does not read back in English.');
const blocks = groupIntoBlocks(runs);
const texts = blocks.map((block) => block.lines.map((line) => lineText(line.runs)).join('\n'));

const answer = await streamChat({
  provider: 'anthropic',
  model: model?.id ?? '',
  key,
  system: translationInstruction('French'),
  messages: [{ role: 'user', text: translationRequest(texts) }],
});
if (answer.refusal !== undefined) fail(`the provider refused: ${answer.refusal}.`);
const translated = readTranslation(answer.text, texts.length);
if (translated === undefined) fail(`the answer was not an array of exactly ${String(texts.length)} strings.`);
const changed = blocks.flatMap((block, at) =>
  translated?.[at] === undefined || translated[at] === texts[at]
    ? []
    : [{ lines: block.lines.map((line) => line.runs.map((run) => run.index)), text: translated[at] }],
);
if (changed.length === 0) fail('nothing came back changed, so nothing was translated.');

const written = await localPdfiumExecution.apply({
  session: bytes,
  command: /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<'editTextBlock'>} */ ({
    kind: 'editTextBlock',
    page: 0,
    blocks: changed.map((block) => ({ ...block, fit: /** @type {const} */ ('shrink') })),
    version: 1,
  }),
  source: undefined,
  reads: undefined,
});
const reopened = await pdfiumWriter.open(written);
const after = (await pageText(reopened, 0)).replace(/\s+/gu, ' ');
await pdfiumWriter.close(reopened);

/** @type {string[]} */
const failures = [];
for (const block of changed) {
  // EACH WORD OF THE TRANSLATION, because a block that grew is wrapped onto new lines and the
  // page's text then breaks it where the wrap did.
  const missing = block.text.split(/\s+/u).filter((word) => word !== '' && !after.includes(word));
  if (missing.length > 0) failures.push(`the saved page lacks ${String(missing.length)} word(s) of a translated block`);
}
for (const english of ['meeting', 'Tuesday', 'library', 'signed']) {
  if (after.includes(english)) failures.push(`the saved page still says "${english}"`);
}
if (!after.includes('4471')) failures.push('CONTROL — the digits block is gone, so the write blanked more than it translated');

if (failures.length > 0) {
  process.stderr.write(`\nFAILED — ${String(failures.length)} check(s):\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  `\nPASSED — ${String(changed.length)} of ${String(blocks.length)} block(s) came back translated, were written as one ` +
    'edit, and read back from the saved, reopened page; the English is gone and the digits are untouched.\n' +
    `saved page: ${after}\n`,
);
