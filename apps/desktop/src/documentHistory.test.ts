import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHistoryRewrite } from '@monstera/nodemode';
import { asDocId } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createDocumentHistory } from './documentHistory.js';
import { createHistoryStore } from './historyStore.js';
import type { SecretCipher } from './secretStore.js';

/**
 * The adapter between a `DocId` and ADR-0279's store: the guard read at the open, carried by every save, and re-linked
 * after Monstera's own save (Decision 5). What each case asserts is whether this PDF's conversations are LISTED, which is
 * the decision the guard exists for.
 */

const cipher: SecretCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(`k|${value}`, 'utf8'),
  decrypt: (blob) => blob.toString('utf8').slice(2),
};
const DOC = asDocId('00000000-0000-4000-8000-0000000000e1');
const PLACE = 'C:/Users/someone/lease.pdf';
const PLACE_KEY = 'e'.repeat(64);
const TURNS = [{ role: 'user' as const, text: 'Who signs?' }];
const AT = new Date('2026-11-12T10:00:00.000Z');

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** The adapter over a real store, with what the host reads and what the disk says held by the case. */
function world(id: string | null) {
  const directory = mkdtempSync(join(tmpdir(), 'monstera-document-history-'));
  made.push(directory);
  const store = createHistoryStore(directory, cipher, undefined, (data) => Promise.resolve(runHistoryRewrite(data)));
  const disk = { id, size: 1000, mtimeMs: 1_700_000_000_000, readFails: false };
  const history = createDocumentHistory({
    store,
    placeKeyOf: (docId) => (docId === DOC ? PLACE_KEY : undefined),
    permanentIdOf: () => (disk.readFails ? Promise.reject(new Error('the host is gone')) : Promise.resolve(disk.id)),
    stat: () => ({ size: disk.size, mtimeMs: disk.mtimeMs }),
  });
  return { store, history, disk };
}

describe('the guard is read at the open and carried by every save (ADR-0279 Decision 5)', () => {
  /**
   * Saves one conversation, writes new bytes at the place, re-links or not, then REOPENS: what the next open lists. The
   * reopen is a new adapter over the same store, so what it lists is what the GUARD on disk finds, never a guard the first
   * session still holds (HHHHHHHHH-21: a list in the same session passes whatever the guard is).
   */
  const reopenedAfterSave = async (relink: boolean, id: string | null = null): Promise<number> => {
    const { store, history, disk } = world(id);
    history.opened(DOC, PLACE, Promise.resolve());
    await history.save(DOC, null, TURNS, 'lease.pdf', AT);
    disk.size = 2000;
    disk.mtimeMs += 5000;
    if (relink) await history.saved(DOC);
    const next = createDocumentHistory({
      store,
      placeKeyOf: () => PLACE_KEY,
      permanentIdOf: () => Promise.resolve(id),
      stat: () => ({ size: disk.size, mtimeMs: disk.mtimeMs }),
    });
    next.opened(DOC, PLACE, Promise.resolve());
    return (await next.list(DOC))?.length ?? -1;
  };

  it('a PDF with an /ID is guarded by it: after a save that writes new bytes, the NEXT OPEN lists its conversations with no re-link', async () => {
    // THE SAVE KEEPS THE FIRST /ID STRING, so the guard is the same at the next open whatever the size and time say. A guard
    // taken by stamp instead, the bug, lists none here: the stamp case's control below is the same reopen.
    expect(await reopenedAfterSave(false, 'a1b2')).toBe(1);
  });

  it('a PDF with NO /ID is guarded by its stamp, and the RE-LINK after Monstera’s save keeps its conversations at the next open', async () => {
    expect(await reopenedAfterSave(true)).toBe(1);
    // CONTROL: the same new bytes WITHOUT the re-link are a different document to the guard, so the next open lists none.
    expect(await reopenedAfterSave(false)).toBe(0);
  });

  it('a guard the host could not read is a FAILURE the next history call reports, and never fails the document’s save', async () => {
    const { history, disk } = world('a1b2');
    disk.readFails = true;
    history.opened(DOC, PLACE, Promise.resolve());
    await expect(history.save(DOC, null, TURNS, 'lease.pdf', AT)).rejects.toThrow(/the host is gone/u);
    // THE DOCUMENT'S SAVE SUCCEEDED: its re-link resolves, holding the failure for the history call that needs it.
    await expect(history.saved(DOC)).resolves.toBeUndefined();
    await expect(history.list(DOC)).rejects.toThrow(/the host is gone/u);
  });

  it('a document not open here answers undefined on every call; CONTROL: the open one answers', async () => {
    const { history } = world('a1b2');
    const other = asDocId('00000000-0000-4000-8000-0000000000e2');
    history.opened(DOC, PLACE, Promise.resolve());
    expect(await history.save(other, null, TURNS, null, AT)).toBeUndefined();
    expect(await history.list(other)).toBeUndefined();
    expect(await history.list(DOC)).toStrictEqual([]);
    // AND AFTER ITS CLOSE, the open one is not open here either.
    history.closed(DOC);
    expect(await history.list(DOC)).toBeUndefined();
  });
});
