// @ts-check
/**
 * One-off sweep: which recorded item-3 answers leaned on a check that never ran
 * in CI (finding FFFF-1).
 *
 * ## Why this is a script and not a grep
 *
 * The question is not *where are these four named* — they are named in dozens of
 * places, and most are honest records of a LOCAL run, which was always
 * legitimate. The question is narrower: **inside an answer to "would CI have
 * caught it?", did anything rely on `perf:gate`, `electron:surface`,
 * `shim:reach` or `ocr:doors`?** Those four appear zero times in either
 * workflow, so any answer resting on them was resting on nothing.
 *
 * A line-scoped grep cannot ask that. It has no idea which section a line sits
 * in, and `withdrawnPhrases.mjs` already records what happens when prose is
 * matched line by line: this repository hard-wraps, so the longer the phrase the
 * likelier it straddles a break and escapes in silence.
 *
 * ## Why it cannot be a standing check
 *
 * The four are registered as of this commit, so from here on an item-3 answer
 * that names them is correct. This sweep answers a question about the PAST, and
 * a check that keeps asking it would report the same historical lines forever —
 * a permanent red nobody can close, which is how a check gets deleted.
 *
 * So it runs once, its findings become corrections in `docs/JOURNAL.md`, and it
 * stays in the tree as the record of how they were found.
 *
 * ## The positive control
 *
 * "No item-3 answer relied on them" is the reassuring answer, and a broken
 * section parse, a wrong heading pattern and a genuinely clean history all
 * produce it (checklist 4b). {@link CONTROL_FIXTURE} is a section that must be
 * reported, run on every invocation; the sweep refuses to report when it goes
 * unfound.
 *
 * Usage: node scripts/audit/unrunCheckReliance.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

/** The four that appear zero times in either workflow, as of `af73baa`. */
const NEVER_RAN = ['perf:gate', 'electron:surface', 'shim:reach', 'ocr:doors'];

/**
 * Words that turn a mention into an INFERENCE FROM CI.
 *
 * Naming one of the four is not a defect — most mentions record a local run,
 * which was always legitimate and still is. The defect is concluding something
 * from the board, a push, or a runner ON THE BASIS of a check that never
 * executed there.
 *
 * **This list is the sweep's first scope and its first correction.** The sweep
 * originally looked only inside `### 3. Would CI have caught it?` sections,
 * reported 0 of 33, and was wrong: the instance that prompted this — *"the green
 * board was itself read as an instrument: `perf:gate` passes when `baseline <=
 * budget`, so `e94e6c5` going green bounds the runner's clean baseline"* — sits
 * under a `### 4a / 4b` heading. Item 3 was the example, not the boundary, and
 * `0 of 33` is precisely the reassuring answer a too-narrow scope produces.
 */
const CI_INFERENCE = [
  'green',
  'board',
  ' CI ',
  'runner',
  'workflow',
  'the push',
  'on every push',
];

/**
 * A section that MUST be reported, so silence is never mistaken for cleanliness.
 *
 * Built from the real shape: an item-3 heading, prose, and a sentence resting on
 * one of the four. If the section parse breaks, the heading pattern stops
 * matching, or the name list empties, this stops being reported and the run
 * refuses.
 */
export const CONTROL_FIXTURE = [
  'A paragraph that records a local run of `perf:gate` and concludes nothing.',
  '',
  'The green board was read as an instrument: `perf:gate` passes when the',
  'baseline is under budget, so that push bounds the runner at 80 MB.',
  '',
  'A third paragraph naming no check at all.',
].join('\n');

/**
 * @typedef {{ line: number, names: string[], signals: string[], quote: string }} Reliance
 */

/**
 * Every paragraph that infers something from CI on the basis of a never-run check.
 *
 * @param {string} text
 * @returns {{ paragraphs: number, mentions: number, reliances: Reliance[] }}
 */
export function sweep(text) {
  /** @type {Reliance[]} */
  const reliances = [];
  let mentions = 0;

  const lines = text.split('\n');
  /** @type {{ start: number, body: string[] }[]} */
  const paragraphs = [];
  /** @type {string[]} */
  let current = [];
  let start = 1;
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '') {
      if (current.length > 0) paragraphs.push({ start, body: current });
      current = [];
      start = index + 2;
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) paragraphs.push({ start, body: current });

  for (const paragraph of paragraphs) {
    // THE PARAGRAPH IS THE UNIT, not the line. This repository hard-wraps
    // prose, so a claim spanning a break escapes a line-scoped search — the
    // false negative `withdrawnPhrases.mjs` records as its third, where the
    // longer the sentence the likelier it wraps, which is backwards.
    const flat = ` ${paragraph.body.join(' ').replaceAll(/\s+/gu, ' ')} `;
    const named = NEVER_RAN.filter((name) => flat.includes(name));
    if (named.length === 0) continue;
    mentions += 1;

    const signals = CI_INFERENCE.filter((signal) => flat.includes(signal));
    if (signals.length === 0) continue;

    reliances.push({
      line: paragraph.start,
      names: named,
      signals,
      quote: flat.trim().slice(0, 260),
    });
  }
  return { paragraphs: paragraphs.length, mentions, reliances };
}

if (import.meta.url.endsWith(process.argv[1]?.replaceAll('\\', '/') ?? ' ')) {
  const control = sweep(CONTROL_FIXTURE);
  if (control.reliances.length !== 1) {
    process.stderr.write(
      `REFUSING TO REPORT — the sweep could not find its own known-present reliance.\n` +
        `  Expected exactly 1 from the control fixture, got ${String(control.reliances.length)}.\n` +
        `  A broken section parse and a clean history print the same sentence.\n`,
    );
    process.exit(1);
  }

  const journal = join(repoRoot(), 'docs', 'JOURNAL.md');
  const result = sweep(readFileSync(journal, 'utf8'));

  if (result.paragraphs === 0 || result.mentions === 0) {
    process.stderr.write(
      `REFUSING TO REPORT — docs/JOURNAL.md parsed to ${String(result.paragraphs)} ` +
        `paragraph(s) with ${String(result.mentions)} naming one of the four.\n` +
        `  These checks are named dozens of times; zero is a broken parse, not a clean\n` +
        `  history.\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `Paragraphs examined: ${String(result.paragraphs)}\n` +
      `Naming a never-run check: ${String(result.mentions)}\n` +
      `...and inferring from CI on that basis: ${String(result.reliances.length)}\n\n`,
  );
  for (const reliance of result.reliances) {
    process.stdout.write(
      `  docs/JOURNAL.md:${String(reliance.line)}  ${reliance.names.join(', ')} ` +
        `+ [${reliance.signals.join('] [').trim()}]\n    ${reliance.quote}\n\n`,
    );
  }
}
