import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { SavedTurn } from '@monstera/contract';
import { pathlessCause } from '@monstera/shared';
import {
  CARD,
  GUARD,
  type Head,
  type HistoryCard,
  type HistoryDrop,
  type HistoryGuard,
  type HistorySection,
  ID_BYTES,
  TURNS,
  cardRecordSchema,
  frame,
  guardKey,
  keptUnder,
  previewOf,
  recordsIn,
  seal,
  sectionsOf,
  turnsRecordSchema,
  unseal,
  type WholeRecords,
  wholeRecords,
} from '@monstera/nodemode';

export { frame, sameGuard, type HistoryCard, type HistoryGuard, type HistorySection } from '@monstera/nodemode';

import { type HistoryRewriter, workerRewriter } from './historyRewriter.js';
import type { SecretCipher } from './secretStore.js';
import { replaceWithRetry } from './settingsFile.js';

/**
 * Saved assistant conversations, ONE FILE PER PDF
 * ([ADR-0279](../../../docs/DECISIONS/0279-saved-conversations-are-kept-without-caps-each-in-its-own-file-and-history-reads-one-log.md),
 * as revised by the owner's answers of 2026-10-31 and corrected 2026-11-12).
 *
 * ## The file
 *
 * `history/<placeKey>.mhist`, `placeKey` the SHA-256 of the PDF's canonical path that `DocumentService.historyKeyOf`
 * gives, so no path is in the clear and the key 1.1.2610.0's store used names the same file. Inside, records appended one
 * after another, each `[type u8][id, 32 bytes][length u32 LE][payload]`, the payload sealed with AES-256-GCM under ONE
 * data key (a 12-byte nonce, the 16-byte tag, the ciphertext). The type and the id are in the clear so a reader steps
 * over what it does not need; everything a person wrote, and the PDF's place, is sealed. A torn record, part of one a
 * crash or a full disk left, is stepped past wherever it is and only its own bytes are lost (`wholeRecords`, the owner's
 * answer of 2026-11-12); a record that does not open is never shown or counted.
 *
 * - **GUARD** (id: a random record id): the PDF's place and how it is recognised, its first `/ID` string or, where it has
 *   none, its size and write time; on a re-link after Monstera's own save, also the guard it replaces.
 * - **CARD** (id: the conversation's key): what History lists, and the guard the PDF had when it was saved.
 * - **TURNS** (id: the conversation's key): the conversation's turns from index `from` on, replacing any after it, since a
 *   conversation is not append-only (Regenerate and Edit replace its tail).
 *
 * ## A save READS NOTHING, and neither does an open
 *
 * ADR-0279's owner's answers, Decisions 1 and 8: a save appends, and opening a PDF reads no history. So the guard a PDF
 * is recognised by is WRITTEN at its open (`recordGuard`, only where its file exists, which is a stat) and carried in
 * every card, and what the turns were at the last save is held in memory for the session. Which conversations belong to
 * the PDF now at the place is worked out where the file is read anyway: History's list.
 *
 * **One read a write does make, once a session for a file:** a write never lands behind a torn record (the owner's
 * answer of 2026-11-12), so the first write this session makes to a file it did not leave at its present size walks that
 * file's record heads to find where the last whole one ends (`appendTo`). Heads only, never a payload, unless the walk
 * finds a torn record; every later write to that file reads nothing.
 *
 * ## Sections (the owner's correction of 2026-11-12)
 *
 * One file per place holds one SECTION per document that stood there. Two guards are the same document where both have an
 * `/ID` and the ids are equal, where both are stamps and equal, or where a re-link names one as the other's predecessor.
 * History shows the conversations whose guard is in the section of the PDF now there, so a PDF that comes back within
 * the 24 hours gets its own back. A conversation moved from 1.1.2610.0 has no guard (its store kept only the place's
 * digest): it is ADOPTED by the first GUARD record after it, which is the one its PDF's next open writes, and until then
 * it is in no section the 24-hour check looks at.
 */

export const HISTORY_DIRECTORY = 'history';
const KEY_FILE = 'key';
const LEDGER_FILE = 'ledger';
const NOTE_FILE = 'note-shown';
const EXTENSION = '.mhist';

/**
 * The whole records in the file at `path` ({@link wholeRecords}, read by seeking), with a reader for a payload: History's
 * list reads its cards and steps over the turns without reading them. `null` where there is no file.
 */
function withRecords<T>(path: string, key: Buffer, use: (records: WholeRecords, payload: (head: Head) => Buffer) => T): T | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, 'r');
  try {
    const readAt = (position: number, length: number): Buffer => {
      const bytes = Buffer.alloc(length);
      readSync(fd, bytes, 0, length, position);
      return bytes;
    };
    const payload = (head: Head): Buffer => readAt(head.at, head.length);
    const records = wholeRecords(readAt, statSync(path).size, (head) => unseal(key, payload(head)) !== undefined);
    return use(records, payload);
  } finally {
    closeSync(fd);
  }
}

/**
 * A save refused because the history saved here is locked to another account's key ({@link HistoryStore.locked}): its
 * own class, so the handler can tell the person this and not a generic failure.
 */
export class HistoryLockedError extends Error {
  constructor() {
    super('the chat history saved on this computer cannot be opened by this account, so the conversation was not saved');
    this.name = 'HistoryLockedError';
  }
}

export interface HistoryStore {
  /** Whether conversations can be kept on this machine at all: the keys' own cipher. */
  available(): boolean;
  /**
   * Whether this machine's saved history is LOCKED to it: a data key is stored and this Windows account cannot unwrap it
   * (after an administrator resets the account's password, or with history restored from another computer). The key is
   * never replaced, since that would lose every conversation sealed under it; a save then refuses with
   * {@link HistoryLockedError} so the person is told, and *Clear chat history* starts again (ADR-0279's correction of
   * 2026-11-12).
   */
  locked(): boolean;
  /**
   * At a PDF's open: the guard it is recognised by, written where its file exists (a stat, no read), and held for the
   * session so a save carries it.
   */
  recordGuard(placeKey: string, place: string, guard: HistoryGuard): void;
  /** After Monstera's own save: the guard of the bytes it wrote, naming the one it replaces, so the section continues. */
  relink(placeKey: string, place: string, previous: HistoryGuard, next: HistoryGuard): void;
  /**
   * Saves a conversation: `conversation` names the one it continues, `null` a new one, whose key is answered. Appends one
   * card and the turns changed since this session's last save of it, and reads nothing. A save with no turns stores
   * nothing and answers the key it was given (`null` for a new one). Throws where this machine cannot keep conversations.
   */
  save(
    placeKey: string,
    place: string,
    guard: HistoryGuard,
    conversation: string | null,
    turns: readonly SavedTurn[],
    name: string | null,
    savedAt: Date,
  ): { readonly conversation: string | null };
  /** The conversations of the section `guard` is in, newest saved first: History for the PDF now at the place. */
  list(placeKey: string, guard: HistoryGuard): readonly HistoryCard[];
  /** One conversation's turns, or `null` where nothing that opens is saved under its key. */
  read(placeKey: string, conversation: string): { readonly savedAt: string | null; readonly turns: readonly SavedTurn[] } | null;
  /** Delete one: the file rewritten without its records, beside and renamed over. Says whether it held one. */
  remove(placeKey: string, conversation: string): Promise<boolean>;
  /** The 24-hour check's removal of one section, by the same rewrite; the file goes when no conversation is left. */
  removeSection(placeKey: string, section: string): Promise<boolean>;
  /** Each guarded section's guard in force and place, for the 24-hour check. */
  guards(placeKey: string): readonly HistorySection[];
  /** Every file's place key. */
  files(): readonly string[];
  /**
   * The move from 1.1.2610.0 (`historyMove.ts`): one conversation written whole with NO guard, into `placeKey`'s file
   * or `file` where given (the move writes beside, then renames into place). The first GUARD after it, its PDF's next
   * open, adopts it. Throws where this machine cannot keep conversations.
   */
  writeUnguarded(
    placeKey: string,
    conversation: string,
    turns: readonly SavedTurn[],
    name: string | null,
    savedAt: string | null,
    file?: string,
  ): void;
  /** The file a place's history is in. */
  pathOf(placeKey: string): string;
  /** The key of every card that opens in the file at `path`, in file order: a key twice is a conversation written twice. */
  conversationsIn(path: string): readonly string[];
  /** One conversation's turns from the file at `path`, or `null`: the move's read-back. */
  readFile(path: string, conversation: string): readonly SavedTurn[] | null;
  /**
   * The 24-hour check's ledger (ADR-0279's Decision 6), sealed under the data key like every record: what it last saw
   * of each section and when it first found one missing. `null` where none is kept or it does not open.
   */
  ledger(): unknown;
  /**
   * Keeps the ledger, written beside and renamed over, under the data key in force. Nothing is kept where there is none:
   * a machine that never saved a conversation, one that cannot keep conversations, or one whose history is locked.
   */
  keepLedger(value: unknown): void;
  /** History's *Clear all*: this PDF's file. */
  clearFile(placeKey: string): void;
  /** Settings' *Clear chat history*: every file, answering how many conversations they held. */
  clearAll(): number;
  /**
   * The note that chat history is on, claimed (ADR-0279 decision h): `true` the one time it is claimed on this computer,
   * `false` ever after. The claim is the file's creation, so two callers cannot both win. *Clear chat history* keeps it.
   */
  claimNote(): boolean;
}

/**
 * @param directory the application's data folder; the history is its `history` folder
 * @param cipher the keys' own cipher (`safeStorage`), which wraps the one data key
 * @param mint a new conversation's key, 64 hex characters; a case passes its own
 */
export function createHistoryStore(
  directory: string,
  cipher: SecretCipher,
  mint: () => string = () => randomBytes(ID_BYTES).toString('hex'),
  rewriter: HistoryRewriter = workerRewriter(),
): HistoryStore {
  const folder = join(directory, HISTORY_DIRECTORY);
  const keyPath = join(folder, KEY_FILE);
  const ledgerPath = join(folder, LEDGER_FILE);
  const fileOf = (placeKey: string): string => join(folder, `${placeKey}${EXTENSION}`);
  let dataKey: Buffer | null | undefined;

  /**
   * The one data key, unwrapped once for the store's life, made at the first save that needs one. `null` where the
   * cipher is unavailable, or where a key is stored that this account cannot unwrap: then nothing opens and nothing is
   * saved, rather than a new key written over the one every record is sealed with.
   */
  const keyFor = (create: boolean): Buffer | null => {
    if (dataKey !== undefined && dataKey !== null) return dataKey;
    if (!cipher.available()) return null;
    if (existsSync(keyPath)) {
      try {
        const hex = cipher.decrypt(Buffer.from(readFileSync(keyPath, 'utf8'), 'base64'));
        dataKey = /^[0-9a-f]{64}$/u.test(hex) ? Buffer.from(hex, 'hex') : null;
      } catch {
        dataKey = null;
      }
      return dataKey;
    }
    if (!create) return null;
    const made = randomBytes(32);
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${keyPath}.writing`, cipher.encrypt(made.toString('hex')).toString('base64'));
    replaceWithRetry(`${keyPath}.writing`, keyPath);
    dataKey = made;
    return made;
  };

  /** A key is stored, the cipher works, and the key does not unwrap: the state no save may write over. */
  const isLocked = (): boolean => cipher.available() && existsSync(keyPath) && keyFor(false) === null;

  /**
   * What this session last saved of each conversation, a turn per entry as JSON, BY FILE: the `from` of the next save.
   * It holds only while the file holds those records, so whatever takes a file's records (Clear all, a Delete) takes
   * this file's entries with them, and the next save of a conversation writes it whole.
   */
  const savedTurns = new Map<string, Map<string, string[]>>();
  const savedOf = (placeKey: string): Map<string, string[]> => {
    let saved = savedTurns.get(placeKey);
    if (saved === undefined) {
      saved = new Map();
      savedTurns.set(placeKey, saved);
    }
    return saved;
  };
  /**
   * The guard written for each place this session, so a save writes one only where none was. Forgotten when a rewrite
   * or a clear may have taken that record, so the next save writes it again.
   */
  const written = new Map<string, string>();

  /**
   * Where each file's last whole record ends, as this session last left it: a file still that size has nothing torn at
   * its tail, so an append to it reads nothing.
   */
  const ends = new Map<string, number>();

  /**
   * Each file's rewrite in flight, so the next waits for it: a rewrite awaits its worker, and two of one file at once, two
   * Deletes or a Delete and the 24-hour check, would each rename a file built from the same old one over the other's.
   */
  const rewrites = new Map<string, Promise<unknown>>();
  /**
   * How many times each file was cleared, and Clear all's count for every file: a rewrite whose worker read the file
   * before a clear renames nothing, since what it built is the cleared file's, sealed under a key the clear may have
   * removed, and would land over whatever a save wrote since.
   */
  const cleared = new Map<string, number>();
  let clearedAll = 0;
  const clearsOf = (path: string): string => `${String(clearedAll)}:${String(cleared.get(path) ?? 0)}`;

  /**
   * Appends whole records to the file at `path`, and NEVER BEHIND A TORN ONE (the owner's answer of 2026-11-12): where
   * the file is not the size this session left it, its records are walked once ({@link wholeRecords}) and a torn tail,
   * the part of a record a crash or a full disk left, is cut off first. Only those bytes are lost, and they never were a
   * record. A write that fails part way is cut back the same way before the failure is thrown, so this session leaves no
   * torn record behind it either.
   */
  const appendTo = (path: string, key: Buffer, bytes: Buffer): void => {
    mkdirSync(folder, { recursive: true });
    const size = existsSync(path) ? statSync(path).size : 0;
    let end = ends.get(path);
    if (end !== size) {
      end = size === 0 ? 0 : (withRecords(path, key, (records) => records.end) ?? 0);
      if (end < size) truncateSync(path, end);
    }
    try {
      appendFileSync(path, bytes);
    } catch (cause) {
      // THE NEXT APPEND WALKS THE FILE AGAIN, so a tail this could not cut is dealt with there.
      ends.delete(path);
      try {
        if (existsSync(path)) truncateSync(path, end);
      } catch (uncut) {
        throw new AggregateError([cause, uncut], 'the conversation was not saved, and what was written of it could not be cut off', {
          cause: uncut,
        });
      }
      throw cause;
    }
    ends.set(path, end + bytes.length);
  };

  const appendGuard = (key: Buffer, placeKey: string, place: string, guard: HistoryGuard, previous: HistoryGuard | null): void => {
    appendTo(fileOf(placeKey), key, frame(GUARD, randomBytes(ID_BYTES), seal(key, { place, guard, previous })));
    written.set(placeKey, guardKey(guard));
  };

  const readPath = <T>(path: string, use: (heads: readonly Head[], open: (head: Head) => unknown) => T): T | null => {
    const key = keyFor(false);
    if (key === null) return null;
    return withRecords(path, key, (records, payload) => use(records.heads, (head) => unseal(key, payload(head))));
  };
  const read = <T>(placeKey: string, use: (heads: readonly Head[], open: (head: Head) => unknown) => T): T | null =>
    readPath(fileOf(placeKey), use);

  /** One conversation folded from its records: the turns and its newest card's time, or `null` where it does not open. */
  const fold = (
    heads: readonly Head[],
    open: (head: Head) => unknown,
    conversation: string,
  ): { readonly savedAt: string | null; readonly turns: readonly SavedTurn[] } | null => {
    let turns: SavedTurn[] = [];
    let savedAt: string | null | undefined;
    for (const head of heads) {
      if (head.id !== conversation) continue;
      if (head.type === TURNS) {
        const value = turnsRecordSchema.safeParse(open(head));
        // A TURNS RECORD THAT DOES NOT OPEN breaks the conversation it belongs to: it is not shown at all.
        if (!value.success) return null;
        turns = [...turns.slice(0, value.data.from), ...value.data.turns];
      } else if (head.type === CARD) {
        const value = cardRecordSchema.safeParse(open(head));
        if (value.success) savedAt = value.data.savedAt;
      }
    }
    return savedAt === undefined ? null : { savedAt, turns };
  };

  /**
   * Rewrites a file keeping the records `keep` answers yes for, beside it and renamed over it. Records appended while the
   * rewrite ran are carried over too (a save is synchronous, so none lands between the last read and the rename), except
   * any `keep` refuses. The file goes when no card is left. Answers whether anything was dropped.
   */
  /**
   * Delete's rewrite: the WORKER reads the file, works out what to drop and writes what stays beside it (`rewriter`,
   * Decision 7, off the main thread); here only what a save appended since the worker's read is added, filtered by the
   * same plan, and the file renamed over, with no await between, so nothing a save writes in the meantime is lost. The
   * tail is read by seeking, never the whole file. Answers the dropped conversations, `null` where nothing was dropped.
   */
  const rewrite = async (placeKey: string, drop: HistoryDrop): Promise<readonly string[] | null> => {
    const path = fileOf(placeKey);
    const before = rewrites.get(path) ?? Promise.resolve();
    // AFTER THE ONE BEFORE, whatever it answered: its failure was its caller's, and this one reads the file it left.
    const run = before.then(
      () => rewriteNow(placeKey, drop),
      () => rewriteNow(placeKey, drop),
    );
    rewrites.set(path, run);
    try {
      return await run;
    } finally {
      if (rewrites.get(path) === run) rewrites.delete(path);
    }
  };

  const rewriteNow = async (placeKey: string, drop: HistoryDrop): Promise<readonly string[] | null> => {
    const path = fileOf(placeKey);
    const key = keyFor(false);
    if (key === null || !existsSync(path)) return null;
    // ITS OWN NAME, so nothing else this process writes beside the file can be the file this rewrite renames.
    const writing = `${path}.${randomBytes(8).toString('hex')}.writing`;
    const clears = clearsOf(path);
    const result = await rewriter({ path, writing, key: new Uint8Array(key), drop });
    // CLEARED WHILE THE WORKER READ: what it built is of a file that is gone, and nothing of it is renamed in.
    if (clearsOf(path) !== clears) {
      rmSync(writing, { force: true });
      return null;
    }
    if (result.kind === 'nothing') return null;
    // THE GUARD THIS SESSION WROTE may be among what is dropped (a section's guards, or the whole file with the last
    // conversation), so the next save writes it again: one small record, where a missing one hides the section from the
    // 24-hour check.
    written.delete(placeKey);
    if (result.kind === 'failed') {
      rmSync(writing, { force: true });
      // PATHLESS (HHHHHHHHH-19): a system error's message names the history file, and this one reaches the failure log.
      throw new Error(`the conversation could not be removed: ${pathlessCause(result)}`);
    }
    const keep = keptUnder(result.plan);
    const fd = openSync(path, 'r');
    let tail: Buffer;
    try {
      const size = statSync(path).size;
      tail = Buffer.alloc(Math.max(0, size - result.read));
      readSync(fd, tail, 0, tail.length, result.read);
    } finally {
      closeSync(fd);
    }
    const later = recordsIn(tail, key).heads.filter(keep);
    const kept = Buffer.concat(later.map((head) => tail.subarray(head.start, head.at + head.length)));
    // NO CONVERSATION LEFT, in the rewrite or the tail: the file goes, its guards with it.
    if (result.cardsKept === 0 && !later.some((head) => head.type === CARD)) {
      rmSync(writing, { force: true });
      rmSync(path, { force: true });
      ends.delete(path);
      return result.plan.conversations;
    }
    if (kept.length > 0) appendFileSync(writing, kept);
    // THE REWRITE IS WHOLE RECORDS, the worker's and the tail's, so it ends where its size says.
    const size = statSync(writing).size;
    replaceWithRetry(writing, path);
    ends.set(path, size);
    return result.plan.conversations;
  };

  return {
    available: () => cipher.available(),

    locked: isLocked,

    recordGuard(placeKey, place, guard) {
      if (written.get(placeKey) === guardKey(guard)) return;
      // WHERE THE FILE EXISTS ONLY, a stat: a PDF with no history gets no file for being opened.
      if (!existsSync(fileOf(placeKey))) {
        written.delete(placeKey);
        return;
      }
      const key = keyFor(false);
      if (key === null) return;
      appendGuard(key, placeKey, place, guard, null);
    },

    relink(placeKey, place, previous, next) {
      if (!existsSync(fileOf(placeKey))) return;
      const key = keyFor(false);
      if (key === null) return;
      appendGuard(key, placeKey, place, next, previous);
    },

    save(placeKey, place, guard, conversation, turns, name, savedAt) {
      const key = keyFor(true);
      if (key === null) {
        if (isLocked()) throw new HistoryLockedError();
        throw new Error('this machine has no usable credential store, so the conversation was not saved');
      }
      // A SAVE WITH NO TURNS CHANGES NOTHING ON DISK, a new conversation's or a saved one's: the contract's "nothing is
      // removed by a save". Written, it would be a TURNS record from 0 holding none, which empties the saved one.
      if (turns.length === 0) return { conversation };
      const id = conversation ?? mint();
      // WHAT THIS SESSION SAVED HOLDS WHILE THE FILE IS AS IT LEFT IT: a file cleared, removed or changed since is one whose
      // records this session cannot count on, so each conversation is written whole again. A stat, no read.
      const path = fileOf(placeKey);
      if (ends.get(path) !== (existsSync(path) ? statSync(path).size : 0)) savedTurns.delete(placeKey);
      const now = turns.map((turn) => JSON.stringify(turn));
      const before = savedOf(placeKey).get(id) ?? [];
      let from = 0;
      while (from < before.length && from < now.length && before[from] === now[from]) from += 1;
      // NOTHING CHANGED since this session's last save of it: nothing is written.
      if (from === now.length && from === before.length && before.length > 0) return { conversation: id };
      if (written.get(placeKey) !== guardKey(guard)) appendGuard(key, placeKey, place, guard, null);
      const bytesId = Buffer.from(id, 'hex');
      appendTo(
        fileOf(placeKey),
        key,
        Buffer.concat([
          frame(TURNS, bytesId, seal(key, { from, turns: turns.slice(from) })),
          frame(CARD, bytesId, seal(key, { guard, name, savedAt: savedAt.toISOString(), messages: turns.length, preview: previewOf(turns) })),
        ]),
      );
      savedOf(placeKey).set(id, now);
      return { conversation: id };
    },

    list(placeKey, guard) {
      const listed = read(placeKey, (heads, open) => {
        const found = sectionsOf(heads, open);
        const root = found.rootOf(guard);
        if (root === undefined) return [];
        return [...found.conversations]
          .filter(([, each]) => each.root === root)
          .map(([key, { card }]): HistoryCard => ({ key, name: card.name, savedAt: card.savedAt, messages: card.messages, preview: card.preview }));
      });
      return [...(listed ?? [])].sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
    },

    read(placeKey, conversation) {
      return read(placeKey, (heads, open) => fold(heads, open, conversation));
    },

    writeUnguarded(placeKey, conversation, turns, name, savedAt, file) {
      const key = keyFor(true);
      if (key === null) throw new Error('this machine has no usable credential store, so the conversation was not moved');
      const id = Buffer.from(conversation, 'hex');
      appendTo(
        file ?? fileOf(placeKey),
        key,
        Buffer.concat([
          frame(TURNS, id, seal(key, { from: 0, turns })),
          frame(CARD, id, seal(key, { guard: null, name, savedAt, messages: turns.length, preview: previewOf(turns) })),
        ]),
      );
    },

    pathOf: fileOf,

    conversationsIn(path) {
      return (
        readPath(path, (heads, open) => {
          const keys: string[] = [];
          for (const head of heads) {
            if (head.type === CARD && cardRecordSchema.safeParse(open(head)).success) keys.push(head.id);
          }
          return keys;
        }) ?? []
      );
    },

    readFile(path, conversation) {
      return readPath(path, (heads, open) => fold(heads, open, conversation)?.turns ?? null);
    },

    async remove(placeKey, conversation) {
      savedOf(placeKey).delete(conversation);
      return (await rewrite(placeKey, { kind: 'conversation', key: conversation })) !== null;
    },

    async removeSection(placeKey, section) {
      const dropped = await rewrite(placeKey, { kind: 'section', section });
      for (const conversation of dropped ?? []) savedOf(placeKey).delete(conversation);
      return dropped !== null;
    },

    guards(placeKey) {
      return read(placeKey, (heads, open) => [...sectionsOf(heads, open).sections.values()]) ?? [];
    },

    files() {
      if (!existsSync(folder)) return [];
      return readdirSync(folder)
        .filter((name) => name.endsWith(EXTENSION))
        .map((name) => name.slice(0, -EXTENSION.length));
    },

    ledger() {
      const key = keyFor(false);
      if (key === null || !existsSync(ledgerPath)) return null;
      try {
        return unseal(key, readFileSync(ledgerPath));
      } catch {
        // A LEDGER THAT DOES NOT OPEN is one never kept: the next pass starts every clock again, which can only delay a
        // removal, never bring one forward.
        return null;
      }
    },

    keepLedger(value) {
      // THE KEY IN FORCE, NEVER A NEW ONE (HHHHHHHHH-20): a machine that never saved a conversation has no section to
      // check, and the check's pass would otherwise make it a data key, and a history folder, for nothing. Where there is
      // none, nothing is kept, and the next pass starts every clock again, which can only delay a removal.
      const key = keyFor(false);
      if (key === null) return;
      mkdirSync(folder, { recursive: true });
      writeFileSync(`${ledgerPath}.writing`, seal(key, value));
      replaceWithRetry(`${ledgerPath}.writing`, ledgerPath);
    },

    clearFile(placeKey) {
      cleared.set(fileOf(placeKey), (cleared.get(fileOf(placeKey)) ?? 0) + 1);
      rmSync(fileOf(placeKey), { force: true });
      ends.delete(fileOf(placeKey));
      written.delete(placeKey);
    },

    clearAll() {
      clearedAll += 1;
      let count = 0;
      for (const placeKey of this.files()) {
        count +=
          read(placeKey, (heads, open) => {
            const opened = new Set<string>();
            for (const head of heads) if (head.type === CARD && cardRecordSchema.safeParse(open(head)).success) opened.add(head.id);
            return opened.size;
          }) ?? 0;
        rmSync(fileOf(placeKey), { force: true });
      }
      // THE LEDGER GOES WITH THEM: it names sections that no longer exist, and keeps a place in it.
      rmSync(ledgerPath, { force: true });
      // AND THE KEY: nothing is sealed under it any more, and where it could not be unwrapped (another account's, after a
      // password reset or a restore from another computer) this is the one way the person starts again. The next save
      // makes a new one (ADR-0279's correction of 2026-11-12).
      rmSync(keyPath, { force: true });
      dataKey = undefined;
      ends.clear();
      written.clear();
      savedTurns.clear();
      return count;
    },

    claimNote() {
      mkdirSync(folder, { recursive: true });
      try {
        // `wx` CREATES OR FAILS: the file system decides which caller claimed it, not a read before the write.
        writeFileSync(join(folder, NOTE_FILE), '', { flag: 'wx' });
        return true;
      } catch (thrown) {
        if ((thrown as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw thrown;
      }
    },
  };
}

