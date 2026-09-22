import { type SavedTurn, savedTurnsSchema } from '@monstera/contract';

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
export const MAX_SAVED_CONVERSATIONS = 200;

export interface ChatHistory {
  /** Whether conversations can be kept on this machine at all — the keys' own cipher. */
  available(): boolean;
  /** The saved turns for a file, or none. */
  load(key: string): readonly SavedTurn[];
  /** Replaces a file's saved turns; an empty list removes it. Throws with no cipher. */
  save(key: string, turns: readonly SavedTurn[]): void;
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
    clear: () => 0,
  };
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

  return {
    available: () => cipher.available(),

    load(key) {
      if (!cipher.available()) return [];
      const blob = read().entries[key];
      if (blob === undefined) return [];
      try {
        const decoded: unknown = JSON.parse(cipher.decrypt(Buffer.from(blob, 'base64')));
        const turns = savedTurnsSchema.safeParse(decoded);
        // A CONVERSATION THAT NO LONGER READS is the empty one, for `secretStore`'s reason: there is
        // nothing a person can do about another machine's ciphertext except start again.
        return turns.success ? turns.data : [];
      } catch {
        return [];
      }
    },

    save(key, turns) {
      if (!cipher.available()) {
        throw new Error('this machine has no usable credential store, so the conversation was not saved');
      }
      const stored = read();
      const entries = { ...stored.entries };
      let order = stored.order.filter((each) => each !== key);
      if (turns.length === 0) {
        Reflect.deleteProperty(entries, key);
      } else {
        entries[key] = cipher.encrypt(JSON.stringify(turns)).toString('base64');
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
