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
const roster = createRoster(failures, { cases: 17 });

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

  // ---- 4-5. ADR-0003's two recorded figures, reproduced FROM ITS OWN COLOURS ----
  //
  // THE ADR'S COLOURS, NOT THE SHIPPED FILE'S. These cases check the arithmetic against a figure
  // computed elsewhere, and that is only a check while both sides describe the same inputs. They read
  // the live token file until 2026-09-24, when the owner's v5 palette (72d1ecc) changed the dark
  // surfaces and a correct instrument turned CI red: 3.58 and 1.09 against the ADR's 3.04 and 1.16 —
  // a palette change, not an arithmetic one. ADR-0003 records the pair it solved: `--border-control`
  // `#74787c` and `--border` `#33393e` in its table, on the dark `--surface2` `#2a2f33` it names for
  // the zoom slider. The live palette is case 3's subject, and it is checked there in full.
  const control = channels('#74787c');
  const surface2 = channels('#2a2f33');
  const border = channels('#33393e');
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

  // ---- 10. `graphic` SEPARATES at 3:1 against the surface it declares (ADR-0003, corrected 2026-09-15) ----
  const graphics = evaluate(
    fixture([
      ' * @role page surface',
      ' * @role dark-mark graphic @on page',
      ' * @role pale-mark graphic @on page',
      "[data-theme='probe'] {",
      '  --page: #ffffff;',
      '  --dark-mark: #000000;',
      '  --pale-mark: #dddddd;',
      '}',
    ]),
  );
  check(
    'a `graphic` below 3:1 on its page is reported, and one above it beside it is not',
    graphics.failures.length === 1 && graphics.failures[0]?.includes('--pale-mark') === true,
    `failures: ${graphics.failures.join('; ') || 'none'}. #dddddd on white is about 1.4:1; a check that ` +
      `carried no obligation for the new category would report neither, and one that reported both ` +
      `would separate nothing.`,
  );

  // ---- 11. and it must say where it is drawn ----
  const unplaced = evaluate(
    fixture([' * @role page surface', ' * @role mark graphic', "[data-theme='probe'] {", '  --page: #ffffff;', '  --mark: #000000;', '}']),
  );
  check(
    'a `graphic` that declares no @on surface is reported',
    unplaced.failures.some((failure) => failure.includes('--mark') && failure.includes('no @on')),
    `failures: ${unplaced.failures.join('; ') || 'none'}. A graphic with no declared surface is a pair ` +
      `the check evaluates zero of — the narrowing direction, reported as clean.`,
  );

  // ---- 12-13. The HIGH-CONTRAST floor is 7:1, and it is the theme that decides ----
  //
  // THE PLANTED FAILURE ADR-0003's correction asks for, and it has to be planted: measured
  // 2026-09-16, all twelve declared `text` pairs in the shipped `hc` theme already clear
  // 7:1, so a check that quietly applied 4.5 there would report exactly what a correct one
  // reports. `#6c6c6c` on white is about 5.25:1 — above the ordinary floor and below the
  // enhanced one — so the same colour is a failure in one theme and not in the other, which
  // is what separates a per-theme obligation from a single number.
  const perTheme = evaluate(
    fixture([
      ' * @role bg surface',
      ' * @role ink text @on bg',
      "[data-theme='hc'] {",
      '  --bg: #ffffff;',
      '  --ink: #6c6c6c;',
      '}',
      "[data-theme='light'] {",
      '  --bg: #ffffff;',
      '  --ink: #6c6c6c;',
      '}',
    ]),
  );
  check(
    'a `text` pair between 4.5:1 and 7:1 is reported in the HIGH-CONTRAST theme',
    perTheme.failures.some((failure) => failure.startsWith('hc:') && failure.includes('--ink')),
    `failures: ${perTheme.failures.join('; ') || 'none'}. #6c6c6c on white is about 5.25:1; a ` +
      `check holding every theme to 4.5 would report nothing here, and the shipped hc theme ` +
      `cannot tell the two apart because all twelve of its text pairs already clear 7:1.`,
  );
  check(
    'and the SAME colour on the same surface is not reported in the light theme',
    !perTheme.failures.some((failure) => failure.startsWith('light:')),
    `failures: ${perTheme.failures.join('; ') || 'none'}. The control: a check that had simply ` +
      `raised the floor everywhere would report both, which reddens the build for light and ` +
      `dark text nobody asked to be enhanced (ADR-0003's first rejected alternative).`,
  );

  // ---- 14-15. A FLOATING surface is held over anything (the owner's glass, 2026-09-25; v5's floats, 2026-09-26) ----
  // A pale grey text on a white surface clears 4.5:1 solid; on the same white at half opacity over a black image it
  // cannot. The same file at full opacity is the control: only what the translucency causes is reported.
  const floatAt = (/** @type {string} */ alpha) =>
    evaluate(
      fixture([
        ' * @role float surface @over any',
        ' * @role ink text @on float',
        "[data-theme='light'] {",
        `  --float: rgba(255, 255, 255, ${alpha});`,
        '  --ink: #6c6c6c;',
        '}',
      ]),
    );
  check(
    'text that clears its floor on a SOLID surface is reported on a THIN floating one over black',
    floatAt('0.5').failures.some((failure) => failure.includes('--ink on --float over flat black')),
    `failures: ${floatAt('0.5').failures.join('; ') || 'none'}. #6c6c6c on white is about 5.25:1, and at half ` +
      `opacity over black the surface is mid-grey — the case the solid pairs cannot see.`,
  );
  check(
    'CONTROL: the same file with a SOLID floating surface reports nothing',
    floatAt('1').failures.length === 0,
    `failures: ${floatAt('1').failures.join('; ') || 'none'}. A check that reported every file would satisfy the ` +
      `case above while separating nothing.`,
  );

  // ---- 16-17. A translucent PANEL is held over the lit ground, at the glow's peak (v5, 2026-09-26) ----
  // The same text on the same panel passes over the plain ground and fails under a bright glow. A check that composited
  // over the ground alone — or read the rgba as if it were opaque, which `channels` does with nothing beneath — would
  // pass the lit case too.
  const litAt = (/** @type {string} */ glowAlpha) =>
    evaluate(
      fixture([
        ' * @role base ground',
        ' * @role light glow',
        ' * @role panel surface @over ground',
        ' * @role ink text @on panel',
        "[data-theme='dark'] {",
        '  --base: #000000;',
        `  --light: rgba(255, 255, 255, ${glowAlpha});`,
        '  --panel: rgba(0, 0, 0, 0.5);',
        '  --ink: #767676;',
        '}',
      ]),
    );
  check(
    'a text that holds over the plain ground is reported under a bright glow through a translucent panel',
    litAt('0.6').failures.some((failure) => failure.includes('--ink on --panel over --base under --light')),
    `failures: ${litAt('0.6').failures.join('; ') || 'none'}. #767676 on black is about 4.7:1; a white glow at 0.6 under ` +
      `a half-opaque black panel lifts the panel to mid-grey, where it cannot hold.`,
  );
  check(
    'CONTROL: the same panel with no glow reports nothing, and a translucent surface with no @over is refused',
    litAt('0').failures.length === 0 &&
      evaluate(
        fixture([' * @role panel surface', "[data-theme='dark'] {", '  --panel: rgba(0, 0, 0, 0.5);', '}']),
      ).failures.some((failure) => failure.includes('--panel is translucent and declares no @over')),
    `failures: ${litAt('0').failures.join('; ') || 'none'}. Without the glow the pair clears; and a translucent surface ` +
      `that names nothing beneath it is a colour this check cannot know, which it must say rather than read as opaque.`,
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
