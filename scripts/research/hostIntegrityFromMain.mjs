// @ts-check
/**
 * Is the host's integrity level actually Low? Read from MAIN, against the
 * child's token.
 *
 * `hostContainment.mjs` measured four steps and its step 3 — read the integrity
 * back after lowering — came back ACCESS_DENIED, because a Low token can no
 * longer open a process object whose descriptor was created at Medium. That was
 * recorded as a could-not-look, correctly.
 *
 * **But its step 4 then ran anyway, and its conclusions inherited the
 * unanswered question** (finding PP-2). "A Low host still connected a socket"
 * and "a Low host still read a file it was never handed" are observations of a
 * process whose Low state was never established. If the lowering had silently
 * failed, both are facts about a *Medium* process and say nothing about Low
 * integrity at all.
 *
 * The conclusions are very probably right — Low integrity is a write control on
 * Windows, and neither outbound sockets nor ordinary reads are governed by it.
 * That is exactly why they must not ship as *measured*: domain knowledge wearing
 * a measurement's clothes, in the ADR whose purpose is to state mechanisms with
 * evidence behind them.
 *
 * So this reads the child's token from main, which is where
 * `docs/FEATURES.md` row 283 now says assertion (a) must be made, and it reads
 * it TWICE:
 *
 *   before the host lowers itself — expected Medium;
 *   after                          — expected Low.
 *
 * **The before-reading is the control**, and without it the after-reading proves
 * nothing: a reader that returns Low unconditionally, or one that fails and is
 * misparsed as Low, agrees with a working one. Two readings that DIFFER across
 * the one action are the only shape that separates them — the same differential
 * as the job object, and as II-2's `sandbox` flipped alone.
 *
 * Only once the premise is verified do the step-4 probes run again, now against
 * a process whose integrity is established rather than assumed.
 *
 * **Research, not a proof.** It asserts nothing and gates nothing.
 *
 * Usage: node scripts/research/hostIntegrityFromMain.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-integrity-'));

/** Runs inside the host: lower on command, then probe on command. */
const HOST = String.raw`
let koffi;
let advapi;
let kernel;
try {
  koffi = require(KOFFI_PATH);
  advapi = koffi.load('advapi32.dll');
  kernel = koffi.load('kernel32.dll');
} catch (error) {
  process.parentPort.postMessage({ kind: 'error', detail: 'koffi: ' + String(error && error.message) });
  return;
}

koffi.struct('SID_AND_ATTRIBUTES', { Sid: 'void *', Attributes: 'uint32' });
koffi.struct('TOKEN_MANDATORY_LABEL', { Label: 'SID_AND_ATTRIBUTES' });

const GetCurrentProcess = kernel.func('void *GetCurrentProcess()');
const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const SetTokenInformation = advapi.func('bool SetTokenInformation(void *token, int cls, void *info, uint32 len)');
const ConvertStringSidToSidA = advapi.func('bool ConvertStringSidToSidA(const char *str, _Out_ void **sid)');
const GetLastError = kernel.func('uint32 GetLastError()');

const TOKEN_QUERY = 0x0008;
const TOKEN_ADJUST_DEFAULT = 0x0080;
const TokenIntegrityLevel = 25;

process.parentPort.on('message', (event) => {
  const command = event.data && event.data.command;

  if (command === 'lower') {
    const sidOut = [null];
    if (!ConvertStringSidToSidA('S-1-16-4096', sidOut)) {
      process.parentPort.postMessage({ kind: 'lowered', ok: false, detail: 'ConvertStringSidToSid ' + GetLastError() });
      return;
    }
    const tokenOut = [null];
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_DEFAULT | TOKEN_QUERY, tokenOut)) {
      process.parentPort.postMessage({ kind: 'lowered', ok: false, detail: 'OpenProcessToken ' + GetLastError() });
      return;
    }
    const label = Buffer.alloc(koffi.sizeof('TOKEN_MANDATORY_LABEL'));
    koffi.encode(label, 'TOKEN_MANDATORY_LABEL', { Label: { Sid: sidOut[0], Attributes: 0x00000020 } });
    const ok = SetTokenInformation(tokenOut[0], TokenIntegrityLevel, label, label.length);
    process.parentPort.postMessage({ kind: 'lowered', ok: !!ok, detail: ok ? 'returned true' : 'error ' + GetLastError() });
    return;
  }

  if (command === 'probe') {
    const steps = [];
    const note = (step, value) => steps.push({ step, value });
    const net = require('node:net');
    const fs = require('node:fs');

    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const socket = net.connect(port, '127.0.0.1', () => {
        note('loopback socket', 'connected on ' + port);
        socket.destroy();
        server.close(() => finish());
      });
      socket.on('error', (e) => { note('loopback socket', 'refused: ' + e.message); server.close(() => finish()); });
    });
    server.on('error', (e) => { note('loopback listen', 'failed: ' + e.message); finish(); });

    function finish() {
      try {
        const bytes = fs.readFileSync(process.execPath).length;
        note('read a file it was never handed (its own execPath)', 'read ' + bytes + ' bytes');
      } catch (e) {
        note('read a file it was never handed (its own execPath)', 'refused: ' + e.message);
      }
      process.parentPort.postMessage({ kind: 'probed', steps });
    }
  }
});
`;

const MAIN = String.raw`
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');
const koffi = require(KOFFI_PATH);

const advapi = koffi.load('advapi32.dll');
const kernel = koffi.load('kernel32.dll');

const OpenProcess = kernel.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi.func(
  'bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)'
);
const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
const GetLastError = kernel.func('uint32 GetLastError()');

const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TOKEN_QUERY = 0x0008;
const TokenIntegrityLevel = 25;

/**
 * The child's integrity level, read by THIS process from the child's token.
 * Returns a number, or a string naming which call failed — the two must never
 * be confused, because "could not look" reading as a level is the whole defect
 * this file exists to close.
 */
function childIntegrity(pid) {
  const proc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!proc) return 'OpenProcess failed: ' + GetLastError();
  try {
    const tokenOut = [null];
    if (!OpenProcessToken(proc, TOKEN_QUERY, tokenOut)) return 'OpenProcessToken failed: ' + GetLastError();
    const sizeOut = [0];
    GetTokenInformation(tokenOut[0], TokenIntegrityLevel, null, 0, sizeOut);
    if (!sizeOut[0]) return 'GetTokenInformation sized 0: ' + GetLastError();
    const buffer = Buffer.alloc(sizeOut[0]);
    if (!GetTokenInformation(tokenOut[0], TokenIntegrityLevel, buffer, sizeOut[0], sizeOut)) {
      return 'GetTokenInformation failed: ' + GetLastError();
    }
    return buffer.readUInt32LE(buffer.length - 4);
  } finally {
    CloseHandle(proc);
  }
}

const steps = [];
const note = (step, value) => steps.push({ step, value });

app.whenReady().then(() => {
  const child = utilityProcess.fork(join(__dirname, 'host.js'), [], {
    serviceName: 'monstera-integrity-research',
    stdio: 'pipe',
  });
  if (child.stderr) child.stderr.on('data', (c) => process.stdout.write('HOST_STDERR ' + String(c)));

  let settled = false;
  const done = (payload) => {
    if (settled) return;
    settled = true;
    process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify(payload) + '\n');
    app.exit(0);
  };

  child.on('exit', (code) => done({ steps, hostExitedBeforeReporting: code }));
  setTimeout(() => done({ steps, error: 'no report within the window' }), 60000);

  child.on('message', (message) => {
    if (message.kind === 'error') { done({ steps, hostError: message.detail }); return; }

    if (message.kind === 'lowered') {
      note('host reported SetTokenInformation', message.ok + ' — ' + message.detail);
      // READ AGAIN, from here. This is the reading row 283 requires and the one
      // the host itself cannot take.
      note('integrity read BY MAIN, after lowering', childIntegrity(child.pid));
      child.postMessage({ command: 'probe' });
      return;
    }

    if (message.kind === 'probed') {
      done({ steps, probesUnderVerifiedLow: message.steps });
    }
  });

  child.on('spawn', () => {
    note('pid visible from main', child.pid ?? null);
    // THE CONTROL, and it must come first. Without a before-reading that says
    // Medium, an after-reading of Low is agreed with by a reader that always
    // says Low and by a failure misparsed as a level.
    note('integrity read BY MAIN, before lowering', childIntegrity(child.pid));
    child.postMessage({ command: 'lower' });
  });
});
`;

try {
  const koffiPath = JSON.stringify(join(process.cwd(), 'node_modules', 'koffi'));
  writeFileSync(join(scratch, 'host.js'), `const KOFFI_PATH = ${koffiPath};\n${HOST}`, 'utf8');
  writeFileSync(join(scratch, 'main.js'), `const KOFFI_PATH = ${koffiPath};\n${MAIN}`, 'utf8');
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'monstera-integrity-research', version: '0.0.0', main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );

  const electron = electronBinaryPath();
  process.stdout.write(`electron: ${electron}\n\n`);

  const result = spawnSync(electron, [scratch], { encoding: 'utf8', timeout: 120_000 });
  if (`${result.stderr}`.trim() !== '') process.stdout.write(`stderr:\n${result.stderr}\n`);

  const line = `${result.stdout}`.split('\n').find((entry) => entry.startsWith('MONSTERA_HOST_REPORT '));
  if (line === undefined) {
    process.stdout.write(`no report line.\nstdout:\n${result.stdout}\n`);
    process.exit(1);
  }

  const report = JSON.parse(line.slice('MONSTERA_HOST_REPORT '.length));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n\n`);

  // The reading of the readings, stated here so it is not left to whoever
  // scrolls past. 0x2000 is Medium, 0x1000 is Low.
  /** @type {Array<{ step: string, value: unknown }>} */
  const steps = report.steps ?? [];
  const before = steps.find((entry) => entry.step.includes('before lowering'))?.value;
  const after = steps.find((entry) => entry.step.includes('after lowering'))?.value;
  const verified = before === 0x2000 && after === 0x1000;
  process.stdout.write(
    verified
      ? `PREMISE VERIFIED: main read the child at 0x2000 before and 0x1000 after, so the probes\n` +
          `above ran against a process established to be Low.\n`
      : `PREMISE NOT VERIFIED: before=${JSON.stringify(before)} after=${JSON.stringify(after)}.\n` +
          `The probes above are observations of a process whose integrity is unestablished, which\n` +
          `is exactly the state finding PP-2 was raised about. Do not draw conclusions from them.\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
