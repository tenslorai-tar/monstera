import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';

import type { HistoryRewriteData } from '@monstera/nodemode';
import { afterAll, describe, expect, it } from 'vitest';

import { workerRewriter } from './historyRewriter.js';

/**
 * Delete's rewrite runs on ANOTHER THREAD, and every way that thread can end is one answer (ADR-0279, the owner's
 * answers, Decision 7). Each case runs a real worker thread from a few-line entry point, so the thread's own events are
 * what is tested; the rewrite itself is `historyStore.test.ts`'s, from source. The real entry point is the package's
 * build, which a test must not load (`testResolution.proof.mjs`).
 */

const directory = mkdtempSync(join(tmpdir(), 'monstera-history-rewriter-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A worker entry point running `body`, with the job as `workerData`. */
function entry(name: string, body: string): string {
  const path = join(directory, `${name}.mjs`);
  writeFileSync(path, ["import { parentPort, threadId, workerData } from 'node:worker_threads';", body, ''].join('\n'), 'utf8');
  return path;
}

const JOB: HistoryRewriteData = {
  path: join(directory, 'absent.mhist'),
  writing: join(directory, 'absent.writing'),
  key: new Uint8Array(32),
  drop: { kind: 'conversation', key: 'a'.repeat(64) },
};

describe('the history rewriter', () => {
  it('CONTROL: a thread that answers delivers its answer, and it ran on a thread that is not this one', async () => {
    const answer = await workerRewriter(
      entry('answers', "parentPort.postMessage({ kind: 'failed', message: `thread ${String(threadId)} saw ${workerData.drop.kind}` });"),
    )(JOB);
    expect(answer.kind).toBe('failed');
    const seen = answer.kind === 'failed' ? /^thread (\d+) saw conversation$/u.exec(answer.message) : null;
    expect(seen).not.toBeNull();
    expect(Number(seen?.[1])).not.toBe(threadId);
  });

  it('a thread that throws is a failure said, never a promise left waiting', async () => {
    const answer = await workerRewriter(entry('throws', "throw new Error('the file is gone');"))(JOB);
    expect(answer).toStrictEqual({ kind: 'failed', message: 'the file is gone' });
  });

  it('a thread that ends without answering is a failure said', async () => {
    const answer = await workerRewriter(entry('silent', 'process.exit(0);'))(JOB);
    expect(answer).toStrictEqual({ kind: 'failed', message: 'the rewrite thread ended with code 0 and no answer' });
  });

  it('an entry point that cannot start is a failure said', async () => {
    const answer = await workerRewriter(join(directory, 'missing.mjs'))(JOB);
    expect(answer.kind).toBe('failed');
  });
});
