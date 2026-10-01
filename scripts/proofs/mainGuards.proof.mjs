// @ts-check
/**
 * Proof that the main-guard scan can see, refuse and tolerate, and that
 * {@link isMain} answers correctly on this platform (rule B2, finding AAAA-5).
 *
 * The scan's whole output when everything is fine is *no violations*, which is
 * also what a broken roster, an unreadable file and a wrong pattern produce. And
 * the resolver it enforces is the one expression that has been written wrong
 * three times in this repository, so it is driven directly rather than trusted.
 *
 * Usage: node scripts/proofs/mainGuards.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isMain } from '../lib/isMain.mjs';
import { report, scanMainGuards } from '../lib/mainGuards.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 10 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const scratch = mkdtempSync(join(tmpdir(), 'monstera-mainguards-'));

/**
 * A fixture repository whose manifest invokes the files it declares.
 *
 * @param {string} name @param {Record<string, string>} files
 * @returns {string}
 */
function fixture(name, files) {
  const root = join(scratch, name);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  /** @type {Record<string, string>} */
  const scripts = {};
  for (const [file, body] of Object.entries(files)) {
    writeFileSync(join(root, 'scripts', file), body, 'utf8');
    scripts[`check:${file.replace('.mjs', '')}`] = `node scripts/${file}`;
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts }, null, 2), 'utf8');
  return root;
}

const HAND_ROLLED = 'if (import.meta.url === `file://${process.argv[1]}`) { run(); }\n';
// THE THREE SPELLINGS the first pattern could not see (39 files on 5f5a747a). Each is a hand-written
// read of the entry path, which is the class; only the first spelling above compares with `===`.
const URL_SUFFIX = "if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\\\', '/') ?? ' ')) { run(); }\n";
const NAME_SUFFIX = "if (process.argv[1]?.endsWith('tool.mjs')) { run(); }\n";
const RESOLVED =
  "import { resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
  'if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { run(); }\n';
const NAMED = "import { isMain } from './isMain.mjs';\nif (isMain(import.meta.url)) { run(); }\n";
const UNGUARDED = 'run();\n';
// The use that is NOT a guard, and the reason the first version of this scan
// reported 38 files and had to be narrowed before it measured anything.
const DIRNAME = "const here = fileURLToPath(import.meta.url);\nexport { here };\n";

try {
  // -------------------------------------------------------------------------
  // 1 & 2. IT CAN SEE the hand-rolled comparison, and does not report the rest.
  // -------------------------------------------------------------------------
  {
    const root = fixture('mixed', {
      'bad.mjs': HAND_ROLLED,
      'good.mjs': NAMED,
      'plain.mjs': UNGUARDED,
      'dirname.mjs': DIRNAME,
    });
    const result = report({ root, control: 'scripts/good.mjs' });
    check(
      'a hand-rolled `import.meta.url ===` comparison is reported',
      !result.ok && /bad\.mjs/u.test(result.output),
      `this is the expression that has been written wrong three times. Output:\n${result.output}`,
    );
    const { guarded, handRolled } = scanMainGuards({ root });
    check(
      'CONTROL: the named guard, the unguarded file and the dirname use are NOT reported',
      handRolled.length === 1 && guarded.length === 1 && guarded[0] === 'scripts/good.mjs',
      `guarded=${JSON.stringify(guarded)} handRolled=${JSON.stringify(handRolled)}. A file may ` +
        `run unconditionally — every proof here does — and fileURLToPath(import.meta.url) to ` +
        `locate a directory is an unrelated, correct use. Reporting those is how a scan gets ` +
        `turned off.`,
    );
  }

  // -------------------------------------------------------------------------
  // 2a. IT CAN SEE every spelling, not only the `===` one — including in a
  // module no npm script invokes, which the roster this scan used to take
  // (the manifest's entry points) did not read.
  // -------------------------------------------------------------------------
  {
    const root = fixture('spellings', {
      'urlSuffix.mjs': URL_SUFFIX,
      'nameSuffix.mjs': NAME_SUFFIX,
      'resolved.mjs': RESOLVED,
      'good.mjs': NAMED,
    });
    // OUTSIDE THE MANIFEST: a hook, as `.githooks/` enters `scripts/hooks/prePush.mjs`.
    mkdirSync(join(root, 'scripts', 'hooks'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'hooks', 'hook.mjs'), URL_SUFFIX, 'utf8');
    const { handRolled } = scanMainGuards({ root });
    const expected = ['scripts/hooks/hook.mjs', 'scripts/nameSuffix.mjs', 'scripts/resolved.mjs', 'scripts/urlSuffix.mjs'];
    check(
      'the url-suffix, name-suffix and resolved-path spellings are each reported, in or out of the manifest',
      JSON.stringify(handRolled) === JSON.stringify(expected),
      `reported ${JSON.stringify(handRolled)}, expected ${JSON.stringify(expected)}. The first ` +
        `pattern matched only "import.meta.url ===" and reported ok over 39 guards in these ` +
        `three spellings, four of them in files the manifest does not invoke.`,
    );
  }

  // -------------------------------------------------------------------------
  // 2b. WHY the url-suffix spelling is a defect and not a style: run from a
  // directory whose name has a space, it does not fire and isMain does. Run as
  // a real process, because argv[1] and import.meta.url are both facts about
  // how a process was started, and a simulation would choose them both.
  // -------------------------------------------------------------------------
  {
    const spaced = join(scratch, 'with space');
    mkdirSync(spaced, { recursive: true });
    const probe = join(spaced, 'probe.mjs');
    writeFileSync(
      probe,
      `import { isMain } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '..', 'lib', 'isMain.mjs')).href)};\n` +
        `const suffix = import.meta.url.endsWith(process.argv[1]?.replaceAll('\\\\', '/') ?? ' ');\n` +
        'process.stdout.write(JSON.stringify({ suffix, isMain: isMain(import.meta.url) }));\n',
      'utf8',
    );
    const child = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
    /** @type {{ suffix?: unknown, isMain?: unknown }} */
    let answer = {};
    try {
      answer = JSON.parse(child.stdout);
    } catch {
      // Left empty, and the check below reports what the child printed.
    }
    check(
      'from a path with a space, isMain fires and the url-suffix spelling does not',
      answer.isMain === true && answer.suffix === false,
      `the child answered ${JSON.stringify(answer)} (stdout ${JSON.stringify(child.stdout)}, stderr ` +
        `${JSON.stringify(child.stderr)}). isMain must be TRUE here, or the resolver has the defect; ` +
        `the suffix spelling FALSE is the reason it is refused: the url says %20 and argv says a space.`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. IT CAN TOLERATE a clean tree.
  // -------------------------------------------------------------------------
  {
    const root = fixture('clean', { 'good.mjs': NAMED, 'plain.mjs': UNGUARDED });
    const result = report({ root, control: 'scripts/good.mjs' });
    check(
      'a tree with no hand-rolled comparison is ok',
      result.ok,
      `a guard that cannot pass is a guard someone removes. Output:\n${result.output}`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. IT CAN REFUSE. Blinded, it must not report a clean tree.
  //
  // The fixture would PASS if the control were absent — it contains no
  // violation — so the failure can only come from the control.
  // -------------------------------------------------------------------------
  {
    const root = fixture('blind', { 'good.mjs': NAMED });
    const result = report({ root, control: 'scripts/not-here.mjs' });
    check(
      'a scan that did not locate its control is NOT ok, however clean the tree looked',
      !result.ok && /did not locate/u.test(result.output),
      `a roster that reads nothing reports every file as compliant. Output:\n${result.output}`,
    );
  }

  // -------------------------------------------------------------------------
  // 5. An empty roster THROWS rather than reporting a clean tree.
  // -------------------------------------------------------------------------
  {
    const root = join(scratch, 'empty');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }), 'utf8');
    let threw = false;
    try {
      scanMainGuards({ root });
    } catch {
      threw = true;
    }
    check(
      'a roster with no entry points throws — an empty derivation is a broken parse',
      threw,
      'reporting "no violations" for a roster that found nothing is the reassuring answer ' +
        'arriving from a defect.',
    );
  }

  // -------------------------------------------------------------------------
  // 6-8. THE RESOLVER ITSELF, driven on this platform.
  //
  // `isMain` is what the scan enforces, and enforcing a wrong resolver
  // everywhere would be worse than the three hand-rolled copies it replaces.
  // -------------------------------------------------------------------------
  check(
    'isMain is TRUE for the module the process was started with',
    // This proof IS an entry point, so its own url against its own argv is the
    // real question rather than a simulation of it.
    isMain(import.meta.url),
    `import.meta.url=${import.meta.url} argv[1]=${String(process.argv[1])}. If this is false on ` +
      `Windows the resolver has the exact defect it was written to remove, and every scan that ` +
      `takes it would silently do nothing.`,
  );
  check(
    'CONTROL: and FALSE for a different module in the same process',
    !isMain(pathToFileURL(join(scratch, 'somewhere-else.mjs')).href),
    'a resolver that always says true would satisfy the case above and make every guarded ' +
      'module run its CLI when imported.',
  );
  check(
    'with no entry script at all, nothing is main',
    await (async () => {
      const saved = process.argv[1];
      // The absence IS the case, so argv[1] is removed rather than blanked.
      delete process.argv[1];
      const answer = isMain(import.meta.url);
      process.argv[1] = saved ?? '';
      return !answer;
    })(),
    'under --eval or an embedder there is no entry script. A module deciding it is main there ' +
      'would run its CLI inside someone else’s process.',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} mainGuards case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('mainGuards case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
