import { z } from 'zod';

import type { HistoryGuard, HistoryStore } from './historyStore.js';

/**
 * The 24-hour check (ADR-0279's *The owner's answers*, Decision 6, and its correction of 2026-11-12): a section of a
 * history file whose PDF cannot be found at its place, or is a different PDF there now, is removed 24 hours after the
 * first check that finds it so. A PDF back at its place with the same guard before then starts the clock again.
 *
 * ## Only while the person is not working
 *
 * Each {@link HistoryCheck.step} checks one batch of {@link BATCH} sections, and only when `idle` says the person has
 * not touched the computer for {@link IDLE_SECONDS} and no document is opening; a pass over every section is made at
 * most once a {@link DAY_MS}. So it never slows an open: the caller asks for a step when idle, and the step refuses
 * when it is not.
 *
 * ## A PDF is PARSED only when its size or write time moved
 *
 * A guard by `/ID` is read by the contained host (`permanentIdOf`, invariant 25), which is a parse, so the ledger keeps
 * the size and write time the check last found the PDF at with that id, and a PDF still at those is the same one
 * without being opened. A guard by size and write time needs no parse at all: those two are the guard.
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

/** What the check last knew of the PDF at a section's place. */
const stampSchema = z.object({ size: z.number().nonnegative(), mtimeMs: z.number() }).strict();

const ledgerSchema = z
  .object({
    /** When the last whole pass ended, `null` before the first. */
    lastPass: z.number().nullable(),
    /** By `placeKey/section`: the size and time the PDF was last found at with its guard, and since when it is missing. */
    sections: z.record(
      z.string(),
      z.object({ seen: stampSchema.nullable(), missingSince: z.number().nullable() }).strict(),
    ),
  })
  .strict();
type Ledger = z.infer<typeof ledgerSchema>;

export interface HistoryCheckDependencies {
  readonly store: Pick<HistoryStore, 'files' | 'guards' | 'removeSection' | 'ledger' | 'keepLedger'>;
  /** The PDF at `path`'s size and write time, or `null` where it cannot be found or read (an unplugged drive too). */
  readonly stat: (path: string) => Promise<{ readonly size: number; readonly mtimeMs: number } | null>;
  /** The PDF at `path`'s first `/ID` string as hex, `null` where it has none, `undefined` where the host could not read it. */
  readonly permanentIdOf: (path: string) => Promise<string | null | undefined>;
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
  let queue: { readonly placeKey: string; readonly section: string; readonly place: string; readonly guard: HistoryGuard }[] | undefined;

  const ledgerOf = (): Ledger => {
    const kept = ledgerSchema.safeParse(deps.store.ledger());
    return kept.success ? kept.data : { lastPass: null, sections: {} };
  };

  /** Whether the PDF at `place` is the one `guard` names, updating what the ledger has seen of it. */
  const present = async (place: string, guard: HistoryGuard, entry: Ledger['sections'][string]): Promise<boolean> => {
    const found = await deps.stat(place);
    if (found === null) return false;
    if (guard.kind === 'stamp') return found.size === guard.size && found.mtimeMs === guard.mtimeMs;
    if (entry.seen !== null && entry.seen.size === found.size && entry.seen.mtimeMs === found.mtimeMs) return true;
    // MOVED SINCE IT WAS LAST SEEN WITH ITS ID, or never seen: the one case that parses.
    const id = await deps.permanentIdOf(place);
    if (id !== guard.id) return false;
    entry.seen = { size: found.size, mtimeMs: found.mtimeMs };
    return true;
  };

  return {
    async step() {
      if (!deps.idle()) return 'busy';
      const ledger = ledgerOf();
      if (queue === undefined) {
        if (ledger.lastPass !== null && deps.now() - ledger.lastPass < DAY_MS) return 'not-due';
        queue = deps.store.files().flatMap((placeKey) => deps.store.guards(placeKey).map((each) => ({ placeKey, ...each })));
        // A SECTION NO LONGER IN ANY FILE leaves the ledger with this pass: it names a place, and keeps nothing it needs.
        const live = new Set(queue.map((each) => `${each.placeKey}/${each.section}`));
        for (const name of Object.keys(ledger.sections)) if (!live.has(name)) Reflect.deleteProperty(ledger.sections, name);
      }
      for (const { placeKey, section, place, guard } of queue.splice(0, BATCH)) {
        const name = `${placeKey}/${section}`;
        const entry = ledger.sections[name] ?? { seen: null, missingSince: null };
        if (await present(place, guard, entry)) {
          // BACK, OR NEVER GONE: the clock starts again.
          ledger.sections[name] = { seen: entry.seen, missingSince: null };
          continue;
        }
        const since = entry.missingSince ?? deps.now();
        if (deps.now() - since >= GRACE_MS) {
          await deps.store.removeSection(placeKey, section);
          Reflect.deleteProperty(ledger.sections, name);
        } else {
          ledger.sections[name] = { seen: entry.seen, missingSince: since };
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
