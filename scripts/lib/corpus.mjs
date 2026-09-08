// @ts-check
/**
 * The supplied document corpus, and the three rules on it, made mechanical.
 *
 * ## What it is
 *
 * A small set of real PDFs from different producers, supplied by the project
 * owner. It lives **outside this repository** and is never committed — it is not
 * ours to publish, and B10 makes a push permanent. `MONSTERA_CORPUS` names the
 * directory it is in.
 *
 * Three rules govern it, and each is implemented here rather than restated at
 * every call site, because a rule that lives in call sites is one the next
 * caller re-derives (B3a).
 *
 * ## Rule 1 — nothing from a corpus document is ever quoted
 *
 * Not its text, not a field value, **not a filename**. Findings are scores and
 * shapes — *"two lines merged where the column gap is under 8pt"* — and where a
 * case needs the shape, you build a synthetic fixture and commit that.
 *
 * **So this module never hands a caller a name or a path.** A document arrives
 * as `{ id: 'corpus-1', bytes, size }`, where the id is its position in sorted
 * order and carries nothing about the file. An instrument cannot print what it
 * was never given, which is B5 over a rule someone has to remember: the illegal
 * state is *a corpus filename in committed output*, and the way to make it
 * unrepresentable is to keep the name on this side of the boundary.
 *
 * The size is given because it is a shape rather than content, and an instrument
 * that reports a score across three documents needs to say whether they were
 * comparable.
 *
 * ## Rule 2 — three documents build a harness; they do not tune a constant
 *
 * Enough to catch a gross failure, not enough to fit a number to. {@link
 * corpusCaveat} is the sentence to print, and it names the count **this run
 * found** rather than a literal — a compensation that could have been printed
 * before you ran anything is a disclaimer, and by the third reading it is
 * furniture.
 *
 * Changing a constant on the strength of a corpus score needs the owner asked
 * first. That one cannot be mechanised and is stated here so it is at least in
 * the same file as the two that can.
 *
 * ## Rule 3 — an absent corpus is unverifiable, and never a pass
 *
 * The variable says *where the corpus is*. It never says *skip the tuning*. So a
 * missing one returns an outcome from `unverifiable.mjs`'s discipline — the same
 * three states every other could-not-look in this repository uses — rather than
 * an empty list, which reads exactly like a corpus that found nothing wrong.
 *
 * ## And a fourth thing, which is not a rule but follows from B10
 *
 * A corpus directory **inside the repository** is refused. Pointing the variable
 * at a path under the working tree is how three documents that must never be
 * committed end up staged by a `git add -A`, and no other guard here would see
 * it: they are ordinary PDFs with ordinary names.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { unverifiableOutcome } from './unverifiable.mjs';

/** The environment variable that names the corpus directory. */
export const CORPUS_VARIABLE = 'MONSTERA_CORPUS';

/**
 * A corpus document, with nothing in it that could be quoted.
 *
 * @typedef {object} CorpusDocument
 * @property {string} id an opaque, stable label — `corpus-1`, `corpus-2`, …
 * @property {Buffer} bytes the document
 * @property {number} size its length, which is a shape rather than content
 */

/**
 * @typedef {object} CorpusReading
 * @property {true} available
 * @property {readonly CorpusDocument[]} documents in sorted order, ids assigned
 *   by position so the same document keeps the same id between runs
 */

/**
 * @typedef {object} AbsentCorpus
 * @property {false} available
 * @property {import('./unverifiable.mjs').UnverifiableOutcome} outcome what the
 *   caller should print and exit with — NOT an empty document list
 */

/**
 * The sentence an instrument prints beside any figure it took from the corpus.
 *
 * @param {number} count how many documents this run actually read
 * @returns {string}
 */
export function corpusCaveat(count) {
  return (
    `  Read from ${String(count)} corpus document(s). That is enough to build a harness and ` +
    `catch a gross failure,\n  and not enough to tune a constant against — this is a shape, ` +
    `not an accuracy figure.`
  );
}

/**
 * Opens the corpus, or says why it could not.
 *
 * @param {object} [options]
 * @param {boolean} [options.required] whether a job that supplies the corpus is
 *   asking, in which case a missing one is a failure rather than an absence.
 * @returns {CorpusReading | AbsentCorpus}
 */
export function openCorpus({ required = false } = {}) {
  const configured = process.env[CORPUS_VARIABLE];
  const absent = (/** @type {string} */ why) =>
    /** @type {AbsentCorpus} */ ({
      available: false,
      outcome: unverifiableOutcome({
        required,
        subject: 'the document corpus',
        why,
        flag: `--require-corpus`,
      }),
    });

  if (configured === undefined || configured.trim() === '') {
    return absent(
      `${CORPUS_VARIABLE} is not set, so no corpus was read. It names a directory OUTSIDE ` +
        `this repository holding the supplied documents.`,
    );
  }

  const directory = resolve(configured);
  let entries;
  try {
    if (!statSync(directory).isDirectory()) {
      return absent(`${CORPUS_VARIABLE} points at ${directory}, which is not a directory.`);
    }
    entries = readdirSync(directory);
  } catch (error) {
    return absent(
      `${CORPUS_VARIABLE} points at ${directory}, which could not be read: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // INSIDE THE REPOSITORY IS REFUSED, and it is a throw rather than an absence:
  // an absence reads as "you have no corpus" and the caller then proceeds
  // without one, where this is a configuration that will commit three documents
  // the first time anyone runs `git add -A`. B10 makes that permanent.
  // `relative` answers '' for the root itself and an ABSOLUTE path when the two
  // are on different Windows drives, so both are checked: an empty string is
  // the repository root, which is the most dangerous value of all and the one a
  // "not empty" test would wave through.
  const inside = relative(repoRoot(), directory);
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new Error(
      `${CORPUS_VARIABLE} points at ${directory}, which is INSIDE this repository ` +
        `(${inside === '' ? 'it IS the repository root' : inside}). ` +
        `The corpus is supplied, is not ours to publish, and is never committed — and nothing ` +
        `else here would catch it, because these are ordinary PDFs with ordinary names. Move ` +
        `it outside the working tree.`,
    );
  }

  const files = entries.filter((entry) => entry.toLowerCase().endsWith('.pdf')).sort();

  // AN EMPTY RESULT FROM A DIRECTORY THAT EXISTS IS A BROKEN LOOKUP, not a
  // clean one. A caller asked for documents and got none, and "the corpus found
  // nothing wrong" is what every score computed over zero documents says.
  if (files.length === 0) {
    throw new Error(
      `${CORPUS_VARIABLE} points at ${directory}, which holds ${String(entries.length)} ` +
        `entries and no .pdf among them. A corpus of zero documents produces a clean score ` +
        `for every question asked of it, so this is refused rather than reported.`,
    );
  }

  return {
    available: true,
    documents: files.map((name, index) => {
      const bytes = readFileSync(resolve(directory, name));
      // The name goes no further than this line. See rule 1.
      return { id: `corpus-${String(index + 1)}`, bytes, size: bytes.length };
    }),
  };
}
