import { describe, expect, it } from 'vitest';

import { printerCount } from './win32PrintSurface.js';

/** `EnumPrintersW` as a computer with `count` printers answers it, recording each call's buffer size. */
function spooler(count: number, sizes: number[]) {
  return (buffer: Buffer | null, size: number, needed: number[], returned: number[]): boolean => {
    sizes.push(size);
    if (count === 0) {
      // NO PRINTER: the size query succeeds, needing nothing and returning nothing.
      needed[0] = 0;
      returned[0] = 0;
      return true;
    }
    if (buffer === null || size < count * 16) {
      needed[0] = count * 16;
      returned[0] = 0;
      return false;
    }
    returned[0] = count;
    return true;
  };
}

describe('printerCount — EnumPrintersW, asked twice', () => {
  it('reads NONE where the size query answers nothing needed and nothing returned', () => {
    const sizes: number[] = [];
    expect(printerCount(spooler(0, sizes))).toBe(0);
    expect(sizes).toStrictEqual([0]);
  });

  it('CONTROL: reads the count from the second call, given the buffer the first asked for', () => {
    const sizes: number[] = [];
    expect(printerCount(spooler(3, sizes))).toBe(3);
    expect(sizes).toStrictEqual([0, 48]);
  });

  it('answers NULL, never zero, where the spooler fails without asking for a buffer — could not look is not none', () => {
    expect(printerCount(() => false)).toBeNull();
    expect(printerCount((buffer, _size, needed) => (buffer === null ? ((needed[0] = 32), false) : false))).toBeNull();
  });
});
