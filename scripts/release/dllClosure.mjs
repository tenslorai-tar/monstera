// @ts-check
/**
 * Every DLL a shipped `.exe`, `.dll` or `.node` imports resolves on a user's PC, or there is no package.
 *
 * ## The class this closes
 *
 * 0.1.15.0 shipped the MuPDF shim and ONLYOFFICE's x2t without the Visual C++ runtime both import, and worked only on
 * a PC that happened to have one. No check read an import table, so "it opens on the owner's PC" stood in for "its
 * imports resolve". This reads every table (`peImports.mjs`) and asks Windows' own question of each name.
 *
 * ## Where Windows looks, as this check models it
 *
 * - **The program's own folder.** For an `.exe`, its folder is the application directory, first in the search order.
 *   For a library loaded by full path — the shim by `loadEngineLibrary`, which loads with
 *   `LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR`, and a `.node` by libuv's `LOAD_WITH_ALTERED_SEARCH_PATH` — its own folder.
 * - **The package root**, which is the application directory of every process `Monstera.exe` runs: main, the
 *   renderers and the engine hosts. It answers only for a module such a process loads, so never for one in a folder
 *   that holds its own program (x2t's, Ghostscript's, Poppler's): that program is the application there.
 * - **Windows itself**: the API sets (`api-ms-win-*`, which include the universal CRT on Windows 10) and the
 *   {@link SYSTEM_DLLS} below.
 * - **Delay-loaded only**: {@link DELAY_ONLY}, DLLs some editions lack — Media Foundation on N and KN editions — which a
 *   program may name only in its delay-load table, where it is loaded on first use and its absence can be met.
 *
 * ## It repairs before it refuses (the owner's decision, 2026-10-14)
 *
 * A name a pinned runtime supplies ({@link RUNTIMES}) is provisioned — pinned, hash-verified, ADR-0053's download rule
 * — and placed beside the program that imports it. Only a name still unresolved after that stops the package, and the
 * refusal names the program, the DLL and the command or pin to add. Nothing unpinned is ever fetched.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { peImports } from '../lib/peImports.mjs';
import { VC14_RUNTIME, VC14_RUNTIME_BIN } from '../provision/condaForge.mjs';
import { VC_RUNTIME_COMMAND, provisionVcRuntime } from '../provision/vcRuntime.mjs';

/**
 * The DLLs every Windows 10 1809+ desktop PC has in `System32`, beyond the API sets.
 *
 * Two groups. KnownDLLs is the registry list Windows maps at boot (`HKLM\SYSTEM\CurrentControlSet\Control\Session
 * Manager\KnownDLLs`), recalled rather than read, since this was written on Linux. The rest are every other system DLL
 * the shipped binaries were MEASURED to import on 2026-10-14 (`peImports` over Electron 43.7.7's win32-x64 zip,
 * Document Builder 9.4.0's archive, pdfium-win-x64 chromium/8044 and koffi 3.1.5's win32-x64 build). A new name is not
 * in this list by default: it stops the package until someone adds it here with its reason, which is the point.
 * `scripts/research/systemDlls.mjs` reads the KnownDLLs key and `System32` on a Windows machine and reports any name
 * here that is not there — the measurement the recalled half owes.
 */
export const SYSTEM_DLLS = Object.freeze(
  new Set([
    // KnownDLLs, Windows 10 1809 x64, and ntdll, which every process has mapped before its first instruction.
    'ntdll.dll', 'advapi32.dll', 'clbcatq.dll', 'combase.dll', 'comdlg32.dll', 'coml2.dll', 'difxapi.dll', 'gdi32.dll',
    'gdiplus.dll', 'imagehlp.dll', 'imm32.dll', 'kernel32.dll', 'msctf.dll', 'msvcrt.dll', 'normaliz.dll', 'nsi.dll',
    'ole32.dll', 'oleaut32.dll', 'psapi.dll', 'rpcrt4.dll', 'sechost.dll', 'setupapi.dll', 'shcore.dll', 'shell32.dll',
    'shlwapi.dll', 'user32.dll', 'wldap32.dll', 'ws2_32.dll',
    // System32, measured as imported by the shipped binaries.
    'bcrypt.dll', 'bcryptprimitives.dll', 'bthprops.cpl', 'cfgmgr32.dll', 'comctl32.dll', 'crypt32.dll', 'cryptui.dll',
    'd3d11.dll', 'd3d12.dll', 'd3d9.dll', 'dbghelp.dll', 'dcomp.dll', 'dhcpcsvc.dll', 'dwmapi.dll', 'dwrite.dll',
    'dxgi.dll', 'hid.dll', 'iphlpapi.dll', 'mmdevapi.dll', 'ncrypt.dll', 'oleacc.dll', 'pdh.dll', 'propsys.dll',
    'secur32.dll', 'uiautomationcore.dll', 'urlmon.dll', 'userenv.dll', 'uxtheme.dll', 'version.dll', 'wevtapi.dll',
    'winhttp.dll', 'winmm.dll', 'winspool.drv', 'wintrust.dll', 'winusb.dll', 'wtsapi32.dll',
  ]),
);

/**
 * DLLs that are part of Windows on most editions and absent on some, so a program may only delay-load them.
 * Media Foundation is not installed on Windows N and KN editions without the Media Feature Pack; `Monstera.exe`
 * delay-loads all three (measured above), and the camera says so when they are missing.
 */
export const DELAY_ONLY = Object.freeze(new Set(['mf.dll', 'mfplat.dll', 'mfreadwrite.dll']));

/**
 * A runtime packaging may place beside a program: the DLLs it supplies and their pins, how to provision it, and what
 * a refusal tells a person to run.
 *
 * @typedef {{
 *   readonly name: string,
 *   readonly pins: Readonly<Record<string, string>>,
 *   readonly command: string,
 *   readonly provision: (root: string) => Promise<string>,
 * }} Runtime
 *   `provision` answers the runtime's folder, every file in it as pinned, or throws
 */

/** @type {readonly Runtime[]} */
export const RUNTIMES = Object.freeze([
  {
    name: `the Microsoft Visual C++ runtime ${VC14_RUNTIME.version}`,
    pins: VC14_RUNTIME_BIN,
    command: VC_RUNTIME_COMMAND,
    provision: async (/** @type {string} */ root) => (await provisionVcRuntime({ root })).directory,
  },
]);

/**
 * One import that does not resolve.
 *
 * @typedef {{ readonly program: string, readonly dll: string, readonly delayed: boolean }} MissingDll
 *   `program` is relative to the stage, with forward slashes
 */

const MODULE = /\.(?:exe|dll|node)$/iu;

/**
 * Every module under `stage`.
 *
 * @param {string} stage
 */
function modulesUnder(stage) {
  return readdirSync(stage, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && MODULE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The lower-cased file names in each folder, read once.
 *
 * @param {readonly string[]} folders
 */
function folderListings(folders) {
  /** @type {Map<string, Set<string>>} */
  const listings = new Map();
  for (const folder of folders) {
    if (!listings.has(folder)) listings.set(folder, new Set(readdirSync(folder).map((name) => name.toLowerCase())));
  }
  return listings;
}

/**
 * Every import under `stage` that no place Windows looks would answer. Refuses to report when it read no import
 * at all, because a scan that saw nothing reports the same clean result as one that found everything resolved.
 *
 * @param {string} stage the package's root folder: where `Monstera.exe` is
 * @returns {MissingDll[]}
 */
export function missingDlls(stage) {
  const modules = modulesUnder(stage);
  const listings = folderListings([stage, ...modules.map((path) => dirname(path))]);
  const rootListing = listings.get(stage) ?? new Set();
  /** @type {MissingDll[]} */
  const missing = [];
  let read = 0;
  for (const path of modules) {
    const folder = dirname(path);
    const own = listings.get(folder) ?? new Set();
    // A FOLDER THAT HOLDS A PROGRAM is that program's application directory, and the package root answers nothing in it.
    const rootAnswers = folder === stage || ![...own].some((name) => name.endsWith('.exe'));
    const { imports, delayed } = peImports(readFileSync(path));
    read += imports.length + delayed.length;
    const program = relative(stage, path).split(sep).join('/');
    const resolves = (/** @type {string} */ name, /** @type {boolean} */ isDelayed) => {
      const dll = name.toLowerCase();
      if (dll.startsWith('api-ms-win-')) return true;
      if (SYSTEM_DLLS.has(dll)) return true;
      if (isDelayed && (DELAY_ONLY.has(dll) || dll.startsWith('ext-ms-'))) return true;
      // NODE'S ADDON HOOK: a `.node` delay-loads `node.exe` and its hook answers with the host process, whatever its name.
      if (isDelayed && dll === 'node.exe' && path.toLowerCase().endsWith('.node')) return true;
      return own.has(dll) || (rootAnswers && rootListing.has(dll));
    };
    for (const name of imports) if (!resolves(name, false)) missing.push({ program, dll: name, delayed: false });
    for (const name of delayed) if (!resolves(name, true)) missing.push({ program, dll: name, delayed: true });
  }
  if (read === 0) throw new Error(`The DLL check read no import under ${stage}: an empty read is a broken one.`);
  return missing;
}

/**
 * The runtime that supplies `dll`, or undefined.
 *
 * @param {string} dll
 * @param {readonly Runtime[]} [runtimes]
 */
export function runtimeFor(dll, runtimes = RUNTIMES) {
  const name = dll.toLowerCase();
  return runtimes.find((runtime) => Object.keys(runtime.pins).includes(name));
}

/** @param {string} path */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Places what a pinned runtime supplies beside each program that imports it, then refuses the package for anything
 * still unresolved.
 *
 * @param {{
 *   stage: string,
 *   provide: (runtime: Runtime) => Promise<string | null>,
 *   runtimes?: readonly Runtime[],
 * }} options `provide` answers the provisioned runtime's folder — every file in it as pinned — or `null` where it
 *   could not be had (no pinned source, a failed download, a digest that did not match)
 * @returns {Promise<{ placed: string[] }>} each file placed, relative to the stage
 */
export async function repairThenRefuse({ stage, provide, runtimes = RUNTIMES }) {
  /** @type {string[]} */
  const placed = [];
  /** @type {Map<Runtime, string | null>} */
  const provided = new Map();
  for (const { program, dll } of missingDlls(stage)) {
    const runtime = runtimeFor(dll, runtimes);
    if (runtime === undefined) continue;
    if (!provided.has(runtime)) provided.set(runtime, await provide(runtime));
    const from = provided.get(runtime);
    if (from === null || from === undefined) continue;
    const name = dll.toLowerCase();
    const source = join(from, name);
    // PINNED OR NOTHING: the folder `provide` answered is checked here too, so a provider that skipped its own
    // verification cannot put an unverified byte beside a program.
    if (!existsSync(source) || sha256(source) !== runtime.pins[name]) {
      throw new Error(`${runtime.name}: ${name} in ${from} is not as pinned. Run: ${runtime.command} --force`);
    }
    const to = join(stage, dirname(program), name);
    if (!existsSync(to)) {
      copyFileSync(source, to);
      placed.push(relative(stage, to).split(sep).join('/'));
    }
  }
  const still = missingDlls(stage);
  if (still.length > 0) {
    const lines = still.map(({ program, dll, delayed }) => {
      const runtime = runtimeFor(dll, runtimes);
      const what = runtime === undefined
        ? `no pinned source supplies it: add one to RUNTIMES in scripts/release/dllClosure.mjs, or name it in SYSTEM_DLLS with the reading that shows every Windows 10 1809 PC has it`
        : `${runtime.name} supplies it and could not be provisioned: run ${runtime.command}`;
      return `${program} ${delayed ? 'delay-loads' : 'imports'} ${dll}, which would not be found on a user's PC — ${what}`;
    });
    throw new Error(`This package would fail on a user's PC, so it is not built:\n  ${lines.join('\n  ')}`);
  }
  return { placed };
}
