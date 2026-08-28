// @ts-check
/**
 * An emitted-source template contains no backtick.
 *
 * ## The class this closes
 *
 * A `String.raw` template holding the body of a program we write to disk and
 * spawn is the one place in this repository where prose and code share a
 * delimiter. **A backtick pair inside it closes the literal and reopens it**,
 * and the parser then reports whatever follows — so the error names a line that
 * is fine and says nothing about the delimiter.
 *
 * Four occurrences, all in the same shape:
 *
 * | | what closed it | caught by |
 * |---|---|---|
 * | 1 | a backtick pair in an embedded comment | the parser, blaming a later line |
 * | 2 | the same, in a different research file | the parser, blaming a later line |
 * | 3 | a comment naming a variable in backticks, inside emitted source | the parser; the file's own header carried the rule against it |
 * | 4 | the same, one commit after this scan shipped, written by the author of this scan | `node --check`; **this scan reports it at the right line** — verified by mutation, not assumed |
 * | 5 | a comment quoting a property name, written while documenting a *different* finding in the same file | `node --check` AND this scan, live, naming the line — the first occurrence caught by the mechanism rather than by someone remembering |
 * | 6 | **two** pairs in one comment — an API name and a script name quoted in prose — written while recording a *negative result* about something else entirely, one commit after the note below predicted it | `node --check`, twice in a row |
 * | 7 | **four** pairs in one comment, quoting API names in prose, written while recording a finding about a GPU flake — the third in a row composed while documenting something else | this scan, in the pre-commit set, naming all four lines before anything was staged |
 *
 * Each time the remedy was the same and each time it was a remedy applied to the
 * instance: move the prose out, or drop the backticks. **Written down is not a
 * mechanism** — that sentence has now been paid for by the escape guard seven
 * times and by this seven, so the rule gets a check.
 *
 * **Three in a row were composed while documenting something else** (5, 6, 7),
 * and that is the sharpest thing the table says. The occurrences do not happen
 * while writing emitted source — they happen while writing PROSE about an
 * unrelated finding, in a file that happens to contain an emitted region. The
 * author's attention is on the finding, and the backtick is a habit of writing
 * about code. No amount of knowing the rule is on the page interrupts that,
 * which is the whole argument for the scan and for it running pre-commit.
 *
 * **Occurrence 5 is the first one this scan caught in anger**, and it is worth
 * separating from occurrence 4. Both were written by the author of the check.
 * The difference is what stopped them: 4 was stopped by a syntax check run by
 * hand, which is a person remembering; 5 was reported by this scan, at the right
 * line, in the ordinary course of running the checks — and WW-4 had by then put
 * it in the pre-commit set against the index, so it could not have reached a
 * commit either way. That is the whole return on WW-4, collected one commit
 * later, on its author again.
 *
 * **Occurrence 6 arrived one commit after `CLAUDE.md` was edited to say "expect
 * a sixth", and that is the useful part rather than an irony.** Two pairs in one
 * comment, an API name and a script name quoted in prose, written while
 * recording a negative result about the GPU process — a *third* unrelated
 * subject. Both were caught by `node --check` in consecutive runs before
 * anything was staged.
 *
 * So the arc is finished and the conclusion is not "try harder". Occurrences 1-4
 * were stopped by luck or by someone remembering; 5 and 6 were stopped by
 * mechanisms, immediately, at no cost. **The count will keep rising and that is
 * now a fact about how comments get written, not a fact about anyone's
 * discipline.** Do not read a rising count as the guard failing — read it as the
 * guard being load-bearing, and be suspicious of a stretch where it stops rising.
 *
 * Occurrence 4 is the sharpest version of that argument available, and it is
 * unflattering on purpose: the rule was not merely written down, it had just
 * been mechanised, by the same agent, in the same session, and it was violated
 * anyway while annotating a *different* finding. **What is in reach at the
 * moment a comment is composed is not what is written in the file.** The scan
 * caught it in the sense that matters — fed the broken text it names line 321 —
 * but at the time it ran only on the Guards job, so what actually stopped it
 * reaching a commit was a syntax check run by hand: me remembering, which is the
 * thing a mechanism replaces. **That was finding WW-4, and it is closed**: this
 * scan is now in the pre-commit set, against the index. The escape guard's
 * argument transfers whole — the mechanism belongs at the point of composition,
 * not at review time, and a CI-only guard catches the defect after the commit is
 * public, which B10 makes permanent.
 *
 * ## Why the rule bans backticks in the emitted CODE too, not only in comments
 *
 * Because it makes the check possible. A parser cannot help here: by the time
 * one runs, the stray pair has already closed the template, so the AST shows a
 * SHORTER template with no backtick in it and the scan reports nothing. The
 * check has to be textual, and a textual check needs a rule with no exceptions
 * to apply — "no backtick in this region" has that property and "no backtick in
 * a comment inside this region" does not.
 *
 * The constraint it imposes is real and small: emitted code concatenates with
 * `+` rather than nesting a template literal. Every emitted body in this
 * repository already does, because nesting one requires escaping and escaping is
 * exactly what goes wrong.
 *
 * ## What counts as an emitted-source template
 *
 * A `String.raw` whose opening backtick is the **last character on its line**,
 * closed by a line that is exactly a backtick and a semicolon. Single-line
 * `String.raw` — the regex fragments in `blockEscapeResolvingWrites.mjs` — are
 * not emitted source and cannot carry a stray pair anyway, since one backtick
 * would end them.
 *
 * An opener with no such terminator is a **finding, not a skip**: the region
 * cannot be determined, so the scan says so rather than guessing a boundary and
 * reporting a clean result from it.
 *
 * ## The positive control runs inside the SCAN, not only in the proof
 *
 * This is a search, and a search has one output for every way it can be broken:
 * *found nothing*. So it carries a fixture with a violation it must locate on
 * every run, and exits non-zero when it cannot — the instrument gets run by hand
 * on the day someone needs an answer, and the proof only runs in CI.
 *
 * The fixture also carries two things the scan must NOT report, because a check
 * that flags everything passes a positive control just as happily: prose
 * backticks outside any template, and a single-line `String.raw`.
 */

import { readFileSync } from 'node:fs';

import { filesInCommit, readStagedBlobs, repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** Written numerically, so this file cannot contain the thing it bans. */
const TICK = String.fromCharCode(96);

/**
 * Does this line OPEN a multi-line template?
 *
 * **Not `String.raw` only, and that correction is finding VV-1.** The first
 * version of this scan matched `String.raw` and nothing else, which left four
 * emitted-source bodies in `scripts/research/` invisible — `hostContainment`,
 * `hostSurface` twice, and `permissionProbeControl` all write a program to disk
 * from a PLAIN template literal. A guard shipped claiming to close a class,
 * blind to half of it, is the pattern axis of a classifier (W-1) reappearing in
 * the check written to close a different class.
 *
 * A plain template is in fact the **more** dangerous of the two, because it
 * interpolates as well as terminating.
 *
 * Three conditions, and each removes a specific false positive:
 *
 * - it ends with a backtick, which is what makes the body multi-line;
 * - it has an ODD number of unescaped backticks, so a completed one-line
 *   template is not read as an opener;
 * - it is not a comment line, because this repository's prose wraps and a
 *   sentence can end on a backtick mid-pair.
 *
 * @param {string} line
 */
function opensTemplate(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return false;
  if (!line.trimEnd().endsWith(TICK)) return false;
  // Escapes first: a `\` + backtick is not a delimiter and must not be counted.
  const unescaped = line.replace(/\\./gu, '');
  return (unescaped.split(TICK).length - 1) % 2 === 1;
}

/**
 * `String.raw` IS THE MARKER FOR EMITTED SOURCE, and that is a decision this
 * check makes rather than a fact it discovered.
 *
 * Widening the scan to every multi-line template was tried and rejected on the
 * measurement: it reported 36 problems, nearly all of them openers whose
 * terminator is not a bare backtick-semicolon — `contract.proof.mjs` alone has
 * fourteen, ending inside argument lists. **Where a template ends cannot be
 * determined textually, which is the same wall the parser hits**, so a check
 * over all of them either guesses a boundary or drowns in false findings.
 *
 * Marking the class instead makes it decidable. `String.raw` is also the right
 * spelling for a program body on its own merits — escape processing is exactly
 * what you do not want in emitted code — so the marker costs nothing to adopt.
 *
 * The escape hatch that would otherwise open is closed by
 * {@link plainTemplatesInResearch}: in the directory where every occurrence has
 * happened, a multi-line plain template is itself a finding.
 *
 * @param {string} line
 */
function opensRawTemplate(line) {
  return line.includes(`String.raw${TICK}`) && opensTemplate(line);
}

/**
 * Every emitted-source region in `text`, and every opener whose end could not be
 * found.
 *
 * @param {string} text
 * @returns {{ regions: Array<{ from: number, to: number }>, unterminated: number[] }}
 */
export function emittedRegions(text) {
  const lines = text.split('\n');
  /** @type {Array<{ from: number, to: number }>} */
  const regions = [];
  /** @type {number[]} */
  const unterminated = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!opensRawTemplate(line)) continue;

    let end = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if ((lines[scan] ?? '').trimEnd() === `${TICK};`) {
        end = scan;
        break;
      }
    }
    if (end === -1) {
      unterminated.push(index + 1);
      continue;
    }
    regions.push({ from: index + 1, to: end + 1 });
    index = end;
  }

  return { regions, unterminated };
}

/**
 * Backticks inside an emitted-source region, one entry per line that has any.
 *
 * @param {string} text
 * @returns {{ violations: Array<{ line: number, text: string }>, unterminated: number[] }}
 */
export function backtickViolations(text) {
  const lines = text.split('\n');
  const { regions, unterminated } = emittedRegions(text);
  /** @type {Array<{ line: number, text: string }>} */
  const violations = [];

  for (const region of regions) {
    // The boundary lines hold the delimiters themselves and are not content.
    for (let line = region.from + 1; line < region.to; line += 1) {
      const content = lines[line - 1] ?? '';
      // An ESCAPED backtick is not a delimiter and does not close anything, so
      // reporting it would be a false finding. Measured: the threat-model topic
      // fixtures carry several deliberately.
      if (content.replace(/\\./gu, '').includes(TICK)) {
        violations.push({ line, text: content.trim().slice(0, 120) });
      }
    }
  }

  return { violations, unterminated };
}

/**
 * Multi-line PLAIN template literals under `scripts/research/`.
 *
 * Emitted source there must carry the `String.raw` marker, or the scan above has
 * an escape hatch: write the body as a plain template and it is invisible. That
 * is not hypothetical — it was the state of the tree when this check first
 * passed (finding VV-1), with four emitted bodies unmarked.
 *
 * Scoped to `scripts/research/` because that is where every occurrence of the
 * class has happened and where every file's whole purpose is to write a program
 * and spawn it. Elsewhere a multi-line template is ordinary.
 *
 * @param {string} text
 * @returns {number[]} line numbers
 */
export function plainTemplatesInResearch(text) {
  return text
    .split('\n')
    .map((line, index) => (opensTemplate(line) && !opensRawTemplate(line) ? index + 1 : 0))
    .filter((line) => line !== 0);
}

/**
 * A file with one violation, one non-violation of each kind, and nothing else.
 *
 * Assembled from {@link TICK} rather than written literally, because a fixture
 * containing a real stray pair would break this module in exactly the way the
 * module exists to prevent — which would be a satisfying kind of failure and a
 * useless one.
 */
export const CONTROL_FIXTURE = [
  `/** Prose with a ${TICK}backticked${TICK} word, OUTSIDE any template. Must not be reported. */`,
  `const SINGLE = String.raw${TICK}[^\\n]*${TICK};`,
  ``,
  `const BODY = String.raw${TICK}`,
  `const ok = 'plain';`,
  `// A comment naming a ${TICK}variable${TICK} — THIS is the violation.`,
  `${TICK};`,
].join('\n');

/** The fixture's violation sits on this line, and the scan must find it there. */
export const CONTROL_LINE = 6;

/**
 * Every source file the rule applies to, in the tree THIS COMMIT WILL LEAVE.
 *
 * `filesInCommit` rather than `git ls-files`, for the reason its own comment
 * gives: `ls-files` answers about the previous commit, so a check built on it
 * can only catch a mistake after the commit that made it. One resolver for
 * "what is in the tree" (B3a).
 *
 * `dist` is excluded because it is generated: a violation there is a copy of one
 * in `src`, and reporting both would make the count lie about how many defects
 * exist.
 *
 * @returns {string[]}
 */
export function scannedFiles() {
  return filesInCommit()
    .filter((entry) => /\.(?:mjs|js|ts|tsx)$/u.test(entry))
    .filter((entry) => !entry.includes('/dist/') && !entry.startsWith('dist/'));
}

/**
 * One file's text, from the scope being scanned.
 *
 * **`staged` reads the INDEX, never the disk**, and the difference decides
 * whether a pre-commit gate is checking the thing being committed. A guard that
 * reads the working tree passes a commit whose staged content is broken — stage
 * the violation, fix the file, commit — and it fails one whose staged content is
 * fine. `guardFiles` already draws this line the same way and for the same
 * reason; there is one resolver for "the bytes as staged" and this uses it.
 *
 * @param {string} relative @param {'tree' | 'staged'} source @param {string} root
 * @param {Map<string, Buffer>} [staged] every staged blob, read in one batch —
 *   see the caller for why this is not read per file
 * @returns {string | null} null when the path is not in the scope at all
 */
function textFor(relative, source, root, staged) {
  if (source === 'staged') {
    const blob = staged?.get(relative) ?? null;
    return blob === null ? null : blob.toString('utf8');
  }
  try {
    return readFileSync(`${root}/${relative}`, 'utf8');
  } catch {
    // Staged-but-deleted, or a path the index knows and the tree does not.
    return null;
  }
}

/**
 * Runs the scan, control first.
 *
 * @param {{ source?: 'tree' | 'staged' }} [options] `tree` — the working copy,
 *   which is what someone running this by hand is looking at, and what CI has.
 *   `staged` — the index, for the pre-commit gate.
 * @returns {number} the process exit code
 */
export function scan({ source = 'tree' } = {}) {
  const control = backtickViolations(CONTROL_FIXTURE);
  const found = control.violations.length === 1 && control.violations[0]?.line === CONTROL_LINE;
  if (!found) {
    process.stdout.write(
      `  FAIL  the scan could not locate its own known-present violation.\n` +
        `        Expected exactly one, on line ${CONTROL_LINE} of the control fixture; got ` +
        `${control.violations.length}.\n` +
        `        THE SILENCE OF A BLIND SEARCH IS INDISTINGUISHABLE FROM A CLEAN TREE, so this\n` +
        `        refuses to report a result.\n`,
    );
    return 1;
  }

  const root = repoRoot();
  let offending = 0;
  let regionCount = 0;

  const files = scannedFiles();

  // ONE `git cat-file --batch` FOR THE WHOLE SET, not two spawns per file.
  //
  // `readStagedBlob` spawns twice per path, and on Windows a spawn costs more
  // than any work this scan does with the bytes. Measured 2026-08-28 with an
  // empty index: this loop took **68.7 s** of a 97 s pre-commit hook — 343
  // files, ~686 spawns, ~100 ms each. Batched, the same set costs one spawn.
  //
  // `readStagedBlobs`'s own header has said *"for more than a couple of paths
  // use this"* since 2026-08-23, and this call site did not. That is QQQ-3: a
  // helper sitting beside the slow one is the same trap one step on, because
  // choosing between them is a paragraph someone has to read and reject rather
  // than two names they pick from.
  const staged = source === 'staged' ? readStagedBlobs(files) : undefined;

  for (const relative of files) {
    const text = textFor(relative, source, root, staged);
    if (text === null) continue;
    // A file with no backtick at all cannot hold a template. Anything narrower
    // here would be a SECOND opinion about what opens one, held one level above
    // `opensTemplate` — and that is exactly how VV-1 survived its own first fix:
    // the opener pattern was widened and this line still said `String.raw`, so
    // four files were skipped before the widened matcher ever saw them.
    if (!text.includes(TICK)) continue;
    const { violations, unterminated } = backtickViolations(text);
    regionCount += emittedRegions(text).regions.length;

    for (const line of unterminated) {
      offending += 1;
      process.stdout.write(
        `  FAIL  ${relative}:${line} — an emitted-source template with no terminating line.\n` +
          `        Its region cannot be determined, so no clean result may be reported from it.\n`,
      );
    }
    for (const violation of violations) {
      offending += 1;
      process.stdout.write(
        `  FAIL  ${relative}:${violation.line} — a backtick inside emitted source.\n` +
          `        ${violation.text}\n` +
          `        It closes the template and the parser then blames whatever follows.\n`,
      );
    }

    if (relative.startsWith('scripts/research/')) {
      for (const line of plainTemplatesInResearch(text)) {
        offending += 1;
        process.stdout.write(
          `  FAIL  ${relative}:${line} — emitted source without the String.raw marker.\n` +
            `        A plain template is invisible to the backtick scan AND interpolates, so it\n` +
            `        is the more dangerous of the two. Mark it String.raw.\n`,
        );
      }
    }
  }

  if (offending > 0) {
    process.stdout.write(`\n${offending} emitted-source backtick problem(s).\n`);
    return 1;
  }

  process.stdout.write(
    `  ok  ${regionCount} emitted-source template(s) carry no backtick\n` +
      `  ok  and the scan located its positive control, so that result means something\n`,
  );
  return 0;
}

// THE FIRST OF THREE. The hand-built `file://` prefix is wrong on Windows — an
// absolute path there starts with a drive letter, not a slash — so the
// comparison never matched, this module ran NOTHING and exited 0. A scan that
// does not run and a scan that finds nothing print the same thing, which is the
// class this file exists to close, arriving in its own entry point.
//
// It was fixed here in place, and then written wrong again in
// `proofCoverage.mjs` and again in `electronBinaryCallers.mjs`, each time by an
// author who had this comment available. The rule lived in call sites, so every
// new entry point re-derived it — B3a, and `isMain` is the named thing that ends
// it (AAAA-5).
if (isMain(import.meta.url)) {
  process.exit(scan());
}
