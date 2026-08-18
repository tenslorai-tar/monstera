// @ts-check
/**
 * Proof that the FFI binding is packageable, and that the reason ADR-0010 gave
 * for worrying about it was the wrong one (rule B2).
 *
 * ADR-0010 recorded, as a consequence, that *"koffi is a native module and needs
 * Electron ABI prebuilds"*. Measured, that is not what koffi is:
 *
 *   - it declares `napi: 8` and refuses to load on any runtime reporting a
 *     lower `process.versions['napi']`, which is a **Node-API** floor, not a V8 ABI
 *     dependency. Node-API is ABI-stable across runtimes by construction, which
 *     is the entire reason it exists;
 *   - its prebuilt binaries are published per **platform-arch**
 *     (`@koromix/koffi-win32-x64`), with no ABI or runtime in the name;
 *   - its loader probes `process.resourcesPath` — an Electron-only global — for
 *     the binary inside a packaged app, so Electron is a case it was written for
 *     rather than one it needs rebuilding for.
 *
 * So there is no ABI rebuild to arrange. What there IS, and what this checks, is
 * a narrower and more ordinary risk: the platform binary is an **optional**
 * dependency, so an install that omits optional packages leaves koffi resolving
 * nothing and failing at load, at runtime, in a shipped application.
 *
 * Usage: node scripts/proofs/nativeAddon.proof.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import koffi from 'koffi';

import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
const require = createRequire(import.meta.url);

/**
 * Platforms this application ships to, or builds on. A prebuilt missing for any
 * of these is a broken install rather than an unsupported target.
 *
 * win32-x64 is the product. linux-x64 is CI, which is not decoration: the guards
 * and proofs run there, and koffi failing to load there would disable exactly
 * the checks that would have caught it.
 */
const REQUIRED_PLATFORMS = [
  { pkg: '@koromix/koffi-win32-x64', os: 'win32', cpu: 'x64' },
  { pkg: '@koromix/koffi-linux-x64', os: 'linux', cpu: 'x64' },
];

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const passed = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  if (condition) passed.push(label);
  else failures.push(`${label}\n      ${detail}`);
}

// ---------------------------------------------------------------------------
// The Node-API floor, read from koffi rather than remembered.
// ---------------------------------------------------------------------------
const koffiPackage = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'koffi', 'package.json'), 'utf8'));
const declaredFloor = (() => {
  // koffi 3.1.5 carries its cnoke config inside the bundled loader rather than
  // in package.json, so read it from the loader's own embedded copy. Parsed, not
  // assumed: a version that moves the floor must move this number too.
  const loader = readFileSync(
    join(ROOT, 'node_modules', 'koffi', 'src', 'koffi', 'index.cjs'),
    'utf8',
  );
  const match = /napi:\s*(\d+)/u.exec(loader);
  return match === null ? null : Number(match[1]);
})();

check(
  "koffi declares a Node-API floor, and it is readable rather than assumed",
  declaredFloor !== null && Number.isFinite(declaredFloor),
  `could not find a napi floor in koffi ${String(koffiPackage.version)}'s loader. If koffi changed ` +
    `how it declares this, the check must follow it rather than keep passing.`,
);

check(
  'the running runtime satisfies that floor',
  declaredFloor !== null && Number(process.versions['napi']) >= declaredFloor,
  `runtime reports Node-API ${String(process.versions['napi'])}, koffi requires ${String(declaredFloor)}`,
);

// Recorded as a claim with a date attached rather than as a permanent fact: the
// floor is a property of koffi and the ceiling a property of Electron, and
// either can move. Electron 43.4.0 bundles Node 24.18.1, which is Node-API 10.
check(
  'the floor leaves headroom against the Node-API level Electron ships',
  declaredFloor !== null && declaredFloor <= 10,
  `koffi requires Node-API ${String(declaredFloor)}. Verified 2026-08-18 against Electron 43.4.0, ` +
    `which bundles Node 24.18.1 (Node-API 10). A floor above that would mean the binding cannot ` +
    `load in the shell, which is a decision to take deliberately rather than discover at runtime.`,
);

// ---------------------------------------------------------------------------
// The real risk: an optional dependency that an install can silently omit.
// ---------------------------------------------------------------------------
{
  /** @type {{ packages?: Record<string, { optional?: boolean, os?: string[], cpu?: string[] }> }} */
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const packages = lock.packages ?? {};

  for (const { pkg, os, cpu } of REQUIRED_PLATFORMS) {
    const entry = packages[`node_modules/${pkg}`];
    check(
      `the lockfile pins ${pkg}`,
      entry !== undefined,
      `A platform this project ships to or builds on has no prebuilt in the lockfile, so an ` +
        `install there resolves nothing and koffi fails when the first FFI call is made.`,
    );
    if (entry === undefined) continue;

    check(
      `and constrains it to ${os}/${cpu}`,
      (entry.os ?? []).includes(os) && (entry.cpu ?? []).includes(cpu),
      `os=${JSON.stringify(entry.os)} cpu=${JSON.stringify(entry.cpu)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The binary is real, present, and outside the JS bundle.
// ---------------------------------------------------------------------------
{
  /** @type {string | null} */
  let resolved;
  try {
    resolved = require.resolve(`@koromix/koffi-${process.platform}-${process.arch}/package.json`);
  } catch {
    // Not found is the finding, not an error to propagate: it is precisely what
    // an --omit=optional install looks like from here.
    resolved = null;
  }

  check(
    'the prebuilt package for this machine is installed',
    resolved !== null,
    `@koromix/koffi-${process.platform}-${process.arch} did not resolve. This is what an install ` +
      `run with --omit=optional looks like, and koffi would fail at the first call rather than here.`,
  );

  if (resolved !== null) {
    const directory = join(resolved, '..');
    const binary = join(directory, `${process.platform}_${process.arch}`, 'koffi.node');
    check(
      'and carries a real .node binary on disk',
      existsSync(binary),
      `expected ${binary}. It must exist as a FILE for packaging: a native library cannot be ` +
        `loaded from inside an asar archive, so the packaging config has to unpack it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// It actually works. Nothing above proves a call can be made.
// ---------------------------------------------------------------------------
{
  // A platform function with no arguments and an integer return, so the case
  // tests the binding rather than this project's shim — which the guards job
  // does not build.
  let calledValue = null;
  let error = '';
  try {
    if (process.platform === 'win32') {
      const kernel32 = koffi.load('kernel32.dll');
      const getCurrentProcessId = kernel32.func('uint32 GetCurrentProcessId()');
      calledValue = getCurrentProcessId();
    } else {
      const libc = koffi.load(process.platform === 'darwin' ? 'libSystem.dylib' : 'libc.so.6');
      const getpid = libc.func('int getpid()');
      calledValue = getpid();
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  check(
    'a real FFI call through koffi returns this process id',
    calledValue === process.pid,
    `got ${String(calledValue)}, expected ${String(process.pid)}${error === '' ? '' : `; threw: ${error}`}. ` +
      `Comparing against a value known independently is what makes this a working binding rather ` +
      `than a loaded file.`,
  );
}

if (failures.length > 0) {
  process.stderr.write(
    `\nNative-addon proof — ${failures.length} failure(s):\n\n` +
      failures.map((failure) => `  - ${failure}`).join('\n\n') +
      `\n\n`,
  );
  process.exit(1);
}

for (const label of passed) process.stdout.write(`  ok  ${label}\n`);
process.stdout.write(`\n${passed.length} native-addon cases passed.\n`);
