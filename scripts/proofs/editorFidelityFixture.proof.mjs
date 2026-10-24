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
  'the committed blocks are the blocks PDFium and the grouping read from it now',
  'CONTROL: a reading with one block’s words changed is reported as different',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });
if (CASES.length !== 4) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 4`);

/** @param {number} at @param {boolean} held @param {string} detail */
function check(at, held, detail) {
  const name = CASES[at] ?? `case ${String(at)}`;
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/** @param {string} a @param {string} b */
const same = (a, b) => a === b;

/**
 * Every leaf where two parsed readings differ, by its path, with both values: what a failure prints, so a reading that
 * changes on another platform or under another build names the field and the size of the change rather than "differ".
 *
 * @param {unknown} committed @param {unknown} read @param {string} [path]
 * @returns {string[]}
 */
function differences(committed, read, path = '') {
  if (typeof committed === 'object' && committed !== null && typeof read === 'object' && read !== null) {
    const keys = new Set([...Object.keys(committed), ...Object.keys(read)]);
    return [...keys].flatMap((key) =>
      differences(/** @type {Record<string, unknown>} */ (committed)[key], /** @type {Record<string, unknown>} */ (read)[key], `${path}/${key}`),
    );
  }
  return committed === read ? [] : [`${path || '/'}: committed ${JSON.stringify(committed)}, read ${JSON.stringify(read)}`];
}

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
  const found = differences(JSON.parse(committed), JSON.parse(read));
  check(
    2,
    same(committed, read),
    same(committed, read)
      ? 'the same'
      : `${String(found.length)} field(s) differ:\n        ${found.slice(0, 40).join('\n        ')}${found.length > 40 ? `\n        and ${String(found.length - 40)} more` : ''}`,
  );
  const altered = committed.replace('git clone', 'git fetch');
  check(3, altered !== committed && !same(altered, read), 'one word changed in a copy reads as different');

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} editor fidelity fixture case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('editor fidelity fixture case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
