import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_HISTORY_PREVIEW, type SavedTurn } from '@monstera/contract';
import { afterEach, describe, expect, it } from 'vitest';

import { CHAT_HISTORY_FILE, MAX_SAVED_CONVERSATIONS, createChatHistory } from './chatHistory.js';
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

let directory = '';
afterEach(() => {
  if (directory !== '') rmSync(directory, { recursive: true, force: true });
  directory = '';
});
function fresh(): string {
  directory = mkdtempSync(join(tmpdir(), 'chat-history-'));
  return directory;
}

describe('chat history (ADR-0093)', () => {
  it('saves a conversation ENCRYPTED and loads it back by its key', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('k1', TURNS, NAME, AT);
    expect(history.load('k1')).toStrictEqual(TURNS);
    // THE FILE HOLDS NO PLAINTEXT: the question's words are not in it, and neither is the file's name.
    const onDisk = readFileSync(join(directory, CHAT_HISTORY_FILE), 'utf8');
    expect(onDisk).not.toContain('design review');
    expect(onDisk).not.toContain('lease.pdf');
  });

  it('an EMPTY list removes the conversation, and another file is untouched', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('k1', TURNS, NAME, AT);
    history.save('k2', TURNS, NAME, AT);
    history.save('k1', [], NAME, AT);
    expect(history.load('k1')).toStrictEqual([]);
    expect(history.load('k2')).toStrictEqual(TURNS);
  });

  it('keeps two hundred by default, the contract’s own number', () => {
    expect(MAX_SAVED_CONVERSATIONS).toBe(200);
  });

  it('drops the LEAST RECENTLY SAVED past the limit, and a re-save counts as recent', () => {
    const limit = 3;
    const history = createChatHistory(fresh(), REVERSING, limit);
    for (let at = 0; at < limit; at += 1) history.save(`k${String(at)}`, TURNS, NAME, AT);
    history.save('k0', TURNS, NAME, AT); // k0 is now the most recent
    history.save('extra', TURNS, NAME, AT);
    expect(history.load('k0')).toStrictEqual(TURNS);
    // CONTROL: k1 was the oldest after k0's re-save, so it is the one that went.
    expect(history.load('k1')).toStrictEqual([]);
    expect(history.load('extra')).toStrictEqual(TURNS);
  });

  it('clear removes every conversation and says how many', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('a', TURNS, NAME, AT);
    history.save('b', TURNS, NAME, AT);
    expect(history.clear()).toBe(2);
    expect(history.load('a')).toStrictEqual([]);
  });

  it('REFUSES to save with no cipher rather than writing plaintext, and loads nothing', () => {
    const none: SecretCipher = { ...REVERSING, available: () => false };
    const history = createChatHistory(fresh(), none);
    expect(() => {
      history.save('k', TURNS, NAME, AT);
    }).toThrow(/not saved/u);
    expect(history.load('k')).toStrictEqual([]);
    // AND LISTS NOTHING: with no cipher there is nothing it could read.
    expect(history.list()).toStrictEqual([]);
    expect(history.read('k')).toBeNull();
  });

  it('a conversation that no longer decrypts reads as empty, and the others still read', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const other: readonly SavedTurn[] = [{ role: 'user', text: 'A different question' }];
    history.save('good', other, NAME, AT);
    history.save('bad', TURNS, NAME, AT);
    const strict: SecretCipher = {
      ...REVERSING,
      decrypt: (cipher) => {
        const text = REVERSING.decrypt(cipher);
        if (text.includes('design')) return 'not json';
        return text;
      },
    };
    const reread = createChatHistory(directory, strict);
    expect(reread.load('bad')).toStrictEqual([]);
    expect(reread.load('good')).toStrictEqual(other);
  });
});

describe('the History: list, read and remove (ADR-0192)', () => {
  it('lists NEWEST SAVED FIRST, each with its file’s name, when it was saved, its turn count and its first question', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('older', TURNS, 'lease.pdf', new Date('2026-10-01T08:00:00.000Z'));
    history.save('newer', [{ role: 'user', text: 'Who signs?' }], 'contract.pdf', AT);
    expect(history.list()).toStrictEqual([
      { key: 'newer', name: 'contract.pdf', savedAt: AT.toISOString(), turns: 1, preview: 'Who signs?' },
      { key: 'older', name: 'lease.pdf', savedAt: '2026-10-01T08:00:00.000Z', turns: 2, preview: 'When is the design review?' },
    ]);
    // A RE-SAVE MOVES IT TO THE FRONT: the order is the order of saving, not of first appearing.
    history.save('older', TURNS, 'lease.pdf', new Date('2026-10-08T08:00:00.000Z'));
    expect(history.list().map((entry) => entry.key)).toStrictEqual(['older', 'newer']);
  });

  it('reads an entry saved BEFORE entries recorded a name: no name and no date, and its turns whole', () => {
    // THE OLD SHAPE, written as an earlier build wrote it: the turns alone, enciphered, under their key.
    const history = createChatHistory(fresh(), REVERSING);
    const legacy = REVERSING.encrypt(JSON.stringify(TURNS)).toString('base64');
    writeFileSync(join(directory, CHAT_HISTORY_FILE), JSON.stringify({ order: ['old'], entries: { old: legacy } }));
    expect(history.read('old')).toStrictEqual({ name: null, savedAt: null, turns: TURNS });
    expect(history.list()).toStrictEqual([
      { key: 'old', name: null, savedAt: null, turns: 2, preview: 'When is the design review?' },
    ]);
    // CONTROL: and an entry saved now reads with both, so the nulls above are the old shape's and not the reader's.
    history.save('now', TURNS, NAME, AT);
    expect(history.read('now')).toStrictEqual({ name: NAME, savedAt: AT.toISOString(), turns: TURNS });
  });

  it('the preview is ONE LINE of the first question, bounded, and an assistant-only conversation quotes its first turn', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const long = `Please   summarise\nthe whole of this lease ${'and its schedules '.repeat(30)}`;
    history.save('long', [{ role: 'user', text: long }], NAME, AT);
    const [entry] = history.list();
    expect(entry?.preview.length).toBe(MAX_HISTORY_PREVIEW);
    expect(entry?.preview.startsWith('Please summarise the whole of this lease')).toBe(true);
    expect(entry?.preview.endsWith('…')).toBe(true);
    history.save('answer-first', [{ role: 'assistant', text: 'A restored answer' }], NAME, AT);
    expect(history.list()[0]?.preview).toBe('A restored answer');
  });

  it('a conversation that will not decrypt is LEFT OUT of the list and does not fail it', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('good', [{ role: 'user', text: 'Readable' }], NAME, AT);
    history.save('bad', TURNS, NAME, AT);
    const strict: SecretCipher = {
      ...REVERSING,
      decrypt: (cipher) => {
        const text = REVERSING.decrypt(cipher);
        return text.includes('design') ? 'not json' : text;
      },
    };
    const reread = createChatHistory(directory, strict);
    expect(reread.list().map((entry) => entry.key)).toStrictEqual(['good']);
    expect(reread.read('bad')).toBeNull();
  });

  it('remove takes one conversation and leaves the others, and says whether it removed anything', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('a', TURNS, NAME, AT);
    history.save('b', TURNS, NAME, AT);
    expect(history.remove('a')).toBe(true);
    expect(history.list().map((entry) => entry.key)).toStrictEqual(['b']);
    // CONTROL: removing it again finds nothing, so the true above was the removal and not a default.
    expect(history.remove('a')).toBe(false);
    expect(history.load('b')).toStrictEqual(TURNS);
  });
});
