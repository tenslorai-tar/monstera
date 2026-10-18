/**
 * A window with no document gives its renderer's memory back
 * ([ADR-0252](../../../docs/DECISIONS/0252-a-closed-and-idle-window-gives-its-renderer-back.md)).
 *
 * Two moments. At the LAST CLOSE the renderer is sent Chromium's memory-pressure signal, which gave back the GPU
 * process's share when measured (29 MB of 161). After a MINUTE IDLE the renderer asks `app.releaseMemory`, and this
 * decides: a NEW RENDERER PROCESS for the window only with no document open in `main` — the writer of record for that
 * fact — and one opened since the window last loaded. Never a reload in the old process, which kept what the old page
 * held: 469 MB against 361 with a new process after a long session (ADR-0252's correction of 2026-10-18).
 *
 * Kept free of Electron: the window is a surface `entry.ts` supplies, so the decision is a case with no window.
 */

/**
 * How long a renewal waits for the old renderer process to exit before it loads the page again: a bound on one that does
 * not, chosen rather than measured, never the time one takes. A page loaded before the old process has gone may land
 * back in it, which the memory walk's M5 reads as an unchanged process id.
 */
export const RENDERER_EXIT_MS = 5000;

/** What this needs of the window, which only `entry.ts` can reach. */
export interface RendererWindow {
  /** Sends the renderer Chromium's critical memory-pressure signal. Rejects where it cannot be sent. */
  readonly pressure: () => Promise<void>;
  /** Loads the window's page again in a NEW renderer process. Rejects where the window could not be renewed. */
  readonly renew: () => Promise<void>;
}

/** What it reads of `main`'s documents. */
export interface HeldDocuments {
  readonly size: number;
  readonly openedSoFar: number;
}

/** `app.releaseMemory`'s answer. */
export type ReleaseAnswer = 'released' | 'documents-open' | 'nothing-to-release';

export interface MemoryRelease {
  /** The last document has closed: send the signal. A signal that cannot be sent is told to `failed`, never thrown. */
  readonly lastClosed: () => void;
  /** The renderer, idle for a minute, asks: reload where nothing is open and something was since the last load. */
  readonly release: () => ReleaseAnswer;
}

/** A shell with no window to give back: every ask answers `nothing-to-release`. What a case with no window takes. */
export const NO_MEMORY_RELEASE: Pick<MemoryRelease, 'release'> = { release: () => 'nothing-to-release' };

/**
 * The decision, over `main`'s documents and the window.
 *
 * @param window `null` where there is none, which answers `nothing-to-release` and sends nothing.
 * @param later runs the renewal after the answer has gone back, so the renderer that asked is told before it is replaced.
 */
export function createMemoryRelease(
  documents: HeldDocuments,
  window: RendererWindow | null,
  failed: (detail: string) => void,
  later: (run: () => void) => void,
): MemoryRelease {
  // THE COUNT OF OPENS THE WINDOW HAS LOADED SINCE: none at the start, since the first page has held nothing.
  let loadedAt = 0;
  return {
    lastClosed: () => {
      if (window === null) return;
      window.pressure().catch((error: unknown) => {
        failed(`the memory-pressure signal was not sent: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    release: () => {
      if (documents.size > 0) return 'documents-open';
      if (window === null || documents.openedSoFar === loadedAt) return 'nothing-to-release';
      loadedAt = documents.openedSoFar;
      later(() => {
        window.renew().catch((error: unknown) => {
          failed(`the window was not given a new renderer: ${error instanceof Error ? error.message : String(error)}`);
        });
      });
      return 'released';
    },
  };
}
