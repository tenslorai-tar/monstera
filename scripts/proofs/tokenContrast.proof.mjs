// @ts-check
/**
 * Proves the token contrast check can SEE, can REFUSE, and SEPARATES.
 *
 * `tokenContrast.mjs` is what makes ARCHITECTURE §10.2's *"contrast is enforced,
 * not audited"* true. Its reassuring answer is "no failures", which is also what
 * a wrong role pattern, an unreadable token file, an empty theme list and a
 * silently narrowed declaration set all report — so the interesting cases are
 * the ones where it must say something other than fine.
 *
 * ## The arithmetic is checked against a figure this project did not compute here
 *
 * ADR-0003 records two numbers from its own solve: the split `--border-control`
 * clears 3:1 with a worst case of **3.04:1** in dark, and the rejected
 * alternative — one border token — leaves the zoom slider at **1.16:1**. Both
 * are reproduced below from the shipped token file. An instrument that agrees
 * with an independently recorded measurement to two decimal places is doing the
 * arithmetic the ADR did; one that merely returns numbers is not.
 *
 * Usage: node scripts/proofs/tokenContrast.proof.mjs
 */

import { readFileSync } from 'node:fs';

import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { channels, contrast, evaluate, rolesIn, scan, themesIn, tokenFile } from '../lib/tokenContrast.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {string[]} lines */
const fixture = (lines) => lines.join('\n');

try {
  const css = readFileSync(tokenFile(repoRoot()), 'utf8');

  // ---- 1-2. It reads both declaration sites ----
  const roles = rolesIn(css);
  const themes = themesIn(css);
  check(
    'the shipped token file declares roles, and none of them is the grammar example',
    roles.length > 0 && roles.every((role) => /^[a-z][a-z0-9-]*$/u.test(role.name)),
    `roles: ${roles.map((role) => role.name).join(', ') || 'none'}. A role named \`<category>\` ` +
      `means the header's grammar illustration is being parsed as a declaration — which it was, ` +
      `on this check's first run.`,
  );
  check(
    'and three themes, because a token file with one theme checks one third of what renders',
    themes.length === 3,
    `themes: ${themes.map((theme) => theme.theme).join(', ') || 'none'}`,
  );

  // ---- 3. The shipped file passes ----
  const live = scan();
  check(
    'the shipped token file has no contrast or completeness failure',
    live.blind === null && live.failures.length === 0,
    `blind=${String(live.blind)}\n      ${live.failures.join('\n      ')}`,
  );

  // ---- 4-5. ADR-0003's two recorded figures, reproduced ----
  const dark = themes.find((theme) => theme.theme === 'dark');
  const control = channels(dark?.values.get('border-control') ?? '');
  const surface2 = channels(dark?.values.get('surface2') ?? '');
  const border = channels(dark?.values.get('border') ?? '');
  check(
    "ADR-0003's solved --border-control clears 3:1 on dark --surface2 at 3.04:1",
    control !== null && surface2 !== null && contrast(control, surface2).toFixed(2) === '3.04',
    `got ${control !== null && surface2 !== null ? contrast(control, surface2).toFixed(2) : 'nothing'}. ` +
      `ADR-0003 records 3.04:1 as the dark worst case; a different figure means this check and ` +
      `that solve are not computing the same thing.`,
  );
  check(
    "and the alternative ADR-0003 rejected leaves that pair at 1.16:1",
    border !== null && surface2 !== null && contrast(border, surface2).toFixed(2) === '1.16',
    `got ${border !== null && surface2 !== null ? contrast(border, surface2).toFixed(2) : 'nothing'}. ` +
      `ADR-0003 cites 1.16:1 as the zoom slider's ratio under one border token.`,
  );

  // ---- 6. It SEPARATES: a failing pair is reported, a passing one is not ----
  const mixed = evaluate(
    fixture([
      ' * @role bg surface',
      ' * @role good text @on bg',
      ' * @role bad text @on bg',
      "[data-theme='probe'] {",
      '  --bg: #ffffff;',
      '  --good: #000000;',
      '  --bad: #eeeeee;',
      '}',
    ]),
  );
  check(
    'a failing pair is reported and a passing one beside it is not',
    mixed.failures.length === 1 && mixed.failures[0]?.includes('--bad') === true,
    `failures: ${mixed.failures.join('; ') || 'none'}. A check that reported both would satisfy ` +
      `"it can see" while distinguishing nothing.`,
  );

  // ---- 7-8. Completeness, in BOTH directions ----
  const orphanValue = evaluate(
    fixture([
      ' * @role bg surface',
      "[data-theme='probe'] {",
      '  --bg: #ffffff;',
      '  --mystery: #123456;',
      '}',
    ]),
  );
  check(
    'a value with no @role declaration is reported',
    orphanValue.failures.some((failure) => failure.includes('--mystery')),
    `failures: ${orphanValue.failures.join('; ') || 'none'}. This is the direction that NARROWS ` +
      `the check — an undeclared colour is one it cannot see, and its silence reads exactly like ` +
      `a clean run (audit item 4c).`,
  );
  const orphanRole = evaluate(
    fixture([
      ' * @role bg surface',
      ' * @role ghost text @on bg',
      "[data-theme='probe'] {",
      '  --bg: #ffffff;',
      '}',
    ]),
  );
  check(
    'a declared role with no value in a theme is reported',
    orphanRole.failures.some((failure) => failure.includes('--ghost')),
    `failures: ${orphanRole.failures.join('; ') || 'none'}. A role with no value is a pair the ` +
      `check evaluates zero of, which raises the pass count by nothing and lowers it by nothing.`,
  );

  // ---- 9. It REFUSES when it cannot read ----
  const empty = evaluate('/* nothing here */');
  check(
    'a file with no role declarations REFUSES rather than reporting no failures',
    empty.blind !== null && empty.failures.length === 0,
    `blind=${String(empty.blind)}. "No roles" and "no failures" produce the same empty failure ` +
      `list, and only one of them is an answer.`,
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nToken-contrast proof — ${failures.length} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('token-contrast case')}\n`);
  }
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}
