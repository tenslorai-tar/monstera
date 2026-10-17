import { describe, expect, it } from 'vitest';

import { placesAhead } from './placesAhead.js';

/** A send whose settling the case decides. */
function send(): { readonly settled: Promise<void>; readonly land: () => void; readonly refuse: () => void } {
  let land: () => void = () => undefined;
  let refuse: () => void = () => undefined;
  const settled = new Promise<void>((resolve, reject) => {
    land = resolve;
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

  it('CONTROL: an object nothing was sent for has no place ahead, and one object’s sends are not another’s', () => {
    const places = placesAhead<number>();
    places.sent('one', 5, new Promise(() => undefined));
    expect(places.ahead('two')).toBeUndefined();
    expect(places.ahead('one')).toBe(5);
  });
});
