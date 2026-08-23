// @ts-check
/**
 * Proof that the GitHub budget refuses a bulk caller before it starves the board
 * reader, and does not refuse anything else (rule B2, finding AAAA-3).
 *
 * No network. `fetch` is replaced for the duration, because the property under
 * test is the DECISION, and a case that needed the real API to prove a quota
 * mechanism would spend the quota it is about.
 *
 * Usage: node scripts/proofs/githubFetch.proof.mjs
 */

import { createRoster } from '../lib/passRoster.mjs';
import { githubFetch, quotaSeen, RESERVE, resetQuota } from '../lib/githubFetch.mjs';

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 8 });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

const realFetch = globalThis.fetch;

/**
 * A response carrying whatever the quota headers should say.
 *
 * @param {{ remaining?: string | null, limit?: string | null }} quota
 * @returns {void}
 */
function stubFetch(quota) {
  const headers = new Headers();
  if (quota.remaining !== null && quota.remaining !== undefined) {
    headers.set('x-ratelimit-remaining', quota.remaining);
  }
  if (quota.limit !== null && quota.limit !== undefined) {
    headers.set('x-ratelimit-limit', quota.limit);
  }
  // Replacing a global for the duration of this proof. Restored in the `finally`
  // below, so a failing case cannot leave the process with a stubbed `fetch`.
  globalThis.fetch = () => Promise.resolve(new Response('{}', { status: 200, headers }));
}

/** @param {() => Promise<unknown>} run @returns {Promise<Error | null>} */
async function thrown(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

try {
  // -------------------------------------------------------------------------
  // 1. THE FIRST REQUEST IS NEVER REFUSED, because nothing has been read yet.
  //
  // Built the way a negative probe has to be: the alternative — assuming a
  // generous quota — and the correct behaviour are indistinguishable here, so
  // this case exists to pin that an unknown quota does not refuse.
  // -------------------------------------------------------------------------
  resetQuota();
  stubFetch({ remaining: '3', limit: '60' });
  check(
    'with no reading yet, a bulk request goes through and takes one probe',
    (await thrown(() => githubFetch('https://api.github.com/x', { purpose: 'bulk' }))) === null,
    'an unknown quota reported as exhausted would refuse every bulk caller for the whole run — ' +
      'a missing measurement presented as a measured emergency.',
  );
  check(
    'and the reading is taken from the response it just made',
    quotaSeen()?.remaining === 3 && quotaSeen()?.limit === 60,
    `got ${JSON.stringify(quotaSeen())}. The header is the authority's own answer; a tally kept ` +
      `here would be a second opinion that cannot see another process spending the same IP quota.`,
  );

  // -------------------------------------------------------------------------
  // 2. NOW IT REFUSES — the reading is below the reserve.
  // -------------------------------------------------------------------------
  const refused = await thrown(() => githubFetch('https://api.github.com/y', { purpose: 'bulk' }));
  check(
    'a bulk request below the reserve is refused by the BUDGET, before the network',
    refused !== null && /Refusing a bulk GitHub request/u.test(refused.message),
    `got ${String(refused?.message ?? 'no error')}. This is the case that would have prevented ` +
      `the measurement from starving the board reader.`,
  );
  check(
    'and the refusal says it is the budget rather than the API, and names both numbers',
    refused !== null &&
      /budget saying no, not the API/u.test(refused.message) &&
      refused.message.includes(String(RESERVE)) &&
      refused.message.includes('3 of 60'),
    `a refusal indistinguishable from an HTTP 403 sends the reader to wait for a reset that ` +
      `already happened. Got: ${String(refused?.message ?? '')}`,
  );

  // -------------------------------------------------------------------------
  // 3. CONTROL: the critical caller is NOT refused in the same state.
  //
  // Without this the module could refuse everything and satisfy case 2, which is
  // the failure that would take the board reader down along with the walk.
  // -------------------------------------------------------------------------
  check(
    'CONTROL: a critical request in the SAME state goes through',
    (await thrown(() => githubFetch('https://api.github.com/z', { purpose: 'critical' }))) === null,
    'the reserve exists to be spent by the board reader. A budget that refuses it too has ' +
      'protected nothing and broken the caller it was written for.',
  );

  // -------------------------------------------------------------------------
  // 4. CONTROL: a healthy quota does not refuse a bulk caller either.
  // -------------------------------------------------------------------------
  resetQuota();
  stubFetch({ remaining: '58', limit: '60' });
  await githubFetch('https://api.github.com/probe', { purpose: 'critical' });
  check(
    'CONTROL: with the quota healthy, a bulk walk is allowed',
    (await thrown(() => githubFetch('https://api.github.com/bulk', { purpose: 'bulk' }))) === null,
    'a guard that refuses bulk work at 58 of 60 is one somebody removes. Ordinary work has to ' +
      'stay ordinary.',
  );

  // -------------------------------------------------------------------------
  // 5. A MISSING HEADER LEAVES THE PREVIOUS READING STANDING.
  //
  // `Number(null)` is 0, so an absent header parsed naively reads as "quota
  // exhausted" — the reassuring answer's opposite, and just as wrong.
  // -------------------------------------------------------------------------
  stubFetch({ remaining: null, limit: null });
  await githubFetch('https://api.github.com/noheaders', { purpose: 'critical' });
  check(
    'a response with no quota headers does not overwrite the reading with zero',
    quotaSeen()?.remaining === 58,
    `got ${JSON.stringify(quotaSeen())}. An absent measurement must not present itself as a ` +
      `measured emergency.`,
  );
  check(
    'CONTROL: and a response WITH headers does update it',
    await (async () => {
      stubFetch({ remaining: '7', limit: '60' });
      await githubFetch('https://api.github.com/withheaders', { purpose: 'critical' });
      return quotaSeen()?.remaining === 7;
    })(),
    'a module that never updates its reading satisfies the case above by doing nothing at all.',
  );
} finally {
  globalThis.fetch = realFetch;
  resetQuota();
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} githubFetch case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('githubFetch case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
