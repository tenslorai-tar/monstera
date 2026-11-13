import { describe, expect, it } from 'vitest';

import { pathlessCause } from './pathlessCause.js';

/** Node's system error's shape: a code, the call, the path, and a message that spells the path. Node's own is in desktop's case. */
function systemError(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT', syscall: 'open', path });
}

describe('pathlessCause (HHHHHHHHH-19)', () => {
  it('a system error is said by its code and call, and NOT its message, which spells the path', () => {
    const thrown = systemError('C:/Users/someone/Private letters/lease.pdf');
    // THE CONTROL: the message does carry the path, so leaving it out is what this asserts.
    expect(thrown.message).toContain('lease.pdf');
    expect(pathlessCause(thrown)).toBe('ENOENT on open');
  });

  it('a worker’s posted failure, plain data, is said the same way: by its code where it has one, else its message', () => {
    expect(pathlessCause({ kind: 'failed', message: "EBUSY: resource busy or locked, rename 'C:/Users/someone/x.mhist'", code: 'EBUSY', syscall: 'rename' })).toBe(
      'EBUSY on rename',
    );
    expect(pathlessCause({ kind: 'failed', message: 'a record did not open', code: null, syscall: null })).toBe('a record did not open');
  });

  it('this application’s own error and a thrown string are said as written', () => {
    expect(pathlessCause(new Error('the rewrite thread ended with code 1 and no answer'))).toBe('the rewrite thread ended with code 1 and no answer');
    expect(pathlessCause('stopped')).toBe('stopped');
  });
});
