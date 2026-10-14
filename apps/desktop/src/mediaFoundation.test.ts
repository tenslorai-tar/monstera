import { describe, expect, it } from 'vitest';

import { hasMediaFoundation } from './mediaFoundation.js';

describe('hasMediaFoundation', () => {
  it('reads an N edition — no mfplat.dll in System32 — as having no Media Foundation, and asks that one file', () => {
    const asked: string[] = [];
    const answer = hasMediaFoundation('win32', 'D:\\Win', (path) => {
      asked.push(path);
      return false;
    });
    expect(answer).toBe(false);
    expect(asked).toHaveLength(1);
    expect(/system32[\\/]mfplat\.dll$/iu.test(asked[0] ?? '')).toBe(true);
    expect(asked[0]?.startsWith('D:')).toBe(true);
  });

  it('CONTROL: the same computer with the Media Feature Pack has it; off Windows nothing is asked', () => {
    expect(hasMediaFoundation('win32', 'C:\\Windows', () => true)).toBe(true);
    const asked: string[] = [];
    expect(hasMediaFoundation('linux', undefined, (path) => (asked.push(path), false))).toBe(true);
    expect(asked).toStrictEqual([]);
  });
});
