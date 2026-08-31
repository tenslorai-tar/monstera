// @ts-check
/**
 * Proves the session-root sweep against a REAL directory and the shipped
 * surface.
 *
 * ## What is already proven elsewhere, and what only this can reach
 *
 * `sessionDirectories.test.ts` drives `sweepSessionDirectories` over an
 * injected surface and covers its decisions — which names are removed, which
 * are skipped, that a root it could not list is not a clean one. Every one of
 * those cases supplies the listing, so the whole of `list` is stubbed.
 *
 * The shipped `list` is `readdirSync(path, { withFileTypes: true })` filtered
 * to directories, and that filter is load-bearing: `removeTree` is
 * `rmSync(recursive)`, which removes a FILE just as happily as a directory. So
 * a listing that answered files as well would have the sweep delete a file in
 * the session root whose name carries a session prefix — and no unit test can
 * see that, because the unit tests are the ones deciding what `list` returns.
 *
 * This is the call site rather than the helper: one real root, one real
 * listing, one real removal.
 *
 * ## Windows only, and it says which cases it did not evaluate
 *
 * `sessionDirectoryPaths` composes backslash paths and the surface is the Win32
 * one, so there is nothing degraded to run elsewhere. On any other platform
 * this prints UNVERIFIABLE and names the cases — *could not look* is not
 * *looked and found nothing*.
 *
 * Usage: node scripts/proofs/sessionSweep.proof.mjs
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();
const BUILT_SURFACE = join(ROOT, 'apps', 'desktop', 'dist', 'win32DirectorySurface.js');
const BUILT_SESSIONS = join(ROOT, 'apps', 'desktop', 'dist', 'sessionDirectories.js');

/**
 * The cases, named — an authored list, so a deleted `check()` leaves this
 * claiming five and the roster goes red. A count taken from the checks
 * themselves would agree with any deletion (audit item 4c).
 */
const CASES = [
  'a pair a dead run left behind is gone',
  'a directory this layout could not have created is still there',
  'CONTROL: a FILE carrying a session prefix survives, which rmSync would not have',
  'the session root own negative probe survives',
  'CONTROL: a root that does not exist reports unreadable rather than clean',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: CASES.length });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const missing = [BUILT_SURFACE, BUILT_SESSIONS].filter((path) => !existsSync(path));
const runnable = process.platform === 'win32' && missing.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The session root is a Win32 layout driven through the Win32 surface (ADR-0023 ` +
        `Decision 12), so there is nothing degraded to run on ${process.platform}.`
      : `Not built: ${missing.join(', ')}. This drives the SHIPPED modules rather than a copy ` +
        `of them, so without the build there is nothing to measure. Run \`npm run build\`.`;
  process.stdout.write(
    `UNVERIFIABLE — ${String(CASES.length)} case(s) could not be evaluated here:\n` +
      `${CASES.map((label) => `  ??  ${label}\n`).join('')}\n  ${why}\n\n` +
      `  This is COULD NOT LOOK, and it is not the same as looked and found nothing.\n`,
  );
} else {
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-session-sweep-'));
  try {
    const { createWin32DirectorySurface } = await import(pathToFileURL(BUILT_SURFACE).href);
    const { sweepSessionDirectories } = await import(pathToFileURL(BUILT_SESSIONS).href);
    const surface = createWin32DirectorySurface();

    // A PAIR THAT LOOKS EXACTLY LIKE A REAL ONE, with a file inside the output
    // half — the host holds modify there and invariant 25 declares it hostile,
    // so an empty directory is the shape a sweep is least likely to meet.
    mkdirSync(join(scratch, 'in-a1b2c3'), { recursive: true });
    mkdirSync(join(scratch, 'out-a1b2c3'), { recursive: true });
    writeFileSync(join(scratch, 'out-a1b2c3', 'serialised.pdf'), 'not really a pdf\n');

    // A directory the layout could not have minted: upper case is refused by
    // `sessionDirectoryName`, so this separates *matches a prefix* from
    // *matches the layout*.
    mkdirSync(join(scratch, 'in-NOTHEX'), { recursive: true });

    // THE CASE NO UNIT TEST CAN REACH. A file whose name is a perfectly valid
    // session directory name. `removeTree` is `rmSync(recursive)` and would
    // take it without complaint; the only thing between them is `list`
    // answering directories.
    writeFileSync(join(scratch, 'in-deadbeef'), 'a file, not a directory\n');

    // What `createEngineHostPlatform` writes into this root on every launch.
    writeFileSync(join(scratch, 'containment-negative'), 'the negative probe\n');

    const swept = sweepSessionDirectories(surface, scratch);

    check(
      CASES[0] ?? '',
      !existsSync(join(scratch, 'in-a1b2c3')) && !existsSync(join(scratch, 'out-a1b2c3')),
      `the pair is still on disk after a sweep that reported ${JSON.stringify(swept)}. A pair ` +
        `survives only a main process that died without unwinding, and nothing else removes one.`,
    );

    check(
      CASES[1] ?? '',
      existsSync(join(scratch, 'in-NOTHEX')),
      `in-NOTHEX was removed. It carries a session prefix and a name ` +
        `sessionDirectoryName refuses, so a sweep that took it is keyed on the prefix alone — ` +
        `and this root is a directory the application owns, not one it may empty.`,
    );

    check(
      CASES[2] ?? '',
      existsSync(join(scratch, 'in-deadbeef')),
      `the FILE in-deadbeef was removed. Its name is a valid session directory name, so the ` +
        `only thing that can have protected it is \`list\` answering directories — and ` +
        `removeTree is rmSync(recursive), which does not care which it was handed.`,
    );

    check(
      CASES[3] ?? '',
      existsSync(join(scratch, 'containment-negative')),
      `the negative probe was removed. createEngineHostPlatform writes it into this same root ` +
        `and reads it immediately before every containment verdict.`,
    );

    // THE CONTROL FOR THE FOUR ABOVE, and it is the one that separates *the
    // sweep worked* from *the sweep did nothing*. Every case above is satisfied
    // by a sweep that removes the pair, and three of them are ALSO satisfied by
    // a sweep that does nothing at all. This one is not: an absent root must
    // report unreadable, which only a listing that ran can produce.
    const absent = sweepSessionDirectories(surface, join(scratch, 'no-such-root'));
    check(
      CASES[4] ?? '',
      absent.unreadable === true && absent.removed.length === 0,
      `an absent root reported ${JSON.stringify(absent)}. A surface answering [] for an error ` +
        `makes could-not-look and clean the same observation, and clean is the one everybody ` +
        `asking a sweep wants to hear.`,
    );

    process.stdout.write(
      failures.length > 0
        ? `\n${String(failures.length)} session-sweep case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
        : roster.format('session-sweep case'),
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`MONSTERA_SESSION_SWEEP_FAILED ${formatError(error)}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
