import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MEMORY_PRESSURE, tellsThePerson, watchMemoryPressure } from './memoryPressure.js';

describe('who is told that memory is low (ADR-0253’s correction of 2026-10-21, R18)', () => {
  it('a computer of 8 GiB or less is told, and one byte more is not', () => {
    // THE LINE WRITTEN OUT, never read from the constant it checks (audit item 4c): 8 GiB in bytes.
    expect(MEMORY_PRESSURE.tellsAtOrUnder).toBe(8_589_934_592);
    expect(tellsThePerson(MEMORY_PRESSURE, 8_589_934_592)).toBe(true);
    expect(tellsThePerson(MEMORY_PRESSURE, 4_294_967_296)).toBe(true);
    // CONTROL: the development machine's own reading, 12 GiB installed (2026-10-21), and one byte over the line.
    expect(tellsThePerson(MEMORY_PRESSURE, 12_761_452_544)).toBe(false);
    expect(tellsThePerson(MEMORY_PRESSURE, 8_589_934_593)).toBe(false);
  });
});

describe('low memory is read, and answered once per low spell (run 4 item 13e)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once when the reading falls below the line, not again while it stays there, and again after it recovers', async () => {
    let available = 50;
    const onLow = vi.fn(() => Promise.resolve());
    const stop = watchMemoryPressure({ intervalMs: 100, belowFraction: 0.1, tellsAtOrUnder: MEMORY_PRESSURE.tellsAtOrUnder, read: () => ({ available, total: 100 }) }, onLow, () => undefined);
    // CONTROL: above the line, nothing is asked.
    await vi.advanceTimersByTimeAsync(500);
    expect(onLow).not.toHaveBeenCalled();
    available = 5;
    await vi.advanceTimersByTimeAsync(500);
    expect(onLow).toHaveBeenCalledTimes(1);
    available = 50;
    await vi.advanceTimersByTimeAsync(100);
    available = 5;
    await vi.advanceTimersByTimeAsync(100);
    expect(onLow).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a reading that cannot be taken is no signal', async () => {
    const onLow = vi.fn(() => Promise.resolve());
    const stop = watchMemoryPressure({ intervalMs: 100, belowFraction: 0.1, tellsAtOrUnder: MEMORY_PRESSURE.tellsAtOrUnder, read: () => null }, onLow, () => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onLow).not.toHaveBeenCalled();
    stop();
  });

  it('an answer that throws is told where failures go, and the readings go on', async () => {
    const failed = vi.fn();
    const stop = watchMemoryPressure(
      { intervalMs: 100, belowFraction: 0.1, tellsAtOrUnder: MEMORY_PRESSURE.tellsAtOrUnder, read: () => ({ available: 1, total: 100 }) },
      () => Promise.reject(new Error('the host would not stop')),
      failed,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(failed).toHaveBeenCalledWith(new Error('the host would not stop'));
    stop();
  });
});
