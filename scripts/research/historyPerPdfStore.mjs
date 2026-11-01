// @ts-check
/**
 * A PROTOTYPE of ADR-0279's per-PDF history file, for measurement only: never imported by shipped code.
 *
 * One file per PDF, `<placeKey>.mhist`, named by the digest of the PDF's place (as today's store keys a file). Inside, a
 * sequence of records, each `[type 1 byte][conversation id 32 bytes][length 4 bytes LE][sealed payload]`, the payload
 * sealed with AES-256-GCM under one data key (12-byte iv, 16-byte tag). The type and the conversation id are in the clear
 * so a reader can step over records it does not need without decrypting them; they say nothing about what was asked
 * (the id is random). Types:
 *
 * - GUARD (1): the PDF's place and how it is recognised (its /ID's first string, or its size and write time where it has
 *   none). The newest guard record is the one in force; a Monstera save appends one.
 * - CARD (2): what History lists for a conversation: name, time, message count, first question. The newest wins.
 * - TURNS (3): a conversation's turns from index `from` onward, replacing any after `from`. A save appends only the turns
 *   added since the conversation's last save in this session, so a save does not grow with what the file already holds.
 *
 * A torn last record (a crash mid-append) fails its length or its tag and ends the read there; nothing before it is lost.
 * Removing a conversation REWRITES the file without its records, beside and renamed over, so its words leave the disk
 * when the person confirms (the reviewer's fix 8), and a file left with no conversation is deleted.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const GUARD = 1;
export const CARD = 2;
export const TURNS = 3;
const HEAD = 1 + 32 + 4;
const NO_CONVERSATION = Buffer.alloc(32);

/**
 * @typedef {{ role: 'user' | 'assistant', text: string }} Turn
 * @typedef {{ path: string, id: string | null, size: number, mtimeMs: number }} Guard
 * @typedef {{ key: string, name: string, savedAt: string, turns: number, preview: string }} Card
 */

/** @param {Buffer} dataKey @param {string} text */
export function seal(dataKey, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** @param {Buffer} dataKey @param {Buffer} sealed */
export function unseal(dataKey, sealed) {
  const decipher = createDecipheriv('aes-256-gcm', dataKey, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8');
}

/** @param {number} type @param {Buffer} conversation @param {Buffer} sealed */
function record(type, conversation, sealed) {
  const head = Buffer.alloc(HEAD);
  head.writeUInt8(type, 0);
  conversation.copy(head, 1);
  head.writeUInt32LE(sealed.length, 33);
  return Buffer.concat([head, sealed]);
}

/**
 * A file opened ONCE for one operation: every record's head, with where its payload lies, read by seeking (no payload is
 * read until asked), and a reader for a payload. Opening a file is the cost that matters here (about 1.7 ms each on the
 * development machine, 2026-10-31), so an operation never opens its file twice.
 * @template T
 * @param {string} path
 * @param {(heads: { type: number, conversation: string, at: number, length: number }[], payload: (at: number, length: number) => Buffer) => T} use
 * @returns {T}
 */
function withRecords(path, use) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const head = Buffer.alloc(HEAD);
    /** @type {{ type: number, conversation: string, at: number, length: number }[]} */
    const found = [];
    for (let at = 0; at + HEAD <= size; ) {
      readSync(fd, head, 0, HEAD, at);
      const length = head.readUInt32LE(33);
      // A TORN TAIL: a record whose payload runs past the file ends the read; nothing before it is lost.
      if (at + HEAD + length > size) break;
      found.push({ type: head.readUInt8(0), conversation: head.subarray(1, 33).toString('hex'), at: at + HEAD, length });
      at += HEAD + length;
    }
    return use(found, (at, length) => {
      const bytes = Buffer.alloc(length);
      readSync(fd, bytes, 0, length, at);
      return bytes;
    });
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {string} directory the history folder
 * @param {Buffer} dataKey the one key, protected once by the Windows account's cipher
 * @param {(from: string, to: string) => void} replace the application's own replace-with-retry (`settingsFile.ts`)
 */
export function createPerPdfHistory(directory, dataKey, replace) {
  mkdirSync(directory, { recursive: true });
  /** How many turns of each conversation this session already appended. */
  const saved = new Map();
  /** @param {string} placeKey */
  const fileOf = (placeKey) => join(directory, `${placeKey}.mhist`);
  /** @param {string} placeKey @param {Buffer} bytes */
  const append = (placeKey, bytes) => appendFileSync(fileOf(placeKey), bytes);

  /** @param {string} placeKey @param {(entry: { type: number, conversation: string }) => boolean} keep */
  const rewrite = (placeKey, keep) => {
    const path = fileOf(placeKey);
    /** @type {Buffer[]} */
    const kept = withRecords(path, (found, payload) =>
      found.filter(keep).map((entry) => record(entry.type, Buffer.from(entry.conversation, 'hex'), payload(entry.at, entry.length))),
    );
    if (!kept.some((each) => each.readUInt8(0) === CARD)) {
      unlinkSync(path);
      return;
    }
    writeFileSync(`${path}.writing`, Buffer.concat(kept));
    replace(`${path}.writing`, path);
  };

  return {
    /** @param {string} placeKey */
    path: (placeKey) => fileOf(placeKey),
    /** A guard record, appended: the newest is in force. @param {string} placeKey @param {Guard} guard */
    guard(placeKey, guard) {
      append(placeKey, record(GUARD, NO_CONVERSATION, seal(dataKey, JSON.stringify(guard))));
    },
    /**
     * One save: the turns added since this conversation's last save in this session, and its card. Nothing is read.
     * @param {string} placeKey @param {string} conversation @param {readonly Turn[]} turns @param {string} name
     */
    save(placeKey, conversation, turns, name) {
      const from = saved.get(conversation) ?? 0;
      const id = Buffer.from(conversation, 'hex');
      const card = { key: conversation, name, savedAt: new Date().toISOString(), turns: turns.length, preview: (turns[0]?.text ?? '').slice(0, 160) };
      append(
        placeKey,
        Buffer.concat([
          record(TURNS, id, seal(dataKey, JSON.stringify({ from, turns: turns.slice(from) }))),
          record(CARD, id, seal(dataKey, JSON.stringify(card))),
        ]),
      );
      saved.set(conversation, turns.length);
    },
    /** History for one PDF: its conversations' newest cards, newest first. Turns are stepped over. @param {string} placeKey */
    list(placeKey) {
      const path = fileOf(placeKey);
      if (!existsSync(path)) return [];
      /** @type {Map<string, Card>} */
      const cards = new Map();
      withRecords(path, (found, payload) => {
        for (const entry of found) {
          if (entry.type !== CARD) continue;
          try {
            cards.set(entry.conversation, JSON.parse(unseal(dataKey, payload(entry.at, entry.length))));
          } catch {
            // A CARD THAT DOES NOT OPEN is never shown or counted.
          }
        }
      });
      return [...cards.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    /** One conversation's turns, folded from its records. @param {string} placeKey @param {string} conversation */
    read(placeKey, conversation) {
      /** @type {Turn[]} */
      let turns = [];
      withRecords(fileOf(placeKey), (found, payload) => {
        for (const entry of found) {
          if (entry.type !== TURNS || entry.conversation !== conversation) continue;
          const part = JSON.parse(unseal(dataKey, payload(entry.at, entry.length)));
          turns = [...turns.slice(0, part.from), ...part.turns];
        }
      });
      return turns;
    },
    /** The guard in force, or null. @param {string} placeKey @returns {Guard | null} */
    guardOf(placeKey) {
      /** @type {Guard | null} */
      let guard = null;
      withRecords(fileOf(placeKey), (found, payload) => {
        for (const entry of found) {
          if (entry.type === GUARD) guard = JSON.parse(unseal(dataKey, payload(entry.at, entry.length)));
        }
      });
      return guard;
    },
    /** Delete one conversation: the file rewritten without its records. @param {string} placeKey @param {string} conversation */
    remove(placeKey, conversation) {
      rewrite(placeKey, (entry) => entry.conversation !== conversation);
      saved.delete(conversation);
    },
    /** History's Clear all: this PDF's file. @param {string} placeKey */
    clear(placeKey) {
      rmSync(fileOf(placeKey), { force: true });
    },
    /** Settings' Clear all: every file. */
    clearAll() {
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
    },
  };
}

/** Whether `bytes` occurs anywhere in a file. @param {string} path @param {Buffer} bytes */
export function fileHolds(path, bytes) {
  return readFileSync(path).includes(bytes);
}
