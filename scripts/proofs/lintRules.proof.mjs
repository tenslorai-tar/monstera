// @ts-check
/**
 * Proof that the lint rules this project's documents claim are enforced
 * actually are (rule B2, audit finding 31, extended by OOOO-1).
 *
 * Two families, here rather than in two files. The question — *does the config
 * really enforce what a document says it enforces* — has one owner, and a second
 * registration check beside this one would be B3a's second opinion about it.
 *
 * CLAUDE.md and CONTRIBUTING.md both stated the React Compiler lint rules were
 * errors. `eslint --print-config packages/ui/src/index.ts` returned an empty
 * list of React rules: the plugin was installed and never imported by
 * eslint.config.js. Harmless on the day it was found — react was not a
 * dependency and packages/ui held one `export {}` file — and unfixable in
 * practice the moment it stops being harmless, because a rule about how
 * components are WRITTEN cannot be applied retroactively to components already
 * written. That is B9's argument, and this is the check that keeps the claim
 * honest.
 *
 * Three cases, and the last one is what makes the first two mean anything:
 *
 *   1. Every rule the plugin's recommended set enables is configured, at error.
 *      Derived from the plugin, not from a hand-written list — a list here would
 *      be a second place to update, and would silently stop covering rules a
 *      later plugin version adds.
 *   2. The scope is packages/ui, and only packages/ui.
 *   3. The rules FIRE. A configured-but-inert rule prints the same
 *      `--print-config` output as a working one.
 *
 * ## The second family, and why it needed this file rather than a green check
 *
 * `@typescript-eslint/no-import-type-side-effects` closes ADR-0026's class:
 * `import { type X } from './y.js'` elides the specifiers and keeps the
 * statement, emitting a runtime load. `docs/FEATURES.md` states the rule is an
 * error over every `.ts`, and **`check:lint` being green does not establish
 * that**. Delete the line from `eslint.config.js` and the tree is still clean,
 * because all seventy violations were rewritten first.
 *
 * That ordering is not an accident of this change; it is the general shape, and
 * it is the reason this proof exists at all: **fixing a class removes the
 * evidence that the guard against it works.** While violations remain, a broken
 * rule and a working one give different answers. Once they are gone the two are
 * indistinguishable, so the proof has to supply its own violation — which is
 * what the probe below is.
 *
 * Scope is checked across three trees rather than one, because `apps/desktop`
 * held 23 of the 70 and a config block matching only `packages/**` would pass a
 * single-tree check while covering a third of the class.
 *
 * Usage: node scripts/proofs/lintRules.proof.mjs
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {unknown} level @returns {string} */
function severity(level) {
  const value = Array.isArray(level) ? level[0] : level;
  if (value === 2 || value === 'error') return 'error';
  if (value === 1 || value === 'warn') return 'warn';
  return 'off';
}

async function main() {
  const eslint = new ESLint({ cwd: ROOT });

  // The rules the plugin itself says make up its recommended set. Read from the
  // plugin so a version that adds a rule widens this proof automatically.
  const expected = Object.keys(reactHooks.configs.flat['recommended-latest'].rules ?? {});
  check(
    'the plugin exposes a recommended rule set to check against',
    expected.length > 0,
    'no rules found in configs.flat["recommended-latest"] — this proof would then assert ' +
      'nothing at all, which is worse than the state it was written to fix.',
  );

  /** @type {Record<string, unknown>} */
  const uiConfig = await eslint.calculateConfigForFile(
    join(ROOT, 'packages', 'ui', 'src', 'index.ts'),
  );
  const uiRules = /** @type {Record<string, unknown>} */ (uiConfig['rules'] ?? {});

  const missing = expected.filter((rule) => severity(uiRules[rule]) === 'off');
  check(
    `all ${expected.length} recommended React rules are configured for packages/ui`,
    missing.length === 0,
    `not configured: ${missing.join(', ')}\n      This is the exact state the audit found: two ` +
      `documents asserting the rules, and ESLint enforcing none of them.`,
  );

  const notErrors = expected.filter((rule) => severity(uiRules[rule]) === 'warn');
  check(
    'none of them is left at warn',
    notErrors.length === 0,
    `still warnings: ${notErrors.join(', ')}\n      This project has no warning tier — B7 makes ` +
      `lint findings errors — and the plugin ships four of these as warnings by default.`,
  );

  /** @type {Record<string, unknown>} */
  const kernelConfig = await eslint.calculateConfigForFile(
    join(ROOT, 'packages', 'kernel', 'src', 'index.ts'),
  );
  const kernelRules = /** @type {Record<string, unknown>} */ (kernelConfig['rules'] ?? {});
  const leaked = expected.filter((rule) => severity(kernelRules[rule]) !== 'off');
  check(
    'they are scoped to packages/ui and do not leak into the kernel',
    leaked.length === 0,
    `also active in packages/kernel: ${leaked.join(', ')}\n      Only the ui package may import ` +
      `React; applying its rules elsewhere would be enforcing a constraint on code that cannot ` +
      `violate it, which trains people to ignore the rule.`,
  );

  // ---------------------------------------------------------------------
  // The resolution test: configured is not the same as working.
  // ---------------------------------------------------------------------
  // No leading dot: ESLint ignores dot-directories by default, so a probe in
  // one is silently not linted and this case reports "none" for a working rule.
  const probeDirectory = join(ROOT, 'packages', 'ui', 'src', 'lint-probe-temp');
  const probe = join(probeDirectory, 'probe.tsx');
  try {
    mkdirSync(probeDirectory, { recursive: true });
    writeFileSync(
      probe,
      'export function Probe({ flag }: { flag: boolean }) {\n' +
        '  if (flag) {\n' +
        '    const [value] = useState(0);\n' +
        '    return value;\n' +
        '  }\n' +
        '  return null;\n' +
        '}\n' +
        'declare function useState<T>(initial: T): [T, (next: T) => void];\n',
      'utf8',
    );

    const results = await eslint.lintFiles([probe]);
    const found = results
      .flatMap((result) => result.messages)
      .filter((message) => `${message.ruleId ?? ''}`.startsWith('react-hooks/'));

    check(
      'a conditional hook call is actually reported, at error severity',
      found.some((message) => message.ruleId === 'react-hooks/rules-of-hooks' && message.severity === 2),
      `react-hooks findings: ${found.map((m) => `${m.ruleId}(${m.severity})`).join(', ') || 'none'}\n` +
        `      A rule that is listed by --print-config and never fires produces identical output ` +
        `to one that works.`,
    );
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------
  // ADR-0026's rule: configured at error in every tree that held the class.
  // ---------------------------------------------------------------------
  const SIDE_EFFECTS = '@typescript-eslint/no-import-type-side-effects';

  /** One file per tree where the 70 occurrences lived. */
  const trees = [
    ['packages/kernel', join(ROOT, 'packages', 'kernel', 'src', 'index.ts')],
    ['packages/contract', join(ROOT, 'packages', 'contract', 'src', 'channels.ts')],
    ['apps/desktop', join(ROOT, 'apps', 'desktop', 'src', 'main.ts')],
  ];

  /** @type {string[]} */
  const notEnforced = [];
  for (const [label, file] of trees) {
    /** @type {Record<string, unknown>} */
    const config = await eslint.calculateConfigForFile(/** @type {string} */ (file));
    const rules = /** @type {Record<string, unknown>} */ (config['rules'] ?? {});
    if (severity(rules[SIDE_EFFECTS]) !== 'error') {
      notEnforced.push(`${label} (${severity(rules[SIDE_EFFECTS])})`);
    }
  }
  check(
    `${SIDE_EFFECTS} is an error in all ${trees.length} trees that held the class`,
    notEnforced.length === 0,
    `not enforced at error in: ${notEnforced.join(', ')}\n      docs/FEATURES.md states this ` +
      `rule closes ADR-0026's import half. apps/desktop held 23 of the 70 occurrences, so a ` +
      `block scoped to packages/** would leave a third of the class unwatched while every ` +
      `other check stayed green.`,
  );

  // The resolution test for it, and the reason this proof was written: with the
  // tree fixed there is no violation left anywhere, so the proof brings its own.
  const sideEffectDirectory = join(ROOT, 'packages', 'kernel', 'src', 'side-effect-probe-temp');
  const offender = join(sideEffectDirectory, 'offender.ts');
  const innocent = join(sideEffectDirectory, 'innocent.ts');
  try {
    mkdirSync(sideEffectDirectory, { recursive: true });
    // The spelling that emits `import {} from '…'`.
    writeFileSync(
      offender,
      "import { type WriterOfRecord } from '../commandDeclarations.js';\n\n" +
        'export type Probe = WriterOfRecord;\n',
      'utf8',
    );
    // The spelling that is erased whole. A rule that reported BOTH would satisfy
    // the case above while saying nothing about which shape it objects to.
    writeFileSync(
      innocent,
      "import type { WriterOfRecord } from '../commandDeclarations.js';\n\n" +
        'export type Probe = WriterOfRecord;\n',
      'utf8',
    );

    const results = await eslint.lintFiles([offender, innocent]);
    /** @param {string} file */
    const findingsIn = (file) =>
      results
        .filter((result) => result.filePath === file)
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === SIDE_EFFECTS);

    check(
      'the inline-type import IS reported, at error severity',
      findingsIn(offender).some((message) => message.severity === 2),
      `findings on the offender: ${
        findingsIn(offender)
          .map((m) => `${m.ruleId}(${m.severity})`)
          .join(', ') || 'none'
      }\n      A rule listed by --print-config and never firing produces identical output to a ` +
        `working one — and with the class already fixed, an identical CLEAN tree as well.`,
    );

    check(
      'and the top-level type import is NOT, so the rule objects to the spelling',
      findingsIn(innocent).length === 0,
      `findings on the innocent file: ${findingsIn(innocent)
        .map((m) => `${m.ruleId}(${m.severity})`)
        .join(', ')}\n      A rule that reported both spellings would pass the case above while ` +
        `distinguishing nothing, which is the fixture the defect also handles correctly.`,
    );
  } finally {
    rmSync(sideEffectDirectory, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\nLint-rule proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        `\n\n`,
    );
    return 1;
  }

  for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
  process.stdout.write(`\n${passed.length} lint-rule cases passed.\n`);
  return 0;
}

main().then(
  (status) => {
    process.exitCode = status;
  },
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  },
);
