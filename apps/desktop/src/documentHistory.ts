import type { SavedTurn } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import type { HistoryCard, HistoryGuard, HistoryStore } from './historyStore.js';

/**
 * ADR-0279's store as the contract asks it, by `DocId`
 * ([ADR-0279](../../../docs/DECISIONS/0279-saved-conversations-are-kept-without-caps-each-in-its-own-file-and-history-reads-one-log.md)).
 *
 * The store names a PDF by its place's digest and recognises it by a guard; the renderer names a document by `DocId` and
 * holds neither. This is where the two meet, so neither a handler nor the store learns the other's names.
 *
 * ## The guard is worked out once, at the open
 *
 * When a PDF opens, its guard is its first `/ID` string, read by the contained host (`permanentIdOf`, a parse, so never
 * in `main`), or where it has none its size and write time (Decision 5). It is held for the document's life, written to
 * its file where one exists (`recordGuard`), and carried by every save. A save or a list that arrives while the open's
 * read is still running waits for it rather than guessing.
 *
 * ## Monstera's own save re-links
 *
 * A save in place writes new bytes at the same place. A PDF with an `/ID` keeps its first string, so its guard is the
 * same; one without has a new size and write time, so `saved` records the new guard as continuing the old one, and the
 * section and its conversations go on.
 */
export interface DocumentHistory {
  available(): boolean;
  locked(): boolean;
  /** At a PDF's open: `ready` settles once its sessions exist, after which its `/ID` can be read. */
  opened(docId: DocId, place: string, ready: Promise<unknown>): void;
  /** After Monstera saved the document in place. */
  saved(docId: DocId): Promise<void>;
  /** At its close: the guard is dropped. */
  closed(docId: DocId): void;
  /** `undefined` where the document is not open, or its guard could not be worked out. */
  save(
    docId: DocId,
    conversation: string | null,
    turns: readonly SavedTurn[],
    name: string | null,
    savedAt: Date,
  ): Promise<{ readonly conversation: string | null } | undefined>;
  list(docId: DocId): Promise<readonly HistoryCard[] | undefined>;
  read(docId: DocId, conversation: string): Promise<{ readonly savedAt: string | null; readonly turns: readonly SavedTurn[] } | null | undefined>;
  remove(docId: DocId, conversation: string): Promise<boolean | undefined>;
  clearFile(docId: DocId): Promise<boolean>;
  clearAll(): number;
  /** The note that chat history is on, claimed once on this computer (`HistoryStore.claimNote`). */
  claimNote(): boolean;
}

export interface DocumentHistoryDependencies {
  readonly store: HistoryStore;
  /** The digest of the document's place (`DocumentService.historyKeyOf`), `undefined` where it is not open. */
  readonly placeKeyOf: (docId: DocId) => string | undefined;
  /** The open document's first `/ID` string as hex, `null` where it has none; it throws where the host could not read it. */
  readonly permanentIdOf: (docId: DocId) => Promise<string | null>;
  /** The size and write time of the file at `place`, `null` where it cannot be read. */
  readonly stat: (place: string) => { readonly size: number; readonly mtimeMs: number } | null;
}

interface Held {
  readonly placeKey: string;
  readonly place: string;
  readonly guard: HistoryGuard;
}

export function createDocumentHistory(deps: DocumentHistoryDependencies): DocumentHistory {
  const held = new Map<DocId, Promise<Held>>();

  /** The guard of the bytes at `place` now: the `/ID` where there is one, else the stamp. */
  /**
   * The guard of the bytes at `place` now: the `/ID` where there is one, else the stamp. A read the host could not answer
   * THROWS rather than falling back to the stamp: a PDF with an `/ID` guarded by its stamp for one session would start a
   * second section beside its own, and its conversations would be split between them.
   */
  const guardOf = async (docId: DocId, place: string): Promise<HistoryGuard> => {
    const id = await deps.permanentIdOf(docId);
    if (id !== null) return { kind: 'id', id };
    const stamp = deps.stat(place);
    if (stamp === null) throw new Error('the PDF has no /ID and its size and write time could not be read, so it has no guard');
    return { kind: 'stamp', size: stamp.size, mtimeMs: stamp.mtimeMs };
  };

  /** The held place and guard; `undefined` where the document is not open here, and it throws where the guard failed. */
  const heldFor = async (docId: DocId): Promise<Held | undefined> => held.get(docId);

  return {
    available: () => deps.store.available(),
    locked: () => deps.store.locked(),

    opened(docId, place, ready) {
      const placeKey = deps.placeKeyOf(docId);
      if (placeKey === undefined) return;
      const working = ready
        .then(() => guardOf(docId, place))
        .then((guard) => {
          deps.store.recordGuard(placeKey, place, guard);
          return { placeKey, place, guard };
        });
      // A FAILED GUARD IS KEPT AS A FAILURE for the save or list that awaits it, which reports it; this handler only stops
      // the rejection being reported unhandled while nothing has asked yet.
      void working.catch(() => undefined);
      held.set(docId, working);
    },

    async saved(docId) {
      const before = held.get(docId);
      if (before === undefined) return;
      // NEVER THROWS INTO THE DOCUMENT'S SAVE, which succeeded: a guard that cannot be read is held as the failure, and
      // the next history call that needs it reports it, which is the call it is a fact about.
      const after = before.then(async (was) => {
        const next = await guardOf(docId, was.place);
        deps.store.relink(was.placeKey, was.place, was.guard, next);
        return { ...was, guard: next };
      });
      void after.catch(() => undefined);
      held.set(docId, after);
      await after.then(
        () => undefined,
        () => undefined,
      );
    },

    closed(docId) {
      held.delete(docId);
    },

    async save(docId, conversation, turns, name, savedAt) {
      const at = await heldFor(docId);
      if (at === undefined) return undefined;
      return deps.store.save(at.placeKey, at.place, at.guard, conversation, turns, name, savedAt);
    },

    async list(docId) {
      const at = await heldFor(docId);
      return at === undefined ? undefined : deps.store.list(at.placeKey, at.guard);
    },

    async read(docId, conversation) {
      const at = await heldFor(docId);
      if (at === undefined) return undefined;
      // ONLY A CONVERSATION OF THIS PDF'S SECTION is read: a key from another section at the same place names a
      // different document's conversation, which this one must not see (the correction of 2026-11-12).
      if (!deps.store.list(at.placeKey, at.guard).some((card) => card.key === conversation)) return null;
      return deps.store.read(at.placeKey, conversation);
    },

    async remove(docId, conversation) {
      const at = await heldFor(docId);
      if (at === undefined) return undefined;
      if (!deps.store.list(at.placeKey, at.guard).some((card) => card.key === conversation)) return false;
      return deps.store.remove(at.placeKey, conversation);
    },

    async clearFile(docId) {
      const at = await heldFor(docId);
      if (at === undefined) return false;
      deps.store.clearFile(at.placeKey);
      return true;
    },

    clearAll: () => deps.store.clearAll(),
    claimNote: () => deps.store.claimNote(),
  };
}

/** A machine composed with no store: nothing is listed, and a save throws rather than pretending. */
export function noDocumentHistory(): DocumentHistory {
  return {
    available: () => false,
    locked: () => false,
    opened: () => undefined,
    saved: () => Promise.resolve(),
    closed: () => undefined,
    save: () => Promise.reject(new Error('no chat history store was composed, so nothing was saved')),
    list: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
    remove: () => Promise.resolve(false),
    clearFile: () => Promise.resolve(true),
    clearAll: () => 0,
    // NEVER CLAIMED: with no store nothing is kept, so a note saying it is would be untrue. `available` is false too.
    claimNote: () => false,
  };
}
