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
 * as `{ id: 'corpus-3f9a1c2b', bytes, size }`, where the id is derived from the
 * bytes and carries nothing about the file. An instrument cannot print what it
 * was never given, which is B5 over a rule someone has to remember: the illegal
 * state is *a corpus filename in committed output*, and the way to make it
 * unrepresentable is to keep the name on this side of the boundary.
 *
 * ## The id was POSITIONAL until 2026-09-10, and that was a compound claim
 *
 * It read *"the id is its position in sorted order"*, documented as *"assigned by
 * position so the same document keeps the same id between runs"*. The first half
 * is true — a run is deterministic — and it vouched for the second, which is a
 * different sentence: **inserting a name earlier in sorted order re-points every
 * id after it.** The corpus went from five documents to eleven and three of the
 * five ids moved, so four tables of recorded figures in `docs/JOURNAL.md` now
 * name documents they were not measured from.
 *
 * The failure is silent in both directions. A figure keyed on `corpus-3` is not
 * wrong-looking once `corpus-3` is a different document; it is a plausible figure
 * about the wrong subject, which is exactly the shape no reader flags.
 *
 * **The id is now the first eight hex of a SHA-256 of the document's bytes.** It
 * is stable under insertion, deletion and reordering, and it says nothing about
 * the name. It is not a quotation either: a digest of the whole document is not
 * any part of its text and cannot be turned back into one, so rule 1 is intact.
 *
 * Two consequences worth knowing rather than rediscovering:
 *
 * - **Editing a document changes its id**, and that is the property rather than a
 *   cost. A figure names the bytes it was read from, so bytes that moved should
 *   not keep the label a reader will compare against.
 * - **Two documents with identical bytes are refused**, because they would share
 *   an id and a per-document table would silently show one row where a reader
 *   counts two. That is a derivation whose failure makes the set BIGGER, which is
 *   the direction a derived count can see (audit item 4c).
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

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { unverifiableOutcome } from './unverifiable.mjs';

/** The environment variable that names the corpus directory. */
export const CORPUS_VARIABLE = 'MONSTERA_CORPUS';

/**
 * How much of the digest an id carries.
 *
 * Eight hex is 32 bits, which over a corpus of this size makes an accidental
 * collision negligible — and the collision that matters is not accidental
 * anyway: it is the same document supplied twice, which `openCorpus` refuses by
 * name. Short enough to read in a table, long enough that two ids do not look
 * alike at a glance.
 */
const ID_HEX = 8;

/**
 * A corpus document, with nothing in it that could be quoted.
 *
 * @typedef {object} CorpusDocument
 * @property {string} id an opaque label derived from the bytes — `corpus-3f9a1c2b`
 * @property {Buffer} bytes the document
 * @property {number} size its length, which is a shape rather than content
 */

/**
 * @typedef {object} CorpusReading
 * @property {true} available
 * @property {readonly CorpusDocument[]} documents in sorted order, each carrying
 *   an id derived from its own bytes — so inserting a document re-points nothing
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

  /** @type {Map<string, number>} */
  const seen = new Map();
  const documents = files.map((name) => {
    const bytes = readFileSync(resolve(directory, name));
    // The name goes no further than this line. See rule 1.
    const id = `corpus-${createHash('sha256').update(bytes).digest('hex').slice(0, ID_HEX)}`;
    seen.set(id, (seen.get(id) ?? 0) + 1);
    return { id, bytes, size: bytes.length };
  });

  // TWO DOCUMENTS WITH ONE ID ARE ONE DOCUMENT TWICE, and the reason to refuse
  // rather than to disambiguate is what a duplicate does downstream: a
  // per-document table keyed on the id shows one row, the count beside it says
  // two, and nothing in either number says which reading is missing. The message
  // names the sizes because that is a shape and the name is not ours to print.
  const collided = [...seen].filter(([, count]) => count > 1);
  if (collided.length > 0) {
    throw new Error(
      `${CORPUS_VARIABLE} points at ${directory}, where ${String(collided.length)} document(s) ` +
        `appear more than once by content — identical bytes, so identical ids ` +
        `(${collided.map(([id, count]) => `${id}×${String(count)}`).join(', ')}). ` +
        `A corpus holding one document twice weights every score it appears in, and a table ` +
        `keyed on the id cannot show the second row. Remove the copy.`,
    );
  }

  return { available: true, documents };
}
