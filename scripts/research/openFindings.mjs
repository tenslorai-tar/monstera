// @ts-check
/**
 * Every audit finding whose LATEST record in `docs/JOURNAL.md` says it is open: the count addendum B8 is to end at zero.
 *
 * ## What a record is
 *
 * A finding's record is a bold id followed by its state in parentheses, the form every stage audit writes:
 * `**KKKKKKKK-1** (high, open): ...`, `**JJJJJJJJ-1** (medium, closed `d825967a`): ...`. The journal is newest first
 * below its *Where the build stands* section, so a finding's latest record is the first one in the file after that
 * section. A record is open when its state names `open` and none of `closed`, `fixed`, `settled`, `not a defect`.
 *
 * A finding closed only in prose (a list under *Closed by a fix*) has no record saying so, and counts as open here: a
 * closure this instrument cannot read is one the next reader cannot find either.
 *
 * ## Its positive control, on every run
 *
 * Before reading the journal it reads a fixture holding one finding open, then closed by a later record above it, and
 * one left open; it must report exactly the one left open, or nothing it reports about the journal is trusted.
 *
 *   node scripts/research/openFindings.mjs [--list]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';

const root = repoRoot();

/** A finding's record: its bold id, then its state in parentheses. */
// ANY WHITESPACE between the id and its state, a line break included: the journal is hard-wrapped, and a record whose
// state starts the next line is still a record. Matched with a single space, ZZZZZZ-4 (open) and AAAAAAA-2 were read as
// no record at all, which a count of open findings reports as zero — measured 2026-10-18.
const RECORD = /\*\*([A-Z]{1,12}-\d{1,3})\*\*\s+\(([^)]*)\)/gu;
const CLOSED = /\b(closed|fixed|settled|not a defect)\b/u;

/**
 * Each finding's latest state, from journal text newest first, skipping everything above the first dated entry.
 *
 * @param {string} text
 */
function latestStates(text) {
  const firstEntry = text.search(/^## \d{4}-\d{2}-\d{2} /mu);
  const body = firstEntry < 0 ? text : text.slice(firstEntry);
  /** @type {Map<string, { state: string, at: number }>} */
  const latest = new Map();
  for (const match of body.matchAll(RECORD)) {
    const [, id, state] = match;
    if (id === undefined || state === undefined || latest.has(id)) continue;
    latest.set(id, { state, at: match.index ?? 0 });
  }
  return latest;
}

/** The ids whose latest state is open. @param {string} text */
function openIn(text) {
  return [...latestStates(text).entries()]
    .filter(([, { state }]) => /\bopen\b/u.test(state) && !CLOSED.test(state))
    .map(([id]) => id);
}

// THE CONTROL: a finding closed by a later record (above it), one still open, and one still open whose state starts the
// next line — the hard-wrapped shape that hid ZZZZZZ-4 from a pattern matching a single space.
const FIXTURE = [
  '## Where the build stands',
  '**ZZZZ-9** (low, open): above the first entry, never read.',
  '## 2026-10-17 — Closing',
  '**ZZZZ-1** (low, closed `abc1234`): fixed.',
  '## 2026-10-16 — Stage audit',
  '**ZZZZ-1** (low, open): the first finding.',
  '**ZZZZ-2** (medium, open): the second finding. **ZZZZ-3**',
  '(low, open): the third, wrapped.',
].join('\n');
const control = openIn(FIXTURE);
if (JSON.stringify(control) !== JSON.stringify(['ZZZZ-2', 'ZZZZ-3'])) {
  throw new Error(
    `the control read ${JSON.stringify(control)} where it must read ["ZZZZ-2","ZZZZ-3"]; nothing below would be trusted`,
  );
}

const journal = readFileSync(join(root, 'docs', 'JOURNAL.md'), 'utf8');
const states = latestStates(journal);
const open = openIn(journal);
process.stdout.write(`${String(states.size)} findings with a record; ${String(open.length)} whose latest record is open\n`);
if (process.argv.includes('--list')) for (const id of open) process.stdout.write(`  ${id}  (${states.get(id)?.state ?? ''})\n`);
