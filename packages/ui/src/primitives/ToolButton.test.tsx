// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { ribbonCaption } from './ToolButton.js';

describe('ribbonCaption (v5: plain words on the ribbon)', () => {
  it('drops the trailing ellipsis a dialog-opening title carries', () => {
    expect(ribbonCaption('Crop pages…')).toBe('Crop pages');
    expect(ribbonCaption('Open…')).toBe('Open');
    // AND THE SPACE BEFORE IT, which a translation may write: a caption must not end in a blank (the audit of
    // 1e1bfad..e24eca0e found this branch reached by no case — no caption here had a space before its ellipsis).
    expect(ribbonCaption('Exporter …')).toBe('Exporter');
  });

  it('CONTROL: leaves a caption with no trailing ellipsis exactly as it is, including one in the middle', () => {
    // A rule that trimmed the last character, or every ellipsis, would pass the case above and fail these.
    expect(ribbonCaption('Split')).toBe('Split');
    expect(ribbonCaption('A…B')).toBe('A…B');
  });
});
