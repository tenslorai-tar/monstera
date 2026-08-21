// @ts-check
/**
 * Does Node's permission model constrain the adversary invariant 25 names?
 *
 * The invariant states its own threat, in its own text: *"A memory-safety bug
 * that reaches code execution currently inherits everything the process has, and
 * MuPDF's advisory history is memory-safety bugs."* The adversary is arbitrary
 * **native** code executing inside the host.
 *
 * `hostSurface.mjs` measured that a utility process under
 * `NODE_OPTIONS=--permission --allow-fs-read=<dir>` refuses a JavaScript
 * `readFileSync` outside the allow-list, and that reading was used to declare
 * invariant 25's property (d) obtainable. **Node's permission model is enforced
 * in Node's own filesystem bindings.** Native code calls `CreateFileW` directly
 * and never passes through them (finding QQ-1).
 *
 * There is a second edge pointing the same way: koffi is a native addon, and
 * under `--permission` Node blocks `process.dlopen` unless `--allow-addons` is
 * given. So either the host cannot load the FFI it reaches MuPDF through, or the
 * grant that lets it load is the grant that puts native code outside the model
 * by design. Neither of `hostSurface.mjs`'s permission variants loaded koffi:
 * **the mechanism and the load it has to carry had never been in the same
 * process.**
 *
 * So this measures both surfaces in ONE process, under the same policy:
 *
 *   - `require('koffi')`, recording whether `--allow-addons` was needed;
 *   - a JavaScript read outside the allow-list, and one inside;
 *   - a NATIVE read outside the allow-list through `CreateFileW`/`ReadFile`,
 *     and one inside.
 *
 * **Every probe is paired.** The inside reads are the controls, and they are not
 * optional in either direction: a native refusal proves containment only if the
 * same native call succeeds where reading is permitted, and a native success
 * means nothing if the call cannot fail — a broken FFI binding and an
 * unconstrained one produce different outputs only when both halves are run.
 *
 * If the native read succeeds where the JavaScript read was refused, the
 * permission model does not deliver (d), and the property goes back to having no
 * mechanism.
 *
 * ## Why this file exists rather than another variant
 *
 * Three times this session a conclusion has stood one inference further out than
 * the execution reaching it, and the tell each time was the same: the probe did
 * not carry the thing the conclusion was about. So this fixture is built toward
 * the real host — the FFI loaded, the same policy applied — rather than being
 * another minimal probe missing a different part of it (QQ-2).
 *
 * **Research, not a proof.** It asserts nothing and gates nothing.
 *
 * Usage: node scripts/research/hostNativeRead.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-native-'));

const HOST = String.raw`
const report = {};
const fs = require('node:fs');

report.hasPermission = typeof process.permission === 'object' && process.permission !== null;

// INSIDE the allow-list is the scratch directory this file sits in; OUTSIDE is
// the Electron binary, which certainly exists and is certainly readable when
// nothing is constraining the process.
const OUTSIDE = process.execPath;
const INSIDE = __filename;

// --- the JavaScript surface, which is the one already measured -------------
try {
  report.jsReadOUTSIDE = 'read ' + fs.readFileSync(OUTSIDE).length + ' bytes';
} catch (error) {
  report.jsReadOUTSIDE = 'refused: ' + String(error && error.code);
}
try {
  report.jsReadINSIDE = 'read ' + fs.readFileSync(INSIDE).length + ' bytes';
} catch (error) {
  report.jsReadINSIDE = 'refused: ' + String(error && error.code);
}

// --- loading the FFI the host reaches MuPDF through ------------------------
let koffi = null;
try {
  koffi = require(KOFFI_PATH);
  report.koffiLoad = 'loaded';
} catch (error) {
  // WHICH PATH. The message alone says only that access was restricted, and a
  // denial that does not name its resource cannot be attributed — the first run
  // of this file was read as "addons are blocked" when it was a file read of
  // koffi's own directory.
  report.koffiLoad = 'refused: ' + String(error && error.code);
  report.koffiDeniedResource = String(error && error.resource);
  report.koffiDeniedPermission = String(error && error.permission);
  report.koffiMessage = String(error && error.message).slice(0, 200);
}

// --- the NATIVE surface, which is the adversary's -------------------------
if (koffi === null) {
  report.nativeReadOUTSIDE = 'not attempted: koffi did not load';
  report.nativeReadINSIDE = 'not attempted: koffi did not load';
} else {
  try {
    const kernel = koffi.load('kernel32.dll');
    const CreateFileW = kernel.func(
      'void *CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)'
    );
    const ReadFile = kernel.func(
      'bool ReadFile(void *file, _Out_ void *buffer, uint32 toRead, _Out_ uint32 *read, void *overlapped)'
    );
    const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
    const GetLastError = kernel.func('uint32 GetLastError()');

    const GENERIC_READ = 0x80000000;
    const FILE_SHARE_READ = 0x00000001;
    const OPEN_EXISTING = 3;
    const INVALID = -1;

    const nativeRead = (path) => {
      const handle = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, null, OPEN_EXISTING, 0, null);
      const asNumber = koffi.address(handle);
      if (!handle || asNumber === 0 || asNumber === INVALID || asNumber === 0xffffffffffffffff) {
        return 'CreateFileW refused: error ' + GetLastError();
      }
      try {
        const buffer = Buffer.alloc(4096);
        const readOut = [0];
        if (!ReadFile(handle, buffer, buffer.length, readOut, null)) {
          return 'ReadFile refused: error ' + GetLastError();
        }
        // The first bytes, so a success cannot be an empty read dressed up as
        // one — an MZ header for a PE, real text for the source file.
        return 'read ' + readOut[0] + ' bytes, first two: ' + JSON.stringify(buffer.toString('latin1', 0, 2));
      } finally {
        CloseHandle(handle);
      }
    };

    report.nativeReadOUTSIDE = nativeRead(OUTSIDE);
    report.nativeReadINSIDE = nativeRead(INSIDE);
  } catch (error) {
    report.nativeError = String(error && error.stack).slice(0, 400);
  }
}

process.parentPort.postMessage(report);
`;

/**
 * The main-process body.
 *
 * ## The allow-list is not empty, measured the hard way
 *
 * The first run of this file allowed only the scratch directory, and
 * `require(koffi)` was refused as a FILE READ — `ERR_ACCESS_DENIED ... use
 * --allow-fs-read` — before `dlopen` was ever reached. So `--allow-addons` made
 * no difference between the two variants, and the question they existed to ask
 * went unasked while their output looked like an answer.
 *
 * That is QQ-4 arriving as a measurement rather than a prediction: a real host's
 * allow-list must cover the FFI and the engine library, so *"reaches no
 * filesystem path it was not handed"* and *"reaches the install directory plus
 * what it was handed"* are two different properties and the ADR has to choose
 * between them by name.
 *
 * ## Prose lives HERE, not inside the template
 *
 * Twice now a backtick pair inside a comment inside one of these embedded
 * sources has closed the template literal early, and the error pointed at
 * whatever followed rather than at the delimiter. Keeping the explanation in the
 * module — where backticks are ordinary characters — makes that unrepresentable
 * instead of remembered, which is the only remedy with a record of working.
 */
const MAIN = String.raw`
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');

// See the note above this template in the module source: the allow-list is not
// empty, and why.
const ALLOW = __dirname;
// TWO directories, and the second is platform-specific. koffi's loader reaches
// a sibling package rather than its own subtree, and the first attempt allowed
// only the obvious one.
const FFI = KOFFI_DIR;
const FFI_PLATFORM = KOFFI_PLATFORM_DIR;
const VARIANTS = [
  {
    label: 'permission, allow-list covers the FFI, NO --allow-addons',
    env: {
      NODE_OPTIONS:
        '--permission --allow-fs-read=' + ALLOW + ' --allow-fs-read=' + FFI +
        ' --allow-fs-read=' + FFI_PLATFORM,
    },
  },
  {
    label: 'permission, allow-list covers the FFI, WITH --allow-addons',
    env: {
      NODE_OPTIONS:
        '--permission --allow-fs-read=' + ALLOW + ' --allow-fs-read=' + FFI +
        ' --allow-fs-read=' + FFI_PLATFORM + ' --allow-addons',
    },
  },
  {
    label: 'CONTROL: no permission model at all',
    env: {},
  },
];

const results = [];

function runVariant(index) {
  if (index >= VARIANTS.length) {
    process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify(results) + '\n');
    app.exit(0);
    return;
  }
  const variant = VARIANTS[index];
  let settled = false;
  const settle = (payload) => {
    if (settled) return;
    settled = true;
    results.push({ variant: variant.label, ...payload });
    runVariant(index + 1);
  };

  let child;
  try {
    child = utilityProcess.fork(join(__dirname, 'host.js'), [], {
      serviceName: 'monstera-native-read-research',
      stdio: 'pipe',
      env: { ...process.env, ...variant.env },
    });
  } catch (error) {
    settle({ forkThrew: String(error && error.message) });
    return;
  }
  if (child.stderr) child.stderr.on('data', (c) => process.stdout.write('HOST_STDERR ' + String(c)));

  child.on('message', (message) => settle({ fromHost: message }));
  child.on('exit', (code) => settle({ hostExitedBeforeReporting: code }));
  setTimeout(() => settle({ error: 'no report within the window' }), 30000);
}

app.whenReady().then(() => runVariant(0));
setTimeout(() => {
  process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify({ error: 'timed out', results }) + '\n');
  app.exit(1);
}, 150000);
`;

try {
  const koffiPath = JSON.stringify(join(process.cwd(), 'node_modules', 'koffi'));
  writeFileSync(join(scratch, 'host.js'), `const KOFFI_PATH = ${koffiPath};\n${HOST}`, 'utf8');
  writeFileSync(
    join(scratch, 'main.js'),
    `const KOFFI_DIR = ${JSON.stringify(join(process.cwd(), 'node_modules', 'koffi'))};\n` +
      `const KOFFI_PLATFORM_DIR = ${JSON.stringify(
        join(process.cwd(), 'node_modules', '@koromix', 'koffi-win32-x64'),
      )};\n${MAIN}`,
    'utf8',
  );
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'monstera-native-read-research', version: '0.0.0', main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );

  const electron = electronBinaryPath();
  process.stdout.write(`electron: ${electron}\nallow-list: ${scratch}\n\n`);

  const result = spawnSync(electron, [scratch], { encoding: 'utf8', timeout: 180_000 });
  if (`${result.stderr}`.trim() !== '') process.stdout.write(`stderr:\n${result.stderr}\n`);

  const line = `${result.stdout}`.split('\n').find((entry) => entry.startsWith('MONSTERA_HOST_REPORT '));
  if (line === undefined) {
    process.stdout.write(`no report line.\nstdout:\n${result.stdout}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(JSON.parse(line.slice('MONSTERA_HOST_REPORT '.length)), null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
