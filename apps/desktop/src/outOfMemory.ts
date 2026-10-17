import type { FailureDetails } from '@monstera/shared';
import { HostConnectionLost } from '@monstera/kernel';

import { MEMORY_PRESSURE, type MemoryPressurePolicy } from './memoryPressure.js';

/**
 * Whether a failure is proven to be memory running out, and the computer's figures if it is
 * ([ADR-0253](../../../docs/DECISIONS/0253-a-failure-is-called-out-of-memory-only-when-that-is-proven.md)).
 *
 * THE ONE RULE (B3a) the three channels that change a document take: an engine host's call ended because `main`'s own
 * memory sampler killed the host at its budget, which the connection names `memory-budget`. Nothing else is called
 * memory — a host that crashed, was refused, or ended for any other reason stays `internal`, with its reference, so a
 * real defect still reaches the owner.
 *
 * The figures are read when this is asked, which is as the failure is answered: the computer's total and available
 * memory, through the same reading the low-memory watch takes. Other programs are named as using most of it only where
 * the available figure is under that watch's line; otherwise the host reached its own budget on a computer with room,
 * and the person is not told the computer was short.
 */
export function outOfMemoryOf(
  thrown: unknown,
  policy: Pick<MemoryPressurePolicy, 'read' | 'belowFraction'> = MEMORY_PRESSURE,
): { readonly code: 'out-of-memory'; readonly detail: FailureDetails['out-of-memory'] } | undefined {
  if (!(thrown instanceof HostConnectionLost) || thrown.termination.code !== 'memory-budget') return undefined;
  const reading = policy.read();
  // NO READING, NO FIGURES — and no claim: a failure the computer's figures cannot be read for is still a memory kill,
  // but saying *N GB* without N is the guess this rule exists to refuse, so it stays `internal` with its reference.
  if (reading === null || reading.total <= 0) return undefined;
  const totalBytes = Math.round(reading.total);
  const availableBytes = Math.max(0, Math.round(reading.available));
  return {
    code: 'out-of-memory',
    detail: { totalBytes, availableBytes, othersUsingMost: availableBytes < totalBytes * policy.belowFraction },
  };
}
