import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SavedTurn } from '@monstera/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Every path the store opened for reading or read whole, recorded by the spy below. */
const reads: string[] = vi.hoisted(() => []);
/** Every path read WHOLE by the store itself: what Delete's rewrite must leave to its worker (ADR-0279 Decision 7). */
const wholeReads: string[] = vi.hoisted(() => []);
/**
 * Whether the rewriter is running. The cases hand the store an IN-PROCESS rewriter, so `runHistoryRewrite` is read from
 * source like everything else here; the real worker loads the package's build, which a test of this store must not
 * (`testResolution.proof.mjs`). Reads made inside it are the worker's, not the store's, so they are not recorded as whole
 * reads. That the worker really is another thread is `historyRewriter.test.ts`'s.
 */
const rewriting = vi.hoisted(() => ({ now: false }));
/** Set by a case: the next append writes half its bytes, as a disk that fills does, and throws; `wrote` is how many. */
const filling = vi.hoisted(() => ({ next: false, wrote: 0 }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    openSync: (path: string, flags?: string, ...rest: unknown[]) => {
      if (flags === undefined || flags === 'r') reads.push(path);
      return (real.openSync as (...args: unknown[]) => number)(path, flags, ...rest);
    },
    appendFileSync: (path: string, data: Buffer, ...rest: unknown[]) => {
      if (!filling.next) {
        (real.appendFileSync as (...args: unknown[]) => void)(path, data, ...rest);
        return;
      }
      filling.next = false;
      const part = data.subarray(0, Math.floor(data.length / 2));
      real.appendFileSync(path, part);
      filling.wrote = part.length;
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    },
    readFileSync: (path: string, ...rest: unknown[]) => {
      reads.push(path);
      if (!rewriting.now) wholeReads.push(path);
      return (real.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

import { runHistoryRewrite } from '@monstera/nodemode';

import type { HistoryRewriter } from './historyRewriter.js';
import { type HistoryGuard, HistoryLockedError, createHistoryStore as storeWith, frame } from './historyStore.js';
import type { SecretCipher } from './secretStore.js';

/** The worker's rewrite, run here from source; see `rewriting` above. */
const inProcess: HistoryRewriter = (data) => {
  rewriting.now = true;
  try {
    return Promise.resolve(runHistoryRewrite(data));
  } finally {
    rewriting.now = false;
  }
};
const createHistoryStore = (directory: string, cipher: SecretCipher) => storeWith(directory, cipher, undefined, inProcess);

/**
 * ADR-0279's store, one file per PDF, against a FAKE of the account's cipher: Windows' own encryption is the local
 * agent's to measure where it ships. The fake wraps a value so that only its own `decrypt` reads it back, which is all
 * the store asks of the real one.
 */
function fakeCipher(account = 'me'): SecretCipher {
  return {
    available: () => true,
    encrypt: (value) => Buffer.from(`${account}|${value}`, 'utf8'),
    decrypt: (cipher) => {
      const text = cipher.toString('utf8');
      if (!text.startsWith(`${account}|`)) throw new Error('not this account’s');
      return text.slice(account.length + 1);
    },
  };
}

const PLACE = 'C:/Users/someone/Documents/contract.pdf';
const PLACE_KEY = 'a'.repeat(64);
const ID: HistoryGuard = { kind: 'id', id: 'f1e2d3c4' };
const STAMP: HistoryGuard = { kind: 'stamp', size: 1000, mtimeMs: 1_700_000_000_000 };
const TURNS: SavedTurn[] = [
  { role: 'user', text: 'Who signs the contract?' },
  { role: 'assistant', text: 'Both parties sign on page 4.' },
];
const AT = new Date('2026-11-12T10:00:00.000Z');

const made: string[] = [];
function folder(): string {
  const directory = mkdtempSync(join(tmpdir(), 'monstera-history-'));
  made.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Every byte under the history folder, the key file aside: what a search of the disk would read. */
function everyFileHolds(directory: string, needle: Buffer): boolean {
  const history = join(directory, 'history');
  return readdirSync(history)
    .filter((name) => name !== 'key')
    .some((name) => readFileSync(join(history, name)).includes(needle));
}

/**
 * Whether `bytes` are whole records end to end, each head's length leading exactly to the next and the last to the end:
 * a walk of the format written here from its definition (`[type u8][id, 32 bytes][length u32 LE][payload]`), so it is no
 * second reading of the store's own.
 */
function chainsToEnd(bytes: Buffer): boolean {
  let at = 0;
  while (at + 37 <= bytes.length) at += 37 + bytes.readUInt32LE(at + 33);
  return at === bytes.length;
}

describe('one history file per PDF (ADR-0279)', () => {
  it('a conversation saved is listed and read back whole, with no cap and nothing else read', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const { conversation } = store.save(PLACE_KEY, PLACE, ID, null, TURNS, 'contract.pdf', AT);
    expect(conversation).toMatch(/^[0-9a-f]{64}$/u);
    expect(store.list(PLACE_KEY, ID)).toStrictEqual([
      { key: conversation, name: 'contract.pdf', savedAt: AT.toISOString(), messages: 2, preview: 'Who signs the contract?' },
    ]);
    expect(store.read(PLACE_KEY, conversation ?? '')?.turns).toStrictEqual(TURNS);
    // NO CAP: a twenty-first, and more, are saved beside the others.
    for (let at = 0; at < 25; at += 1) store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: `Question ${String(at)}` }], null, AT);
    expect(store.list(PLACE_KEY, ID)).toHaveLength(26);
    // EVERYTHING A PERSON WROTE IS SEALED: the question is in no file in the clear.
    expect(everyFileHolds(directory, Buffer.from('Who signs the contract?'))).toBe(false);
  });

  it('a SAVE READS NOTHING: no history file is opened for reading while it saves', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const first = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const path = store.pathOf(PLACE_KEY);
    const before = statSync(path).size;
    // RECORDED BY THE SPY ON node:fs (not by a file's mode, which root, who runs these, reads past): every path opened or
    // read from here on. The key was unwrapped at the first save and is held, so a second save needs nothing from disk.
    reads.length = 0;
    store.save(PLACE_KEY, PLACE, ID, first, [...TURNS, { role: 'user', text: 'And the date?' }], null, AT);
    expect(reads.filter((each) => each.startsWith(join(directory, 'history')))).toStrictEqual([]);
    expect(statSync(path).size).toBeGreaterThan(before);
    // CONTROL: the spy sees a read, so its silence above means something.
    reads.length = 0;
    store.list(PLACE_KEY, ID);
    expect(reads).toContain(path);
    expect(store.read(PLACE_KEY, first)?.turns).toHaveLength(3);
  });

  it('a regenerated answer replaces the tail: the save writes from where the turns changed, and reads back right', () => {
    const store = createHistoryStore(folder(), fakeCipher());
    const key = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const regenerated: SavedTurn[] = [{ role: 'user', text: 'Who signs the contract?' }, { role: 'assistant', text: 'Only the buyer signs.' }];
    store.save(PLACE_KEY, PLACE, ID, key, regenerated, null, AT);
    expect(store.read(PLACE_KEY, key)?.turns).toStrictEqual(regenerated);
    // CONTROL: an unchanged save writes nothing more.
    const size = statSync(store.pathOf(PLACE_KEY)).size;
    store.save(PLACE_KEY, PLACE, ID, key, regenerated, null, AT);
    expect(statSync(store.pathOf(PLACE_KEY)).size).toBe(size);
  });

  it('an empty new conversation stores nothing', () => {
    const store = createHistoryStore(folder(), fakeCipher());
    expect(store.save(PLACE_KEY, PLACE, ID, null, [], null, AT)).toStrictEqual({ conversation: null });
    expect(existsSync(store.pathOf(PLACE_KEY))).toBe(false);
  });

  it('a SAVE WITH NO TURNS changes nothing on disk: a saved conversation keeps its turns, in this session and the next', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const key = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const path = store.pathOf(PLACE_KEY);
    const size = statSync(path).size;
    expect(store.save(PLACE_KEY, PLACE, ID, key, [], null, AT)).toStrictEqual({ conversation: key });
    // AND IN A LATER SESSION, which holds nothing of what this one saved, so nothing above stops it.
    const later = createHistoryStore(directory, fakeCipher());
    expect(later.save(PLACE_KEY, PLACE, ID, key, [], null, AT)).toStrictEqual({ conversation: key });
    expect(statSync(path).size).toBe(size);
    expect(later.read(PLACE_KEY, key)?.turns).toStrictEqual(TURNS);
    // CONTROL: a save of that key that does hold turns is written, so the size above is the empty save's own.
    later.save(PLACE_KEY, PLACE, ID, key, [...TURNS, { role: 'user', text: 'And the date?' }], null, AT);
    expect(statSync(path).size).toBeGreaterThan(size);
  });

  it('a TORN last record ends the read and loses nothing before it', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const kept = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const path = store.pathOf(PLACE_KEY);
    const whole = statSync(path).size;
    store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Torn' }], null, AT);
    // CONTROL: whole, both are listed.
    expect(createHistoryStore(directory, fakeCipher()).list(PLACE_KEY, ID)).toHaveLength(2);
    truncateSync(path, statSync(path).size - 5);
    const after = createHistoryStore(directory, fakeCipher()).list(PLACE_KEY, ID);
    expect(after.map((card) => card.key)).toStrictEqual([kept]);
    expect(statSync(path).size).toBeGreaterThan(whole);
  });

  it('a TORN record in the MIDDLE is stepped past: the whole ones after it are listed, and survive a Delete', async () => {
    // THREE TEARS an earlier build could leave by appending behind a cut-short save: a head naming more bytes than the
    // file holds; a head naming fewer than it should, so its end falls inside the next record; and part of a head.
    const tears = [
      Buffer.concat([frame(3, randomBytes(32), randomBytes(1_000_000)).subarray(0, 37), randomBytes(50)]),
      Buffer.concat([frame(3, randomBytes(32), randomBytes(60)).subarray(0, 37), randomBytes(40)]),
      frame(3, randomBytes(32), randomBytes(60)).subarray(0, 20),
    ];
    for (const tear of tears) {
      const directory = folder();
      const store = createHistoryStore(directory, fakeCipher());
      const gone = store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Remove me' }], null, AT).conversation ?? '';
      const path = store.pathOf(PLACE_KEY);
      const at = statSync(path).size;
      const after = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
      const bytes = readFileSync(path);
      writeFileSync(path, Buffer.concat([bytes.subarray(0, at), tear, bytes.subarray(at)]));

      const reader = createHistoryStore(directory, fakeCipher());
      expect(reader.list(PLACE_KEY, ID).map((card) => card.key).sort()).toStrictEqual([gone, after].sort());
      expect(reader.read(PLACE_KEY, after)?.turns).toStrictEqual(TURNS);
      expect(await reader.remove(PLACE_KEY, gone)).toBe(true);
      expect(reader.list(PLACE_KEY, ID).map((card) => card.key)).toStrictEqual([after]);
      expect(reader.read(PLACE_KEY, after)?.turns).toStrictEqual(TURNS);
      // ONLY THE TORN BYTES ARE LOST: the rewritten file is whole records end to end, and the tear is not among them.
      const rewritten = readFileSync(path);
      expect(chainsToEnd(rewritten)).toBe(true);
      expect(rewritten.includes(tear)).toBe(false);
    }
  });

  it('a write never lands behind a TORN tail: the torn bytes are cut first, and only they are lost', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const kept = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const path = store.pathOf(PLACE_KEY);
    const whole = readFileSync(path);
    // A SAVE CUT SHORT by a crash or a full disk: a head and part of its payload.
    const torn = Buffer.concat([frame(3, randomBytes(32), randomBytes(500)).subarray(0, 37), randomBytes(80)]);
    appendFileSync(path, torn);
    const later = createHistoryStore(directory, fakeCipher());
    const asked = later.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Asked after the crash' }], null, AT).conversation ?? '';
    const bytes = readFileSync(path);
    expect(bytes.includes(torn)).toBe(false);
    expect(bytes.subarray(0, whole.length).equals(whole)).toBe(true);
    expect(chainsToEnd(bytes)).toBe(true);
    // CONTROL: both conversations are there, so the cut took the torn bytes and nothing whole.
    expect(later.list(PLACE_KEY, ID).map((card) => card.key).sort()).toStrictEqual([kept, asked].sort());
    expect(later.read(PLACE_KEY, kept)?.turns).toStrictEqual(TURNS);
  });

  it('a write that FAILS part way is cut back before the failure is thrown, so this session leaves nothing torn', () => {
    const store = createHistoryStore(folder(), fakeCipher());
    const kept = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const path = store.pathOf(PLACE_KEY);
    const whole = readFileSync(path);
    filling.next = true;
    expect(() => store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Not saved' }], null, AT)).toThrow(/ENOSPC/u);
    // CONTROL: the failure did write part of the record, so it is the cut that took it away.
    expect(filling.wrote).toBeGreaterThan(0);
    expect(readFileSync(path).equals(whole)).toBe(true);
    const next = store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Saved after' }], null, AT).conversation ?? '';
    expect(chainsToEnd(readFileSync(path))).toBe(true);
    expect(store.list(PLACE_KEY, ID).map((card) => card.key).sort()).toStrictEqual([kept, next].sort());
  });

  it('a later session’s first write to a file reads its heads ONCE, and its next write reads nothing', () => {
    const directory = folder();
    const first = createHistoryStore(directory, fakeCipher());
    const key = first.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    const path = first.pathOf(PLACE_KEY);
    const later = createHistoryStore(directory, fakeCipher());
    later.recordGuard(PLACE_KEY, PLACE, STAMP);
    reads.length = 0;
    later.save(PLACE_KEY, PLACE, STAMP, key, [...TURNS, { role: 'user', text: 'And the date?' }], null, AT);
    expect(reads.filter((each) => each === path)).toStrictEqual([]);
    // CONTROL: a store that has not written to the file reads it once at its first write, and that is the read above.
    const third = createHistoryStore(directory, fakeCipher());
    reads.length = 0;
    third.recordGuard(PLACE_KEY, PLACE, ID);
    expect(reads.filter((each) => each === path)).toStrictEqual([path]);
  });

  it('a record sealed under ANOTHER key is never shown or counted', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    // A CARD SEALED UNDER A KEY THIS STORE DOES NOT HOLD, with a well-formed head.
    const stranger = randomBytes(32);
    appendFileSync(store.pathOf(PLACE_KEY), frame(2, stranger, randomBytes(80)));
    const reader = createHistoryStore(directory, fakeCipher());
    expect(reader.list(PLACE_KEY, ID)).toHaveLength(1);
    expect(reader.read(PLACE_KEY, stranger.toString('hex'))).toBeNull();
    expect(reader.clearAll()).toBe(1);
  });

  it('another account cannot read a thing, and nothing is saved over its key', () => {
    const directory = folder();
    createHistoryStore(directory, fakeCipher('me')).save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    const other = createHistoryStore(directory, fakeCipher('someone-else'));
    expect(other.list(PLACE_KEY, ID)).toStrictEqual([]);
    expect(() => other.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT)).toThrow(/not saved/u);
    // CONTROL: the first account still reads it.
    expect(createHistoryStore(directory, fakeCipher('me')).list(PLACE_KEY, ID)).toHaveLength(1);
  });
});

describe('history LOCKED to another account (ADR-0279’s correction of 2026-11-12)', () => {
  it('a save is refused AS LOCKED, the key is kept byte for byte, and Clear chat history starts again', () => {
    const directory = folder();
    createHistoryStore(directory, fakeCipher('me')).save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    const keyPath = join(directory, 'history', 'key');
    const key = readFileSync(keyPath);
    // AFTER A PASSWORD RESET, OR HISTORY RESTORED FROM ANOTHER COMPUTER: the stored key does not unwrap for this account.
    const other = createHistoryStore(directory, fakeCipher('someone-else'));
    expect(other.locked()).toBe(true);
    expect(() => other.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT)).toThrow(HistoryLockedError);
    // NOTHING SAVED IS LOST: the key is never replaced.
    expect(readFileSync(keyPath).equals(key)).toBe(true);
    // CLEAR CHAT HISTORY removes the file and the key, and the next save makes a new key and works.
    other.clearAll();
    expect(existsSync(keyPath)).toBe(false);
    expect(existsSync(other.pathOf(PLACE_KEY))).toBe(false);
    expect(other.locked()).toBe(false);
    const saved = other.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    expect(other.read(PLACE_KEY, saved)?.turns).toStrictEqual(TURNS);
  });

  it('CONTROL: no key yet, and the cipher off, are NOT locked, and their saves are not refused as locked', () => {
    const fresh = createHistoryStore(folder(), fakeCipher());
    expect(fresh.locked()).toBe(false);
    expect(fresh.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation).toMatch(/^[0-9a-f]{64}$/u);
    expect(fresh.locked()).toBe(false);
    // THE CIPHER OFF is the other refusal, said differently: it is not this person's history being locked.
    const directory = folder();
    createHistoryStore(directory, fakeCipher()).save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    const off = createHistoryStore(directory, { ...fakeCipher(), available: () => false });
    expect(off.locked()).toBe(false);
    let thrown: unknown;
    try {
      off.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(HistoryLockedError);
  });
});

describe('a section per document at one place (the owner’s correction of 2026-11-12)', () => {
  it('a DIFFERENT PDF at the place sees nothing of the old one, and the old one coming back sees its own again', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const mine = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation;
    const other: HistoryGuard = { kind: 'id', id: '99887766' };
    store.recordGuard(PLACE_KEY, PLACE, other);
    expect(store.list(PLACE_KEY, other)).toStrictEqual([]);
    const theirs = store.save(PLACE_KEY, PLACE, other, null, [{ role: 'user', text: 'A different document' }], null, AT).conversation;
    expect(store.list(PLACE_KEY, other).map((card) => card.key)).toStrictEqual([theirs]);
    // BACK WITHIN THE 24 HOURS: the first PDF's section is shown again, and only it.
    store.recordGuard(PLACE_KEY, PLACE, ID);
    expect(store.list(PLACE_KEY, ID).map((card) => card.key)).toStrictEqual([mine]);
    expect(store.guards(PLACE_KEY)).toHaveLength(2);
  });

  it('Monstera’s own save RE-LINKS a PDF with no /ID, so its section continues; a stranger’s stamp does not match', () => {
    const store = createHistoryStore(folder(), fakeCipher());
    const key = store.save(PLACE_KEY, PLACE, STAMP, null, TURNS, null, AT).conversation;
    const afterSave: HistoryGuard = { kind: 'stamp', size: 1200, mtimeMs: 1_700_000_100_000 };
    // CONTROL: before the re-link, the new stamp is a stranger.
    expect(store.list(PLACE_KEY, afterSave)).toStrictEqual([]);
    store.relink(PLACE_KEY, PLACE, STAMP, afterSave);
    expect(store.list(PLACE_KEY, afterSave).map((card) => card.key)).toStrictEqual([key]);
    const stranger: HistoryGuard = { kind: 'stamp', size: 1200, mtimeMs: 1_700_000_200_000 };
    expect(store.list(PLACE_KEY, stranger)).toStrictEqual([]);
  });

  it('a conversation MOVED from 1.1.2610.0, with no guard, is adopted by its PDF’s next open', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const moved = 'b'.repeat(64);
    store.writeUnguarded(PLACE_KEY, moved, TURNS, 'contract.pdf', '2026-10-01T09:00:00.000Z');
    // UNTIL THE OPEN, it is in no section the 24-hour check looks at.
    expect(store.guards(PLACE_KEY)).toStrictEqual([]);
    const next = createHistoryStore(directory, fakeCipher());
    next.recordGuard(PLACE_KEY, PLACE, ID);
    expect(next.list(PLACE_KEY, ID).map((card) => card.key)).toStrictEqual([moved]);
    expect(next.guards(PLACE_KEY)).toStrictEqual([{ section: expect.any(String) as string, place: PLACE, guard: ID }]);
    // CONTROL: a PDF opened at the place AFTER the adopting guard does not take it.
    const later: HistoryGuard = { kind: 'id', id: '00112233' };
    next.recordGuard(PLACE_KEY, PLACE, later);
    expect(next.list(PLACE_KEY, later)).toStrictEqual([]);
  });

  it('an open writes a guard only where the PDF has a file: a PDF with no history gets none', () => {
    const store = createHistoryStore(folder(), fakeCipher());
    store.recordGuard(PLACE_KEY, PLACE, ID);
    expect(existsSync(store.pathOf(PLACE_KEY))).toBe(false);
  });
});

describe('Delete really deletes (ADR-0279, the owner’s answers, Decision 7)', () => {
  it('a removed conversation’s records are in no file under the history folder, and the kept one reads as before', async () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const gone = store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Remove me' }], null, AT).conversation ?? '';
    const kept = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    // THE CONTROL BEFORE: both ids are in the clear heads, so the search below can see one.
    expect(everyFileHolds(directory, Buffer.from(gone, 'hex'))).toBe(true);
    expect(await store.remove(PLACE_KEY, gone)).toBe(true);
    expect(everyFileHolds(directory, Buffer.from(gone, 'hex'))).toBe(false);
    expect(everyFileHolds(directory, Buffer.from(kept, 'hex'))).toBe(true);
    expect(store.read(PLACE_KEY, kept)?.turns).toStrictEqual(TURNS);
    expect(store.list(PLACE_KEY, ID).map((card) => card.key)).toStrictEqual([kept]);
    // THE LAST ONE GOING takes the file.
    await store.remove(PLACE_KEY, kept);
    expect(existsSync(store.pathOf(PLACE_KEY))).toBe(false);
  });

  it('the rewrite runs OFF THIS THREAD: this thread reads no history file whole, and a save made meanwhile is kept', async () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const gone = store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Remove me' }], null, AT).conversation ?? '';
    store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    wholeReads.length = 0;
    const removing = store.remove(PLACE_KEY, gone);
    // A SAVE WHILE THE WORKER READS: appended after its read, so it is the tail this thread adds before the rename.
    const during = store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Asked meanwhile' }], null, AT).conversation ?? '';
    expect(await removing).toBe(true);
    expect(wholeReads.filter((path) => path.startsWith(join(directory, 'history')) && !path.endsWith('key'))).toStrictEqual([]);
    // CONTROL: the removal happened, and the save made during it is still there.
    expect(store.list(PLACE_KEY, ID).map((card) => card.key)).not.toContain(gone);
    expect(store.read(PLACE_KEY, during)?.turns).toStrictEqual([{ role: 'user', text: 'Asked meanwhile' }]);
  });

  it('a save the worker READ HALF OF is still there after the rename: main picks up from the last whole record', async () => {
    const directory = folder();
    let during = '';
    const holder: { store?: ReturnType<typeof createHistoryStore> } = {};
    // THE WORKER'S READ MEETS A SAVE PART WAY THROUGH ITS WRITE: the save is appended, and the worker is given the file as
    // it stood with the save's last seven bytes not yet there.
    const racing: HistoryRewriter = (data) => {
      during = holder.store?.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Asked while it read' }], null, AT).conversation ?? '';
      const bytes = readFileSync(data.path);
      const seen = join(directory, 'seen-by-the-worker');
      writeFileSync(seen, bytes.subarray(0, bytes.length - 7));
      return inProcess({ ...data, path: seen });
    };
    const store = storeWith(directory, fakeCipher(), undefined, racing);
    holder.store = store;
    const gone = store.save(PLACE_KEY, PLACE, ID, null, [{ role: 'user', text: 'Remove me' }], null, AT).conversation ?? '';
    const kept = store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT).conversation ?? '';
    expect(await store.remove(PLACE_KEY, gone)).toBe(true);
    // CONTROL: the removal happened, so the rename ran with the worker's read.
    expect(store.list(PLACE_KEY, ID).map((card) => card.key).sort()).toStrictEqual([kept, during].sort());
    expect(store.read(PLACE_KEY, during)?.turns).toStrictEqual([{ role: 'user', text: 'Asked while it read' }]);
    expect(chainsToEnd(readFileSync(store.pathOf(PLACE_KEY)))).toBe(true);
  });

  it('removing a section keeps the other document’s, and the file goes with the last', async () => {
    const store = createHistoryStore(folder(), fakeCipher());
    store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    const other: HistoryGuard = { kind: 'id', id: '99887766' };
    const theirs = store.save(PLACE_KEY, PLACE, other, null, [{ role: 'user', text: 'Kept' }], null, AT).conversation;
    const section = store.guards(PLACE_KEY).find((each) => each.guard.kind === 'id' && each.guard.id === 'f1e2d3c4')?.section ?? '';
    expect(await store.removeSection(PLACE_KEY, section)).toBe(true);
    expect(store.list(PLACE_KEY, ID)).toStrictEqual([]);
    expect(store.list(PLACE_KEY, other).map((card) => card.key)).toStrictEqual([theirs]);
    expect(store.guards(PLACE_KEY)).toHaveLength(1);
  });

  it('Clear all for one file removes that file; Clear chat history removes every file and counts what it held', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const otherPlace = 'c'.repeat(64);
    store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    store.save(otherPlace, 'D:/other.pdf', STAMP, null, TURNS, null, AT);
    store.save(otherPlace, 'D:/other.pdf', STAMP, null, TURNS, null, AT);
    store.clearFile(PLACE_KEY);
    expect(store.files()).toStrictEqual([otherPlace]);
    expect(store.clearAll()).toBe(2);
    expect(store.files()).toStrictEqual([]);
  });
});

describe('the note that chat history is on is claimed once on this computer (ADR-0279 decision h)', () => {
  it('the first claim wins and every later one, from this store or another on the same folder, does not', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    expect(store.claimNote()).toBe(true);
    expect(store.claimNote()).toBe(false);
    // A SECOND STORE, as a second start of the application reads the folder: still claimed.
    expect(createHistoryStore(directory, fakeCipher()).claimNote()).toBe(false);
  });

  it('Clear chat history keeps the claim, and the claim is no conversation: nothing is listed or counted for it', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT);
    expect(store.claimNote()).toBe(true);
    expect(store.files()).toStrictEqual([PLACE_KEY]);
    expect(store.clearAll()).toBe(1);
    expect(store.claimNote()).toBe(false);
  });

  it('CONTROL: a store on another folder has its own claim', () => {
    expect(createHistoryStore(folder(), fakeCipher()).claimNote()).toBe(true);
    expect(createHistoryStore(folder(), fakeCipher()).claimNote()).toBe(true);
  });
});

describe('a write the cipher cannot back', () => {
  it('a save throws and nothing is listed where the account’s store is unavailable', () => {
    const directory = folder();
    const off: SecretCipher = { ...fakeCipher(), available: () => false };
    const store = createHistoryStore(directory, off);
    expect(() => store.save(PLACE_KEY, PLACE, ID, null, TURNS, null, AT)).toThrow(/not saved/u);
    expect(store.list(PLACE_KEY, ID)).toStrictEqual([]);
  });
});

describe('the 24-hour check’s ledger is sealed like every record (ADR-0279 Decision 6)', () => {
  it('keeps what it is given and reads it back, and a place in it is not on the disk in the clear', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    const ledger = { lastPass: 5, sections: { [`${PLACE_KEY}/s`]: { seen: null, missingSince: 7, place: PLACE } } };
    store.keepLedger(ledger);
    expect(createHistoryStore(directory, fakeCipher()).ledger()).toStrictEqual(ledger);
    expect(everyFileHolds(directory, Buffer.from(PLACE))).toBe(false);
  });

  it('CONTROL: another account reads no ledger, and Clear chat history removes it', () => {
    const directory = folder();
    const store = createHistoryStore(directory, fakeCipher());
    store.keepLedger({ lastPass: 5, sections: {} });
    expect(createHistoryStore(directory, fakeCipher('someone else')).ledger()).toBeNull();
    store.clearAll();
    expect(store.ledger()).toBeNull();
  });
});
