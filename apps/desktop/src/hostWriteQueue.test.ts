import { describe, expect, it } from 'vitest';

import {
  type OverlappedWriteSurface,
  type PendingWrite,
  type WriteState,
  createHostWriteQueue,
} from './hostWriteQueue.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (frame: Uint8Array): string => new TextDecoder().decode(frame);

/**
 * A recording write surface.
 *
 * ONE list for every call, as the factories beside it do, because the properties
 * here are about ORDER — collect before the limit is checked, collect before
 * abandon — and per-member spies would let each of those pass against a queue
 * that did them backwards.
 */
interface Recorder extends OverlappedWriteSurface {
  readonly calls: string[];
  /** Makes the nth issued write answer `completed` or `failed` from now on. */
  readonly settle: (index: number, as: Exclude<WriteState, 'pending'>) => void;
  /** Makes the next `issue` refuse, as a full pipe or a broken handle would. */
  readonly refuseNext: (error: number) => void;
}

function surface(): Recorder {
  const calls: string[] = [];
  const frames: string[] = [];
  const states: WriteState[] = [];
  const tokens: PendingWrite[] = [];
  let refusal: number | null = null;
  let error = 0;

  const named = (write: PendingWrite): string => frames[tokens.indexOf(write)] ?? '?';

  return {
    calls,
    issue: (frame) => {
      if (refusal !== null) {
        error = refusal;
        refusal = null;
        calls.push(`issue(${decode(frame)}) REFUSED`);
        return null;
      }
      const token: PendingWrite = { __handle: 'pending-write' };
      tokens.push(token);
      frames.push(decode(frame));
      states.push('pending');
      calls.push(`issue(${decode(frame)})`);
      return token;
    },
    collect: (write) => {
      const state = states[tokens.indexOf(write)] ?? 'pending';
      calls.push(`collect(${named(write)})=${state}`);
      return state;
    },
    release: (write) => calls.push(`release(${named(write)})`),
    abandon: (writes) => calls.push(`abandon(${writes.map(named).join(',') || '-'})`),
    lastError: () => error,
    settle: (index, as) => {
      states[index] = as;
    },
    refuseNext: (code) => {
      refusal = code;
    },
  };
}

describe('createHostWriteQueue', () => {
  it('issues a frame and holds it until something collects it', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    expect(queue.write(encode('one'))).toEqual({ ok: true });

    expect(queue.outstanding()).toBe(1);
    // NOTHING COLLECTED YET. The first write has no earlier writes to collect,
    // and there is no timer — which is the whole of "when main next has
    // business".
    expect(win32.calls).toEqual(['issue(one)']);
  });

  it('collects on the NEXT write, releasing what finished and keeping what did not', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    queue.write(encode('one'));
    queue.write(encode('two'));
    win32.settle(0, 'completed');
    queue.write(encode('three'));

    expect(queue.outstanding()).toBe(2);
    expect(win32.calls).toEqual([
      'issue(one)',
      'collect(one)=pending',
      'issue(two)',
      'collect(one)=completed',
      'release(one)',
      'collect(two)=pending',
      'issue(three)',
    ]);
  });

  it('walks every outstanding write rather than stopping at the first still pending', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    queue.write(encode('one'));
    queue.write(encode('two'));
    // THE SECOND ONE FINISHES AND THE FIRST DOES NOT. Stopping at the first
    // pending would be sound only because completions preserve issue order,
    // which is a measurement about a byte-mode pipe and not a property of this
    // ordering. A queue that stopped early would leave `two` outstanding here.
    win32.settle(1, 'completed');
    queue.write(encode('three'));

    expect(win32.calls).toContain('release(two)');
    expect(queue.outstanding()).toBe(2);
  });

  it('refuses a write once the limit is reached, and closes rather than dropping it', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 2);

    expect(queue.write(encode('one')).ok).toBe(true);
    expect(queue.write(encode('two')).ok).toBe(true);
    const third = queue.write(encode('three'));

    expect(third.ok).toBe(false);
    expect(!third.ok && third.refusal.reason).toBe('overrun');
    // NOT ISSUED, and everything outstanding handed back in one call.
    expect(win32.calls).not.toContain('issue(three)');
    expect(win32.calls).toContain('abandon(one,two)');
  });

  it('CONTROL: the limit counts what is OUTSTANDING, not how many were written', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 2);

    queue.write(encode('one'));
    queue.write(encode('two'));
    win32.settle(0, 'completed');
    win32.settle(1, 'completed');
    // A queue that counted TOTAL writes refuses this one, and every assertion in
    // the case above passes against that queue — the overrun case cannot tell
    // the two apart, because in it nothing ever completes. This is the fixture
    // the bug does NOT also handle correctly.
    const third = queue.write(encode('three'));

    expect(third).toEqual({ ok: true });
    expect(queue.outstanding()).toBe(1);
  });

  it('closes on a write that reports failure when it is collected', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    queue.write(encode('one'));
    win32.settle(0, 'failed');
    const second = queue.write(encode('two'));

    expect(second.ok).toBe(false);
    expect(!second.ok && second.refusal.reason).toBe('failed');
    // The frame that failed is still released — it finished, however badly —
    // and `two` is never issued into a stream that has lost its offsets.
    expect(win32.calls).toContain('release(one)');
    expect(win32.calls).not.toContain('issue(two)');
  });

  it('closes on a refused issue and reports the error the surface gives', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    win32.refuseNext(232);
    const only = queue.write(encode('one'));

    expect(only.ok).toBe(false);
    expect(!only.ok && only.refusal.reason).toBe('refused');
    expect(!only.ok && only.refusal.detail).toContain('232');

    // AND THE QUEUE IS SHUT, which the assertions above do not establish. This
    // is YYYY-1's control: `ERROR_NO_DATA` is a genuinely lost pipe and must
    // stay terminal, so a build that treated every errno as `not-connected`
    // would satisfy every line above and fail here. Asserting the decision
    // rather than the message, per the stage audit's own rule.
    const after = queue.write(encode('two'));
    expect(!after.ok && after.refusal.reason).toBe('closed');
  });

  it('does NOT close when the host has not connected yet, and a later write goes out', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    // 536 is ERROR_PIPE_LISTENING: the instance exists and nothing has connected
    // to it. Nothing was written, so no length prefix is misplaced — the
    // argument that makes every other refusal terminal does not apply.
    win32.refuseNext(536);
    const early = queue.write(encode('one'));

    expect(early.ok).toBe(false);
    expect(!early.ok && early.refusal.reason).toBe('not-connected');
    expect(!early.ok && early.refusal.detail).toContain('536');

    // THE LOAD-BEARING LINE. A refusal reason is a string and a build that
    // renamed it while still shutting the queue would pass the three assertions
    // above; what separates non-terminal from terminal is that the NEXT write
    // is issued. Before this branch existed, the host connecting a moment later
    // met a queue that had already been abandoned.
    const later = queue.write(encode('two'));
    expect(later.ok).toBe(true);
    expect(win32.calls).toContain('issue(two)');
  });

  it('reports every later write as closed, naming what ended it', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 1);

    queue.write(encode('one'));
    const overran = queue.write(encode('two'));
    const after = queue.write(encode('three'));

    expect(!overran.ok && overran.refusal.reason).toBe('overrun');
    expect(!after.ok && after.refusal.reason).toBe('closed');
    // THE FIRST CAUSE, carried forward. A later caller learning only "closed"
    // would have to go and find out why, and the answer is a message that has
    // already been composed once.
    expect(!after.ok && after.refusal.detail).toContain('outstanding against a limit');
  });

  it('collects before abandoning on close, so only writes the kernel may touch are handed back', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    queue.write(encode('one'));
    queue.write(encode('two'));
    win32.settle(0, 'completed');
    queue.close();

    // `one` finished, so it goes back the ordinary way; only `two` is abandoned,
    // and `abandon`'s contract — the writes the kernel may still be writing
    // into — is a smaller thing for the adapter to be right about.
    expect(win32.calls).toContain('release(one)');
    expect(win32.calls).toContain('abandon(two)');
  });

  it('closes once however many times it is called', () => {
    const win32 = surface();
    const queue = createHostWriteQueue(win32, 4);

    queue.write(encode('one'));
    queue.close();
    queue.close();

    // VACUITY GUARD as much as a property: a queue that abandoned nothing would
    // satisfy "abandons once" by doing it never.
    expect(win32.calls.filter((call) => call.startsWith('abandon'))).toEqual(['abandon(one)']);
  });

  it('refuses a limit that is not a whole number of frames, at least one', () => {
    const win32 = surface();

    expect(() => createHostWriteQueue(win32, 0)).toThrow(/at least 1/u);
    expect(() => createHostWriteQueue(win32, 1.5)).toThrow(/whole number/u);
    expect(() => createHostWriteQueue(win32, -1)).toThrow(/at least 1/u);
    // AND THE CONTROL: 1 is legal, so the guard is not simply refusing.
    expect(() => createHostWriteQueue(win32, 1)).not.toThrow();
  });
});
