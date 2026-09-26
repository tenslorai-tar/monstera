// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { ribbonCaption } from './ToolButton.js';

describe('ribbonCaption (v5: plain words on the ribbon)', () => {
  it('drops the trailing ellipsis a dialog-opening title carries', () => {
    expect(ribbonCaption('Crop pages…')).toBe('Crop pages');
    expect(ribbonCaption('Open…')).toBe('Open');
  });

  it('CONTROL: leaves a caption with no trailing ellipsis exactly as it is, including one in the middle', () => {
    // A rule that trimmed the last character, or every ellipsis, would pass the case above and fail these.
    expect(ribbonCaption('Split')).toBe('Split');
    expect(ribbonCaption('A…B')).toBe('A…B');
  });
});
