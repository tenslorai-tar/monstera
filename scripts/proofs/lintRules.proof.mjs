// @ts-check
/**
 * Proof that the React rules two documents claim are enforced actually are
 * (rule B2, audit finding 31).
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
 * Usage: node scripts/proofs/lintRules.proof.mjs
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import reactHooks from 'eslint-plugin-react-hooks';

import { repoRoot } from '../lib/gitScope.mjs';

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
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
