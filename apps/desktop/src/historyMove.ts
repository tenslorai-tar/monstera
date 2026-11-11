import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { CHAT_HISTORY_FILE, readEveryConversation } from './chatHistory.js';
import { HISTORY_DIRECTORY, type HistoryStore } from './historyStore.js';
import type { SecretCipher } from './secretStore.js';
import { replaceWithRetry } from './settingsFile.js';

/**
 * The move of what 1.1.2610.0 saved into ADR-0279's store, ONCE, losing nothing (the owner's decision i; ADR-0279
 * Decision 8 and its correction of 2026-11-12).
 *
 * ## Each conversation becomes its PDF's file, with no guard
 *
 * The old store kept each file under the SHA-256 of its place, which is the new store's file name, so a conversation
 * lands in the file its PDF's place names. It kept no path and no guard, so a moved conversation is written with none and
 * is adopted by its PDF's next open (`historyStore.ts`); until then it is kept, sealed, and the 24-hour check does not
 * look at it. A blob that does not decrypt cannot be moved and is never counted or shown; it stays in the renamed old
 * file, which is removed a version later.
 *
 * ## Nothing is lost on the way, and a failure leaves the old file in place
 *
 * Every conversation is written into a staging folder, read back and compared turn for turn, and only then moved into
 * place; only when every file is in place is `chat-history.json` renamed `chat-history.migrated.json`. A conversation's
 * new key is derived from its old one, so a run that failed after moving some files and runs again finds them by key and
 * adds none twice. With the old file renamed, a later run finds nothing to move.
 */

export const MIGRATED_FILE = 'chat-history.migrated.json';
const STAGING = '.moving';

/** A moved conversation's key in the new store: the same for the same old key, on every run. */
export function movedKey(oldKey: string): string {
  return createHash('sha256').update(`moved from 1.1.2610.0:${oldKey}`, 'utf8').digest('hex');
}

/**
 * Moves `chat-history.json` in `directory` into `store`, once. Answers how many conversations were moved, `null` where
 * there was nothing to move (no old file, or it was moved already), and throws where a step failed, the old file kept.
 *
 * @param replace the rename into place; a case passes one that fails, to prove a failure keeps the old file
 */
export function moveChatHistory(
  directory: string,
  cipher: SecretCipher,
  store: HistoryStore,
  replace: (from: string, to: string) => void = (from, to) => {
    replaceWithRetry(from, to);
  },
): number | null {
  // NOTHING IS READ WITHOUT THE ACCOUNT'S CIPHER: every old blob is sealed by it, and the old file stays for the run that has it.
  if (!cipher.available()) return null;
  const conversations = readEveryConversation(directory, cipher);
  if (conversations === null) return null;

  const staging = join(directory, HISTORY_DIRECTORY, STAGING);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const stagedOf = (file: string): string => join(staging, `${file}.mhist`);

  // OLDEST FIRST within each file, so a file's records are in the order its conversations were saved.
  const byFile = new Map<string, (typeof conversations)[number][]>();
  for (const conversation of conversations) byFile.set(conversation.file, [conversation, ...(byFile.get(conversation.file) ?? [])]);

  for (const [file, held] of byFile) {
    for (const conversation of held) {
      store.writeUnguarded(file, movedKey(conversation.key), conversation.turns, conversation.name, conversation.savedAt, stagedOf(file));
    }
  }
  // READ BACK, every one, before anything is moved into place.
  for (const [file, held] of byFile) {
    for (const conversation of held) {
      const back = store.readFile(stagedOf(file), movedKey(conversation.key));
      if (back === null || !isDeepStrictEqual(back, conversation.turns)) {
        throw new Error(`a moved conversation did not read back as it was saved; ${CHAT_HISTORY_FILE} is kept`);
      }
    }
  }
  for (const [file, held] of byFile) {
    const target = store.pathOf(file);
    if (!existsSync(target)) {
      replace(stagedOf(file), target);
      continue;
    }
    // A FILE ALREADY IN PLACE, from a run that failed after moving it: only what it does not hold yet is added.
    const present = new Set(store.conversationsIn(target));
    for (const conversation of held) {
      const key = movedKey(conversation.key);
      if (!present.has(key)) store.writeUnguarded(file, key, conversation.turns, conversation.name, conversation.savedAt);
    }
  }
  rmSync(staging, { recursive: true, force: true });
  replace(join(directory, CHAT_HISTORY_FILE), join(directory, MIGRATED_FILE));
  return conversations.length;
}

/** Whether a staging folder is left over, which a run that failed leaves and the next run clears. */
export function moveLeftStaging(directory: string): boolean {
  const staging = join(directory, HISTORY_DIRECTORY, STAGING);
  return existsSync(staging) && readdirSync(staging).length > 0;
}
