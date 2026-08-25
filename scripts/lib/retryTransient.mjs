// @ts-check
/**
 * Trying again when the answer never arrived, and never when it did.
 *
 * ## The distinction this exists to keep
 *
 * *Retrying until green* is a Rule 0 banned reflex, and it is not what this is.
 * The difference is whether the other side **answered**:
 *
 *   - a 503, a 502, a 429, a dropped socket — the server did not answer. Trying
 *     again asks the same question, and getting an answer the second time is the
 *     answer, not a different one.
 *   - a 404, a 400, an empty result set, a wrong package name — the server DID
 *     answer, and the answer was bad news. Trying again is hoping it changes
 *     its mind, which is the reflex the rule bans.
 *
 * So the helper does not take a predicate the caller can widen. It retries
 * exactly {@link TransientFailure} and nothing else, and throwing one is the
 * caller saying *nobody answered me* in the one place that can tell. Anything
 * else propagates on the first attempt (B5: the wrong behaviour is not
 * expressible rather than discouraged).
 *
 * ## It still fails closed
 *
 * When the attempts run out the LAST failure is thrown, unchanged. A caller that
 * treated exhaustion as success would be the green tick meaning *did not look*
 * that `engineAdvisories.mjs` exists to refuse.
 *
 * ## Why it was written
 *
 * `main` went red on 2026-08-25 with `OSV returned HTTP 503 Service Unavailable
 * for mupdf`, on a commit that touched nothing near it. The check was right to
 * fail — a security check that passes when it could not run is worse than no
 * check — and one unanswered request reddening the board for everyone is a
 * separate problem from that one.
 */

/**
 * An attempt that failed because nothing answered.
 *
 * A class rather than a flag on an ordinary `Error`, so the decision is made
 * where the status code is in scope and cannot be re-made — or widened — by
 * whoever calls {@link retryTransient}.
 */
export class TransientFailure extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'TransientFailure';
  }
}

/**
 * HTTP statuses that mean *no answer*, as opposed to *the answer is no*.
 *
 * 429 is included deliberately: being told to slow down is not being told the
 * thing does not exist. Every 4xx other than 429 is the server answering, and a
 * 404 retried three times is a wrong package name that takes three times as long
 * to report.
 *
 * @param {number} status
 * @returns {boolean}
 */
export function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Runs `operation`, trying again only for {@link TransientFailure}.
 *
 * @template T
 * @param {() => Promise<T>} operation
 * @param {object} options
 * @param {number} options.attempts total tries, including the first. At least 1.
 * @param {(attempt: number) => number} options.delayMs how long to wait BEFORE
 *   attempt `n` (n starting at 2). Injected rather than fixed so a proof can
 *   make it zero and a caller can back off.
 * @param {(ms: number) => Promise<void>} options.sleep injected, so the proof
 *   runs in microseconds and cannot become a slow check people stop running.
 * @returns {Promise<T>}
 */
export async function retryTransient(operation, { attempts, delayMs, sleep }) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError(
      `retryTransient needs a whole number of attempts, at least 1; got ${String(attempts)}. ` +
        `Zero attempts is a call that never happens and would report the operation's absence as ` +
        `its failure.`,
    );
  }

  /** @type {unknown} */
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(delayMs(attempt));
    try {
      return await operation();
    } catch (error) {
      // NOT A PREDICATE. Only the caller knows whether nobody answered, and it
      // says so by the type it throws — see the note at the top.
      if (!(error instanceof TransientFailure)) throw error;
      last = error;
    }
  }
  // THE LAST FAILURE, unchanged. Exhaustion is not success, and a wrapper here
  // would bury the status the operator needs.
  throw last;
}
