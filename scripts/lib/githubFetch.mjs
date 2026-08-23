// @ts-check
/**
 * The one door to the GitHub API, with a budget (finding AAAA-3).
 *
 * ## What went wrong, measured
 *
 * The unauthenticated quota is 60 requests an hour for an IP, and every helper
 * shares it. Reading the cold MuPDF build figure meant walking fifty CI runs;
 * that spent the quota; and `npm run board` — the caller that must never be
 * starved, because it is what says whether a commit is green — then polled forty
 * times against HTTP 403 and returned NO VERDICT.
 *
 * **Measurement starved verification, and the ordering was accidental rather
 * than chosen.** Two ad-hoc helpers made unbounded per-run requests, which meant
 * the next one would too. Being careful in each is not a mechanism; a single
 * door with a reserve is, because it makes the priority a value in one place
 * instead of a habit in every caller.
 *
 * ## The reserve is the whole point
 *
 * A caller declares its `purpose`, and a bulk purpose is refused once the
 * remaining quota falls below {@link RESERVE}. That reserve is what the board
 * reader spends. So *anything that walks fifty runs has to say so and be told
 * no*, rather than discovering the limit by taking the last request.
 *
 * A `critical` caller is never refused by this module — it may still be refused
 * by GitHub, which is a different fact and is reported as itself.
 *
 * ## Why the remaining count is READ rather than counted here
 *
 * `x-ratelimit-remaining` is the authority's own answer, and this module keeps
 * no tally of its own (B3a). A counter here would be a second opinion that
 * agrees most of the time — it cannot see requests made by another process, by
 * a shell `curl`, or by an editor, and every one of those spends the same IP
 * quota. The header is refreshed on every response, so the first request of a
 * run establishes the state and later ones correct it.
 *
 * Before the first response there is nothing to read, and that is reported as
 * unknown rather than assumed generous: a bulk caller with no reading takes one
 * probe request and then decides.
 */

/**
 * Requests kept in reserve for verification. Not a round number chosen for
 * comfort: `board.mjs` polls up to 40 times, and the reserve has to cover one
 * complete wait plus the handful of calls that read a job's steps afterwards.
 */
export const RESERVE = 45;

/** @type {{ remaining: number, limit: number } | null} */
let lastSeen = null;

/**
 * What the API last said about the quota, or `null` if nothing has asked yet.
 *
 * Exported so a caller can report the budget it is working inside rather than
 * discovering it by being refused.
 *
 * @returns {{ remaining: number, limit: number } | null}
 */
export function quotaSeen() {
  return lastSeen === null ? null : { ...lastSeen };
}

/** Test seam: forget the observed quota. Never called by product code. */
export function resetQuota() {
  lastSeen = null;
}

/**
 * @param {Headers} headers
 * @returns {void}
 */
function recordQuota(headers) {
  // PRESENCE FIRST, then the number. `Number(null)` is 0 and `Number.isFinite(0)`
  // is true, so checking the converted value lets an ABSENT header through as a
  // measured zero — which reads as "quota exhausted" and would refuse every bulk
  // caller for the rest of the run. A missing measurement presented as a
  // measured emergency, which is the reassuring answer's mirror image and just
  // as wrong. Written the naive way first and caught by this module's own proof
  // on its first run.
  const rawRemaining = headers.get('x-ratelimit-remaining');
  const rawLimit = headers.get('x-ratelimit-limit');
  if (rawRemaining === null || rawLimit === null) return;
  const remaining = Number(rawRemaining);
  const limit = Number(rawLimit);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) return;
  lastSeen = { remaining, limit };
}

/**
 * Fetches from the GitHub API through the budget.
 *
 * @param {string} url
 * @param {{ purpose: 'critical' | 'bulk', headers?: Record<string, string> }} options
 * @returns {Promise<Response>}
 */
export async function githubFetch(url, options) {
  if (options.purpose === 'bulk' && lastSeen !== null && lastSeen.remaining < RESERVE) {
    throw new Error(
      `Refusing a bulk GitHub request: ${String(lastSeen.remaining)} of ` +
        `${String(lastSeen.limit)} requests remain, and ${String(RESERVE)} are reserved for ` +
        `reading the board.\n\n` +
        `  This is the budget saying no, not the API. A bulk walk that takes the last requests ` +
        `leaves\n  the board reader polling against HTTP 403, which reports NO VERDICT — so a ` +
        `measurement would\n  have cost the ability to verify the commit it was taken for. ` +
        `Wait for the reset, or take\n  fewer runs.\n\n` +
        `  URL: ${url}`,
    );
  }

  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', ...options.headers },
  });
  recordQuota(response.headers);
  return response;
}
