// @ts-check
/**
 * Proof for the corpus harness (`scripts/lib/corpus.mjs`).
 *
 * ## Why this file exists at all, and it is not *the module has tests*
 *
 * The corpus lives outside the repository and is named by an environment
 * variable. On any machine that does not set it — including this one, and
 * including every CI runner — `openCorpus` takes its absent branch and the
 * present branch **never executes**. That is `CLAUDE.md`'s audit item 3 in its
 * sharper form: *any branch keyed on the presence of something has a side that
 * never executes wherever that thing is always present*, pointing the other way.
 * The side nobody runs is a specification nobody has read.
 *
 * So this proof supplies a corpus. Not the real one — three synthetic PDFs in a
 * temporary directory outside the working tree — because what is under test is
 * the harness's rules, not the documents.
 *
 * ## The load-bearing case is the one about filenames
 *
 * Rule 1 says nothing from a corpus document is ever quoted, and *filename* is
 * on that list. The module implements it by never handing a caller the name at
 * all, which is B5 over a rule someone remembers. **A comment claiming that is
 * not the mechanism**, so the case serialises everything `openCorpus` returns
 * and asserts that no filename appears anywhere in it — with the fixture's names
 * deliberately distinctive, so a leak cannot hide behind a common substring.
 *
 * ## And the caveat's case tests the property that makes it a compensation
 *
 * `CLAUDE.md`: *could it have been printed before you made your change?* If yes
 * it is a disclaimer, and by the third reading it is furniture. So the assertion
 * is not that `corpusCaveat` says something sensible — it is that its text
 * **varies with the count**, which a constant string would fail.
 *
 * Usage: node scripts/proofs/corpus.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CORPUS_VARIABLE, corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { UNVERIFIABLE_MARKER } from '../lib/unverifiable.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 17 });

/**
 * @param {string} label
 * @param {boolean} condition
 * @param {string} detail
 */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * Runs a function with the corpus variable set to a value, and restores it.
 *
 * @template T
 * @param {string | undefined} value
 * @param {() => T} body
 * @returns {T}
 */
function withCorpus(value, body) {
  // `Reflect.deleteProperty` rather than `delete`, which the dynamic-delete rule
  // bans on a computed key. Removing it — rather than setting it empty — is what
  // the unset case is about: an empty string is a value someone configured.
  const previous = process.env[CORPUS_VARIABLE];
  if (value === undefined) Reflect.deleteProperty(process.env, CORPUS_VARIABLE);
  else process.env[CORPUS_VARIABLE] = value;
  try {
    return body();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, CORPUS_VARIABLE);
    else process.env[CORPUS_VARIABLE] = previous;
  }
}

/** What was thrown, or `null` if nothing was. */
function thrownBy(/** @type {() => unknown} */ body) {
  try {
    body();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The smallest thing PDFium and this harness both accept as a document.
 *
 * Built as a plain string with no escape sequences in it, because this file is
 * committed and the bytes are the point.
 */
const MINIMAL_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
  '',
].join('\n');

/**
 * Names chosen to be findable if they leak.
 *
 * A leak hiding inside an ordinary word is the failure this case exists for, so
 * none of these is a substring of anything the module legitimately prints.
 */
const FIXTURE_NAMES = ['zulu-alpha.pdf', 'mike-bravo.pdf', 'kilo-delta.pdf'];

const workspace = mkdtempSync(join(tmpdir(), 'monstera-corpus-proof-'));
const populated = join(workspace, 'documents');
const empty = join(workspace, 'nothing');

try {
  mkdirSync(populated);
  mkdirSync(empty);
  for (const [index, name] of FIXTURE_NAMES.entries()) {
    writeFileSync(join(populated, name), `${MINIMAL_PDF}% ${String(index)}\n`);
  }
  // Something that is not a PDF, so "every entry" and "the PDFs" are separable.
  writeFileSync(join(populated, 'notes.txt'), 'not a document\n');

  // -------------------------------------------------------------------------
  // Absent — rule 3. The reassuring answer here is an empty list, so the case
  // asserts the module refuses to produce one.
  // -------------------------------------------------------------------------
  {
    const reading = withCorpus(undefined, () => openCorpus());
    check(
      'an unset variable is UNVERIFIABLE rather than an empty corpus',
      !reading.available && reading.outcome.text.includes(UNVERIFIABLE_MARKER.trim()),
      `answered ${JSON.stringify(reading)}`,
    );
    check(
      'and it says in as many words that it is not a pass',
      !reading.available && reading.outcome.text.includes('NOT a pass'),
      'a caller reading only the exit code cannot tell this from a clean corpus',
    );
    check(
      'the permissive outcome still exits 0, so a machine without a corpus is not red',
      !reading.available && reading.outcome.code === 0,
      `exit code was ${String(reading.available ? -1 : reading.outcome.code)}`,
    );
  }

  {
    const reading = withCorpus(undefined, () => openCorpus({ required: true }));
    check(
      'and a job that says it supplies one gets a FAILURE for the same condition',
      !reading.available && reading.outcome.code === 1,
      'without this, the strict side of the three-state rule does not exist here',
    );
  }

  // -------------------------------------------------------------------------
  // Inside the repository — a throw, not an absence. An absence would let the
  // caller proceed with a configuration that commits the documents.
  // -------------------------------------------------------------------------
  {
    const message = withCorpus(repoRoot(), () => thrownBy(() => openCorpus()));
    check(
      'a corpus directory inside the repository is REFUSED, not reported absent',
      message !== null && message.includes('INSIDE this repository'),
      `answered ${String(message)} — an absence here reads as "you have no corpus", and the ` +
        'caller then proceeds with a configuration that stages three documents on git add -A',
    );
    check(
      'and the repository ROOT itself is caught, which a non-empty relative path is not',
      message !== null && message.includes('it IS the repository root'),
      'relative(root, root) is the empty string, so a check for "not empty" waves through the ' +
        'most dangerous value there is',
    );
  }

  // -------------------------------------------------------------------------
  // A directory with no documents — a broken lookup, not a clean corpus.
  // -------------------------------------------------------------------------
  {
    const message = withCorpus(empty, () => thrownBy(() => openCorpus()));
    check(
      'a directory holding no PDF is refused rather than answered as a corpus of none',
      message !== null && message.includes('no .pdf among them'),
      `answered ${String(message)} — every score over zero documents is clean`,
    );
  }

  // -------------------------------------------------------------------------
  // Present — the branch that never runs on a machine without a corpus.
  // -------------------------------------------------------------------------
  {
    const reading = withCorpus(populated, () => openCorpus());
    check(
      'a populated directory yields exactly the PDFs, and not the other files in it',
      reading.available && reading.documents.length === FIXTURE_NAMES.length,
      `read ${String(reading.available ? reading.documents.length : -1)} of ` +
        `${String(FIXTURE_NAMES.length)}, from a directory that also holds a .txt`,
    );

    const documents = reading.available ? reading.documents : [];
    check(
      'an id is opaque and fixed-width, carrying neither a name nor a position',
      documents.length === FIXTURE_NAMES.length &&
        documents.every((item) => /^corpus-[0-9a-f]{8}$/u.test(item.id)),
      `ids were ${JSON.stringify(documents.map((item) => item.id))}`,
    );

    // THE CASE THAT BITES, and the one this file did not have until 2026-09-10.
    //
    // It used to assert `corpus-1,corpus-2,corpus-3` over a fixture set that
    // never changes — an input held constant across the whole file, which is
    // NNN-1's tell — so it passed for ever while saying nothing about the
    // property it named. Positional ids DO stay put between runs; what they do
    // not survive is an INSERTION, and a corpus that grows from five documents
    // to eleven is exactly that.
    //
    // So the case inserts a document that sorts FIRST and requires every other
    // id to be unchanged. Under the old rule this reddens: everything shifts by
    // one.
    // Keyed on the CONTENT rather than on the size: these three fixtures differ
    // only in a trailing digit, so every one of them is the same length, and a
    // size key would have matched the wrong document while looking sound.
    const before = new Map(documents.map((item) => [item.bytes.toString('latin1'), item.id]));
    const inserted = join(populated, 'aaa-inserted.pdf');
    writeFileSync(inserted, `${MINIMAL_PDF}% inserted at the front\n`);
    const after = withCorpus(populated, () => openCorpus());
    const afterDocuments = after.available ? after.documents : [];
    rmSync(inserted, { force: true });

    const moved = [...before]
      .map(([content, id]) => ({
        was: id,
        now: afterDocuments.find((item) => item.bytes.toString('latin1') === content)?.id,
      }))
      .filter((entry) => entry.now !== entry.was);
    check(
      'inserting a document at the FRONT re-points no other id',
      moved.length === 0,
      `${JSON.stringify(moved)} — a figure recorded against one of these ids would now name a ` +
        'different document, which is a plausible number about the wrong subject',
    );
    // THE CONTROL. "Nothing moved" is also what a reader that never saw the new
    // file answers, and that reader would satisfy the case above perfectly.
    check(
      'CONTROL: and the second reading really did see the inserted document',
      afterDocuments.length === documents.length + 1 &&
        afterDocuments.some((item) => !before.has(item.bytes.toString('latin1'))),
      `read ${String(afterDocuments.length)} documents against ${String(documents.length)} ` +
        'before — without this, a reader that answered the stale list would pass',
    );
    check(
      'the bytes are the documents, so a caller measures the corpus rather than its names',
      documents.every((item) => item.bytes.length === item.size && item.size > 0),
      `sizes were ${JSON.stringify(documents.map((item) => item.size))}`,
    );

    // THE CASE RULE 1 RESTS ON. Everything the module returns is serialised and
    // searched for each fixture's name — the property, not the intention.
    const surface = JSON.stringify(
      documents.map((item) => ({ ...item, bytes: item.bytes.toString('latin1') })),
    );
    const leaked = FIXTURE_NAMES.filter((name) => surface.includes(name.replace('.pdf', '')));
    check(
      'no filename appears anywhere in what a caller is handed',
      leaked.length === 0,
      `${JSON.stringify(leaked)} reached the caller — an instrument cannot print what it was ` +
        'never given, and that is the whole of how rule 1 is enforced',
    );
  }

  // -------------------------------------------------------------------------
  // The same document twice — the one collision a content-derived id can have,
  // and the one that is not an accident.
  // -------------------------------------------------------------------------
  {
    const twice = join(workspace, 'twice');
    mkdirSync(twice);
    writeFileSync(join(twice, 'one.pdf'), MINIMAL_PDF);
    writeFileSync(join(twice, 'two.pdf'), MINIMAL_PDF);
    const message = withCorpus(twice, () => thrownBy(() => openCorpus()));
    check(
      'one document supplied twice is REFUSED rather than folded into a single row',
      message !== null && message.includes('appear more than once by content'),
      `answered ${String(message)} — the id is the same because the bytes are, so a table ` +
        'keyed on it shows one row while the count beside it says two',
    );
    // THE CONTROL, and it is the direction that matters: the refusal must key on
    // the duplicate rather than on anything else about this directory. A guard
    // that refused every two-document corpus would pass the case above.
    writeFileSync(join(twice, 'two.pdf'), `${MINIMAL_PDF}% different\n`);
    const reading = withCorpus(twice, () => openCorpus());
    check(
      'CONTROL: two DIFFERENT documents in the same directory are accepted',
      reading.available && reading.documents.length === 2,
      'without this the refusal could be about the count, the directory or the names',
    );
  }

  // -------------------------------------------------------------------------
  // The caveat, tested for the property that separates a compensation from a
  // disclaimer: it must vary with what this run found.
  // -------------------------------------------------------------------------
  {
    check(
      'the caveat names the count this run read, rather than being a constant sentence',
      corpusCaveat(3) !== corpusCaveat(7) &&
        corpusCaveat(3).includes('3') &&
        corpusCaveat(7).includes('7'),
      'a sentence that could have been printed before the run is a disclaimer, and by the ' +
        'third reading it is furniture',
    );
    check(
      'and it says the figure is a shape rather than an accuracy number',
      corpusCaveat(3).includes('not enough to tune'),
      'rule 2 is the one a reader is most likely to spend without noticing',
    );
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nCorpus harness proof — ${String(failures.length)} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      '\n\nThe corpus is supplied, lives outside this repository and is never committed. A ' +
      'harness that leaks a name, that reads an absent corpus as a clean one, or that lets a ' +
      'path inside the working tree through, breaks a rule nothing else here can see.\n\n',
  );
  process.exit(1);
}

process.stdout.write(roster.format('corpus harness case'));
