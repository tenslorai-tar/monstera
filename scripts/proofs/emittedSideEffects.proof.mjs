// @ts-check
/**
 * Proves the emitted-side-effect scan can SEE, can REFUSE, and SEPARATES.
 *
 * `emittedSideEffects.mjs` closes the half of ADR-0026's class that no lint rule
 * covers: `export { type X } from './y.js'` emits `export {} from './y.js'`, a
 * runtime load, and neither `no-import-type-side-effects` (which registers
 * `ImportDeclaration` only) nor `consistent-type-exports` (whose report is gated
 * on a list an inline `type` specifier never reaches) reports it — finding
 * MMMM-1, read from the pinned plugin and then executed.
 *
 * A scan whose reassuring answer is "found nothing" needs three properties, and
 * two of them are usually left out:
 *
 *   1. it finds a violation it is known to be able to find;
 *   2. it REFUSES when blinded, rather than reporting a clean result;
 *   3. it does not flag everything — a matcher that reports every line satisfies
 *      (1) perfectly, which is why the near-misses are the load-bearing cases.
 *
 * Usage: node scripts/proofs/emittedSideEffects.proof.mjs
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CONTROL_FIXTURE,
  CONTROL_LINES,
  scan,
  violationsIn,
} from '../lib/emittedSideEffects.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * A throwaway tree with one `dist` holding the given files.
 *
 * @param {Record<string, string>} files
 * @returns {string} root
 */
function treeWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'monstera-sideeffects-'));
  const dist = join(root, 'packages', 'probe', 'dist');
  mkdirSync(dist, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dist, name), content, 'utf8');
  }
  return root;
}

try {
  // ---- 1-3. It can see, and it sees the right lines ----
  const control = violationsIn(CONTROL_FIXTURE);
  check(
    'the control fixture yields exactly two violations',
    control.length === 2,
    `got ${control.length}. The fixture carries two offending statements and three near-misses; ` +
      `any other count means the matcher is reading something else.`,
  );
  check(
    'and they are on the lines the module declares',
    control.map((violation) => violation.line).join(',') === CONTROL_LINES.join(','),
    `got lines ${control.map((violation) => violation.line).join(',') || 'none'}, expected ` +
      `${CONTROL_LINES.join(',')}.`,
  );
  check(
    'one is an import and one is an export, so neither half is silently uncovered',
    control.some((violation) => violation.kind === 'import') &&
      control.some((violation) => violation.kind === 'export'),
    `kinds found: ${control.map((violation) => violation.kind).join(',') || 'none'}. The export ` +
      `half is the one no lint rule covers, so a scan that saw only imports would duplicate the ` +
      `rule and close nothing.`,
  );

  // ---- 4-5. It SEPARATES: the near-misses are not reported ----
  check(
    'a bare `export {};` module marker is NOT reported',
    violationsIn('export {};').length === 0,
    `reported. That is what tsc emits for a file whose exports are all types — engineSeam.js is ` +
      `exactly this — and it loads nothing, so flagging it would make every types-only module a ` +
      `defect.`,
  );
  check(
    'ordinary statements that keep their bindings are NOT reported',
    violationsIn(
      ["import { readFileSync } from 'node:fs';", "export { thing } from './real.js';"].join('\n'),
    ).length === 0,
    `reported. A matcher that flags every line passes the "it can see" cases above just as ` +
      `happily, which is why this case is the one that makes them mean anything.`,
  );

  // ---- 6. A real tree with a real violation ----
  const dirty = treeWith({
    'clean.js': "import { a } from './a.js';\nexport {};\n",
    'dirty.js': "import { b } from './b.js';\nexport {} from './seam.js';\n",
  });
  try {
    const found = scan({ root: dirty });
    check(
      'a violation in a built tree is found, with its file and line',
      found.blind === null &&
        found.violations.length === 1 &&
        found.violations[0]?.line === 2 &&
        found.violations[0]?.file.endsWith('dirty.js'),
      `blind=${String(found.blind)} violations=${JSON.stringify(found.violations)}`,
    );
  } finally {
    rmSync(dirty, { recursive: true, force: true });
  }

  // ---- 7. A clean tree is clean, and says how much it looked at ----
  const clean = treeWith({ 'clean.js': "import { a } from './a.js';\nexport {};\n" });
  try {
    const found = scan({ root: clean });
    check(
      'a clean built tree reports no violations and a non-zero file count',
      found.blind === null && found.violations.length === 0 && found.scanned === 1,
      `blind=${String(found.blind)} violations=${found.violations.length} scanned=${found.scanned}`,
    );
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }

  // ---- 8. It REFUSES rather than reporting clean, when there is nothing to read ----
  const empty = mkdtempSync(join(tmpdir(), 'monstera-sideeffects-empty-'));
  try {
    const found = scan({ root: empty });
    check(
      'a tree with no build REFUSES rather than reporting no violations',
      found.blind !== null && found.violations.length === 0,
      `blind=${String(found.blind)}. "No build" and "a clean build" produce the same empty ` +
        `violation list, and only one of them is an answer. This is the case that separates ` +
        `them, and without it the scan reads as green on a machine that never ran tsc.`,
    );
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\nEmitted-side-effect proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('emitted-side-effect case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
