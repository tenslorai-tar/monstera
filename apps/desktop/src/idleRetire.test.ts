import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { idleHost } from './idleRetire.js';

/** A call that answers when the case says so. */
function deferred(): { readonly promise: Promise<string>; readonly answer: () => void } {
  let answer = (): void => undefined;
  const promise = new Promise<string>((resolve) => {
    answer = () => {
      resolve('answered');
    };
  });
  return { promise, answer };
}

describe('a host that holds no session is stopped after it has been idle (run 4 item 13b)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the stop idleMs after the LAST call, and not before', async () => {
    const retire = vi.fn(() => Promise.resolve(true));
    const { counted } = idleHost(1000, retire, () => undefined);
    const call = counted(() => Promise.resolve(1));
    await call();
    await vi.advanceTimersByTimeAsync(600);
    await call();
    // CONTROL: 1,000 ms after the first call, but only 400 after the second, which re-armed it.
    await vi.advanceTimersByTimeAsync(400);
    expect(retire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(retire).toHaveBeenCalledTimes(1);
  });

  it('counts a call from when it is made, so a stop asked while one runs sees it busy, and its end asks again', async () => {
    let busyAtRetire: boolean[] = [];
    const host = idleHost(
      1000,
      () => {
        busyAtRetire = [...busyAtRetire, host.busy()];
        return Promise.resolve(!host.busy());
      },
      () => undefined,
    );
    await host.counted(() => Promise.resolve(1))();
    const slow = deferred();
    const running = host.counted(() => slow.promise)();
    await vi.advanceTimersByTimeAsync(1000);
    // THE FIRST CALL'S TIMER FIRED while the second runs: the binding's retire reads it busy and declines.
    expect(busyAtRetire).toStrictEqual([true]);
    slow.answer();
    await running;
    await vi.advanceTimersByTimeAsync(1000);
    expect(busyAtRetire).toStrictEqual([true, false]);
  });

  it('a stop that throws is told where failures go, never into a call', async () => {
    const failed = vi.fn();
    const { counted } = idleHost(1000, () => Promise.reject(new Error('the area could not be removed')), failed);
    await expect(counted(() => Promise.resolve('kept'))()).resolves.toBe('kept');
    await vi.advanceTimersByTimeAsync(1000);
    expect(failed).toHaveBeenCalledWith(new Error('the area could not be removed'));
  });

  it('CONTROL: with no call made, nothing is ever asked', async () => {
    const retire = vi.fn(() => Promise.resolve(true));
    idleHost(1000, retire, () => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(retire).not.toHaveBeenCalled();
  });
});
