import { describe, expect, it } from 'vitest';

import { ENGINE_UNLOADABLE_EXIT, couldNotStart } from './engineStart.js';

describe('couldNotStart', () => {
  it("reads Windows' loader statuses and the hosts' own code as a part that could not start", () => {
    // STATUS_DLL_NOT_FOUND is x2t's measured exit on a PC with no VC++ runtime; ENTRYPOINT_NOT_FOUND is a runtime too old.
    for (const code of [0xc0000135, 0xc0000139, 0xc000007b, 0xc0000142, ENGINE_UNLOADABLE_EXIT]) expect(couldNotStart(code)).toBe(true);
  });

  it('reads a status that arrives as a NEGATIVE number the same way — a signed read of the same 32 bits', () => {
    expect(couldNotStart(0xc0000135 | 0)).toBe(true);
  });

  it("CONTROL: a converter's own failures are not a start failure — x2t's 80, Node's 1, the sampler's kill", () => {
    for (const code of [0, 1, 80, 0xc0000017, 0xc0000005]) expect(couldNotStart(code)).toBe(false);
  });
});
