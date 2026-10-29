// @ts-check
/**
 * Proves `productNames.mjs` can see, separate and refuse: a name and a two-word name across a line break are found, an
 * identifier the format defines is not, neighbours joined with no space make no name, a commit of pictures alone is not
 * a blind read while an unreadable file still is, and its denylist has not shrunk.
 *
 * NO NAME IS SPELT HERE either. The one real name a case needs is cut at run time from an identifier the owner's rule
 * keeps (a CMap's name), so this file holds only what the format itself writes.
 *
 * Usage: node scripts/proofs/productNames.proof.mjs
 */
import { createHash } from 'node:crypto';

import { createRoster } from '../lib/passRoster.mjs';
import { DENIED, kindOf, namedLines, whatWasRead } from '../lib/productNames.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 9 });

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
  // THE XMP PACKET'S NAMESPACE, which the standard fixes, against the same maker's name in prose on the next line.
  const found = namedLines(`<x:xmpmeta xmlns:x="${maker.toLowerCase()}:ns:meta/">\nas ${maker.toLowerCase()} writes it\n`);
  check('an XMP packet’s fixed namespace is masked and the name beside it is still found', JSON.stringify(found) === '[2]', `found on ${JSON.stringify(found)}`);
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
{
  // A COMMIT OF PICTURES ALONE stages nothing the scan reads, as one of no files does: it was refused as a blind read,
  // because "nothing to read" was decided from the list before the binaries in it were skipped (2026-10-29, three
  // baselines committed alone). A real PNG's first bytes, a NUL among them, decide the kind as the scan decides it.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const kinds = [kindOf(png), kindOf(png)];
  check('a commit staging only pictures stages nothing the scan reads, and is not refused as blind', whatWasRead('staged', kinds) === 'nothing-staged', `${JSON.stringify(kinds)} judged ${whatWasRead('staged', kinds)}`);
}
{
  // THE REFUSALS IT KEEPS: a staged file whose bytes could not be had, and a tree that read no text, are blind reads.
  const unread = whatWasRead('staged', [kindOf(null), 'binary']);
  const tree = whatWasRead('tree', ['binary']);
  check('CONTROL: a staged file that could not be read, or a tree with no text read, is still refused as blind', unread === 'blind' && tree === 'blind', `staged ${unread}, tree ${tree}`);
}
// THE DENYLIST'S SIZE, from an independent claim: a list that shrank would agree with any count derived from it.
check('the denylist holds the twenty-five spellings it was built with', DENIED.size === 25, `${String(DENIED.size)} held`);

process.stdout.write(
  failures.length === 0 ? roster.format('product-name case') : `${String(failures.length)} product-name case(s) FAILED:\n  - ${failures.join('\n  - ')}\n`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
