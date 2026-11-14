import { dirname } from 'node:path';

import { z } from 'zod';

import type { HistoryStore } from './historyStore.js';

/**
 * The 24-hour check (ADR-0279 Decision 6, as the owner corrected it on 2026-11-14): **only a PDF that is really gone
 * loses its history.** A section is removed 24 hours after the first check that finds its file not there in a folder
 * that is; a file back at its place before then starts the clock again.
 *
 * ## Gone, found, or could not look
 *
 * {@link placeOf} is the one rule. *Gone* is a file the system says is not found, in a folder it says is there.
 * *Found* is any file at the place, whichever PDF it is and whether or not it would open: a share lock, a password or a
 * different PDF says nothing about the history's PDF being gone (a different PDF does not see the old section, since
 * History shows only the one whose guard matches; the old section is kept unshown). *Unreachable* is everything else, a
 * drive or share that is not there, a folder missing as a whole, any refusal of the file's own `stat`: nothing was
 * learnt, so that pass decides nothing and the clock neither starts nor stops. So the check opens no PDF and never
 * reaches the engine host.
 *
 * ## Only while the person is not working
 *
 * Each {@link HistoryCheck.step} checks one batch of {@link BATCH} sections, and only when `idle` says the person has
 * not touched the computer for {@link IDLE_SECONDS} and no document is opening; a pass over every section is made at
 * most once a {@link DAY_MS}. So it never slows an open: the caller asks for a step when idle, and the step refuses
 * when it is not.
 *
 * ## A section with no guard is not checked
 *
 * History moved from 1.1.2610.0 kept no place, so it has none to look at until its PDF is opened and the open's guard
 * adopts it (the owner's answer, 2026-11-12). `guards` lists only guarded sections, so this cannot reach one.
 */

/** How long a section's PDF may be missing before the section is removed: 24 hours, the owner's figure. */
export const GRACE_MS = 24 * 60 * 60 * 1000;
/** How often a whole pass is made, at most. */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** How many sections one step checks. */
export const BATCH = 50;
/** How long the person must have left the computer alone for a step to run. */
export const IDLE_SECONDS = 30;

/**
 * The ledger: when the last whole pass ended, and since when each section's file is gone. A ledger kept before
 * 2026-11-14 also carried what each PDF was last seen at, and fails this schema: it is read as empty, which starts
 * every clock again, the direction that keeps history.
 */
const ledgerSchema = z
  .object({
    /** When the last whole pass ended, `null` before the first. */
    lastPass: z.number().nullable(),
    /** By `placeKey/section`: since when its file is gone, `null` while it is there. */
    sections: z.record(z.string(), z.object({ missingSince: z.number().nullable() }).strict()),
  })
  .strict();
type Ledger = z.infer<typeof ledgerSchema>;

/** What a section's place says of its file: there, really gone, or nothing that can be learnt this pass. */
export type PdfPlace = 'found' | 'gone' | 'unreachable';

/** A file system's `stat`, the one call {@link placeOf} makes: it answers, or throws with Node's `code`. */
export type StatCall = (path: string) => Promise<{ isDirectory(): boolean }>;

/**
 * THE ONE RULE for whether a history's PDF is gone (the owner, 2026-11-14). The file answering is *found*, whatever it
 * is. Not found (ENOENT) in a folder that answers as a folder is *gone*. Anything else is *unreachable*: a folder,
 * drive or share that is not there, a path through a file (ENOTDIR), a refusal (EBUSY, EPERM, EACCES), any error a
 * future system gives: the folder must be SEEN to be there for an absence to count.
 */
export async function placeOf(path: string, stat: StatCall): Promise<PdfPlace> {
  try {
    await stat(path);
    return 'found';
  } catch (thrown) {
    if ((thrown as NodeJS.ErrnoException | null)?.code !== 'ENOENT') return 'unreachable';
  }
  try {
    return (await stat(dirname(path))).isDirectory() ? 'gone' : 'unreachable';
  } catch {
    // THE FOLDER COULD NOT BE SEEN, which is the unplugged drive's answer and the offline share's: nothing learnt.
    return 'unreachable';
  }
}

export interface HistoryCheckDependencies {
  readonly store: Pick<HistoryStore, 'files' | 'guards' | 'removeSection' | 'ledger' | 'keepLedger'>;
  /** What the section's place says of its file, by {@link placeOf}. */
  readonly place: (path: string) => Promise<PdfPlace>;
  /** No input for {@link IDLE_SECONDS} and no document opening. */
  readonly idle: () => boolean;
  readonly now: () => number;
}

/** What one step did. */
export type HistoryStep = 'busy' | 'not-due' | 'checked' | 'done';

export interface HistoryCheck {
  /** Checks one batch where the person is idle and a pass is due or under way. */
  step(): Promise<HistoryStep>;
}

export function createHistoryCheck(deps: HistoryCheckDependencies): HistoryCheck {
  /** The sections this pass has still to check, `undefined` between passes. */
  let queue: { readonly placeKey: string; readonly section: string; readonly place: string }[] | undefined;

  const ledgerOf = (): Ledger => {
    const kept = ledgerSchema.safeParse(deps.store.ledger());
    return kept.success ? kept.data : { lastPass: null, sections: {} };
  };

  return {
    async step() {
      if (!deps.idle()) return 'busy';
      const ledger = ledgerOf();
      if (queue === undefined) {
        if (ledger.lastPass !== null && deps.now() - ledger.lastPass < DAY_MS) return 'not-due';
        queue = deps.store
          .files()
          .flatMap((placeKey) => deps.store.guards(placeKey).map(({ section, place }) => ({ placeKey, section, place })));
        // A SECTION NO LONGER IN ANY FILE leaves the ledger with this pass: it names a place, and keeps nothing it needs.
        const live = new Set(queue.map((each) => `${each.placeKey}/${each.section}`));
        for (const name of Object.keys(ledger.sections)) if (!live.has(name)) Reflect.deleteProperty(ledger.sections, name);
      }
      for (const { placeKey, section, place } of queue.splice(0, BATCH)) {
        const name = `${placeKey}/${section}`;
        const found = await deps.place(place);
        // THE CLOCK NEITHER STARTS NOR STOPS: the ledger keeps what it knew, and the next pass looks again.
        if (found === 'unreachable') continue;
        if (found === 'found') {
          // BACK, OR NEVER GONE: the clock starts again.
          ledger.sections[name] = { missingSince: null };
          continue;
        }
        const since = ledger.sections[name]?.missingSince ?? deps.now();
        if (deps.now() - since >= GRACE_MS) {
          await deps.store.removeSection(placeKey, section);
          Reflect.deleteProperty(ledger.sections, name);
        } else {
          ledger.sections[name] = { missingSince: since };
        }
      }
      const finished = queue.length === 0;
      if (finished) {
        queue = undefined;
        ledger.lastPass = deps.now();
      }
      deps.store.keepLedger(ledger);
      return finished ? 'done' : 'checked';
    },
  };
}

/** How often the driver asks whether a step can run: each ask is one idle read and, most days, `not-due`. */
export const ASK_EVERY_MS = 60_000;

/**
 * Asks the check for steps every {@link ASK_EVERY_MS}, one batch after another while the person stays idle, and never two
 * at once. A step that throws is said through `failed` and the next ask tries again. Answers the stop, which shutdown calls.
 */
export function driveHistoryCheck(
  check: HistoryCheck,
  failed: (cause: unknown) => void,
  every: number = ASK_EVERY_MS,
): () => void {
  let running = false;
  const ask = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (let step = await check.step(); step === 'checked'; step = await check.step()) {
        // each batch, until the pass ends, is due later, or the person comes back
      }
    } catch (cause) {
      failed(cause);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void ask();
  }, every);
  // NOT A REASON TO STAY ALIVE: a quit is never held for a check that can run tomorrow.
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
