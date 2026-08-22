import { type Result, err, ok } from '@monstera/shared';

/**
 * Creating a contained engine host, in the one order that has no window in it
 * (ADR-0023 §1 and Decision 8).
 *
 * ## What is here and what is deliberately not
 *
 * This is the **ordering**, over an injected Win32 surface. The surface itself —
 * `CreateProcessW`, the attribute list, the job calls — is the next module and
 * the only one permitted an `any`, per B7's native-boundary rule.
 *
 * The split is not tidiness. Decision 8 is a claim about *sequence*: assign
 * before resume, verify membership rather than trusting a return value,
 * terminate rather than resume when it did not take. Every one of those is
 * decidable without a real process, and a factory that could only be tested by
 * creating one would be tested by nothing — the containment spike takes 60
 * seconds a cell and runs on Windows alone.
 *
 * The surface's shape is not invented. Each member is a call
 * `scripts/research/lowboxSpike.mjs` already makes, in the order it makes them,
 * on every cell of every run. That instrument is the specification, and it has
 * been exercised against real processes with the container applied and without,
 * with the job and without.
 *
 * ## The requirement, and the two states it refuses
 *
 * > **If the job assignment does not take, the process is terminated. It is
 * > never resumed.**
 *
 * A host created with the container applied and the assignment failed has (c)
 * *no network* and (d) *no filesystem beyond what it was handed*, and does not
 * have (b) *no process creation* — measured, WW-1's matrix: a LowBox host with
 * no job of ours spawns children freely. **Every cheap way of asking "is this
 * contained?" answers yes for that host**, including `classifyContainment`,
 * which measures reach and says nothing about process creation.
 *
 * Two of three is not a degraded mode. Invariant 25 is a conjunction, and a
 * host satisfying part of it is worse than an obvious failure because it
 * reports as healthy.
 *
 * ## Membership is READ, not inferred, and "could not read" is a third answer
 *
 * `AssignProcessToJobObject` returning true and the process not being in the job
 * is the `available: true` shape at the kernel boundary, so the factory calls
 * `IsProcessInJob`. That call can itself fail, and a failure is **not** a
 * membership answer: `couldNotRead` terminates exactly as `false` does. *Could
 * not look* is not *looked and found it* — the distinction this project draws
 * everywhere else, arriving at the one place where getting it wrong ships a
 * host that is not contained.
 *
 * ## Why the suspend count is checked, which Decision 8 implies and does not say
 *
 * `ResumeThread` returns the thread's suspend count **before** the call. A
 * process created suspended reports 1. A 0 means the thread was already running
 * — so it ran before the job was assigned, and the window Decision 8 exists to
 * close was open for however long that took. The host is killed, because by then
 * the ordering guarantee is not something that can be recovered.
 *
 * That case is unreachable through the shipped surface, which always passes
 * `CREATE_SUSPENDED`. It is checked anyway for the reason the membership read
 * is: the value is available, and inferring the flag took effect from having
 * passed it is what `IsProcessInJob` exists to refuse one line earlier.
 */

/**
 * An opaque Win32 handle. Branded per kind so a job cannot be passed where a
 * process is expected — the surface takes three different handles and they are
 * all pointers.
 */
export interface Handle<Kind extends string> {
  readonly __handle: Kind;
}

export type ProcessHandle = Handle<'process'>;
export type ThreadHandle = Handle<'thread'>;
export type JobHandle = Handle<'job'>;

/** What `CreateProcessW` produced. */
export interface CreatedProcess {
  readonly pid: number;
  readonly process: ProcessHandle;
  readonly thread: ThreadHandle;
}

/** Whether the process is in the job, or whether the question could be asked. */
export type JobMembership = 'in-job' | 'not-in-job' | 'could-not-read';

/**
 * The Win32 calls this factory makes, in the order it makes them.
 *
 * Every member returns a value rather than throwing: these are foreign calls
 * whose failure is an outcome, and a surface that threw would put the cleanup
 * for a half-created host in a `catch` block, which is where a leaked handle
 * goes to live.
 */
export interface HostCreationSurface {
  /** `CreateProcessW` with the security-capabilities attribute and `CREATE_SUSPENDED`. */
  readonly createSuspended: () => Result<CreatedProcess, string>;
  /** `CreateJobObjectW`. `null` when it failed. */
  readonly createJob: () => JobHandle | null;
  /** `SetInformationJobObject` with the limits, including the memory cap. */
  readonly applyLimits: (job: JobHandle, processMemoryLimitBytes: number) => boolean;
  /** `AssignProcessToJobObject`. Its answer is not trusted — see below. */
  readonly assignToJob: (job: JobHandle, process: ProcessHandle) => boolean;
  /** `IsProcessInJob`, whose own failure is a distinct answer. */
  readonly readJobMembership: (process: ProcessHandle, job: JobHandle) => JobMembership;
  /** `ResumeThread`. Returns the suspend count BEFORE the call, or `null` on failure. */
  readonly resume: (thread: ThreadHandle) => number | null;
  /** `TerminateProcess`. Best effort: there is nothing to do if it fails. */
  readonly terminate: (process: ProcessHandle) => void;
  /** `CloseHandle`. */
  readonly close: (handle: ProcessHandle | ThreadHandle | JobHandle) => void;
}

/** A host that is running, contained, and in its job. */
export interface ContainedHost {
  readonly pid: number;
  readonly process: ProcessHandle;
  /**
   * Held for the host's lifetime, and closing it kills the host.
   *
   * The job carries `KILL_ON_JOB_CLOSE`, so this handle is the host's leash
   * rather than a resource to tidy away. Dropping it without meaning to end the
   * host is the mistake this comment exists to prevent.
   */
  readonly job: JobHandle;
}

/** Why a host was not created. Every one of these leaves nothing running. */
export interface HostCreationFailure {
  readonly stage:
    | 'create'
    | 'job-create'
    | 'job-limits'
    | 'job-assign'
    | 'job-membership'
    | 'resume'
    | 'suspend-count';
  readonly detail: string;
}

/**
 * @param surface The Win32 calls, injected. See {@link HostCreationSurface}.
 * @param processMemoryLimitBytes Required and undefaulted (ADR-0023 §2). The
 *   shell passes `ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES`; a default here is how
 *   a number nobody chose becomes the number in force, and `0` means *no limit*
 *   to Win32 rather than an obviously missing value.
 * @returns The running host, or the stage that refused and why.
 */
export function createContainedHost(
  surface: HostCreationSurface,
  processMemoryLimitBytes: number,
): Result<ContainedHost, HostCreationFailure> {
  if (!Number.isInteger(processMemoryLimitBytes) || processMemoryLimitBytes < 1) {
    throw new RangeError(
      `processMemoryLimitBytes must be a positive integer, received ` +
        `${String(processMemoryLimitBytes)}. Win32 reads 0 as "no limit", so a missing value ` +
        'would create a host with the memory term of invariant 25 silently absent.',
    );
  }

  const created = surface.createSuspended();
  if (!created.ok) return err({ stage: 'create', detail: created.error });
  const { pid, process, thread } = created.value;

  /**
   * Every failure after creation comes through here, so there is one place that
   * knows what has to be torn down and in what order.
   *
   * The process is terminated BEFORE any handle is closed. Closing a job with
   * `KILL_ON_JOB_CLOSE` would usually be enough, and relying on that would make
   * the kill a side effect of tidying up — which stops being true the moment
   * the assignment is the thing that failed, and that is the case this whole
   * function is about.
   */
  const abandon = (
    stage: HostCreationFailure['stage'],
    detail: string,
    job: JobHandle | null,
  ): Result<never, HostCreationFailure> => {
    surface.terminate(process);
    surface.close(thread);
    surface.close(process);
    if (job !== null) surface.close(job);
    return err({ stage, detail });
  };

  const job = surface.createJob();
  if (job === null) {
    return abandon('job-create', 'CreateJobObjectW returned no handle.', null);
  }

  if (!surface.applyLimits(job, processMemoryLimitBytes)) {
    // A job with no limits set is a job that constrains nothing. It would still
    // hold the process, and `IsProcessInJob` would still say yes — membership
    // in an unconstrained job is the partly contained host wearing the answer
    // the next check looks for.
    return abandon('job-limits', 'SetInformationJobObject refused the limits.', job);
  }

  const assigned = surface.assignToJob(job, process);
  const membership = surface.readJobMembership(process, job);

  // READ REGARDLESS of what the assign call said, and the read is what decides.
  // A true from `AssignProcessToJobObject` with the process not in the job is
  // the `available: true` shape, and it is the reason this is two calls.
  if (membership !== 'in-job') {
    return abandon(
      membership === 'could-not-read' ? 'job-membership' : 'job-assign',
      membership === 'could-not-read'
        ? `IsProcessInJob could not be read (assign reported ${String(assigned)}). Could not ` +
          'look is not looked and found it, and a host that may not be in its job is not one ' +
          'to resume.'
        : `The process is not in the job (assign reported ${String(assigned)}). Invariant 25(b) ` +
          'is delivered by the job, not by the container, so this host would run with two of ' +
          'three and report as contained.',
      job,
    );
  }

  const previousSuspendCount = surface.resume(thread);
  if (previousSuspendCount === null) {
    return abandon('resume', 'ResumeThread failed; the host is suspended and cannot run.', job);
  }
  if (previousSuspendCount !== 1) {
    return abandon(
      'suspend-count',
      `ResumeThread reported a previous suspend count of ${String(previousSuspendCount)}, not 1. ` +
        'The thread was already running, so it executed before the job was assigned and the ' +
        'window Decision 8 closes was open.',
      job,
    );
  }

  // The thread handle has no further use; the process and job handles are the
  // host's identity and its leash.
  surface.close(thread);
  return ok({ pid, process, job });
}
