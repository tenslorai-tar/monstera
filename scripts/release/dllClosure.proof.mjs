// @ts-check
/**
 * Proof that a package whose programs import a DLL a user's PC lacks is repaired, or not built (rule B2).
 *
 * The fixtures are PE32+ images built here byte by byte, carrying exactly the import and delay-load tables a case
 * needs, so the proof runs on any runner and names the bytes it reads. The reader they go through is the one the
 * packaging step takes (`peImports.mjs`); its own cases read a table back name for name before anything is asked of
 * the resolution rule, because a reader that saw nothing would make every case below pass.
 *
 * The two controls the owner's decision names are the load-bearing cases:
 * - a runtime DLL removed from beside x2t is RESTORED by provisioning, and the package builds;
 * - with the pinned source unavailable, packaging STOPS and names the program, the DLL and the command.
 *
 * Usage: node scripts/release/dllClosure.proof.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRoster } from '../lib/passRoster.mjs';
import { peImports } from '../lib/peImports.mjs';
import { RUNTIMES, missingDlls, repairThenRefuse } from './dllClosure.mjs';

/**
 * A PE32+ image with one section holding the import and delay-load descriptors and the names they point at.
 *
 * @param {{ imports?: readonly string[], delayed?: readonly string[], vaDelay?: boolean }} tables
 * @returns {Buffer}
 */
export function syntheticPe({ imports = [], delayed = [], vaDelay = false }) {
  // THE VA FORM IS 32 BITS WIDE, so an image using it has a base below 4 GiB; the PE32+ default does not fit in it.
  const IMAGE_BASE = vaDelay ? 0x400000 : 0x140000000;
  const SECTION_RVA = 0x1000;
  const SECTION_RAW = 0x400;
  const peAt = 0x80;
  const optionalSize = 240;
  const sectionHeaderAt = peAt + 4 + 20 + optionalSize;
  const section = Buffer.alloc(0x1000);
  // Layout inside the section: import descriptors, a zero entry, delay descriptors, a zero entry, then the names.
  const importAt = 0;
  const delayAt = (imports.length + 1) * 20;
  let nameAt = delayAt + (delayed.length + 1) * 32;
  const writeName = (/** @type {string} */ name) => {
    const rva = SECTION_RVA + nameAt;
    section.write(`${name}\0`, nameAt, 'latin1');
    nameAt += name.length + 1;
    return rva;
  };
  imports.forEach((name, index) => {
    const at = importAt + index * 20;
    section.writeUInt32LE(writeName(name), at + 12);
    section.writeUInt32LE(SECTION_RVA + 0x800, at + 16);
  });
  delayed.forEach((name, index) => {
    const at = delayAt + index * 32;
    const rva = writeName(name);
    section.writeUInt32LE(vaDelay ? 0 : 1, at);
    section.writeUInt32LE(vaDelay ? rva + IMAGE_BASE : rva, at + 4);
  });

  const bytes = Buffer.alloc(SECTION_RAW + section.length);
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(peAt, 0x3c);
  bytes.writeUInt32LE(0x00004550, peAt);
  bytes.writeUInt16LE(0x8664, peAt + 4);
  bytes.writeUInt16LE(1, peAt + 6);
  bytes.writeUInt16LE(optionalSize, peAt + 20);
  const optionalAt = peAt + 24;
  bytes.writeUInt16LE(0x20b, optionalAt);
  bytes.writeBigUInt64LE(BigInt(IMAGE_BASE), optionalAt + 24);
  bytes.writeUInt32LE(16, optionalAt + 108);
  const directory = (/** @type {number} */ index, /** @type {number} */ rva, /** @type {number} */ size) => {
    bytes.writeUInt32LE(rva, optionalAt + 112 + index * 8);
    bytes.writeUInt32LE(size, optionalAt + 112 + index * 8 + 4);
  };
  if (imports.length > 0) directory(1, SECTION_RVA + importAt, (imports.length + 1) * 20);
  if (delayed.length > 0) directory(13, SECTION_RVA + delayAt, (delayed.length + 1) * 32);
  bytes.write('.idata\0\0', sectionHeaderAt, 'latin1');
  bytes.writeUInt32LE(section.length, sectionHeaderAt + 8);
  bytes.writeUInt32LE(SECTION_RVA, sectionHeaderAt + 12);
  bytes.writeUInt32LE(section.length, sectionHeaderAt + 16);
  bytes.writeUInt32LE(SECTION_RAW, sectionHeaderAt + 20);
  section.copy(bytes, SECTION_RAW);
  return bytes;
}

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 15 });
const workspace = mkdtempSync(join(tmpdir(), 'monstera-dllclosure-'));

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * A stage: `Monstera.exe` at its root, and the files given, each a PE built from its tables or plain bytes.
 *
 * @param {Record<string, { imports?: string[], delayed?: string[] } | string>} files
 */
function stageWith(files) {
  const stage = mkdtempSync(join(workspace, 'stage-'));
  const all = { 'Monstera.exe': { imports: ['KERNEL32.dll', 'USER32.dll'], delayed: ['MF.dll'] }, ...files };
  for (const [path, content] of Object.entries(all)) {
    const to = join(stage, ...path.split('/'));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, typeof content === 'string' ? content : syntheticPe(content));
  }
  return stage;
}

const RUNTIME =
  RUNTIMES[0] ??
  (() => {
    throw new Error('dllClosure.mjs declares no runtime, so nothing here can be repaired.');
  })();

/** A provisioned runtime folder holding bytes whose digests are the pins — a fake runtime, pinned by this proof. */
function fakeRuntime() {
  const folder = mkdtempSync(join(workspace, 'runtime-'));
  /** @type {Record<string, string>} */
  const pins = {};
  for (const name of Object.keys(RUNTIME.pins)) {
    // A MODULE, since once placed it is read like every other; the name appended makes each digest its own.
    const bytes = Buffer.concat([syntheticPe({ imports: ['KERNEL32.dll'] }), Buffer.from(name)]);
    writeFileSync(join(folder, name), bytes);
    pins[name] = createHash('sha256').update(bytes).digest('hex');
  }
  return { folder, runtime: { ...RUNTIME, pins } };
}

const X2T = { imports: ['graphics.dll', 'MSVCP140.dll', 'VCRUNTIME140.dll', 'VCRUNTIME140_1.dll', 'KERNEL32.dll'] };

try {
  // ---------------------------------------------------------------- the reader sees, and reads both tables
  const read = peImports(syntheticPe({ imports: ['KERNEL32.dll', 'MSVCP140.dll'], delayed: ['MF.dll'] }));
  check(
    'the reader reads every import table name, in order',
    JSON.stringify(read.imports) === JSON.stringify(['KERNEL32.dll', 'MSVCP140.dll']),
    `read ${JSON.stringify(read.imports)}`,
  );
  check('the reader reads the delay-load table', JSON.stringify(read.delayed) === JSON.stringify(['MF.dll']), `read ${JSON.stringify(read.delayed)}`);
  const va = peImports(syntheticPe({ delayed: ['old.dll'], vaDelay: true }));
  check('a delay descriptor addressed by VA is read relative to the image base', va.delayed[0] === 'old.dll', `read ${JSON.stringify(va.delayed)}`);

  // ---------------------------------------------------------------- the resolution rule
  const bare = stageWith({ 'resources/native/onlyoffice/x2t.exe': X2T, 'resources/native/onlyoffice/graphics.dll': { imports: ['MSVCP140.dll'] } });
  const bareMissing = missingDlls(bare).map((entry) => `${entry.program}:${entry.dll.toLowerCase()}`).sort();
  check(
    'x2t without the runtime beside it is reported, for itself and for its DLL',
    JSON.stringify(bareMissing) ===
      JSON.stringify([
        'resources/native/onlyoffice/graphics.dll:msvcp140.dll',
        'resources/native/onlyoffice/x2t.exe:msvcp140.dll',
        'resources/native/onlyoffice/x2t.exe:vcruntime140.dll',
        'resources/native/onlyoffice/x2t.exe:vcruntime140_1.dll',
      ]),
    `reported ${JSON.stringify(bareMissing)}`,
  );

  const rootDoesNotAnswerX2t = stageWith({
    'msvcp140.dll': { imports: ['KERNEL32.dll'] },
    'resources/native/onlyoffice/x2t.exe': { imports: ['MSVCP140.dll'] },
  });
  check(
    "the package root does not answer for a program in its own folder: x2t's application directory is its own",
    missingDlls(rootDoesNotAnswerX2t).some((entry) => entry.program.endsWith('x2t.exe')),
    'the root answered, which is not where Windows looks for x2t',
  );

  const rootAnswersShim = stageWith({
    'msvcp140.dll': { imports: ['KERNEL32.dll'] },
    'resources/native/mupdf-shim/monstera_mupdf.dll': { imports: ['MSVCP140.dll', 'KERNEL32.dll'] },
  });
  check(
    "the package root answers for a library Monstera.exe loads, since it is that process's application directory",
    missingDlls(rootAnswersShim).length === 0,
    `reported ${JSON.stringify(missingDlls(rootAnswersShim))}`,
  );

  const mfImported = stageWith({ 'resources/native/camera.dll': { imports: ['MFPlat.DLL'] } });
  check(
    'Media Foundation imported outright is refused — an N edition has none, and nothing could check first',
    missingDlls(mfImported).some((entry) => entry.dll === 'MFPlat.DLL' && !entry.delayed),
    `reported ${JSON.stringify(missingDlls(mfImported))}`,
  );
  check(
    'Media Foundation delay-loaded is accepted (Monstera.exe in every stage here delay-loads MF.dll)',
    !missingDlls(mfImported).some((entry) => entry.program === 'Monstera.exe'),
    `reported ${JSON.stringify(missingDlls(mfImported))}`,
  );

  const addon = stageWith({ 'resources/app/node_modules/koffi/koffi.node': { imports: ['KERNEL32.dll'], delayed: ['NODE.EXE'] } });
  check("a .node's delay-loaded node.exe is the host process and resolves", missingDlls(addon).length === 0, `reported ${JSON.stringify(missingDlls(addon))}`);
  const notAddon = stageWith({ 'resources/native/x.dll': { delayed: ['NODE.EXE'] } });
  check('node.exe from a module that is not an addon is not excused', missingDlls(notAddon).length === 1, `reported ${JSON.stringify(missingDlls(notAddon))}`);

  const blind = stageWith({ 'Monstera.exe': { imports: ['USER32.dll'] } });
  let blindRefused = false;
  try {
    missingDlls(blind);
  } catch (error) {
    blindRefused = error instanceof Error && error.message.includes('cannot see');
  }
  check(
    'the check refuses to report when it cannot find KERNEL32 among the program’s own imports — its positive control',
    blindRefused,
    'a reader that saw the wrong table answered "nothing missing"',
  );

  const unknown = stageWith({ 'resources/native/x.dll': { imports: ['madeup.dll'] } });
  check('a DLL no rule names is reported, not assumed to be Windows', missingDlls(unknown).length === 1, `reported ${JSON.stringify(missingDlls(unknown))}`);

  // ---------------------------------------------------------------- repair, then refuse: the owner's two controls
  const { folder, runtime } = fakeRuntime();
  const repairable = stageWith({ 'resources/native/onlyoffice/x2t.exe': X2T, 'resources/native/onlyoffice/graphics.dll': { imports: ['MSVCP140.dll'] } });
  const runtimes = [runtime];
  {
    {
      const { placed } = await repairThenRefuse({ stage: repairable, provide: async () => folder, runtimes });
      check(
        'CONTROL: a runtime DLL missing beside x2t is provisioned and placed, and the package builds',
        JSON.stringify([...placed].sort()) ===
          JSON.stringify([
            'resources/native/onlyoffice/msvcp140.dll',
            'resources/native/onlyoffice/vcruntime140.dll',
            'resources/native/onlyoffice/vcruntime140_1.dll',
          ]) && missingDlls(repairable).length === 0,
        `placed ${JSON.stringify(placed)}; still missing ${JSON.stringify(missingDlls(repairable))}`,
      );

      const unavailable = stageWith({ 'resources/native/onlyoffice/x2t.exe': X2T });
      /** @type {string} */
      let refusal = '';
      try {
        await repairThenRefuse({ stage: unavailable, provide: async () => null, runtimes });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      check(
        'CONTROL: with the pinned source unavailable, packaging stops and names the program, the DLL and the command',
        refusal.includes('resources/native/onlyoffice/x2t.exe') &&
          refusal.includes('VCRUNTIME140_1.dll') &&
          refusal.includes(RUNTIME.command) &&
          !existsSync(join(unavailable, 'resources', 'native', 'onlyoffice', 'msvcp140.dll')),
        `refused with: ${refusal || '(nothing — it built)'}`,
      );

      writeFileSync(join(folder, 'msvcp140.dll'), 'bytes nobody pinned');
      const tampered = stageWith({ 'resources/native/onlyoffice/x2t.exe': X2T });
      let tamperRefused = false;
      try {
        await repairThenRefuse({ stage: tampered, provide: async () => folder, runtimes });
      } catch {
        tamperRefused = true;
      }
      check(
        'a provided file that is not as pinned is never placed',
        tamperRefused && !existsSync(join(tampered, 'resources', 'native', 'onlyoffice', 'msvcp140.dll')) &&
          readFileSync(join(folder, 'msvcp140.dll'), 'utf8') === 'bytes nobody pinned',
        'an unpinned byte was placed beside a program',
      );
    }
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`\nDLL-closure proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
  process.exit(1);
}
process.stdout.write(roster.format('DLL-closure case'));
