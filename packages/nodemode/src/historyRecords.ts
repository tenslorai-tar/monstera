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

/** Every whole record's head in `bytes`, in order; a torn tail ends the list. */
export function headsOf(bytes: Buffer): Head[] {
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
