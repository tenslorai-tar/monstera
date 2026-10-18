import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SamplerMessage } from '@monstera/nodemode';
import { afterAll, describe, expect, it } from 'vitest';

import { createMemorySamplerSurface } from './memorySamplerSurface.js';

/**
 * The surface turns EVERY way the sampler's thread can end into each watched host's one message, and every host is
 * watched by ONE thread (ADR-0023's correction of 2026-10-18).
 *
 * The first cases run a real worker thread from a few-line entry point, so the thread's own events are what is tested
 * rather than a stand-in for them. The last run the REAL sampler against real child processes, on Windows, where the
 * engine hosts run.
 */

const directory = mkdtempSync(join(tmpdir(), 'monstera-sampler-surface-'));
const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
  rmSync(directory, { recursive: true, force: true });
});

/** A worker entry point whose body runs once the first watch arrives, with that watch as `watch`. */
function entry(name: string, body: string): string {
  const path = join(directory, `${name}.mjs`);
  writeFileSync(
    path,
    [
      "import { parentPort, workerData } from 'node:worker_threads';",
      'workerData.port.on(\'message\', (watch) => {',
      body,
      '});',
      '',
    ].join('\n'),
    'utf8',
  );
  return path;
}

/** Starts one host's sampler on `path` and resolves with every message it delivers within a short wait after the first. */
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
  it('CONTROL: a thread that reports a host’s one message delivers exactly that message', async () => {
    const seen = await messages(entry('posts', "parentPort.postMessage({ id: watch.id, message: { kind: 'stopped', peakBytes: 7 } });"));
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

/** A child process holding about `megabytes` MB of private commit, written to, until it is ended. */
function holding(megabytes: number): ChildProcess {
  const path = join(directory, `hold-${String(megabytes)}.mjs`);
  writeFileSync(path, `const held = Buffer.alloc(${String(megabytes)} * 1024 * 1024, 1);\nsetInterval(() => held[0], 1000);\n`, 'utf8');
  const child = spawn(process.execPath, [path], { stdio: 'ignore' });
  children.push(child);
  return child;
}

/** A host's one message, waited for. */
function ending(sampler: { onMessage: (sink: (message: SamplerMessage) => void) => void }): Promise<SamplerMessage> {
  return new Promise((resolve) => {
    sampler.onMessage(resolve);
  });
}

const MB = 1024 * 1024;

describe.runIf(process.platform === 'win32')('one sampling thread for every host, against real processes', () => {
  it('watches two hosts on ONE thread, ends the one over its budget and names it, and leaves the other', async () => {
    const surface = createMemorySamplerSurface();
    const large = holding(300);
    const small = holding(1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    // THE SMALL HOST WATCHED FIRST, so a thread that sampled only its first host would never see the large one grow.
    const under = surface.start(small.pid ?? 0, 200 * MB, 100);
    const over = surface.start(large.pid ?? 0, 200 * MB, 100);
    if (over === null || under === null) throw new Error('the sampler did not start');
    expect(surface.threads()).toBe(1);
    const overEnded = await ending(over);
    expect(overEnded.kind).toBe('killed');
    expect(over.killed()).toBe(true);
    // THE OTHER HOST IS STILL WATCHED by the same thread, and is not the one killed.
    expect(under.killed()).toBe(false);
    expect(surface.threads()).toBe(1);
    const underEnded = ending(under);
    under.stop();
    expect((await underEnded).kind).toBe('stopped');
    // NO HOST WATCHED, NO THREAD: what a closed application holds.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(surface.threads()).toBe(0);
  }, 30_000);

  it('CONTROL: a host over its budget on its own is ended and named, as before', async () => {
    const surface = createMemorySamplerSurface();
    const large = holding(300);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const over = surface.start(large.pid ?? 0, 200 * MB, 100);
    if (over === null) throw new Error('the sampler did not start');
    const ended = await ending(over);
    expect(ended).toMatchObject({ kind: 'killed' });
    expect(ended.kind === 'killed' ? ended.privateBytes : 0).toBeGreaterThanOrEqual(200 * MB);
    expect(over.killed()).toBe(true);
  }, 30_000);
});
