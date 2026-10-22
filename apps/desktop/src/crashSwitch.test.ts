import { describe, expect, it } from 'vitest';

import { crashOrdered } from './crashSwitch.js';

describe('crashOrdered — a crash on purpose, for a development build only', () => {
  const development = ['C:\\tools\\electron.exe', 'C:\\repo\\apps\\desktop'];

  it('a development build obeys either order', () => {
    expect(crashOrdered([...development, '--monstera-crash=renderer'], false)).toBe('renderer');
    expect(crashOrdered([...development, '--monstera-crash=main'], false)).toBe('main');
  });

  it('a packaged build ignores the switch, whatever it names', () => {
    // CONTROL: the same arguments read as a development build are obeyed, so the refusal is the packaging alone.
    for (const order of ['renderer', 'main'] as const) {
      const argv = ['C:\\Program Files\\Monstera\\Monstera.exe', `--monstera-crash=${order}`];
      expect(crashOrdered(argv, true)).toBeNull();
      expect(crashOrdered(argv, false)).toBe(order);
    }
  });

  it('no switch, or one naming something else, is no order', () => {
    expect(crashOrdered(development, false)).toBeNull();
    expect(crashOrdered([...development, '--monstera-crash=gpu'], false)).toBeNull();
    expect(crashOrdered([...development, '--monstera-crash'], false)).toBeNull();
  });
});
