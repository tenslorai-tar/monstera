import { describe, expect, it } from 'vitest';

import { installedFontsFolder } from './installedFonts.js';

describe('the installed fonts’ folder (ADR-0172 Decision 2)', () => {
  it('is the system folder under SystemRoot on Windows, or under windir where only that is set', () => {
    expect(installedFontsFolder({ SystemRoot: 'C:\\Windows' }, 'win32')).toBe('C:\\Windows\\Fonts');
    expect(installedFontsFolder({ windir: 'D:\\WIN' }, 'win32')).toBe('D:\\WIN\\Fonts');
  });

  it('CONTROL: is none off Windows, and none where Windows named no root, never a guessed path', () => {
    expect(installedFontsFolder({ SystemRoot: 'C:\\Windows' }, 'linux')).toBeNull();
    expect(installedFontsFolder({}, 'win32')).toBeNull();
    expect(installedFontsFolder({ SystemRoot: '' }, 'win32')).toBeNull();
  });
});
