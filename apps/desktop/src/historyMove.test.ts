import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SavedTurn } from '@monstera/contract';
import { afterEach, describe, expect, it } from 'vitest';

import { CHAT_HISTORY_FILE, MIGRATED_FILE, moveChatHistory, movedKey } from './historyMove.js';
import { type HistoryGuard, createHistoryStore } from './historyStore.js';
import type { SecretCipher } from './secretStore.js';

/** The account's cipher, faked: only its own `decrypt` reads what its `encrypt` wrote. */
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

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const LEGACY = 'c'.repeat(64);
const ID: HistoryGuard = { kind: 'id', id: 'f1e2d3c4' };
const turnsOf = (question: string): SavedTurn[] => [
  { role: 'user', text: question },
  { role: 'assistant', text: `The answer to ${question}` },
];

const made: string[] = [];
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** One entry's blob as 1.1.2610.0 sealed it from ADR-0192 on: the turns with the file's name and the time. */
const sealedEntry = (question: string, name: string, savedAt: string, account = 'me'): string =>
  fakeCipher(account).encrypt(JSON.stringify({ v: 2, name, savedAt, turns: turnsOf(question) })).toString('base64');

/**
 * What 1.1.2610.0 saved, written in its own format (its store is gone, so the bytes are built here as it wrote them:
 * `order` oldest first, `files` each file's keys newest first, `entries` each conversation's ciphertext): two
 * conversations about A, one about B, one entry in the shape before ADR-0277 (a file's one conversation keyed by the file,
 * its blob the bare turns), and a blob ANOTHER account sealed, which cannot be moved.
 */
function oldStore(): { directory: string; keys: { a1: string; a2: string; b1: string } } {
  const directory = mkdtempSync(join(tmpdir(), 'monstera-move-'));
  made.push(directory);
  const keys = { a1: '1'.repeat(64), a2: '2'.repeat(64), b1: '3'.repeat(64) };
  const raw = {
    order: [A, B],
    files: { [A]: [keys.a2, keys.a1], [B]: [keys.b1] },
    entries: {
      [keys.a1]: sealedEntry('first about A', 'a.pdf', '2026-10-01T09:00:00.000Z'),
      [keys.a2]: sealedEntry('second about A', 'a.pdf', '2026-10-02T09:00:00.000Z'),
      [keys.b1]: sealedEntry('about B', 'b.pdf', '2026-10-03T09:00:00.000Z'),
      [LEGACY]: fakeCipher().encrypt(JSON.stringify(turnsOf('the old shape'))).toString('base64'),
      ['d'.repeat(64)]: fakeCipher('someone-else').encrypt(JSON.stringify(turnsOf('not mine'))).toString('base64'),
    },
  };
  writeFileSync(join(directory, CHAT_HISTORY_FILE), JSON.stringify(raw));
  return { directory, keys };
}

describe('the move from 1.1.2610.0 (ADR-0279 Decision 8, the owner’s decision i)', () => {
  it('moves every conversation that reads, losing nothing, and renames the old file only after', () => {
    const { directory, keys } = oldStore();
    const store = createHistoryStore(directory, fakeCipher());
    // FOUR, the other account's blob not counted.
    expect(moveChatHistory(directory, fakeCipher(), store)).toBe(4);
    expect(existsSync(join(directory, CHAT_HISTORY_FILE))).toBe(false);
    expect(existsSync(join(directory, MIGRATED_FILE))).toBe(true);
    // EACH CONVERSATION'S TURNS, whole, in its PDF's file, adopted at that PDF's next open.
    const next = createHistoryStore(directory, fakeCipher());
    next.recordGuard(A, 'C:/a.pdf', ID);
    expect(next.list(A, ID).map((card) => card.key).sort()).toStrictEqual([movedKey(keys.a1), movedKey(keys.a2)].sort());
    expect(next.read(A, movedKey(keys.a2))?.turns).toStrictEqual(turnsOf('second about A'));
    expect(next.read(B, movedKey(keys.b1))?.turns).toStrictEqual(turnsOf('about B'));
    expect(next.read(LEGACY, movedKey(LEGACY))?.turns).toStrictEqual(turnsOf('the old shape'));
    // THE NAME AND THE TIME the old store recorded are kept.
    expect(next.list(A, ID).find((card) => card.key === movedKey(keys.a1))).toMatchObject({ name: 'a.pdf', savedAt: '2026-10-01T09:00:00.000Z' });
  });

  it('a blob that does not decrypt is never counted or shown', () => {
    const { directory } = oldStore();
    const store = createHistoryStore(directory, fakeCipher());
    moveChatHistory(directory, fakeCipher(), store);
    expect([...store.files()].sort()).toStrictEqual([A, B, LEGACY].sort());
    expect(store.clearAll()).toBe(4);
  });

  it('a failure part-way keeps the old file, and the next run moves everything once', () => {
    const { directory, keys } = oldStore();
    const store = createHistoryStore(directory, fakeCipher());
    let calls = 0;
    // THE SECOND FILE'S RENAME INTO PLACE FAILS: one file is in place, the rest are not, the old file untouched.
    expect(() =>
      moveChatHistory(directory, fakeCipher(), store, (from, to) => {
        calls += 1;
        if (calls === 2) throw new Error('the disk refused');
        moveInPlace(from, to);
      }),
    ).toThrow(/refused/u);
    expect(existsSync(join(directory, CHAT_HISTORY_FILE))).toBe(true);
    // THE NEXT RUN, with nothing failing: every conversation once, none added twice to the file already in place.
    expect(moveChatHistory(directory, fakeCipher(), createHistoryStore(directory, fakeCipher()))).toBe(4);
    const after = createHistoryStore(directory, fakeCipher());
    expect([...after.conversationsIn(after.pathOf(A))].sort()).toStrictEqual([movedKey(keys.a1), movedKey(keys.a2)].sort());
    expect(after.conversationsIn(after.pathOf(B))).toStrictEqual([movedKey(keys.b1)]);
    expect(after.clearAll()).toBe(4);
  });

  it('CONTROL: with the old file moved, a second run moves nothing and writes nothing', () => {
    const { directory } = oldStore();
    const store = createHistoryStore(directory, fakeCipher());
    moveChatHistory(directory, fakeCipher(), store);
    const before = readFileSync(store.pathOf(A));
    expect(moveChatHistory(directory, fakeCipher(), store)).toBeNull();
    expect(readFileSync(store.pathOf(A)).equals(before)).toBe(true);
  });

  it('with the account’s store unavailable nothing is moved and the old file stays', () => {
    const { directory } = oldStore();
    const off: SecretCipher = { ...fakeCipher(), available: () => false };
    expect(moveChatHistory(directory, off, createHistoryStore(directory, off))).toBeNull();
    expect(existsSync(join(directory, CHAT_HISTORY_FILE))).toBe(true);
  });
});

/** The real rename, for the case that fails one of them. */
function moveInPlace(from: string, to: string): void {
  writeFileSync(to, readFileSync(from));
  rmSync(from);
}
