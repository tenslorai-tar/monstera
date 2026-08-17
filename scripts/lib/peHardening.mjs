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
 * @returns {{ pe32Plus: boolean, dllCharacteristics: number, mitigations: Record<string, boolean> }}
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

  return { pe32Plus, dllCharacteristics, mitigations };
}
