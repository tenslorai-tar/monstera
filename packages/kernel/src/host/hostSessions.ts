import { type TokenBytesSource, mintToken } from '../token.js';
import type { HostSession, HostSessions } from './engineHandlers.js';

/**
 * The sessions one engine host process holds, and the mint that names them
 * (ADR-0023 Decision 10b).
 *
 * ## The id is a TOKEN, not a counter
 *
 * The host mints identity and main holds a handle it cannot dereference. A
 * counter would satisfy every type here and would make one property false: main
 * would be able to *construct* an id it was never given. Nothing in this design
 * grants main that power on purpose, and the difference only shows up in the
 * case where main is confused rather than malicious — which is exactly the case
 * `no-such-session` exists to answer cheaply.
 *
 * 32 bytes of base64url is 43 characters, inside `ENGINE_SESSION_ID_MAX_CHARS`
 * with room to spare. The source is injected for the reason `token.ts` states
 * about its own: an entropy claim no test can reach is one the code is free to
 * lose, and a padded counter satisfies both "unique" and "43 characters".
 *
 * ## Forgetting is not closing
 *
 * `forget` removes the id and returns what was behind it. It does **not** touch
 * the native session, because this module has no engine and must not acquire
 * one — `engine/close` forgets first and then closes, so that a second call
 * cannot reach the adapter's double-close path. Putting the close here would put
 * that ordering in two places (B3).
 */
export function createHostSessions(source: TokenBytesSource): HostSessions {
  const held = new Map<string, HostSession>();

  return {
    lookup: (id) => held.get(id),

    issue: (session) => {
      const id = mintToken('engine host session', source);
      // A COLLISION IS A THROW, not an overwrite. At 256 bits this cannot
      // happen by chance, so if it does, the byte source is not what it claims
      // to be — and the failure mode of overwriting is that two documents share
      // one native session and the first `close` frees the second's.
      if (held.has(id)) {
        throw new Error(
          'the engine host session mint issued an id it had already issued. At 256 bits ' +
            'this is not chance; the byte source is not delivering the entropy it claims, ' +
            'and two documents would otherwise share one native session.',
        );
      }
      held.set(id, session);
      return id;
    },

    forget: (id) => {
      held.delete(id);
    },
  };
}
