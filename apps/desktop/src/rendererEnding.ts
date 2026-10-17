import { MEMORY_PRESSURE, type MemoryPressurePolicy } from './memoryPressure.js';

/**
 * Why the window's last renderer ended, kept for the renderer that replaces it
 * ([ADR-0253](../../../docs/DECISIONS/0253-a-failure-is-called-out-of-memory-only-when-that-is-proven.md)).
 *
 * `main` reloads the window when its renderer ends, so the person gets their window back and the documents `main` holds
 * with it. The new renderer asks once, through `app.rendererEnded`, what to tell them:
 *
 * - `oom`, Chromium's own reason, is memory running out, proven: the computer's figures are read as it ends, and other
 *   programs are named only where memory was short, the rule `outOfMemory.ts` holds for a host;
 * - any other reason is a defect, so the answer throws {@link RendererEnded} and the boundary records it in the one
 *   incident log, where *Something went wrong* has a reference that names the line;
 * - `clean-exit` is a window closing, which is nothing to tell and no reason to reload.
 */
export class RendererEnded extends Error {
  override readonly name = 'RendererEnded';
  constructor(
    readonly reason: string,
    readonly exitCode: number,
  ) {
    super(`the window's renderer ended: reason=${reason} exitCode=${String(exitCode)}`);
  }
}

export type RendererEndedAnswer =
  | { readonly kind: 'none' }
  | { readonly kind: 'out-of-memory'; readonly totalBytes: number; readonly availableBytes: number; readonly othersUsingMost: boolean };

export interface RendererEnding {
  /** The renderer ended for `reason`: kept for the next one. Answers whether the window is to be reloaded. */
  readonly ended: (details: { readonly reason: string; readonly exitCode: number }) => boolean;
  /** What the replacing renderer is told, once: forgotten as it is answered. Throws {@link RendererEnded} for a defect. */
  readonly take: () => RendererEndedAnswer;
}

/** A shell whose renderer never ended: every ask answers `none`. What a case with no window takes. */
export const NO_RENDERER_ENDING: Pick<RendererEnding, 'take'> = { take: () => ({ kind: 'none' }) };

/** The rule over the computer's memory reading, the low-memory watch's own. */
export function createRendererEnding(policy: Pick<MemoryPressurePolicy, 'read' | 'belowFraction'> = MEMORY_PRESSURE): RendererEnding {
  let kept: { readonly reason: string; readonly exitCode: number; readonly memory: RendererEndedAnswer | undefined } | undefined;
  return {
    ended: ({ reason, exitCode }) => {
      if (reason === 'clean-exit') return false;
      let memory: RendererEndedAnswer | undefined;
      if (reason === 'oom') {
        const reading = policy.read();
        // NO READING, NO FIGURES — and so no claim: it is told as the defect it then cannot be shown not to be.
        if (reading !== null && reading.total > 0) {
          const totalBytes = Math.round(reading.total);
          const availableBytes = Math.max(0, Math.round(reading.available));
          memory = { kind: 'out-of-memory', totalBytes, availableBytes, othersUsingMost: availableBytes < totalBytes * policy.belowFraction };
        }
      }
      kept = { reason, exitCode, memory };
      return true;
    },
    take: () => {
      const told = kept;
      kept = undefined;
      if (told === undefined) return { kind: 'none' };
      if (told.memory !== undefined) return told.memory;
      throw new RendererEnded(told.reason, told.exitCode);
    },
  };
}
