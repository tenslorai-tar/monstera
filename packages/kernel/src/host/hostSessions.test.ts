import { describe, expect, it } from 'vitest';

import { TOKEN_BYTES } from '../token.js';
import { createHostSessions } from './hostSessions.js';
import type { HostSession } from './engineHandlers.js';

/**
 * The engine host's session store (finding JJJJ-1).
 *
 * The module arrived with no proof of its own and was exercised only
 * **indirectly**, through `hostBody.test.ts`'s `engine/close` case. That reaches
 * `lookup` and nothing else, which is why the gap did not look like one.
 *
 * **The property under test is the one this repository has already lost once.**
 * `token.ts` records it in its own header: a test naming the entropy claim
 * *"asserted uniqueness and a 43-character shape, both of which a padded counter
 * satisfies — and a padded counter substituted for the CSPRNG left the whole
 * suite green."* `createHostSessions` takes its byte source injected precisely
 * so that claim is reachable, and until now nothing used the injection point.
 *
 * So the cases below drive the source deliberately rather than asserting shapes
 * a counter would also produce.
 */

const held = (marker: string): HostSession =>
  // The session token is opaque to this module — it stores and returns it — so
  // a branded stand-in is enough and a real MuPDF session would drag a native
  // library into a test about a Map.
  ({ session: { engine: 'mupdf' } as HostSession['session'], outputDirectory: marker });

/** A source that returns the same bytes every time. */
function repeating(byte: number): () => Uint8Array {
  return () => new Uint8Array(TOKEN_BYTES).fill(byte);
}

describe('the engine host session store', () => {
  it('issues an id that resolves back to what was stored', () => {
    let counter = 0;
    const sessions = createHostSessions(() => {
      counter += 1;
      return new Uint8Array(TOKEN_BYTES).fill(counter);
    });

    const first = sessions.issue(held('out-1'));
    const second = sessions.issue(held('out-2'));

    expect(sessions.lookup(first)?.outputDirectory).toBe('out-1');
    expect(sessions.lookup(second)?.outputDirectory).toBe('out-2');
    expect(first).not.toBe(second);
  });

  it('REFUSES a source that repeats, rather than overwriting the earlier session', () => {
    const sessions = createHostSessions(repeating(7));
    const first = sessions.issue(held('the-first-document'));

    // THE BRANCH NOTHING REACHED. A source that repeats is not chance at 256
    // bits — it is a source that is not delivering the entropy it claims — and
    // the failure mode of overwriting is that two documents share one native
    // session and the first `close` frees the second's.
    expect(() => sessions.issue(held('the-second-document'))).toThrow(/already issued/u);

    // AND THE FIRST SESSION IS UNTOUCHED, which is the half a throw alone does
    // not establish: a store that threw *after* overwriting would pass the line
    // above while having already lost the document.
    expect(sessions.lookup(first)?.outputDirectory).toBe('the-first-document');
  });

  it('draws from the injected source rather than from anything of its own', () => {
    // THE CONTROL for the case above, and it is the one that stops this file
    // being satisfied by a store that ignores its source entirely. Such a store
    // would issue distinct ids from some internal counter and never throw — so
    // "it refused a repeating source" would be unreachable rather than proven,
    // and the case above would be testing nothing.
    //
    // Asserted by DRAW COUNT, not by the id's shape: a store minting its own
    // ids produces perfectly well-formed base64url too.
    let draws = 0;
    const sessions = createHostSessions(() => {
      draws += 1;
      return new Uint8Array(TOKEN_BYTES).fill(draws);
    });

    sessions.issue(held('out-1'));
    sessions.issue(held('out-2'));

    expect(draws).toBe(2);
  });

  it('forgets an id without touching the session behind it', () => {
    const sessions = createHostSessions(repeating(3));
    const id = sessions.issue(held('out-1'));

    sessions.forget(id);

    // `forget` removes the id and does NOT close the native session — that
    // ordering lives in `engine/close`, which forgets first and then closes so
    // a second call cannot reach the adapter's double-close path. A `forget`
    // that closed would put that ordering in two places (B3).
    expect(sessions.lookup(id)).toBeUndefined();
  });

  it('answers an id it never issued with undefined, not a throw', () => {
    const sessions = createHostSessions(repeating(1));

    // An OUTCOME rather than a defect: a rebuilt host holds none of the previous
    // one's sessions, so a call arriving with an old id is ordinary and the
    // handler turns this miss into a declared `no-such-session`.
    expect(sessions.lookup('an-id-from-a-host-that-is-gone')).toBeUndefined();
  });
});
