import { describe, expect, it } from 'vitest';

import { framesTold } from './frameInspector.js';

describe('framesTold', () => {
  it('names every unfinished frame with its time, and the times and readouts around it', () => {
    const told = framesTold({
      frames: 3,
      unfinished: ['frame 2 at 17 ms: a page canvas is transparent'],
      zooms: ['100%', '84%', '84%'],
      at: [0, 17, 33],
    });
    expect(told).toContain('3 frames watched, 1 unfinished');
    expect(told).toContain('frame 2 at 17 ms: a page canvas is transparent');
    expect(told).toContain('frame times (ms): 0 17 33');
    expect(told).toContain('zoom readouts: 100% | 84% | 84%');
  });

  it('stays a message on a long log, and says how many it left out', () => {
    const unfinished = Array.from({ length: 50 }, (_, at) => `frame ${String(at + 1)} at ${String(at * 16)} ms: blank`);
    const told = framesTold({ frames: 50, unfinished, zooms: [], at: unfinished.map((_, at) => at * 16) });
    expect(told).toContain('frame 40 at 624 ms: blank');
    expect(told).not.toContain('frame 41 at');
    expect(told).toContain('… and 10 more');
  });

  it('CONTROL: a clean log says so, and lists no frame', () => {
    const told = framesTold({ frames: 30, unfinished: [], zooms: [], at: [] });
    expect(told).toContain('30 frames watched, 0 unfinished');
    expect(told).not.toMatch(/^frame \d/mu);
  });
});
