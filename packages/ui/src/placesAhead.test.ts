import { type DocVersion, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { placesAhead } from './placesAhead.js';

/** A send whose settling the case decides. */
function send(): { readonly settled: Promise<undefined>; readonly land: () => void; readonly refuse: () => void } {
  let land: () => void = () => undefined;
  let refuse: () => void = () => undefined;
  // SETTLED WITH NO VERSION, as a mark's move is: the first rule alone.
  const settled = new Promise<undefined>((resolve, reject) => {
    land = () => {
      resolve(undefined);
    };
    refuse = () => {
      reject(new Error('refused'));
    };
  });
  return { settled, land, refuse };
}

describe('placesAhead', () => {
  it('answers the LAST place sent while any send of it is unsettled, so four presses add up to four', async () => {
    const places = placesAhead<number>();
    const sends = [send(), send(), send(), send()];
    let at = 100;
    for (const each of sends) {
      // EACH PRESS STARTS FROM WHERE THE ONE BEFORE SENT IT, the read being the original 100 throughout.
      at = (places.ahead('field') ?? 100) + 1;
      places.sent('field', at, each.settled);
    }
    expect(at).toBe(104);
    sends[0]?.land();
    await Promise.resolve();
    // ONE LANDED, three unsettled: still ahead.
    expect(places.ahead('field')).toBe(104);
  });

  it('gives the place back to the read once every send has settled, a refused one included', async () => {
    const places = placesAhead<number>();
    const first = send();
    const second = send();
    places.sent('field', 101, first.settled);
    places.sent('field', 102, second.settled);
    first.land();
    second.refuse();
    await second.settled.catch(() => undefined);
    await Promise.resolve();
    expect(places.ahead('field')).toBeUndefined();
  });

  it('keeps a LANDED place while the read predates the version it produced, and gives it back once the read is there (2026-10-19)', async () => {
    // THE FIELD'S SELECTION RESOLVES AGAINST THE LAST LIST READ, which can be older than the write that just landed: a
    // nudge then started from the place BEFORE the drag and undid it (the forms walk's gate-launched runs).
    const places = placesAhead<number>();
    let land: (version: DocVersion) => void = () => undefined;
    places.sent('field', 140, new Promise<DocVersion>((resolve) => (land = resolve)));
    land(asDocVersion(8));
    await Promise.resolve();
    await Promise.resolve();
    expect(places.ahead('field', asDocVersion(7))).toBe(140);
    expect(places.ahead('field', asDocVersion(8))).toBeUndefined();
    // GONE FOR GOOD once the read caught up: an older read later would not bring a stale place back.
    expect(places.ahead('field', asDocVersion(7))).toBeUndefined();
  });

  it('CONTROL: a send naming no version, or a later one refused, gives the place back as it settles, whatever the read', async () => {
    const plain = placesAhead<number>();
    const unversioned = send();
    plain.sent('field', 101, unversioned.settled);
    unversioned.land();
    await Promise.resolve();
    await Promise.resolve();
    expect(plain.ahead('field', asDocVersion(1))).toBeUndefined();

    const refusedLast = placesAhead<number>();
    let land: (version: DocVersion) => void = () => undefined;
    refusedLast.sent('field', 101, new Promise<DocVersion>((resolve) => (land = resolve)));
    const second = send();
    refusedLast.sent('field', 102, second.settled);
    land(asDocVersion(8));
    second.refuse();
    await second.settled.catch(() => undefined);
    await Promise.resolve();
    expect(refusedLast.ahead('field', asDocVersion(7))).toBeUndefined();
  });

  it('CONTROL: an object nothing was sent for has no place ahead, and one object’s sends are not another’s', () => {
    const places = placesAhead<number>();
    places.sent('one', 5, new Promise(() => undefined));
    expect(places.ahead('two')).toBeUndefined();
    expect(places.ahead('one')).toBe(5);
  });
});
