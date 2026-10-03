// @ts-check
/**
 * The engine host's Win32 hardening, each property on the SHIPPED surfaces against a real kernel object, each with the
 * control that shows the property's absence is a real state (the CR-SEC findings of 2026-10-03's code review).
 *
 * ## The pipe's name cannot be taken first (CR-SEC-14)
 *
 * `CreateNamedPipeW` on a name that already exists succeeds as another INSTANCE of the existing pipe, whose creator
 * chose its security and holds an instance of its own, so the host's connect could reach that process. The instance
 * that creates the name carries `FILE_FLAG_FIRST_PIPE_INSTANCE`, and then the call is refused.
 *
 * - with another process holding the name, the shipped factory refuses at instance 0 and says the name existed;
 * - CONTROL: the shipped surface's call WITHOUT the flag, against the same held name, answers an instance — so the
 *   refusal above is the flag's, not a name nothing could create;
 * - with the name free, the factory creates its pipe, so the flag refuses a squat and not every creation.
 *
 * The holder is a separate process because that is the threat: a name another process created.
 *
 * ## The job carries every UI restriction (CR-SEC-11)
 *
 * The shipped surface's `applyLimits` on a real job, then `readJobLimits` read back off it: the UI restrictions are
 * the whole set `containment.ts` names. CONTROL: a fresh job read the same way shows none, so the read can see an
 * absence rather than answering the set for any job. What a probe in that job can no longer reach was measured on
 * Windows 11 and is in `containment.ts`; the factory's refusal of a job lacking any one is `engineHostFactory.test.ts`.
 *
 * Usage: node scripts/proofs/hostHardening.proof.mjs [--require-transport]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { HOST_HARDENING, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const SELF = fileURLToPath(import.meta.url);
const BUILT = {
  pipeSurface: join(ROOT, 'apps', 'desktop', 'dist', 'win32PipeSurface.js'),
  pipeFactory: join(ROOT, 'apps', 'desktop', 'dist', 'enginePipeFactory.js'),
  dacl: join(ROOT, 'apps', 'desktop', 'dist', 'hostDacl.js'),
  hostSurface: join(ROOT, 'apps', 'desktop', 'dist', 'win32HostSurface.js'),
  containment: join(ROOT, 'packages', 'kernel', 'dist', 'host', 'containment.js'),
};
/** `PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED`, `PIPE_UNLIMITED_INSTANCES`: a holder as permissive as a name can be. */
const HOLDER_OPEN_MODE = 0x00000003 | 0x40000000;
const UNLIMITED_INSTANCES = 255;
const ERROR_ACCESS_DENIED = 5;

// ---------------------------------------------------------------------------------------------------------------
// THE HOLDER: another process that creates the name first and keeps it until its stdin closes.

if (process.argv[2] === 'hold-pipe') {
  const koffi = createRequire(join(ROOT, 'package.json'))('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const create = kernel32.func(
    'void *CreateNamedPipeW(const char16_t *name, uint32 openMode, uint32 pipeMode, uint32 maxInstances, ' +
      'uint32 outBuffer, uint32 inBuffer, uint32 timeout, void *securityAttributes)',
  );
  const handle = create(process.argv[3], HOLDER_OPEN_MODE, 0, UNLIMITED_INSTANCES, 4096, 4096, 0, null);
  const value = koffi.address(handle);
  process.stdout.write(value === 0n || value === 0xffffffffffffffffn ? 'refused\n' : 'held\n');
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
} else {
  // ---------------------------------------------------------------------------------------------------------------
  // THE PARENT.

  const REQUIRE = process.argv.includes('--require-transport');
  if (process.platform !== 'win32') {
    exitUnverifiable({
      required: REQUIRE,
      subject: "the engine host's Win32 hardening",
      why: `this creates Win32 named pipes, which do not exist on ${process.platform}.`,
      flag: '--require-transport',
    });
  }
  for (const built of Object.values(BUILT)) {
    if (!existsSync(built)) {
      exitUnverifiable({
        required: REQUIRE,
        subject: "the engine host's Win32 hardening",
        why: `${built} is not built; this runs the shipped surfaces rather than a copy. Run \`npm run build\`.`,
        flag: '--require-transport',
      });
    }
  }
  refuseStaleBuild(ROOT, HOST_HARDENING, 5);

  const { createWin32PipeSurface, currentUserSid, hostContainerSid } = await import(
    '../../apps/desktop/dist/win32PipeSurface.js'
  );
  const { createHostPipe } = await import('../../apps/desktop/dist/enginePipeFactory.js');
  const { hostPipeDacl } = await import('../../apps/desktop/dist/hostDacl.js');
  // A COMPUTED SPECIFIER, as every plain-Node driver of the surface imports it (`electronBinaryCallers.mjs`): the
  // executable is then named by the resolver itself, which is what that scan checks.
  const { createWin32HostSurface } = await import(pathToFileURL(BUILT.hostSurface).href);
  const { JOB_UI_RESTRICTIONS_ALL } = await import('../../packages/kernel/dist/host/containment.js');

  /** @type {string[]} */
  const failures = [];
  const roster = createRoster(failures, { cases: 5 });
  /** @param {string} label @param {boolean} held @param {string} detail */
  const check = (label, held, detail) => {
    const mark = roster.mark();
    if (!held) failures.push(`${label}\n      ${detail}`);
    roster.record(mark, label);
  };

  const pipes = createWin32PipeSurface();
  const user = currentUserSid();
  const container = hostContainerSid('monstera-host-hardening-proof');
  if (!user.ok || !container.ok) throw new Error('the SIDs could not be resolved, so no pipe can be built');

  /** Another process creates `name` first; resolves once it holds it, with a `release` that ends it. @param {string} name */
  const holdElsewhere = async (name) => {
    const holder = spawn(process.execPath, [SELF, 'hold-pipe', name], { stdio: ['pipe', 'pipe', 'inherit'] });
    const said = await new Promise((answer) => holder.stdout.once('data', (chunk) => answer(String(chunk).trim())));
    if (said !== 'held') throw new Error(`the holding process could not create ${name}: ${String(said)}`);
    const ended = new Promise((done) => holder.once('exit', done));
    return {
      release: async () => {
        holder.stdin.end();
        await ended;
      },
    };
  };

  const squatted = `\\\\.\\pipe\\monstera-hardening-squat-${String(process.pid)}`;
  const holder = await holdElsewhere(squatted);
  try {
    const refused = createHostPipe(pipes, squatted, user.value, container.value, 1);
    check(
      'with another process holding the name, the shipped factory refuses at instance 0 and says the name existed',
      !refused.ok &&
        refused.error.stage === 'instance' &&
        refused.error.detail.includes(`GetLastError ${String(ERROR_ACCESS_DENIED)}`) &&
        refused.error.detail.includes('another process created this pipe first'),
      refused.ok ? 'the factory answered a pipe under a name another process created' : refused.error.detail,
    );
    if (refused.ok) for (const instance of refused.value.instances) pipes.close(instance);

    const descriptor = pipes.describe(hostPipeDacl(user.value, container.value));
    if (descriptor === null) throw new Error("the host pipe's DACL did not parse");
    const joined = pipes.createInstance(squatted, descriptor, 1, false);
    pipes.freeDescriptor(descriptor);
    check(
      'CONTROL: the same call without the first-instance flag answers an instance of the held name',
      joined !== null,
      `refused with GetLastError ${String(pipes.lastError())} — the held name is not one this process can join, so the case above proves nothing about the flag`,
    );
    if (joined !== null) pipes.close(joined);
  } finally {
    await holder.release();
  }

  const free = `\\\\.\\pipe\\monstera-hardening-free-${String(process.pid)}`;
  const made = createHostPipe(pipes, free, user.value, container.value, 1);
  check(
    'with the name free, the shipped factory creates its pipe',
    made.ok && made.value.instances.length === 1,
    made.ok ? `${String(made.value.instances.length)} instance(s)` : made.error.detail,
  );
  if (made.ok) for (const instance of made.value.instances) pipes.close(instance);

  // THE JOB'S UI RESTRICTIONS. Only the job calls are made: no process is created, so the configuration below is the
  // surface's required shape and nothing runs from it.
  const hostSurface = createWin32HostSurface({
    program: {
      runs: 'electron-node',
      // THE PROVISIONED RUNTIME, by the one resolver `check:electronbinary` admits for a plain-Node caller.
      executablePath: electronBinaryPath(ROOT),
      commandArguments: [],
    },
    workingDirectory: ROOT,
    containerName: null,
    diagnosticPath: null,
  });
  const limited = hostSurface.createJob();
  const fresh = hostSurface.createJob();
  if (limited === null || fresh === null) throw new Error('CreateJobObjectW returned no handle');
  try {
    const applied = hostSurface.applyLimits(limited, 512 * 1024 * 1024);
    const read = hostSurface.readJobLimits(limited);
    check(
      'the shipped surface applies every UI restriction, read back off the job',
      applied && read.kind === 'read' && read.uiRestrictions === JOB_UI_RESTRICTIONS_ALL,
      `applied ${String(applied)}; read ${JSON.stringify(read)}; expected 0x${JOB_UI_RESTRICTIONS_ALL.toString(16)}`,
    );
    const untouched = hostSurface.readJobLimits(fresh);
    check(
      'CONTROL: a fresh job read the same way shows no UI restriction',
      untouched.kind === 'read' && untouched.uiRestrictions === 0,
      `read ${JSON.stringify(untouched)}`,
    );
  } finally {
    hostSurface.close(limited);
    hostSurface.close(fresh);
  }

  if (failures.length > 0) {
    process.stderr.write(`\nHost hardening proof — ${String(failures.length)} failure(s):\n\n${failures.map((f) => `  - ${f}`).join('\n\n')}\n\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${roster.format('host hardening case')}\n`);
  }
}
