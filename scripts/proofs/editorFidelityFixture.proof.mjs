// @ts-check
/**
 * The committed page Edit text's fidelity case opens, and its blocks, are what `editorFidelityFixture.mjs` writes NOW
 * (cloud run 19): the page built again byte for byte, and the blocks read again through PDFium and the grouping.
 *
 * `editorFidelity.pw.ts` hands the editor those blocks as the application's reading of the page. A grouping that changed
 * — a soft end decided differently, a run split elsewhere — would leave that case asserting against a reading the
 * application no longer makes, green. This proof is what turns that red.
 *
 * ## Controls
 *
 * - PREMISE: the reading names six blocks, the code block's four commands hard and the list's two entries hard, which
 *   are the two soft ends this run corrected (`textLines.ts`' fixed-pitch and list-entry signs).
 * - CONTROL: one block's text changed in a copy of the committed reading is reported as different, so the comparison
 *   can see a difference.
 *
 * Usage: node scripts/proofs/editorFidelityFixture.proof.mjs [--require-engines]
 */
import { existsSync, readFileSync } from 'node:fs';

import { EDITOR_FIDELITY_FIXTURE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { FIXTURE_BLOCKS, FIXTURE_PDF, buildPage, readBlocks } from '../research/editorFidelityFixture.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');

const CASES = [
  'PREMISE: the reading names six blocks, the code block’s four commands and the list’s two entries each ending hard',
  'the committed page is the page the script builds, byte for byte',
  'the committed blocks are the blocks PDFium and the grouping read from it now: every field equal, a box coordinate within BOX_TOLERANCE',
  'CONTROL: a reading with one block’s words changed is reported as different',
  'CONTROL: a reading with one box moved past BOX_TOLERANCE is reported as different',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 5 });
if (CASES.length !== 5) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 5`);

/**
 * The differences between two readings that the platform does not explain: every field not a box coordinate, and every
 * box coordinate moved past {@link BOX_TOLERANCE}. With the largest box move that is explained, for the report.
 *
 * @param {unknown} committed @param {unknown} read
 */
function unexplained(committed, read) {
  const found = differences(committed, read);
  const moves = found.map(boxMove);
  return {
    wrong: found.filter((_each, at) => {
      const move = moves[at];
      return move === null || move === undefined || move > BOX_TOLERANCE;
    }),
    boxes: moves.filter((move) => move !== null && move !== undefined && move <= BOX_TOLERANCE).length,
    largest: Math.max(0, ...moves.map((move) => (move !== null && move !== undefined && move <= BOX_TOLERANCE ? move : 0))),
  };
}

/** @param {number} at @param {boolean} held @param {string} detail */
function check(at, held, detail) {
  const name = CASES[at] ?? `case ${String(at)}`;
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/**
 * How far a BOX coordinate may lie from the committed one, in points: the platform's measure of a glyph and nothing else.
 *
 * PDFium answers a character's box from the font it draws with, and for a font the page names and does not carry that is
 * the platform's substitute — the Foxit faces it bundles on Linux, the system's on Windows — so the same page's boxes
 * differ by platform while its words, breaks, styles and baselines (the text matrix's, not a glyph's) do not. Read from
 * CI run 40109735351 (windows-latest, 2026-10-24) against the committed Linux reading: every differing field was a box
 * coordinate, the largest 0.252 pt (the heading's top, 742.438 against 742.186). Twice that is allowed; a field that is
 * not a box must still be equal.
 */
const BOX_TOLERANCE = 0.5;

/** @param {string} a @param {string} b */
const same = (a, b) => a === b;

/**
 * Every leaf where two parsed readings differ, by its path, with both values: what a failure prints, so a reading that
 * changes on another platform or under another build names the field and the size of the change rather than "differ".
 *
 * @param {unknown} committed @param {unknown} read @param {string} [path]
 * @returns {{ path: string, committed: unknown, read: unknown }[]}
 */
function differences(committed, read, path = '') {
  if (typeof committed === 'object' && committed !== null && typeof read === 'object' && read !== null) {
    const keys = new Set([...Object.keys(committed), ...Object.keys(read)]);
    return [...keys].flatMap((key) =>
      differences(/** @type {Record<string, unknown>} */ (committed)[key], /** @type {Record<string, unknown>} */ (read)[key], `${path}/${key}`),
    );
  }
  return committed === read ? [] : [{ path: path || '/', committed, read }];
}

/** @param {{ path: string, committed: unknown, read: unknown }} found */
const told = (found) => `${found.path}: committed ${JSON.stringify(found.committed)}, read ${JSON.stringify(found.read)}`;

/** How far a differing box coordinate moved, or `null` where the field is not a box coordinate or not a number. */
const boxMove = (/** @type {{ path: string, committed: unknown, read: unknown }} */ found) =>
  BOX_FIELD.test(found.path) && typeof found.committed === 'number' && typeof found.read === 'number' ? Math.abs(found.committed - found.read) : null;

/** Whether a differing field is a box coordinate, which is all {@link BOX_TOLERANCE} may excuse. */
const BOX_FIELD = /\/box\/[xy][01]$/u;

if (!existsSync(pdfiumLibrary(ROOT))) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'the editor fidelity fixture against the reading',
    why: `${String(CASES.length)} case(s) need PDFium:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      PDFium is not provisioned. Run \`node scripts/provision/pdfium.mjs\`.`,
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, EDITOR_FIDELITY_FIXTURE, 1);
  const bytes = await buildPage();
  const blocks = await readBlocks(bytes);
  const read = `${JSON.stringify(blocks, null, 1)}\n`;
  const committed = readFileSync(FIXTURE_BLOCKS, 'utf8');

  const ends = (/** @type {string} */ start) =>
    blocks.find((/** @type {any} */ block) => block.lines[0]?.runs.map((/** @type {any} */ run) => run.text).join('').startsWith(start))?.lines.map((/** @type {any} */ line) => line.soft);
  const code = ends('git clone');
  const list = ends('• ');
  check(
    0,
    blocks.length === 6 && JSON.stringify(code) === '[false,false,false,false]' && JSON.stringify(list) === '[false,false]',
    `${String(blocks.length)} blocks, the code block's ends ${JSON.stringify(code)}, the list's ${JSON.stringify(list)}`,
  );
  check(1, Buffer.compare(readFileSync(FIXTURE_PDF), Buffer.from(bytes)) === 0, `${String(bytes.length)} bytes built`);
  const now = unexplained(JSON.parse(committed), JSON.parse(read));
  check(
    2,
    now.wrong.length === 0,
    now.wrong.length === 0
      ? same(committed, read)
        ? 'the same'
        : `the same but ${String(now.boxes)} box coordinate(s), the largest moved ${now.largest.toFixed(3)} pt`
      : `${String(now.wrong.length)} field(s) differ past what the platform's substitute faces explain:\n        ${now.wrong.slice(0, 40).map(told).join('\n        ')}${now.wrong.length > 40 ? `\n        and ${String(now.wrong.length - 40)} more` : ''}`,
  );
  const words = unexplained(JSON.parse(committed.replace('git clone', 'git fetch')), JSON.parse(read));
  check(3, words.wrong.some((each) => !BOX_FIELD.test(each.path)), `${String(words.wrong.length)} field(s) named`);
  /** @type {{ box: { x0: number } }[]} */
  const shifted = JSON.parse(committed);
  const first = shifted[0];
  if (first !== undefined) first.box.x0 += BOX_TOLERANCE * 2;
  const boxes = unexplained(shifted, JSON.parse(read));
  check(4, boxes.wrong.some((each) => each.path === '/0/box/x0'), boxes.wrong.map(told).join('; ') || 'nothing named');

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} editor fidelity fixture case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('editor fidelity fixture case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
