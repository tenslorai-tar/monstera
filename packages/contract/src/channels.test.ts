import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { createClient, wrapHandlers } from './boundary.js';
import { channelIds, channels, type ContractHandlers } from './channels.js';
import type { Incident } from './incident.js';

/** Discards a diagnostic. The sink is required rather than defaulted. */
function ignore(_incident: Incident): void {
  // See incident.ts: forgetting a destination is a compile error, so "not
  // interested" has to be written down rather than left out.
}

/**
 * The **real** channel map, implemented once — the only place in the repository
 * that implements it.
 *
 * Everything else builds a *fixture* registry: `boundary.test.ts` has its own
 * two-channel map, and `scripts/proofs/contract.proof.mjs` compiles handler maps
 * from source held in strings. So nothing had ever asked whether the shipping
 * map can be satisfied at all, and a channel declared here with no handler was a
 * renderer call that hangs, caught only by a 51-second compile-fail proof.
 *
 * **What this does not fix, stated because the neighbouring finding is about
 * exactly that** (W-2): the compile-fail proof holds a second copy of
 * handler-map source *as strings*, and `typecheck` cannot see inside a string —
 * that is what a compile-fail proof is for, and it is also its cost. When
 * `Handlers` changed shape, this file's kind of fixture moved with it and that
 * one did not, leaving `proof:contract` red on `main` for three commits while
 * `typecheck` and `test` were green and right to be.
 */
const handlers: ContractHandlers = {
  'app.info': () => Promise.resolve(ok({ version: '0.0.0', installChannel: 'development' })),
  'document.open': () => Promise.resolve(ok({ kind: 'cancelled' as const })),
  'document.undo': () => Promise.resolve(ok({ kind: 'nothing-to-undo' as const })),
  'document.execute': () => Promise.resolve(ok({ version: asDocVersion(1) })),
};

describe('the shipping contract, exercised through its own map', () => {
  it('every declared channel has a handler, and the map has no others', () => {
    // The mapped type already makes both a compile error. This asserts the
    // runtime consequence the type cannot: that the id list the registration
    // loop iterates and the map it indexes are the same set. A channel declared
    // and unhandled is a renderer call that hangs.
    expect(Object.keys(handlers).sort()).toStrictEqual([...channelIds].sort());
  });

  it('a real channel round-trips from client to handler and back', async () => {
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    await expect(
      client['document.execute']({
        docId: asDocId('doc-1'),
        command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
      }),
    ).resolves.toStrictEqual(ok({ version: 1 }));
  });

  it('the params schema REFUSES a command the union does not declare', async () => {
    // The boundary validates inbound params in one place, and this is the
    // channel where that matters most: a command is the renderer asking for a
    // mutation, and an unrecognised one must not reach the routing table.
    const client = createClient(channels, (id, params) =>
      wrapHandlers(channels, handlers, ignore)[id](params),
    );

    const result = await client['document.execute']({
      docId: asDocId('doc-1'),
      // Deliberately not a declared kind. Cast because the point is the runtime
      // check for what the type cannot see — a renderer on a drifted build.
      command: { kind: 'formatHardDrive' } as unknown as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('internal');
  });
});
