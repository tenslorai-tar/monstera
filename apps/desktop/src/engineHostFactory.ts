import {
  type IntegrityReading,
  type JobLimitsReading,
  classifyProcessContainment,
} from '@monstera/kernel';
import { type Result, err, ok } from '@monstera/shared';

/**
 * Creating a contained engine host, in the one order that has no window in it
 * (ADR-0023 §1 and Decision 8).
 *
 * ## What is here and what is deliberately not
 *
 * This is the **ordering**, over an injected Win32 surface. The surface itself —
 * the process-creation call, the extended attribute list, the job calls — is the
 * next module and the only one permitted an `any`, per B7's native-boundary
 * rule.
 *
 * ## Why this file names no Win32 entry point, which reads oddly and is not an
 * oversight
 *
 * `docs/security/engine-advisories.json` watches those names with `git grep`
 * over this package's source glob, and a scan of that kind cannot tell
 * **naming** a symbol from **using** it. Spelling them here expires two
 * invariant-25 verdicts on a module that creates no process — so the names stay
 * in the surface module, where they will be genuine uses and where those
 * verdicts should fire.
 *
 * Third occurrence of that shape, recorded as finding KKK-1 rather than absorbed
 * a third time. The triggers are left armed at full strength; what is priced in
 * the finding is teaching the register's scan to read code rather than prose.
 *
 * **This vagueness is a workaround and it has an expiry: the Win32 surface
 * module.** Naming its trigger is the whole difference between a dated
 * workaround and occurrence four. The reword is not a policy — it pushes a
 * security-relevant file's comments toward saying less, which is a cost paid
 * every time someone reads this and cannot tell which call is meant. On the day
 * the surface lands, those symbols become genuine uses, the invariant-25
 * verdicts fire for the right reason, and **re-triaging them is then correct** —
 * where doing it today would have narrowed a security trigger on the day it
 * fired, for a module whose subject has not occurred. Carried on
 * `docs/FEATURES.md`'s Decision 8 row, because the expiry is an event and a
 * symbol scan cannot see one.
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
 * contained?" answers yes for that host**, including the kernel's startup
 * containment check, which measures reach and says nothing about process
 * creation.
 *
 * Two of three is not a degraded mode. Invariant 25 is a conjunction, and a
 * host satisfying part of it is worse than an obvious failure because it
 * reports as healthy.
 *
 * ## Membership is READ, not inferred, and "could not read" is a third answer
 *
 * The assign call returning true while the process is not in the job is the
 * `available: true` shape at the kernel boundary, so the factory reads
 * membership back. That read can itself fail, and a failure is **not** a
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

/** What the process-creation call produced. */
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
  /** Process creation, with the security-capabilities attribute and `CREATE_SUSPENDED`. */
  readonly createSuspended: () => Result<CreatedProcess, string>;
  /** `CreateJobObjectW`. `null` when it failed. */
  readonly createJob: () => JobHandle | null;
  /** `SetInformationJobObject` with the limits, including the memory cap. */
  readonly applyLimits: (job: JobHandle, processMemoryLimitBytes: number) => boolean;
  /** Assigning the process to the job. Its answer is not trusted — see below. */
  readonly assignToJob: (job: JobHandle, process: ProcessHandle) => boolean;
  /** `IsProcessInJob`, whose own failure is a distinct answer. */
  readonly readJobMembership: (process: ProcessHandle, job: JobHandle) => JobMembership;
  /**
   * Invariant 25(a), read by MAIN against the child's token.
   *
   * Not by the host against its own: a process that has lowered itself can no
   * longer open its own token, so a self-read is a could-not-look dressed as a
   * reading (finding PP-2).
   */
  readonly readIntegrity: (process: ProcessHandle) => IntegrityReading;
  /**
   * Invariant 25(b), read back OFF THE JOB rather than taken from what was set.
   *
   * `applyLimits` returning `true` says `SetInformationJobObject` accepted the
   * struct. That is a statement about the call, and the same distinction is why
   * `assignToJob`'s answer is not trusted and `IsProcessInJob` decides.
   */
  readonly readJobLimits: (job: JobHandle) => JobLimitsReading;
  /** `ResumeThread`. Returns the suspend count BEFORE the call, or `null` on failure. */
  readonly resume: (thread: ThreadHandle) => number | null;
  /** `TerminateProcess`. Best effort: there is nothing to do if it fails. */
  readonly terminate: (process: ProcessHandle) => void;
  /** `CloseHandle`. */
  readonly close: (handle: ProcessHandle | ThreadHandle | JobHandle) => void;
  /**
   * What the host wrote to its inherited stdout and stderr, or `null`.
   *
   * ## Why this exists on the SURFACE and not beside the caller
   *
   * A host that dies before it connects reports itself as *"started and did not
   * reach its pipe"*, which sends the reader to the pipe — and the answer is
   * usually the host's own first line. Measured twice while building the
   * recovery harness: a container whose token could not read the Electron
   * runtime died in `icu_util.cc` with *"Invalid file descriptor to ICU data
   * received"*, and every caller reported a pipe problem.
   *
   * The surface holds the path because it is the only thing that has it, and
   * because a `string` path on any type the kernel or the renderer can name is
   * a compile error (invariant 2, L2). The caller receives TEXT.
   *
   * `null` covers three states deliberately collapsed: no diagnostic file was
   * configured, the file could not be read, and the host wrote nothing. None of
   * them gives the caller anything to say, and separating them would put three
   * branches at a call site that would print the same sentence for each.
   */
  readonly diagnostics: () => string | null;
  /**
   * Removes what {@link diagnostics} reads.
   *
   * Called when a connection is torn down. Nothing else sweeps the file until
   * the next launch, and a diagnostic whose whole content has already been
   * carried into a reported failure is not evidence any more.
   */
  readonly discardDiagnostics: () => void;
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
    // TWO STAGES, NOT ONE. A host whose containment could not be READ and one
    // measured as absent want different responses — an instrument to fix
    // against a host to refuse — and collapsing them would make every
    // instrument failure read as a security finding, which is how a real one
    // stops being believed.
    | 'containment-unreadable'
    | 'containment-absent'
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
  // A true from the assign call with the process not in the job is
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

  // INVARIANT 25(a) AND (b), AGAINST THE RUNNING PROCESS, and before it runs.
  //
  // Read here rather than after `resume` for the reason the whole suspend
  // exists: everything below this line is a host that has executed. The token
  // and the job are both final at this point, so there is nothing to gain by
  // waiting and a window to lose.
  //
  // Both were previously asserted only by `lowboxSpike.mjs`, against cells it
  // creates itself. A property proven on a prototype and never on the shipped
  // artefact is the shape this project refuses — and it is the one this whole
  // file exists to deliver.
  const contained = classifyProcessContainment(
    surface.readIntegrity(process),
    surface.readJobLimits(job),
    processMemoryLimitBytes,
  );
  if (contained.kind !== 'contained') {
    return abandon(
      contained.kind === 'unreadable' ? 'containment-unreadable' : 'containment-absent',
      `${contained.property}: ${contained.detail}`,
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
