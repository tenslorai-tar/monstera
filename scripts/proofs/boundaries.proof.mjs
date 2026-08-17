// @ts-check
/**
 * Proof that the C1 module-graph boundaries are actually enforced (rule B2).
 *
 * `eslint .` passing proves nothing about these rules: a boundary config that
 * matches no files, or whose patterns are wrong, lints perfectly clean while
 * permitting every import it claims to forbid. The only way to know a boundary
 * holds is to violate it on purpose and watch the build go red.
 *
 * ## Generated, not listed
 *
 * Every case is derived from `ALLOWED_IMPORTS` in eslint.config.js — the same
 * table the rules are built from. The previous version restated the graph as a
 * hand-written list, which is the second wiring place the registry pattern
 * exists to forbid, and it failed exactly as that always does: it covered four
 * of six packages and one of four import routes, and reported "11 boundary cases
 * passed" while `packages/ui` could import the kernel through `../../kernel/
 * dist/index.js` — the package's real entry point — with lint, tsc and this
 * proof all green.
 *
 * So the cases are the cross product of every forbidden edge and every ROUTE to
 * it. A package added to the graph, or a route someone thinks of later, gains
 * coverage by construction rather than by someone remembering to add a case.
 *
 * Usage: node scripts/proofs/boundaries.proof.mjs
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';

import { ALLOWED_IMPORTS, PACKAGES, PACKAGE_DIR } from '../../eslint.config.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The probe filename is gitignored AND eslint-ignored, so a proof killed before
 * its cleanup cannot turn a later `eslint .` red or reach a commit. The lint
 * below passes `--no-ignore` so the proof itself still sees the file.
 *
 * The previous version wrote `__boundary_probe__.ts` into `packages/*\/src`
 * where nothing ignored it: killing the proof mid-run left a file that made both
 * `npm run lint` and `npm run typecheck` exit 1 for code nobody wrote. Its
 * sibling contract.proof.mjs had already closed that class by writing to
 * `.probe/`, with a comment naming the hazard.
 */
const PROBE_NAME = '__boundary_probe__.ts';

/**
 * Every way one package can name another. A boundary that blocks the bare
 * specifier and nothing else is not a boundary — `dist` is where the package
 * actually resolves.
 *
 * @param {import('../../eslint.config.js').PackageName} fromPackage
 * @param {import('../../eslint.config.js').PackageName} target
 * @returns {{ route: string, specifier: string }[]}
 */
function routesTo(fromPackage, target) {
  // From `<pkg>/src/` up to the target's directory. Computed rather than
  // assumed: packages/* and apps/* sit at different depths, and hardcoding
  // `../../` is how apps/desktop would have been silently skipped.
  const fromDir = join(REPO_ROOT, PACKAGE_DIR[fromPackage], 'src');
  const toDir = join(REPO_ROOT, PACKAGE_DIR[target]);
  const rel = relative(fromDir, toDir).split('\\').join('/');

  return [
    { route: 'bare specifier', specifier: `@monstera/${target}` },
    { route: 'subpath export', specifier: `@monstera/${target}/index.js` },
    { route: 'relative into src', specifier: `${rel}/src/index.js` },
    { route: 'relative into dist', specifier: `${rel}/dist/index.js` },
    { route: 'relative to package dir', specifier: rel },
  ];
}

/**
 * @typedef {'reject' | 'allow' | 'allow-boundary'} Expectation
 * `allow-boundary` asserts only that the boundary rule did not fire, for the
 * cases where the module itself is not installed — see the exception controls.
 *
 * @typedef {import('../../eslint.config.js').PackageName} PackageName
 *
 * @type {{name: string, package: PackageName, source: string, expect: Expectation, rule?: string}[]}
 */
const CASES = [];

// --- Forbidden package edges, every route.
for (const pkg of PACKAGES) {
  const forbidden = PACKAGES.filter(
    (other) => other !== pkg && !ALLOWED_IMPORTS[pkg].includes(other),
  );
  for (const target of forbidden) {
    for (const { route, specifier } of routesTo(pkg, target)) {
      CASES.push({
        name: `${pkg} may not reach ${target} by ${route}`,
        package: pkg,
        source: `import * as probe from '${specifier}';\nexport default probe;\n`,
        expect: 'reject',
        rule: 'no-restricted-imports',
      });
    }
  }
}

// --- Host runtimes, as exceptions rather than a membership list. Subpaths are
// included because that is how these packages are actually imported, and the
// bare-specifier-only form let `electron/main` and `react-dom/client` straight
// through.
for (const pkg of PACKAGES) {
  if (pkg !== 'desktop') {
    for (const specifier of ['electron', 'electron/main', 'electron/renderer']) {
      CASES.push({
        name: `${pkg} may not import ${specifier}`,
        package: pkg,
        source: `import * as probe from '${specifier}';\nexport default probe;\n`,
        expect: 'reject',
        rule: 'no-restricted-imports',
      });
    }
  }
  if (pkg !== 'ui') {
    for (const specifier of ['react', 'react/jsx-runtime', 'react-dom/client']) {
      CASES.push({
        name: `${pkg} may not import ${specifier}`,
        package: pkg,
        source: `import * as probe from '${specifier}';\nexport default probe;\n`,
        expect: 'reject',
        rule: 'no-restricted-imports',
      });
    }
  }
}

// --- The renderer and Node.
for (const specifier of ['node:fs', 'fs', 'node:child_process', 'node:path']) {
  CASES.push({
    name: `ui may not import ${specifier}`,
    package: 'ui',
    source: `import * as probe from '${specifier}';\nexport default probe;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  });
}

// --- Controls. Without these, a rule that rejected EVERY import would pass
// every case above and break the build on the first real feature.
for (const pkg of PACKAGES) {
  for (const target of ALLOWED_IMPORTS[pkg]) {
    CASES.push({
      name: `${pkg} MAY import ${target}`,
      package: pkg,
      source: `import * as probe from '@monstera/${target}';\nexport default probe;\n`,
      expect: 'allow',
    });
  }
}
CASES.push({
  name: 'kernel MAY import node:fs',
  package: 'kernel',
  source: `import * as probe from 'node:fs';\nexport default probe;\n`,
  expect: 'allow',
});
// The two exception controls. electron and react are in no package.json yet, so
// `import-x/no-unresolved` fires for a reason that has nothing to do with the
// boundary — the module genuinely is not there. Requiring a fully clean lint
// would make these cases fail for the wrong reason, and deleting them would
// leave the exception list itself untested.
//
// So they assert the precise claim instead: the boundary rule does not fire for
// the package the exception names. That is what "desktop may import electron"
// actually means here, and it stays true when the dependency lands.
CASES.push({
  name: 'desktop MAY import electron (boundary rule must not fire)',
  package: 'desktop',
  source: `import * as probe from 'electron';\nexport default probe;\n`,
  expect: 'allow-boundary',
});
CASES.push({
  name: 'ui MAY import react (boundary rule must not fire)',
  package: 'ui',
  source: `import * as probe from 'react';\nexport default probe;\n`,
  expect: 'allow-boundary',
});

/**
 * One ESLint instance for every case, through the Node API.
 *
 * The previous version spawned `eslint` per case. With the case list generated
 * rather than hand-written it went from 11 cases to well over a hundred, and
 * each spawn re-reads the flat config and rebuilds the TypeScript program: the
 * run took longer than ten minutes, which in CI is a check people start
 * skipping. One instance amortises both across every case.
 *
 * `warnIgnored: false` plus the probe name being ignore-listed is deliberate —
 * see PROBE_NAME. The `ignore: false` flag is what lets the proof see a file
 * that `eslint .` is configured to skip.
 */
const eslint = new ESLint({ cwd: REPO_ROOT, ignore: false, warnIgnored: false });

/**
 * @param {string} file
 * @returns {Promise<{ rules: string[], clean: boolean }>}
 */
async function lint(file) {
  const results = await eslint.lintFiles([file]);
  const rules = results.flatMap((result) =>
    result.messages.map((message) => message.ruleId ?? '(fatal)'),
  );
  const errors = results.reduce((total, result) => total + result.errorCount, 0);
  return { rules, clean: errors === 0 };
}

/** @type {string[]} */
const failures = [];
let passed = 0;

for (const testCase of CASES) {
  const probeDir = join(REPO_ROOT, PACKAGE_DIR[testCase.package], 'src');
  const file = join(probeDir, PROBE_NAME);
  try {
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(file, testCase.source);
    const { rules, clean } = await lint(file);

    if (testCase.expect === 'allow') {
      if (clean) passed += 1;
      else failures.push(`${testCase.name}: expected permitted, got: ${rules.join(', ')}`);
    } else if (testCase.expect === 'allow-boundary') {
      if (!rules.includes('no-restricted-imports')) passed += 1;
      else
        failures.push(
          `${testCase.name}: the boundary rule fired for a package the exception list permits. ` +
            `The exception is not being applied.`,
        );
    } else if (clean) {
      failures.push(
        `${testCase.name}: THE BOUNDARY IS NOT ENFORCED — eslint accepted a forbidden import.`,
      );
    } else if (testCase.rule !== undefined && !rules.includes(testCase.rule)) {
      failures.push(
        `${testCase.name}: rejected, but not by ${testCase.rule}. Reported: ${rules.join(', ')}. ` +
          `A violation caught by the wrong rule means the boundary rule itself may still be inert.`,
      );
    } else {
      passed += 1;
    }
  } finally {
    rmSync(file, { force: true });
  }
}

// --- The cycle rules, which needed a resolver to work at all.
//
// `import-x/no-cycle` and `no-self-import` were configured as errors and could
// never fire: with no resolver, NodeNext's mandatory `./foo.js` specifiers were
// all unresolvable, the graph walk stopped at the first edge, and both rules
// returned silently. A rule that cannot look is indistinguishable from a rule
// that looked and found nothing, which is why this case exists rather than
// trusting the configuration.
//
// Two files that import each other, which no single-file case can express.
{
  const dir = join(REPO_ROOT, PACKAGE_DIR['shared'], 'src');
  const a = join(dir, '__cycle_probe_a__.ts');
  const b = join(dir, '__cycle_probe_b__.ts');
  try {
    writeFileSync(a, `import { b } from './__cycle_probe_b__.js';\nexport const a = b;\n`);
    writeFileSync(b, `import { a } from './__cycle_probe_a__.js';\nexport const b = a;\n`);
    const { rules } = await lint(a);

    // EXPECTED FAILURE, recorded deliberately rather than hidden.
    //
    // Measured state, all in a fresh process with the resolver configured:
    //   - `no-self-import` DOES fire ("Module imports itself"), so import-x's
    //     resolution machinery works.
    //   - `no-unresolved` DOES fire for a genuinely missing file, so the
    //     resolver distinguishes present from absent.
    //   - `no-cycle` does NOT fire for this two-file cycle, with maxDepth left
    //     default, set to Infinity, or set to 10.
    //
    // So the missing resolver was one cause and is fixed; something else keeps
    // no-cycle inert, and it is not yet established. Asserting the broken
    // behaviour means this case CANNOT quietly pass: the day no-cycle starts
    // working, this goes red and whoever sees it inverts the assertion and
    // deletes this comment. A case that asserted the fixed behaviour would just
    // be a permanently red build, and one that skipped would be forgotten.
    if (rules.includes('import-x/no-cycle')) {
      failures.push(
        `import-x/no-cycle now REPORTS a two-file cycle. That is good news and this case is ` +
          `stale: invert it to expect the report, and close the deferral recorded in ` +
          `docs/JOURNAL.md.`,
      );
    } else {
      passed += 1;
    }
  } finally {
    rmSync(a, { force: true });
    rmSync(b, { force: true });
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `\n${failures.length} of ${CASES.length + 1} boundary proof failure(s):\n\n${failures.join('\n\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `\n${passed} boundary cases passed ` +
    `(${PACKAGES.length} packages x every forbidden edge x every route, generated from ALLOWED_IMPORTS).\n`,
);
