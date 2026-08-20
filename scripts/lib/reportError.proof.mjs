// @ts-check
/**
 * Proves that what a script prints about its own run is true.
 *
 * Two modules, one property, which is why they share a proof: `reportError.mjs`
 * governs what a failure says, and `passRoster.mjs` governs what a pass says.
 * Both had the same defect — output that reads as a fact and was not derived
 * from one.
 *
 * (They share a file rather than a theme by accident. Splitting them is cheap
 * now that a `scripts`-only edit no longer arms the lockfile guard, and worth
 * doing on its own rather than folded into this one.)
 *
 * ---
 *
 * Part one proves the error reporter can tell apart the things it exists to
 * tell apart.
 *
 * A reporter is an instrument, and audit item 4a applies to it: feed it two
 * values that differ by the smallest amount that would change a decision, and
 * confirm it reports them as different. For a failed `rename` the deciding
 * value is the errno — `EPERM`, `EACCES`, `EBUSY` and `ENOTEMPTY` point at four
 * different mechanisms and one repair each.
 *
 * The instrument was blind, and it was blind in CI rather than in theory. The
 * Windows provisioning proof printed
 * `Error: Could not publish gitleaks to …\n    at publish (…)` and nothing else,
 * because `Error.prototype.stack` does not include `cause` and every top-level
 * handler under `scripts/` printed `stack`.
 *
 * ## Which case is load-bearing
 *
 * Case 2. The property under test is "the printed output carries the errno",
 * and the FIX and the BUG are separated only by whether `stack` alone already
 * carried it. So the proof asserts both directions: `formatError` must contain
 * the code, and the bare `stack` must NOT. Without the second, a future Node
 * that folds `cause` into `stack` would leave case 1 passing while proving
 * nothing about this module — the vacuous-proof shape, arriving through a
 * dependency rather than through an edit.
 *
 * Usage: node scripts/lib/reportError.proof.mjs
 */

import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoster } from './passRoster.mjs';
import { formatError } from './reportError.mjs';

/** @type {string[]} */
const passed = [];
/** @type {string[]} */
const failures = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/**
 * A real `rename` failure, produced rather than hand-built.
 *
 * A fabricated `{ code: 'ENOTEMPTY' }` would prove the formatter reads a
 * property this proof also wrote. The point is that it reads what the platform
 * actually throws, whatever that turns out to be here — which is also why the
 * expected code is captured from the error rather than written down.
 *
 * @returns {Promise<{ cause: NodeJS.ErrnoException, outer: Error }>}
 */
async function inducedRenameFailure() {
  const root = await mkdtemp(join(tmpdir(), 'monstera-report-'));
  const source = join(root, 'source');
  const occupied = join(root, 'occupied');
  await mkdir(source, { recursive: true });
  await mkdir(occupied, { recursive: true });
  await writeFile(join(occupied, 'placeholder'), 'x');

  /** @type {NodeJS.ErrnoException | null} */
  let captured = null;
  try {
    await rename(source, occupied);
  } catch (error) {
    captured = /** @type {NodeJS.ErrnoException} */ (error);
  }
  await rm(root, { recursive: true, force: true });

  if (captured === null) {
    throw new Error(
      'renaming a directory onto an occupied one succeeded, so this proof has no real errno ' +
        'to work with. An empty input here would make every case below pass by having nothing ' +
        'to compare (audit item 4b).',
    );
  }

  // Wrapped exactly as scripts/provision/gitleaks.mjs wraps it, so the shape
  // under test is the shape that shipped.
  return { cause: captured, outer: new Error('Could not publish gitleaks to /x', { cause: captured }) };
}

async function main() {
  const { cause, outer } = await inducedRenameFailure();
  const code = cause.code ?? '';

  check(
    'the induced failure produced an errno at all',
    code !== '',
    'the platform threw a rename error with no `code`. Every case below compares against it, ' +
      'so an empty one would pass them all by having nothing to say.',
  );

  const formatted = formatError(outer);

  check(
    'the errno survives a wrapped error',
    formatted.includes(code),
    `formatError() printed:\n${formatted}\nwhich does not mention ${code}. That errno is the ` +
      `diagnosis — it is what separates a held handle from a permissions difference.`,
  );

  // The direction that matters. See the header: without this, case above passes
  // whenever `stack` happens to carry the cause, and stops distinguishing the
  // fix from its absence.
  check(
    'CONTROL: the bare stack does NOT carry it, so the case above separates something',
    !`${outer.stack ?? ''}`.includes(code),
    `Error.prototype.stack already contains ${code}, so "formatError finds it" is satisfied by ` +
      `the behaviour this module replaced. Either the runtime changed or the fixture no longer ` +
      `nests, and either way the case above has stopped proving anything.`,
  );

  check(
    'the operands of the failed syscall are named',
    formatted.includes('path=') && formatted.includes('dest='),
    `formatError() printed:\n${formatted}\nWhich of the two paths was unavailable is half the ` +
      `mechanism, and a rename error carries both.`,
  );

  check(
    'the outer message is kept, not replaced by the cause',
    formatted.includes('Could not publish gitleaks to /x'),
    `formatError() printed:\n${formatted}\nThe outer message says WHICH operation failed; the ` +
      `cause says why. Losing either end leaves half a diagnosis.`,
  );

  // Three links, because `publish` is already two and the extractor adds a
  // third: gitleaks.mjs wraps extract.mjs, which wraps spawnSync's error.
  const deep = new Error('outermost', {
    cause: new Error('middle', { cause: new Error(`innermost ${code}`) }),
  });
  check(
    'a chain deeper than one link is walked to the bottom',
    formatError(deep).includes(`innermost ${code}`),
    `a three-link chain lost its innermost error:\n${formatError(deep)}`,
  );

  // The case the unconditional field emission exists for: `code` set, prose
  // message, nothing in the text to find.
  const quiet = Object.assign(new Error('the operation did not complete'), { code: 'EBUSY' });
  check(
    'an errno absent from the message is still reported',
    formatError(quiet).includes('EBUSY'),
    `an error carrying code EBUSY in a property rather than its message printed:\n` +
      `${formatError(quiet)}\nNode's fs errors repeat the code in the message and other sources ` +
      `do not, and the two are indistinguishable at the point of printing.`,
  );

  check(
    'a non-Error throw still prints something',
    formatError('a bare string').includes('a bare string') && formatError(null).includes('null'),
    `a string, a number and null are all legal throws, and a reporter that renders one as ` +
      `"[object Object]" or "" loses the only evidence there is.`,
  );

  // A cycle is reachable and an unbounded walk over one never returns. This
  // case hangs rather than fails if the guard is removed, which is the honest
  // signal: the proof stops, and a hang is not mistaken for a pass.
  const looped = new Error('self-referential');
  looped.cause = looped;
  check(
    'a cyclic chain terminates and says so',
    formatError(looped).includes('cycle'),
    `a cycle was walked without being reported:\n${formatError(looped)}`,
  );

  /** @type {Error} */
  let tall = new Error('bottom');
  for (let index = 0; index < 12; index += 1) tall = new Error(`link ${index}`, { cause: tall });
  check(
    'a chain past the depth cap is truncated visibly, not silently',
    formatError(tall).includes('truncated'),
    `a 13-link chain printed without saying it had been cut:\n${formatError(tall)}\nA reporter ` +
      `that silently drops the bottom of a chain is the defect this module exists to fix, one ` +
      `level down.`,
  );

  // ---------------------------------------------------------------------------
  // Part two: a roster line is a fact about a case that ran.
  //
  // Four scripts printed a fixed block of `ok` lines and a hand-written total
  // when the failure list was empty. Nothing tied a line to a case, so the
  // roster could be wrong in both directions at once, and was: gitleaks.proof
  // ran three cases that had no line at all, while documentConsistency printed
  // `ok` for a threat-model section that only applies when a threat model
  // exists, and mupdf.proof printed `ok` for a resolution test whose reference
  // images are absent on a non-Windows runner — where its own catch swallowed
  // the error.
  // ---------------------------------------------------------------------------
  {
    /** @type {string[]} */
    const failures = [];
    // TWO, not three. A case that pushed a failure earns no label at all, so it
    // lands in neither list — and no real caller reaches `format` with a
    // non-empty failure list anyway. The declared count is what a CLEAN run
    // records.
    const roster = createRoster(failures, { cases: 2 });

    const passedMark = roster.mark();
    roster.record(passedMark, 'a case that ran and passed');

    const failedMark = roster.mark();
    failures.push('something went wrong');
    roster.record(failedMark, 'a case that pushed a failure');

    const skippedMark = roster.mark();
    roster.record(skippedMark, 'a case with nothing to check', false);

    check(
      'a passing case earns its label',
      roster.passed.includes('a case that ran and passed'),
      `passed: ${roster.passed.join(', ') || '(none)'}`,
    );

    check(
      'a FAILING case earns no label',
      !roster.passed.includes('a case that pushed a failure') &&
        !roster.skipped.includes('a case that pushed a failure'),
      `a case that reported a problem also announced itself as passing. The failure is the ` +
        `report; a second line saying it passed is the contradiction the roster exists to stop.`,
    );

    // The live defect, in both files that had it: "found no problems" and "did
    // not look" are the same output otherwise (audit item 4b, one level up).
    check(
      'a case with nothing to check is NOT counted as passing',
      roster.skipped.includes('a case with nothing to check') &&
        !roster.passed.includes('a case with nothing to check'),
      `skipped: ${roster.skipped.join(', ') || '(none)'} — a section that had nothing to read ` +
        `has verified nothing, and reporting it as a pass is how a threat-model check that ` +
        `never ran printed ok for months.`,
    );

    const rendered = roster.format('widget case');
    const okLines = rendered.split('\n').filter((line) => line.startsWith('  ok  ')).length;

    // The drift control. The totals this replaces were literals, and the one in
    // gitleaks.proof.mjs was hand-edited 6 to 7 to 10 inside a single audit
    // range — those are the two deletions the scope report could not see in the
    // net diff.
    check(
      'the printed total is DERIVED from the lines, not written beside them',
      rendered.includes(`\n${String(okLines)} widget case`),
      `rendered:\n${rendered}\nIt printed ${okLines} ok line(s). A total that is not the count ` +
        `of what was printed is a number nothing keeps in step.`,
    );

    check(
      'CONTROL: the total is not a constant that happens to match',
      (() => {
        // A SECOND roster rather than growing the first, because a roster now
        // declares its size and refuses to print a different one. Same control:
        // a different number of passing cases must move the lines and the total
        // together, so the case above is not satisfied by a constant that
        // happens to agree for one input.
        /** @type {string[]} */
        const otherFailures = [];
        const bigger = createRoster(otherFailures, { cases: 3 });
        bigger.record(bigger.mark(), 'one');
        bigger.record(bigger.mark(), 'two');
        bigger.record(bigger.mark(), 'three', false);
        const grown = bigger.format('widget case');
        const grownOk = grown.split('\n').filter((line) => line.startsWith('  ok  ')).length;
        return grownOk === okLines + 1 && grown.includes(`\n${String(grownOk)} widget case`);
      })(),
      `a roster with one more passing case did not move both its lines and its total, so the ` +
        `case above is satisfied by a number that agrees with the lines only for this one input.`,
    );

    // Z-4. The two directions say different things and both must fail: an
    // increase that is not recorded makes the number rot, and a DECREASE is a
    // proof that quietly checks less than it did. Before this, a deleted case
    // took its line and the total with it and nothing anywhere noticed.
    for (const [declared, expectWord] of /** @type {const} */ ([
      [3, 'STOPPED RUNNING'],
      [1, 'Raise the number'],
    ])) {
      /** @type {string[]} */
      const noFailures = [];
      const drifted = createRoster(noFailures, { cases: declared });
      drifted.record(drifted.mark(), 'only one case here');
      drifted.record(drifted.mark(), 'and one more', false);

      let refused = '';
      try {
        drifted.format('widget case');
      } catch (error) {
        refused = error instanceof Error ? error.message : String(error);
      }
      check(
        `a roster declaring ${String(declared)} while recording 2 refuses to print`,
        refused.includes(expectWord),
        `it ${refused === '' ? 'printed anyway' : `said: ${refused}`}. A count that disagrees ` +
          `with the run is not evidence in either direction — and the decrease is the one that ` +
          `matters, because both the lines and the total drop together and absence is what that ` +
          `looks like.`,
      );
    }

    check(
      'a roster cannot be created without declaring how many cases it has',
      (() => {
        try {
          // @ts-expect-error — the point of the case is that this is refused.
          createRoster([], undefined);
          return false;
        } catch {
          return true;
        }
      })(),
      `an optional count is one every future caller omits, and the omission looks exactly like ` +
        `every other roster. Requiring it is what stops the check being opt-in.`,
    );
  }

  process.stdout.write(
    `${passed.map((label) => `  ok  ${label}`).join('\n')}\n` +
      (failures.length > 0
        ? `\n${failures.length} honest-output failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
        : `\n${passed.length} honest-output cases passed.\n`),
  );
  return failures.length > 0 ? 1 : 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  },
);
