import { describe, expect, it } from 'vitest';

import { type FrontableWindow, bringToFront } from './secondLaunch.js';

/** A window that records what it was asked, and throws on every call once destroyed, as Electron's does. */
function windowStub(state: { destroyed: boolean; minimized: boolean }): FrontableWindow & { readonly calls: string[] } {
  const calls: string[] = [];
  const live = (name: string, answer?: boolean) => {
    if (state.destroyed) throw new TypeError(`Object has been destroyed (${name})`);
    calls.push(name);
    return answer;
  };
  return {
    calls,
    isDestroyed: () => state.destroyed,
    isMinimized: () => live('isMinimized', state.minimized) === true,
    restore: () => void live('restore'),
    focus: () => void live('focus'),
  };
}

describe('a second launch brings the window forward (CR-SEC-05)', () => {
  it('does nothing, and throws nothing, for a window that has been destroyed', () => {
    const window = windowStub({ destroyed: true, minimized: true });
    expect(() => {
      bringToFront(window);
    }).not.toThrow();
    expect(window.calls).toStrictEqual([]);
  });

  it('CONTROL: a live minimised window is restored and focused, a live one is only focused', () => {
    const minimised = windowStub({ destroyed: false, minimized: true });
    bringToFront(minimised);
    expect(minimised.calls).toStrictEqual(['isMinimized', 'restore', 'focus']);

    const shown = windowStub({ destroyed: false, minimized: false });
    bringToFront(shown);
    expect(shown.calls).toStrictEqual(['isMinimized', 'focus']);
  });
});
