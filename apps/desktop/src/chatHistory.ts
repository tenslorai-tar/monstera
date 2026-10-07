import {
  MAX_DOCUMENT_NAME_LENGTH,
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
 * ([ADR-0093](../../../docs/DECISIONS/0093-chat-history-is-off-by-default-encrypted-in-main-and-keyed-by-the-file.md)).
 *
 * ## One file, one ciphertext PER CONVERSATION
 *
 * Each file's conversation is encrypted on its own, so a save rewrites one entry's ciphertext
 * rather than every conversation, and a blob that will not decrypt — another account's, or one a
 * keyring reset orphaned — loses that conversation and no other.
 *
 * ## Keyed by a digest the kernel computes
 *
 * The key is `DocumentService.historyKeyOf` — a SHA-256 of the file's path — so this file holds no
 * path in the clear, and the renderer, which names documents by `DocId`, never learns one.
 *
 * ## Least recently saved goes first
 *
 * `order` lists keys oldest-saved first; a save moves its key to the end, and past
 * {@link MAX_SAVED_CONVERSATIONS} the front is dropped. A count rather than a size, because each
 * conversation is already bounded by the contract's turn limits.
 */

export const CHAT_HISTORY_FILE = 'chat-history.json';
export { MAX_SAVED_CONVERSATIONS };

/** A saved conversation as the store reads it back: its turns, and the name and time its entry recorded, if it did. */
export interface SavedConversationRead {
  readonly name: string | null;
  /** An ISO 8601 instant, or `null` for an entry saved before entries recorded one. */
  readonly savedAt: string | null;
  readonly turns: readonly SavedTurn[];
}

export interface ChatHistory {
  /** Whether conversations can be kept on this machine at all — the keys' own cipher. */
  available(): boolean;
  /** The saved turns for a file, or none. */
  load(key: string): readonly SavedTurn[];
  /**
   * Replaces a file's saved turns, with the file's name and when they were saved; an empty list removes it. Throws with no
   * cipher. The name and time are REQUIRED: an entry without them is the one shape this no longer writes.
   */
  save(key: string, turns: readonly SavedTurn[], name: string | null, savedAt: Date): void;
  /**
   * Every conversation that still reads, NEWEST SAVED FIRST (ADR-0192), as the History lists it: no turns, only how many
   * and the first question. A blob that will not decrypt is left out.
   */
  list(): readonly SavedConversation[];
  /** One conversation by its key, or `null` where nothing readable is saved under it. */
  read(key: string): SavedConversationRead | null;
  /** Removes one conversation, and says whether there was one. */
  remove(key: string): boolean;
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
    load: () => [],
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
  readonly order: readonly string[];
  readonly entries: Readonly<Record<string, string>>;
}

function parse(raw: Readonly<Record<string, unknown>>): Stored {
  const order = Array.isArray(raw['order']) ? raw['order'].filter((key): key is string => typeof key === 'string') : [];
  const entries: Record<string, string> = {};
  const rawEntries = raw['entries'];
  if (typeof rawEntries === 'object' && rawEntries !== null && !Array.isArray(rawEntries)) {
    for (const [key, value] of Object.entries(rawEntries)) {
      if (typeof value === 'string') entries[key] = value;
    }
  }
  // AN ORDER NAMING A MISSING ENTRY, or an entry the order forgot, is repaired rather than trusted:
  // the order is only ever the entries' keys, oldest first.
  const known = order.filter((key) => key in entries);
  const missing = Object.keys(entries).filter((key) => !known.includes(key));
  return { order: [...missing, ...known], entries };
}

/**
 * @param limit how many files' conversations are kept; the application passes nothing and gets
 *   {@link MAX_SAVED_CONVERSATIONS}. A case passes a small one, because proving the eviction order
 *   does not need two hundred file rewrites.
 */
export function createChatHistory(
  directory: string,
  cipher: SecretCipher,
  limit: number = MAX_SAVED_CONVERSATIONS,
): ChatHistory {
  const file = createJsonFile(directory, CHAT_HISTORY_FILE);
  const read = (): Stored => parse(file.read());
  const write = (stored: Stored): void => {
    file.write({ order: stored.order, entries: stored.entries });
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

  return {
    available: () => cipher.available(),

    load(key) {
      if (!cipher.available()) return [];
      const blob = read().entries[key];
      if (blob === undefined) return [];
      // A CONVERSATION THAT NO LONGER READS is the empty one, for `secretStore`'s reason: there is
      // nothing a person can do about another machine's ciphertext except start again.
      return open(blob)?.turns ?? [];
    },

    list() {
      if (!cipher.available()) return [];
      const stored = read();
      // NEWEST SAVED FIRST: `order` is oldest first, so it is walked from its end.
      const listed: SavedConversation[] = [];
      for (const key of [...stored.order].reverse()) {
        const blob = stored.entries[key];
        const conversation = blob === undefined ? null : open(blob);
        if (conversation === null) continue;
        listed.push({
          key,
          name: conversation.name,
          savedAt: conversation.savedAt,
          turns: conversation.turns.length,
          preview: previewOf(conversation.turns),
        });
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
      const entries = { ...stored.entries };
      Reflect.deleteProperty(entries, key);
      write({ order: stored.order.filter((each) => each !== key), entries });
      return true;
    },

    save(key, turns, name, savedAt) {
      if (!cipher.available()) {
        throw new Error('this machine has no usable credential store, so the conversation was not saved');
      }
      const stored = read();
      const entries = { ...stored.entries };
      let order = stored.order.filter((each) => each !== key);
      if (turns.length === 0) {
        Reflect.deleteProperty(entries, key);
      } else {
        entries[key] = cipher
          .encrypt(JSON.stringify({ v: 2, name, savedAt: savedAt.toISOString(), turns }))
          .toString('base64');
        order = [...order, key];
        while (order.length > limit) {
          const oldest = order[0];
          order = order.slice(1);
          if (oldest !== undefined) Reflect.deleteProperty(entries, oldest);
        }
      }
      write({ order, entries });
    },

    clear() {
      const count = Object.keys(read().entries).length;
      write({ order: [], entries: {} });
      return count;
    },
  };
}
