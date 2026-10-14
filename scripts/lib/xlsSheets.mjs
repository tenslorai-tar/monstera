// @ts-check
/**
 * How many VISIBLE sheets an Excel 97–2003 workbook (`.xls`) holds, read from its own bytes.
 *
 * The comments walk's N6 step asserted two, because the sample it was written against had two; the Windows machine's
 * sample has one (2026-10-14), so the count the PDF must reach is the file's, read here, never a number in the walk.
 *
 * ## The two formats
 *
 * An `.xls` is a Compound File (MS-CFB): a 512-byte header, a FAT chaining sectors into streams, a directory naming
 * the streams, and small streams kept in a mini stream with its own FAT. The workbook is the stream `Workbook` (or
 * `Book` in BIFF5). Inside it, BIFF records (`[u16 type][u16 length][data]`); the workbook globals list each sheet in a
 * BOUNDSHEET record (0x0085), whose sixth byte's low two bits are its visibility: 0 visible, 1 hidden, 2 very hidden.
 * The globals end at the first EOF record (0x000A).
 *
 * ## Nothing found is a broken read
 *
 * A workbook always lists at least one sheet, so a read that finds no BOUNDSHEET THROWS rather than answering 0 — an
 * empty result here is a parse that saw nothing (CLAUDE.md item 4b's corollary), and 0 would make any PDF pass.
 */

const SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const BOUNDSHEET = 0x0085;
const EOF = 0x000a;

/**
 * The sheets the workbook lists, each with its visibility.
 *
 * @param {Uint8Array} bytes the `.xls` file
 * @returns {{ name: string, visible: boolean }[]}
 */
export function xlsSheets(bytes) {
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (file.length < 512 || !file.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a Compound File: an .xls starts with D0 CF 11 E0');
  const sectorSize = 1 << file.readUInt16LE(0x1e);
  const miniSectorSize = 1 << file.readUInt16LE(0x20);
  const cutoff = file.readUInt32LE(0x38);
  const sectorAt = (/** @type {number} */ sector) => (sector + 1) * sectorSize;
  const perSector = sectorSize / 4;

  // THE FAT's sectors: the header's 109, then the DIFAT chain's, each holding one fewer and the next DIFAT sector last.
  /** @type {number[]} */
  const fatSectors = [];
  const fatCount = file.readUInt32LE(0x2c);
  for (let at = 0; at < 109 && fatSectors.length < fatCount; at += 1) fatSectors.push(file.readUInt32LE(0x4c + at * 4));
  for (let difat = file.readUInt32LE(0x44), guard = 0; fatSectors.length < fatCount && difat !== END_OF_CHAIN && guard < 1 << 16; guard += 1) {
    for (let at = 0; at < perSector - 1 && fatSectors.length < fatCount; at += 1) fatSectors.push(file.readUInt32LE(sectorAt(difat) + at * 4));
    difat = file.readUInt32LE(sectorAt(difat) + (perSector - 1) * 4);
  }
  const fat = (/** @type {number} */ sector) => {
    const holder = fatSectors[Math.floor(sector / perSector)];
    if (holder === undefined) throw new Error(`sector ${String(sector)} is past the FAT`);
    return file.readUInt32LE(sectorAt(holder) + (sector % perSector) * 4);
  };
  /**
   * A chain of sectors of `source` read whole.
   *
   * @param {Buffer} source @param {number} start @param {(sector: number) => number} next @param {number} size
   * @param {(sector: number) => number} offset
   */
  const chain = (source, start, next, size, offset) => {
    /** @type {Buffer[]} */
    const pieces = [];
    for (let sector = start, guard = 0; sector !== END_OF_CHAIN; sector = next(sector), guard += 1) {
      if (guard > source.length) throw new Error('a sector chain loops');
      if (offset(sector) + size > source.length) throw new Error(`sector ${String(sector)} is past the end of the file`);
      pieces.push(source.subarray(offset(sector), offset(sector) + size));
    }
    return Buffer.concat(pieces);
  };
  const stream = (/** @type {number} */ start) => chain(file, start, fat, sectorSize, sectorAt);

  const directory = stream(file.readUInt32LE(0x30));
  /** @type {{ name: string, type: number, start: number, size: number }[]} */
  const entries = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameBytes = directory.readUInt16LE(at + 0x40);
    entries.push({
      name: directory.toString('utf16le', at, at + Math.max(0, nameBytes - 2)),
      type: directory[at + 0x42] ?? 0,
      start: directory.readUInt32LE(at + 0x74),
      size: directory.readUInt32LE(at + 0x78),
    });
  }
  const root = entries.find((entry) => entry.type === 5);
  const book = entries.find((entry) => entry.type === 2 && (entry.name === 'Workbook' || entry.name === 'Book'));
  if (root === undefined || book === undefined) throw new Error('the file names no Workbook stream');

  // A STREAM UNDER THE CUTOFF lives in the mini stream (the root entry's own stream), chained by the mini FAT.
  let workbook;
  if (book.size >= cutoff) {
    workbook = stream(book.start).subarray(0, book.size);
  } else {
    const miniStream = stream(root.start);
    const miniFat = stream(file.readUInt32LE(0x3c));
    workbook = chain(miniStream, book.start, (sector) => miniFat.readUInt32LE(sector * 4), miniSectorSize, (sector) => sector * miniSectorSize).subarray(
      0,
      book.size,
    );
  }

  /** @type {{ name: string, visible: boolean }[]} */
  const sheets = [];
  for (let at = 0; at + 4 <= workbook.length; ) {
    const type = workbook.readUInt16LE(at);
    const length = workbook.readUInt16LE(at + 2);
    const data = workbook.subarray(at + 4, at + 4 + length);
    if (type === EOF) break;
    if (type === BOUNDSHEET && data.length >= 8) {
      const characters = data[6] ?? 0;
      const wide = ((data[7] ?? 0) & 1) === 1;
      const name = wide ? data.toString('utf16le', 8, 8 + characters * 2) : data.toString('latin1', 8, 8 + characters);
      sheets.push({ name, visible: ((data[4] ?? 0) & 3) === 0 });
    }
    at += 4 + length;
  }
  if (sheets.length === 0) throw new Error('the workbook lists no sheet: the read saw nothing, which is not an answer');
  return sheets;
}

/**
 * How many sheets of the workbook a person sees.
 *
 * @param {Uint8Array} bytes
 */
export function visibleSheetCount(bytes) {
  return xlsSheets(bytes).filter((sheet) => sheet.visible).length;
}
