import { type StructuredError, toStructuredError } from '@monstera/shared';

/**
 * Where a diagnostic goes when a failure crosses to the renderer (ADR-0009 §9).
 *
 * The two objects have opposite jobs. `StructuredError` preserves everything —
 * message, stack, cause chain — and that is right, because losing it makes a
 * bug much harder to walk back. `Failure` carries a code and an incident id,
 * and that is right, because the diagnostic contains absolute paths.
 *
 * This is the seam between them: the diagnostic stays on the side that already
 * knows the path, and only the id crosses.
 *
 * ## The sink is REQUIRED, not defaulted
 *
 * Two designs were tried and both were worse. A module-level mutable sink is
 * global state that test ordering can reach and that two applications in one
 * process would share. A default that prints was rejected by the module graph
 * before it was rejected on merit: `packages/contract` has no Node or DOM lib,
 * because it is the wire contract and nothing in it should be able to reach a
 * process — and that boundary was right to object.
 *
 * So whoever wraps a handler supplies the destination, and forgetting is a
 * compile error rather than a diagnostic nobody receives. That is the same
 * reasoning as everywhere else here: unrepresentable beats defaulted, because a
 * default is what nobody revisits.
 */

/** A diagnostic, and the id the renderer was given in its place. */
export interface Incident {
  readonly id: string;
  readonly channel: string;
  readonly diagnostic: StructuredError;
}

/**
 * Receives every diagnostic that did not cross.
 *
 * It must not throw: it runs while a failure is already being reported, and a
 * sink that throws would replace the failure the renderer was about to be told
 * about with one nobody handles.
 */
export type IncidentSink = (incident: Incident) => void;

/**
 * Mints incident ids and hands diagnostics to a sink.
 *
 * Per boundary rather than global, so two wrapped registries in one process
 * cannot interleave their counters.
 */
export class IncidentLog {
  readonly #sink: IncidentSink;

  /**
   * A counter, not a random id.
   *
   * An incident id exists to join a renderer report to a log line. It must not
   * be derivable from anything about the document — which rules out hashing a
   * path — and it does not need to be unguessable, because knowing one tells
   * you nothing. A monotonic counter says exactly what it is: the n-th failure
   * this boundary saw.
   */
  #next = 0;

  constructor(sink: IncidentSink) {
    this.#sink = sink;
  }

  /**
   * Records a diagnostic and returns the id to send instead of it.
   *
   * The **only** place a thrown value becomes an id, so "the diagnostic was
   * recorded" and "the renderer got an id" cannot come apart.
   */
  record(channel: string, thrown: unknown): string {
    this.#next += 1;
    const id = `i${String(this.#next)}`;
    this.#sink({ id, channel, diagnostic: toStructuredError(thrown) });
    return id;
  }
}
