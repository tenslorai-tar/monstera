import { describe, expect, it } from 'vitest';

import { RendererEnded, createRendererEnding } from './rendererEnding.js';

/**
 * ADR-0253's renderer half in `main`: a renderer that ended out of memory is told as memory with the computer's figures;
 * any other ending is a defect, thrown for the boundary to record. Each control is an ending the rule must not call memory.
 */
const GB = 1024 ** 3;
const low = { read: () => ({ available: 0.3 * GB, total: 8 * GB }), belowFraction: 0.1 };

describe('why the window’s last renderer ended', () => {
  it('out of memory is told once, with the figures, and the window is reloaded', () => {
    const ending = createRendererEnding(low);
    expect(ending.ended({ reason: 'oom', exitCode: -536870904 })).toBe(true);
    expect(ending.take()).toStrictEqual({ kind: 'out-of-memory', totalBytes: 8 * GB, availableBytes: Math.round(0.3 * GB), othersUsingMost: true });
    // ONCE: the next window to load had no ending.
    expect(ending.take()).toStrictEqual({ kind: 'none' });
  });

  it('CONTROL: a renderer that crashed is a defect, thrown for the incident log, not called memory', () => {
    const ending = createRendererEnding(low);
    expect(ending.ended({ reason: 'crashed', exitCode: 3 })).toBe(true);
    expect(() => ending.take()).toThrow(RendererEnded);
  });

  it('CONTROL: a window closing is nothing to tell and no reason to reload', () => {
    const ending = createRendererEnding(low);
    expect(ending.ended({ reason: 'clean-exit', exitCode: 0 })).toBe(false);
    expect(ending.take()).toStrictEqual({ kind: 'none' });
  });

  it('CONTROL: out of memory with no figures to read is told as the defect it cannot be shown not to be', () => {
    const ending = createRendererEnding({ read: () => null, belowFraction: 0.1 });
    ending.ended({ reason: 'oom', exitCode: 1 });
    expect(() => ending.take()).toThrow(RendererEnded);
  });
});
