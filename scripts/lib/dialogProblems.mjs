// @ts-check
/**
 * A dialog says that something is wrong, or must be done first, in ONE way: `primitives/Problem.tsx`.
 *
 * ## The rule, and why it is a scan
 *
 * The owner's order of 2026-10-08, after a video of Protect › Sign with certificate: pressing *Choose certificate* with no
 * signature drawn showed "Type or draw the signature first" in the form's own colour and size, so it read as part of the form
 * and not as a warning. Twenty-six dialogs had each written their own paragraph for it. They are now one component with a
 * warning icon, the problem colour, `role="alert"`, and the field it is about outlined, `aria-invalid`, described by it and
 * focused when the sentence answers a press.
 *
 * A component does not stop the twenty-seventh dialog from writing its own paragraph, and that is how the twenty-six
 * happened. So this scan reads every dialog body and refuses, in two forms:
 *
 * - **a class that names a refusal** — `__problem`, `__refused`, `__error`, `__invalid`, `__warning` — because that class is
 *   the bare paragraph's own name, and the look of it is exactly what the owner objected to; and
 * - **`role="alert"` written in a dialog** — the primitive owns it, so a dialog that writes one has drawn its own.
 *
 * `role="status"` is NOT refused: a progress line and an outcome ("Reading…", "3 pages deleted") are status, not refusal.
 *
 * There is no allow-list and no escape hatch. A sentence that is a refusal is `Problem`; one that is not takes a name that
 * says what it is.
 *
 * ## It is a search, so it must find something known-present on every run
 *
 * *Found nothing* is what a wrong pattern, an empty file list and a clean tree all print (audit item 4b). {@link CONTROL_FIXTURE}
 * is a bare paragraph that MUST be reported on every run, and the runner also refuses when it reads no dialog bodies or finds
 * no use of `Problem` at all.
 *
 * Usage: node scripts/lib/dialogProblems.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';
import { isMain } from './isMain.mjs';

/** The directory every dialog body lives in, repository-relative. */
export const DIALOGS_DIRECTORY = 'packages/ui/src/dialogs';

/** A class named for what a refusal is: the bare paragraph's own name. */
const REFUSAL_CLASS = /className\s*=\s*(?:"[^"]*__(?:problem|refused|error|invalid|warning)\b[^"]*"|\{[^}]*__(?:problem|refused|error|invalid|warning)\b[^}]*\})/gu;

/** An alert written by hand. */
const HAND_WRITTEN_ALERT = /\brole\s*=\s*"alert"/gu;

/** Where the shared component is used, counted so a runner that read none of it refuses. */
const PROBLEM_USE = /<Problem\b/gu;

/**
 * @typedef {{ file: string, line: number, what: 'class' | 'alert', text: string }} Finding
 */

/**
 * One dialog source's findings.
 *
 * @param {string} shownPath repository-relative, forward slashes
 * @param {string} text
 * @returns {{ findings: Finding[], uses: number }}
 */
export function scanFile(shownPath, text) {
  /** @type {Finding[]} */
  const findings = [];
  const lineAt = (/** @type {number | undefined} */ index) => text.slice(0, index ?? 0).split('\n').length;
  for (const match of text.matchAll(REFUSAL_CLASS)) {
    findings.push({ file: shownPath, line: lineAt(match.index), what: 'class', text: match[0].slice(0, 90) });
  }
  for (const match of text.matchAll(HAND_WRITTEN_ALERT)) {
    findings.push({ file: shownPath, line: lineAt(match.index), what: 'alert', text: match[0] });
  }
  return { findings, uses: [...text.matchAll(PROBLEM_USE)].length };
}

/**
 * A bare paragraph that MUST be reported, run through {@link scanFile} on every run. A string and not a tracked file, so
 * tidying cannot delete it; checked on every run and not only in the proof, because the proof runs in CI and this gets run by
 * hand on the day someone needs an answer.
 */
export const CONTROL_FIXTURE = {
  path: `${DIALOGS_DIRECTORY}/ControlBody.tsx`,
  text: ['export function ControlBody() {', '  return <p className="m-control__problem" role="alert">x</p>;', '}'].join('\n'),
};

/** Dialog bodies and their helpers: `.tsx` files directly in the dialogs directory, tests excluded. */
export function isDialogSource(/** @type {string} */ name) {
  return name.endsWith('.tsx') && !name.endsWith('.test.tsx');
}

/**
 * @param {{ root?: string }} [options]
 * @returns {{ findings: Finding[], files: number, uses: number }}
 */
export function scan({ root = repoRoot() } = {}) {
  const directory = join(root, DIALOGS_DIRECTORY);
  /** @type {Finding[]} */
  const findings = [];
  let files = 0;
  let uses = 0;
  for (const name of readdirSync(directory)) {
    if (!isDialogSource(name)) continue;
    files += 1;
    const shown = relative(root, join(directory, name)).replaceAll('\\', '/');
    const result = scanFile(shown, readFileSync(join(directory, name), 'utf8'));
    findings.push(...result.findings);
    uses += result.uses;
  }
  return { findings, files, uses };
}

/** @param {{ findings: Finding[], files: number, uses: number }} result */
export function report(result) {
  if (result.findings.length === 0) {
    return (
      `Dialog problems — every refusal in a dialog is the shared Problem.\n` +
      `  ${String(result.files)} dialog source(s) read, ${String(result.uses)} use(s) of <Problem>.\n`
    );
  }
  return (
    `Dialog problems — ${String(result.findings.length)} refusal(s) drawn without the shared component:\n\n` +
    result.findings
      .map(
        (found) =>
          `  ${found.file}:${String(found.line)}\n` +
          `      ${found.what === 'class' ? 'a class that names a refusal' : 'a hand-written role="alert"'}: ${found.text}\n`,
      )
      .join('\n') +
    `\n  Use <Problem> from primitives/Problem.tsx (or DialogRow's \`problem\`). It draws the warning icon in the problem colour,\n` +
    `  announces it, and outlines, describes and focuses the field it is about. A sentence that is not a refusal takes a name\n` +
    `  that says what it is.\n`
  );
}

/** @returns {number} the exit code */
export function run() {
  const control = scanFile(CONTROL_FIXTURE.path, CONTROL_FIXTURE.text);
  if (control.findings.length !== 2) {
    process.stderr.write(
      `Dialog problems — the scan is BLIND: its control fixture should be reported twice (a refusal class and a hand-written ` +
        `alert) and was reported ${String(control.findings.length)} time(s). Nothing it says about the tree means anything.\n`,
    );
    return 2;
  }
  const result = scan();
  if (result.files === 0 || result.uses === 0) {
    process.stderr.write(
      `Dialog problems — the scan read ${String(result.files)} dialog source(s) and ${String(result.uses)} use(s) of <Problem>. ` +
        `Dialogs use it, so either the directory moved or the pattern is blind.\n`,
    );
    return 2;
  }
  process.stdout.write(report(result));
  return result.findings.length === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = run();
