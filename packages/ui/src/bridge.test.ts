import { type MonsteraBridge, channelIds } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { BridgeUnavailableError, createRendererClient } from './bridge.js';

/**
 * The renderer client, over a recording transport.
 *
 * This package may import `shared` and `contract` only — the boundary forbids
 * `@monstera/testing`, so the browser shim cannot be used here. That is the
 * right constraint and not an inconvenience: what these cases are about is the
 * transport contract between renderer and preload, and a shim would supply a
 * *different* transport, hiding the thing under test behind a second one.
 */

/** Records every call, and answers with whatever it was told to. */
function transport(reply: unknown): MonsteraBridge & { readonly calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    invoke: (channel, params) => {
      calls.push([channel, params]);
      return Promise.resolve(reply);
    },
  };
}

describe('the renderer contract client', () => {
  it('exposes every declared channel, derived from the registry', () => {
    const client = createRendererClient(transport({ ok: true, value: {} }));

    // Compared against the registry rather than a list written here. A literal
    // list is the second place a channel gets written down, which is what
    // deriving the surface exists to prevent.
    expect(Object.keys(client).sort()).toEqual([...channelIds].sort());
  });

  it('sends the channel id and the params to the bridge, unchanged', async () => {
    const bridge = transport({ ok: true, value: { version: '1.2.3', installChannel: 'store' } });
    const client = createRendererClient(bridge);

    const result = await client['app.info']({});

    expect(bridge.calls).toEqual([['app.info', {}]]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.version).toBe('1.2.3');
  });

  it('returns a declared failure as a value the caller must destructure', async () => {
    const client = createRendererClient(transport({ ok: false, error: { code: 'document-busy' } }));

    const result = await client['document.execute']({
      // @ts-expect-error — branded ids are minted by the contract's schemas; a
      // test supplying a plain string is exercising the wire, which is what
      // actually arrives here.
      docId: 'doc-1',
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    expect(result.ok).toBe(false);
    // No `catch` anywhere. ADR-0009 §9 deleted the rebuild-an-Error path: there
    // is no message to rebuild from, the renderer's text comes from an i18n key,
    // and nothing forces a caller to write a `catch`.
    if (!result.ok) expect(result.error.code).toBe('document-busy');
  });

  it('THROWS on a malformed envelope rather than yielding undefined', async () => {
    const client = createRendererClient(transport({ nonsense: true }));

    // Main is not an attacker, but it can be a different build during
    // development. A malformed envelope must surface as a schema error naming
    // the channel, not as `undefined` propagating into the UI.
    await expect(client['app.info']({})).rejects.toThrow(/app\.info/u);
  });

  it('refuses to build a client when the bridge is absent', () => {
    expect(() => createRendererClient(undefined)).toThrow(BridgeUnavailableError);
  });

  it('CONTROL: the same call succeeds when a bridge is present', () => {
    // Without this, the case above is satisfied by a factory that throws for
    // every input — the failure a "does it throw?" assertion cannot see, and the
    // fixture half of item 4's direction rule.
    expect(() => createRendererClient(transport({ ok: true, value: {} }))).not.toThrow();
  });

  it('a missing bridge is distinguishable from a channel failure', async () => {
    // The two must not read alike. A client whose every call rejected would let
    // a missing preload be reported to the user as a document error.
    const busy = await createRendererClient(
      transport({ ok: false, error: { code: 'document-busy' } }),
    )['document.execute']({
      // @ts-expect-error — see above; the wire carries a plain string.
      docId: 'doc-1',
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    expect(busy.ok).toBe(false);
    expect(() => createRendererClient(undefined)).toThrow(BridgeUnavailableError);
  });
});
