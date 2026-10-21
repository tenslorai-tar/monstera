import { freemem, totalmem } from 'node:os';

/**
 * Low memory, noticed and answered by giving back only what nothing is using (the owner's run 4 item 13e).
 *
 * ## The signal is a reading, because there is no event
 *
 * Electron has no memory-pressure event on Windows, so the shell reads the computer's available physical memory every
 * `intervalMs` (`os.freemem()`, which Windows answers from `GlobalMemoryStatusEx`'s available bytes) and calls it low
 * below `belowFraction` of the total. A reading that cannot be taken is no signal: a fault in the reader must never
 * make the application drop things.
 *
 * ## What it gives back, and what it never touches
 *
 * `onLow` is the composition's: it asks each host that holds no document's session to stop where it is idle by its own
 * account (`retireIfIdle`), so a host doing work, or with work queued, is never stopped. The renderer already holds only
 * what is on screen — a layer behind and a card out of view keep no pixels (ADR-0129's correction, item 13c) — so there
 * is no cache left there for a signal to empty. Documents are never touched: unsaved changes, undo history and open
 * editors live in places this does not reach.
 *
 * Asked once per low spell, not on every reading below the line: a host stopped at the first reading has nothing more
 * to give, and the next host to start would be stopped again before it answered.
 */
export interface MemoryPressurePolicy {
  readonly intervalMs: number;
  readonly belowFraction: number;
  /**
   * The largest total, in bytes, of a computer whose person is TOLD memory is low (ADR-0253's correction of 2026-10-21,
   * the owner's R18). Over it the readings are still taken and the idle hosts still stop; only the notice is withheld.
   */
  readonly tellsAtOrUnder: number;
  /** Available and total physical memory in bytes, or `null` where they cannot be read. */
  readonly read: () => { readonly available: number; readonly total: number } | null;
}

/** Whether a computer of this total is told that memory is low: the one place the line is applied. */
export function tellsThePerson(policy: MemoryPressurePolicy, total: number): boolean {
  return total <= policy.tellsAtOrUnder;
}

/**
 * The shell's: a reading every 5 s, low below 10% of physical memory. NOT MEASURED: 10% is a starting line, about
 * 400 MB on the owner's 4 GB low-end machine, and the memory walk is where it is read against the application's own
 * figures.
 *
 * TOLD AT OR UNDER 8 GiB of Windows' own total, the owner's 4 GB and 8 GB computers: `totalmem()` is the usable physical
 * memory, never more than is installed, so an 8 GB computer cannot report over it. Read 2026-10-21 on a 12 GiB
 * development machine: 12,761,452,544 bytes, 11.885 GiB, 123 MiB reserved (ADR-0253's correction of that date).
 */
export const MEMORY_PRESSURE: MemoryPressurePolicy = {
  intervalMs: 5_000,
  belowFraction: 0.1,
  tellsAtOrUnder: 8 * 1024 ** 3,
  read: () => ({ available: freemem(), total: totalmem() }),
};

/** A reading that crossed the line, as it was taken: what `onLow` logs, so a report says how low "low" was. */
export interface LowReading {
  readonly available: number;
  readonly total: number;
}

/**
 * Starts the readings, and answers how to stop them. The timer is unref'd.
 *
 * `onLow` is called once per LOW SPELL — each time a reading falls below the line after one at or above it — and that is
 * the right grain for giving memory back, and the wrong one for telling a person: a computer sitting at the line crosses
 * it again and again (see `composition.ts`, which tells once per run).
 */
export function watchMemoryPressure(
  policy: MemoryPressurePolicy,
  onLow: (reading: LowReading) => Promise<void>,
  failed: (error: unknown) => void,
): () => void {
  let low = false;
  const timer = setInterval(() => {
    const reading = policy.read();
    if (reading === null || reading.total <= 0) return;
    const now = reading.available < reading.total * policy.belowFraction;
    if (now && !low) onLow({ available: reading.available, total: reading.total }).catch(failed);
    low = now;
  }, policy.intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
