// @ts-check
/**
 * Proof for the dialog-problems scan (`scripts/lib/dialogProblems.mjs`): that it sees, that it refuses, and that it tolerates.
 *
 * It exists so that a new dialog cannot draw a bare validation sentence (the owner, 2026-10-08). The three directions a scan like
 * this fails in are each a case below: it stops matching (the control fixture), it matches too much (a `role="status"` progress
 * line and the shared component itself must pass), and it is pointed at nothing (the real tree must be read and must hold uses).
 *
 * Usage: node scripts/proofs/dialogProblems.proof.mjs
 */

import { CONTROL_FIXTURE, isDialogSource, scan, scanFile } from '../lib/dialogProblems.mjs';
import { createRoster } from '../lib/passRoster.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 11 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const control = scanFile(CONTROL_FIXTURE.path, CONTROL_FIXTURE.text);
check(
  'CONTROL: the shipped bare paragraph is reported as BOTH a refusal class and a hand-written alert',
  control.findings.length === 2 && control.findings.some((f) => f.what === 'class') && control.findings.some((f) => f.what === 'alert'),
  JSON.stringify(control.findings),
);

/** @param {string} body */
const jsx = (body) => `export function B() {\n  return (${body});\n}\n`;

for (const kind of ['problem', 'refused', 'error', 'invalid', 'warning']) {
  const found = scanFile('packages/ui/src/dialogs/XBody.tsx', jsx(`<p className="m-x__${kind}">y</p>`)).findings;
  check(`a class ending __${kind} is reported`, found.length === 1 && found[0]?.what === 'class', JSON.stringify(found));
}

check(
  'a hand-written role="alert" with an ordinary class is reported',
  scanFile('packages/ui/src/dialogs/XBody.tsx', jsx('<p className="m-x__line" role="alert">y</p>')).findings.length === 1,
  'the alert alone is a dialog drawing its own warning',
);

const tolerated = scanFile(
  'packages/ui/src/dialogs/XBody.tsx',
  jsx('<><Problem message={m} /><p className="m-x__status" role="status">Reading…</p></>'),
);
check(
  'TOLERATES the shared component and a role="status" progress line, and counts the use',
  tolerated.findings.length === 0 && tolerated.uses === 1,
  JSON.stringify(tolerated),
);

check(
  'only dialog bodies are read: a test file and a non-tsx file are not sources',
  isDialogSource('XBody.tsx') && !isDialogSource('XBody.test.tsx') && !isDialogSource('x.ts'),
  'the scan must not report on tests that assert the old markup',
);

const real = scan();
check('the real tree is read: dialog sources and uses of the shared component are both non-empty', real.files > 20 && real.uses > 5, `${String(real.files)} sources, ${String(real.uses)} uses`);
check(
  'the real tree has no refusal drawn without the shared component',
  real.findings.length === 0,
  real.findings.map((f) => `${f.file}:${String(f.line)} ${f.what}`).join('\n      '),
);

process.stdout.write(failures.length > 0 ? `${String(failures.length)} dialog-problems failure(s):\n\n  - ${failures.join('\n\n  - ')}\n` : roster.format('dialog-problems case'));
process.exitCode = failures.length === 0 ? 0 : 1;
