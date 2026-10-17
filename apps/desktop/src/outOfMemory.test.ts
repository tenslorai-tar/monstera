import { HostConnectionLost } from '@monstera/kernel';
import { describe, expect, it } from 'vitest';

import { outOfMemoryOf } from './outOfMemory.js';

/**
 * ADR-0253's one rule: a failure is called out of memory only where main's own sampler killed the host at its budget.
 * Each control is a failure the rule must leave alone, built beside one it names.
 */
const GB = 1024 ** 3;
const reading = (availableGb: number) => ({
  read: () => ({ available: availableGb * GB, total: 16 * GB }),
  belowFraction: 0.1,
});
const killed = new HostConnectionLost({ code: 'memory-budget', detail: 'the sampler killed it' });

describe('a failure is called out of memory only when that is proven', () => {
  it('a host killed at its budget is out of memory, with the computer’s figures, and other programs named when memory was short', () => {
    expect(outOfMemoryOf(killed, reading(1))).toStrictEqual({
      code: 'out-of-memory',
      detail: { totalBytes: 16 * GB, availableBytes: 1 * GB, othersUsingMost: true },
    });
  });

  it('the same kill on a computer with room does not blame the computer', () => {
    expect(outOfMemoryOf(killed, reading(9))?.detail.othersUsingMost).toBe(false);
  });

  it('CONTROL: a host that ended for any other reason is not called out of memory', () => {
    expect(outOfMemoryOf(new HostConnectionLost({ code: 'connection-lost', detail: 'the pipe closed' }), reading(1))).toBeUndefined();
    expect(outOfMemoryOf(new Error('anything else'), reading(1))).toBeUndefined();
  });

  it('CONTROL: a kill whose figures cannot be read claims nothing, so no guessed number reaches the person', () => {
    expect(outOfMemoryOf(killed, { read: () => null, belowFraction: 0.1 })).toBeUndefined();
  });
});
