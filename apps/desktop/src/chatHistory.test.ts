import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SavedTurn } from '@monstera/contract';
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
    history.save('k1', TURNS);
    expect(history.load('k1')).toStrictEqual(TURNS);
    // THE FILE HOLDS NO PLAINTEXT: the question's words are not in it.
    expect(readFileSync(join(directory, CHAT_HISTORY_FILE), 'utf8')).not.toContain('design review');
  });

  it('an EMPTY list removes the conversation, and another file is untouched', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('k1', TURNS);
    history.save('k2', TURNS);
    history.save('k1', []);
    expect(history.load('k1')).toStrictEqual([]);
    expect(history.load('k2')).toStrictEqual(TURNS);
  });

  it('keeps two hundred by default', () => {
    expect(MAX_SAVED_CONVERSATIONS).toBe(200);
  });

  it('drops the LEAST RECENTLY SAVED past the limit, and a re-save counts as recent', () => {
    const limit = 3;
    const history = createChatHistory(fresh(), REVERSING, limit);
    for (let at = 0; at < limit; at += 1) history.save(`k${String(at)}`, TURNS);
    history.save('k0', TURNS); // k0 is now the most recent
    history.save('extra', TURNS);
    expect(history.load('k0')).toStrictEqual(TURNS);
    // CONTROL: k1 was the oldest after k0's re-save, so it is the one that went.
    expect(history.load('k1')).toStrictEqual([]);
    expect(history.load('extra')).toStrictEqual(TURNS);
  });

  it('clear removes every conversation and says how many', () => {
    const history = createChatHistory(fresh(), REVERSING);
    history.save('a', TURNS);
    history.save('b', TURNS);
    expect(history.clear()).toBe(2);
    expect(history.load('a')).toStrictEqual([]);
  });

  it('REFUSES to save with no cipher rather than writing plaintext, and loads nothing', () => {
    const none: SecretCipher = { ...REVERSING, available: () => false };
    const history = createChatHistory(fresh(), none);
    expect(() => {
      history.save('k', TURNS);
    }).toThrow(/not saved/u);
    expect(history.load('k')).toStrictEqual([]);
  });

  it('a conversation that no longer decrypts reads as empty, and the others still read', () => {
    const history = createChatHistory(fresh(), REVERSING);
    const other: readonly SavedTurn[] = [{ role: 'user', text: 'A different question' }];
    history.save('good', other);
    history.save('bad', TURNS);
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
