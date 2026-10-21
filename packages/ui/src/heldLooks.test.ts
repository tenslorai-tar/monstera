import { asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { DocumentStores } from './documentStores.js';
import { createHeldLooks, heldOnPage, released, sendHeld } from './heldLooks.js';

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

  it('SENDING a held mark holds it, lets it paint, THEN sends — and a refusal lets it go', async () => {
    // THE ORDER IS THE DECISION, so the log is what is asserted: a send before the paint lets the answer's task take
    // the frame the look was to be drawn in (ADR-0257), and the end state would be the same either way.
    const log: string[] = [];
    const holder = createHeldLooks(() => asDocVersion(1));
    const paint = (): Promise<void> => {
      log.push(`paint with ${String(holder.getSnapshot().length)} held`);
      return Promise.resolve();
    };
    const moved = await sendHeld(holder, 2, look, () => {
      log.push('send');
      return Promise.resolve(true);
    }, paint);
    expect(moved).toBe(true);
    expect(log).toStrictEqual(['paint with 1 held', 'send']);
    // KEPT after an accepted send: the page drops it when it draws the mark, never the sender.
    expect(holder.getSnapshot()).toHaveLength(1);

    const refused = await sendHeld(holder, 2, look, () => Promise.resolve(false), paint);
    expect(refused).toBe(false);
    // HELD while it was sent (two at the paint), and only the refused one let go after.
    expect(log.at(-1)).toBe('paint with 2 held');
    expect(holder.getSnapshot()).toHaveLength(1);
  });

  it('CONTROL: with NO look there is nothing to hold and nothing to wait for — the command is sent at once', async () => {
    const log: string[] = [];
    const holder = createHeldLooks(() => asDocVersion(1));
    await sendHeld(holder, 2, undefined, () => {
      log.push('send');
      return Promise.resolve(true);
    }, () => {
      log.push('paint');
      return Promise.resolve();
    });
    expect(log).toStrictEqual(['send']);
    expect(holder.getSnapshot()).toStrictEqual([]);
  });
});
