// @ts-check
/**
 * Proof that the memory budgets are read from the invariant and that nothing in
 * that path can substitute a value (rule B2, ADR-0012).
 *
 * The property under test is unusual: most of these cases assert that something
 * THROWS. That is the point. A parser for a limit has exactly one dangerous
 * failure mode — yielding a plausible number when it should have stopped — and
 * a fallback is how a withdrawn budget returns silently. So every malformed
 * shape is checked for a refusal, not for a sensible default.
 *
 * The control that keeps the rest honest is the first case: the real document
 * parses, and produces the values it visibly states. Without it, a parser that
 * threw unconditionally would satisfy every other case here.
 *
 * Usage: node scripts/proofs/memoryBudgets.proof.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { SOURCE_FILE, assertableBudget, memoryBudgets } from '../lib/memoryBudgets.mjs';

const ROOT = repoRoot();
const REAL = readFileSync(join(ROOT, SOURCE_FILE), 'utf8');

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
 * @param {string} label
 * @param {() => unknown} run
 * @param {RegExp} expected
 */
function checkThrows(label, run, expected) {
  try {
    run();
    failures.push(`${label}\n      it returned a value instead of refusing. A limit that was substituted rather than read is the failure this path exists to prevent.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, expected.test(message), `threw, but not for the expected reason:\n      ${message.slice(0, 300)}`);
  }
}

/** Replaces the declared line's entries, keeping the document otherwise intact. */
/** @param {string} entries @returns {string} */
function withEntries(entries) {
  return REAL.replace(
    /(^\s*>\s*\*\*Memory budgets:\*\*)[\s\S]*?(?=\n\s*>\s*\n)/mu,
    `$1 ${entries}`,
  );
}

// ---------------------------------------------------------------------------
// The control: the real invariant parses, and says what it visibly says.
// ---------------------------------------------------------------------------
{
  const budgets = memoryBudgets({ text: REAL });

  const main = assertableBudget(budgets, 'main');
  check(
    'the real §9.17 parses, and main matches what the line states',
    main.multiplier === 1.5 && main.absoluteText === '1.5 GB' && main.absoluteBytes === 1.5 * 1024 ** 3,
    `got multiplier=${String(main.multiplier)} absolute=${main.absoluteText} bytes=${String(main.absoluteBytes)}`,
  );

  const host = assertableBudget(budgets, 'mupdf-host');
  check(
    'and mupdf-host does too, carrying NO multiple since ADR-0033',
    host.multiplier === null && host.absoluteText === '3 GB' && host.absoluteBytes === 3 * 1024 ** 3,
    `got multiplier=${String(host.multiplier)} absolute=${host.absoluteText}`,
  );

  // Resolution test. Two budgets that differ only in the digit that matters must
  // come back different, or the parser cannot distinguish the numbers it exists
  // to carry.
  const nudged = memoryBudgets({ text: withEntries('`main = 1.6x, 1.5 GB, base 96 MB` ·`mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`') });
  check(
    'changing 1.5x to 1.6x in the line changes the parsed budget',
    assertableBudget(nudged, 'main').multiplier === 1.6,
    'the parser reports the same multiplier for two different declarations, so it is not reading the line',
  );

  const rescaled = memoryBudgets({ text: withEntries('`main = 1.5x, 1500 MB, base 96 MB` ·`mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`') });
  check(
    'and MB is not silently treated as GB',
    assertableBudget(rescaled, 'main').absoluteBytes === 1500 * 1024 ** 2,
    `got ${String(assertableBudget(rescaled, 'main').absoluteBytes)} bytes for "1500 MB"`,
  );
}

// ---------------------------------------------------------------------------
// The renderer is declared and deliberately unassertable — which is a state,
// not an absence.
// ---------------------------------------------------------------------------
{
  const budgets = memoryBudgets({ text: REAL });
  check(
    'renderer parses as provisional rather than being missing',
    budgets.get('renderer')?.kind === 'provisional',
    `got ${JSON.stringify(budgets.get('renderer'))}`,
  );

  checkThrows(
    'asking for the renderer limit refuses, naming why there is none',
    () => assertableBudget(budgets, 'renderer'),
    /provisional|two-term/iu,
  );
}

// ---------------------------------------------------------------------------
// Every malformed shape refuses. None yields a number.
// ---------------------------------------------------------------------------
checkThrows(
  'a missing declaration line refuses',
  () => memoryBudgets({ text: REAL.replace(/\*\*Memory budgets:\*\*/u, '**Memory budgets (removed):**') }),
  /no `\*\*Memory budgets:\*\*` line found/u,
);

checkThrows(
  'two declaration lines refuse rather than picking one',
  () => memoryBudgets({ text: `${REAL}\n\n> **Memory budgets:** \`main = 9x, 9 GB\`\n` }),
  /2 .*lines found|drift/u,
);

checkThrows(
  'a malformed entry refuses',
  () => memoryBudgets({ text: withEntries('`main = about one and a half times` · `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`') }),
  /cannot parse budget entry/u,
);

checkThrows(
  'a missing budget refuses rather than budgeting two processes out of three',
  () => memoryBudgets({ text: withEntries('`main = 1.5x, 1.5 GB, base 96 MB` · `renderer = provisional`') }),
  /no budget declared for mupdf-host/u,
);

checkThrows(
  'an unknown budget name refuses',
  () => memoryBudgets({ text: withEntries('`main = 1.5x, 1.5 GB, base 96 MB` · `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional` · `gpu = 2x, 1 GB, base 64 MB`') }),
  /unknown budget gpu/u,
);

// ---------------------------------------------------------------------------
// THE WITHDRAWN MULTIPLE, and refusing its return is the whole mechanism.
//
// Tolerating its absence would make ADR-0033's withdrawal a fact about today's
// text: the next reader restores `6x`, the line parses as an ordinary
// three-term budget, and the gate asserts a term that was removed with reasons —
// silently, because a budget with more terms reads as a stricter one.
//
// The pair matters. Accepting the two-term form alone is satisfied by a parser
// that accepts everything; refusing the three-term form alone is satisfied by
// one that accepts nothing for this name.
// ---------------------------------------------------------------------------
checkThrows(
  'a mupdf-host line that RESTORES its multiple is refused, not quietly asserted',
  () =>
    memoryBudgets({
      text: withEntries(
        '`main = 1.5x, 1.5 GB, base 96 MB` · `mupdf-host = 6x, 3 GB, base 128 MB` · `renderer = provisional`',
      ),
    }),
  /withdrawn by ADR-0033/u,
);

{
  // THE OTHER HALF: `main` still carries one, so the refusal above is about the
  // budget ADR-0033 names and not about multiples in general. Without this the
  // rule could have been written as "no budget may carry a multiple" and both
  // cases would still pass.
  const budgets = memoryBudgets({
    text: withEntries(
      '`main = 1.5x, 1.5 GB, base 96 MB` · `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`',
    ),
  });
  check(
    'CONTROL: main keeps its multiple, so the refusal is per budget and not a ban',
    assertableBudget(budgets, 'main').multiplier === 1.5,
    `main parsed as multiplier=${String(assertableBudget(budgets, 'main').multiplier)}`,
  );
}

checkThrows(
  'a duplicated budget refuses',
  () => memoryBudgets({ text: withEntries('`main = 1.5x, 1.5 GB, base 96 MB` · `main = 9x, 9 GB, base 96 MB` ·`mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`') }),
  /declared twice/u,
);

// ---------------------------------------------------------------------------
// The baseline term, which exists because the other two cannot see a regression
// in it: the multiple is taken above the baseline, so an inflated fixed cost
// raises numerator and subtrahend together and the ratio does not move.
// ---------------------------------------------------------------------------
{
  const budgets = memoryBudgets({ text: REAL });
  const main = assertableBudget(budgets, 'main');
  check(
    'the real line declares a baseline budget for main',
    main.baselineBytes > 0 && main.baselineText.length > 0,
    `got ${JSON.stringify({ bytes: main.baselineBytes, text: main.baselineText })}`,
  );

  // Resolution test: a one-unit change must come back as a different number, or
  // the term is being parsed but not read.
  //
  // The nudge is DERIVED from the real line rather than spelt out. It used to
  // read `base 97 MB`, which silently encoded that §9.17 declared 96 — a second
  // opinion about the one number this whole module exists to keep in a single
  // place (B3a), and it went red the day ADR-0025 moved it. A resolution test is
  // about the parser's resolution and must hold for whatever the invariant says.
  const MB = 1024 ** 2;
  check(
    'the declared baseline is a whole number of MB, so the nudge below is exact',
    main.baselineBytes % MB === 0,
    `${String(main.baselineBytes)} bytes is not a whole number of MB, so "+1 MB" is not the ` +
      `one-unit change this case means and the assertion below would be arithmetic about the ` +
      `wrong quantity.`,
  );
  const nudgedMb = main.baselineBytes / MB + 1;
  const nudged = memoryBudgets({
    text: withEntries(
      `\`main = 1.5x, 1.5 GB, base ${String(nudgedMb)} MB\` · ` +
        '`mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`',
    ),
  });
  check(
    'changing the baseline by 1 MB changes the parsed budget',
    assertableBudget(nudged, 'main').baselineBytes === main.baselineBytes + MB,
    `${String(assertableBudget(nudged, 'main').baselineBytes)} against ${String(main.baselineBytes)}`,
  );
}

checkThrows(
  'an entry with no baseline term refuses',
  () =>
    memoryBudgets({
      text: withEntries('`main = 1.5x, 1.5 GB` · `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`'),
    }),
  /cannot parse budget entry/u,
);

checkThrows(
  'a baseline at or above the absolute cap refuses',
  () =>
    memoryBudgets({
      text: withEntries('`main = 1.5x, 1.5 GB, base 2 GB` · `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`'),
    }),
  /baseline at or above its absolute cap/u,
);

checkThrows(
  'a zero baseline refuses',
  () =>
    memoryBudgets({
      text: withEntries('`main = 1.5x, 1.5 GB, base 0 MB` · `mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`'),
    }),
  /non-positive baseline/u,
);

checkThrows(
  'a zero multiplier refuses',
  () => memoryBudgets({ text: withEntries('`main = 0x, 1.5 GB, base 96 MB` ·`mupdf-host = 3 GB, base 128 MB` · `renderer = provisional`') }),
  /non-positive multiplier/u,
);

checkThrows(
  'an entry-less declaration refuses',
  () => memoryBudgets({ text: withEntries('none') }),
  /carries no backticked entries/u,
);

// ---------------------------------------------------------------------------
// No default value exists anywhere in the module's source.
// ---------------------------------------------------------------------------
{
  // A source-level check, because the cases above can only prove that the
  // failures somebody thought of throw. This is aimed at a fallback added later
  // on a path no case covers, which is how a fallback actually arrives.
  //
  // It looks for a substituted NUMBER or a swallowed error, not for `??` in
  // general. A first version flagged every `?? ''`, which is how a regex group
  // is coerced to a string under strict null checks — those lead to a parse
  // failure rather than to a limit, so flagging them made the check broader
  // than its own claim. The narrowing is resolution-tested below rather than
  // asserted, because "I narrowed it and it went green" is exactly what
  // loosening a check to silence it also looks like.
  /** @param {string} line */
  const looksLikeFallback = (line) =>
    !/^\s*(\*|\/\/)/u.test(line) && /(\?\?|\|\|)\s*[0-9]|catch\s*\{\s*\}/u.test(line);

  const mustFlag = [
    'return budget ?? 1.5;',
    'const limit = parsed || 1610612736;',
    'try { return parse(text); } catch { }',
  ];
  const mustNotFlag = [
    "const marker = DECLARATION.exec(lines[index] ?? '');",
    "const name = `${(assertable ?? provisional)?.[1] ?? ''}`;",
  ];

  check(
    'the fallback detector flags a substituted number and a swallowed error',
    mustFlag.every(looksLikeFallback),
    `missed: ${mustFlag.filter((line) => !looksLikeFallback(line)).join(' | ')}`,
  );
  check(
    'and does not flag a string coercion that still fails loudly',
    !mustNotFlag.some(looksLikeFallback),
    `wrongly flagged: ${mustNotFlag.filter(looksLikeFallback).join(' | ')}`,
  );

  const source = readFileSync(join(ROOT, 'scripts', 'lib', 'memoryBudgets.mjs'), 'utf8');
  const suspicious = source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => looksLikeFallback(line));

  check(
    'no substituted number or swallowed error on the budget path',
    suspicious.length === 0,
    `lines: ${suspicious.map((entry) => `${String(entry.number)}: ${entry.line.trim()}`).join(' | ')}`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nMemory-budget proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} memory-budget cases passed.\n`);
