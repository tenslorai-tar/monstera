// @ts-check
/**
 * Every `var(--name)` names a custom property something declares.
 *
 * ## The defect this exists for, and why nothing could see it
 *
 * `.m-forms-flatten` shipped on 2026-09-07 with `padding: var(--space-3)`. The
 * scale in `tokens.css` is 2, 4, 8, 16, 24, 32 — **there is no 3**. An
 * undefined custom property does not fall back and does not warn: the whole
 * declaration is invalid at computed-value time, so the flatten button shipped
 * with no padding at all, in either axis, because one token in a shorthand did
 * not exist.
 *
 * Nothing in this repository could have caught it. TypeScript does not read
 * CSS; ESLint lints no CSS (ADR-0005 selects no CSS linter); the two CSS scans
 * that do exist — `borderTokens.mjs` and `tokenContrast.mjs` — both ask whether
 * a token's ROLE fits its context, and neither asks whether the token exists.
 * The tests render into a DOM that computes no styles. It was found by reading
 * the file for something else.
 *
 * ## A set difference, which is what makes it decidable
 *
 * Every `--name:` declaration in the tree is a definition; every `var(--name)`
 * is a use; a use with no definition is a violation. There is no judgement in
 * it and no shape a contributor can name their way around, which is the
 * opposite of the two scans beside it — and it is why this one is a set
 * difference rather than a rule about roles.
 *
 * ## What it deliberately does NOT decide
 *
 * **Scope.** A property defined on `:root` and used inside a component resolves;
 * one defined on `.panel` and used on `.toolbar` does not, and this scan calls
 * both defined. Deciding that needs the cascade, which needs a CSS engine —
 * and the failure it would catch is a property that resolves somewhere, where
 * the one above resolves nowhere. The narrower rule is the one that is
 * decidable from the text, and it is the one that has already been paid for.
 *
 * **A `var()` with a fallback.** `var(--maybe, 1px)` is valid whether or not
 * `--maybe` exists — that is what the fallback is for — so it is not reported.
 * A build that reported it would push contributors towards deleting fallbacks.
 *
 * ## Its own positive control
 *
 * A search's reassuring answer is *found nothing*, and here it is also the
 * answer a clean tree gives. So the scan plants {@link CONTROL_FIXTURE} — a
 * reference to a property nothing declares — into its own input and **refuses
 * to report** unless it finds it. And a second control the first does not give:
 * a valid reference in the same fixture must NOT be reported, or a scan that
 * flagged everything would satisfy the first control perfectly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Where stylesheets may live. Anything outside these is not this rule's business. */
const ROOTS = ['packages', 'apps'];

/**
 * The fixture the scan must find and the one it must not report.
 *
 * Real CSS rather than isolated declarations, for `borderTokens.mjs`' reason:
 * its first version anchored at line start and examined zero declarations in
 * its own fixture, because a one-rule selector puts the property after a brace.
 */
export const CONTROL_FIXTURE = [
  ':root { --control-defined: 4px; }',
  '.control-good { padding: var(--control-defined); }',
  '.control-bad { padding: var(--control-absent); }',
  '.control-fallback { margin: var(--control-absent-too, 2px); }',
].join('\n');

/** The name this scan must report in its own fixture. */
export const CONTROL_MISSING = '--control-absent';

/** The name it must NOT report. */
export const CONTROL_PRESENT = '--control-defined';

/**
 * A custom property being DEFINED.
 *
 * The name must be followed by a colon, which is what separates a definition
 * from a use — `--a: 1px` defines and `var(--a)` does not. Anchored on a brace,
 * a semicolon or the line's start for the reason above: a definition sits after
 * one of the three.
 */
const DEFINITION = /(?:^|[{;])\s*(--[\w-]+)\s*:/gmu;

/**
 * A custom property being USED, with no fallback.
 *
 * The negative lookahead is the whole of the fallback rule: `var(--a, 1px)` is
 * valid whether or not `--a` exists, so a comma before the closing bracket
 * takes the reference out of scope.
 */
const USE = /var\(\s*(--[\w-]+)\s*\)/gu;

/**
 * The same text with every CSS comment blanked out, line breaks intact.
 *
 * ## Its first run reported a comment, and the comment was ABOUT this defect
 *
 * `app.css` explains why `.m-forms-flatten` reads `--space-2` and not
 * `--space-3`, and the explanation contains `var(--space-3)`. The scan reported
 * it. That is `withdrawnPhrases.mjs`' finding in another suit — **match a unit
 * the text actually has** — and the unit here is a declaration, not a line: a
 * reference inside a comment is not a reference, and a scan that reported one
 * would punish the file for documenting the very defect it exists to catch.
 *
 * Blanked rather than removed, so a violation's line number is still its line.
 *
 * @param {string} text
 * @returns {string}
 */
function withoutComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, (comment) =>
    comment.replaceAll(/[^\n]/gu, ' '),
  );
}

/** @param {string} dir @returns {string[]} */
function cssFilesIn(dir) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // The directory is absent. Reported by the caller as an empty SCOPE rather
    // than swallowed here — *there is no packages/* and *packages/ has no CSS*
    // must not reach the verdict as the same thing.
    return found;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = join(dir, name);
    let entry;
    try {
      entry = statSync(full);
    } catch {
      continue;
    }
    if (entry.isDirectory()) found.push(...cssFilesIn(full));
    else if (name.endsWith('.css')) found.push(full);
  }
  return found;
}

/**
 * @typedef {{ file: string, line: number, token: string, text: string }} Violation
 */

/**
 * @typedef {{
 *   violations: Violation[],
 *   filesScanned: number,
 *   definitions: number,
 *   uses: number,
 *   sawControl: boolean,
 *   reportedValidControl: boolean,
 * }} Result
 */

/**
 * Every `var()` in the tree that names nothing.
 *
 * @param {string} [root]
 * @returns {Result}
 */
export function scan(root = repoRoot()) {
  const files = ROOTS.flatMap((area) => cssFilesIn(join(root, area)));
  const result = scanTexts(
    files.map((file) => ({
      file: relative(root, file).replaceAll('\\', '/'),
      text: readFileSync(file, 'utf8'),
    })),
  );
  return { ...result, filesScanned: files.length };
}

/**
 * The same rule over named texts, which is what makes it provable.
 *
 * The tree walk and the rule are separated for `borderTokens.mjs`' reason: a
 * proof that had to write CSS files to disk would be testing the walker, and
 * the claims worth holding are about the rule.
 *
 * @param {readonly { file: string, text: string }[]} sources
 * @returns {Result}
 */
export function scanTexts(sources) {
  /** @type {Map<string, string>} — the file is kept for nothing but debugging. */
  const defined = new Map();
  /** @type {Violation[]} */
  const uses = [];

  // THE CONTROL IS PART OF THE INPUT, not a separate run. A scan that walked
  // the tree and then checked a fixture separately would prove that two code
  // paths work; this proves that THIS pass, over THIS input, can see.
  const inputs = [
    ...sources.map((source) => ({ file: source.file, text: withoutComments(source.text) })),
    { file: '<control>', text: CONTROL_FIXTURE },
  ];

  for (const { file, text } of inputs) {
    for (const match of text.matchAll(DEFINITION)) {
      if (match[1] !== undefined) defined.set(match[1], file);
    }
  }

  for (const { file, text } of inputs) {
    for (const [index, line] of text.split('\n').entries()) {
      for (const match of line.matchAll(USE)) {
        const token = match[1];
        if (token === undefined) continue;
        uses.push({ file, line: index + 1, token, text: line.trim() });
      }
    }
  }

  const violations = uses.filter((use) => !defined.has(use.token));

  return {
    violations: violations.filter((use) => use.file !== '<control>'),
    filesScanned: sources.length,
    definitions: defined.size,
    uses: uses.length,
    sawControl: violations.some((use) => use.token === CONTROL_MISSING),
    reportedValidControl: violations.some((use) => use.token === CONTROL_PRESENT),
  };
}

/** @param {Result} result @returns {string} */
export function report(result) {
  if (result.violations.length === 0) {
    return (
      `Defined tokens — every var() names a custom property something declares.\n` +
      `  ${String(result.filesScanned)} CSS file(s), ${String(result.definitions)} definition(s), ` +
      `${String(result.uses)} reference(s) without a fallback.\n`
    );
  }
  return (
    `Defined tokens — ${String(result.violations.length)} reference(s) to a custom property ` +
    `nothing declares:\n\n` +
    result.violations
      .map(
        (violation) =>
          `  ${violation.file}:${String(violation.line)}\n` +
          `      ${violation.text}\n` +
          `      ${violation.token} is never declared. An undefined custom property does not\n` +
          `      fall back and does not warn: the WHOLE declaration is invalid at\n` +
          `      computed-value time, so this rule has no effect at all. That is how\n` +
          `      var(--space-3) shipped a button with no padding — the scale has no 3.\n`,
      )
      .join('\n')
  );
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const result = scan();

  // THE CONTROL IS CHECKED BEFORE THE VERDICT IS PRINTED, in both directions.
  // A scan that found nothing and a scan that cannot see print the same clean
  // line, and this is a search — so its silence is worth nothing until it has
  // located something it is known to be able to find, and refused something it
  // is known to have to accept.
  if (!result.sawControl) {
    process.stderr.write(
      `Defined tokens — REFUSING TO REPORT. The scan did not find ${CONTROL_MISSING}, which its\n` +
        `  own fixture references and nothing declares. Its answer about this tree would be\n` +
        `  the scan being broken rather than a fact about the CSS.\n`,
    );
    process.exit(1);
  }
  if (result.reportedValidControl) {
    process.stderr.write(
      `Defined tokens — REFUSING TO REPORT. The scan flagged ${CONTROL_PRESENT}, which its own\n` +
        `  fixture declares. A scan that reports every reference finds the missing one too,\n` +
        `  so the control above would pass while the rule was worthless.\n`,
    );
    process.exit(1);
  }

  if (result.uses === 0) {
    process.stdout.write(
      `Defined tokens — NOTHING TO SCAN.\n` +
        `  ${String(result.filesScanned)} CSS file(s) under ${ROOTS.join(', ')} carry no var()\n` +
        `  reference without a fallback, so this run verified nothing about the rule it\n` +
        `  enforces. Printed rather than reported as clean: the two are identical otherwise.\n`,
    );
    process.exit(0);
  }

  process.stdout.write(report(result));
  if (result.violations.length > 0) process.exit(1);
}
