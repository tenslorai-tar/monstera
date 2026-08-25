import { TransientFailure, isTransientStatus, retryTransient } from '../lib/retryTransient.mjs';

/**
 * How this repository asks OSV a question, and what its answers mean.
 *
 * ## Why this is a module and not four lines inside the checker (finding DDDD-14)
 *
 * `engineAdvisories.mjs` gained a retry on 2026-08-25 after one unanswered
 * request from a third party reddened `main`. `retryTransient` was given eleven
 * cases; the three branches that decide *what is transient when talking to OSV*
 * were given none, and they are the half that would have prevented the red
 * board. They could not be given any: the checker calls `main()` at import, so
 * nothing can load it, and `advisoryRegister.proof.mjs` drives it by spawning
 * the real script against the live API — where those branches only execute when
 * OSV misbehaves.
 *
 * So the fix is not a seam bolted onto the checker for a test's benefit. It is
 * B3a's remedy applied literally: **make the rule a named thing with callers.**
 * *What OSV's answer means* is one question, it has exactly one right answer,
 * and it now lives in one place that can be driven with an answer of our
 * choosing.
 *
 * ## The three answers, and why only one of them is retried
 *
 * | what happened | what it means | what this does |
 * |---|---|---|
 * | `fetch` threw | a refused connection, a reset socket — **nobody answered** | retried |
 * | 429, or 5xx | the service answered *"not now"* | retried |
 * | any other non-ok status | OSV **answered**, and the answer is that the request was wrong | throws at once |
 * | ok, with no `vulns` | OSV answered *"none"* | returned, and the caller decides |
 *
 * The third row is the one that makes this safe to retry at all. A wrong package
 * name must be reported as a wrong package name; retrying it would turn a
 * question nobody can answer into a delay followed by the same failure, and a
 * check that eventually stopped asking is the green tick meaning *did not look*.
 *
 * The fourth is deliberately **not** decided here. An empty result is a valid
 * answer to this question and a broken query to the caller that knows every
 * watched component has a published history — that judgement belongs where the
 * expectation lives, not in the transport.
 */

const OSV_ENDPOINT = 'https://api.osv.dev/v1/query';

/**
 * How many times one query may go unanswered before this gives up.
 *
 * Three, with a short backoff. NOT retrying until green: `retryTransient` is
 * built so it cannot become that — only a {@link TransientFailure} is tried
 * again, and exhausting the attempts throws the last failure rather than
 * returning.
 */
export const OSV_ATTEMPTS = 3;

/** Backoff before attempt `n`. Bounded and short: this is a gate people wait on. */
export function osvBackoffMs(/** @type {number} */ attempt) {
  return (attempt - 1) * 750;
}

/**
 * @typedef {{ id: string, summary?: string, published?: string, aliases?: string[] }} OsvVuln
 */

/**
 * Asks OSV about one Debian package.
 *
 * @param {string} name The package name, as Debian 12 spells it.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   attempts?: number,
 *   delayMs?: (attempt: number) => number,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [options] Injected so the branches above can be driven with an answer of
 *   our choosing. The defaults are what the checker runs with.
 * @returns {Promise<OsvVuln[]>}
 */
export async function queryOsv(name, options = {}) {
  const {
    fetchImpl = fetch,
    attempts = OSV_ATTEMPTS,
    delayMs = osvBackoffMs,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  } = options;

  const response = await retryTransient(
    async () => {
      // A NETWORK ERROR IS ALSO NOBODY ANSWERING. `fetch` throws for a refused
      // connection or a reset socket, and those are the same class as a 503 —
      // so the throw is re-thrown as transient rather than escaping as itself.
      /** @type {Response} */
      let attempt;
      try {
        attempt = await fetchImpl(OSV_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ package: { name, ecosystem: 'Debian:12' } }),
        });
      } catch (cause) {
        throw new TransientFailure(`OSV could not be reached for ${name}`, { cause });
      }
      if (isTransientStatus(attempt.status)) {
        throw new TransientFailure(
          `OSV returned HTTP ${String(attempt.status)} ${attempt.statusText} for ${name}`,
        );
      }
      return attempt;
    },
    { attempts, delayMs, sleep },
  );

  if (!response.ok) {
    // Reached only for a status OSV *answered* with — a 404, a 400. Not retried,
    // and not softened: a wrong package name must be reported as one.
    throw new Error(
      `OSV returned HTTP ${String(response.status)} ${response.statusText} for ${name}`,
    );
  }

  const body = /** @type {{ vulns?: OsvVuln[] }} */ (await response.json());
  return body.vulns ?? [];
}
