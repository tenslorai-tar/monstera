// @ts-check
/**
 * The per-process memory budgets, read from the invariant that states them.
 *
 * `docs/ARCHITECTURE.md` §9.17 carries one machine-read line and it is the only
 * place that section states these numbers. The performance assertion parses it
 * rather than defining constants, so the value a human reads and the value the
 * build enforces are the same string. See
 * [ADR-0012](../../docs/DECISIONS/0012-memory-budgets-are-machine-read-from-the-invariant.md).
 *
 * ## Why not a constant, and why not a wider scan
 *
 * The withdrawn-phrase check reads tracked `.md` files and fails the build when
 * one states a number an ADR retracted. It cannot see code. Widening it to
 * `.ts` and `.mjs` was the obvious alternative and it would match almost
 * nothing: the declared phrases are prose (`~650 MB`, `admission gate`), and a
 * constant reads `650 * 1024 * 1024` and `admissionGate`. That is a check whose
 * file list claims code coverage, which passes because it finds nothing, and
 * which is trusted because it is green — the shape Batch 6 closed four
 * instances of.
 *
 * ## No defaults, anywhere in this path
 *
 * Every failure throws. There is no fallback limit, no "assume the documented
 * value", no skipping a budget that failed to parse. A fallback is how a
 * withdrawn number comes back, and it comes back silently: a limit that was
 * substituted rather than read is indistinguishable from a measured one at
 * exactly the moment it decides whether the build passes.
 *
 * `provisional` is a parsed state, not a missing one. The renderer's budget is
 * declared and deliberately not assertable, and asking for its limit throws with
 * that reason — so an assertion cannot quietly cover two processes out of three
 * and report success.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './gitScope.mjs';

/** Repo-relative path of the invariant that states the budgets. */
export const SOURCE_FILE = 'docs/ARCHITECTURE.md';

/**
 * The budgets that must be declared. Fixed, not discovered: a line that stopped
 * declaring `mupdf-host` would otherwise parse cleanly and silently stop
 * budgeting the process that holds the parser.
 */
export const REQUIRED_BUDGETS = ['main', 'mupdf-host', 'renderer'];

// Leading whitespace is allowed because §9.17 is item 17 of a numbered list, so
// its blockquote is indented to stay inside the item. Anchoring hard at column
// zero made the parser report "no line found" for a line that was present and
// correct — which is the right failure to get from a fail-loud parser, and the
// wrong reason to get it.
const DECLARATION = /^\s*>\s*\*\*Memory budgets:\*\*(.*)$/u;
const CONTINUATION = /^\s*>\s*(.*)$/u;

/**
 * `name = 1.5x, 1.5 GB, base 80 MB`
 *
 * The third term bounds the process's FIXED cost, and it exists because the
 * first two cannot see a regression in it. The multiple is taken above the
 * baseline, so anything that inflates the baseline inflates the subtrahend too:
 * a warmed cache or an engine that starts preloading fonts moves both halves
 * together and the ratio holds at 1.00x while the process gets hundreds of
 * megabytes fatter. The absolute cap would not notice until it was gigabytes
 * late. A number that is measured, printed and part of no verdict is the same
 * defect as a flag computed into a detail string and left out of the pass
 * expression.
 */
const ASSERTABLE =
  /^([a-z][a-z0-9-]*)\s*=\s*([0-9]+(?:\.[0-9]+)?)x\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)\s*,\s*base\s+([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)$/u;

/**
 * `name = 3 GB, base 128 MB` — an absolute and a baseline, and NO multiple.
 *
 * A PARSED STATE, on the same principle as `provisional` below rather than as
 * an optional group inside the pattern above. An optional `(…x, )?` would match
 * a line that had lost its multiple by accident exactly as it matches one that
 * lost it by decision, which is the defect `REQUIRED_BUDGETS` is written
 * against one paragraph down: a line that quietly stops budgeting still parses
 * cleanly.
 *
 * `mupdf-host` is declared this way by
 * [ADR-0033](../../docs/DECISIONS/0033-a-ratio-budget-governs-a-process-that-holds-bytes.md).
 * A ratio against file size states something about a process that HOLDS bytes;
 * the host parses, its cost tracks content shape, and its two breaches
 * disagreed about which document was expensive — 6.26x cost 1.34 GB against
 * 7.83x costing 284 MB.
 */
const CONTAINED =
  /^([a-z][a-z0-9-]*)\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)\s*,\s*base\s+([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)$/u;

/**
 * Budgets whose multiple was WITHDRAWN, and which may not carry one again.
 *
 * Tolerating its absence is not enough. Without this set the withdrawal would
 * be a fact about today's text rather than a decision with a mechanism: the
 * next reader restores `6x`, the line parses as `ASSERTABLE`, and the gate
 * asserts a term ADR-0033 removed with reasons — silently, because a budget
 * with more terms looks like a stricter one.
 */
export const NO_MULTIPLE = new Set(['mupdf-host']);

/** `name = provisional` */
const PROVISIONAL = /^([a-z][a-z0-9-]*)\s*=\s*provisional$/u;

/**
 * @typedef {{
 *   name: string,
 *   kind: 'assertable',
 *   multiplier: number | null,
 *   absoluteBytes: number,
 *   absoluteText: string,
 *   baselineBytes: number,
 *   baselineText: string,
 * }} AssertableBudget
 * @typedef {{ name: string, kind: 'provisional' }} ProvisionalBudget
 * @typedef {AssertableBudget | ProvisionalBudget} Budget
 */

/** @param {string} magnitude @param {string} unit @returns {number} */
function toBytes(magnitude, unit) {
  return Number(magnitude) * (unit === 'GB' ? 1024 ** 3 : 1024 ** 2);
}

/** @param {string} what @returns {never} */
function fail(what) {
  throw new Error(
    `${SOURCE_FILE} §9.17: ${what}\n` +
      `The memory budgets are machine-read from the invariant that states them (ADR-0012). ` +
      `There is no default and no fallback in this path: a limit that was substituted rather ` +
      `than read is indistinguishable from a measured one at the moment it decides whether the ` +
      `build passes.\n` +
      `Expected exactly one line of the form:\n` +
      `  > **Memory budgets:** \`main = 1.5x, 1.5 GB, base 80 MB\` · ` +
      `\`mupdf-host = 3 GB, base 128 MB\` · \`renderer = provisional\``,
  );
}

/**
 * Extracts the declaration block: the marker line plus any blockquote lines that
 * continue it, stopping at the first blank blockquote line.
 *
 * Continuation matters because the line wraps in the document — the same reason
 * the withdrawn-phrase declaration wraps — and a parser that read only the
 * marker line would silently see two of the three budgets.
 *
 * @param {string} text
 * @returns {string}
 */
function declarationBlock(text) {
  const lines = text.split('\n');
  /** @type {string[]} */
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const marker = DECLARATION.exec(lines[index] ?? '');
    if (marker === null) continue;

    let block = `${marker[1] ?? ''}`;
    for (let next = index + 1; next < lines.length; next += 1) {
      const continued = CONTINUATION.exec(lines[next] ?? '');
      if (continued === null) break;
      const rest = `${continued[1] ?? ''}`.trim();
      if (rest === '') break;
      block += ` ${rest}`;
    }
    blocks.push(block);
  }

  if (blocks.length === 0) fail('no `**Memory budgets:**` line found');
  if (blocks.length > 1) {
    fail(
      `${String(blocks.length)} \`**Memory budgets:**\` lines found. Exactly one is the source; two ` +
        `is the drift this mechanism exists to remove`,
    );
  }
  return `${blocks[0]}`;
}

/**
 * @param {{ root?: string, text?: string }} [options]
 * @returns {Map<string, Budget>}
 */
export function memoryBudgets(options = {}) {
  const text = options.text ?? readFileSync(join(options.root ?? repoRoot(), SOURCE_FILE), 'utf8');
  const block = declarationBlock(text);

  const entries = [...block.matchAll(/`([^`]+)`/gu)].map((match) => `${match[1] ?? ''}`.trim());
  if (entries.length === 0) fail('the declaration line carries no backticked entries');

  /** @type {Map<string, Budget>} */
  const budgets = new Map();

  for (const entry of entries) {
    const assertable = ASSERTABLE.exec(entry);
    const contained = CONTAINED.exec(entry);
    const provisional = PROVISIONAL.exec(entry);

    if (assertable === null && contained === null && provisional === null) {
      fail(
        `cannot parse budget entry \`${entry}\`. Each entry is ` +
          `\`name = <multiplier>x, <absolute> GB|MB, base <baseline> GB|MB\`, ` +
          `\`name = <absolute> GB|MB, base <baseline> GB|MB\` for a budget whose multiple was ` +
          `withdrawn, or \`name = provisional\``,
      );
    }

    const name = `${(assertable ?? contained ?? provisional)?.[1] ?? ''}`;
    if (budgets.has(name)) fail(`\`${name}\` is declared twice`);

    // REFUSED, not tolerated. A withdrawn term that may quietly come back is a
    // fact about today's text; this makes it a decision with a mechanism.
    if (assertable !== null && NO_MULTIPLE.has(name)) {
      fail(
        `\`${entry}\` carries a multiple, and \`${name}\`'s was withdrawn by ADR-0033 with ` +
          `reasons. A ratio against file size states something about a process that HOLDS ` +
          `bytes; this one parses, and its two breaches disagreed about which document was ` +
          `expensive — 6.26x cost 1.34 GB where 7.83x cost 284 MB. Restoring the term needs a ` +
          `new ADR, not an edit to this line`,
      );
    }

    if (contained !== null) {
      const magnitude = Number(contained[2]);
      const unit = `${contained[3]}`;
      const baseMagnitude = Number(contained[4]);
      const baseUnit = `${contained[5]}`;
      if (!Number.isFinite(magnitude) || magnitude <= 0) fail(`\`${entry}\` has a non-positive absolute limit`);
      if (!Number.isFinite(baseMagnitude) || baseMagnitude <= 0) fail(`\`${entry}\` has a non-positive baseline limit`);

      const absoluteBytes = toBytes(`${contained[2]}`, unit);
      const baselineBytes = toBytes(`${contained[4]}`, baseUnit);
      if (baselineBytes >= absoluteBytes) {
        fail(
          `\`${entry}\` declares a baseline at or above its absolute cap, which leaves no room ` +
            `for a document and means one of the two is not what its author intended`,
        );
      }

      budgets.set(name, {
        name,
        kind: 'assertable',
        // NULL RATHER THAN A SENTINEL, so a consumer that forgets this state
        // fails to compile instead of asserting against `Infinity` or `0`.
        multiplier: null,
        absoluteBytes,
        absoluteText: `${contained[2]} ${unit}`,
        baselineBytes,
        baselineText: `${contained[4]} ${baseUnit}`,
      });
    } else if (assertable !== null) {
      const multiplier = Number(assertable[2]);
      const magnitude = Number(assertable[3]);
      const unit = `${assertable[4]}`;
      const baseMagnitude = Number(assertable[5]);
      const baseUnit = `${assertable[6]}`;
      if (!Number.isFinite(multiplier) || multiplier <= 0) fail(`\`${entry}\` has a non-positive multiplier`);
      if (!Number.isFinite(magnitude) || magnitude <= 0) fail(`\`${entry}\` has a non-positive absolute limit`);
      if (!Number.isFinite(baseMagnitude) || baseMagnitude <= 0) fail(`\`${entry}\` has a non-positive baseline limit`);

      const absoluteBytes = toBytes(`${assertable[3]}`, unit);
      const baselineBytes = toBytes(`${assertable[5]}`, baseUnit);
      if (baselineBytes >= absoluteBytes) {
        fail(
          `\`${entry}\` declares a baseline at or above its absolute cap, which leaves no room for a ` +
            `document and means one of the two is not what its author intended`,
        );
      }

      budgets.set(name, {
        name,
        kind: 'assertable',
        multiplier,
        absoluteBytes,
        absoluteText: `${assertable[3]} ${unit}`,
        baselineBytes,
        baselineText: `${assertable[5]} ${baseUnit}`,
      });
    } else {
      budgets.set(name, { name, kind: 'provisional' });
    }
  }

  const missing = REQUIRED_BUDGETS.filter((name) => !budgets.has(name));
  if (missing.length > 0) {
    fail(
      `no budget declared for ${missing.join(', ')}. Every process this application runs is ` +
        `budgeted, and a process that quietly stops being budgeted is the one that grows`,
    );
  }

  const unknown = [...budgets.keys()].filter((name) => !REQUIRED_BUDGETS.includes(name));
  if (unknown.length > 0) {
    fail(
      `unknown budget ${unknown.join(', ')}. Adding a process means amending this invariant and ` +
        `REQUIRED_BUDGETS together, so neither can drift past the other`,
    );
  }

  return budgets;
}

/**
 * The limit to assert against, or a refusal that names why there is none.
 *
 * Deliberately throws for `provisional` rather than returning null. A caller
 * that received null would have to remember to treat it as "skip this process",
 * and an assertion that silently covers two processes out of three while
 * reporting success is the failure this whole path is built to avoid.
 *
 * @param {Map<string, Budget>} budgets
 * @param {string} name
 * @returns {AssertableBudget}
 */
export function assertableBudget(budgets, name) {
  const budget = budgets.get(name);
  if (budget === undefined) {
    throw new Error(`No budget named ${name} is declared in ${SOURCE_FILE} §9.17.`);
  }
  if (budget.kind === 'provisional') {
    throw new Error(
      `The ${name} budget is declared provisional in ${SOURCE_FILE} §9.17 and is not assertable. ` +
        `It is two-term — a file-size-proportional term plus an absolute bitmap-cache cap — and ` +
        `both are unmeasured until a renderer exists. Do not substitute a number: the single ` +
        `figure this row used to carry is recorded in ADR-0007 as the mistake it was, having no ` +
        `derivation.`,
    );
  }
  return budget;
}
