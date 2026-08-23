// @ts-check
/**
 * Proof that `check:electronbinary` can see, can refuse, and can tolerate
 * (rule B2, finding YYY-2).
 *
 * The scan's entire output when everything is fine is *no violations*, which is
 * also its output when the pattern is wrong, when the root is wrong, when the
 * walk returns nothing, and when the property has been renamed. So the cases
 * below drive it in both directions, and one of them BLINDS it deliberately and
 * requires it to say so rather than to report a clean tree.
 *
 * Usage: node scripts/proofs/electronBinaryCallers.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { report, scanElectronBinaryCallers, SUBJECT_FILES } from '../lib/electronBinaryCallers.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-electronbinary-'));

/**
 * A fixture carrying BOTH shapes, because a scan that reports every site
 * satisfies the violation case just as well as one that reports the right site.
 *
 * @param {string} name @param {string} body @returns {string}
 */
function fixture(name, body) {
  return fixtureFiles(name, { 'driver.mjs': body });
}

/**
 * @param {string} name @param {Record<string, string>} files
 * @returns {string}
 */
function fixtureFiles(name, files) {
  const root = join(scratch, name);
  mkdirSync(join(root, 'scripts', 'research'), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    writeFileSync(join(root, 'scripts', 'research', file), body, 'utf8');
  }
  return root;
}

const WRONG = 'const surface = createWin32HostSurface({\n  executablePath: process.execPath,\n});\n';
const RIGHT = 'const surface = createWin32HostSurface({\n  executablePath: electronBinaryPath(),\n});\n';

try {
  // -------------------------------------------------------------------------
  // 1 & 2. It can SEE the defect, and it does not report everything.
  // -------------------------------------------------------------------------
  {
    const root = fixture('both', `${WRONG}\n${RIGHT}`);
    const result = report({ root, control: 'scripts/research/driver.mjs' });
    check(
      'a site assigning `process.execPath` is reported FAILED and the scan is not ok',
      !result.ok && /process\.execPath/u.test(result.output) && /FAILED/u.test(result.output),
      `This is the exact expression that ran the containment cells under system Node. ` +
        `Output:\n${result.output}`,
    );
    const sites = scanElectronBinaryCallers({ root }).sites;
    check(
      'CONTROL: the sanctioned site beside it is NOT reported',
      sites.filter((site) => site.ok).length === 1 && sites.filter((site) => !site.ok).length === 1,
      `a scan that reports every site satisfies the case above without distinguishing ` +
        `anything. Got ${JSON.stringify(sites)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. It can TOLERATE — a tree with only sanctioned sites is ok.
  // -------------------------------------------------------------------------
  {
    const root = fixture('clean', RIGHT);
    const result = report({ root, control: 'scripts/research/driver.mjs' });
    check(
      'a tree whose every site names the resolver is ok',
      result.ok && /^\s{2}ok/mu.test(result.output),
      `a guard that cannot pass is a guard someone removes. Output:\n${result.output}`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. IT CAN REFUSE. Blinded, it must not report a clean tree.
  //
  // The input is built the way a negative probe has to be: this fixture WOULD
  // pass if the positive control were absent, because it contains no violation
  // at all. So the failure here can only come from the control, never from the
  // tree being unreadable.
  // -------------------------------------------------------------------------
  {
    const root = fixture('blind', RIGHT);
    const result = report({ root, control: 'scripts/research/not-here.mjs' });
    check(
      'a scan that did not locate its control is NOT ok, however clean the tree looked',
      !result.ok && /did not locate/u.test(result.output),
      `zero violations is what a broken pattern, a wrong root and an empty walk all report. ` +
        `Output:\n${result.output}`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. An empty walk THROWS rather than reporting a clean tree.
  // -------------------------------------------------------------------------
  {
    const root = join(scratch, 'empty');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    let threw = false;
    try {
      scanElectronBinaryCallers({ root });
    } catch {
      threw = true;
    }
    check(
      'an empty file set throws — an empty intermediate result is a broken walk, not an answer',
      threw,
      'reporting "no violations" for a walk that found no files is the reassuring answer ' +
        'arriving from a defect.',
    );
  }

  // -------------------------------------------------------------------------
  // 6a-6c. THE COMPLEMENT (finding ZZZ-2): a host created without naming the
  // property is not a clean file, it is a file this scan cannot read.
  //
  // The assignment scan reports the bad sites it finds and says nothing about a
  // host built from a spread. The positive control does not reach this — it
  // proves the walk can FIND a known file, not that the walk saw every file
  // that creates one.
  // -------------------------------------------------------------------------
  {
    const root = fixture('spread', 'const surface = createWin32HostSurface({ ...config });\n');
    const result = report({ root, control: 'scripts/research/driver.mjs' });
    check(
      'a file that creates a host and names the property NOWHERE is reported, not passed',
      !result.ok && /names executablePath nowhere/u.test(result.output),
      `it contributes no site, so every assignment-shaped check reports it as clean. ` +
        `Output:\n${result.output}`,
    );
  }
  {
    // The tell that separates creating from mentioning is the paren. Two proofs
    // in this repository name the factory and create nothing; a rule keyed on
    // the identifier alone would report both as violations for ever.
    const root = fixtureFiles('mentions', {
      'driver.mjs': RIGHT,
      'reader.mjs': 'const name = "createWin32HostSurface";\nexport { name };\n',
    });
    const { creators } = scanElectronBinaryCallers({ root });
    check(
      'CONTROL: a file that MENTIONS the factory without calling it is not a creator',
      creators.length === 1 && creators[0] === 'scripts/research/driver.mjs',
      `a rule keyed on the identifier alone reports electronImports.proof.mjs and ` +
        `win32Handle.proof.mjs as violations for ever. Got ${JSON.stringify(creators)}`,
    );
  }
  {
    const root = fixture('blindcreator', RIGHT);
    const result = report({ root, control: 'scripts/research/nowhere.mjs' });
    check(
      'the creator derivation carries its OWN control, which the site control cannot stand in for',
      !result.ok && /creator derivation did not locate/u.test(result.output),
      `two searches fail independently and both report a clean tree. Output:\n${result.output}`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. THE EXEMPTION IS EXACTLY TWO FILES.
  //
  // This scan skips itself and this proof, because both name the violating
  // expression on purpose. An exemption nobody counts is how a scan quietly
  // stops covering the files it was written for, and `*.proof.mjs` as a pattern
  // would exempt precisely the kind of file where the defect actually happened.
  // -------------------------------------------------------------------------
  check(
    'the scan exempts its own two subject files and nothing else',
    SUBJECT_FILES.length === 2 &&
      SUBJECT_FILES.includes('scripts/lib/electronBinaryCallers.mjs') &&
      SUBJECT_FILES.includes('scripts/proofs/electronBinaryCallers.proof.mjs'),
    `a third entry is a caller being excused. Got ${JSON.stringify(SUBJECT_FILES)}`,
  );

  // -------------------------------------------------------------------------
  // 6a. THE CLI PATH — the one CI actually enters (finding AAAA-5).
  //
  // Every case above calls `report()` directly, so the main guard is exercised
  // by none of them. That is how this scan shipped with a guard that never fired
  // and a first run that scanned nothing while exiting 0.
  //
  // THE INPUT IS BUILT SO THAT AN ABSENT GUARD WOULD LET IT THROUGH. A case that
  // runs the CLI against this repository and expects exit 0 is satisfied by a
  // scan that scanned nothing — the defect, living inside its own fix. So the
  // fixture carries a known violation and the case requires exit 1 AND the
  // violation text: refusal and impossibility produce the same observation
  // otherwise, and a scan that never ran cannot produce the text.
  // -------------------------------------------------------------------------
  {
    const root = fixture('cli', WRONG);
    const run = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'lib', 'electronBinaryCallers.mjs'), '--root', root],
      { encoding: 'utf8' },
    );
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    check(
      'run as a PROCESS against a violating fixture, it exits 1 and prints the violation',
      run.status === 1 && /process\.execPath/u.test(output) && /FAILED/u.test(output),
      `exit=${String(run.status)}. A main guard that never fires exits 0 with no output, which ` +
        `annotate.mjs does not publish and every check here reads as a pass. Output:\n${output}`,
    );
  }

  // -------------------------------------------------------------------------
  // 7. AND IT IS GREEN ON THE REAL REPOSITORY, non-vacuously.
  // -------------------------------------------------------------------------
  {
    const result = report({});
    check(
      'the real repository passes, and the scan located its own control while doing so',
      result.ok && /located/u.test(result.output) && /\bok\b/u.test(result.output),
      `Output:\n${result.output}`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} electronBinaryCallers case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('electronBinaryCallers case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
