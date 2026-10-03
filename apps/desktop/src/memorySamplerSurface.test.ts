import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SamplerMessage } from '@monstera/nodemode';
import { afterAll, describe, expect, it } from 'vitest';

import { createMemorySamplerSurface } from './memorySamplerSurface.js';

/**
 * The surface turns EVERY way the sampler's thread can end into exactly one message.
 *
 * A thread that throws, or exits without posting, has stopped watching its host as surely as one that reports a
 * failure; before this, the surface listened for messages alone, so either ending left a host watched by no one and
 * said nothing. Each case runs a real worker thread from a three-line entry point, so the thread's own events are what
 * is tested rather than a stand-in for them.
 */

const directory = mkdtempSync(join(tmpdir(), 'monstera-sampler-surface-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A worker entry point whose whole body is `body`. */
function entry(name: string, body: string): string {
  const path = join(directory, `${name}.mjs`);
  writeFileSync(path, `import { parentPort } from 'node:worker_threads';\n${body}\n`, 'utf8');
  return path;
}

/** Starts a sampler on `path` and resolves with every message it delivers within a short wait after the first. */
async function messages(path: string): Promise<SamplerMessage[]> {
  const sampler = createMemorySamplerSurface(path).start(process.pid, 1, 100);
  if (sampler === null) throw new Error('the worker did not start');
  const seen: SamplerMessage[] = [];
  await new Promise<void>((resolve) => {
    sampler.onMessage((message) => {
      seen.push(message);
      setTimeout(resolve, 200);
    });
  });
  return seen;
}

describe('the memory sampler surface', () => {
  it('CONTROL: a thread that posts its one message delivers exactly that message', async () => {
    const seen = await messages(entry('posts', "parentPort.postMessage({ kind: 'stopped', peakBytes: 7 });"));
    expect(seen).toStrictEqual([{ kind: 'stopped', peakBytes: 7 }]);
  });

  it('a thread that throws is reported as a failure, once', async () => {
    const seen = await messages(entry('throws', "throw new Error('no koffi here');"));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('failed');
    expect(seen[0]?.kind === 'failed' ? seen[0].detail : '').toContain('no koffi here');
  });

  it('a thread that exits without posting is reported as a failure, once', async () => {
    const seen = await messages(entry('silent', 'process.exit(0);'));
    expect(seen).toStrictEqual([{ kind: 'failed', detail: 'the sampler thread exited (0) without saying why' }]);
  });
});
