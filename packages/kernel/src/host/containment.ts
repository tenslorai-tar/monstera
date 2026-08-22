import { open } from 'node:fs/promises';

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

export interface ContainmentProbeRequest {
  /** A path the host must reach — the runtime, the FFI or the engine shim. */
  readonly positive: ProbeTarget;
  readonly negative: NegativeTarget;
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
 * Reads a few bytes of `target`, reporting what happened and judging nothing.
 *
 * A handful of bytes rather than the file: the question is whether the access
 * check passes, which `open` already answers, and reading an install-root
 * binary in full to learn it would be a cost with no information in it.
 */
export async function probePath(target: ProbeTarget): Promise<ProbeOutcome> {
  let handle;
  try {
    handle = await open(target.path, 'r');
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

/** Runs both probes. The pair is each other's control — see the module note. */
export async function probeContainment(
  request: ContainmentProbeRequest,
): Promise<ContainmentReport> {
  // Sequential rather than concurrent, and it costs two file opens. A rejected
  // access check can take a different amount of time from a satisfied one, and
  // two probes racing on one thread is a difference nobody wants to have to
  // reason about when a verdict disagrees with expectation.
  const positive = await probePath(request.positive);
  const negative = await probePath(request.negative);
  return { positive, negative };
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

function fromThrown(thrown: unknown): ProbeOutcome {
  return outcomeForErrorCode(
    typeof thrown === 'object' && thrown !== null && 'code' in thrown
      ? String((thrown as { readonly code: unknown }).code)
      : 'UNKNOWN',
  );
}
