import { describe, expect, it } from 'vitest';

import { tabNumbers } from './TabOrderLayer.js';

describe('tabNumbers, the numbers a click order draws (ADR-0226 Decision 15)', () => {
  it('numbers the clicked fields first in click order, then the rest in the order they have, which is what the kernel writes', () => {
    expect([...tabNumbers(0, [0, 1, 2, 3], ['0:2', '0:0'])]).toStrictEqual([
      [2, 1],
      [0, 2],
      [1, 3],
      [3, 4],
    ]);
  });

  it('CONTROL: a click on another page is not this page’s, and nothing clicked is the order as it is', () => {
    expect([...tabNumbers(0, [0, 1], ['1:1'])]).toStrictEqual([
      [0, 1],
      [1, 2],
    ]);
    expect([...tabNumbers(1, [0, 1], ['1:1'])]).toStrictEqual([
      [1, 1],
      [0, 2],
    ]);
  });
});
