import { MAX_RECENT_ENTRIES, MAX_SESSION_ENTRIES, annotationInstantSchema } from '@monstera/contract';
import type { DocId } from '@monstera/shared';

import type { SettingsSurface } from './settingsFile.js';

/**
 * The documents this user opened recently, and whether the last run ended
 * cleanly.
 *
 * ## Both, in one place, because the second is only useful with the first
 *
 * The crash-recovery offer's own row says its trigger is *recent files plus a
 * clean-exit marker*: a marker saying the last run died tells nobody what to do
 * about it, and a list of files says nothing about whether to offer one. So the
 * two live in the same document and are read together.
 *
 * ## PATHS LIVE HERE AND CROSS NOTHING
 *
 * A recent-files list is a list of paths, and the renderer holds none
 * (invariant L2). What crosses is a `FileHandle` per entry — a capability the
 * renderer may name and cannot read — plus the file's name for the label. The
 * registry mints idempotently per path, so the handle for a recent file is the
 * same handle that document would have when opened.
 *
 * That is also why this is not a setting. `settings.load` hands the renderer
 * everything the file holds, so a path stored there would be a path in the
 * renderer, with no code anywhere deciding to send it.
 *
 * ## The clean-exit marker is written TWICE per run, and the order matters
 *
 * On start it is cleared, and on a completed shutdown it is set. A process that
 * dies in between leaves it cleared, which is exactly what *the last run did not
 * finish* means. Setting it on start and clearing it on crash is the shape that
 * cannot work: nothing runs during a crash.
 */

/** One document this user opened, newest first. */
export interface RecentEntry {
  /** The absolute path. **Never leaves main.** */
  readonly path: string;
  /** The file's name, for a label — `basename`, as `document.open` sends. */
  readonly name: string;
}

/**
 * An entry as the list holds it: the document, and WHEN it was last opened here
 * ([ADR-0100](../../../docs/DECISIONS/0100-a-recent-file-shows-where-it-is-and-a-preview-both-from-main.md)'s
 * correction). `null` for an entry a build before 2026-09-25 recorded, which kept no time — shown with no
 * date rather than given one it never had.
 */
export interface ListedRecent extends RecentEntry {
  readonly openedAt: string | null;
}

/** What the handlers and the shutdown path need. */
export interface RecentFiles {
  /** The list, newest first. */
  list(): readonly ListedRecent[];
  /** Moves a document to the front, or adds it, stamped with the time it was opened. */
  record(entry: RecentEntry): void;
  /**
   * Empties the list, answering how many entries went (ADR-0100's *Clear list*).
   *
   * **There is no way to drop one entry.** A file that has gone stays listed and is shown as unavailable
   * ([ADR-0143](../../../docs/DECISIONS/0143-file-recent-is-the-menu-rows-own-value-control-and-main-keeps-ten.md)):
   * forgetting it lost a file on a drive that was only disconnected. An entry leaves by this, or past the cap.
   */
  clear(): number;
  /** Whether a path is on the list now. */
  has(path: string): boolean;
  /**
   * Names who is told the paths of entries that LEFT the list — cleared, or pushed past the cap —
   * so what is kept about an entry leaves with it (ADR-0100: a picture never outlives its entry). This store
   * is the one place that knows every way an entry leaves, so it is the one that says so. One listener: the
   * composition root registers the pictures' `drop` as it builds them, before any handler can run.
   */
  onDropped(listener: (paths: readonly string[]) => void): void;
  /**
   * Whether the previous run reached its shutdown.
   *
   * Read from the document as it was on start, **not** live: this run clears
   * the marker immediately, so a live read would answer *false* about itself
   * for the whole session.
   */
  lastExitClean(): boolean;
  /** Records that this run finished. Called by the shutdown path. */
  markCleanExit(): void;

  /**
   * Records that this document is open NOW, for the next run's offer.
   *
   * ## Why the session is recorded rather than inferred
   *
   * `docs/FEATURES.md`'s crash-recovery row said it: *"With one document open
   * at a time the newest recent entry IS what was open, so the offer names
   * it — and that correspondence expires with multi-document tabs, when this
   * must become a recorded session rather than an inference."* Tabs landed and
   * the correspondence went with them. A reader with three documents open who
   * loses the application is offered the last file they touched and told
   * nothing about the other two.
   *
   * Keyed by `DocId` so {@link closed} needs only what a close carries. The
   * VALUE is the path and name, because a `DocId` is minted per run and means
   * nothing to the run that reads this.
   */
  opened(docId: DocId, entry: RecentEntry): void;

  /** Records that a document is no longer open. */
  closed(docId: DocId): void;

  /**
   * What was open when the PREVIOUS run ended, newest LAST — the order the
   * documents were opened in, which is the order their tabs stood in.
   *
   * **Kept after a clean exit too, since 2026-09-28**: it is what
   * `viewing.restore-session` reopens. Whether it is an OFFER to recover is
   * `lastExitClean`'s to say, and a clean exit makes that true.
   */
  lastSession(): readonly RecentEntry[];
}

/** The document's file name inside `userData`. */
export const RECENT_FILE = 'recent.json';

/**
 * The recent-files store over a JSON document.
 *
 * @param file the document, from `createJsonFile`. Injected rather than opened
 *   here for `SettingsSurface`'s reason: the directory is Electron's question
 *   and this module answers a different one.
 * The list holds at most `MAX_RECENT_ENTRIES` — ten, the owner's number — and nothing older is kept anywhere.
 *
 * @param now the clock an opening is stamped from, injected so a case can assert the instant recorded
 */
export function createRecentFiles(file: SettingsSurface, now: () => Date = () => new Date()): RecentFiles {
  /** Who is told when entries leave; see {@link RecentFiles.onDropped}. */
  let dropped: ((paths: readonly string[]) => void) | undefined;
  /**
   * Paths that left before anybody was listening: a stored list longer than ten — written by a build that kept up to
   * thirty — is cut as this store opens, which is before the composition root registers the pictures' `drop`. Held
   * here and handed over at registration, so a picture never outlives its entry for want of a listener at the moment
   * the entry went.
   */
  let unannounced: string[] = [];
  const announce = (paths: readonly string[]): void => {
    if (paths.length === 0) return;
    if (dropped === undefined) unannounced = [...unannounced, ...paths];
    else dropped(paths);
  };
  const stored = file.read();
  // READ ONCE, at construction, and the marker is answered from THIS copy for
  // the rest of the run. The first thing below is a write that clears it.
  //
  // `!== false`, NOT `=== true`, and the difference is the first launch. A
  // missing document and a document holding `cleanExit: false` both fail
  // `=== true`, so that spelling reports *the last run crashed* to a user who
  // has never run this application — an offer to recover from a crash that
  // never happened, on an empty list. Only an explicit `false` — which this
  // build writes on start and clears on shutdown — means a run that did not
  // finish.
  const wasClean = stored['cleanExit'] !== false;
  // THE STORED LIST, CUT TO THE CAP NOW — not when it is next read — so the document written below already holds only
  // what is kept, and what was past the cap leaves with its pictures (`announce`).
  const read = readEntries(stored['entries']);
  let entries = read.slice(0, MAX_RECENT_ENTRIES);
  announce(read.slice(MAX_RECENT_ENTRIES).map((held) => held.path));
  // READ BEFORE THE CLEARING WRITE BELOW, for `wasClean`'s reason: what was
  // open belongs to the previous run, and the first thing this constructor
  // does is start recording this one.
  const previousSession = readEntries(stored['session']).slice(0, MAX_SESSION_ENTRIES);

  /**
   * The documents open right now, by the id this run minted for each.
   *
   * A `Map` rather than a list, because {@link RecentFiles.closed} carries only
   * a `DocId` — and insertion order is what makes the recorded session read
   * newest-last, which is the order the tabs are in.
   */
  const live = new Map<DocId, RecentEntry>();

  const persist = (cleanExit: boolean): void => {
    file.write({
      entries: [...entries],
      cleanExit,
      // BOUNDED BY THE SESSION'S OWN NUMBER, not the recent cap. It was the recent length until 2026-10-01, and at
      // four that would reopen four of a reader's six tabs after a crash and say nothing of the other two.
      session: [...live.values()].slice(0, MAX_SESSION_ENTRIES),
    });
  };

  // CLEARED IMMEDIATELY. From here until `markCleanExit`, the document on disk
  // says this run did not finish — which is true of every moment except the one
  // after a completed shutdown.
  persist(false);

  return {
    list: () => entries,
    record: (entry) => {
      // DEDUPED BY PATH AND MOVED TO THE FRONT. Reopening the same file twice
      // must not fill the list with one document, and an entry whose name has
      // changed — the file was renamed and reopened by its new name — takes the
      // newer one.
      const ordered = [
        { path: entry.path, name: entry.name, openedAt: now().toISOString() },
        ...entries.filter((held) => held.path !== entry.path),
      ];
      entries = ordered.slice(0, MAX_RECENT_ENTRIES);
      persist(false);
      // PUSHED PAST THE CAP is leaving too, and the quietest way to: nobody asked for it.
      announce(ordered.slice(MAX_RECENT_ENTRIES).map((held) => held.path));
    },
    clear: () => {
      const gone = entries.map((held) => held.path);
      entries = [];
      persist(false);
      announce(gone);
      return gone.length;
    },
    has: (path) => entries.some((held) => held.path === path),
    onDropped: (listener) => {
      dropped = listener;
      const waiting = unannounced;
      unannounced = [];
      if (waiting.length > 0) listener(waiting);
    },
    lastExitClean: () => wasClean,
    markCleanExit: () => {
      // THE SESSION IS KEPT, and that is `viewing.restore-session`'s whole input: what was open at a clean close is
      // what a reader asked to have reopened. `composition.ts`' shutdown closes every document through the service
      // rather than through this surface, so the live map still holds them here. It cannot become an offer to
      // recover a run that finished: the offer is gated on `cleanExit` being false, which this write makes true.
      persist(true);
    },
    opened: (docId, entry) => {
      live.set(docId, entry);
      persist(false);
    },
    closed: (docId) => {
      if (!live.delete(docId)) return;
      persist(false);
    },
    lastSession: () => previousSession,
  };
}

/**
 * The stored entries, or none.
 *
 * Every malformed shape means *nothing remembered*, for the settings file's
 * reason: the user did not write this document and there is nothing they could
 * do about it. Entries are filtered individually rather than the list being
 * rejected whole, so one corrupt row does not cost the other nine.
 */
function readEntries(value: unknown): readonly ListedRecent[] {
  if (!Array.isArray(value)) return [];
  const entries: ListedRecent[] = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue;
    const { path, name, openedAt } = row as { path?: unknown; name?: unknown; openedAt?: unknown };
    if (typeof path !== 'string' || typeof name !== 'string') continue;
    if (path === '' || name === '') continue;
    // THE CHANNEL'S OWN RULE for an instant, so a time this file holds is one `document.recent` can carry; an
    // absent or unreadable one is no time at all, and costs the entry nothing else.
    const instant = annotationInstantSchema.safeParse(openedAt);
    entries.push({ path, name, openedAt: instant.success ? instant.data : null });
  }
  // EVERY READABLE ROW, uncut: the store cuts to the cap itself, so the rows past the cap are known and leave with their
  // pictures rather than vanishing here unannounced.
  return entries;
}
