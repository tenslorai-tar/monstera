import { err, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES } from './budget.js';
import {
  type CreatedProcess,
  type HostCreationSurface,
  type JobHandle,
  type JobMembership,
  type ProcessHandle,
  type ThreadHandle,
  createContainedHost,
} from './engineHostFactory.js';

/**
 * A recording Win32 surface.
 *
 * The ORDER matters more than any single call here — Decision 8 is a claim
 * about sequence — so every call appends to one list and the cases assert
 * against it. A surface with per-call spies would let "assign before resume"
 * pass against a factory that did both in the wrong order.
 */
interface Recorder extends HostCreationSurface {
  readonly calls: string[];
}

const aProcess = { __handle: 'process' } as ProcessHandle;
const aThread = { __handle: 'thread' } as ThreadHandle;
const aJob = { __handle: 'job' } as JobHandle;

const created: CreatedProcess = { pid: 4242, process: aProcess, thread: aThread };

function surface(
  overrides: Partial<HostCreationSurface> & { readonly membership?: JobMembership } = {},
): Recorder {
  const calls: string[] = [];

  // RECORDING WRAPS THE OVERRIDE, not the default.
  //
  // The first version recorded inside each default and spread the overrides on
  // top, so replacing a member replaced its recording too — a case asserting
  // the call sequence after overriding `createSuspended` was asserting against
  // a list that had stopped observing the call it was about. It reported an
  // empty sequence, which reads exactly like a factory that did nothing.
  const record = <A extends unknown[], R>(
    name: string,
    fallback: (...args: A) => R,
    override: ((...args: A) => R) | undefined,
    label?: (...args: A) => string,
  ): ((...args: A) => R) => {
    return (...args: A): R => {
      calls.push(label === undefined ? name : label(...args));
      return (override ?? fallback)(...args);
    };
  };

  return {
    calls,
    createSuspended: record(
      'createSuspended',
      (): ReturnType<HostCreationSurface['createSuspended']> => ok(created),
      overrides.createSuspended,
    ),
    createJob: record('createJob', (): JobHandle | null => aJob, overrides.createJob),
    applyLimits: record(
      'applyLimits',
      (_job: JobHandle, _limit: number) => true,
      overrides.applyLimits,
      (_job, limit) => `applyLimits:${String(limit)}`,
    ),
    assignToJob: record(
      'assignToJob',
      (_job: JobHandle, _process: ProcessHandle) => true,
      overrides.assignToJob,
    ),
    readJobMembership: record(
      'readJobMembership',
      (_process: ProcessHandle, _job: JobHandle): JobMembership => overrides.membership ?? 'in-job',
      overrides.readJobMembership,
    ),
    resume: record('resume', (_thread: ThreadHandle): number | null => 1, overrides.resume),
    terminate: record('terminate', (_process: ProcessHandle): void => undefined, overrides.terminate),
    close: record(
      'close',
      (_handle: ProcessHandle | ThreadHandle | JobHandle): void => undefined,
      overrides.close,
      (handle) => `close:${handle.__handle}`,
    ),
    // NOT RECORDED. `createContainedHost` must never touch either: the
    // diagnostics belong to whoever waits for the peer, and every case in this
    // file asserts on `calls` as a whole sequence — so a factory that started
    // reading them would be caught by the assertions already here rather than
    // by a new one.
    diagnostics: (): string | null => null,
    discardDiagnostics: (): void => undefined,
  };
}

describe('the contained host is created in one order', () => {
  it('assigns the job and verifies membership BEFORE the first instruction runs', () => {
    const win32 = surface();
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(true);
    // The whole requirement, read off the sequence: resume is last, and the
    // membership READ sits between the assign and it.
    expect(win32.calls).toStrictEqual([
      'createSuspended',
      'createJob',
      `applyLimits:${String(ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES)}`,
      'assignToJob',
      'readJobMembership',
      'resume',
      'close:thread',
    ]);
  });

  it('returns the job handle, because closing it is what kills the host', () => {
    const win32 = surface();
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok && result.value).toStrictEqual({ pid: 4242, process: aProcess, job: aJob });
  });

  it('passes the caller\'s memory limit through, undefaulted', () => {
    const win32 = surface();
    createContainedHost(win32, 123_456);

    expect(win32.calls).toContain('applyLimits:123456');
  });

  it('refuses a memory limit Win32 would read as "no limit"', () => {
    expect(() => createContainedHost(surface(), 0)).toThrow(RangeError);
    expect(() => createContainedHost(surface(), -1)).toThrow(RangeError);
    expect(() => createContainedHost(surface(), 1.5)).toThrow(RangeError);
  });
});

describe('a failed job assignment kills the process, never resumes it', () => {
  it('terminates when the process is NOT in the job, whatever assign returned', () => {
    const win32 = surface({ membership: 'not-in-job' });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('job-assign');
    expect(win32.calls).not.toContain('resume');
    expect(win32.calls).toContain('terminate');
  });

  it('CONTROL: and the assign call returning TRUE does not rescue it', () => {
    // The base surface already returns true from `assignToJob`, so this case is
    // the `available: true` shape: the call said yes and the process is not in
    // the job. Without this, "membership decides" is satisfied by a factory
    // that reads the assign boolean and happens to agree with it.
    const win32 = surface({ membership: 'not-in-job', assignToJob: () => true });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    expect(win32.calls).not.toContain('resume');
  });

  // ---------------------------------------------------------------------------
  // THE OTHER DIRECTION, and it was proven by nothing until the stage audit
  // (finding NNN-1).
  //
  // Every case above holds `assignToJob` at TRUE, so the whole fixture set only
  // ever asks whether a yes from the assign call can be overruled. Replacing
  // the read with `assigned ? read : 'not-in-job'` — a factory that trusts a NO
  // and does not look — passed all twenty-one of them. That is a materially
  // different program: it refuses a host that IS in its job, correctly limited,
  // because one boolean said otherwise.
  //
  // The claim in the code is "the read decides", not "a true assign is not
  // enough". Holding assign at FALSE across the next two cases and varying only
  // the read is what makes the read the variable.
  // ---------------------------------------------------------------------------
  it('creates the host when assign reported FALSE and the process is in the job', () => {
    const win32 = surface({ assignToJob: () => false, membership: 'in-job' });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    // `IsProcessInJob` was asked about OUR handle, so an in-job answer means the
    // process is in the job carrying our limits. The containment property is a
    // fact about the kernel's state, and the assign call's return value is a
    // report about it — when they disagree, the state is what is true.
    expect(result.ok).toBe(true);
    expect(win32.calls).toContain('resume');
    expect(win32.calls).not.toContain('terminate');
  });

  it('CONTROL: with assign still FALSE, a not-in-job read refuses', () => {
    // Without this, the case above is satisfied by a factory that ignores the
    // assign call *and* the read — one that always proceeds. Both cases hold
    // assign at false, so the read is the only thing that moved.
    const win32 = surface({ assignToJob: () => false, membership: 'not-in-job' });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    expect(win32.calls).not.toContain('resume');
    expect(win32.calls).toContain('terminate');
  });

  it('names job-membership, not job-assign, when assign said no and nothing could look', () => {
    const win32 = surface({ assignToJob: () => false, membership: 'could-not-read' });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The tempting shortcut is to report `job-assign` here because the assign
    // call did fail — and it sends the reader to repair an assignment when the
    // truth is that the membership read never answered. Could-not-look keeps
    // its own name whatever else went wrong beside it.
    expect(result.error.stage).toBe('job-membership');
  });

  it('terminates when membership COULD NOT BE READ, which is not a yes', () => {
    const win32 = surface({ membership: 'could-not-read' });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Named apart from `job-assign` on purpose: the two have different repairs,
    // and a reader told "not in the job" would go looking for an assignment
    // that failed when the truth is that nothing looked.
    expect(result.error.stage).toBe('job-membership');
    expect(win32.calls).not.toContain('resume');
    expect(win32.calls).toContain('terminate');
  });

  it('terminates when the job could not be created at all', () => {
    const win32 = surface({ createJob: () => null });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('job-create');
    expect(win32.calls).not.toContain('resume');
    expect(win32.calls).toContain('terminate');
  });

  it('terminates when the limits were refused, even though membership would succeed', () => {
    const win32 = surface({ applyLimits: () => false });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A job with no limits set holds the process and answers `IsProcessInJob`
    // with yes. Membership in an unconstrained job is the partly contained host
    // wearing the answer the next check looks for.
    expect(result.error.stage).toBe('job-limits');
    expect(win32.calls).not.toContain('assignToJob');
    expect(win32.calls).not.toContain('resume');
  });

  it('reports a failed creation without terminating anything', () => {
    const win32 = surface({ createSuspended: () => err('process creation failed: 5') });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('create');
    // There is no process to kill and no handle to close. A factory that
    // terminated here would be passing an undefined handle to Win32.
    expect(win32.calls).toStrictEqual(['createSuspended']);
  });
});

describe('the resume itself is checked', () => {
  it('kills the host when ResumeThread fails', () => {
    const win32 = surface({ resume: () => null });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.stage).toBe('resume');
    expect(win32.calls).toContain('terminate');
  });

  it('kills the host when the thread was ALREADY RUNNING before the resume', () => {
    const win32 = surface({ resume: () => 0 });
    const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A previous suspend count of 0 means the process ran before the job was
    // assigned — the window Decision 8 closes, open for however long that took.
    // Unreachable through the shipped surface, which always passes
    // CREATE_SUSPENDED, and checked for the same reason the membership is read:
    // the value is there, and inferring the flag took effect from having passed
    // it is what `IsProcessInJob` refuses one line earlier.
    expect(result.error.stage).toBe('suspend-count');
    expect(win32.calls).toContain('terminate');
  });

  it('CONTROL: a previous suspend count of exactly 1 is the success path', () => {
    const win32 = surface({ resume: () => 1 });
    expect(createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES).ok).toBe(true);
  });
});

describe('nothing is left behind on any refusal', () => {
  const refusals: { name: string; overrides: NonNullable<Parameters<typeof surface>[0]> }[] = [
    { name: 'the job could not be created', overrides: { createJob: () => null } },
    { name: 'the limits were refused', overrides: { applyLimits: () => false } },
    { name: 'the process is not in the job', overrides: { membership: 'not-in-job' } },
    { name: 'membership could not be read', overrides: { membership: 'could-not-read' } },
    { name: 'the resume failed', overrides: { resume: () => null } },
    { name: 'the thread was already running', overrides: { resume: () => 0 } },
  ];

  for (const { name, overrides } of refusals) {
    it(`closes every handle it opened when ${name}`, () => {
      const win32 = surface(overrides);
      const result = createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

      expect(result.ok).toBe(false);
      expect(win32.calls).toContain('close:thread');
      expect(win32.calls).toContain('close:process');
      // The job handle is closed only when one was created.
      const madeJob = win32.calls.includes('createJob') && overrides.createJob === undefined;
      expect(win32.calls.includes('close:job')).toBe(madeJob);
    });

    it(`terminates BEFORE closing anything when ${name}`, () => {
      const win32 = surface(overrides);
      createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES);

      // Closing a KILL_ON_JOB_CLOSE job would usually kill the host anyway, and
      // relying on that makes the kill a side effect of tidying up — which stops
      // being true in exactly the case this file is about, where the assignment
      // is what failed and the process is in no job of ours.
      const killed = win32.calls.indexOf('terminate');
      const firstClose = win32.calls.findIndex((call) => call.startsWith('close:'));
      expect(killed).toBeGreaterThanOrEqual(0);
      expect(killed).toBeLessThan(firstClose);
    });
  }

  it('CONTROL: and the success path does NOT terminate, nor close the job', () => {
    const win32 = surface();
    expect(createContainedHost(win32, ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES).ok).toBe(true);
    expect(win32.calls).not.toContain('terminate');
    // Without this, every case above is satisfied by a factory that kills the
    // host on every path — which passes "nothing is left behind" and ships no
    // working host at all.
    expect(win32.calls).not.toContain('close:job');
    expect(win32.calls).not.toContain('close:process');
  });
});
