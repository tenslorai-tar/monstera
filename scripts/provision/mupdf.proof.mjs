// @ts-check
/**
 * Proof that the shim's export check can fail (rule B2).
 *
 * The bug it guards against is a build that quietly did not happen. MSBuild is
 * incremental, an error in one project does not always stop the run, and a DLL
 * from an earlier successful build sits at the same path — so "the file exists"
 * and even "the file loads" are both true of output that no longer matches the
 * source. This repository has already been bitten by the same shape once from
 * the other direction: a mutation left `npm test` green because the tests
 * resolved through a stale `dist`.
 *
 * The control does not rebuild anything. It asks the real checker about a DLL
 * that is genuinely missing a symbol the source declares, which is exactly what
 * a skipped build leaves behind, and requires it to say so.
 *
 * Usage: node scripts/provision/mupdf.proof.mjs
 */

import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fileExists } from '../lib/fetchVerified.mjs';
import { readPeHardening } from '../lib/peHardening.mjs';
import { formatError } from '../lib/reportError.mjs';
import { shimLibraryPath, verifyExports } from './mupdf.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** @returns {string} */
function repoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.status !== 0) return resolve(HERE, '..', '..');
  return `${result.stdout}`.trim();
}

async function main() {
  const root = repoRoot();
  const dll = shimLibraryPath(root);

  if (process.platform !== 'win32') {
    process.stdout.write('  skip  the shim is Windows-only today (ADR-0010)\n');
    return 0;
  }

  if (!(await fileExists(dll))) {
    process.stderr.write(
      `\nNo shim at ${dll}.\n` +
        `Run:  node scripts/provision/mupdf.mjs\n\n` +
        `This proof checks the export verification, so it needs something to verify. ` +
        `It fails rather than skipping: a proof that quietly passes when its subject is ` +
        `absent is the green check that verifies nothing.\n\n`,
    );
    return 1;
  }

  /** @type {string[]} */
  const failures = [];

  // Case 1 — the real DLL verifies.
  try {
    const result = await verifyExports(root, dll);
    if (!result.verified) {
      failures.push(
        `the export table was not actually read (dumpbin unavailable), so case 2 would ` +
          `prove nothing either. Both cases depend on it.`,
      );
    }
  } catch (error) {
    failures.push(`the freshly built shim failed its own export check: ${String(error)}`);
  }

  // Case 2 — the control. A source that declares one more export than the DLL
  // carries is precisely the state a skipped build leaves, and it must be
  // rejected. The source is copied to a scratch tree and edited there; the
  // tracked file is never touched.
  const scratch = await mkdtemp(join(tmpdir(), 'monstera-shim-proof-'));
  try {
    const shimDirectory = join(scratch, 'native', 'mupdf-shim');
    await import('node:fs/promises').then((fs) => fs.mkdir(shimDirectory, { recursive: true }));

    const realSource = join(root, 'native', 'mupdf-shim', 'monstera_mupdf.c');
    const text = await readFile(realSource, 'utf8');
    await writeFile(
      join(shimDirectory, 'monstera_mupdf.c'),
      `${text}\nMZ_EXPORT int mz_proof_absent_symbol(void) { return 0; }\n`,
      'utf8',
    );

    // The DLL is the real one, unmodified — only the source claims more.
    const stagedDll = join(shimDirectory, 'out', 'monstera_mupdf.dll');
    await import('node:fs/promises').then((fs) =>
      fs.mkdir(dirname(stagedDll), { recursive: true }),
    );
    await copyFile(dll, stagedDll);

    let rejected = false;
    try {
      await verifyExports(scratch, stagedDll);
    } catch (error) {
      rejected = `${String(error)}`.includes('mz_proof_absent_symbol');
      if (!rejected) {
        failures.push(`the control was rejected, but for the wrong reason: ${String(error)}`);
      }
    }

    if (!rejected && failures.length === 0) {
      failures.push(
        `a DLL missing a declared export passed the check. THE EXPORT VERIFICATION IS ` +
          `VACUOUS — a build that silently did not run would report success.`,
      );
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  // Case 3 — the exploit mitigations are in the IMAGE, not merely in the
  // project file. This library parses the most attacker-controlled input the
  // application has, and a requested flag can be silently dropped: by a
  // toolchain upgrade, by a later option overriding an earlier one, or by the
  // linker refusing it for the target architecture. /SAFESEH was refused exactly
  // that way here (LNK1246, x86-only), which is the whole argument for reading
  // the artefact rather than trusting the request.
  const required = ['HIGH_ENTROPY_VA', 'DYNAMIC_BASE', 'NX_COMPAT', 'GUARD_CF'];
  try {
    const shim = readPeHardening(dll);
    const { mitigations, dllCharacteristics } = shim;
    const missing = required.filter((name) => mitigations[name] !== true);
    if (missing.length > 0) {
      failures.push(
        `the shim is missing ${missing.join(', ')} (DllCharacteristics ` +
          `0x${dllCharacteristics.toString(16)}). These are configured in monstera_mupdf.vcxproj, ` +
          `so a mismatch means the request did not reach the binary.`,
      );
    }

    // /GS and /CETCOMPAT are NOT in DllCharacteristics. The stack cookie lives in
    // the Load Config Directory and CET in a Debug Directory record of type 20,
    // so a proof reading only the header word would claim six mitigations while
    // checking four.
    if (!shim.stackCookie) {
      failures.push(`the shim has no stack cookie: /GS did not reach the binary.`);
    }
    if (!shim.cetCompat) {
      failures.push(`the shim is not CET-compatible: /CETCOMPAT did not reach the binary.`);
    }

    // RESOLUTION TEST, and it is not decoration. The first version of this reader
    // computed the data directory 8 bytes too far into the optional header and
    // reported /GS ABSENT FROM ntdll.dll. Had it only ever been pointed at our
    // own DLL, it would have "found" a mitigation gap that did not exist.
    // Windows system libraries are known to carry all three, so they are the
    // known-different input this instrument is measured against before it is
    // believed. Per CLAUDE.md stage-audit item 4a.
    for (const reference of ['C:/Windows/System32/ntdll.dll', 'C:/Windows/System32/kernel32.dll']) {
      try {
        const known = readPeHardening(reference);
        if (!known.stackCookie || !known.cetCompat || !known.mitigations['GUARD_CF']) {
          failures.push(
            `the PE reader reports ${reference} as lacking ` +
              `${[!known.stackCookie && '/GS', !known.cetCompat && 'CET', !known.mitigations['GUARD_CF'] && 'CFG'].filter(Boolean).join(', ')}. ` +
              `A Windows system library carries all three, so THE READER IS WRONG and every ` +
              `verdict it gives about our own binary is worthless.`,
          );
        }
      } catch {
        // Absent on a non-Windows runner; the shim cases above already skipped.
      }
    }

    // Case 4 — the control. Clearing the bits in a copy must be detected;
    // otherwise case 3 proves only that the reader returns something.
    const scratch = await mkdtemp(join(tmpdir(), 'monstera-pe-'));
    try {
      const stripped = join(scratch, 'stripped.dll');
      await copyFile(dll, stripped);
      const image = await readFile(stripped);
      const peOffset = image.readUInt32LE(0x3c);
      const at = peOffset + 24 + 0x46;
      image.writeUInt16LE(image.readUInt16LE(at) & ~0x4160, at);
      await writeFile(stripped, image);

      const after = readPeHardening(stripped).mitigations;
      const stillReported = required.filter((name) => after[name] === true);
      if (stillReported.length > 0) {
        failures.push(
          `after clearing every mitigation bit, the reader still reports ` +
            `${stillReported.join(', ')} as present. THE HARDENING CHECK IS VACUOUS.`,
        );
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } catch (error) {
    failures.push(`could not read the shim's PE header: ${String(error)}`);
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} shim proof failure(s):\n\n${failures.join('\n\n')}\n\n`);
    return 1;
  }

  process.stdout.write('  ok  the built shim exports every MZ_EXPORT symbol its source declares\n');
  process.stdout.write('  ok  a DLL missing a declared export is rejected\n');
  process.stdout.write(`  ok  the image carries ${required.join(', ')}\n`);
  process.stdout.write('  ok  the image carries /GS (stack cookie) and CET compatibility\n');
  process.stdout.write('  ok  the PE reader reports those same three present in ntdll.dll\n');
  process.stdout.write('  ok  clearing the DllCharacteristics bits is detected\n');
  process.stdout.write('\n6 shim cases passed.\n');
  return 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`\n${formatError(error)}\n`);
    process.exit(1);
  },
);
