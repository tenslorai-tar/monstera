// @ts-check
/**
 * The OCR language set and the models on disk are the same set.
 *
 * ## Two hand-kept lists, and this is the thing that stops them drifting
 *
 * `OCR_LANGUAGES` is what a person may choose and what the payload's schema
 * accepts. `TESSDATA_MODELS` is what gets fetched, and it cannot be derived
 * from the first: provisioning runs on a **cold machine**, before anything is
 * built, so it cannot import the contract's output. Two lists, then — and the
 * failure they invite is asymmetric:
 *
 * - a language in the ENUM and not the table is a name a person can pick whose
 *   model was never fetched, which fails at recognition time on a document;
 * - a language in the TABLE and not the enum is 1–3 MB of installer nothing can
 *   reach.
 *
 * The first is the one that reaches a reader, so the check runs **both
 * directions** rather than asserting a count. A count agrees with any pair of
 * lists the same length (audit item 4c).
 *
 * ## And the digests are checked against the files, where the files exist
 *
 * A pinned digest that nothing compares is a comment. On a machine that has
 * provisioned, every model is hashed and matched; on one that has not, the
 * whole group is UNVERIFIABLE rather than passing — a proof about models that
 * are not there is the reassuring answer for a question about their contents.
 *
 * Usage: node scripts/proofs/ocrModels.proof.mjs [--require-models]
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACT_TYPES, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { partialOutcome } from '../lib/unverifiable.mjs';
import {
  TESSDATA_MODELS,
  TESSDATA_TOTAL_BYTES,
  tessdataPath,
} from '../provision/tessdata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE_MODELS = process.argv.includes('--require-models');

// The enum this compares against is the BUILT one, so a stale build would tie
// the provisioning table to yesterday's language set.
refuseStaleBuild(root, CONTRACT_TYPES, 2);

const { OCR_LANGUAGES } = await import('../../packages/contract/dist/channels.js');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/**
 * @param {string} label
 * @param {boolean} condition
 * @param {string} detail
 * @param {boolean} [ran]
 */
function check(label, condition, detail, ran = true) {
  const mark = roster.mark();
  if (ran && !condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label, ran);
}

// WIDENED TO `string[]` ON PURPOSE. The enum's literal type would make
// `declared.includes(language)` a compile error rather than a comparison — and
// the whole subject here is whether two lists of strings agree at RUN time, on
// a table the compiler cannot see into.
/** @type {string[]} */
const declared = [...OCR_LANGUAGES];
/** @type {string[]} */
const provisioned = TESSDATA_MODELS.map((model) => model.language);

check(
  'every language a person may choose has a model in the provisioning table',
  declared.every((language) => provisioned.includes(language)),
  `${JSON.stringify(declared.filter((language) => !provisioned.includes(language)))} are offered ` +
    'and never fetched — which fails at recognition time, on a document, after the wait',
);
check(
  'and every model fetched is a language somebody can choose',
  provisioned.every((language) => declared.includes(language)),
  `${JSON.stringify(provisioned.filter((language) => !declared.includes(language)))} are fetched ` +
    'and unreachable — megabytes of installer for a name no schema accepts',
);
check(
  'the founding record asks for 13 or more, and this is not fewer',
  declared.length >= 13,
  `${String(declared.length)} languages — BUILD-PROMPT.md:473 says "13+ languages"`,
);
check(
  'CONTROL: the two lists are not the same object, so the pair above compares something',
  declared !== provisioned && declared.length > 0,
  'if one were derived from the other, both cases would pass for any content at all',
);

const present = TESSDATA_MODELS.filter((model) => existsSync(tessdataPath(root, model.language)));
if (present.length === 0) {
  // THROUGH THE MODULE THAT OWNS THE WORDING, never a sentence of my own.
  // `npm run local` matches on those tokens, so a hand-written *UNVERIFIABLE*
  // reads correctly to a person and files the run as a PASS —
  // `check:unverifiablespelling` caught exactly that here, on the first run.
  const missed = [
    'every provisioned model matches its pinned digest',
    'and its pinned size',
  ];
  for (const label of missed) check(label, false, '', false);
  process.stdout.write(roster.format('OCR model case'));
  const outcome = partialOutcome({
    required: REQUIRE_MODELS,
    ran: roster.passed.length,
    missed,
    why:
      'no model is provisioned here. `node scripts/provision/tessdata.mjs` fetches all fourteen, ' +
      `${String(TESSDATA_TOTAL_BYTES)} bytes, each verified against its pinned SHA-256.`,
    flag: '--require-models',
  });
  process[outcome.stream].write(outcome.text);
  process.exit(outcome.code);
}

const wrongDigest = present.filter((model) => {
  const bytes = readFileSync(tessdataPath(root, model.language));
  return createHash('sha256').update(bytes).digest('hex') !== model.sha256;
});
check(
  'every provisioned model matches its pinned digest',
  wrongDigest.length === 0,
  `${JSON.stringify(wrongDigest.map((model) => model.language))} differ from the pinned bytes. ` +
    'Both of Tesseract 5.5.2 live advisories are reached through a crafted model, so a model ' +
    'nobody pinned is the input this pin exists for',
);
const wrongSize = present.filter(
  (model) => statSync(tessdataPath(root, model.language)).size !== model.bytes,
);
check(
  'and its pinned size',
  wrongSize.length === 0,
  `${JSON.stringify(wrongSize.map((model) => model.language))} are not the size the table records`,
);

if (failures.length > 0) {
  process.stderr.write(
    `\nOCR models — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      '\n\n',
  );
  process.exit(1);
}

process.stdout.write(roster.format('OCR model case'));
process.stdout.write(
  `\n  ${String(present.length)} of ${String(TESSDATA_MODELS.length)} models present, ` +
    `${String(TESSDATA_TOTAL_BYTES)} bytes for the full set.\n`,
);
