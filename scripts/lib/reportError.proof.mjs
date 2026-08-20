// @ts-check
/**
 * Proves the error reporter can tell apart the things it exists to tell apart.
 *
 * This file used to prove `passRoster.mjs` as well, because the two modules
 * share one property — output that reads as a fact and was not derived from
 * one. They shared a file by accident, which its header said at the time, and
 * the roster half now lives in `passRoster.proof.mjs`. The property is shared;
 * the mechanisms are not. What a FAILURE says is lost by dropping an errno from
 * a wrapped error, and what a PASS says is lost by an `ok` line outliving the
 * case that earned it.
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
const failures = [];

// TEN, and the number is the control on the split that produced this file.
// Moving cases between two files is the one edit that can lose one silently:
// the label goes with the case and the derived total drops to match, which is
// what absence looks like. The two halves declare 10 and 8, and 18 is what the
// single file ran. Nothing else was checking that.
const roster = createRoster(failures, { cases: 10 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
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

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} error-report failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : roster.format('error-report case'),
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
