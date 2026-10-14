// @ts-check
/**
 * Proof that `xlsSheets.mjs` reads an `.xls` workbook's visible sheet count from its own bytes (rule B2).
 *
 * The comments walk's N6 step takes the number of sheets the PDF must hold from this reader, so a reader that answered
 * a constant would make the step pass on any PDF. The fixtures are Compound Files built here byte by byte, a workbook
 * stream in the regular sectors and one in the mini stream, so both of the format's paths are read.
 *
 * CONTROL: one file with two sheets and one with two sheets of which one is hidden must give different counts — the
 * same bytes but one bit — and a file with no sheet record must THROW, never answer 0.
 *
 * Usage: node scripts/lib/xlsSheets.proof.mjs
 */

import { createRoster } from './passRoster.mjs';
import { visibleSheetCount, xlsSheets } from './xlsSheets.mjs';

const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;

/** A BIFF record. @param {number} type @param {Buffer} data */
function record(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(type, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
}

/** A BOUNDSHEET record for an 8-bit name. @param {string} name @param {number} state 0 visible, 1 hidden, 2 very hidden */
function boundSheet(name, state) {
  const data = Buffer.alloc(8 + name.length);
  data.writeUInt32LE(0, 0);
  data[4] = state;
  data[5] = 0;
  data[6] = name.length;
  data[7] = 0;
  data.write(name, 8, 'latin1');
  return record(0x0085, data);
}

/**
 * A workbook stream: BOF, the sheets, EOF, then `padding` bytes of a filler record so its size can be set either side
 * of the mini stream cutoff.
 *
 * @param {{ name: string, state: number }[]} sheets @param {number} padding
 */
function workbook(sheets, padding) {
  const filler = [];
  for (let left = padding; left > 0; left -= 4 + Math.min(left, 2000)) filler.push(record(0x003c, Buffer.alloc(Math.min(left, 2000))));
  return Buffer.concat([record(0x0809, Buffer.alloc(16)), ...sheets.map((sheet) => boundSheet(sheet.name, sheet.state)), record(0x000a, Buffer.alloc(0)), ...filler]);
}

/** A directory entry of 128 bytes. @param {string} name @param {number} type @param {number} start @param {number} size @param {number} child */
function entry(name, type, start, size, child) {
  const at = Buffer.alloc(128);
  at.write(name, 0, 'utf16le');
  at.writeUInt16LE(name === '' ? 0 : (name.length + 1) * 2, 0x40);
  at[0x42] = type;
  at.writeUInt32LE(FREE, 0x44);
  at.writeUInt32LE(FREE, 0x48);
  at.writeUInt32LE(child, 0x4c);
  at.writeUInt32LE(start, 0x74);
  at.writeUInt32LE(size, 0x78);
  return at;
}

/**
 * A Compound File holding `stream` as `Workbook`: sector 0 the FAT, 1 the directory, 2 the mini FAT, 3 on the data —
 * the workbook itself at or past the cutoff, else the mini stream that holds it.
 *
 * @param {Buffer} stream
 */
function compoundFile(stream) {
  const mini = stream.length < CUTOFF;
  const data = mini ? Buffer.concat([stream, Buffer.alloc((MINI - (stream.length % MINI)) % MINI)]) : stream;
  const dataSectors = Math.ceil(data.length / SECTOR);
  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(CUTOFF, 0x38);
  header.writeUInt32LE(mini ? 2 : END_OF_CHAIN, 0x3c);
  header.writeUInt32LE(mini ? 1 : 0, 0x40);
  header.writeUInt32LE(END_OF_CHAIN, 0x44);
  header.writeUInt32LE(0, 0x48);
  for (let at = 0; at < 109; at += 1) header.writeUInt32LE(at === 0 ? 0 : FREE, 0x4c + at * 4);

  const fat = Buffer.alloc(SECTOR, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(END_OF_CHAIN, 4);
  fat.writeUInt32LE(END_OF_CHAIN, 8);
  for (let at = 0; at < dataSectors; at += 1) fat.writeUInt32LE(at === dataSectors - 1 ? END_OF_CHAIN : 3 + at + 1, (3 + at) * 4);

  const directory = Buffer.concat([
    entry('Root Entry', 5, mini ? 3 : END_OF_CHAIN, mini ? data.length : 0, 1),
    entry('Workbook', 2, mini ? 0 : 3, stream.length, FREE),
    entry('', 0, 0, 0, FREE),
    entry('', 0, 0, 0, FREE),
  ]);

  const miniFat = Buffer.alloc(SECTOR, 0xff);
  const miniSectors = mini ? data.length / MINI : 0;
  for (let at = 0; at < miniSectors; at += 1) miniFat.writeUInt32LE(at === miniSectors - 1 ? END_OF_CHAIN : at + 1, at * 4);

  return Buffer.concat([header, fat, directory, miniFat, data, Buffer.alloc(dataSectors * SECTOR - data.length)]);
}

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 7 });

/** @param {string} label @param {() => boolean} condition @param {() => string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  let held;
  try {
    held = condition();
  } catch (error) {
    failures.push(`${label}\n      threw: ${error instanceof Error ? error.message : String(error)}`);
    roster.record(mark, label);
    return;
  }
  if (!held) failures.push(`${label}\n      ${detail()}`);
  roster.record(mark, label);
}

/** @param {() => unknown} run */
function throws(run) {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

const TWO = [
  { name: 'Sheet1', state: 0 },
  { name: 'Sheet2', state: 0 },
];
const ONE_HIDDEN = [
  { name: 'Sheet1', state: 0 },
  { name: 'Sheet2', state: 1 },
];
const large = (/** @type {{ name: string, state: number }[]} */ sheets) => compoundFile(workbook(sheets, 6000));
const small = (/** @type {{ name: string, state: number }[]} */ sheets) => compoundFile(workbook(sheets, 0));

check(
  'the reader reads the sheet names back from a workbook in regular sectors',
  () => JSON.stringify(xlsSheets(large(TWO)).map((sheet) => sheet.name)) === '["Sheet1","Sheet2"]',
  () => `read ${JSON.stringify(xlsSheets(large(TWO)))}`,
);
check('two visible sheets count as two, in regular sectors', () => visibleSheetCount(large(TWO)) === 2, () => `counted ${String(visibleSheetCount(large(TWO)))}`);
check('two visible sheets count as two, in the mini stream', () => visibleSheetCount(small(TWO)) === 2, () => `counted ${String(visibleSheetCount(small(TWO)))}`);
check(
  'CONTROL: the same workbook with its second sheet hidden counts as one',
  () => visibleSheetCount(large(ONE_HIDDEN)) === 1 && visibleSheetCount(small(ONE_HIDDEN)) === 1,
  () => `counted ${String(visibleSheetCount(large(ONE_HIDDEN)))} and ${String(visibleSheetCount(small(ONE_HIDDEN)))}`,
);
check('a one-sheet workbook counts as one', () => visibleSheetCount(small([{ name: 'Only', state: 0 }])) === 1, () => 'did not count one');
check('CONTROL: a workbook listing no sheet THROWS, never answers 0', () => throws(() => visibleSheetCount(small([]))), () => 'answered rather than threw');
check('a file that is not a Compound File is refused', () => throws(() => xlsSheets(Buffer.from('PK not an xls file at all'.padEnd(600, ' ')))), () => 'was read');

if (failures.length > 0) {
  process.stderr.write(`\nxls sheet-count proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
  process.exit(1);
}
process.stdout.write(roster.format('xls sheet-count case'));
