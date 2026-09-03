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

/** What the handlers and the shutdown path need. */
export interface RecentFiles {
  /** The list, newest first. */
  list(): readonly RecentEntry[];
  /** Moves a document to the front, or adds it. */
  record(entry: RecentEntry): void;
  /** Drops one, for a file that is no longer there. */
  forget(path: string): void;
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
}

/**
 * How many documents are remembered.
 *
 * Ten is what a menu can show without becoming a file browser, and the list is
 * a convenience rather than a history — a reader looking for a file they opened
 * three weeks ago is looking in the wrong place, and a longer list mostly grows
 * the number of paths this build keeps on disk about a person.
 */
export const MAX_RECENT = 10;

/** The document's file name inside `userData`. */
export const RECENT_FILE = 'recent.json';

/**
 * The recent-files store over a JSON document.
 *
 * @param file the document, from `createJsonFile`. Injected rather than opened
 *   here for `SettingsSurface`'s reason: the directory is Electron's question
 *   and this module answers a different one.
 */
export function createRecentFiles(file: SettingsSurface): RecentFiles {
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
  let entries = readEntries(stored['entries']);

  const persist = (cleanExit: boolean): void => {
    file.write({ entries: [...entries], cleanExit });
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
      entries = [entry, ...entries.filter((held) => held.path !== entry.path)].slice(0, MAX_RECENT);
      persist(false);
    },
    forget: (path) => {
      entries = entries.filter((held) => held.path !== path);
      persist(false);
    },
    lastExitClean: () => wasClean,
    markCleanExit: () => {
      persist(true);
    },
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
function readEntries(value: unknown): readonly RecentEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: RecentEntry[] = [];
  for (const row of value) {
    if (typeof row !== 'object' || row === null) continue;
    const { path, name } = row as { path?: unknown; name?: unknown };
    if (typeof path !== 'string' || typeof name !== 'string') continue;
    if (path === '' || name === '') continue;
    entries.push({ path, name });
  }
  return entries.slice(0, MAX_RECENT);
}
