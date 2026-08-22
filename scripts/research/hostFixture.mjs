// @ts-check
/**
 * ONE realistic engine host, and every containment conclusion measured against
 * it.
 *
 * ## Why one fixture and not a sixth probe
 *
 * Three times in one session a conclusion stood one inference further out than
 * the execution reaching it, and the tell was identical each time: **the probe
 * did not carry the thing the conclusion was about.** `(d) is obtainable` was
 * measured on a host with no FFI in it, and fell the moment koffi was loaded in
 * the same process. A conclusion about the engine host is only about the engine
 * host if it was measured on one (finding QQ-2).
 *
 * So this host is the real shape: **koffi loaded, the MuPDF shim opened through
 * it, the job object assigned, the integrity level lowered.** Everything the
 * ADR asserts runs here.
 *
 * ## One uncontained variant PER PROPERTY, permanently (finding RR-2)
 *
 * Consolidating minimal probes concentrates risk: after the merge every
 * conclusion depends on one instrument, and item 4a says an instrument is
 * validated before it measures anything real.
 *
 * A single "nothing applied" pass is not enough. A run that applies every
 * mechanism and reports every denial **cannot say which mechanism produced
 * which denial** — that is the union problem that cost this project its sandbox
 * attribution, arriving at a larger scale. So each property gets a variant in
 * which *only its own* mechanism is absent, in the same run, on the same host:
 *
 * | variant | integrity | job |
 * |---|---|---|
 * | `contained` | lowered | assigned |
 * | `no-integrity` | **left Medium** | assigned |
 * | `no-job` | lowered | **not assigned** |
 * | `uncontained` | left Medium | not assigned |
 *
 * A property's conclusion is the DIFFERENCE between `contained` and the variant
 * that removes its mechanism. **If a property has no variant that produces the
 * opposite outcome, that property is unasserted no matter what this prints** —
 * and the report says so by name rather than leaving a reader to notice.
 *
 * That is why (c) and (d) come out UNASSERTED here: **nothing a utility process
 * can be given delivers them**, so there is no mechanism to remove and no
 * differential to read. Their probes still run, and their answers are the
 * uncontained baseline.
 *
 * **They ARE delivered, by an AppContainer, and `lowboxSpike.mjs` measures the
 * differential** (ADR-0022). This sentence used to end at *nothing yet delivers
 * them*, which was true when it was written and false eight commits later — the
 * live half of the claim, that a utility process cannot, kept vouching for the
 * dead half beside it.
 *
 * **Research, not a proof** — it asserts nothing and gates nothing. The
 * transition to a proof, and where it runs, is stated in
 * [ADR-0023](../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * §6 (RR-3): the shim job is the only one that can host it, which is why it now
 * provisions Electron (RR-1).
 *
 * **This file measures the utility-process baseline, which is no longer the
 * shipped shape.** ADR-0022 moved the hosts to a process we create, because (c)
 * and (d) come from an AppContainer that `utilityProcess.fork` cannot make. What
 * this fixture still establishes is (a) and (b) with their differentials, and
 * that they hold on *any* child rather than on Chromium's arrangement — the job
 * here is one main assigns against a pid. `lowboxSpike.mjs` is where the
 * contained shape is measured.
 *
 * Usage: node scripts/research/hostFixture.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { INVALID_HANDLE_SOURCE } from '../lib/win32Handle.mjs';

const ROOT = repoRoot();
const SHIM = join(ROOT, 'native', 'mupdf-shim', 'out', 'monstera_mupdf.dll');
const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-'));

/**
 * The host body: load the FFI, open the engine, then answer every probe.
 *
 * Prose stays in this module rather than inside the template — a backtick pair
 * in an embedded comment has closed one of these literals twice, and the error
 * pointed at whatever followed rather than at the delimiter.
 */
const HOST = String.raw`
const report = { steps: [] };
const note = (step, value) => report.steps.push({ step, value });

let koffi;
try {
  koffi = require(KOFFI_PATH);
} catch (error) {
  note('load koffi', 'threw: ' + String(error && error.message));
  process.parentPort.postMessage(report);
  return;
}

// THE ENGINE, actually opened. This is what makes the host realistic rather
// than a Node process wearing its name.
try {
  const shim = koffi.load(SHIM_PATH);
  const mz_init = shim.func('int mz_init(_Out_ void **out)');
  const mz_drop = shim.func('void mz_drop(void *c)');
  const ctxOut = [null];
  const rc = mz_init(ctxOut);
  note('open the MuPDF engine through koffi', 'mz_init returned ' + rc + (ctxOut[0] ? ', context created' : ', NO context'));
  report.engineOpen = rc === 0 && !!ctxOut[0];
  if (ctxOut[0]) mz_drop(ctxOut[0]);
} catch (error) {
  note('open the MuPDF engine through koffi', 'threw: ' + String(error && error.message).slice(0, 200));
  report.engineOpen = false;
}

process.parentPort.on('message', (event) => {
  const command = event.data && event.data.command;
  if (command !== 'probe') return;

  const kernel = koffi.load('kernel32.dll');
  const advapi = koffi.load('advapi32.dll');

  // (b) process creation, and (b) memory. Both succeed with no job.
  // EACH PROBE DECIDES ITS OWN OUTCOME, where the answer is known. Classifying
  // the message afterwards was a second opinion about a question already
  // answered inside the try/catch (B3a), and it read two differently-worded
  // refusals as a difference in outcome.
  const allowed = (detail) => ({ outcome: 'allowed', detail });
  const refused = (detail) => ({ outcome: 'refused', detail });

  const cp = require('node:child_process');
  try {
    const out = cp.execFileSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 20000 });
    report.spawn = allowed('spawned ' + out.trim());
  } catch (error) {
    report.spawn = refused(String(error && error.message).slice(0, 90));
  }
  // (c) network, through a loopback listener this process owns, so a refusal
  // cannot be a runner with no connectivity.
  const net = require('node:net');
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const socket = net.connect(port, '127.0.0.1', () => {
      report.loopback = allowed('connected on ' + port);
      socket.destroy();
      server.close(() => finish());
    });
    socket.on('error', (e) => { report.loopback = refused(e.message); server.close(() => finish()); });
  });
  server.on('error', (e) => { report.loopback = refused('listen failed: ' + e.message); finish(); });

  function finish() {
    // (d) filesystem, through the caller the adversary has. The JS read is
    // recorded beside it because the two disagreeing IS the finding.
    const fs = require('node:fs');
    try {
      report.jsReadUnhanded = allowed('read ' + fs.readFileSync(process.execPath).length + ' bytes');
    } catch (error) {
      report.jsReadUnhanded = refused(String(error && error.code));
    }

    try {
      const CreateFileW = kernel.func(
        'void *CreateFileW(const char16_t *name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, void *template)'
      );
      const ReadFile = kernel.func('bool ReadFile(void *file, _Out_ void *buffer, uint32 toRead, _Out_ uint32 *read, void *overlapped)');
      const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
      const GetLastError = kernel.func('uint32 GetLastError()');
      const handle = CreateFileW(process.execPath, 0x80000000, 0x00000001, null, 3, 0, null);
      // FOUR SPELLINGS OF INVALID_HANDLE_VALUE USED TO LIVE HERE AND ALL FOUR
      // WERE FALSE for the value koffi returns (finding TT-2). The branch was
      // unreachable, so a refused open fell through to ReadFile and reported
      // ERROR_INVALID_HANDLE — the wrong call, the wrong error, and only ever on
      // a path this probe had never taken. Win32 owns this rule; one module here
      // implements it (B3a).
      if (isInvalidHandle(koffi, handle)) {
        report.nativeReadUnhanded = refused('CreateFileW: error ' + GetLastError());
      } else {
        const buffer = Buffer.alloc(4096);
        const readOut = [0];
        const ok = ReadFile(handle, buffer, buffer.length, readOut, null);
        CloseHandle(handle);
        report.nativeReadUnhanded = ok
          ? allowed('read ' + readOut[0] + ' bytes, first two ' + JSON.stringify(buffer.toString('latin1', 0, 2)))
          : refused('ReadFile: error ' + GetLastError());
      }
    } catch (error) {
      // A THROW IS NOT A REFUSAL. The FFI binding failing is a broken probe, and
      // reporting it as containment is the reassuring direction.
      report.nativeReadUnhanded = { outcome: 'error', detail: String(error && error.message).slice(0, 120) };
    }

    // MEMORY LAST, and released. Run earlier it poisons everything after it:
    // the first version committed 768 MB before the reads, and under the job's
    // limit the 235 MB file read then failed with ERR_MEMORY_ALLOCATION_FAILED
    // — which the attribution table read as the filesystem property being
    // enforced. A probe that leaves the process at its ceiling is not measuring
    // one property, it is changing the conditions of the next one.
    try {
      const chunks = [];
      for (let i = 0; i < 12; i += 1) chunks.push(Buffer.alloc(64 * 1024 * 1024, 1));
      report.commit768MB = allowed('allocated');
      chunks.length = 0;
    } catch (error) {
      report.commit768MB = refused(String(error && error.message).slice(0, 90));
    }

    process.parentPort.postMessage(report);
  }
});

// (a) integrity, lowered on command from main so the variant decides it.
process.parentPort.on('message', (event) => {
  if (!event.data || event.data.command !== 'lower') return;
  const advapi = koffi.load('advapi32.dll');
  const kernel = koffi.load('kernel32.dll');
  koffi.struct('SID_AND_ATTRIBUTES_H', { Sid: 'void *', Attributes: 'uint32' });
  koffi.struct('TOKEN_MANDATORY_LABEL_H', { Label: 'SID_AND_ATTRIBUTES_H' });
  const GetCurrentProcess = kernel.func('void *GetCurrentProcess()');
  const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
  const SetTokenInformation = advapi.func('bool SetTokenInformation(void *token, int cls, void *info, uint32 len)');
  const ConvertStringSidToSidA = advapi.func('bool ConvertStringSidToSidA(const char *str, _Out_ void **sid)');
  const sidOut = [null];
  const tokenOut = [null];
  let ok = false;
  if (ConvertStringSidToSidA('S-1-16-4096', sidOut) && OpenProcessToken(GetCurrentProcess(), 0x0080 | 0x0008, tokenOut)) {
    const label = Buffer.alloc(koffi.sizeof('TOKEN_MANDATORY_LABEL_H'));
    koffi.encode(label, 'TOKEN_MANDATORY_LABEL_H', { Label: { Sid: sidOut[0], Attributes: 0x00000020 } });
    ok = !!SetTokenInformation(tokenOut[0], 25, label, label.length);
  }
  process.parentPort.postMessage({ lowered: ok });
});
`;

const MAIN = String.raw`
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');
const koffi = require(KOFFI_PATH);

const kernel = koffi.load('kernel32.dll');
const advapi = koffi.load('advapi32.dll');

koffi.struct('IO_COUNTERS', {
  ReadOperationCount: 'uint64', WriteOperationCount: 'uint64', OtherOperationCount: 'uint64',
  ReadTransferCount: 'uint64', WriteTransferCount: 'uint64', OtherTransferCount: 'uint64',
});
koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
  PerProcessUserTimeLimit: 'int64', PerJobUserTimeLimit: 'int64', LimitFlags: 'uint32',
  MinimumWorkingSetSize: 'size_t', MaximumWorkingSetSize: 'size_t', ActiveProcessLimit: 'uint32',
  Affinity: 'size_t', PriorityClass: 'uint32', SchedulingClass: 'uint32',
});
koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
  BasicLimitInformation: 'JOBOBJECT_BASIC_LIMIT_INFORMATION', IoInfo: 'IO_COUNTERS',
  ProcessMemoryLimit: 'size_t', JobMemoryLimit: 'size_t',
  PeakProcessMemoryUsed: 'size_t', PeakJobMemoryUsed: 'size_t',
});

const CreateJobObjectW = kernel.func('void *CreateJobObjectW(void *attrs, const char16_t *name)');
const SetInformationJobObject = kernel.func('bool SetInformationJobObject(void *job, int cls, void *info, uint32 len)');
const OpenProcess = kernel.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const AssignProcessToJobObject = kernel.func('bool AssignProcessToJobObject(void *job, void *proc)');
const OpenProcessToken = advapi.func('bool OpenProcessToken(void *proc, uint32 access, _Out_ void **token)');
const GetTokenInformation = advapi.func('bool GetTokenInformation(void *token, int cls, _Out_ void *info, uint32 len, _Out_ uint32 *ret)');
const CloseHandle = kernel.func('bool CloseHandle(void *handle)');
const GetLastError = kernel.func('uint32 GetLastError()');

function childIntegrity(pid) {
  const proc = OpenProcess(0x0400 | 0x1000, false, pid);
  if (!proc) return 'OpenProcess failed: ' + GetLastError();
  try {
    const tokenOut = [null];
    if (!OpenProcessToken(proc, 0x0008, tokenOut)) return 'OpenProcessToken failed: ' + GetLastError();
    const sizeOut = [0];
    GetTokenInformation(tokenOut[0], 25, null, 0, sizeOut);
    if (!sizeOut[0]) return 'sized 0: ' + GetLastError();
    const buffer = Buffer.alloc(sizeOut[0]);
    if (!GetTokenInformation(tokenOut[0], 25, buffer, sizeOut[0], sizeOut)) return 'failed: ' + GetLastError();
    return buffer.readUInt32LE(buffer.length - 4);
  } finally { CloseHandle(proc); }
}

const VARIANTS = [
  { label: 'contained', lower: true, job: true },
  { label: 'no-integrity', lower: false, job: true },
  { label: 'no-job', lower: true, job: false },
  { label: 'uncontained', lower: false, job: false },
];

const runs = [];

function runVariant(index, done) {
  if (index >= VARIANTS.length) { done({ runs }); return; }
  const variant = VARIANTS[index];
  const steps = [];
  const child = utilityProcess.fork(join(__dirname, 'host.js'), [], {
    serviceName: 'monstera-host-fixture', stdio: 'pipe',
  });
  if (child.stderr) child.stderr.on('data', (c) => process.stdout.write('HOST_STDERR ' + String(c)));

  let settled = false;
  const settle = (payload) => {
    if (settled) return;
    settled = true;
    runs.push({ variant: variant.label, ...payload });
    try { child.kill(); } catch {}
    runVariant(index + 1, done);
  };
  setTimeout(() => settle({ error: 'no report within the window' }), 60000);

  child.on('exit', (code) => settle({ hostExitedBeforeReporting: code }));

  child.on('message', (message) => {
    if (message && message.lowered !== undefined) {
      steps.push({ step: 'host lowered its own integrity', value: message.lowered });
      steps.push({ step: 'integrity read BY MAIN, after', value: childIntegrity(child.pid) });
      child.postMessage({ command: 'probe' });
      return;
    }
    settle({ fromMain: steps, fromHost: message });
  });

  child.on('spawn', () => {
    steps.push({ step: 'integrity read BY MAIN, before', value: childIntegrity(child.pid) });

    if (variant.job) {
      const proc = OpenProcess(0x0100 | 0x0001 | 0x0400, false, child.pid);
      const job = CreateJobObjectW(null, null);
      const info = {
        BasicLimitInformation: {
          PerProcessUserTimeLimit: 0n, PerJobUserTimeLimit: 0n,
          LimitFlags: 0x00000008 | 0x00000100 | 0x00002000,
          MinimumWorkingSetSize: 0, MaximumWorkingSetSize: 0,
          ActiveProcessLimit: 1, Affinity: 0, PriorityClass: 0, SchedulingClass: 0,
        },
        IoInfo: { ReadOperationCount: 0n, WriteOperationCount: 0n, OtherOperationCount: 0n,
          ReadTransferCount: 0n, WriteTransferCount: 0n, OtherTransferCount: 0n },
        // A LITERAL, and only tolerable because this file asserts nothing. In
        // shipped code it is finding PP-4: a second opinion about §9.17's
        // mupdf-host budget, living inside a Windows struct where a number
        // survives review more easily than it would in a config object.
        //
        // RULED (ADR-0023 §2): the shipped limit is parsed from
        // memoryBudgets.mjs, takes §9.17's ABSOLUTE CAP rather than the
        // multiple — the cap is what bounds a whole process, which is what this
        // field is — and is UNDEFAULTED. A budget that cannot be read is a host
        // that does not start, because a default is how a withdrawn number
        // returns. This literal must not cross the boundary with the code.
        ProcessMemoryLimit: 512 * 1024 * 1024, JobMemoryLimit: 0,
        PeakProcessMemoryUsed: 0, PeakJobMemoryUsed: 0,
      };
      const buffer = Buffer.alloc(koffi.sizeof('JOBOBJECT_EXTENDED_LIMIT_INFORMATION'));
      koffi.encode(buffer, 'JOBOBJECT_EXTENDED_LIMIT_INFORMATION', info);
      SetInformationJobObject(job, 9, buffer, buffer.length);
      steps.push({ step: 'AssignProcessToJobObject', value: !!AssignProcessToJobObject(job, proc) });
    } else {
      steps.push({ step: 'AssignProcessToJobObject', value: 'NOT ASSIGNED (variant)' });
    }

    if (variant.lower) child.postMessage({ command: 'lower' });
    else {
      steps.push({ step: 'host lowered its own integrity', value: 'NOT LOWERED (variant)' });
      steps.push({ step: 'integrity read BY MAIN, after', value: childIntegrity(child.pid) });
      child.postMessage({ command: 'probe' });
    }
  });
}

app.whenReady().then(() => runVariant(0, (payload) => {
  process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify(payload) + '\n');
  app.exit(0);
}));

setTimeout(() => {
  process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify({ error: 'timed out', runs }) + '\n');
  app.exit(1);
}, 300000);
`;

if (!existsSync(SHIM)) {
  process.stderr.write(
    `The MuPDF shim is not built at ${SHIM}.\n` +
      `This fixture exists to measure a host that has the ENGINE in it; without the shim it would ` +
      `measure a Node process wearing the host's name, which is the mistake it was written to stop ` +
      `(QQ-2). Run \`npm run provision:mupdf\` first — do not run this without it.\n`,
  );
  process.exit(1);
}

try {
  const koffiPath = JSON.stringify(join(ROOT, 'node_modules', 'koffi'));
  writeFileSync(
    join(scratch, 'host.js'),
    `const KOFFI_PATH = ${koffiPath};\nconst SHIM_PATH = ${JSON.stringify(SHIM)};\n` +
      `${INVALID_HANDLE_SOURCE}\n${HOST}`,
    'utf8',
  );
  writeFileSync(join(scratch, 'main.js'), `const KOFFI_PATH = ${koffiPath};\n${MAIN}`, 'utf8');
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'monstera-host-fixture', version: '0.0.0', main: 'main.js' }, null, 2)}\n`,
    'utf8',
  );

  process.stdout.write(`electron: ${electronBinaryPath()}\nshim:     ${SHIM}\n\n`);

  const result = spawnSync(electronBinaryPath(), [scratch], { encoding: 'utf8', timeout: 360_000 });
  if (`${result.stderr}`.trim() !== '') process.stdout.write(`stderr:\n${result.stderr}\n`);

  const line = `${result.stdout}`.split('\n').find((entry) => entry.startsWith('MONSTERA_HOST_REPORT '));
  if (line === undefined) {
    process.stdout.write(`no report line.\nstdout:\n${result.stdout}\n`);
    process.exit(1);
  }

  /** @type {{ runs: Array<Record<string, unknown>> }} */
  const report = JSON.parse(line.slice('MONSTERA_HOST_REPORT '.length));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n\n`);

  // The attribution table, printed rather than left to a reader to assemble —
  // a property whose two variants agree is UNASSERTED, and saying so is the
  // whole point of running four variants instead of one.
  /** @param {string} label */
  const by = (label) => report.runs.find((run) => run['variant'] === label);

  /**
   * A probe's own verdict, or `unreadable` — NEVER a verdict inferred from an
   * absence.
   *
   * The first version returned a string and let the classifier fall through, so
   * a missing variant, a missing key or a probe that threw before assigning all
   * produced text that classified as *refused* — and the table printed ASSERTED
   * for a property nothing had measured. That is exactly the claim QQ-1 spent a
   * day removing from row 283, regenerated from an absent reading.
   *
   * An empty intermediate result is a broken parse, not a clean input. "Could
   * not look" and "looked and found containment" must not share an output, which
   * is why the advisory register prints UNVERIFIABLE and why this returns a
   * third state instead of a fourth guess.
   *
   * @param {string} label @param {string} key
   * @returns {{ outcome: 'allowed' | 'refused' | 'error' | 'unreadable', detail: string }}
   */
  const host = (label, key) => {
    const run = by(label);
    if (run === undefined) return { outcome: 'unreadable', detail: `no run for variant ${label}` };
    const from = /** @type {Record<string, unknown> | undefined} */ (run['fromHost']);
    if (from === undefined || from === null) {
      return { outcome: 'unreadable', detail: `variant ${label} sent no host report` };
    }
    const reading = from[key];
    if (typeof reading !== 'object' || reading === null) {
      return { outcome: 'unreadable', detail: `variant ${label} has no reading for ${key}` };
    }
    const { outcome, detail } = /** @type {{ outcome?: unknown, detail?: unknown }} */ (reading);
    if (outcome !== 'allowed' && outcome !== 'refused' && outcome !== 'error') {
      return { outcome: 'unreadable', detail: `variant ${label} reported ${JSON.stringify(outcome)}` };
    }
    return { outcome, detail: String(detail ?? '') };
  };

  /**
   * Each property against the variant that removes ONLY its own mechanism, with
   * everything else held constant.
   *
   * `(b) process creation` is compared across the two MEDIUM-integrity variants
   * rather than the two lowered ones, because Low integrity refuses the spawn by
   * itself: with both mechanisms present the outcome is over-determined and the
   * job's contribution is unreadable. That is the union problem this table
   * exists to expose, and it appeared on the first run.
   *
   * @type {Array<[string, string, string, string]>}
   */
  const rows = [
    ['(b) process creation — job alone', 'spawn', 'no-integrity', 'uncontained'],
    ['(b) process creation — integrity alone', 'spawn', 'no-job', 'uncontained'],
    ['(b) memory', 'commit768MB', 'contained', 'no-job'],
    ['(c) network', 'loopback', 'contained', 'uncontained'],
    ['(d) filesystem, native', 'nativeReadUnhanded', 'contained', 'uncontained'],
    ['(d) filesystem, JS', 'jsReadUnhanded', 'contained', 'uncontained'],
  ];

  process.stdout.write(`ATTRIBUTION — a property whose two variants AGREE is UNASSERTED\n\n`);

  // (a) is read by MAIN, not by the host, so it comes from a different place in
  // the report and needs its own row rather than being left implicit in the
  // JSON above. 0x2000 is Medium, 0x1000 is Low.
  {
    /** @param {string} label @returns {string} */
    const after = (label) => {
      const run = by(label);
      const steps = /** @type {Array<{ step: string, value: unknown }> | undefined} */ (
        run?.['fromMain']
      );
      const value = steps?.find((entry) => entry.step.includes('after'))?.value;
      return typeof value === 'number' ? `0x${value.toString(16)}` : String(value);
    };
    const lowered = after('contained');
    const left = after('no-integrity');
    process.stdout.write(
      `  ${lowered !== left ? 'ASSERTED  ' : 'UNASSERTED'} (a) integrity level, read by main\n` +
        `      contained     ${lowered}\n` +
        `      no-integrity  ${left}\n`,
    );
  }

  /**
   * One row's verdict. `unreadable` on either side is terminal: it is neither
   * ASSERTED nor UNASSERTED, because both of those are claims about what was
   * measured, and nothing was.
   *
   * @param {{ outcome: string, detail: string }} a
   * @param {{ outcome: string, detail: string }} b
   * @returns {'ASSERTED' | 'UNASSERTED' | 'UNREADABLE'}
   */
  const verdict = (a, b) => {
    if (a.outcome === 'unreadable' || b.outcome === 'unreadable') return 'UNREADABLE';
    if (a.outcome === 'error' || b.outcome === 'error') return 'UNREADABLE';
    return a.outcome !== b.outcome ? 'ASSERTED' : 'UNASSERTED';
  };

  let unreadable = 0;
  for (const [property, key, withMech, without] of rows) {
    const a = host(withMech, key);
    const b = host(without, key);
    const decided = verdict(a, b);
    if (decided === 'UNREADABLE') unreadable += 1;
    process.stdout.write(
      `  ${decided.padEnd(10)} ${property}\n` +
        `      ${withMech.padEnd(13)} ${a.outcome.padEnd(10)} ${a.detail}\n` +
        `      ${without.padEnd(13)} ${b.outcome.padEnd(10)} ${b.detail}\n`,
    );
  }

  // ---------------------------------------------------------------------------
  // The control for that rule, run every time rather than trusted.
  //
  // MUTATED ON THE CONTAINED SIDE deliberately. Removing the UNCONTAINED side
  // passes today for the wrong reason — two missing readings AGREE, so the row
  // prints UNASSERTED — and that direction never reaches the defect. Only a
  // missing CONTAINED reading beside a present uncontained one can manufacture
  // the reassuring verdict.
  // ---------------------------------------------------------------------------
  {
    const saved = report.runs;
    report.runs = saved.map((run) =>
      run['variant'] === 'contained'
        ? {
            ...run,
            fromHost: Object.fromEntries(
              Object.entries(/** @type {Record<string, unknown>} */ (run['fromHost'] ?? {})).filter(
                ([key]) => key !== 'nativeReadUnhanded',
              ),
            ),
          }
        : run,
    );
    const missing = verdict(
      host('contained', 'nativeReadUnhanded'),
      host('uncontained', 'nativeReadUnhanded'),
    );
    report.runs = saved;

    process.stdout.write(
      `\n  CONTROL: with the CONTAINED reading removed, the row is ${missing}\n` +
        `      It must be UNREADABLE. Classified from prose it read as "refused" beside an ` +
        `allowed uncontained side, so the table printed ASSERTED for a property nothing had\n` +
        `      measured — the exact claim QQ-1 removed from row 283, regenerated by an absent value.\n`,
    );
    if (missing !== 'UNREADABLE') unreadable += 1;
  }

  if (unreadable > 0) {
    process.stderr.write(
      `\n${String(unreadable)} row(s) could not be read. That is not a result: this exits non-zero ` +
        `rather than printing a verdict it did not measure.\n`,
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
