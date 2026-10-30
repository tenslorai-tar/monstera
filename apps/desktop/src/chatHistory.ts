import { randomBytes } from 'node:crypto';

import {
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_FILE_CONVERSATIONS,
  MAX_HISTORY_PREVIEW,
  MAX_SAVED_CONVERSATIONS,
  type SavedConversation,
  type SavedTurn,
  savedTurnsSchema,
} from '@monstera/contract';
import { z } from 'zod';

import type { SecretCipher } from './secretStore.js';
import { createJsonFile } from './settingsFile.js';

/**
 * Saved assistant conversations
 * ([ADR-0093](../../../docs/DECISIONS/0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md),
 * [ADR-0277](../../../docs/DECISIONS/0277-the-assistants-limits-are-said-and-an-answer-is-never-cut-in-silence.md)
 * Decisions 6 and 7).
 *
 * ## One file, one ciphertext PER CONVERSATION
 *
 * Each conversation is encrypted on its own, so a save rewrites one entry's ciphertext rather than every conversation,
 * and a blob that will not decrypt — another account's, or one a keyring reset orphaned — loses that conversation and no
 * other.
 *
 * ## A file keeps several conversations, and a conversation has its own key
 *
 * A file is keyed by `DocumentService.historyKeyOf` — a SHA-256 of its path — so this file holds no path in the clear,
 * and the renderer, which names documents by `DocId`, never learns one. Its conversations are listed under that key in
 * `files`, most recently saved first, each by a random key of the same length; `entries` holds each one's ciphertext.
 * A new conversation keeps the old one (ADR-0277 Decision 6), up to {@link MAX_FILE_CONVERSATIONS}, and a new one past
 * that is REFUSED rather than made room for: dropping a person's conversation is theirs to choose, in the History.
 *
 * ## The shape 1.1.2610.0 wrote loads unchanged (ADR-0277 Decision 7)
 *
 * Before this, `entries` was keyed by the FILE's key, one conversation each, and there was no `files`. Such a store is
 * read as each file holding one conversation whose key is the file's own, and its ciphertexts are read where they are:
 * nothing is rewritten by reading, and the next save writes `files` beside them, leaving each old blob byte for byte.
 *
 * ## Least recently saved FILE goes first
 *
 * `order` lists file keys oldest-saved first; a save moves its file to the end, and past
 * {@link MAX_SAVED_CONVERSATIONS} files the front file is dropped with its conversations — the bound ADR-0093 kept, which
 * the History states where it lists them. A count rather than a size, because each conversation is bounded by the
 * contract: `MAX_CHAT_TURNS` turns of `MAX_ANSWER_TEXT`.
 */

export const CHAT_HISTORY_FILE = 'chat-history.json';
export { MAX_FILE_CONVERSATIONS, MAX_SAVED_CONVERSATIONS };

/** A saved conversation as the store reads it back: its turns, and the name and time its entry recorded, if it did. */
export interface SavedConversationRead {
  readonly name: string | null;
  /** An ISO 8601 instant, or `null` for an entry saved before entries recorded one. */
  readonly savedAt: string | null;
  readonly turns: readonly SavedTurn[];
}

/** What a save did: the conversation's key, `null` where an empty new conversation stored nothing, or why it was refused. */
export type SaveOutcome = { readonly conversation: string | null } | { readonly refused: 'file-full' };

export interface ChatHistory {
  /** Whether conversations can be kept on this machine at all — the keys' own cipher. */
  available(): boolean;
  /** A file's most recently saved conversation and its key, or `null` with none that reads. */
  load(file: string): { readonly conversation: string; readonly turns: readonly SavedTurn[] } | null;
  /** How many conversations a file keeps. */
  count(file: string): number;
  /**
   * Saves a file's conversation, with the file's name and when it was saved. `conversation` names the one it continues,
   * which is replaced; `null` (or a key the file no longer holds) adds a new one, refused at {@link MAX_FILE_CONVERSATIONS}.
   * Nothing is removed by a save. Throws with no cipher. The name and time are REQUIRED: an entry without them is a shape
   * this no longer writes.
   */
  save(file: string, conversation: string | null, turns: readonly SavedTurn[], name: string | null, savedAt: Date): SaveOutcome;
  /**
   * Every conversation that still reads (ADR-0192, ADR-0277): files newest saved first, each file's conversations
   * newest saved first beside one another, as the History lists them — no turns, only how many and the first question.
   * A blob that will not decrypt is left out.
   */
  list(): readonly SavedConversation[];
  /** One conversation by its key, or `null` where nothing readable is saved under it. */
  read(conversation: string): SavedConversationRead | null;
  /** Removes one conversation, and says whether there was one. */
  remove(conversation: string): boolean;
  /** Removes every saved conversation, and says how many there were. */
  clear(): number;
}

/**
 * A machine that keeps no conversations: nothing loads, nothing is counted, and a save throws rather
 * than pretending. The graph's answer when composed with no store, and every unrelated test's.
 */
export function noChatHistory(): ChatHistory {
  return {
    available: () => false,
    load: () => null,
    count: () => 0,
    save: () => {
      throw new Error('no chat history store was composed, so nothing was saved');
    },
    list: () => [],
    read: () => null,
    remove: () => false,
    clear: () => 0,
  };
}

/**
 * What an entry holds inside its ciphertext since ADR-0192: the turns, with the file's name and when they were saved.
 * An entry from before it is a bare array of turns, read as a conversation with neither.
 */
const entrySchema = z
  .object({
    v: z.literal(2),
    name: z.string().max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
    savedAt: z.string().max(40).nullable(),
    turns: savedTurnsSchema,
  })
  .strict();

/** The first question a conversation holds, collapsed to one line and bounded — what the History quotes beside it. */
function previewOf(turns: readonly SavedTurn[]): string {
  const first = turns.find((turn) => turn.role === 'user') ?? turns[0];
  const line = (first?.text ?? '').replace(/\s+/gu, ' ').trim();
  return line.length <= MAX_HISTORY_PREVIEW ? line : `${line.slice(0, MAX_HISTORY_PREVIEW - 1)}…`;
}

interface Stored {
  /** File keys, oldest saved first. */
  readonly order: readonly string[];
  /** Each file's conversation keys, most recently saved first. */
  readonly files: Readonly<Record<string, readonly string[]>>;
  /** Each conversation's ciphertext, by its key. */
  readonly entries: Readonly<Record<string, string>>;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];

function parse(raw: Readonly<Record<string, unknown>>): Stored {
  const entries: Record<string, string> = {};
  const rawEntries = raw['entries'];
  if (typeof rawEntries === 'object' && rawEntries !== null && !Array.isArray(rawEntries)) {
    for (const [key, value] of Object.entries(rawEntries)) {
      if (typeof value === 'string') entries[key] = value;
    }
  }
  const rawFiles = raw['files'];
  const files: Record<string, string[]> = {};
  if (typeof rawFiles === 'object' && rawFiles !== null && !Array.isArray(rawFiles)) {
    for (const [file, value] of Object.entries(rawFiles)) {
      // A KEY NAMING NO ENTRY, or named twice, is dropped from the list rather than trusted.
      const listed = [...new Set(strings(value))].filter((key) => key in entries);
      if (listed.length > 0) files[file] = listed;
    }
  }
  // AN ENTRY NO FILE LISTS is its own file's one conversation, keyed by the file: that is every entry of the shape
  // 1.1.2610.0 wrote, which had no `files` (ADR-0277 Decision 7), and any entry a list lost is kept the same way.
  const listedKeys = new Set(Object.values(files).flat());
  for (const key of Object.keys(entries)) {
    if (!listedKeys.has(key)) files[key] = [...(files[key] ?? []), key];
  }
  // AN ORDER NAMING A MISSING FILE, or a file the order forgot, is repaired rather than trusted: the order is only ever
  // the files' keys, oldest first.
  const order = strings(raw['order']);
  const known = [...new Set(order)].filter((file) => file in files);
  const missing = Object.keys(files).filter((file) => !known.includes(file));
  return { order: [...missing, ...known], files, entries };
}

/**
 * @param limit how many files' conversations are kept; the application passes nothing and gets
 *   {@link MAX_SAVED_CONVERSATIONS}. A case passes a small one, because proving the eviction order
 *   does not need two hundred file rewrites.
 * @param mint a new conversation's key: sixty-four hex characters from the system's random source, like a file's digest
 *   in length so one schema bounds both. A case passes its own, to name what it saved.
 */
export function createChatHistory(
  directory: string,
  cipher: SecretCipher,
  limit: number = MAX_SAVED_CONVERSATIONS,
  mint: () => string = () => randomBytes(32).toString('hex'),
): ChatHistory {
  const file = createJsonFile(directory, CHAT_HISTORY_FILE);
  const read = (): Stored => parse(file.read());
  const write = (stored: Stored): void => {
    file.write({ order: stored.order, files: stored.files, entries: stored.entries });
  };

  /** One entry's blob, decrypted and read in either shape, or `null` where it no longer reads (`secretStore`'s rule). */
  const open = (blob: string): SavedConversationRead | null => {
    try {
      const decoded: unknown = JSON.parse(cipher.decrypt(Buffer.from(blob, 'base64')));
      const entry = entrySchema.safeParse(decoded);
      if (entry.success) return { name: entry.data.name, savedAt: entry.data.savedAt, turns: entry.data.turns };
      // THE SHAPE BEFORE ADR-0192: the turns alone, with no name and no date to say.
      const legacy = savedTurnsSchema.safeParse(decoded);
      return legacy.success ? { name: null, savedAt: null, turns: legacy.data } : null;
    } catch {
      return null;
    }
  };

  /** `stored` without one conversation, and without its file where that was the file's last. */
  const without = (stored: Stored, conversation: string): Stored => {
    const entries = { ...stored.entries };
    Reflect.deleteProperty(entries, conversation);
    const files: Record<string, readonly string[]> = {};
    for (const [owner, keys] of Object.entries(stored.files)) {
      const kept = keys.filter((key) => key !== conversation);
      if (kept.length > 0) files[owner] = kept;
    }
    return { order: stored.order.filter((owner) => owner in files), files, entries };
  };

  return {
    available: () => cipher.available(),

    load(owner) {
      if (!cipher.available()) return null;
      const stored = read();
      // THE NEWEST THAT READS: a conversation that no longer decrypts is passed over for `secretStore`'s reason, as
      // there is nothing a person can do about another machine's ciphertext except carry on with the next.
      for (const key of stored.files[owner] ?? []) {
        const blob = stored.entries[key];
        const conversation = blob === undefined ? null : open(blob);
        if (conversation !== null) return { conversation: key, turns: conversation.turns };
      }
      return null;
    },

    count: (owner) => (read().files[owner] ?? []).length,

    list() {
      if (!cipher.available()) return [];
      const stored = read();
      // NEWEST SAVED FIRST: `order` is oldest first, so it is walked from its end; a file's own list is newest first.
      const listed: SavedConversation[] = [];
      for (const owner of [...stored.order].reverse()) {
        for (const key of stored.files[owner] ?? []) {
          const blob = stored.entries[key];
          const conversation = blob === undefined ? null : open(blob);
          if (conversation === null) continue;
          listed.push({
            key,
            file: owner,
            name: conversation.name,
            savedAt: conversation.savedAt,
            turns: conversation.turns.length,
            preview: previewOf(conversation.turns),
          });
        }
      }
      return listed;
    },

    read(key) {
      if (!cipher.available()) return null;
      const blob = read().entries[key];
      return blob === undefined ? null : open(blob);
    },

    remove(key) {
      const stored = read();
      if (!(key in stored.entries)) return false;
      write(without(stored, key));
      return true;
    },

    save(owner, conversation, turns, name, savedAt) {
      if (!cipher.available()) {
        throw new Error('this machine has no usable credential store, so the conversation was not saved');
      }
      const stored = read();
      const held = stored.files[owner] ?? [];
      const continuing = conversation !== null && held.includes(conversation) ? conversation : null;
      // AN EMPTY CONVERSATION REMOVES NOTHING (ADR-0277 Decision 6): a new one stores nothing, and one already saved keeps
      // what it held, since removing a conversation is the History's and never a side effect of an emptied panel.
      if (turns.length === 0) return { conversation: continuing };
      if (continuing === null && held.length >= MAX_FILE_CONVERSATIONS) return { refused: 'file-full' };
      const key = continuing ?? mint();
      const entries = {
        ...stored.entries,
        [key]: cipher.encrypt(JSON.stringify({ v: 2, name, savedAt: savedAt.toISOString(), turns })).toString('base64'),
      };
      let next: Stored = {
        order: [...stored.order.filter((each) => each !== owner), owner],
        files: { ...stored.files, [owner]: [key, ...held.filter((each) => each !== key)] },
        entries,
      };
      // PAST THE FILE BOUND, the least recently saved file goes, with its conversations (ADR-0093 Decision 5).
      while (next.order.length > limit) {
        const oldest = next.order[0];
        if (oldest === undefined) break;
        next = (next.files[oldest] ?? []).reduce(without, { ...next, order: next.order.slice(1) });
      }
      write(next);
      return { conversation: key };
    },

    clear() {
      const count = Object.keys(read().entries).length;
      write({ order: [], files: {}, entries: {} });
      return count;
    },
  };
}
