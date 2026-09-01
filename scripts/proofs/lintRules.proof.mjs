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
import {
  FLIP_OWNER,
  PLANTED_Y_FLIP_INNOCENT,
  PLANTED_Y_FLIP_OFFENDER,
} from '../lib/noBareYFlip.mjs';
import {
  PATH_OWNER,
  PLANTED_INSTALL_ROOT_OFFENDER,
} from '../lib/noInstallRootWrites.mjs';
import { PLANTED_OFFENDER } from '../lib/noJsxLiterals.mjs';
import { PLANTED_HEX_OFFENDER } from '../lib/noRawHex.mjs';
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

/**
 * A switch over a three-member union that handles two of them.
 *
 * **The `default` clause is the fixture's whole point.** ADR-0029 Decision 4's
 * mechanism is a `default` assigning to `never` in each of the four
 * projections, and `projections.ts`' header asks a reader not to delete them.
 * `considerDefaultExhaustiveForUnions` defaults to false, so this must be
 * reported *with* the default present — which is what makes the rule stronger
 * than the thing it replaces rather than a restatement of it.
 */
const NON_EXHAUSTIVE_SWITCH = [
  "type Surface = 'ribbon' | 'quick-toolbar' | 'context-menu';",
  '',
  'export function where(surface: Surface): number {',
  '  switch (surface) {',
  "    case 'ribbon':",
  '      return 1;',
  "    case 'quick-toolbar':",
  '      return 2;',
  '    default:',
  '      return 0;',
  '  }',
  '}',
].join('\n');

/**
 * The same union with every member handled, which must NOT be reported.
 *
 * Without it the rule could fire on every switch and still pass the case above,
 * and a rule that reports correct code is one somebody disables — which costs
 * the exhaustiveness of all four projections rather than one case.
 */
const EXHAUSTIVE_SWITCH = [
  "type Surface = 'ribbon' | 'quick-toolbar' | 'context-menu';",
  '',
  'export function where(surface: Surface): number {',
  '  switch (surface) {',
  "    case 'ribbon':",
  '      return 1;',
  "    case 'quick-toolbar':",
  '      return 2;',
  "    case 'context-menu':",
  '      return 3;',
  '    default: {',
  '      const unhandled: never = surface;',
  '      return unhandled;',
  '    }',
  '  }',
  '}',
].join('\n');

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

  // ---------------------------------------------------------------------
  // B9's literal-string ban, and the planted offender that makes its silence
  // mean something.
  //
  // This rule is WRITTEN HERE rather than taken from `eslint-plugin-react`,
  // whose 7.37.5 declares no ESLint 10 support — so there is no upstream test
  // suite behind it and every claim about it lives in this file.
  //
  // `zero violations` is what a rule that does not match reports, and also what
  // a clean tree reports. This project already paid for that confusion once:
  // `@typescript-eslint/consistent-type-imports` was enabled against a class it
  // is structurally silent about, reported 0, and read as coverage until a
  // planted offender showed it.
  // ---------------------------------------------------------------------
  const LITERALS = 'monstera/no-jsx-literals';
  const literalDirectory = join(ROOT, 'packages', 'ui', 'src', 'literal-probe-temp');
  try {
    mkdirSync(literalDirectory, { recursive: true });

    const offender = join(literalDirectory, 'offender.tsx');
    writeFileSync(offender, `${PLANTED_OFFENDER}\n`, 'utf8');

    const offences = (await eslint.lintFiles([offender]))
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === LITERALS);

    check(
      'a literal user-facing string in JSX is reported, at error severity',
      offences.some((message) => message.severity === 2),
      `findings on the planted offender: ${
        offences.map((m) => `${m.ruleId}(${m.severity})`).join(', ') || 'none'
      }\n      The rule is written in this repository and has no upstream suite behind it. ` +
        `A visitor keyed on a node name the parser never emits is silent, and silent is what a ` +
        `clean tree looks like.`,
    );

    // The near-misses. A rule that fired on these would fire on correct code,
    // and a check that fires on correct code is one somebody turns off — which
    // is the failure mode B9 cannot survive, because it cannot be retrofitted.
    const innocent = join(literalDirectory, 'innocent.tsx');
    writeFileSync(
      innocent,
      'export function Probe({ label }: { label: string }): unknown {\n' +
        '  return (\n' +
        '    <div>\n' +
        '      <button type="button">{label}</button>\n' +
        '      <span>·</span>\n' +
        '      <em>42</em>\n' +
        '    </div>\n' +
        '  );\n' +
        '}\n',
      'utf8',
    );

    const falsePositives = (await eslint.lintFiles([innocent]))
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === LITERALS);

    check(
      'an expression, a separator glyph and a bare number are NOT reported',
      falsePositives.length === 0,
      `findings on the innocent file: ${falsePositives
        .map((m) => `${m.ruleId}: ${m.message}`)
        .join(' | ')}\n      Nobody translates "·" or "42", and a rule that demands a catalogue ` +
        `key for them is a rule that gets disabled within a day.`,
    );

    // The scope, asserted rather than assumed: a test's JSX is a fixture that
    // reaches no user. If this exclusion silently stopped applying, every
    // component test in the repository would go red at once — loudly, which is
    // why the dangerous direction is the other one: an exclusion that WIDENS
    // takes production code out of the rule with nothing to show for it.
    const inTest = join(literalDirectory, 'fixture.test.tsx');
    writeFileSync(inTest, `${PLANTED_OFFENDER}\n`, 'utf8');
    const testFindings = (await eslint.lintFiles([inTest]))
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === LITERALS);

    check(
      'the same offender in a .test.tsx is not reported, and that scope is deliberate',
      testFindings.length === 0,
      `the rule fired inside a test file. The exclusion is declared in eslint.config.js; if it ` +
        `has stopped applying, every component test goes red for writing literal fixture text.`,
    );

    // -------------------------------------------------------------------
    // §10.2's hex ban, and it needs the planted offender MORE than the rule
    // above does: there is currently no raw hex in any component, so a matcher
    // that matched nothing would report exactly what this clean tree reports.
    // The repository's two hex values are in `windowPolicy.ts` and
    // `canvasHarness.ts`, neither of which is a component.
    // -------------------------------------------------------------------
    const HEX = 'monstera/no-raw-hex';
    const hexOffender = join(literalDirectory, 'swatch.tsx');
    writeFileSync(hexOffender, `${PLANTED_HEX_OFFENDER}\n`, 'utf8');
    const hexFindings = (await eslint.lintFiles([hexOffender]))
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === HEX);

    check(
      'a raw hex colour in a component is reported, at error severity',
      hexFindings.some((message) => message.severity === 2),
      `findings on the planted swatch: ${
        hexFindings.map((m) => `${m.ruleId}(${m.severity})`).join(', ') || 'none'
      }\n      No component in this repository carries a raw hex today, so a rule that matched ` +
        `nothing would report the same zero the clean tree does.`,
    );

    // THE NEAR-MISSES, and the first is the one the rule was held back over:
    // a computed colour. §10.2 exempts a genuinely dynamic value, and the
    // exemption is delivered by shape — a computed colour is not a literal, so
    // there is no node to visit and no allowlist to keep.
    const hexInnocent = join(literalDirectory, 'computed.tsx');
    writeFileSync(
      hexInnocent,
      'declare function onColor(a: string, b: string, c: number): string;\n' +
        'export function Probe({ brand }: { brand: string }): unknown {\n' +
        '  const ink = onColor(brand, brand, 4.5);\n' +
        '  return (\n' +
        '    <div style={{ color: ink }} id="#not-a-colour" data-k="#12345">\n' +
        '      {ink}\n' +
        '    </div>\n' +
        '  );\n' +
        '}\n',
      'utf8',
    );
    const hexFalsePositives = (await eslint.lintFiles([hexInnocent]))
      .flatMap((result) => result.messages)
      .filter((message) => message.ruleId === HEX);

    check(
      'a computed colour and a non-colour # string are NOT reported',
      hexFalsePositives.length === 0,
      `findings on the innocent file: ${hexFalsePositives
        .map((m) => `${m.ruleId}: ${m.message}`)
        .join(' | ')}\n      A rule that fires on onColor() output bans the one producer §10.2 ` +
        `names, and one that fires on "#12345" fires on anchors and ids.`,
    );

    // -------------------------------------------------------------------
    // ADR-0018's install-root rule, and it needs the planted offender MORE
    // than either above: `getAppPath` is named in NO shipped file, so a rule
    // that matched nothing would report exactly the silence this clean tree
    // reports. It replaces an advisory-register verdict withdrawn for want of
    // a witness — and a planted file is the witness a static rule can have and
    // a symbol scan could not.
    // -------------------------------------------------------------------
    const INSTALL = 'monstera/no-install-root-writes';
    // UNDER `apps/desktop/src`, because the config scopes this rule by path and
    // a fixture written anywhere else would test the rule and not its
    // registration.
    const shippedDirectory = join(ROOT, 'apps', 'desktop', 'src', 'install-probe-temp');
    mkdirSync(shippedDirectory, { recursive: true });
    try {
      const offender = join(shippedDirectory, 'where.ts');
      writeFileSync(offender, `${PLANTED_INSTALL_ROOT_OFFENDER}\n`, 'utf8');
      const found = (await eslint.lintFiles([offender]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === INSTALL);

      check(
        'the install root and a stray app.getPath are BOTH reported, at error severity',
        found.filter((message) => message.severity === 2).length === 2,
        `findings on the planted module: ${
          found.map((m) => `${m.ruleId}(${String(m.severity)})`).join(', ') || 'none'
        }\n      TWO, not one: the rule has two branches with opposite scopes — an outright ban ` +
          `on the install root and a confinement of \`app.getPath\` to entry.ts — and a fixture ` +
          `exercising one leaves the other unproven.`,
      );

      // THE CONFINEMENT'S OTHER HALF. Without this the rule passes as an
      // outright ban on `getPath`, which would forbid the one call the
      // architecture requires and be found only by whoever next edits
      // `entry.ts`.
      const owner = join(ROOT, PATH_OWNER);
      const ownerFindings = (await eslint.lintFiles([owner]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === INSTALL);

      check(
        'CONTROL: entry.ts asks Electron where it may write and is NOT reported',
        ownerFindings.length === 0,
        `findings on ${PATH_OWNER}: ${ownerFindings.map((m) => m.message).join(' | ')}\n      ` +
          `That file is the one the architecture requires to make this call, so a rule reporting ` +
          `it is a ban wearing a confinement's name — and it would pass every case above.`,
      );

      // -------------------------------------------------------------------
      // Invariant L3's y-flip rule. `CLAUDE.md` asserted this rule existed
      // before it did, so its first proof matters more than most: a digest
      // naming a mechanism that is not there reads as coverage, and the way
      // that gets discovered is somebody landing an inline flip.
      // -------------------------------------------------------------------
      const FLIP = 'monstera/no-bare-y-flip';
      const flipOffender = join(shippedDirectory, 'place.ts');
      writeFileSync(flipOffender, `${PLANTED_Y_FLIP_OFFENDER}\n`, 'utf8');
      const flipFound = (await eslint.lintFiles([flipOffender]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === FLIP);

      check(
        'both spellings of a bare y-flip are reported, at error severity',
        flipFound.filter((message) => message.severity === 2).length === 2,
        `findings on the planted module: ${
          flipFound.map((m) => `${m.ruleId}(${String(m.severity)})`).join(', ') || 'none'
        }\n      TWO, because the operands take different branches — a bare identifier and a ` +
          `member property — and a fixture exercising one leaves the other unproven.`,
      );

      // THE FALSE-POSITIVE HALF, and it is the one that decides whether this
      // rule survives contact with the codebase. A rule reporting every
      // subtraction would pass the case above and be disabled by the first
      // person who writes `b.y - a.y`, which costs the whole class rather than
      // the case.
      const flipInnocent = join(shippedDirectory, 'spans.ts');
      writeFileSync(flipInnocent, `${PLANTED_Y_FLIP_INNOCENT}\n`, 'utf8');
      const innocentFindings = (await eslint.lintFiles([flipInnocent]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === FLIP);

      check(
        'CONTROL: a same-space delta, a height from two edges and a width are NOT reported',
        innocentFindings.length === 0,
        `findings on the innocent module: ${
          innocentFindings.map((m) => m.message).join(' | ') || 'none'
        }\n      All three are ordinary arithmetic. \`crop.y1 - crop.y0\` is how a height is ` +
          `COMPUTED, which is the opposite of flipping a point, and a rule that cannot tell ` +
          `them apart reports the correct code.`,
      );

      // THE CONFINEMENT'S OTHER HALF, the same shape as entry.ts above.
      // `geometry.ts` writes `viewport.height - point.y` legitimately — to
      // rotate within the viewport's own box, where the height IS the bound —
      // so a rule reporting it is a ban on the one module the architecture
      // requires to do this.
      const flipOwner = join(ROOT, FLIP_OWNER);
      const ownerFlips = (await eslint.lintFiles([flipOwner]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === FLIP);

      check(
        'CONTROL: PageTransform rotates within the viewport box and is NOT reported',
        ownerFlips.length === 0,
        `findings on ${FLIP_OWNER}: ${ownerFlips.map((m) => m.message).join(' | ')}\n      ` +
          `That module holds the only y-flip in the application and rotates within the ` +
          `viewport's own box as well, where a height is genuinely the bound. Reporting it ` +
          `would force a disable comment into the one file that is right.`,
      );

      // -------------------------------------------------------------------
      // ADR-0029 Decision 4's exhaustiveness. The rule is typescript-eslint's,
      // so the fixtures live here rather than beside a matcher of ours — there
      // is no pattern of ours for them to move with.
      //
      // Zero violations is what this tree reports today and also what a rule
      // that never runs reports, and this one is TYPE-AWARE: it needs the
      // project service to resolve the file, which a planted module under a
      // temporary directory is exactly the case most likely to break. So the
      // offender is not a formality here — it is the only thing that says the
      // rule is live in this scope at all.
      // -------------------------------------------------------------------
      const EXHAUSTIVE = '@typescript-eslint/switch-exhaustiveness-check';
      const gappy = join(shippedDirectory, 'gappy-switch.ts');
      writeFileSync(gappy, `${NON_EXHAUSTIVE_SWITCH}\n`, 'utf8');
      const gaps = (await eslint.lintFiles([gappy]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === EXHAUSTIVE);

      check(
        'a switch missing a union member is reported EVEN WITH a default clause',
        gaps.filter((message) => message.severity === 2).length === 1,
        `findings on the planted switch: ${
          gaps.map((m) => m.message).join(' | ') || 'none'
        }\n      The default clause is the point. \`projections.ts\` ends every switch in one, ` +
          `assigning to \`never\`; if a default satisfied the rule, deleting that assignment ` +
          `would leave nothing enforcing Decision 4 — which is the state this replaces, where ` +
          `the only thing stopping the deletion was a comment saying not to.`,
      );

      const complete = join(shippedDirectory, 'complete-switch.ts');
      writeFileSync(complete, `${EXHAUSTIVE_SWITCH}\n`, 'utf8');
      const completeFindings = (await eslint.lintFiles([complete]))
        .flatMap((result) => result.messages)
        .filter((message) => message.ruleId === EXHAUSTIVE);

      check(
        'CONTROL: a switch handling every member is NOT reported',
        completeFindings.length === 0,
        `findings on the complete switch: ${
          completeFindings.map((m) => m.message).join(' | ') || 'none'
        }\n      A rule firing on correct code is one somebody disables, and disabling this one ` +
          `costs the exhaustiveness of all four projections rather than one case.`,
      );
    } finally {
      rmSync(shippedDirectory, { recursive: true, force: true });
    }
  } finally {
    rmSync(literalDirectory, { recursive: true, force: true });
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
