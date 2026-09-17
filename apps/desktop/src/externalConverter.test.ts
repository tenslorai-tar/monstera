import {
  type IntegrityReading,
  type JobLimitsReading,
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
} from '@monstera/kernel';
import { ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import { type ConverterSurface, type ExitReading, runContainedConverter } from './externalConverter.js';

/**
 * The external-converter seam's runner (§8), against a surface that records.
 *
 * What these cases are about is the END of a conversion — the part a host does
 * not have. Starting contained is `createContainedHost`'s, and
 * `engineHostFactory.test.ts` owns its cases; here the default surface reads as
 * contained so every case reaches the wait.
 */

const aProcess = { __handle: 'process' } as ProcessHandle;
const aThread = { __handle: 'thread' } as ThreadHandle;
const aJob = { __handle: 'job' } as JobHandle;
const BOUNDS = { processMemoryLimitBytes: 256 * 1024 * 1024, timeoutMs: 5_000 };

function recording(exit: ExitReading, said: string | null = null): {
  readonly surface: ConverterSurface;
  readonly calls: string[];
} {
  const calls: string[] = [];
  let limit = 0;
  const surface: ConverterSurface = {
    createSuspended: () => ok({ pid: 7, process: aProcess, thread: aThread }),
    createJob: () => aJob,
    applyLimits: (_job, bytes) => {
      limit = bytes;
      return true;
    },
    assignToJob: () => true,
    readJobMembership: () => 'in-job',
    readIntegrity: (): IntegrityReading => ({ kind: 'read', rid: INTEGRITY_LOW }),
    readJobLimits: (): JobLimitsReading => ({
      kind: 'read',
      limitFlags: JOB_LIMIT_ACTIVE_PROCESS | JOB_LIMIT_PROCESS_MEMORY | JOB_LIMIT_KILL_ON_JOB_CLOSE,
      activeProcessLimit: 1,
      processMemoryLimitBytes: limit,
    }),
    resume: () => 1,
    terminate: () => {
      calls.push('terminate');
    },
    close: (handle) => {
      calls.push(`close:${handle.__handle}`);
    },
    diagnostics: () => said,
    discardDiagnostics: () => {
      calls.push('discardDiagnostics');
    },
    waitForExit: (_process, timeoutMs) => {
      calls.push(`wait:${String(timeoutMs)}`);
      return Promise.resolve(exit);
    },
  };
  return { surface, calls };
}

describe('runContainedConverter', () => {
  it('a converter that EXITS 0 succeeds, and its process and job are both closed', async () => {
    const { surface, calls } = recording({ kind: 'exited', code: 0 });

    const result = await runContainedConverter(surface, BOUNDS);

    expect(result.ok).toBe(true);
    // The bound reached the wait, and nothing was terminated: a clean exit
    // leaves nothing to kill, and a runner that terminated anyway would be
    // indistinguishable here only if this list were not asserted.
    expect(calls).toStrictEqual(['close:thread', 'wait:5000', 'close:process', 'close:job', 'discardDiagnostics']);
  });

  it('a converter past its TIME BOUND is terminated, and says so', async () => {
    // §8: "a hung conversion is terminated". The job close that follows would
    // kill it too; the terminate is asserted because it is the decision.
    const { surface, calls } = recording({ kind: 'timed-out' });

    const result = await runContainedConverter(surface, BOUNDS);

    expect(result).toStrictEqual({ ok: false, error: { stage: 'timed-out', afterMs: 5_000 } });
    expect(calls).toContain('terminate');
    expect(calls.slice(-3)).toStrictEqual(['close:process', 'close:job', 'discardDiagnostics']);
  });

  it('a NON-ZERO exit is a failure carrying what the converter said, and is not terminated', async () => {
    const { surface, calls } = recording({ kind: 'exited', code: 3 }, "I/O Error: Couldn't open file");

    const result = await runContainedConverter(surface, BOUNDS);

    expect(result).toStrictEqual({
      ok: false,
      error: { stage: 'exit-code', code: 3, said: "I/O Error: Couldn't open file" },
    });
    expect(calls).not.toContain('terminate');
  });

  it('an UNREADABLE exit is could-not-look, never success, and the process is terminated', async () => {
    const { surface, calls } = recording({ kind: 'unreadable', detail: 'GetExitCodeProcess failed: 6' });

    const result = await runContainedConverter(surface, BOUNDS);

    expect(result).toStrictEqual({
      ok: false,
      error: { stage: 'exit-unreadable', detail: 'GetExitCodeProcess failed: 6' },
    });
    expect(calls).toContain('terminate');
  });

  it('a converter that does not start contained is never waited on', async () => {
    const { surface, calls } = recording({ kind: 'exited', code: 0 });
    const outside: ConverterSurface = { ...surface, readJobMembership: () => 'not-in-job' };

    const result = await runContainedConverter(outside, BOUNDS);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.stage).toBe('start');
    expect(calls.some((call) => call.startsWith('wait'))).toBe(false);
  });

  it('refuses a time bound that is not a positive whole number of milliseconds', async () => {
    const { surface } = recording({ kind: 'exited', code: 0 });
    await expect(runContainedConverter(surface, { ...BOUNDS, timeoutMs: 0 })).rejects.toThrow(/timeoutMs/u);
  });
});
