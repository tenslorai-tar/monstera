// @ts-check
/**
 * Proves `machineNames.mjs` can see, separate and refuse: a user name in a profile path and a computer name in a UNC path
 * are found whatever their case, the part of a computer name before "-PC" is found on its own under the same rules, the
 * same name inside a longer word is not, ordinary text passes, a short or generic name
 * is skipped and said to be, and — run as the hook runs it, in a throwaway repository — a file staged with this machine's
 * own name is refused without the refusal printing the name, while ordinary staged text passes.
 *
 * NO REAL NAME IS SPELT HERE. The fixtures are made up, and the planted one is read from the operating system at run
 * time, exactly as the hook reads it.
 *
 * Usage: node scripts/proofs/machineNames.proof.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforePcSuffix, foundLines, identifiersFrom, machineIdentifiers } from '../lib/machineNames.mjs';
import { createRoster } from '../lib/passRoster.mjs';

const SCAN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'machineNames.mjs');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 13 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const fixture = identifiersFrom({ users: ['sampleuser'], hosts: ['SAMPLEBOX-PC'] });

{
  const found = foundLines('first line\nC:\\Users\\SampleUser\\AppData\\Roaming\\Monstera PDF Editor\n', fixture.checked);
  check('a user name inside a profile path is found on its line, whatever its case', JSON.stringify(found) === '[{"line":2,"kind":"user name"}]', JSON.stringify(found));
}
{
  const found = foundLines('measured through `\\\\samplebox-pc\\C$\\f.txt`\n', fixture.checked);
  check('a computer name inside a UNC path is found', JSON.stringify(found) === '[{"line":1,"kind":"computer name"}]', JSON.stringify(found));
}
{
  // THE SAME LETTERS INSIDE LONGER WORDS: a whole-token match, so a name that is part of a word is not a hit. The third
  // line is joined on the LEFT: joined on the right alone (`samplebox-pcs`) it holds the stem before `-PC` as a whole
  // token, which is a name since the owner's decision of 2026-11-10.
  const found = foundLines('the sampleusers table\nexamplesampleuser\nthesamplebox-pcs\n', fixture.checked);
  check('CONTROL: the same names inside longer words are not found, so the cases above found them as names', found.length === 0, JSON.stringify(found));
}
{
  const found = foundLines('A paragraph about users, hosts and \\\\HOST\\C$\\… placeholders.\nC:\\Users\\<user>\\AppData\n', fixture.checked);
  check('ordinary text, placeholders included, holds no machine name', found.length === 0, JSON.stringify(found));
}
{
  // A FULLY QUALIFIED HOST NAME: its first label is what a UNC path or a prompt carries, so it is looked for too.
  const qualified = identifiersFrom({ users: [], hosts: ['buildbox7.example.internal'] });
  const found = foundLines('\\\\BUILDBOX7\\share\n', qualified.checked);
  check('a fully qualified host name’s first label is looked for', found.length === 1, `checked ${String(qualified.checked.length)}, found ${JSON.stringify(found)}`);
}
{
  // THE PART BEFORE `-PC`, written on its own (the owner's decision of 2026-11-10). Without `beforePcSuffix` the fixture
  // checks only `SAMPLEBOX-PC`, and this line, which holds the stem alone, reports nothing.
  const found = foundLines('measured on samplebox this morning\n\\\\SAMPLEBOX\\share\n', fixture.checked);
  check(
    'the part of a computer name before "-PC" is looked for as its own name',
    JSON.stringify(found) === '[{"line":1,"kind":"computer name"},{"line":2,"kind":"computer name"}]',
    JSON.stringify(found),
  );
}
{
  // CONTROL: the stem is a whole-token match like every name, so a longer word that begins with it is not a hit, and a
  // name with no `-PC` ending gains no second identifier.
  const plain = identifiersFrom({ users: [], hosts: ['SAMPLEBOX7'] });
  const found = foundLines('sampleboxes\nsamplebox7x\n', fixture.checked);
  check(
    'CONTROL: the stem inside a longer word is not found, and a name without "-PC" gains no stem',
    found.length === 0 && plain.checked.length === 1 && beforePcSuffix('SAMPLEBOX7') === undefined && beforePcSuffix('-PC') === undefined,
    `found ${JSON.stringify(found)}; checked ${String(plain.checked.length)}`,
  );
}
{
  // THE SAME RULES AS EVERY NAME: a stem shorter than the minimum, or a generic one, is skipped with its reason. And a
  // skipped entry carries the kind and the reason, never the value, so the note printed for it cannot leak the name.
  const answered = identifiersFrom({ users: [], hosts: ['ABCD-PC', 'DESKTOP-PC'] });
  const reasons = answered.skipped.map((each) => `${each.kind}: ${each.why}`).join('; ');
  check(
    'a stem before "-PC" that is too short or generic is skipped with its reason, and the skip names no value',
    answered.checked.length === 2 &&
      answered.skipped.length === 2 &&
      answered.skipped.every((each) => !JSON.stringify(each).toLowerCase().includes('abcd') && !JSON.stringify(each).toLowerCase().includes('desktop')),
    `checked ${String(answered.checked.length)}; skipped ${reasons}`,
  );
}
{
  // TOO SHORT AND GENERIC: skipped, each with its reason, and never looked for — a common account name would report
  // half the tree.
  const answered = identifiersFrom({ users: ['mark', 'runner'], hosts: ['localhost'] });
  const reasons = answered.skipped.map((each) => `${each.kind}: ${each.why}`).join('; ');
  check(
    'a name shorter than the minimum, and a generic one, are skipped with their reasons and never looked for',
    answered.checked.length === 0 && answered.skipped.length === 3 && foundLines('mark the runner on localhost\n', answered.checked).length === 0,
    `checked ${String(answered.checked.length)}; skipped ${reasons}`,
  );
}

/** A throwaway repository with one commit, and a file staged in it. @param {string} text */
function stagedRepository(text) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-machinenames-'));
  const git = (/** @type {string[]} */ args) => {
    const done = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (done.status !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr}`);
  };
  git(['init', '--quiet']);
  git(['config', 'user.email', 'proof@example.invalid']);
  git(['config', 'user.name', 'Machine Names Proof']);
  writeFileSync(join(root, 'README.md'), '# scratch\n');
  git(['add', 'README.md']);
  git(['commit', '--quiet', '--no-verify', '-m', 'base']);
  writeFileSync(join(root, 'notes.md'), text);
  git(['add', 'notes.md']);
  return root;
}

/** The scan run as the hook runs it, against the index of `root`. @param {string} root */
function runStaged(root) {
  const done = spawnSync(process.execPath, [SCAN, '--staged'], { cwd: root, encoding: 'utf8' });
  rmSync(root, { recursive: true, force: true });
  return { status: done.status, out: `${done.stdout}${done.stderr}` };
}

// THIS MACHINE'S OWN NAME, read from the operating system as the hook reads it: a CI runner's account is generic, and
// its host name is not, so there is always one to plant.
const own = machineIdentifiers().checked[0];
{
  if (own === undefined) {
    check('this machine has a name specific enough to plant', false, 'the operating system answered no user or computer name the scan would look for');
  } else {
    const planted = runStaged(stagedRepository(`measured on this machine\nthrough \\\\${own.value}\\C$\\f.txt\n`));
    check(
      `a staged file holding this machine's own ${own.kind} is refused, on its line`,
      planted.status === 1 && planted.out.includes(`notes.md:2 holds this machine's ${own.kind}`),
      `exit ${String(planted.status)}`,
    );
    // THE REFUSAL MUST NOT CARRY THE VALUE: a log that captured the hook would hold the name the rule keeps out.
    check('the refusal never prints the name it refused', !planted.out.toLowerCase().includes(own.value.toLowerCase()), 'the name appears in the scan’s output');
  }
}
{
  // EVERY NAME THIS MACHINE ANSWERS, one to a line, the stem before "-PC" among them where the machine has one long
  // enough: each line refused, and none of the values in what the scan printed.
  const all = machineIdentifiers().checked;
  const planted = runStaged(stagedRepository(`measured on this machine\n${all.map((each) => `seen: ${each.value}`).join('\n')}\n`));
  const refused = all.every((each, at) => planted.out.includes(`notes.md:${String(at + 2)} holds this machine's ${each.kind}`));
  const silent = all.every((each) => !planted.out.toLowerCase().includes(each.value.toLowerCase()));
  check(
    `every one of this machine's ${String(all.length)} name(s) is refused on its line, and none is printed`,
    all.length > 0 && planted.status === 1 && refused && silent,
    `exit ${String(planted.status)}; refused each ${String(refused)}; printed none ${String(silent)}`,
  );
}
{
  const ordinary = runStaged(stagedRepository('An ordinary note about \\\\HOST\\C$\\… and C:\\Users\\<user>\\.\n'));
  check('CONTROL: ordinary staged text passes the same scan run the same way', ordinary.status === 0, `exit ${String(ordinary.status)}: ${ordinary.out.trim().split('\n').at(-1) ?? ''}`);
}

process.stdout.write(
  failures.length === 0 ? roster.format('machine-name case') : `${String(failures.length)} machine-name case(s) FAILED:\n  - ${failures.join('\n  - ')}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
