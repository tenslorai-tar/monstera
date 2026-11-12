import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { MAX_DOCUMENT_NAME_LENGTH, MAX_HISTORY_PREVIEW, type SavedTurn, savedTurnsSchema } from '@monstera/contract';
import { z } from 'zod';

/**
 * The records of a chat history file, ONE definition for the two threads that read them
 * ([ADR-0279](../../../docs/DECISIONS/0279-saved-conversations-are-kept-without-caps-each-in-its-own-file-and-history-reads-one-log.md)):
 * `main`'s store (`apps/desktop/src/historyStore.ts`, whose comment describes the file) and the worker that rewrites a
 * file for Delete off the main thread (`historyRewriteWorker.ts`, Decision 7). Here, in `packages/nodemode`, because the
 * worker runs in Node mode (ADR-0024), and once, because two copies of a record format are two opinions about what a
 * file says (B3a). Pure functions over bytes and a key: no file is opened here.
 */

export const GUARD = 1;
export const CARD = 2;
export const TURNS = 3;
export const ID_BYTES = 32;
export const HEAD = 1 + ID_BYTES + 4;
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
export const guardRecordSchema = z.object({ place: z.string().max(32_768), guard: guardSchema, previous: guardSchema.nullable() }).strict();
export const cardRecordSchema = z
  .object({
    guard: guardSchema.nullable(),
    name: z.string().max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
    savedAt: z.string().max(40).nullable(),
    messages: z.number().int().nonnegative(),
    preview: z.string().max(MAX_HISTORY_PREVIEW),
  })
  .strict();
export const turnsRecordSchema = z.object({ from: z.number().int().nonnegative(), turns: savedTurnsSchema }).strict();

/** The one rule for *these two guards are the same document*, before re-links. */
export function sameGuard(a: HistoryGuard, b: HistoryGuard): boolean {
  if (a.kind === 'id' && b.kind === 'id') return a.id === b.id;
  if (a.kind === 'stamp' && b.kind === 'stamp') return a.size === b.size && a.mtimeMs === b.mtimeMs;
  return false;
}

export const guardKey = (guard: HistoryGuard): string =>
  guard.kind === 'id' ? `id:${guard.id}` : `stamp:${String(guard.size)}:${String(guard.mtimeMs)}`;

/** The first question a conversation holds, collapsed to one line and bounded: what History quotes beside it. */
export function previewOf(turns: readonly SavedTurn[]): string {
  const first = turns.find((turn) => turn.role === 'user') ?? turns[0];
  const line = (first?.text ?? '').replace(/\s+/gu, ' ').trim();
  return line.length <= MAX_HISTORY_PREVIEW ? line : `${line.slice(0, MAX_HISTORY_PREVIEW - 1)}…`;
}

export function seal(key: Buffer, value: unknown): Buffer {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

/** The payload's value, or `undefined` where it does not open under `key` or is not JSON. */
export function unseal(key: Buffer, sealed: Buffer): unknown {
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

export interface Head {
  readonly type: number;
  readonly id: string;
  /** Where the record starts, its head included. */
  readonly start: number;
  /** Where its payload starts, and how long it is. */
  readonly at: number;
  readonly length: number;
}

/** `length` bytes of a file from `position`, all of them: the one thing {@link wholeRecords} asks of where it reads. */
export type ReadAt = (position: number, length: number) => Buffer;

/** A file's whole records, as {@link wholeRecords} finds them. */
export interface WholeRecords {
  /** Every whole record's head, in file order. */
  readonly heads: readonly Head[];
  /**
   * Where the last whole record ends. Short of the file's size only where a torn record is its tail: what a write cuts
   * the file back to before it appends, and what a rewrite has read up to.
   */
  readonly end: number;
}

/** How far the search for the record after torn bytes reads at once. */
const SCAN = 64 * 1024;

/**
 * The head at `offset` in `bytes`, which start at `position` in a file of `size` bytes, where a record can start there: a
 * type this format has, a payload long enough to be sealed, and all of it inside the file. `null` anywhere else.
 */
function headIn(bytes: Buffer, offset: number, position: number, size: number): Head | null {
  if (offset + HEAD > bytes.length) return null;
  const type = bytes.readUInt8(offset);
  const length = bytes.readUInt32LE(offset + 1 + ID_BYTES);
  if (type !== GUARD && type !== CARD && type !== TURNS) return null;
  if (length < NONCE + TAG || position + HEAD + length > size) return null;
  return { type, id: bytes.subarray(offset + 1, offset + 1 + ID_BYTES).toString('hex'), start: position, at: position + HEAD, length };
}

/**
 * Every WHOLE record in a file of `size` bytes, and where the last one ends: THE ONE READING of a history file, for
 * `main`'s reader and writer and for Delete's worker (B3a), so the three cannot disagree about where a record is.
 *
 * ## A torn record is stepped past, wherever it is
 *
 * A write cut short by a crash or a full disk leaves part of a record. At the tail it is the bytes after the last whole
 * record. In the middle, where an earlier build appended behind it, its head names a length the bytes after it do not
 * hold, so a walk that trusts the length reads the next records as its payload and loses every one of them. So the walk
 * trusts lengths only while they end exactly at the end of the file, which a file with no torn record always does and is
 * all a read normally costs. Where they do not, it walks again and asks `opens` of each record: one that opens, or is
 * followed by one that opens or by the end, is whole; anything else is torn bytes, and the next record is the first place
 * after them where one starts and opens. The payload's authentication tag is what decides, so the bytes of a torn record
 * are the only ones lost, and they were never a record.
 *
 * @param opens whether a record's payload opens under the data key; asked only of a file with a torn record in it
 */
export function wholeRecords(readAt: ReadAt, size: number, opens: (head: Head) => boolean): WholeRecords {
  const heads: Head[] = [];
  let at = 0;
  for (let head = at + HEAD <= size ? headIn(readAt(at, HEAD), 0, at, size) : null; head !== null; ) {
    heads.push(head);
    at = head.at + head.length;
    head = at + HEAD <= size ? headIn(readAt(at, HEAD), 0, at, size) : null;
  }
  if (at === size) return { heads, end: at };
  return mended(readAt, size, opens);
}

/** {@link wholeRecords} for a file with a torn record in it. */
function mended(readAt: ReadAt, size: number, opens: (head: Head) => boolean): WholeRecords {
  const headAt = (position: number): Head | null => (position + HEAD <= size ? headIn(readAt(position, HEAD), 0, position, size) : null);
  const opensAt = (position: number): boolean => {
    const head = headAt(position);
    return head !== null && opens(head);
  };
  const heads: Head[] = [];
  let at = 0;
  let end = 0;
  while (at < size) {
    const head = headAt(at);
    const after = head === null ? -1 : head.at + head.length;
    // WHOLE: it opens, or it does not (a record this key never sealed) and a whole record or the end follows it.
    if (head !== null && (opens(head) || after === size || opensAt(after))) {
      heads.push(head);
      at = after;
      end = after;
      continue;
    }
    const next = nextRecord(readAt, size, at + 1, opens);
    // NOTHING WHOLE AFTER IT: the torn bytes are the file's tail.
    if (next === -1) break;
    at = next;
  }
  return { heads, end };
}

/** The first place from `from` on where a record starts and opens, read {@link SCAN} bytes at a time; -1 where none does. */
function nextRecord(readAt: ReadAt, size: number, from: number, opens: (head: Head) => boolean): number {
  for (let window = from; window + HEAD <= size; window += SCAN) {
    const bytes = readAt(window, Math.min(SCAN + HEAD - 1, size - window));
    for (let offset = 0; offset < SCAN && window + offset + HEAD <= size; offset += 1) {
      const head = headIn(bytes, offset, window + offset, size);
      if (head !== null && opens(head)) return window + offset;
    }
  }
  return -1;
}

/** {@link wholeRecords} over a file held in memory, a record whole where it opens under `key`. */
export function recordsIn(bytes: Buffer, key: Buffer): WholeRecords {
  return wholeRecords(
    (position, length) => bytes.subarray(position, position + length),
    bytes.length,
    (head) => unseal(key, bytes.subarray(head.at, head.at + head.length)) !== undefined,
  );
}

/** The sections of one file, worked out from its guards and cards (see the store's comment). */
export interface Sections {
  /** Each conversation's section root, and its newest card. */
  readonly conversations: ReadonlyMap<string, { readonly root: string; readonly card: z.infer<typeof cardRecordSchema> }>;
  /** Each section's id (its first GUARD record's id), latest guard and place, by root. */
  readonly sections: ReadonlyMap<string, HistorySection>;
  /** The section root a guard is in, or `undefined` where no record names it. */
  readonly rootOf: (guard: HistoryGuard) => string | undefined;
}

/** The root a conversation with no guard is in until a GUARD adopts it. */
const UNGUARDED = 'unguarded';

export function sectionsOf(heads: readonly Head[], open: (head: Head) => unknown): Sections {
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
  for (const head of heads) {
    if (head.type === GUARD) {
      const value = guardRecordSchema.safeParse(open(head));
      if (!value.success) continue;
      const key = guardKey(value.data.guard);
      add(key);
      if (value.data.previous !== null) union(guardKey(value.data.previous), key);
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

/** What a Delete removes: one conversation by its key, or one section, which the 24-hour check names. */
export type HistoryDrop = { readonly kind: 'conversation'; readonly key: string } | { readonly kind: 'section'; readonly section: string };

/**
 * Which records a Delete drops, by their clear-text id: the dropped conversations' cards and turns, and for a section its
 * guards too. A section is worked out by opening every guard and card, which is the work Decision 7 keeps off the main
 * thread; one conversation is named by its key alone. `null` where the file has nothing to drop.
 */
export interface RemovalPlan {
  readonly conversations: readonly string[];
  readonly guards: readonly string[];
}

export function planRemoval(heads: readonly Head[], open: (head: Head) => unknown, drop: HistoryDrop): RemovalPlan | null {
  if (drop.kind === 'conversation') {
    return heads.some((head) => head.type !== GUARD && head.id === drop.key) ? { conversations: [drop.key], guards: [] } : null;
  }
  const found = sectionsOf(heads, open);
  const root = [...found.sections].find(([, each]) => each.section === drop.section)?.[0];
  if (root === undefined) return null;
  const conversations = [...found.conversations].filter(([, each]) => each.root === root).map(([key]) => key);
  const guards = heads
    .filter((head) => head.type === GUARD)
    .filter((head) => {
      const value = guardRecordSchema.safeParse(open(head));
      return value.success && found.rootOf(value.data.guard) === root;
    })
    .map((head) => head.id);
  return { conversations, guards };
}

/** Whether a record stays under a plan: the predicate the worker filters the file by and `main` filters a later tail by. */
export function keptUnder(plan: RemovalPlan): (head: Head) => boolean {
  const conversations = new Set(plan.conversations);
  const guards = new Set(plan.guards);
  return (head) => !(head.type === GUARD ? guards.has(head.id) : conversations.has(head.id));
}
