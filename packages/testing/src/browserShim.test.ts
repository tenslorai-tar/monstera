import { INTERNAL_FAILURE, asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { createBrowserShim } from './browserShim.js';

/**
 * The shim is a test double, so its own tests carry an unusual burden: a double
 * that has drifted from the contract passes every test written against it. Two
 * properties do the work here.
 *
 * - **It is DERIVED.** `createClient` builds the surface from the registry, so
 *   drift is a compile error rather than something a test could catch. The test
 *   that matters for that is `tsc`, and it is not written below.
 * - **It models the WIRE, not a convenient object pass.** The clone cases are
 *   the ones with no obvious reason to exist and the most value: a shim that
 *   passes references accepts values the real bridge rejects, and every test
 *   built on it stays green while the application fails.
 */
describe('browser shim', () => {
  it('answers app.info without claiming to be a Store build', async () => {
    const shim = createBrowserShim();
    const result = await shim.client['app.info']({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe('0.0.0-shim');
    // Never `store`. A shim reporting the Store channel would let a test assert
    // update behaviour only the packaged artifact can have.
    expect(result.value.installChannel).toBe('development');
  });

  it('advances the version by one per command, from 1', async () => {
    const shim = createBrowserShim();
    const docId = shim.open();
    expect(shim.versionOf(docId)).toBe(1);

    const first = await shim.client['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.version).toBe(2);
    expect(shim.versionOf(docId)).toBe(2);
  });

  it('reports a closed document as a VALUE, never as a throw', async () => {
    const shim = createBrowserShim();
    const docId = shim.open();
    shim.close(docId);

    const result = await shim.client['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('document-not-open');
    // A declared failure travels alone. `.strict()` on the wire schema is what
    // stops a diagnostic riding along, and this asserts the shim honours it.
    expect(Object.keys(result.error)).toEqual(['code']);
  });

  it('reports a saturated lane as its declared code', async () => {
    const shim = createBrowserShim({ busy: new Set(['busy-doc']) });
    shim.open('busy-doc');

    const result = await shim.client['document.execute']({
      docId: asDocId('busy-doc'),
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('document-busy');
  });

  it('withholds a thrown diagnostic and hands back an incident id', async () => {
    const shim = createBrowserShim({ faulty: new Set(['bad-doc']) });
    shim.open('bad-doc');

    const result = await shim.client['document.execute']({
      docId: asDocId('bad-doc'),
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(INTERNAL_FAILURE);
    expect('incident' in result.error && result.error.incident).toBeTruthy();

    // THE HALF THAT MATTERS: the diagnostic exists, and it did not cross. A
    // renderer that can read the message is a renderer that can read a path.
    expect(shim.incidents).toHaveLength(1);
    expect(shim.incidents[0]?.diagnostic.message).toContain('injected engine fault');
    expect(JSON.stringify(result.error)).not.toContain('injected engine fault');
  });

  it('turns malformed params into an incident rather than a crash', async () => {
    const shim = createBrowserShim();

    const result = await shim.client['document.execute'](
      // @ts-expect-error — the point of the case is that an untyped caller,
      // which is what a real renderer is once the value crosses, cannot get past
      // the boundary's parse.
      { docId: '', command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 } },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(INTERNAL_FAILURE);
    expect(shim.incidents).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // THE WIRE MODEL, and the control for it.
  //
  // An in-process shim that passes object references accepts values the real
  // bridge rejects — a function, a class instance, a Symbol — so every test
  // built on it stays green while the shipped application fails on the first
  // call. Item 2: the harness must not be richer than the real caller.
  // ---------------------------------------------------------------------------
  it('refuses a param that could not survive serialisation', async () => {
    const shim = createBrowserShim();
    const docId = shim.open();

    await expect(
      shim.client['document.execute']({
        docId,
        // @ts-expect-error — no legal command carries a function. The case is
        // about what happens when one arrives anyway, which is what an `any` at
        // some call site produces.
        command: { kind: 'rotatePages', pages: [0], quarterTurns: 1, onDone: () => undefined },
      }),
    ).rejects.toThrow();
  });

  it('CONTROL: the same call without the function succeeds', async () => {
    const shim = createBrowserShim();
    const docId = shim.open();

    const result = await shim.client['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    // Without this, the case above is satisfied by a shim that rejects
    // everything — which is the failure mode a "does it throw?" assertion
    // cannot see on its own.
    expect(result.ok).toBe(true);
  });

  // This case is kept and its ATTRIBUTION is corrected, which is the useful
  // part. It was written to cover the shim's outbound clone; mutation showed it
  // passes with that clone removed, because `wrapHandler` returns
  // `parsedResult.data` — an object zod's parse just built — so a result is
  // already fresh either way.
  //
  // So it does not test the clone. It tests the PROPERTY, which is worth having
  // and is currently supplied by the boundary's schema parse: a caller cannot
  // reach main's state through a returned object. It will start covering the
  // clone on the day a channel declares a result schema that can return its
  // input by reference, and that is the honest description of what it guards.
  it('a returned object is not a live reference into the shim (via the boundary parse)', async () => {
    const shim = createBrowserShim();
    const docId = shim.open();

    const result = await shim.client['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mutable = result as { value: { version: number } };
    mutable.value.version = 99;
    expect(shim.versionOf(docId)).toBe(2);
  });

  it('implements every declared channel', () => {
    const shim = createBrowserShim();
    // The registry is the source of truth; this reads the client's own keys
    // rather than restating the channel list, which would be the second place a
    // channel is written down.
    //
    // THE LITERAL IS THE ANCHOR AND IS DELIBERATE (checklist 4c). Comparing the
    // client's keys with `channelIds` alone would agree when both are empty —
    // a `channels` that failed to build and a client that built nothing from it
    // produce the same clean result. The literal is the one side a shrink has to
    // touch separately, so it grows by hand when a channel lands.
    expect(Object.keys(shim.client).sort()).toEqual([
      'app.info',
      'document.execute',
      'document.open',
      'document.undo',
    ]);
  });

  describe('document.open', () => {
    it('cancels when nothing was queued, changing no state', async () => {
      // The DEFAULT, and it is the outcome that does nothing. A shim defaulting
      // to `opened` would quietly open a document in every test that never
      // mentions opening, and those tests would pass for a reason none of them
      // states.
      const shim = createBrowserShim();

      const result = await shim.client['document.open']({});

      expect(result).toStrictEqual({ ok: true, value: { kind: 'cancelled' } });
    });

    it('answers queued outcomes in order, so a sequence can be expressed', async () => {
      const docId = asDocId('doc-7');
      const shim = createBrowserShim({
        opens: [{ kind: 'cancelled' }, { kind: 'opened', docId, version: asDocVersion(1) }],
      });

      expect(await shim.client['document.open']({})).toStrictEqual({
        ok: true,
        value: { kind: 'cancelled' },
      });
      expect(await shim.client['document.open']({})).toStrictEqual({
        ok: true,
        value: { kind: 'opened', docId, version: 1 },
      });
      // Exhausted, so back to the default rather than repeating the last.
      expect(await shim.client['document.open']({})).toStrictEqual({
        ok: true,
        value: { kind: 'cancelled' },
      });
    });

    it('an opened document is one document.execute will accept', async () => {
      // THE CASE THAT KEEPS THE DOUBLE HONEST. A shim reporting a document open
      // and then refusing every command against it would offer a state the real
      // boundary cannot produce, and a test written against that state would
      // assert on a shape nothing ships.
      const docId = asDocId('doc-8');
      const shim = createBrowserShim({ opens: [{ kind: 'opened', docId, version: asDocVersion(3) }] });

      await shim.client['document.open']({});
      const executed = await shim.client['document.execute']({
        docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      });

      expect(executed).toStrictEqual({ ok: true, value: { version: 4 } });
    });

    it('carries no path in either direction', async () => {
      // Invariant 1, asserted at the surface a renderer actually holds. The
      // params type is `Record<string, never>`, so this is the runtime half of
      // a claim the type already makes — and it is the half that would survive
      // somebody widening the schema.
      const shim = createBrowserShim({
        opens: [{ kind: 'opened', docId: asDocId('doc-9'), version: asDocVersion(1) }],
      });

      const result = await shim.client['document.open']({});

      expect(JSON.stringify(result)).not.toMatch(/[/\\]/u);
    });
  });
});
