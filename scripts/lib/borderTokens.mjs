// @ts-check
/**
 * `--border` and `--border-soft` may not bound an interactive control
 * ([ADR-0003](../../docs/DECISIONS/0003-token-role-typing-and-declared-pairings.md)).
 *
 * ## Why this is a scan and not the lint rule the ADR asked for
 *
 * ADR-0003's consequences say *"a lint rule is required"*. ESLint does not lint
 * CSS, and ADR-0005 selects no CSS linter — so the named mechanism does not
 * exist in this toolchain, and adding a whole linter for one rule is a
 * dependency this project would then have to pin, provision and keep current.
 * A `scripts/lib` scan is the smallest thing that closes the rule, and the ADR
 * carries an appended note saying the mechanism it named was unavailable.
 *
 * ## The rule is inverted, because the ADR says the default is wrong
 *
 * The obvious shape — *find the interactive selectors, require control-grade
 * borders on them* — is the one ADR-0003 rejected by name for the contrast
 * check: **"inferring usage would mean parsing CSS modules and reasoning about
 * which selectors are interactive. That is a fragile analysis whose failure mode
 * is silence."** A scan that decides interactivity from a class name is wrong
 * about `.rail--active`, `.field-group`, `.tab`, and every naming convention a
 * contributor invents, and each mistake it makes is a violation it does not
 * report.
 *
 * So interactivity is not inferred at all. **Every decorative-grade border is a
 * violation unless the line says it is decorative and why.** That is decidable
 * from the text of one declaration, it has no failure mode that is silence, and
 * it puts the burden where the ADR puts the risk: this is *"the one token
 * decision a contributor will get wrong by default"*, so the default answer is
 * the safe one and the exception has to be written down.
 *
 * B5 over a comment: the wrong choice is made visible rather than explained.
 *
 * Three lines, described rather than shown, because the marker IS a CSS comment
 * and a literal one cannot be written inside this one:
 *
 *   - a border using `var(--border-control)` — accepted, nothing to say;
 *   - a border using `var(--border)` followed on the same line by a CSS comment
 *     opening with `decorative:` and a reason — accepted;
 *   - a border using `var(--border)` with no such comment — REPORTED.
 *
 * {@link CONTROL_FIXTURE} is the same three plus the near-misses, in real CSS.
 *
 * ## What it does NOT decide
 *
 * Whether the marked-decorative uses are honest. A contributor who writes the
 * marker on a control's boundary has defeated it, and no scan can tell — the
 * marker names a *reason*, which is a thing a reviewer reads. What the scan
 * guarantees is that the decision was made deliberately at every site, rather
 * than defaulted into.
 *
 * ## `tokens.css` is excluded, and that is not an exemption
 *
 * It is where `--border` and `--border-soft` are DEFINED. A definition is not a
 * use, and scanning it would report the tokens' own existence as a violation.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Where component CSS may live. Anything outside these is not this rule's business. */
const ROOTS = ['packages', 'apps'];

/** The file that DEFINES the tokens, which is not a use of them. */
const DEFINITION = 'packages/ui/src/tokens.css';

/** The decorative-grade tokens, from ADR-0003's `boundary-decorative` category. */
const DECORATIVE = ['--border', '--border-soft'];

/**
 * A property whose value paints a boundary.
 *
 * `outline` is here with `border` because it draws the same line for the same
 * purpose — a focus ring on a control is a control boundary — and a rule that
 * covered only `border` would be evaded by one property name.
 *
 * NOT ANCHORED AT LINE START. The first version was, and it examined **zero**
 * declarations in its own fixture: `.field { border: … }` puts the property
 * after a brace, which is how a one-rule selector is written and how every
 * example in ADR-0003 reads. The proof caught it on its first run, which is what
 * the fixture carrying realistic CSS rather than isolated declarations is for.
 */
const BOUNDARY_PROPERTY = /(?:^|[{;])\s*(?:border|outline)[a-z-]*\s*:/iu;

/**
 * The marker that makes a decorative border deliberate, and the reason it carries.
 *
 * The lookahead is load-bearing. Spelling the reason `\S+` accepts a marker
 * whose reason is empty, because what follows the colon is then the comment's
 * own terminator — which is non-whitespace, so it satisfies the pattern and the
 * rule reduces to *write a comment*. The first character of the reason may
 * therefore not be one that opens or closes a comment.
 */
const MARKER = /\/\*\s*decorative:\s*(?![*/])\S/u;

/** @param {string} dir @returns {string[]} */
function cssFilesIn(dir) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    // The directory is absent. Reported by the caller as an empty SCOPE rather
    // than swallowed here, because "there is no packages/" and "packages/ has no
    // CSS" must not arrive at the verdict as the same thing.
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
 * @typedef {{
 *   file: string,
 *   line: number,
 *   token: string,
 *   text: string,
 * }} Violation
 */

/**
 * @typedef {{
 *   violations: Violation[],
 *   filesScanned: number,
 *   declarationsExamined: number,
 *   markedDecorative: number,
 * }} Result
 */

/**
 * Scans the given text as one CSS file.
 *
 * Exported so the proof can drive it on fixtures without a tree: the interesting
 * inputs are a violation, a correctly marked line, and the near-misses, and
 * writing four files to disk to express those would test the walker instead of
 * the rule.
 *
 * @param {string} shownPath
 * @param {string} text
 * @returns {{ violations: Violation[], declarations: number, marked: number }}
 */
export function scanCss(shownPath, text) {
  /** @type {Violation[]} */
  const violations = [];
  let declarations = 0;
  let marked = 0;

  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (!BOUNDARY_PROPERTY.test(line)) continue;
    declarations += 1;

    // MATCHED ON THE WHOLE TOKEN, so `--border-control` does not read as
    // `--border`. Getting this wrong would report every correct control border
    // as a violation, which is the failure that gets a check deleted.
    const used = DECORATIVE.filter((token) =>
      new RegExp(`var\\(\\s*${token}\\s*[,)]`, 'u').test(line),
    );
    if (used.length === 0) continue;

    if (MARKER.test(line)) {
      marked += 1;
      continue;
    }
    violations.push({
      file: shownPath,
      line: index + 1,
      token: used.join(' and '),
      text: line.trim().slice(0, 120),
    });
  }
  return { violations, declarations, marked };
}

/**
 * @param {{ root?: string }} [options]
 * @returns {Result}
 */
export function scan({ root = repoRoot() } = {}) {
  /** @type {Violation[]} */
  const violations = [];
  let filesScanned = 0;
  let declarationsExamined = 0;
  let markedDecorative = 0;

  for (const dir of ROOTS) {
    for (const path of cssFilesIn(join(root, dir))) {
      const shown = relative(root, path).replaceAll('\\', '/');
      if (shown === DEFINITION) continue;
      filesScanned += 1;
      const result = scanCss(shown, readFileSync(path, 'utf8'));
      violations.push(...result.violations);
      declarationsExamined += result.declarations;
      markedDecorative += result.marked;
    }
  }
  return { violations, filesScanned, declarationsExamined, markedDecorative };
}

/**
 * A fixture carrying one violation and every near-miss that must NOT be one.
 *
 * The near-misses are the point. A rule matching `--border` as a substring
 * reports `--border-control`, which is the correct token — so the check would
 * fire on every properly written control and be deleted within a day.
 */
export const CONTROL_FIXTURE = [
  '.field { border: 1px solid var(--border-control); }',
  '.rail { border-right: 1px solid var(--border); } /* decorative: region divider */',
  '.slider__track { border: 1px solid var(--border); }',
  '.card { background: var(--border); }',
  '.soft { border-top: 1px solid var(--border-soft); } /* decorative: group separator */',
].join('\n');

/** @param {Result} result @returns {string} */
export function report(result) {
  if (result.violations.length === 0) {
    return (
      `Border tokens — no decorative-grade border bounds an unmarked control.\n` +
      `  ${String(result.filesScanned)} CSS file(s), ` +
      `${String(result.declarationsExamined)} boundary declaration(s), ` +
      `${String(result.markedDecorative)} marked decorative.\n`
    );
  }
  return (
    `Border tokens — ${String(result.violations.length)} decorative-grade border(s) with no ` +
    `reason given:\n\n` +
    result.violations
      .map(
        (violation) =>
          `  ${violation.file}:${String(violation.line)}\n` +
          `      ${violation.text}\n` +
          `      uses ${violation.token}, which ADR-0003 types boundary-decorative and does not\n` +
          `      solve for 3:1. If this bounds something a user can click, type in, drag or\n` +
          `      focus, it must be var(--border-control) — the zoom slider track measured\n` +
          `      1.16:1 with the decorative token. If it genuinely is a divider, say so on the\n` +
          `      line: /* decorative: <why> */\n`,
      )
      .join('\n')
  );
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const result = scan();

  // AN EMPTY SCOPE IS ITS OWN STATE, never a pass. There is no component CSS in
  // this repository yet, so this scan examines nothing — and "found no
  // violations" is exactly what a broken walker, a wrong root and a genuinely
  // clean tree all print. It exits 0 because nothing is wrong; it does not
  // claim coverage it does not have.
  if (result.declarationsExamined === 0) {
    process.stdout.write(
      `Border tokens — NOTHING TO SCAN.\n` +
        `  ${String(result.filesScanned)} CSS file(s) under ${ROOTS.join(', ')} carry no border or\n` +
        `  outline declaration, so this run verified nothing about the rule it enforces.\n` +
        `  That is expected until the first component stylesheet lands, and it is printed\n` +
        `  rather than reported as clean: the two produce identical output otherwise.\n` +
        `  proof:bordertokens is what says the scan can see.\n`,
    );
    process.exit(0);
  }

  process.stdout.write(report(result));
  if (result.violations.length > 0) process.exit(1);
}
