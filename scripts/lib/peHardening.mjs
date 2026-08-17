// @ts-check
/**
 * Reads the exploit mitigations actually present in a PE image.
 *
 * The point is that a mitigation requested in a project file and a mitigation
 * present in the binary are different facts. A flag can be silently dropped: by
 * a toolchain upgrade, by a linker that rejects it for the target architecture
 * (/SAFESEH does exactly this on x64), or by an option later in the command line
 * overriding an earlier one. Reading the image is the only statement about the
 * artefact rather than about the intent.
 *
 * The header is parsed here rather than shelled out to `dumpbin` for two
 * reasons: dumpbin lives in the MSVC bin directory and is not on PATH unless
 * vcvars ran, which this project deliberately never does; and its `/headers`
 * argument is rewritten into a filesystem path by MSYS, which turns the check
 * into a shell-quoting problem on the exact platform it must run on.
 *
 * Layout, from the PE format specification:
 *   0x3C            → e_lfanew, the offset of the PE signature
 *   +0              → "PE\0\0"
 *   +4              → COFF header, 20 bytes
 *   +24             → optional header; magic 0x20B marks PE32+
 *   optional + 0x46 → DllCharacteristics (PE32+)
 */

import { readFileSync } from 'node:fs';

/** DllCharacteristics bits that carry a mitigation. */
export const DLL_CHARACTERISTICS = {
  HIGH_ENTROPY_VA: 0x0020,
  DYNAMIC_BASE: 0x0040,
  NX_COMPAT: 0x0100,
  GUARD_CF: 0x4000,
};

/**
 * @param {string} path
 * @returns {{
 *   pe32Plus: boolean,
 *   dllCharacteristics: number,
 *   mitigations: Record<string, boolean>,
 *   stackCookie: boolean,
 *   cetCompat: boolean,
 * }}
 */
export function readPeHardening(path) {
  const image = readFileSync(path);

  if (image.length < 0x40 || image.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${path} does not begin with an MZ header; it is not a PE image.`);
  }

  const peOffset = image.readUInt32LE(0x3c);
  if (image.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(`${path} has no PE signature at offset ${peOffset}.`);
  }

  const optionalHeader = peOffset + 24;
  const magic = image.readUInt16LE(optionalHeader);
  const pe32Plus = magic === 0x20b;
  if (!pe32Plus) {
    throw new Error(
      `${path} is not PE32+ (magic 0x${magic.toString(16)}). This project builds x64 only, so a ` +
        `32-bit image here means the build targeted the wrong architecture.`,
    );
  }

  const dllCharacteristics = image.readUInt16LE(optionalHeader + 0x46);

  /** @type {Record<string, boolean>} */
  const mitigations = {};
  for (const [name, bit] of Object.entries(DLL_CHARACTERISTICS)) {
    mitigations[name] = (dllCharacteristics & bit) !== 0;
  }

  // DllCharacteristics carries FOUR mitigations and no more. /GS and /CETCOMPAT
  // live elsewhere entirely, and a proof that read only this word while its
  // commit message claimed both would be exactly the over-broad green check this
  // project keeps finding. They are read from their real locations below.
  // PE32+ data directory starts at optional-header + 0x70, immediately after
  // NumberOfRvaAndSizes. The first version of this added a further 8 and read
  // the wrong entries — it reported /GS absent from ntdll.dll, which is how the
  // error was caught: the reader was resolution-tested against binaries known to
  // carry these mitigations before any conclusion was drawn from it.
  const dataDirectory = optionalHeader + 0x70;
  const sections = parseSections(image, peOffset);

  return {
    pe32Plus,
    dllCharacteristics,
    mitigations,
    // /GS: the linker emits a Load Config Directory whose SecurityCookie field
    // points at the cookie the prologue checks. A zero pointer means no cookie,
    // which means no stack protection regardless of what the project file asked.
    stackCookie: readSecurityCookie(image, dataDirectory, sections),
    // /CETCOMPAT: an Extended DLL Characteristics record in the DEBUG directory,
    // type 20, bit 0. Not in the header word at all.
    cetCompat: readCetCompat(image, dataDirectory, sections),
  };
}

/**
 * @param {Buffer} image
 * @param {number} peOffset
 * @returns {{ virtualAddress: number, size: number, pointerToRawData: number }[]}
 */
function parseSections(image, peOffset) {
  const sectionCount = image.readUInt16LE(peOffset + 6);
  const optionalSize = image.readUInt16LE(peOffset + 20);
  const table = peOffset + 24 + optionalSize;

  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const entry = table + index * 40;
    if (entry + 40 > image.length) break;
    sections.push({
      virtualAddress: image.readUInt32LE(entry + 12),
      size: image.readUInt32LE(entry + 8),
      pointerToRawData: image.readUInt32LE(entry + 20),
    });
  }
  return sections;
}

/**
 * Relative virtual address → file offset. A data directory entry addresses the
 * loaded image, not the file on disk, and the two differ by the section layout.
 *
 * @param {number} rva
 * @param {{virtualAddress: number, size: number, pointerToRawData: number}[]} sections
 * @returns {number} -1 when the RVA falls in no section.
 */
function rvaToOffset(rva, sections) {
  for (const section of sections) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + Math.max(section.size, 1)) {
      return section.pointerToRawData + (rva - section.virtualAddress);
    }
  }
  return -1;
}

/**
 * @param {Buffer} image
 * @param {number} dataDirectory
 * @param {{virtualAddress: number, size: number, pointerToRawData: number}[]} sections
 * @returns {boolean}
 */
function readSecurityCookie(image, dataDirectory, sections) {
  // Entry 10 is the Load Config Directory.
  const rva = image.readUInt32LE(dataDirectory + 10 * 8);
  if (rva === 0) return false;
  const at = rvaToOffset(rva, sections);
  if (at < 0 || at + 0x60 > image.length) return false;

  const size = image.readUInt32LE(at);
  // SecurityCookie sits at offset 0x58 in the PE32+ load config.
  if (size < 0x60) return false;
  return image.readBigUInt64LE(at + 0x58) !== 0n;
}

/**
 * @param {Buffer} image
 * @param {number} dataDirectory
 * @param {{virtualAddress: number, size: number, pointerToRawData: number}[]} sections
 * @returns {boolean}
 */
function readCetCompat(image, dataDirectory, sections) {
  // Entry 6 is the Debug Directory: an array of 28-byte records.
  const rva = image.readUInt32LE(dataDirectory + 6 * 8);
  const size = image.readUInt32LE(dataDirectory + 6 * 8 + 4);
  if (rva === 0 || size === 0) return false;

  const at = rvaToOffset(rva, sections);
  if (at < 0) return false;

  for (let offset = 0; offset + 28 <= size; offset += 28) {
    const record = at + offset;
    if (record + 28 > image.length) break;
    const type = image.readUInt32LE(record + 12);
    if (type !== 20) continue; // IMAGE_DEBUG_TYPE_EX_DLLCHARACTERISTICS

    const dataSize = image.readUInt32LE(record + 16);
    const dataOffset = image.readUInt32LE(record + 24);
    if (dataSize < 2 || dataOffset + 2 > image.length) return false;
    return (image.readUInt16LE(dataOffset) & 0x0001) !== 0; // CET_COMPAT
  }
  return false;
}
