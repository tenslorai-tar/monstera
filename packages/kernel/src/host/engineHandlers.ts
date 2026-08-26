import { type Handlers } from '@monstera/contract';

import { type CommandExecution } from '../commandSpecs.js';
import { type MupdfSession } from '../engineSeam.js';
import { type EngineChannels } from './engineChannels.js';

/**
 * The engine host's side of Decision 10: it looks the spec up and calls it
 * against a session **it** holds.
 *
 * The main-side adapter in `remoteEngine.ts` sends intent; this performs the
 * same `declaredSpecs` lookup `localMupdfExecution` performs, because
 * `packages/kernel` is what the host body runs. One implementation per command,
 * executed where the session is (B3a).
 */

/** The sessions one host process holds, keyed by the id it issued. */
export interface HostSessions {
  /** The session behind an id this host issued, or `undefined`. */
  readonly lookup: (id: string) => MupdfSession | undefined;
}

/**
 * @param sessions what this host holds. `undefined` is an OUTCOME here, not a
 *   defect: a rebuilt host holds none of the previous one's sessions, so a call
 *   arriving with an old id is ordinary and gets a declared code.
 * @param execution how this process runs a command — `localMupdfExecution` in
 *   the host, and injectable so a proof can drive both halves without a
 *   document.
 */
export function createEngineHandlers(
  sessions: HostSessions,
  execution: CommandExecution<'mupdf'>,
): Handlers<EngineChannels> {
  // THE MISS IS RETURNED, NEVER THROWN, and that is the load-bearing choice in
  // this file. A throw crossing this boundary becomes `internal` with its
  // diagnostic withheld — and the supervisor cannot act on `internal`.
  // Decision 9 has it rebuild when a session is gone, which is a decision it can
  // only take from a code it can read.
  //
  // Written out three times rather than behind a helper: a helper returning
  // "either a session or a failure" needs a discriminator over a BRANDED token,
  // which is a type-level trick standing where three plain lines say it.
  const gone = { ok: false, error: { code: 'no-such-session' } } as const;

  return {
    'engine/apply': async ({ session, command }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      await execution.apply(held, command);
      return { ok: true, value: {} };
    },

    'engine/capture': async ({ session, command }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      const captured = await execution.capture(held, command);
      return captured.captured
        ? // The kind is stamped from the COMMAND THIS CALL CARRIED, so the tag
          // and the prior state cannot disagree at the source. What it buys is
          // on the other side: main refuses an answer whose tag is not the one
          // it asked for, and that check needs a tag to check.
          { ok: true, value: { captured: true, value: { kind: command.kind, prior: captured.prior } } }
        : { ok: true, value: { captured: false, reason: captured.reason } };
    },

    'engine/invert': async ({ session, inverse }) => {
      const held = sessions.lookup(session);
      if (held === undefined) return gone;
      await execution.invert(held, inverse.kind, inverse.prior);
      return { ok: true, value: {} };
    },
  };
}
