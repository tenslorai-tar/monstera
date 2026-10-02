// @ts-check
/**
 * A PE image's headers, data directories and section map — the layer every question about a Windows binary here
 * starts from.
 *
 * ## Why this is its own module
 *
 * The walk from `e_lfanew` to a data directory and from an RVA to a file offset is one rule from the PE format
 * specification, and every reader here needs it before it can ask its own question. It lived inside
 * `peExports.mjs`; a second reader — the icon resources — would otherwise have re-derived it, and a partial copy is
 * the dangerous shape because it agrees with the first one on every file anybody tried (B3a).
 * `peHardening.mjs` still carries its own walk, whose lookup answers *absent* where this one throws; the two have
 * not been joined, because that would change what the hardening proof reports about a directory in no section.
 *
 * ## The format, in the order this reads it
 *
 * `e_lfanew` at 0x3C gives the PE signature; the COFF header follows it; the optional header follows that and its
 * magic separates PE32 from PE32+, which differ by 16 bytes before the data directories. Directories are addressed
 * by RVA, so the section headers are read to map one to a file offset — a directory RVA read as a file offset lands in
 * the middle of arbitrary data and produces a plausible-looking answer.
 */

/**
 * A parsed section header, enough to map an RVA to a file offset.
 *
 * @typedef {{ virtualAddress: number, virtualSize: number, rawAddress: number }} Section
 */

/**
 * @typedef {object} PeLayout
 * @property {boolean} plus whether the image is PE32+
 * @property {readonly Section[]} sections
 * @property {(index: number) => { rva: number, size: number }} directory data directory `index`
 * @property {(rva: number) => number} fileOffset where an RVA lives in the file; throws for one in no section
 */

/**
 * The layout of a PE image.
 *
 * @param {Buffer} bytes the whole file
 * @returns {PeLayout}
 */
export function peLayout(bytes) {
  if (bytes.length < 0x40 || bytes.readUInt16LE(0) !== 0x5a4d) {
    throw new Error('not a PE file: no MZ signature');
  }
  const peAt = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(peAt) !== 0x00004550) {
    throw new Error(`no PE signature at 0x${peAt.toString(16)}`);
  }

  const coffAt = peAt + 4;
  const sectionCount = bytes.readUInt16LE(coffAt + 2);
  const optionalSize = bytes.readUInt16LE(coffAt + 16);
  const optionalAt = coffAt + 20;

  const magic = bytes.readUInt16LE(optionalAt);
  // PE32+ carries an 8-byte ImageBase where PE32 carries 4 plus a 4-byte
  // BaseOfData, so the data directories start 16 bytes later.
  const plus = magic === 0x20b;
  if (!plus && magic !== 0x10b) {
    throw new Error(`unknown optional header magic 0x${magic.toString(16)}`);
  }
  const directoriesAt = optionalAt + (plus ? 112 : 96);
  const directoryCount = bytes.readUInt32LE(directoriesAt - 4);

  const sectionsAt = optionalAt + optionalSize;
  /** @type {Section[]} */
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const at = sectionsAt + index * 40;
    sections.push({
      virtualSize: bytes.readUInt32LE(at + 8),
      virtualAddress: bytes.readUInt32LE(at + 12),
      rawAddress: bytes.readUInt32LE(at + 20),
    });
  }

  return {
    plus,
    sections,
    directory(index) {
      if (index >= directoryCount) return { rva: 0, size: 0 };
      const at = directoriesAt + index * 8;
      return { rva: bytes.readUInt32LE(at), size: bytes.readUInt32LE(at + 4) };
    },
    fileOffset(rva) {
      for (const section of sections) {
        if (rva >= section.virtualAddress && rva < section.virtualAddress + section.virtualSize) {
          return section.rawAddress + (rva - section.virtualAddress);
        }
      }
      throw new Error(
        `RVA 0x${rva.toString(16)} lies in no section, so the structure it addresses cannot be located — ` +
          'which means the parse is wrong rather than the file lacking that structure',
      );
    },
  };
}
