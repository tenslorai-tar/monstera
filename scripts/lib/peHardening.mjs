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

import { peLayout } from './peImage.mjs';

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
  // THE ONE WALK (EEEEEEE-3, B3a): `peLayout` owns the signature, the directories and the RVA-to-offset rule, and an
  // RVA in no section THROWS there — a misparse, not a missing mitigation. This file's own lookup answered -1, which
  // read as "/GS did not reach the binary": a finding about the build where it was one about the reader.
  /** @type {import('./peImage.mjs').PeLayout} */
  let layout;
  try {
    layout = peLayout(image);
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  const peOffset = image.readUInt32LE(0x3c);
  const optionalHeader = peOffset + 24;
  const pe32Plus = layout.plus;
  if (!pe32Plus) {
    throw new Error(
      `${path} is not PE32+ (magic 0x${image.readUInt16LE(optionalHeader).toString(16)}). This project builds x64 only, so a ` +
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
  return {
    pe32Plus,
    dllCharacteristics,
    mitigations,
    // /GS: the linker emits a Load Config Directory whose SecurityCookie field
    // points at the cookie the prologue checks. A zero pointer means no cookie,
    // which means no stack protection regardless of what the project file asked.
    stackCookie: readSecurityCookie(image, layout),
    // /CETCOMPAT: an Extended DLL Characteristics record in the DEBUG directory,
    // type 20, bit 0. Not in the header word at all.
    cetCompat: readCetCompat(image, layout),
  };
}

/**
 * @param {Buffer} image
 * @param {import('./peImage.mjs').PeLayout} layout
 * @returns {boolean}
 */
function readSecurityCookie(image, layout) {
  // Entry 10 is the Load Config Directory.
  const { rva } = layout.directory(10);
  if (rva === 0) return false;
  const at = layout.fileOffset(rva);
  if (at + 0x60 > image.length) return false;

  const size = image.readUInt32LE(at);
  // SecurityCookie sits at offset 0x58 in the PE32+ load config.
  if (size < 0x60) return false;
  return image.readBigUInt64LE(at + 0x58) !== 0n;
}

/**
 * @param {Buffer} image
 * @param {import('./peImage.mjs').PeLayout} layout
 * @returns {boolean}
 */
function readCetCompat(image, layout) {
  // Entry 6 is the Debug Directory: an array of 28-byte records.
  const { rva, size } = layout.directory(6);
  if (rva === 0 || size === 0) return false;

  const at = layout.fileOffset(rva);

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
