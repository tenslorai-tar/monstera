import { messageKey } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import { type BusyNote, busyOver } from './busyNote.js';

const FIRST = messageKey('test.busy.first');
const SECOND = messageKey('test.busy.second');

function holder(): { readonly current: () => BusyNote | undefined; readonly show: ReturnType<typeof busyOver> } {
  let state: BusyNote | undefined;
  return {
    current: () => state,
    show: busyOver((update) => {
      state = update(state);
    }),
  };
}

describe('busyOver', () => {
  it('raises the note, and its end takes it down', () => {
    const { current, show } = holder();
    const end = show(FIRST, { name: 'a.pdf' });
    expect(current()).toStrictEqual({ message: FIRST, values: { name: 'a.pdf' } });
    end();
    expect(current()).toBeUndefined();
  });

  it('an EARLIER note’s end does not take down a later one', () => {
    const { current, show } = holder();
    const endFirst = show(FIRST, {});
    show(SECOND, {});
    endFirst();
    // A version that cleared unconditionally passes the case above and fails this.
    expect(current()?.message).toBe(SECOND);
  });
});
