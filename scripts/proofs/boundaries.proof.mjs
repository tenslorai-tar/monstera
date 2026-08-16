// @ts-check
/**
 * Proof that the C1 module-graph boundaries are actually enforced (rule B2).
 *
 * `eslint .` passing proves nothing about these rules: a boundary config that
 * matches no files, or whose element patterns are wrong, lints perfectly clean
 * while permitting every import it claims to forbid. The only way to know a
 * boundary holds is to violate it on purpose and watch the build go red.
 *
 * Every forbidden case is paired with a permitted control. Without the
 * controls, a rule that rejected all imports — including legal ones — would
 * pass every violation case here and break the build on the first real feature.
 *
 * Each case writes one temporary file into the offending package, lints it, and
 * removes it. Nothing is left behind on success or failure.
 *
 * Usage: node scripts/proofs/boundaries.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ESLINT_BIN = join(REPO_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

/**
 * @typedef {{
 *   name: string,
 *   package: string,
 *   source: string,
 *   expect: 'reject' | 'allow',
 *   rule?: string,
 * }} Case
 * @type {readonly Case[]}
 */
const CASES = [
  {
    name: 'ui may not import the kernel',
    package: 'packages/ui',
    source: `import type { Result } from '@monstera/kernel';\nexport type Probe = Result;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'contract may not import the kernel',
    package: 'packages/contract',
    source: `import type { Result } from '@monstera/kernel';\nexport type Probe = Result;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'shared may not import the contract',
    package: 'packages/shared',
    source: `import type { Result } from '@monstera/contract';\nexport type Probe = Result;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'kernel may not import electron',
    package: 'packages/kernel',
    source: `import { app } from 'electron';\nexport const probe = app;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'kernel may not import react',
    package: 'packages/kernel',
    source: `import { useState } from 'react';\nexport const probe = useState;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'ui may not import electron',
    package: 'packages/ui',
    source: `import { ipcRenderer } from 'electron';\nexport const probe = ipcRenderer;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'ui may not import node:fs',
    package: 'packages/ui',
    source: `import { readFileSync } from 'node:fs';\nexport const probe = readFileSync;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },
  {
    name: 'ui may not import node:child_process',
    package: 'packages/ui',
    source: `import { spawn } from 'node:child_process';\nexport const probe = spawn;\n`,
    expect: 'reject',
    rule: 'no-restricted-imports',
  },

  // Controls. A rule that rejected everything would pass every case above.
  {
    name: 'kernel MAY import shared',
    package: 'packages/kernel',
    source: `import { ok } from '@monstera/shared';\nexport const probe = ok;\n`,
    expect: 'allow',
  },
  {
    name: 'ui MAY import shared',
    package: 'packages/ui',
    source: `import { ok } from '@monstera/shared';\nexport const probe = ok;\n`,
    expect: 'allow',
  },
  {
    name: 'kernel MAY import node:fs',
    package: 'packages/kernel',
    source: `import { readFileSync } from 'node:fs';\nexport const probe = readFileSync;\n`,
    expect: 'allow',
  },
];

/**
 * ESLint's JS entry point is invoked with the current node binary rather than
 * through `npx`. On Windows `npx` is `npx.cmd`, and Node refuses to spawn
 * `.cmd` files without `shell: true` (the fix for CVE-2024-27980, where
 * arguments to a batch file could be interpreted as commands). Reaching for
 * `shell: true` would restore that hazard to work around it; calling the JS
 * entry directly avoids the shell altogether and behaves identically on every
 * platform.
 *
 * @param {string} file
 * @returns {{ output: string, clean: boolean }}
 */
function lint(file) {
  const result = spawnSync(
    process.execPath,
    [ESLINT_BIN, '--no-warn-ignored', '--format', 'json', file],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );

  // A process that never started is not a clean lint and not a dirty one. Left
  // unreported it looks exactly like "eslint found problems", which is how a
  // broken harness reads as a passing boundary.
  if (result.error !== undefined) {
    throw new Error(`Could not run eslint for ${file}`, { cause: result.error });
  }

  return { output: `${result.stdout ?? ''}${result.stderr ?? ''}`, clean: result.status === 0 };
}

/**
 * @param {string} output
 * @returns {string[]} Rule ids reported for the linted file.
 */
function reportedRules(output) {
  const start = output.indexOf('[');
  if (start === -1) return [];
  try {
    /** @type {{messages: {ruleId: string | null}[]}[]} */
    const parsed = JSON.parse(output.slice(start, output.lastIndexOf(']') + 1));
    return parsed.flatMap((file) => file.messages.map((m) => m.ruleId ?? '(fatal)'));
  } catch {
    // A parse failure means eslint did not produce JSON — a crash or a config
    // error. Surfacing the raw output is more useful than an empty rule list.
    return [`(unparseable output: ${output.slice(0, 400)})`];
  }
}

/** @type {string[]} */
const failures = [];

for (const testCase of CASES) {
  const file = join(REPO_ROOT, testCase.package, 'src', '__boundary_probe__.ts');
  try {
    writeFileSync(file, testCase.source);
    const { output, clean } = lint(file);
    const rules = reportedRules(output);

    if (testCase.expect === 'allow') {
      if (clean) {
        process.stdout.write(`  ok  allow   ${testCase.name}\n`);
      } else {
        failures.push(`${testCase.name}: expected this import to be permitted, got: ${rules.join(', ')}`);
      }
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
      process.stdout.write(`  ok  reject  ${testCase.name}\n`);
    }
  } finally {
    rmSync(file, { force: true });
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} boundary proof failure(s):\n\n${failures.join('\n\n')}\n`);
  process.exit(1);
}
process.stdout.write(`\n${CASES.length} boundary cases passed.\n`);
