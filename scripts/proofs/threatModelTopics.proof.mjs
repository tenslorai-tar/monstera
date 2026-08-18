// @ts-check
/**
 * Proof that the carried threat-model questions actually fire (rule B2).
 *
 * These checks guard a document that does not exist yet, which means nothing
 * exercises them in the ordinary course of work: `check:docs` finds no threat
 * model, skips the block, and prints ok. A requirement that has never once been
 * observed to fail is indistinguishable from one that cannot.
 *
 * Three cases per topic, and the third is the one that matters:
 *
 *   - a document that says nothing about the subject fails;
 *   - a document that MENTIONS the subject without engaging with it fails,
 *     because the realistic failure is a component list rather than a silence —
 *     "Leptonica 1.87.0" in a dependency table, or "we only open PDFs";
 *   - a document that raises it properly PASSES. Without this the patterns could
 *     reject everything and every case above would still be green.
 *
 * Usage: node scripts/proofs/threatModelTopics.proof.mjs
 */

import { THREAT_MODEL_TOPICS, unraisedTopics } from '../lib/threatModelTopics.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** A threat model that raises both questions the way they are meant to be raised. */
const COMPLETE = `
# Threat model

## Untrusted document input

The document is the largest thing an attacker controls. \`fz_open_document\`
selects a handler by scoring each registered one against the stream's content as
well as against the filename, so a file presented as a PDF may be handled by the
EPUB, XPS, CBZ or MOBI parser. Fourteen handlers are registered and the set is
inherited from MuPDF's build defaults rather than named here.

## OCR

Leptonica parses image formats, so once OCR is reachable it decodes
attacker-controlled bytes taken from the document. Tesseract's exposure is
different: its inputs are model files we ship.
`;

/** Names both subjects, engages with neither. The realistic failure. */
const SHALLOW = `
# Threat model

## Components

- MuPDF 1.28.0
- Leptonica 1.87.0
- Tesseract 5.5.2

We only open PDFs, so the document handler question does not arise.
`;

const SILENT = `
# Threat model

The renderer is sandboxed and holds no filesystem path.
`;

{
  const problems = unraisedTopics(COMPLETE, 'docs/security/THREAT-MODEL.md');
  check(
    'CONTROL: a document that raises both questions properly passes',
    problems.length === 0,
    `reported ${problems.length}: ${problems.join(' | ')} — if a correct document cannot pass, ` +
      `the patterns reject everything and every failing case below is vacuous`,
  );
}

{
  const problems = unraisedTopics(SILENT, 'docs/security/THREAT-MODEL.md');
  check(
    'a document silent on both subjects fails once per topic',
    problems.length === THREAT_MODEL_TOPICS.length,
    `reported ${problems.length} of ${THREAT_MODEL_TOPICS.length}: ${problems.join(' | ') || '(none)'}`,
  );
}

{
  const problems = unraisedTopics(SHALLOW, 'docs/security/THREAT-MODEL.md');
  check(
    'RESOLUTION: naming the subjects without engaging with them still fails',
    problems.length === THREAT_MODEL_TOPICS.length,
    `reported ${problems.length} of ${THREAT_MODEL_TOPICS.length}: ${problems.join(' | ') || '(none)'} ` +
      `— a component list and a sentence about intent are exactly what a threat model written in ` +
      `a hurry looks like, and a check that accepts them enforces nothing`,
  );

  check(
    'and it says the document is shallow rather than silent',
    problems.every((problem) => !problem.includes('does not mention') && !problem.includes('does not raise')),
    `messages: ${problems.join(' | ')} — telling an author "you did not mention Leptonica" when ` +
      `they did sends them to fix the wrong thing`,
  );
}

for (const topic of THREAT_MODEL_TOPICS) {
  check(
    `${topic.name}: its engages pattern is stricter than its subject pattern`,
    topic.subject.test(COMPLETE) && topic.engages.test(COMPLETE) && !topic.engages.test(SHALLOW),
    'a topic whose two patterns accept the same texts collapses into one check, and the ' +
      'shallow case stops being detectable',
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nThreat-model topics proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} threat-model topic cases passed.\n`);
