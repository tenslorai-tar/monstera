import { describe, expect, it, vi } from 'vitest';

import { heldRead } from './heldRead.js';

describe('heldRead', () => {
  it('reads once: a second caller, and one while the read is in flight, take the first answer (W5)', async () => {
    const read = vi.fn(() => Promise.resolve(['Arial']));
    const fonts = heldRead(read);
    const [first, during] = await Promise.all([fonts(), fonts()]);
    const after = await fonts();
    expect(read).toHaveBeenCalledTimes(1);
    expect([first, during, after]).toStrictEqual([['Arial'], ['Arial'], ['Arial']]);
  });

  it('CONTROL: a read that fails is not held, so the next caller reads again and gets the answer', async () => {
    const read = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error('host gone')).mockResolvedValue(['Arial']);
    const fonts = heldRead(read);
    await expect(fonts()).rejects.toThrow('host gone');
    await expect(fonts()).resolves.toStrictEqual(['Arial']);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
