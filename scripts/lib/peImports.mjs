// @ts-check
/**
 * The DLLs a PE image names in its import tables: the ones the loader must find before the image runs, and the ones
 * it loads on first call.
 *
 * ## Two tables, two consequences
 *
 * - **Directory 1, the import table.** Every DLL named here is resolved when the image loads; one that is not found
 *   fails the load with `STATUS_DLL_NOT_FOUND` (0xC0000135) for an executable, or `ERROR_MOD_NOT_FOUND` for a
 *   library — the shape of x2t's exit and of the MuPDF host's `koffi.load` failure on a PC with no VC++ runtime.
 * - **Directory 13, the delay-load table.** A DLL named here is loaded on the first call into it, so its absence is
 *   survivable when the program checks first. Media Foundation is the case that matters: `Monstera.exe` delay-loads
 *   it, and Windows N editions do not have it.
 *
 * Each IMAGE_IMPORT_DESCRIPTOR is 20 bytes with the name's RVA at offset 12; each IMAGE_DELAYLOAD_DESCRIPTOR is 32
 * bytes with the name at offset 4, an RVA when bit 0 of its attributes is set and a VA otherwise (the pre-VC7 form).
 * Both tables end at an all-zero entry.
 */

import { peLayout } from './peImage.mjs';

/**
 * @typedef {{ readonly imports: readonly string[], readonly delayed: readonly string[] }} PeImports
 *   DLL names as the image spells them, in table order
 */

/**
 * @param {Buffer} bytes
 * @param {number} at
 */
function cString(bytes, at) {
  const end = bytes.indexOf(0, at);
  if (end < 0) throw new Error(`a DLL name at 0x${at.toString(16)} is not terminated, so the table is misread`);
  return bytes.toString('latin1', at, end);
}

/**
 * The DLLs `bytes` names in its import and delay-load tables.
 *
 * @param {Buffer} bytes the whole file
 * @returns {PeImports}
 */
export function peImports(bytes) {
  const layout = peLayout(bytes);

  /** @type {string[]} */
  const imports = [];
  const table = layout.directory(1);
  if (table.rva !== 0) {
    for (let at = layout.fileOffset(table.rva); ; at += 20) {
      const nameRva = bytes.readUInt32LE(at + 12);
      const firstThunk = bytes.readUInt32LE(at + 16);
      if (nameRva === 0 && firstThunk === 0) break;
      imports.push(cString(bytes, layout.fileOffset(nameRva)));
    }
  }

  /** @type {string[]} */
  const delayed = [];
  const delay = layout.directory(13);
  if (delay.rva !== 0) {
    for (let at = layout.fileOffset(delay.rva); ; at += 32) {
      const attributes = bytes.readUInt32LE(at);
      const name = bytes.readUInt32LE(at + 4);
      if (name === 0) break;
      const nameRva = (attributes & 1) === 1 ? name : name - layout.imageBase;
      delayed.push(cString(bytes, layout.fileOffset(nameRva)));
    }
  }

  return { imports, delayed };
}
