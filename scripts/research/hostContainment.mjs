// @ts-check
/**
 * Can a utility process contain ITSELF? Measured on the pinned Electron.
 *
 * `hostSurface.mjs` established what a utility process is: full Node 24.18.1,
 * `fs`/`net`/`child_process` all reachable, and `--permission` accepted into
 * `execArgv`, visible there afterwards, and **not in force**. So invariant 25's
 * four properties come from somewhere other than `ForkOptions`, and the leading
 * remaining candidate is Windows' own token machinery reached through the koffi
 * FFI this project already carries for MuPDF.
 *
 * The specific question, because it decides the shape of ADR-0022:
 *
 * **A process may lower its own integrity level; it may not lower another's.**
 * If that is true here, the mechanism is self-containment — the host's first act,
 * before the shim is loaded — and it is readable back from the token, which is
 * what invariant 25's assertion (a) requires. If it is not, containment has to
 * come from process creation, and `utilityProcess.fork` does not expose that.
 *
 * What this measures, in order, all INSIDE the host:
 *
 *   1. the integrity level it starts at, read from its own token;
 *   2. whether lowering it to Low succeeds;
 *   3. the integrity level read back afterwards — set is not enforced;
 *   4. what a Low-integrity host can still DO: open a socket, read a file it
 *      was never handed, spawn a process.
 *
 * **Step 4's results here are unsafe to read on their own, and this file is kept
 * for step 1 and step 2.** Step 3 returns ACCESS_DENIED, so step 4 runs against
 * a process whose Low state was never established — if the lowering had silently
 * failed, its observations are about a *Medium* process (finding PP-2). The
 * verified versions live in `hostIntegrityFromMain.mjs`, which reads the child's
 * token from main before and after, and reruns the probes on a premise that
 * holds. Read that file for the conclusions; read this one for how the failure
 * to read one's own token was found.
 *
 * Step 4 is the point. Low integrity is a WRITE control on Windows and says
 * little about reads or sockets, so the reassuring outcome here — "the call
 * succeeded" — is exactly the one that must not be mistaken for containment.
 * Each probe uses a target that would SUCCEED without the guard, on disk and off
 * the network, so a failure cannot be a runner with no connectivity (HH-2).
 *
 * **Research, not a proof.** It asserts nothing and gates nothing.
 *
 * Usage: node scripts/research/hostContainment.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-contain-'));

const HOST = String.raw`
const report = { steps: [] };
const note = (step, value) => report.steps.push({ step, value });

// INSIDE the guard. The first version of this file loaded koffi at the top,
// outside the try, so a load failure exited the host with code 1 and no report
// and no stderr — a failure on a channel nothing was subscribed to, which is
// HH-1's shape reproduced in the harness written to study containment.
let koffi;
let advapi;
let kernel;
try {
  // By ABSOLUTE path. The scratch app has no node_modules of its own and the
  // utility process does not honour NODE_PATH — measured, on the run before
  // this one.
  koffi = require(KOFFI_PATH);
  advapi = koffi.load('advapi32.dll');
  kernel = koffi.load('kernel32.dll');
} catch (error) {
  note('loading koffi', 'threw: ' + String(error && error.message));
  process.parentPort.postMessage(report);
  return;
}

const HANDLE = 'void *';
koffi.struct('SID_AND_ATTRIBUTES', { Sid: 'void *', Attributes: 'uint32' });
koffi.struct('TOKEN_MANDATORY_LABEL', { Label: 'SID_AND_ATTRIBUTES' });

const GetCurrentProcess = kernel.func('void *GetCurrentProcess()');
const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi.func(
  'bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)'
);
const SetTokenInformation = advapi.func(
  'bool SetTokenInformation(void *token, int cls, void *info, uint32 len)'
);
const ConvertStringSidToSidA = advapi.func('bool ConvertStringSidToSidA(const char *str, _Out_ void **sid)');
const GetLastError = kernel.func('uint32 GetLastError()');

const TOKEN_QUERY = 0x0008;
const TOKEN_ADJUST_DEFAULT = 0x0080;
const TokenIntegrityLevel = 25;

// The RID lives at the end of the label SID. Reading it back is the only honest
// form of "the integrity level is X" — the call returning true is not.
function integrityRid() {
  const tokenOut = [null];
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, tokenOut)) {
    return 'OpenProcessToken failed: ' + GetLastError();
  }
  const token = tokenOut[0];
  const sizeOut = [0];
  GetTokenInformation(token, TokenIntegrityLevel, null, 0, sizeOut);
  const size = sizeOut[0];
  if (!size) return 'GetTokenInformation sized 0: ' + GetLastError();
  const buffer = Buffer.alloc(size);
  if (!GetTokenInformation(token, TokenIntegrityLevel, buffer, size, sizeOut)) {
    return 'GetTokenInformation failed: ' + GetLastError();
  }
  // TOKEN_MANDATORY_LABEL is { SID*, DWORD }; the SID is pointed to, and the
  // pointed-at bytes follow the struct in this buffer. The last 4 bytes of the
  // whole blob are the sub-authority, which IS the integrity level.
  return buffer.readUInt32LE(buffer.length - 4);
}

try {
  note('integrity at start (0x2000 = Medium, 0x1000 = Low, 0x0 = Untrusted)', integrityRid());

  // Lower to Low.
  const sidOut = [null];
  if (!ConvertStringSidToSidA('S-1-16-4096', sidOut)) {
    note('ConvertStringSidToSid failed', GetLastError());
  } else {
    const tokenOut = [null];
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_DEFAULT | TOKEN_QUERY, tokenOut)) {
      note('OpenProcessToken for adjust failed', GetLastError());
    } else {
      const label = Buffer.alloc(koffi.sizeof('TOKEN_MANDATORY_LABEL'));
      koffi.encode(label, 'TOKEN_MANDATORY_LABEL', { Label: { Sid: sidOut[0], Attributes: 0x00000020 } });
      const ok = SetTokenInformation(tokenOut[0], TokenIntegrityLevel, label, label.length);
      note('SetTokenInformation(Low) returned', ok ? true : 'false, error ' + GetLastError());
    }
  }

  note('integrity READ BACK after lowering', integrityRid());

  // What can it still do? Each target succeeds without any guard, so a failure
  // here is the guard and not the environment.
  const net = require('node:net');
  const fs = require('node:fs');
  const cp = require('node:child_process');

  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const socket = net.connect(port, '127.0.0.1', () => {
      note('loopback socket AFTER lowering', 'connected on ' + port);
      socket.destroy();
      server.close(() => finish());
    });
    socket.on('error', (e) => {
      note('loopback socket AFTER lowering', 'refused: ' + e.message);
      server.close(() => finish());
    });
  });
  server.on('error', (e) => { note('loopback listen AFTER lowering', 'failed: ' + e.message); finish(); });

  function finish() {
    // A file the host was never handed, which certainly exists and is readable
    // at Medium integrity: the Electron binary it is running from.
    try {
      const bytes = fs.readFileSync(process.execPath).length;
      note('read a file it was never handed (its own execPath)', 'read ' + bytes + ' bytes');
    } catch (e) {
      note('read a file it was never handed (its own execPath)', 'refused: ' + e.message);
    }

    try {
      const out = cp.execFileSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 20000 });
      note('spawn a process', 'spawned, said ' + out.trim());
    } catch (e) {
      note('spawn a process', 'refused: ' + e.message);
    }

    process.parentPort.postMessage(report);
  }
} catch (error) {
  note('threw', String(error && error.stack));
  process.parentPort.postMessage(report);
}
`;

const MAIN = String.raw`
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');

app.whenReady().then(() => {
  const child = utilityProcess.fork(join(__dirname, 'host.js'), [], {
    serviceName: 'monstera-containment-research',
    stdio: 'pipe',
  });
  // SUBSCRIBE to the host's stderr. With 'inherit' nothing from the host
  // reached this process's stderr at all, so a module-load failure was
  // invisible in both directions.
  if (child.stderr) child.stderr.on('data', (chunk) => process.stdout.write('HOST_STDERR ' + String(chunk)));
  if (child.stdout) child.stdout.on('data', (chunk) => process.stdout.write('HOST_STDOUT ' + String(chunk)));
  let settled = false;
  const done = (payload) => {
    if (settled) return;
    settled = true;
    process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify(payload) + '\n');
    app.exit(0);
  };
  child.on('message', (message) => done(message));
  child.on('exit', (code) => done({ error: 'host exited before reporting, code ' + String(code) }));
  setTimeout(() => done({ error: 'no report within the window' }), 60000);
});
`;

try {
  writeFileSync(
    join(scratch, 'host.js'),
    `const KOFFI_PATH = ${JSON.stringify(join(process.cwd(), 'node_modules', 'koffi'))};\n${HOST}`,
    'utf8',
  );
  writeFileSync(join(scratch, 'main.js'), MAIN, 'utf8');
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'monstera-containment-research', version: '0.0.0', main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );

  const electron = electronBinaryPath();
  process.stdout.write(`electron: ${electron}\n\n`);

  const result = spawnSync(electron, [scratch], {
    encoding: 'utf8',
    // koffi is resolved from this repository, since the scratch app has no
    // node_modules of its own.
    env: { ...process.env, NODE_PATH: join(process.cwd(), 'node_modules') },
    timeout: 120_000,
  });

  // stderr is printed WHATEVER happens. The host inherits stdio, so its own
  // stack traces land here — and the first run of this script reported only
  // `host exited before reporting, code 1`, because stderr was printed solely
  // on the no-report path. A diagnostic available only when the run fails one
  // particular way is the diagnostic you do not have.
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
