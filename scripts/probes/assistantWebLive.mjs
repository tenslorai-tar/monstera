// @ts-check
/**
 * The Assistant against the LIVE Anthropic API, both ways the switch can stand — work list 2026-09-26, item 5d, and
 * [ADR-0108](../../docs/DECISIONS/0108-the-web-is-the-providers-own-search-and-its-sources-stay-in-main.md).
 *
 * ## Why a person has to run it
 *
 * `aiChat.test.ts` drives every provider's web path through an injected `fetch` written from its documentation. Only a
 * real call says that Haiku 4.5 takes the search tool, that a search really shows itself in the stream the way the
 * reader looks for it, and that a model told *Document only* says so when the text does not answer. The owner's answer
 * of 2026-09-26: Anthropic alone runs live, on Haiku 4.5, with at most five searches — the tool's `max_uses`.
 *
 * ## Where the key comes from, and where it never goes
 *
 * `MONSTERA_ANTHROPIC_KEY`, read once, `claudeLive.mjs`' rule: never a file, never printed, logged or put in a URL — it
 * travels only in the `x-api-key` header `streamChat` sets. **Absent, it reports UNVERIFIABLE and never a pass**;
 * `--require-anthropic` turns that absence into a failure.
 *
 * ## What it asserts, and the control
 *
 * The document is a short text written here — never a corpus file — that does not name the bridge's chief engineer.
 *
 * - **Document only**: the answer names no search, and says the text does not answer (the words are matched loosely,
 *   and the answer itself is printed so a person reads what it said).
 * - **Document + web, the control**: the same question, the same model, the switch the other way — the provider reports
 *   a search and cites at least one HTTPS page. Without this run, the first would pass for a model that simply never
 *   searches whatever it is sent.
 *
 * Usage, in one shell, for one run:
 *
 *     MONSTERA_ANTHROPIC_KEY=<key> npm run probe:assistantweb
 */

import { streamChat } from '../../packages/kernel/dist/aiChat.js';
import { askInstruction, readAskWindow } from '../../packages/kernel/dist/askWindow.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { unverifiableOutcome } from '../lib/unverifiable.mjs';

const KEY_VARIABLE = 'MONSTERA_ANTHROPIC_KEY';
const REQUIRE_FLAG = '--require-anthropic';
/** The owner's model for live runs (2026-09-26). */
const MODEL = 'claude-haiku-4-5-20251001';
const PAGE = 'The Golden Gate Bridge opened to traffic in 1937. It spans the strait between San Francisco Bay and the Pacific.';
const QUESTION = 'Who was the chief engineer of the bridge?';
/** Loose on purpose: the model's words vary; what is checked is that it says the text does not answer. */
const SAYS_NOT_IN_TEXT =
  /\b(not|n['’]t)\b[^.]{0,60}\b(mention|say|state|include|contain|provide|name|specif|given|in the (text|document|page))/iu;

const ROOT = repoRoot();

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/aiChat.ts', 'packages/kernel/dist/aiChat.js', 'tsc'],
    ['packages/kernel/src/askWindow.ts', 'packages/kernel/dist/askWindow.js', 'tsc'],
  ],
  2,
);

const key = process.env[KEY_VARIABLE] ?? '';

if (key === '') {
  const outcome = unverifiableOutcome({
    required: process.argv.includes(REQUIRE_FLAG),
    subject: 'the Assistant’s Document only and Document + web against the live Anthropic API',
    why: `${KEY_VARIABLE} is not set, so no request was sent.`,
    flag: REQUIRE_FLAG,
  });
  (outcome.stream === 'stderr' ? process.stderr : process.stdout).write(outcome.text);
  process.exit(outcome.code);
}

const window = await readAskWindow([0], 1, () => Promise.resolve(PAGE));

/**
 * One ask, as `main` makes it.
 *
 * @param {boolean} web
 */
async function ask(web) {
  return streamChat({
    provider: 'anthropic',
    model: MODEL,
    key,
    messages: [{ role: 'user', text: QUESTION }],
    system: askInstruction(window, 'page', web),
    web,
  });
}

/** @type {string[]} */
const failures = [];

const only = await ask(false);
process.stdout.write(`\nDocument only — the answer:\n  ${only.text.replace(/\s+/gu, ' ').trim()}\n`);
if (only.refusal !== undefined) failures.push(`Document only was refused: ${only.refusal}`);
if (only.searched) failures.push('Document only reported a web search');
if (!SAYS_NOT_IN_TEXT.test(only.text)) failures.push('the Document only answer does not say the text does not answer');

const withWeb = await ask(true);
process.stdout.write(`\nDocument + web — the answer:\n  ${withWeb.text.replace(/\s+/gu, ' ').trim()}\n`);
process.stdout.write(`  searched: ${String(withWeb.searched)}; sources: ${withWeb.sources.map((source) => new URL(source.url).host).join(', ') || 'none'}\n`);
if (withWeb.refusal !== undefined) failures.push(`Document + web was refused: ${withWeb.refusal}`);
if (!withWeb.searched) failures.push('CONTROL: Document + web reported no search, so the first run separates nothing');
if (withWeb.sources.length === 0) failures.push('Document + web cited no HTTPS page');

if (failures.length > 0) {
  process.stderr.write(`\nFAILED — ${String(failures.length)} check(s):\n`);
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
  process.exit(1);
}

process.stdout.write(
  `\nPASSED — on ${MODEL}, Document only answered from the text and said it does not answer, with no search; ` +
    `Document + web searched and cited ${String(withWeb.sources.length)} page(s).\n`,
);
