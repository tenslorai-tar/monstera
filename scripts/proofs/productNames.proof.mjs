// @ts-check
/**
 * Proves `productNames.mjs` can see, separate and refuse: a name and a two-word name across a line break are found, an
 * identifier the format defines is not, neighbours joined with no space make no name, and its denylist has not shrunk.
 *
 * NO NAME IS SPELT HERE either. The one real name a case needs is cut at run time from an identifier the owner's rule
 * keeps (a CMap's name), so this file holds only what the format itself writes.
 *
 * Usage: node scripts/proofs/productNames.proof.mjs
 */
import { createHash } from 'node:crypto';

import { createRoster } from '../lib/passRoster.mjs';
import { DENIED, namedLines } from '../lib/productNames.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 6 });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/** @param {string} text */
const sha = (text) => createHash('sha256').update(text).digest('hex');

// THE MAKER'S NAME, cut from a CMap's name the format defines — never written bare in this file.
const CMAP = 'Adobe-Japan1';
const maker = CMAP.split('-')[0] ?? '';

{
  const found = namedLines(`one line\nwritten by ${maker} here\n`);
  check('a denied name is found on its line, by its hash alone', JSON.stringify(found) === '[2]', `found on ${JSON.stringify(found)}`);
}
{
  const found = namedLines(`/CIDSystemInfo << /Registry (${maker}) /Ordering (Japan1) >>\n/Encoding /${CMAP}-UCS2\n`);
  check('CONTROL: the same name inside identifiers the format defines is masked, so the case above found it for being a name', found.length === 0, `found on ${JSON.stringify(found)}`);
}
{
  // A TWO-WORD NAME BROKEN ACROSS A LINE, as hard-wrapped prose breaks one: reported on the line it starts on.
  const pair = new Set([sha('monstera proofword')]);
  const found = namedLines('first line\nthis ends in monstera\n * proofword begins this one\n', pair);
  check('a two-word name broken across a line and a comment marker is found where it starts', JSON.stringify(found) === '[2]', `found on ${JSON.stringify(found)}`);
}
{
  // NEIGHBOURS JOINED WITH NO SPACE are not a name: the first run reported a word that ended one line and one that
  // began the next as a maker's name.
  const joined = new Set([sha('monsteraproofword')]);
  const found = namedLines('this ends in monstera\nproofword begins this one\n', joined);
  check('neighbouring words are never joined with no space into a name nobody wrote', found.length === 0, `found on ${JSON.stringify(found)}`);
}
{
  const found = namedLines('Monstera, the PDF editor, edits PDFs.\nAnother widely used PDF editor does too.\n');
  check('ordinary prose about PDF editors names nothing', found.length === 0, `found on ${JSON.stringify(found)}`);
}
// THE DENYLIST'S SIZE, from an independent claim: a list that shrank would agree with any count derived from it.
check('the denylist holds the twenty-five spellings it was built with', DENIED.size === 25, `${String(DENIED.size)} held`);

process.stdout.write(
  failures.length === 0 ? roster.format('product-name case') : `${String(failures.length)} product-name case(s) FAILED:\n  - ${failures.join('\n  - ')}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
