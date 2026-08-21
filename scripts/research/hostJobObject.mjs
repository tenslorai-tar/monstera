// @ts-check
/**
 * Can main put a utility process in a job object? Measured on the pinned
 * Electron.
 *
 * This is invariant 25's property (b) — *a job object bounding memory and
 * process creation* — and it is worth measuring BEFORE the open question about
 * properties (c) and (d) is settled, because the answer does not depend on it.
 * Whether the engine host stays an Electron `utilityProcess` or becomes a child
 * this application creates itself, a job object is how (b) is obtained on
 * Windows, and it is assigned from outside either way.
 *
 * `hostSurface.mjs` established the one fact this needs: `child.pid` is visible
 * from main. So `OpenProcess` → `AssignProcessToJobObject` is mechanically open
 * through the koffi FFI already carried for MuPDF.
 *
 * The question that decides whether it is *actually* open:
 *
 * **Chromium may already have put the utility process in a job.** A process
 * belongs to one job unless the jobs nest, so if Electron assigns one, ours has
 * to nest inside it — and nesting has its own rules about which limits survive.
 * `IsProcessInJob` is asked BEFORE assigning, because discovering this after a
 * failed assignment would leave two candidate explanations for one error code.
 *
 * What is measured, in order:
 *
 *   1. whether the host is already in a job, asked from main before anything;
 *   2. whether `AssignProcessToJobObject` succeeds, with the error if not;
 *   3. whether the host is in a job afterwards — asked again, because the call
 *      returning true is not the same as the assignment being in force;
 *   4. what the host can still DO under the job: spawn a process, and commit
 *      more memory than the job permits.
 *
 * Step 4 is the point, and both probes are built the HH-2 way — from actions
 * that SUCCEED without the job. The spawn target is the Electron binary the
 * host is already running, and the allocation is of a size the same host
 * allocates freely when unconstrained, so a refusal is the job and not the
 * machine.
 *
 * **Research, not a proof.** It asserts nothing and gates nothing.
 *
 * Usage: node scripts/research/hostJobObject.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { electronBinaryPath } from '../provision/electron.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'monstera-job-'));

/** Runs inside the host, once main says the job is assigned. */
const HOST = String.raw`
process.parentPort.on('message', (event) => {
  const report = { steps: [] };
  const note = (step, value) => report.steps.push({ step, value });
  note('what main did', event.data);

  const cp = require('node:child_process');
  try {
    const out = cp.execFileSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 20000 });
    note('spawn a process UNDER the job', 'spawned, said ' + out.trim());
  } catch (error) {
    note('spawn a process UNDER the job', 'refused: ' + String(error && error.message).slice(0, 200));
  }

  // COMMITTED, not reserved. A Buffer.alloc is zero-filled, so the pages are
  // touched — a reservation would be permitted by a commit limit and would make
  // this probe agree with an absent job.
  try {
    const chunks = [];
    for (let i = 0; i < 12; i += 1) chunks.push(Buffer.alloc(64 * 1024 * 1024, 1));
    note('commit 768 MB under a job limited below it', 'allocated ' + chunks.length * 64 + ' MB');
  } catch (error) {
    note('commit 768 MB under a job limited below it', 'refused: ' + String(error && error.message).slice(0, 200));
  }

  process.parentPort.postMessage(report);
});
`;

const MAIN = String.raw`
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');
const koffi = require(KOFFI_PATH);

const kernel = koffi.load('kernel32.dll');

koffi.struct('IO_COUNTERS', {
  ReadOperationCount: 'uint64',
  WriteOperationCount: 'uint64',
  OtherOperationCount: 'uint64',
  ReadTransferCount: 'uint64',
  WriteTransferCount: 'uint64',
  OtherTransferCount: 'uint64',
});
koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
  PerProcessUserTimeLimit: 'int64',
  PerJobUserTimeLimit: 'int64',
  LimitFlags: 'uint32',
  MinimumWorkingSetSize: 'size_t',
  MaximumWorkingSetSize: 'size_t',
  ActiveProcessLimit: 'uint32',
  Affinity: 'size_t',
  PriorityClass: 'uint32',
  SchedulingClass: 'uint32',
});
koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
  BasicLimitInformation: 'JOBOBJECT_BASIC_LIMIT_INFORMATION',
  IoInfo: 'IO_COUNTERS',
  ProcessMemoryLimit: 'size_t',
  JobMemoryLimit: 'size_t',
  PeakProcessMemoryUsed: 'size_t',
  PeakJobMemoryUsed: 'size_t',
});

const CreateJobObjectW = kernel.func('void *CreateJobObjectW(void *attrs, const char16_t *name)');
const SetInformationJobObject = kernel.func(
  'bool SetInformationJobObject(void *job, int cls, void *info, uint32 len)'
);
const OpenProcess = kernel.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
const AssignProcessToJobObject = kernel.func('bool AssignProcessToJobObject(void *job, void *proc)');
const IsProcessInJob = kernel.func('bool IsProcessInJob(void *proc, void *job, _Out_ bool *result)');
const GetLastError = kernel.func('uint32 GetLastError()');

const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_INFORMATION = 0x0400;

const runs = [];

// TWO RUNS, and the first is the one that makes the second mean anything.
//
// The probes below are refusals, and a refusal proves nothing unless the same
// action SUCCEEDS without the guard. Nothing here had measured that: a host
// that cannot spawn and cannot commit 768 MB looks identical whether the job is
// doing it or the machine is. So the control run assigns no job and must show
// both probes succeeding.
//
// This is II-2's differential — flip the one thing, require the other side to
// stay green — and it is the shape a run that only ever assigns the job cannot
// produce.
const VARIANTS = [
  { label: 'CONTROL: no job assigned', assign: false },
  { label: 'job assigned from main', assign: true },
];

function runVariant(index, done) {
  if (index >= VARIANTS.length) {
    done({ runs });
    return;
  }
  const variant = VARIANTS[index];
  const steps = [];
  const note = (step, value) => steps.push({ step, value });

  const child = utilityProcess.fork(join(__dirname, 'host.js'), [], {
    serviceName: 'monstera-job-research',
    stdio: 'pipe',
  });
  if (child.stderr) child.stderr.on('data', (c) => process.stdout.write('HOST_STDERR ' + String(c)));

  let settled = false;
  const settle = (payload) => {
    if (settled) return;
    settled = true;
    runs.push({ variant: variant.label, fromMain: steps, ...payload });
    try {
      child.kill();
    } catch {}
    runVariant(index + 1, done);
  };

  child.on('message', (message) => settle({ fromHost: message }));
  child.on('exit', (code) => settle({ hostExitedBeforeReporting: code }));
  setTimeout(() => settle({ error: 'no report within the window' }), 60000);

  child.on('spawn', () => {
    const pid = child.pid;
    note('pid visible from main', pid ?? null);

    if (!variant.assign) {
      child.postMessage({ assigned: false, why: 'control run, deliberately unassigned' });
      return;
    }

    const proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_INFORMATION, false, pid);
    if (!proc) {
      note('OpenProcess', 'failed, error ' + GetLastError());
      child.postMessage({ assigned: false, why: 'OpenProcess failed' });
      return;
    }

    // ASKED FIRST. A process belongs to one job unless they nest, so if
    // Chromium already assigned one, a later failure would have two candidate
    // explanations and this call is what separates them.
    const alreadyOut = [false];
    const askedBefore = IsProcessInJob(proc, null, alreadyOut);
    note('IsProcessInJob BEFORE assigning (any job)', askedBefore ? alreadyOut[0] : 'call failed ' + GetLastError());

    const job = CreateJobObjectW(null, null);
    if (!job) {
      note('CreateJobObject', 'failed, error ' + GetLastError());
      child.postMessage({ assigned: false, why: 'CreateJobObject failed' });
      return;
    }

    const info = {
      BasicLimitInformation: {
        PerProcessUserTimeLimit: 0n,
        PerJobUserTimeLimit: 0n,
        LimitFlags:
          JOB_OBJECT_LIMIT_ACTIVE_PROCESS |
          JOB_OBJECT_LIMIT_PROCESS_MEMORY |
          JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        MinimumWorkingSetSize: 0,
        MaximumWorkingSetSize: 0,
        // ONE: the host itself, and nothing it tries to start.
        ActiveProcessLimit: 1,
        Affinity: 0,
        PriorityClass: 0,
        SchedulingClass: 0,
      },
      IoInfo: {
        ReadOperationCount: 0n, WriteOperationCount: 0n, OtherOperationCount: 0n,
        ReadTransferCount: 0n, WriteTransferCount: 0n, OtherTransferCount: 0n,
      },
      ProcessMemoryLimit: 512 * 1024 * 1024,
      JobMemoryLimit: 0,
      PeakProcessMemoryUsed: 0,
      PeakJobMemoryUsed: 0,
    };
    const buffer = Buffer.alloc(koffi.sizeof('JOBOBJECT_EXTENDED_LIMIT_INFORMATION'));
    koffi.encode(buffer, 'JOBOBJECT_EXTENDED_LIMIT_INFORMATION', info);

    const set = SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, buffer.length);
    note('SetInformationJobObject', set ? true : 'failed, error ' + GetLastError());

    const assigned = AssignProcessToJobObject(job, proc);
    note('AssignProcessToJobObject', assigned ? true : 'failed, error ' + GetLastError());

    // ASKED AGAIN. The call returning true is not the assignment being in
    // force, and this is the only reading that distinguishes them.
    const afterOut = [false];
    const askedAfter = IsProcessInJob(proc, job, afterOut);
    note('IsProcessInJob AFTER assigning (OUR job)', askedAfter ? afterOut[0] : 'call failed ' + GetLastError());

    child.postMessage({
      assigned,
      activeProcessLimit: 1,
      processMemoryLimitMB: 512,
    });
  });
}

app.whenReady().then(() => {
  runVariant(0, (payload) => {
    process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify(payload) + '\n');
    app.exit(0);
  });
});

setTimeout(() => {
  process.stdout.write('MONSTERA_HOST_REPORT ' + JSON.stringify({ error: 'timed out', runs }) + '\n');
  app.exit(1);
}, 180000);
`;

try {
  const koffiPath = JSON.stringify(join(process.cwd(), 'node_modules', 'koffi'));
  writeFileSync(join(scratch, 'host.js'), HOST, 'utf8');
  writeFileSync(join(scratch, 'main.js'), `const KOFFI_PATH = ${koffiPath};\n${MAIN}`, 'utf8');
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'monstera-job-research', version: '0.0.0', main: 'main.js' }, null, 2)}\n`,
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
  process.stdout.write(`${JSON.stringify(JSON.parse(line.slice('MONSTERA_HOST_REPORT '.length)), null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
