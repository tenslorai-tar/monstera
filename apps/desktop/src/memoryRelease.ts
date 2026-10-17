/**
 * A window with no document gives its renderer's memory back
 * ([ADR-0252](../../../docs/DECISIONS/0252-a-closed-and-idle-window-gives-its-renderer-back.md)).
 *
 * Two moments. At the LAST CLOSE the renderer is sent Chromium's memory-pressure signal, which gave back the GPU
 * process's share when measured (29 MB of 161). After a MINUTE IDLE the renderer asks `app.releaseMemory`, and this
 * decides: a reload only with no document open in `main` — the writer of record for that fact — and one opened since
 * the window last loaded, which the measurement showed takes the renderer back to within 8 MB of its start.
 *
 * Kept free of Electron: the window is a surface `entry.ts` supplies, so the decision is a case with no window.
 */

/** What this needs of the window, which only `entry.ts` can reach. */
export interface RendererWindow {
  /** Sends the renderer Chromium's critical memory-pressure signal. Rejects where it cannot be sent. */
  readonly pressure: () => Promise<void>;
  /** Reloads the window's page. */
  readonly reload: () => void;
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
 * @param later runs the reload after the answer has gone back, so the renderer that asked is told before it is replaced.
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
        window.reload();
      });
      return 'released';
    },
  };
}
