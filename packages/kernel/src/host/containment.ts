import { open } from 'node:fs/promises';
import { connect } from 'node:net';

/**
 * Does the container actually contain? Measured from inside the host, decided
 * outside it (ADR-0023 §5).
 *
 * ## Two halves, and the split is the point
 *
 * {@link probeContainment} runs **in the host** and reports what it observed,
 * with no verdict in it. {@link classifyContainment} is **pure** and turns two
 * observations into one of five conclusions. Nothing here decides what to do
 * about the conclusion; the factory in `apps/desktop` does, because it is the
 * side that can kill the process.
 *
 * The measuring has to happen inside — reach is a property of the token the
 * host is running under, and no reading main takes of its own filesystem says
 * anything about it. The deciding has to happen outside, because a report from
 * a process is only evidence about that process to whatever extent the process
 * is not the thing under suspicion.
 *
 * ## What a `contained` verdict does NOT cover, because the name invites the
 * opposite reading
 *
 * **This measures invariant 25(d) — filesystem reach — and (c) — no network —
 * and nothing else** (ADR-0023 Decision 15). It
 * says nothing about (b), *no process creation*, and cannot: WW-1's variant
 * matrix measured that (b) is delivered by the **job object**, not by the
 * AppContainer, so a host with the container applied and the job assignment
 * failed refuses every probe here exactly as a fully contained one does, while
 * being free to spawn children.
 *
 * A `contained` verdict is therefore evidence about reach and about network,
 * not a statement that
 * invariant 25 holds. (b) is established at creation by the factory and is
 * ADR-0023 §8's requirement: a failed assignment terminates the suspended
 * process rather than resuming it, and membership is verified with
 * `IsProcessInJob` rather than inferred from the assign call's return value.
 * The two mechanisms are independent and neither implies the other.
 *
 * **Which is exactly why the probe runs before the first document byte.** The
 * host is hostile by invariant 25's own premise, so a report it sends is not
 * evidence in general. It is evidence *here* because ADR-0023 §1's third window
 * is still shut: nothing the host has processed at this point came from a
 * document, so there is no route by which the code answering these probes could
 * have been influenced. The ordering is what makes host-reported measurement
 * admissible, and if that ordering ever changes, this stops being a measurement
 * and becomes a question asked of a suspect.
 *
 * ## The negative probe's input is the whole difficulty
 *
 * *"This path was refused"* is worth nothing when the path would have failed
 * anyway — refusal and impossibility produce the same observation, and a probe
 * built that way passes on a machine where the container has been removed.
 * This project has paid for that three times (a `.invalid` hostname, a remote
 * URL on a runner with no network, and the general form the third one
 * produced).
 *
 * So the negative target carries {@link NegativeTarget.readableBytes} — what
 * main read from that exact path immediately before handing it over. A caller
 * that did not take that reading cannot fill the field honestly, and a zero
 * makes the whole run {@link ContainmentVerdict} `unreadable` rather than
 * *contained*. The requirement is in the type instead of in a comment nobody
 * reads at the call site.
 *
 * ## `absent` is a state, not a kind of refusal
 *
 * `ENOENT` and `EACCES` are the same news to a boolean and opposite news to
 * this. Collapsing them is how a probe reports containment for a path that was
 * simply misspelt — the reassuring answer, arriving from a broken lookup.
 */

/** A path the probe attempts, and who owns its ACL. */
export interface ProbeTarget {
  readonly path: string;
  /**
   * Where the path lives, which decides what a refusal *means*.
   *
   * - `install-root` — under the packaged install root. MSIX files are
   *   read-only to the app itself, so the app cannot repair a refusal here by
   *   granting: it is premise P1 being false, and that is a branch-level
   *   failure rather than a bug.
   * - `app-created` — a path this application made and whose ACL it owns. A
   *   refusal here is a grant that did not take, and it is actionable.
   */
  readonly origin: 'install-root' | 'app-created';
}

/**
 * The path the host must NOT reach.
 *
 * @see the module comment — `readableBytes` is the evidence that this input
 * would succeed if containment were absent, without which a refusal separates
 * nothing.
 */
export interface NegativeTarget extends ProbeTarget {
  /**
   * Bytes read from this path **by main, immediately before** the request was
   * sent.
   *
   * Not a size taken from a manifest and not a value carried over from an
   * earlier run: the point is that an uncontained reader succeeded on this
   * exact path at this moment, so the contained reader's refusal is the only
   * difference between the two readings.
   */
  readonly readableBytes: number;
}

/**
 * The loopback endpoint the host must NOT reach — invariant 25(c), ADR-0023
 * Decision 15.
 *
 * ## Why a listener rather than a closed port
 *
 * A closed port refuses everybody. Contained and uncontained both fail on it
 * and only the *code* differs, which is refusal and impossibility sharing an
 * observation — the mistake this module's header records three times. So main
 * listens, and the evidence that the endpoint answers is a reading main took
 * against it.
 *
 * ## The asymmetry against the filesystem pair, which is real
 *
 * {@link ProbeTarget} comes as a pair the *host* runs, each half the other's
 * control. (c) has no positive half: the host must reach no network at all. Its
 * control is therefore a reading **main** took, and it lives here — on main's
 * side of the request — because the measuring half must not receive what its
 * report will be judged against.
 */
export interface LoopbackTarget {
  /** The ephemeral port main bound on `127.0.0.1` for this probe. */
  readonly port: number;
  /**
   * Bytes main read from its own listener **immediately before** the request
   * was sent, by connecting to this exact port itself.
   *
   * A caller that did not take that reading cannot fill this honestly, and a
   * zero makes the run {@link ContainmentVerdict} `unreadable`. Identical in
   * shape and in purpose to {@link NegativeTarget.readableBytes}, deliberately:
   * one discipline about what makes a negative probe admissible, not two.
   */
  readonly mainReadBytes: number;
}

export interface ContainmentProbeRequest {
  /** A path the host must reach — the runtime, the FFI or the engine shim. */
  readonly positive: ProbeTarget;
  readonly negative: NegativeTarget;
  readonly loopback: LoopbackTarget;
}

/** What one attempt observed. Never a judgement about containment. */
export type ProbeOutcome =
  | { readonly kind: 'read'; readonly bytes: number }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'absent'; readonly code: string }
  | { readonly kind: 'error'; readonly code: string };

export interface ContainmentReport {
  readonly positive: ProbeOutcome;
  readonly negative: ProbeOutcome;
  /**
   * What connecting to {@link LoopbackTarget.port} did.
   *
   * **No new vocabulary**: bytes arrived is `read`, the stack said no is
   * `refused`, and the union already spells both. A second set of names for the
   * same three answers is the second opinion B3a is about.
   */
  readonly loopback: ProbeOutcome;
}

/**
 * What the two observations mean.
 *
 * `unreadable` is terminal and is **not** a milder form of failure: it is the
 * state in which the run said nothing, and it exists so that *could not look*
 * and *looked and found containment* never share an output.
 */
export type ContainmentVerdict =
  | { readonly kind: 'contained' }
  /**
   * The negative path was reachable. The loudest case in ADR-0023's table: the
   * host looks healthy and is not contained.
   */
  | { readonly kind: 'containment-absent'; readonly detail: string }
  /**
   * The host reached the loopback listener. Invariant 25(c) does not hold, and
   * this is as loud as `containment-absent`: a host with a network is a host
   * that can send a document somewhere.
   */
  | { readonly kind: 'network-reachable'; readonly detail: string }
  /**
   * Premise P1 is false on this installation — the install root does not grant
   * application packages what the host needs, and the app cannot grant it,
   * because it cannot write ACLs on its own installed files.
   *
   * A decision to retake, not a bug to fix and not a condition to retry.
   */
  | { readonly kind: 'premise-p1-false'; readonly path: string; readonly detail: string }
  /** A grant this application is responsible for did not take. Actionable. */
  | { readonly kind: 'grant-did-not-take'; readonly path: string; readonly detail: string }
  /** The run measured nothing. Never report this as any of the above. */
  | { readonly kind: 'unreadable'; readonly detail: string };

/**
 * What the measuring half is given: two paths, and nothing it is judged by.
 *
 * **Separate from {@link ContainmentProbeRequest} on purpose, and the split is
 * the module's own argument expressed as a type.** That request bundles two
 * different things — the paths to attempt, and the evidence a verdict is
 * reached against (`negative.readableBytes`, `positive.origin`). The second
 * group is main's: a reading main took itself, and main's knowledge of which
 * path it named.
 *
 * The measuring runs **in the host**, which invariant 25's premise says may be
 * compromised. Handing that side the inputs its report will be judged against
 * is the shape the header warns about, so the type is what forbids it rather
 * than a rule at the call site (B5). While nothing called this, the wider
 * signature cost nothing and was harmless; the first caller is what shows it
 * wrong, and the architecture changes before the feature rather than under it.
 */
export interface ContainmentProbePaths {
  /** A path the host must reach. */
  readonly positive: string;
  /** A path the host must not. */
  readonly negative: string;
  /**
   * The `127.0.0.1` port the host must not reach.
   *
   * A bare number and not {@link LoopbackTarget}: `mainReadBytes` is main's
   * evidence, and handing it to the process whose report it judges is the shape
   * this interface exists to forbid.
   */
  readonly loopbackPort: number;
}

/**
 * Reads a few bytes of `path`, reporting what happened and judging nothing.
 *
 * A handful of bytes rather than the file: the question is whether the access
 * check passes, which `open` already answers, and reading an install-root
 * binary in full to learn it would be a cost with no information in it.
 */
export async function probePath(path: string): Promise<ProbeOutcome> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (thrown) {
    return fromThrown(thrown);
  }
  try {
    const into = new Uint8Array(64);
    const { bytesRead } = await handle.read(into, 0, into.byteLength, 0);
    return { kind: 'read', bytes: bytesRead };
  } catch (thrown) {
    return fromThrown(thrown);
  } finally {
    await handle.close();
  }
}

/**
 * How long the loopback probe waits for the stack to answer.
 *
 * Generous on purpose. A Windows connect blocked by the filtering platform
 * reports its own `ETIMEDOUT`, and the point of a wide bound is that the *OS*
 * answer arrives first — a bound tight enough to fire before it would replace an
 * observation with a decision of ours.
 */
export const LOOPBACK_PROBE_MS = 10_000;

/**
 * What our own bound firing is called.
 *
 * `error`, never `refused`. A timeout we imposed is *we stopped waiting*, which
 * is a could-not-look; spelling it as a refusal would manufacture the reassuring
 * answer out of our own impatience. It reaches {@link classifyContainment} as
 * `unreadable`, which is the honest verdict for a run that measured nothing.
 */
export const PROBE_TIMED_OUT = 'PROBE_TIMED_OUT';

/**
 * What a socket error code means to this probe.
 *
 * Separate from {@link outcomeForErrorCode} rather than folded into it, and the
 * split is B3a rather than a copy: `ENOENT` is a filesystem answer and means
 * nothing to a connect, while `ECONNREFUSED` is the reverse. Two authorities,
 * two rules, each with one caller.
 *
 * `ECONNREFUSED` is the network's `absent`. Main connected to this port moments
 * earlier, so nothing-listening is not a state the endpoint can honestly be in;
 * the two readings are of different worlds and neither says anything about
 * containment.
 *
 * Everything unrecognised is `error`, for the reason its filesystem sibling
 * gives: a fold would be a guess in the reassuring direction, because `refused`
 * is the answer a containment probe hopes for.
 */
export function outcomeForConnectErrorCode(code: string): ProbeOutcome {
  if (code === 'ETIMEDOUT' || code === 'EACCES' || code === 'EPERM') {
    return { kind: 'refused', code };
  }
  if (code === 'ECONNREFUSED') return { kind: 'absent', code };
  return { kind: 'error', code };
}

/**
 * Attempts one TCP connection to `127.0.0.1:port` and reports what happened.
 *
 * Bytes are what counts as reaching it, not the `connect` event: the question
 * invariant 25(c) asks is whether this process can exchange anything with
 * something outside itself, and a socket that connects and receives nothing has
 * not shown that.
 */
export function probeLoopback(port: number): Promise<ProbeOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = connect({ port, host: '127.0.0.1' });

    const done = (outcome: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      done({ kind: 'error', code: PROBE_TIMED_OUT });
    }, LOOPBACK_PROBE_MS);
    // The bound must not itself hold the host open for ten seconds when the
    // answer came in one millisecond.
    timer.unref();

    socket.on('data', (chunk: Buffer) => {
      done({ kind: 'read', bytes: chunk.byteLength });
    });
    socket.on('error', (thrown: unknown) => {
      done(outcomeForConnectErrorCode(probeCode(thrown)));
    });
    // A clean close carrying nothing is not a read, and it is not a refusal
    // either. Naming it keeps it out of both.
    socket.on('close', () => {
      done({ kind: 'error', code: 'PROBE_CLOSED_EMPTY' });
    });
  });
}

/**
 * Runs all three probes. The filesystem pair is each other's control; the
 * loopback probe's control is a reading main took and is not here — see
 * {@link LoopbackTarget}.
 */
export async function probeContainment(
  paths: ContainmentProbePaths,
): Promise<ContainmentReport> {
  // Sequential rather than concurrent, and it costs two file opens. A rejected
  // access check can take a different amount of time from a satisfied one, and
  // two probes racing on one thread is a difference nobody wants to have to
  // reason about when a verdict disagrees with expectation.
  const positive = await probePath(paths.positive);
  const negative = await probePath(paths.negative);
  const loopback = await probeLoopback(paths.loopbackPort);
  return { positive, negative, loopback };
}

/**
 * ADR-0023 §5's table, in the order the ADR gives it.
 *
 * The order is load-bearing twice. The negative side is settled first, because
 * a `contained` verdict is only meaningful when the negative probe was capable
 * of separating anything — and *within* the negative side, the request's own
 * validity comes before its outcome, since a refusal against a path nothing
 * could read is not a refusal.
 */
export function classifyContainment(
  request: ContainmentProbeRequest,
  report: ContainmentReport,
): ContainmentVerdict {
  if (request.negative.readableBytes <= 0) {
    return {
      kind: 'unreadable',
      detail:
        `The negative probe named ${request.negative.path}, which main did not read before ` +
        'handing it over. A refusal against a path an uncontained reader cannot read either ' +
        'is not evidence of containment.',
    };
  }

  switch (report.negative.kind) {
    case 'read':
      return {
        kind: 'containment-absent',
        detail:
          `The host read ${String(report.negative.bytes)} bytes of ${request.negative.path}, ` +
          'which it was not handed. The container is not containing.',
      };
    case 'absent':
      return {
        kind: 'unreadable',
        detail:
          `The negative probe reported ${request.negative.path} absent (${report.negative.code}) ` +
          `although main read ${String(request.negative.readableBytes)} bytes of it. The two ` +
          'readings are of different worlds, so neither says anything about containment.',
      };
    case 'error':
      return {
        kind: 'unreadable',
        detail: `The negative probe failed with ${report.negative.code}, which is neither a ` +
          'refusal nor a read.',
      };
    case 'refused':
      break;
  }

  // (c), in the same order and for the same reason: this negative's own request
  // validity before its outcome, since a connection that failed against an
  // endpoint main never reached is not a refusal.
  if (request.loopback.mainReadBytes <= 0) {
    return {
      kind: 'unreadable',
      detail:
        `The loopback probe named port ${String(request.loopback.port)}, which main did not ` +
        'read from before handing it over. A connection refused to an endpoint that answers ' +
        'nobody is not evidence of containment.',
    };
  }

  switch (report.loopback.kind) {
    case 'read':
      return {
        kind: 'network-reachable',
        detail:
          `The host read ${String(report.loopback.bytes)} bytes from 127.0.0.1:` +
          `${String(request.loopback.port)}. Invariant 25 gives it no network, and a host that ` +
          'can reach a socket can send a document through one.',
      };
    case 'absent':
      return {
        kind: 'unreadable',
        detail:
          `The loopback probe found nothing listening on port ${String(request.loopback.port)} ` +
          `(${report.loopback.code}) although main read ${String(request.loopback.mainReadBytes)} ` +
          'bytes from it. The two readings are of different worlds, so neither says anything ' +
          'about containment.',
      };
    case 'error':
      return {
        kind: 'unreadable',
        detail:
          `The loopback probe failed with ${report.loopback.code}, which is neither a refusal ` +
          'nor a read.',
      };
    case 'refused':
      break;
  }

  switch (report.positive.kind) {
    case 'read':
      return { kind: 'contained' };
    case 'refused':
      return request.positive.origin === 'install-root'
        ? {
            kind: 'premise-p1-false',
            path: request.positive.path,
            detail:
              `The host was refused ${request.positive.path} (${report.positive.code}), an ` +
              'install-root path. Premise P1 — that the shipped install root grants ALL ' +
              'APPLICATION PACKAGES read and execute — is false on this installation, and this ' +
              'application cannot repair it: a packaged app cannot write ACLs on its own ' +
              'installed files. The contained host is unavailable here; this is a decision to ' +
              'retake, not a document error and not something to retry.',
          }
        : {
            kind: 'grant-did-not-take',
            path: request.positive.path,
            detail:
              `The host was refused ${request.positive.path} (${report.positive.code}), a path ` +
              'this application created and whose ACL it owns. The grant for the container SID ' +
              'did not take.',
          };
    case 'absent':
    case 'error':
      return {
        kind: 'unreadable',
        detail:
          `The positive probe on ${request.positive.path} reported ${report.positive.kind} ` +
          `(${report.positive.code}), so nothing was measured about reach.`,
      };
  }
}

/**
 * What a filesystem error code means to this probe. **The one place that
 * decides**, exported so a test asserts the same rule the probe applies rather
 * than a copy of it.
 *
 * `ENOENT` and `EACCES` are opposite news and a boolean cannot carry the
 * difference, which is the whole reason {@link ProbeOutcome} has four states.
 * Anything unrecognised becomes `error` rather than being folded into the
 * nearest neighbour — a fold here would be a guess printed as a measurement,
 * and it would be a guess in the reassuring direction, since `refused` is the
 * answer a containment probe hopes for.
 */
export function outcomeForErrorCode(code: string): ProbeOutcome {
  if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'absent', code };
  if (code === 'EACCES' || code === 'EPERM') return { kind: 'refused', code };
  return { kind: 'error', code };
}

/**
 * How long a probe's error code may be, and what it may contain.
 *
 * A **named rule with callers** rather than a shape two files agree about by
 * hand (B3a): {@link probeCode} composes against it in the host and
 * `engineChannels.ts` validates against it on the wire, so the peer cannot
 * produce a code its own channel would refuse.
 *
 * Bounded for the reason a session id is — an unbounded string is a peer
 * deciding how many bytes of our frame it spends — and charset-restricted
 * because these codes are interpolated into {@link ContainmentVerdict} details
 * that go to a log, where a newline in a peer-supplied field is a peer writing
 * lines of its own.
 */
export const PROBE_CODE_MAX_CHARS = 32;

/** @see PROBE_CODE_MAX_CHARS — the same rule, and its other half. */
export const PROBE_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

/**
 * The error code a thrown filesystem failure carries, or `UNKNOWN`.
 *
 * **Anything unrecognised is normalised HERE rather than refused at the
 * channel**, and the difference is not cosmetic. A host whose `open` threw
 * something exotic has still performed the access check this probe exists to
 * measure; dropping the frame as a protocol violation would turn a usable
 * observation into a dead connection, and it would do so over the diagnostic
 * rather than over the containment answer the frame was carrying.
 *
 * The normalisation is safe in one direction only, which is why it is
 * acceptable: an unrecognised code reaches {@link outcomeForErrorCode} as
 * `error` — *measured nothing* — never as `refused`. So a code this rule cannot
 * read fails toward `unreadable` and never toward `contained`.
 */
export function probeCode(thrown: unknown): string {
  const raw =
    typeof thrown === 'object' && thrown !== null && 'code' in thrown
      ? String((thrown as { readonly code: unknown }).code)
      : 'UNKNOWN';
  return raw.length <= PROBE_CODE_MAX_CHARS && PROBE_CODE_PATTERN.test(raw) ? raw : 'UNKNOWN';
}

function fromThrown(thrown: unknown): ProbeOutcome {
  return outcomeForErrorCode(probeCode(thrown));
}

/**
 * The integrity RID of a Low-integrity token.
 *
 * Medium — an ordinary desktop process — is `0x2000`. The container hands its
 * process Low, and invariant 25 asks for *the lowest workable* level, so
 * anything at or below this passes and Medium does not.
 */
export const INTEGRITY_LOW = 0x1000;

/**
 * The job limit flags invariant 25(b) requires, defined HERE rather than beside
 * the call that sets them.
 *
 * They were only in `win32HostSurface.ts`, where `applyLimits` writes them into
 * the struct. A check that read them back would have had to name them a second
 * time, and then the setter and the reader would hold two opinions about what
 * containment requires — the exact shape B3a is about. The Win32 surface takes
 * them from here.
 *
 * `ACTIVE_PROCESS` is what delivers *no process creation*: WW-1's matrix showed
 * that property comes from the JOB and not from the container, so a host with
 * the container applied and no job spawns children freely while answering yes
 * to every cheap containment question. `PROCESS_MEMORY` is §9.17's term.
 * `KILL_ON_JOB_CLOSE` makes the job handle the host's leash.
 */
export const JOB_LIMIT_ACTIVE_PROCESS = 0x00000008;
export const JOB_LIMIT_PROCESS_MEMORY = 0x00000100;
export const JOB_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

/** What main read off the child's token, or why it could not. */
export type IntegrityReading =
  | { readonly kind: 'read'; readonly rid: number }
  | { readonly kind: 'could-not-read'; readonly detail: string };

/** What main read back off the job, or why it could not. */
export type JobLimitsReading =
  | {
      readonly kind: 'read';
      readonly limitFlags: number;
      readonly activeProcessLimit: number;
      readonly processMemoryLimitBytes: number;
    }
  | { readonly kind: 'could-not-read'; readonly detail: string };

/** Invariant 25(a) and (b), as read by main against the running host. */
export type ProcessContainmentVerdict =
  | { readonly kind: 'contained' }
  | { readonly kind: 'not-contained'; readonly property: 'integrity' | 'job'; readonly detail: string }
  | { readonly kind: 'unreadable'; readonly property: 'integrity' | 'job'; readonly detail: string };

/**
 * Classifies invariant 25(a) and (b) from readings taken against the RUNNING
 * process.
 *
 * ## Why this is not the options passed to the factory
 *
 * A flag that did not take effect and one that did are indistinguishable until
 * it matters. `applyLimits` returning `true` says `SetInformationJobObject`
 * accepted the struct, which is a statement about the call and not about the
 * job — the same distinction that made `assignToJob`'s answer untrusted and
 * `IsProcessInJob` the thing that decides.
 *
 * ## Could-not-read is its own verdict, and it is not containment
 *
 * `unreadable` rather than folding into `not-contained`: *could not look* is
 * not *looked and found nothing*, and the two want different responses — one is
 * a host to refuse, the other is an instrument to fix. It is still a refusal at
 * the call site, because a host that may not be contained is not one to resume.
 *
 * Pure, so every case is decidable with no container, no token and no job.
 */
export function classifyProcessContainment(
  integrity: IntegrityReading,
  job: JobLimitsReading,
  expectedProcessMemoryLimitBytes: number,
): ProcessContainmentVerdict {
  if (integrity.kind === 'could-not-read') {
    return { kind: 'unreadable', property: 'integrity', detail: integrity.detail };
  }
  if (integrity.rid > INTEGRITY_LOW) {
    return {
      kind: 'not-contained',
      property: 'integrity',
      detail:
        `The host runs at integrity 0x${integrity.rid.toString(16)}, above Low ` +
        `(0x${INTEGRITY_LOW.toString(16)}). Invariant 25 asks for the lowest workable level, and ` +
        `a host at Medium has whatever the desktop session has.`,
    };
  }

  if (job.kind === 'could-not-read') {
    return { kind: 'unreadable', property: 'job', detail: job.detail };
  }

  const required = [
    ['ACTIVE_PROCESS', JOB_LIMIT_ACTIVE_PROCESS],
    ['PROCESS_MEMORY', JOB_LIMIT_PROCESS_MEMORY],
    ['KILL_ON_JOB_CLOSE', JOB_LIMIT_KILL_ON_JOB_CLOSE],
  ] as const;
  const missing = required.filter(([, bit]) => (job.limitFlags & bit) === 0).map(([name]) => name);
  if (missing.length > 0) {
    return {
      kind: 'not-contained',
      property: 'job',
      detail:
        `The job is missing ${missing.join(', ')} (flags 0x${job.limitFlags.toString(16)}). ` +
        `A job holding the process without these constrains nothing, and membership in it ` +
        `answers yes to every cheap containment question.`,
    };
  }

  // ONE, not "some limit". A host permitted to create a second process is one
  // that can do everything the invariant denies it, through a child.
  if (job.activeProcessLimit !== 1) {
    return {
      kind: 'not-contained',
      property: 'job',
      detail:
        `The job permits ${String(job.activeProcessLimit)} active processes, not 1. Anything ` +
        `above one is a host that can do what invariant 25 denies it through a child.`,
    };
  }

  if (job.processMemoryLimitBytes !== expectedProcessMemoryLimitBytes) {
    return {
      kind: 'not-contained',
      property: 'job',
      detail:
        `The job's per-process memory limit reads ${String(job.processMemoryLimitBytes)} bytes ` +
        `and ${String(expectedProcessMemoryLimitBytes)} was asked for. The number that governs ` +
        `is the one on the job, so a limit that did not take is the ceiling nobody is under.`,
    };
  }

  return { kind: 'contained' };
}
