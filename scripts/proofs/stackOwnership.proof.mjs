// @ts-check
/**
 * The stack-ownership scan can SEE, can REFUSE, and separates the four things
 * a textual scan cannot (finding FFF-1, closing Y-3).
 *
 * `scripts/lib/stackOwnership.mjs` is a search, and its reassuring answer —
 * *no Error stack read outside an owner* — is also what a wrong project set, a
 * compiler that failed to load, and a walk that never visited a file all
 * produce. Every case here exists because one of those ways of being blind
 * returns the same clean result as a correct tree.
 *
 * Cases run against **fixture repositories** except where a case is explicitly
 * about this one. A proof that could only run against the real tree would be a
 * proof about today's contents: it would go red the day a legitimate reader of
 * `StructuredError` is added, and it could never exercise the receiver the
 * compiler cannot decide, because there is not one here — a branch keyed on the
 * presence of something has a side that never executes wherever that thing is
 * always absent.
 *
 * ## What the fixture supplies and why
 *
 * The scan's owner list is two hard-coded paths. A fixture repository does not
 * contain them, so the positive control would fail and every case would report
 * BLIND — correctly, and uselessly. `scan` therefore accepts `owners`, and one
 * case runs the real list against the real tree so that the two shipped paths
 * are asserted somewhere.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import {
  STACK_OWNERS,
  ownerFamily,
  projectPaths,
  report,
  scan,
} from '../lib/stackOwnership.mjs';
import { loadTypeScript } from '../lib/loadTypeScript.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 24 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @type {string[]} */
const scratches = [];

/**
 * A throwaway git repository shaped like this one: a solution `tsconfig.json`
 * with one referenced package, and a sibling project for the plain-`.mjs` layer.
 *
 * It must be a real git repository because the root control asks git which
 * source files exist — `filesInCommit` is the one resolver for that question
 * (B3a), and giving the proof a second one would let the two disagree.
 *
 * @param {Record<string, string>} files Repository-relative path to contents.
 * @returns {string}
 */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'monstera-stackowner-'));
  scratches.push(dir);
  const base = {
    compilerOptions: {
      target: 'ES2023',
      lib: ['ES2023'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    },
  };
  /** @type {Record<string, string>} */
  const all = {
    'tsconfig.json': `${JSON.stringify({ files: [], references: [{ path: './pkg' }] }, null, 2)}\n`,
    'tsconfig.scripts.json': `${JSON.stringify(
      { ...base, compilerOptions: { ...base.compilerOptions, allowJs: true, checkJs: false }, include: ['scripts/**/*.mjs'] },
      null,
      2,
    )}\n`,
    'pkg/tsconfig.json': `${JSON.stringify({ ...base, include: ['src/**/*'] }, null, 2)}\n`,
    // The sibling project must match something: a project that matched no files
    // makes the scan throw, which is its own case below.
    'scripts/entry.mjs': 'export const entry = 1;\n',
    ...files,
  };
  for (const [path, contents] of Object.entries(all)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
  }
  execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

/** The owner list a fixture uses, matching the file the fixture writes. */
const FIXTURE_OWNERS = ['pkg/src/owner.ts'];

/** An owner: it reads a real Error's stack, which is what the control looks for. */
const OWNER_SOURCE = [
  'export function render(thrown: Error): string {',
  '  return thrown.stack ?? thrown.message;',
  '}',
  '',
].join('\n');

try {
  // ---------------------------------------------------------------------------
  // THE FOUR THINGS A TEXTUAL SCAN CANNOT SEPARATE, in one program.
  //
  // Each subject is on its own line so a report can be checked by line number
  // rather than by counting, and every one of them contains the same text.
  // ---------------------------------------------------------------------------
  {
    const subject = [
      'interface Carried { readonly stack?: string | undefined; }',
      'declare const shim: { stackCookie: boolean };',
      'declare const carried: Carried;',
      'declare const loose: any;',
      'export function bad(thrown: Error): string {',
      '  return thrown.stack ?? "";', // 6 — the defect
      '}',
      'export function planted(): Error {',
      '  const made = new Error("x");',
      '  made.stack = "planted";', // 10 — a write, not a rendering
      '  return made;',
      '}',
      'export function reader(): string | undefined {',
      '  return carried.stack;', // 14 — a declared field, read
      '}',
      'export function cookie(): boolean {',
      '  return shim.stackCookie;', // 17 — a different property
      '}',
      'export const emitted = `process.on("x", (e) => console.log(e.stack));`;', // 19
      '// A comment naming thrown.stack, which is prose and not code.', // 20
      'export function destructured(thrown: Error): string | undefined {',
      '  const { stack } = thrown;', // 22 — binding renders exactly as reading
      '  return stack;',
      '}',
      'export function indexed(thrown: Error): string | undefined {',
      '  return thrown["stack"];', // 26 — element access
      '}',
      'export function subclassed(thrown: TypeError): string | undefined {',
      '  return thrown.stack;', // 29 — a subclass inherits the property
      '}',
      'export function undecided(): unknown {',
      '  return loose.stack;', // 32 — the compiler could not decide
      '}',
      '',
    ].join('\n');

    const dir = fixture({ 'pkg/src/owner.ts': OWNER_SOURCE, 'pkg/src/subject.ts': subject });
    const result = await scan({ root: dir, owners: FIXTURE_OWNERS });
    const at = (/** @type {number} */ line) =>
      result.accesses.find(
        (access) => access.file === 'pkg/src/subject.ts' && access.line === line,
      );
    const finding = (/** @type {number} */ line) =>
      result.findings.some((access) => access.file === 'pkg/src/subject.ts' && access.line === line);

    check(
      'an Error stack read outside an owner is a finding',
      finding(6),
      `findings: ${JSON.stringify(result.findings.map((a) => `${a.file}:${String(a.line)}`))}`,
    );
    check(
      'a WRITE is not, because an assignment reads no chain to discard',
      at(10)?.kind === 'write' && !finding(10),
      `line 10: ${JSON.stringify(at(10))}. Every fixture in this repository that plants a stack ` +
        `on an error would otherwise be reported, and the report would be ignored.`,
    );
    check(
      'reading a field an owner DECLARES is not — B3 says many readers are fine',
      at(14)?.receiver === 'other' && !finding(14),
      `line 14: ${JSON.stringify(at(14))}. This is the case a textual scan gets wrong, and it ` +
        `is the majority of this repository's occurrences.`,
    );
    check(
      'a differently-named property is not even seen',
      at(17) === undefined,
      `line 17: ${JSON.stringify(at(17))}. A word boundary is what a textual scan needs here; ` +
        `an AST walk needs nothing, which is why the false positive is unrepresentable.`,
    );
    check(
      'nor is the same text inside a template, which is how emitted source is written',
      at(19) === undefined,
      `line 19: ${JSON.stringify(at(19))}. Emitted source is not excepted here — a template's ` +
        `contents are a string, so the walk never reaches them. Both instances in this ` +
        `repository sit in String.raw regions and need no rule at all.`,
    );
    check(
      'nor in a comment',
      at(20) === undefined,
      `line 20: ${JSON.stringify(at(20))}`,
    );
    check(
      'DESTRUCTURING is a finding, or the check has a documented way round it',
      finding(22),
      `line 22: ${JSON.stringify(at(22))}. Binding the property renders exactly as reading it ` +
        `does, and a guard that a rewrite evades is not a guard.`,
    );
    check(
      'so is an element access with a string literal',
      finding(26),
      `line 26: ${JSON.stringify(at(26))}`,
    );
    check(
      'a SUBCLASS of Error is still Error — the property symbol is inherited',
      finding(29),
      `line 29: ${JSON.stringify(at(29))}. Matching only the name \`Error\` would miss every ` +
        `TypeError, RangeError and custom subclass, which is most real throw sites.`,
    );
    check(
      'a receiver the compiler could not decide is UNRESOLVED, not clean',
      at(32)?.receiver === 'unresolved' &&
        result.unresolved.some((access) => access.line === 32),
      `line 32: ${JSON.stringify(at(32))}. "Could not look" and "looked and found nothing" must ` +
        `not share an output, and there is no such receiver in this repository — so without ` +
        `this fixture the branch would never execute anywhere it is checked.`,
    );
    check(
      'CONTROL: the owner is exempt, and it is the same shape as the finding',
      result.findings.every((access) => access.file !== 'pkg/src/owner.ts') &&
        (result.witnesses['pkg/src/owner.ts'] ?? 0) > 0,
      `witnesses: ${JSON.stringify(result.witnesses)}. Without this, "the owner is exempt" is ` +
        `satisfied by an owner the walk never reached.`,
    );
  }

  // ---------------------------------------------------------------------------
  // IT CAN REFUSE. Both controls, each with the tree otherwise clean, so the
  // refusal is attributable to the control and not to a finding.
  // ---------------------------------------------------------------------------
  {
    // An owner that names the property but never on an Error: the tree is
    // otherwise clean, so a scan without this control would report success.
    const silent = [
      'interface Carried { readonly stack?: string | undefined; }',
      'declare const carried: Carried;',
      'export const held = carried.stack;',
      '',
    ].join('\n');
    const dir = fixture({ 'pkg/src/owner.ts': silent });
    const result = await scan({ root: dir, owners: FIXTURE_OWNERS });
    check(
      'an owner that yields no Error-typed read makes the scan BLIND, on a clean tree',
      result.blind && result.findings.length === 0,
      `blind=${String(result.blind)}, findings=${String(result.findings.length)}, ` +
        `witnesses=${JSON.stringify(result.witnesses)}. An owner contributing zero means the ` +
        `walk could not see, and a clean report would then mean nothing at all. The tree is ` +
        `deliberately clean so the refusal is attributable to the control, not to a finding.`,
    );
    check(
      'and the report says so instead of printing a verdict',
      report(result).includes('REFUSING TO REPORT'),
      `report:\n${report(result)}`,
    );
  }

  {
    // A tracked source file no project includes: the root axis (X-1). The file
    // sits outside both `pkg/src` and `scripts/`, so nothing reads it.
    const dir = fixture({
      'pkg/src/owner.ts': OWNER_SOURCE,
      'tools/loose.mjs': 'export const x = 1;\n',
    });
    const result = await scan({ root: dir, owners: FIXTURE_OWNERS });
    check(
      'a tracked source file in NO project makes the scan BLIND',
      result.blind && result.uncovered.includes('tools/loose.mjs'),
      `uncovered=${JSON.stringify(result.uncovered)}. Fixing a classifier's pattern and leaving ` +
        `its root is half a fix, and both halves report "found nothing" identically.`,
    );
    check(
      'CONTROL: and the same tree without that file is not blind',
      !(await scan({ root: fixture({ 'pkg/src/owner.ts': OWNER_SOURCE }), owners: FIXTURE_OWNERS }))
        .blind,
      `Without this, the case above passes against a fixture that is blind for some other ` +
        `reason — a missing owner, a project that matched nothing.`,
    );
  }

  // ---------------------------------------------------------------------------
  // THE PROJECT SET IS DERIVED, and a broken derivation throws rather than
  // returning a short list. An empty intermediate result is a broken parse.
  // ---------------------------------------------------------------------------
  {
    const ts = await loadTypeScript('the project-set cases cannot run');
    const noReferences = mkdtempSync(join(tmpdir(), 'monstera-stackowner-cfg-'));
    scratches.push(noReferences);
    writeFileSync(join(noReferences, 'tsconfig.json'), '{ "files": [] }\n', 'utf8');
    writeFileSync(join(noReferences, 'tsconfig.scripts.json'), '{ "include": ["a/**/*"] }\n', 'utf8');
    let threwOnReferences = false;
    try {
      projectPaths(ts, noReferences);
    } catch {
      threwOnReferences = true;
    }
    check(
      'a solution with no references THROWS rather than reading no packages',
      threwOnReferences,
      `Reading zero packages and reporting no findings is the reassuring answer arriving from a ` +
        `broken derivation.`,
    );

    const noSibling = mkdtempSync(join(tmpdir(), 'monstera-stackowner-cfg-'));
    scratches.push(noSibling);
    writeFileSync(
      join(noSibling, 'tsconfig.json'),
      '{ "files": [], "references": [{ "path": "./pkg" }] }\n',
      'utf8',
    );
    writeFileSync(join(noSibling, 'tsconfig.base.json'), '{ "compilerOptions": {} }\n', 'utf8');
    let threwOnSibling = false;
    try {
      projectPaths(ts, noSibling);
    } catch {
      threwOnSibling = true;
    }
    check(
      'and a root whose only sibling config declares no include THROWS too',
      threwOnSibling,
      `\`tsconfig.scripts.json\` is deliberately not a project reference, so reading references ` +
        `alone silently drops every plain-.mjs file — which is where the seventeenth instance ` +
        `lived.`,
    );
    check(
      'CONTROL: and this repository satisfies both, so the throws are not the normal path',
      projectPaths(ts, ROOT).length >= 7,
      `projects: ${JSON.stringify(projectPaths(ts, ROOT).map((path) => path.replace(ROOT, '')))}`,
    );
  }

  // ---------------------------------------------------------------------------
  // THE OWNER'S PROOF IS DERIVED FROM THE OWNER, not listed beside it.
  // ---------------------------------------------------------------------------
  {
    check(
      "an owner's sibling proof and test are derived from its path",
      ownerFamily('scripts/lib/reportError.mjs').includes('scripts/lib/reportError.proof.mjs') &&
        ownerFamily('packages/shared/src/result.ts').includes('packages/shared/src/result.test.ts'),
      `${JSON.stringify(ownerFamily('scripts/lib/reportError.mjs'))} / ` +
        `${JSON.stringify(ownerFamily('packages/shared/src/result.ts'))}`,
    );
    check(
      'CONTROL: and a file that merely sits beside an owner is not covered',
      !ownerFamily('scripts/lib/reportError.mjs').includes('scripts/lib/gitScope.mjs') &&
        !ownerFamily('scripts/lib/reportError.mjs').includes('scripts/lib/reportError.helper.mjs'),
      `A directory-level exemption would cover every module in scripts/lib, which is thirty ` +
        `files and not an owner.`,
    );
  }

  // ---------------------------------------------------------------------------
  // THIS REPOSITORY, with the shipped owner list.
  // ---------------------------------------------------------------------------
  {
    const result = await scan({ root: ROOT });
    check(
      'THIS repository reads no Error stack outside an owner',
      result.findings.length === 0 && result.unresolved.length === 0,
      `findings: ${JSON.stringify(result.findings.map((a) => `${a.file}:${String(a.line)}`))}; ` +
        `unresolved: ${JSON.stringify(result.unresolved.map((a) => `${a.file}:${String(a.line)}`))}`,
    );
    check(
      'CONTROL: and the walk found a non-trivial number of accesses to judge',
      result.accesses.length > 8 && !result.blind,
      `accesses=${String(result.accesses.length)}, blind=${String(result.blind)}. A count near ` +
        `zero means the walk stopped recognising the property, and "none outside an owner" ` +
        `would then be true of almost nothing.`,
    );
    check(
      'CONTROL: and both shipped owners were located in it',
      STACK_OWNERS.every((owner) => (result.witnesses[owner] ?? 0) > 0),
      `witnesses: ${JSON.stringify(result.witnesses)}. The fixtures above pass their own owners, ` +
        `so this is the only case that says the two shipped paths are right.`,
    );
  }

  // ---------------------------------------------------------------------------
  // THE SCAN IS REGISTERED. A check nothing runs is a check that does not exist.
  // ---------------------------------------------------------------------------
  {
    const guards = readFileSync(join(ROOT, '.github', 'workflows', 'guards.yml'), 'utf8');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const script = String(manifest.scripts?.['check:stackowner'] ?? '');
    check(
      'and a workflow actually runs it, through a script that names the scan',
      guards.includes('check:stackowner') && script.includes('scripts/lib/stackOwnership.mjs'),
      `guards names it: ${String(guards.includes('check:stackowner'))}; ` +
        `check:stackowner = ${JSON.stringify(script)}. A workflow running a script name that ` +
        `points somewhere else is registered in appearance only.`,
    );
  }
} finally {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `${String(failures.length)} case(s) FAILED:\n\n${failures.map((entry) => `  -  ${entry}`).join('\n\n')}\n\n`
    : roster.format('stack-ownership case'),
);
process.exitCode = failures.length > 0 ? 1 : 0;
