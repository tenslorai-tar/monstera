import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DocumentStores } from './documentStores.js';
import { createHeldLooks, heldOnPage, released } from './heldLooks.js';

describe('released marks held in their final look (ADR-0257)', () => {
  const look = { parts: [] };

  it('a look is held at the version the document shows, shown by its page until the page draws a NEWER one, then dropped', () => {
    let version = asDocVersion(4);
    const holder = createHeldLooks(() => version);
    let heard = 0;
    const stop = holder.subscribe(() => {
      heard += 1;
    });
    const entry = holder.hold(2, look);
    expect(entry).toMatchObject({ page: 2, at: 4 });
    expect(heard).toBe(1);
    // THE VERSION IS READ AT EACH HOLD, not when the holder was made: a later hold is at the later version.
    version = asDocVersion(5);
    expect(holder.hold(3, look).at).toBe(5);
    const held = holder.getSnapshot();
    // SHOWN while the page is drawn from the version it was released over, or before the page has drawn at all.
    expect(heldOnPage(held, 2, asDocVersion(4))).toStrictEqual([entry]);
    expect(heldOnPage(held, 2, undefined)).toStrictEqual([entry]);
    // GONE in the render that carries the newer drawing, and named for the holder to drop.
    expect(heldOnPage(held, 2, asDocVersion(5))).toStrictEqual([]);
    expect(released(held, 2, asDocVersion(5))).toStrictEqual([entry]);
    // CONTROL: another page never shows it, and the same version releases nothing.
    expect(heldOnPage(held, 4, asDocVersion(4))).toStrictEqual([]);
    expect(released(held, 2, asDocVersion(4))).toStrictEqual([]);
    holder.letGo(entry);
    expect(holder.getSnapshot()).toHaveLength(1);
    // IDEMPOTENT: a refusal and the page may both drop it, and the second tells nobody.
    const before = heard;
    holder.letGo(entry);
    expect(heard).toBe(before);
    stop();
  });

  it('an open document has ONE holder, which reads its version, and closing the document drops it', () => {
    const stores = new DocumentStores();
    const id = asDocId('00000000-0000-4000-8000-000000000001');
    const store = stores.open(id, asDocVersion(7));
    const holder = stores.held(id);
    expect(holder).toBeDefined();
    // THE SAME HOLDER every time it is asked for, so every route holds into one list.
    expect(stores.held(id)).toBe(holder);
    store.getState().observed(asDocVersion(8));
    expect(holder?.hold(0, look).at).toBe(8);
    stores.close(id);
    expect(stores.held(id)).toBeUndefined();
  });
});
