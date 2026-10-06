import { describe, expect, it } from 'vitest';

/**
 * The anchor `proof:hostruntime` reads to know this suite ran in the runtime the engine hosts run in.
 *
 * The proof starts vitest under the pinned Electron binary with `ELECTRON_RUN_AS_NODE=1`, which is how every host
 * process is started, and vitest's workers inherit both. A worker that fell back to plain Node would pass every other
 * case in the kernel exactly as `npm test` does, so the proof names this case and requires it passed: without it, *the
 * suite is green under Electron* and *the suite is green* are one observation. In an ordinary run nothing is asked.
 */
describe('the runtime this suite runs in', () => {
  it('is Electron in Node mode when the host-runtime proof asked for it', () => {
    if (process.env['MONSTERA_EXPECTED_RUNTIME'] !== 'electron-as-node') return;
    expect(process.versions['electron']).toBeTypeOf('string');
    expect(process.env['ELECTRON_RUN_AS_NODE']).toBe('1');
  });
});
