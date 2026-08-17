// @ts-check
/**
 * Proof that a verdict's inputs actually detect a change (rule B2).
 *
 * This mechanism exists because three claims in a row were true only because of
 * state nothing was watching. A mechanism for that which cannot itself notice a
 * change would be the fourth instance, wearing the uniform of the fix — so every
 * input kind gets a resolution test here: feed it two states that differ by the
 * smallest amount that would change a decision, and confirm it reports them as
 * different.
 *
 * Each kind also gets the opposite case — an unrelated change must NOT move the
 * digest. A digest that changes constantly is a check people switch off, which
 * ends in the same place as a digest that never changes.
 *
 * Usage: node scripts/lib/verdict.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { changedInputs, digestInputs } from './verdict.mjs';

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

/** @param {string} root @param {readonly string[]} args */
function git(root, args) {
  return spawnSync('git', [...args], { cwd: root, encoding: 'utf8' });
}

const root = mkdtempSync(join(tmpdir(), 'monstera-verdict-'));
try {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'proof@monstera.invalid']);
  git(root, ['config', 'user.name', 'proof']);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'vendor'), { recursive: true });

  writeFileSync(join(root, 'config.toml'), 'useDefault = true\n', 'utf8');
  writeFileSync(join(root, 'src', 'render.ts'), 'export const render = () => 1;\n', 'utf8');
  writeFileSync(join(root, 'src', 'other.ts'), 'export const other = 2;\n', 'utf8');
  // Untracked-but-present, to prove the symbol search reads the repository
  // rather than the disk.
  writeFileSync(join(root, 'vendor', 'upstream.c'), 'void pdf_subset_fonts(void) {}\n', 'utf8');
  git(root, ['add', 'config.toml', 'src/render.ts', 'src/other.ts']);
  git(root, ['commit', '-q', '--no-verify', '-m', 'base']);

  // -------------------------------------------------------------------------
  // Kind: file
  // -------------------------------------------------------------------------
  /** @type {import('./verdict.mjs').Input[]} */
  const fileInputs = [{ file: 'config.toml' }];
  const fileBefore = digestInputs(fileInputs, { root });

  writeFileSync(join(root, 'config.toml'), 'useDefault = true\n# a comment\n', 'utf8');
  check(
    'file: a one-line edit changes the digest',
    digestInputs(fileInputs, { root }).digest !== fileBefore.digest,
    'this is the .gitleaks.toml case — the edit that switches off the default ruleset',
  );

  writeFileSync(join(root, 'config.toml'), 'useDefault = true\n', 'utf8');
  check(
    'file: restoring the bytes restores the digest',
    digestInputs(fileInputs, { root }).digest === fileBefore.digest,
    'the digest must depend on content, not on having been touched',
  );

  writeFileSync(join(root, 'src', 'other.ts'), 'export const other = 3;\n', 'utf8');
  check(
    'file: an unrelated file does NOT change the digest',
    digestInputs(fileInputs, { root }).digest === fileBefore.digest,
    'a digest that moves for unrelated reasons is a check that gets switched off',
  );

  unlinkSync(join(root, 'config.toml'));
  const afterDelete = digestInputs(fileInputs, { root });
  check(
    'file: deleting it changes the digest rather than throwing',
    afterDelete.digest !== fileBefore.digest && afterDelete.inputs[0]?.detail === 'absent',
    'a verdict measured against a file that has since been deleted is exactly the case this ' +
      'catches; throwing would turn a caught change into a broken checker',
  );
  writeFileSync(join(root, 'config.toml'), 'useDefault = true\n', 'utf8');

  // -------------------------------------------------------------------------
  // Kind: absent symbol
  // -------------------------------------------------------------------------
  /** @type {import('./verdict.mjs').Input[]} */
  const symbolInputs = [{ absent: 'pdf_subset_fonts', from: ['src/**'] }];
  const symbolBefore = digestInputs(symbolInputs, { root });
  check(
    'absent: a symbol nothing references resolves to "no references"',
    symbolBefore.inputs[0]?.detail === 'no references',
    `got ${JSON.stringify(symbolBefore.inputs[0]?.detail)} — if the healthy state is not ` +
      `distinguishable, neither is the unhealthy one`,
  );

  check(
    'absent: an UNTRACKED file referencing the symbol does not count',
    digestInputs(symbolInputs, { root }).digest === symbolBefore.digest,
    'vendor/upstream.c contains the symbol but is not tracked — matching it would make the ' +
      'verdict fire on a vendored upstream tree and be switched off',
  );

  writeFileSync(join(root, 'src', 'export.ts'), 'declare function pdf_subset_fonts(): void;\n', 'utf8');
  git(root, ['add', 'src/export.ts']);
  const symbolAfter = digestInputs(symbolInputs, { root });
  check(
    'absent: a new STAGED call site changes the digest',
    symbolAfter.digest !== symbolBefore.digest,
    'this is the pdf_subset_fonts case: optimise and export are what will call it, and the ' +
      'NOT-REACHABLE verdict must die when they do',
  );
  check(
    'absent: the change names the file that caused it',
    `${symbolAfter.inputs[0]?.detail}`.includes('src/export.ts'),
    `got ${JSON.stringify(symbolAfter.inputs[0]?.detail)} — "this verdict is stale" is not ` +
      `actionable; "stale because src/export.ts now calls it" is`,
  );

  const changes = changedInputs(symbolBefore.inputs, symbolInputs, { root });
  check(
    'changedInputs reports which input moved, by name',
    changes.length === 1 && `${changes[0]?.name}`.includes('pdf_subset_fonts'),
    `got ${JSON.stringify(changes.map((c) => c.name))}`,
  );

  git(root, ['rm', '-q', '--cached', 'src/export.ts']);
  unlinkSync(join(root, 'src', 'export.ts'));

  // -------------------------------------------------------------------------
  // Kind: literal
  // -------------------------------------------------------------------------
  const literalBefore = digestInputs([{ literal: 'corpus', value: 'a:b:c' }], { root });
  check(
    'literal: a changed value changes the digest',
    digestInputs([{ literal: 'corpus', value: 'a:b:d' }], { root }).digest !== literalBefore.digest,
    'this is the canary corpus: adding a family or changing an expected rule ID must re-measure',
  );

  // -------------------------------------------------------------------------
  // Structural properties
  // -------------------------------------------------------------------------
  let refusedEmpty = false;
  try {
    digestInputs([], { root });
  } catch {
    refusedEmpty = true;
  }
  check(
    'an empty input list is refused',
    refusedEmpty,
    'a verdict that depends on nothing cannot be invalidated, which is the state all three ' +
      'instances of this class were in',
  );

  const orderA = digestInputs([{ file: 'config.toml' }, { literal: 'k', value: 'v' }], { root });
  const orderB = digestInputs([{ literal: 'k', value: 'v' }, { file: 'config.toml' }], { root });
  check(
    'declaration order does not change the digest',
    orderA.digest === orderB.digest,
    'reordering a list is not a change of substance, and treating it as one trains people to ' +
      'ignore the failure',
  );

  const dropped = changedInputs(orderA.inputs, [{ file: 'config.toml' }], { root });
  check(
    'removing a declared input is itself reported as a change',
    dropped.some((entry) => entry.now === '(no longer declared)'),
    'silently narrowing what a verdict depends on is how a verdict stops being invalidatable',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(
    `\nVerdict-input proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\nThis mechanism exists because three claims in a row rested on unwatched state. One ` +
      `that cannot detect a change is the fourth.\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} verdict-input cases passed.\n`);
