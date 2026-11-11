import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MAX_DOCUMENT_NAME_LENGTH, MAX_HISTORY_PREVIEW, type SavedTurn, savedTurnsSchema } from '@monstera/contract';
import { z } from 'zod';

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
 * over what it does not need; everything a person wrote, and the PDF's place, is sealed. A torn last record, one whose
 * length runs past the file, ends the read and loses nothing before it; a record that does not open is never shown or
 * counted.
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
const EXTENSION = '.mhist';

const GUARD = 1;
const CARD = 2;
const TURNS = 3;
const ID_BYTES = 32;
const HEAD = 1 + ID_BYTES + 4;
const NONCE = 12;
const TAG = 16;

/** How a PDF is recognised at its place (ADR-0279, the owner's answers, Decision 5). */
export type HistoryGuard =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'stamp'; readonly size: number; readonly mtimeMs: number };

/** One conversation as History lists it. */
export interface HistoryCard {
  readonly key: string;
  readonly name: string | null;
  /** An ISO 8601 instant, or `null` for a conversation 1.1.2610.0 saved without one. */
  readonly savedAt: string | null;
  readonly messages: number;
  readonly preview: string;
}

/** A section of a file as the 24-hour check reads it: the guard in force and the place it was recorded at. */
export interface HistorySection {
  readonly section: string;
  readonly place: string;
  readonly guard: HistoryGuard;
}

const guardSchema = z.union([
  z.object({ kind: z.literal('id'), id: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('stamp'), size: z.number().nonnegative(), mtimeMs: z.number() }).strict(),
]);
const guardRecordSchema = z.object({ place: z.string().max(32_768), guard: guardSchema, previous: guardSchema.nullable() }).strict();
const cardRecordSchema = z
  .object({
    guard: guardSchema.nullable(),
    name: z.string().max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
    savedAt: z.string().max(40).nullable(),
    messages: z.number().int().nonnegative(),
    preview: z.string().max(MAX_HISTORY_PREVIEW),
  })
  .strict();
const turnsRecordSchema = z.object({ from: z.number().int().nonnegative(), turns: savedTurnsSchema }).strict();

/** The one rule for *these two guards are the same document*, before re-links. */
export function sameGuard(a: HistoryGuard, b: HistoryGuard): boolean {
  if (a.kind === 'id' && b.kind === 'id') return a.id === b.id;
  if (a.kind === 'stamp' && b.kind === 'stamp') return a.size === b.size && a.mtimeMs === b.mtimeMs;
  return false;
}

const guardKey = (guard: HistoryGuard): string =>
  guard.kind === 'id' ? `id:${guard.id}` : `stamp:${String(guard.size)}:${String(guard.mtimeMs)}`;

/** The first question a conversation holds, collapsed to one line and bounded: what History quotes beside it. */
function previewOf(turns: readonly SavedTurn[]): string {
  const first = turns.find((turn) => turn.role === 'user') ?? turns[0];
  const line = (first?.text ?? '').replace(/\s+/gu, ' ').trim();
  return line.length <= MAX_HISTORY_PREVIEW ? line : `${line.slice(0, MAX_HISTORY_PREVIEW - 1)}…`;
}

function seal(key: Buffer, value: unknown): Buffer {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

/** The payload's value, or `undefined` where it does not open under `key` or is not JSON. */
function unseal(key: Buffer, sealed: Buffer): unknown {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, NONCE));
    decipher.setAuthTag(sealed.subarray(NONCE, NONCE + TAG));
    return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(NONCE + TAG)), decipher.final()]).toString('utf8'));
  } catch {
    return undefined;
  }
}

export function frame(type: number, id: Buffer, sealed: Buffer): Buffer {
  const head = Buffer.alloc(HEAD);
  head.writeUInt8(type, 0);
  id.copy(head, 1);
  head.writeUInt32LE(sealed.length, 1 + ID_BYTES);
  return Buffer.concat([head, sealed]);
}

interface Head {
  readonly type: number;
  readonly id: string;
  /** Where the record starts, its head included. */
  readonly start: number;
  /** Where its payload starts, and how long it is. */
  readonly at: number;
  readonly length: number;
}

/** Every whole record's head in `bytes`, in order; a torn tail ends the list. */
function headsOf(bytes: Buffer): Head[] {
  const heads: Head[] = [];
  for (let start = 0; start + HEAD <= bytes.length; ) {
    const recordLength = bytes.readUInt32LE(start + 1 + ID_BYTES);
    if (start + HEAD + recordLength > bytes.length) break;
    heads.push({
      type: bytes.readUInt8(start),
      id: bytes.subarray(start + 1, start + 1 + ID_BYTES).toString('hex'),
      start,
      at: start + HEAD,
      length: recordLength,
    });
    start += HEAD + recordLength;
  }
  return heads;
}

/**
 * Every whole record's head in the file at `path`, read by seeking, with a reader for a payload: History's list reads its
 * cards and steps over the turns without reading them. `null` where there is no file.
 */
function withHeads<T>(path: string, use: (heads: readonly Head[], payload: (head: Head) => Buffer) => T): T | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const head = Buffer.alloc(HEAD);
    const heads: Head[] = [];
    for (let start = 0; start + HEAD <= size; ) {
      readSync(fd, head, 0, HEAD, start);
      const length = head.readUInt32LE(1 + ID_BYTES);
      // A TORN TAIL: a record whose payload runs past the file ends the read; nothing before it is lost.
      if (start + HEAD + length > size) break;
      heads.push({ type: head.readUInt8(0), id: head.subarray(1, 1 + ID_BYTES).toString('hex'), start, at: start + HEAD, length });
      start += HEAD + length;
    }
    return use(heads, (each) => {
      const bytes = Buffer.alloc(each.length);
      readSync(fd, bytes, 0, each.length, each.at);
      return bytes;
    });
  } finally {
    closeSync(fd);
  }
}

/** The sections of one file, worked out from its guards and cards (see the module's comment). */
interface Sections {
  /** Each conversation's section root, and its newest card. */
  readonly conversations: ReadonlyMap<string, { readonly root: string; readonly card: z.infer<typeof cardRecordSchema> }>;
  /** Each section's id (its first GUARD record's id), latest guard and place, by root. */
  readonly sections: ReadonlyMap<string, HistorySection>;
  /** The section root a guard is in, or `undefined` where no record names it. */
  readonly rootOf: (guard: HistoryGuard) => string | undefined;
}

/** The root a conversation with no guard is in until a GUARD adopts it. */
const UNGUARDED = 'unguarded';

function sectionsOf(heads: readonly Head[], open: (head: Head) => unknown): Sections {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let at = key;
    for (let next = parent.get(at); next !== undefined && next !== at; next = parent.get(at)) at = next;
    return at;
  };
  const add = (key: string): void => {
    if (!parent.has(key)) parent.set(key, key);
  };
  const union = (a: string, b: string): void => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const newestCard = new Map<string, { guardKey: string | null; card: z.infer<typeof cardRecordSchema> }>();
  const adoptedBy = new Map<string, string>();
  const waiting: string[] = [];
  const firstRecordOf = new Map<string, string>();
  const latest = new Map<string, { place: string; guard: HistoryGuard }>();
  for (const head of heads) {
    if (head.type === GUARD) {
      const value = guardRecordSchema.safeParse(open(head));
      if (!value.success) continue;
      const key = guardKey(value.data.guard);
      add(key);
      if (value.data.previous !== null) union(guardKey(value.data.previous), key);
      if (!firstRecordOf.has(key)) firstRecordOf.set(key, head.id);
      latest.set(key, { place: value.data.place, guard: value.data.guard });
      // THE FIRST GUARD AFTER A CONVERSATION WITH NONE ADOPTS IT: the guard its PDF's next open wrote.
      for (const conversation of waiting.splice(0)) adoptedBy.set(conversation, key);
    } else if (head.type === CARD) {
      const value = cardRecordSchema.safeParse(open(head));
      if (!value.success) continue;
      const key = value.data.guard === null ? null : guardKey(value.data.guard);
      if (key !== null) add(key);
      else if (!adoptedBy.has(head.id) && !waiting.includes(head.id)) waiting.push(head.id);
      newestCard.set(head.id, { guardKey: key, card: value.data });
    }
  }
  const conversations = new Map<string, { root: string; card: z.infer<typeof cardRecordSchema> }>();
  for (const [conversation, { guardKey: key, card }] of newestCard) {
    const own = key ?? adoptedBy.get(conversation);
    conversations.set(conversation, { root: own === undefined ? UNGUARDED : find(own), card });
  }
  // EACH SECTION'S ID IS ITS FIRST GUARD RECORD'S, and its guard in force the LATEST record in it.
  const sections = new Map<string, HistorySection>();
  for (const head of heads) {
    if (head.type !== GUARD) continue;
    const value = guardRecordSchema.safeParse(open(head));
    if (!value.success) continue;
    const root = find(guardKey(value.data.guard));
    const was = sections.get(root);
    sections.set(root, { section: was?.section ?? head.id, place: value.data.place, guard: value.data.guard });
  }
  return {
    conversations,
    sections,
    rootOf: (guard) => (parent.has(guardKey(guard)) ? find(guardKey(guard)) : undefined),
  };
}

export interface HistoryStore {
  /** Whether conversations can be kept on this machine at all: the keys' own cipher. */
  available(): boolean;
  /**
   * At a PDF's open: the guard it is recognised by, written where its file exists (a stat, no read), and held for the
   * session so a save carries it.
   */
  recordGuard(placeKey: string, place: string, guard: HistoryGuard): void;
  /** After Monstera's own save: the guard of the bytes it wrote, naming the one it replaces, so the section continues. */
  relink(placeKey: string, place: string, previous: HistoryGuard, next: HistoryGuard): void;
  /**
   * Saves a conversation: `conversation` names the one it continues, `null` a new one, whose key is answered. Appends one
   * card and the turns changed since this session's last save of it, and reads nothing. An empty new conversation stores
   * nothing and answers `null`. Throws where this machine cannot keep conversations.
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
  /** History's *Clear all*: this PDF's file. */
  clearFile(placeKey: string): void;
  /** Settings' *Clear chat history*: every file, answering how many conversations they held. */
  clearAll(): number;
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
): HistoryStore {
  const folder = join(directory, HISTORY_DIRECTORY);
  const keyPath = join(folder, KEY_FILE);
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

  /** What this session last saved of each conversation, a turn per entry as JSON: the `from` of the next save. */
  const savedTurns = new Map<string, string[]>();
  /** The guard written for each place this session, so a save writes one only where none was. */
  const written = new Map<string, string>();

  const appendGuard = (key: Buffer, placeKey: string, place: string, guard: HistoryGuard, previous: HistoryGuard | null): void => {
    mkdirSync(folder, { recursive: true });
    appendFileSync(fileOf(placeKey), frame(GUARD, randomBytes(ID_BYTES), seal(key, { place, guard, previous })));
    written.set(placeKey, guardKey(guard));
  };

  const readPath = <T>(path: string, use: (heads: readonly Head[], open: (head: Head) => unknown) => T): T | null => {
    const key = keyFor(false);
    if (key === null) return null;
    return withHeads(path, (heads, payload) => use(heads, (head) => unseal(key, payload(head))));
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
  const rewrite = async (placeKey: string, keep: (head: Head) => boolean): Promise<boolean> => {
    const path = fileOf(placeKey);
    if (!existsSync(path)) return false;
    const bytes = await readFile(path);
    const heads = headsOf(bytes);
    const kept = heads.filter(keep);
    if (kept.length === heads.length) return false;
    const body = Buffer.concat(kept.map((head) => bytes.subarray(head.start, head.at + head.length)));
    await writeFile(`${path}.writing`, body);
    // WHAT A SAVE APPENDED SINCE THE READ, filtered the same way, then the rename: no await between, so nothing lands.
    const now = readFileSync(path);
    const later = headsOf(now.subarray(bytes.length)).filter(keep);
    const tail = Buffer.concat(later.map((head) => now.subarray(bytes.length + head.start, bytes.length + head.at + head.length)));
    const whole = Buffer.concat([body, tail]);
    if (!headsOf(whole).some((head) => head.type === CARD)) {
      rmSync(`${path}.writing`, { force: true });
      rmSync(path, { force: true });
      return true;
    }
    if (tail.length > 0) appendFileSync(`${path}.writing`, tail);
    replaceWithRetry(`${path}.writing`, path);
    return true;
  };

  return {
    available: () => cipher.available(),

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
      if (key === null) throw new Error('this machine has no usable credential store, so the conversation was not saved');
      if (conversation === null && turns.length === 0) return { conversation: null };
      const id = conversation ?? mint();
      const now = turns.map((turn) => JSON.stringify(turn));
      const before = savedTurns.get(id) ?? [];
      let from = 0;
      while (from < before.length && from < now.length && before[from] === now[from]) from += 1;
      // NOTHING CHANGED since this session's last save of it: nothing is written.
      if (from === now.length && from === before.length && before.length > 0) return { conversation: id };
      if (written.get(placeKey) !== guardKey(guard)) appendGuard(key, placeKey, place, guard, null);
      const bytesId = Buffer.from(id, 'hex');
      appendFileSync(
        fileOf(placeKey),
        Buffer.concat([
          frame(TURNS, bytesId, seal(key, { from, turns: turns.slice(from) })),
          frame(CARD, bytesId, seal(key, { guard, name, savedAt: savedAt.toISOString(), messages: turns.length, preview: previewOf(turns) })),
        ]),
      );
      savedTurns.set(id, now);
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
      mkdirSync(folder, { recursive: true });
      appendFileSync(
        file ?? fileOf(placeKey),
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
      savedTurns.delete(conversation);
      return rewrite(placeKey, (head) => head.type === GUARD || head.id !== conversation);
    },

    async removeSection(placeKey, section) {
      const plan = read(placeKey, (heads, open) => {
        const found = sectionsOf(heads, open);
        const root = [...found.sections].find(([, each]) => each.section === section)?.[0];
        if (root === undefined) return null;
        const conversations = new Set([...found.conversations].filter(([, each]) => each.root === root).map(([key]) => key));
        const guards = new Set(
          heads
            .filter((head) => head.type === GUARD)
            .filter((head) => {
              const value = guardRecordSchema.safeParse(open(head));
              return value.success && found.rootOf(value.data.guard) === root;
            })
            .map((head) => head.id),
        );
        return { conversations, guards };
      });
      if (plan === null) return false;
      for (const conversation of plan.conversations) savedTurns.delete(conversation);
      return rewrite(placeKey, (head) => !(head.type === GUARD ? plan.guards.has(head.id) : plan.conversations.has(head.id)));
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

    clearFile(placeKey) {
      rmSync(fileOf(placeKey), { force: true });
      written.delete(placeKey);
    },

    clearAll() {
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
      written.clear();
      savedTurns.clear();
      return count;
    },
  };
}

