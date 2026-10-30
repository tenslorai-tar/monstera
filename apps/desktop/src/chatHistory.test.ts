import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_HISTORY_PREVIEW, type SavedTurn } from '@monstera/contract';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHAT_HISTORY_FILE,
  type ChatHistory,
  MAX_FILE_CONVERSATIONS,
  MAX_SAVED_CONVERSATIONS,
  createChatHistory,
} from './chatHistory.js';
import type { SecretCipher } from './secretStore.js';

/** A cipher that visibly transforms every byte, so a plaintext in the file is caught. */
const REVERSING: SecretCipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0x5a)),
  decrypt: (cipher) => Buffer.from(cipher.map((byte) => byte ^ 0x5a)).toString('utf8'),
};

const TURNS: readonly SavedTurn[] = [
  { role: 'user', text: 'When is the design review?' },
  { role: 'assistant', text: 'It is due 17 March [p. 1].' },
];

/** A moment and a name for every save here, since both are required of one (ADR-0192). */
const AT = new Date('2026-10-07T09:30:00.000Z');
const NAME = 'lease.pdf';

/** Past this, a body made of six small file calls reports where its time went (a fifth of vitest's 5 s). */
const SLOW_BODY_MS = 1000;

let directory = '';
afterEach(() => {
  if (directory !== '') rmSync(directory, { recursive: true, force: true });
  directory = '';
});
function fresh(): string {
  directory = mkdtempSync(join(tmpdir(), 'chat-history-'));
  return directory;
}

/** A NEW conversation for `file`, and the key the store gave it; a refusal or an empty save fails the case. */
function saveNew(history: ChatHistory, file: string, turns: readonly SavedTurn[], name = NAME, at = AT): string {
  const outcome = history.save(file, null, turns, name, at);
  if (!('conversation' in outcome) || outcome.conversation === null) throw new Error('the save stored no conversation');
  return outcome.conversation;
}

/** The turns a reopened file would load: its newest conversation's, or none. */
const newest = (history: ChatHistory, file: string): readonly SavedTurn[] => history.load(file)?.turns ?? [];

describe('chat history (ADR-0093)', () => {
  it('saves a conversation ENCRYPTED and loads it back by its file, with its own key', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const key = saveNew(history, 'k1', TURNS);
    expect(history.load('k1')).toStrictEqual({ conversation: key, turns: TURNS });
    expect(key).toMatch(/^[0-9a-f]{64}$/u);
    // THE FILE HOLDS NO PLAINTEXT: the question's words are not in it, and neither is the file's name.
    const onDisk = readFileSync(join(directory, CHAT_HISTORY_FILE), 'utf8');
    expect(onDisk).not.toContain('design review');
    expect(onDisk).not.toContain('lease.pdf');
  });

  it('saves a 20,000-character answer and reloads it WHOLE (ADR-0277)', () => {
    const long = Array.from({ length: 20_000 }, (_, at) => String.fromCharCode(97 + (at % 26))).join('');
    const turns: readonly SavedTurn[] = [{ role: 'user', text: 'Explain every clause.' }, { role: 'assistant', text: long }];
    const history = createChatHistory(fresh(), REVERSING);
    saveNew(history, 'k1', turns);
    expect(newest(history, 'k1')).toStrictEqual(turns);
    // AND A SECOND STORE OVER THE SAME FILE, as the next start reads it.
    expect(newest(createChatHistory(directory, REVERSING), 'k1')).toStrictEqual(turns);
  });

  it('an EMPTY save removes NOTHING (ADR-0277): a saved conversation keeps its turns, and another file is untouched', () => {
    // TIMED, CALL BY CALL (CCCCCCCC-4, FFFFFFFF-9): this synchronous body twice ran past vitest's 5 s on the Windows
    // runner, which vitest measures as wall clock around the body, and the rename retry bounds only 0.6 s of it. So
    // the next slow run names the call that held it, in the log beside the failure, instead of a raised timeout.
    const spent: string[] = [];
    let total = 0;
    const timed = <T,>(label: string, call: () => T): T => {
      const start = performance.now();
      try {
        return call();
      } finally {
        const took = performance.now() - start;
        total += took;
        spent.push(`${label} ${took.toFixed(0)} ms`);
      }
    };
    const history = timed('create', () => createChatHistory(fresh(), REVERSING));
    const k1 = timed('save k1', () => saveNew(history, 'k1', TURNS));
    timed('save k2 (replaces the file)', () => saveNew(history, 'k2', TURNS));
    const emptied = timed('save k1 empty', () => history.save('k1', k1, [], NAME, AT));
    const empty = timed('save a new empty one', () => history.save('k3', null, [], NAME, AT));
    const first = timed('load k1', () => newest(history, 'k1'));
    const second = timed('load k2', () => newest(history, 'k2'));
    if (total > SLOW_BODY_MS) console.warn(`chatHistory.test.ts: the body took ${total.toFixed(0)} ms: ${spent.join(', ')}`);
    expect(emptied).toStrictEqual({ conversation: k1 });
    expect(first).toStrictEqual(TURNS);
    expect(second).toStrictEqual(TURNS);
    // A NEW EMPTY ONE stores nothing at all.
    expect(empty).toStrictEqual({ conversation: null });
    expect(history.count('k3')).toBe(0);
  });

  it('keeps two hundred files by default, and twenty conversations a file, the contract’s own numbers', () => {
    expect(MAX_SAVED_CONVERSATIONS).toBe(200);
    expect(MAX_FILE_CONVERSATIONS).toBe(20);
  });

  it('drops the LEAST RECENTLY SAVED FILE past the limit, with its conversations, and a re-save counts as recent', () => {
    const limit = 3;
    const history = createChatHistory(fresh(), REVERSING, limit);
    const k0 = saveNew(history, 'k0', TURNS);
    const k1 = saveNew(history, 'k1', TURNS);
    const k1Again = saveNew(history, 'k1', [{ role: 'user', text: 'A second about k1' }]);
    saveNew(history, 'k2', TURNS);
    history.save('k0', k0, TURNS, NAME, AT); // k0 is now the most recent
    saveNew(history, 'extra', TURNS);
    expect(newest(history, 'k0')).toStrictEqual(TURNS);
    // CONTROL: k1 was the oldest after k0's re-save, so it is the one that went, BOTH its conversations.
    expect(history.count('k1')).toBe(0);
    expect(history.read(k1)).toBeNull();
    expect(history.read(k1Again)).toBeNull();
    expect(history.count('k2')).toBe(1);
    expect(newest(history, 'extra')).toStrictEqual(TURNS);
  });

  it('clear removes every conversation of every file and says how many', () => {
    const history = createChatHistory(fresh(), REVERSING);
    saveNew(history, 'a', TURNS);
    saveNew(history, 'a', TURNS);
    saveNew(history, 'b', TURNS);
    expect(history.clear()).toBe(3);
    expect(history.load('a')).toBeNull();
    expect(history.list()).toStrictEqual([]);
  });

  it('REFUSES to save with no cipher rather than writing plaintext, and loads nothing', () => {
    const none: SecretCipher = { ...REVERSING, available: () => false };
    const history = createChatHistory(fresh(), none);
    expect(() => history.save('k', null, TURNS, NAME, AT)).toThrow(/not saved/u);
    expect(history.load('k')).toBeNull();
    // AND LISTS NOTHING: with no cipher there is nothing it could read.
    expect(history.list()).toStrictEqual([]);
    expect(history.read('k')).toBeNull();
  });

  it('a conversation that no longer decrypts is passed over, and the others still read', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const other: readonly SavedTurn[] = [{ role: 'user', text: 'A different question' }];
    saveNew(history, 'good', other);
    saveNew(history, 'bad', TURNS);
    const strict: SecretCipher = {
      ...REVERSING,
      decrypt: (cipher) => {
        const text = REVERSING.decrypt(cipher);
        if (text.includes('design')) return 'not json';
        return text;
      },
    };
    const reread = createChatHistory(directory, strict);
    expect(reread.load('bad')).toBeNull();
    expect(newest(reread, 'good')).toStrictEqual(other);
  });
});

describe('a file keeps several conversations (ADR-0277 Decision 6)', () => {
  it('a NEW conversation is kept BESIDE the old one, which stays whole; naming one replaces only it', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const first = saveNew(history, 'f', TURNS);
    const later: readonly SavedTurn[] = [{ role: 'user', text: 'Who signs?' }];
    const second = saveNew(history, 'f', later);
    expect(second).not.toBe(first);
    expect(history.count('f')).toBe(2);
    expect(history.read(first)?.turns).toStrictEqual(TURNS);
    // THE NEWEST is what a reopened file loads.
    expect(history.load('f')).toStrictEqual({ conversation: second, turns: later });
    // CONTINUING the old one replaces it, keeps the other, and makes it the newest.
    const continued: readonly SavedTurn[] = [...TURNS, { role: 'user', text: 'And the deadline?' }];
    expect(history.save('f', first, continued, NAME, AT)).toStrictEqual({ conversation: first });
    expect(history.count('f')).toBe(2);
    expect(history.load('f')).toStrictEqual({ conversation: first, turns: continued });
    expect(history.read(second)?.turns).toStrictEqual(later);
  });

  it(`at ${String(MAX_FILE_CONVERSATIONS)} a new conversation is REFUSED, and none of the twenty is dropped to make room`, () => {
    const history = createChatHistory(fresh(), REVERSING);
    const keys = Array.from({ length: MAX_FILE_CONVERSATIONS }, (_, at) =>
      saveNew(history, 'f', [{ role: 'user', text: `Question ${String(at)}` }]),
    );
    expect(history.save('f', null, TURNS, NAME, AT)).toStrictEqual({ refused: 'file-full' });
    expect(history.count('f')).toBe(MAX_FILE_CONVERSATIONS);
    expect(keys.map((key) => history.read(key)?.turns[0]?.text)).toStrictEqual(keys.map((_, at) => `Question ${String(at)}`));
    // CONTROL: another file is not full, and one of the twenty can still be continued.
    expect('conversation' in history.save('g', null, TURNS, NAME, AT)).toBe(true);
    expect(history.save('f', keys[3] ?? null, TURNS, NAME, AT)).toStrictEqual({ conversation: keys[3] });
    // AND ONCE ONE IS REMOVED, a new one is taken.
    expect(history.remove(keys[0] ?? '')).toBe(true);
    expect('conversation' in history.save('f', null, TURNS, NAME, AT)).toBe(true);
  });

  it('a key the file no longer holds — removed in the History while open — is saved as a new conversation', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const gone = saveNew(history, 'f', TURNS);
    history.remove(gone);
    const outcome = history.save('f', gone, TURNS, NAME, AT);
    expect('conversation' in outcome && outcome.conversation !== gone && outcome.conversation !== null).toBe(true);
    expect(history.count('f')).toBe(1);
  });
});

describe('history saved by 1.1.2610.0 loads unchanged (ADR-0277 Decision 7)', () => {
  // THE SHAPE 1.1.2610.0 WROTE: `order` and `entries` keyed by the FILE's digest, one ciphertext per file, no `files`.
  // One entry in ADR-0192's shape (with a name and a date) and one from before it (the turns alone).
  const F1 = '1'.repeat(64);
  const F2 = '2'.repeat(64);
  const older: readonly SavedTurn[] = [{ role: 'user', text: 'Who signs the lease?' }, { role: 'assistant', text: 'Both parties.' }];
  const writeOld = (): string => {
    const named = REVERSING.encrypt(JSON.stringify({ v: 2, name: 'lease.pdf', savedAt: AT.toISOString(), turns: TURNS })).toString('base64');
    const bare = REVERSING.encrypt(JSON.stringify(older)).toString('base64');
    const text = JSON.stringify({ order: [F2, F1], entries: { [F1]: named, [F2]: bare } });
    writeFileSync(join(directory, CHAT_HISTORY_FILE), text);
    return text;
  };

  it('each file’s entry is that file’s FIRST conversation, turns byte for byte, and reading rewrites nothing', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const before = writeOld();
    expect(history.load(F1)).toStrictEqual({ conversation: F1, turns: TURNS });
    expect(history.load(F2)).toStrictEqual({ conversation: F2, turns: older });
    expect(history.count(F1)).toBe(1);
    expect(history.list()).toStrictEqual([
      { key: F1, file: F1, name: 'lease.pdf', savedAt: AT.toISOString(), turns: 2, preview: 'When is the design review?' },
      { key: F2, file: F2, name: null, savedAt: null, turns: 2, preview: 'Who signs the lease?' },
    ]);
    expect(history.read(F2)).toStrictEqual({ name: null, savedAt: null, turns: older });
    // NOT A BYTE OF THE FILE CHANGED by any of those reads.
    expect(readFileSync(join(directory, CHAT_HISTORY_FILE), 'utf8')).toBe(before);
  });

  it('a NEW conversation beside it leaves the old entry’s ciphertext exactly as 1.1.2610.0 wrote it', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const before = JSON.parse(writeOld()) as { entries: Record<string, string> };
    const added = saveNew(history, F1, [{ role: 'user', text: 'A new question' }]);
    const after = JSON.parse(readFileSync(join(directory, CHAT_HISTORY_FILE), 'utf8')) as {
      files: Record<string, string[]>;
      entries: Record<string, string>;
    };
    expect(after.entries[F1]).toBe(before.entries[F1]);
    expect(after.entries[F2]).toBe(before.entries[F2]);
    expect(after.files[F1]).toStrictEqual([added, F1]);
    expect(history.read(F1)?.turns).toStrictEqual(TURNS);
    // CONTROL: continuing the old conversation is what rewrites it, in the current shape.
    history.save(F1, F1, [...TURNS, { role: 'user', text: 'More' }], NAME, AT);
    const continued = JSON.parse(readFileSync(join(directory, CHAT_HISTORY_FILE), 'utf8')) as { entries: Record<string, string> };
    expect(continued.entries[F1]).not.toBe(before.entries[F1]);
    expect(history.count(F1)).toBe(2);
  });
});

describe('the History: list, read and remove (ADR-0192)', () => {
  it('lists files NEWEST SAVED FIRST, each file’s conversations together and newest first', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const lease = saveNew(history, 'leaseFile', TURNS, 'lease.pdf', new Date('2026-10-01T08:00:00.000Z'));
    const contract = saveNew(history, 'contractFile', [{ role: 'user', text: 'Who signs?' }], 'contract.pdf', AT);
    expect(history.list()).toStrictEqual([
      { key: contract, file: 'contractFile', name: 'contract.pdf', savedAt: AT.toISOString(), turns: 1, preview: 'Who signs?' },
      {
        key: lease,
        file: 'leaseFile',
        name: 'lease.pdf',
        savedAt: '2026-10-01T08:00:00.000Z',
        turns: 2,
        preview: 'When is the design review?',
      },
    ]);
    // A SECOND CONVERSATION ABOUT THE LEASE moves its file to the front, its two conversations together, newest first.
    const leaseAgain = saveNew(history, 'leaseFile', [{ role: 'user', text: 'Rent?' }], 'lease.pdf', AT);
    expect(history.list().map((entry) => entry.key)).toStrictEqual([leaseAgain, lease, contract]);
  });

  it('the preview is ONE LINE of the first question, bounded, and an assistant-only conversation quotes its first turn', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const long = `Please   summarise\nthe whole of this lease ${'and its schedules '.repeat(30)}`;
    saveNew(history, 'long', [{ role: 'user', text: long }]);
    const [entry] = history.list();
    expect(entry?.preview.length).toBe(MAX_HISTORY_PREVIEW);
    expect(entry?.preview.startsWith('Please summarise the whole of this lease')).toBe(true);
    expect(entry?.preview.endsWith('…')).toBe(true);
    saveNew(history, 'answer-first', [{ role: 'assistant', text: 'A restored answer' }]);
    expect(history.list()[0]?.preview).toBe('A restored answer');
  });

  it('a conversation that will not decrypt is LEFT OUT of the list and does not fail it', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const good = saveNew(history, 'good', [{ role: 'user', text: 'Readable' }]);
    const bad = saveNew(history, 'bad', TURNS);
    const strict: SecretCipher = {
      ...REVERSING,
      decrypt: (cipher) => {
        const text = REVERSING.decrypt(cipher);
        return text.includes('design') ? 'not json' : text;
      },
    };
    const reread = createChatHistory(directory, strict);
    expect(reread.list().map((entry) => entry.key)).toStrictEqual([good]);
    expect(reread.read(bad)).toBeNull();
  });

  it('remove takes one conversation and leaves the others, of its own file too, and says whether it removed anything', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const a = saveNew(history, 'f', TURNS);
    const b = saveNew(history, 'f', TURNS);
    const c = saveNew(history, 'g', TURNS);
    expect(history.remove(a)).toBe(true);
    expect(history.list().map((entry) => entry.key)).toStrictEqual([c, b]);
    // CONTROL: removing it again finds nothing, so the true above was the removal and not a default.
    expect(history.remove(a)).toBe(false);
    expect(history.load('f')).toStrictEqual({ conversation: b, turns: TURNS });
    // A FILE'S LAST CONVERSATION GOING takes the file out of the store.
    history.remove(b);
    expect(history.count('f')).toBe(0);
    expect(history.load('f')).toBeNull();
  });
});
