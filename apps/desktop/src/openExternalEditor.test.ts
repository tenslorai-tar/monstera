import { describe, expect, it } from 'vitest';

import { isPdfPath } from './openExternalEditor.js';

/**
 * The one rule for what may be handed to the operating system's PDF handler.
 *
 * Each refusal is a name an extension-dispatching shell would run as something other than
 * a PDF, which is the input a missing check would let through.
 */
describe('isPdfPath', () => {
  it.each(['page.pdf', 'C:\\Users\\a\\Page 3.PDF', 'page.Pdf'])('accepts %s', (path) => {
    expect(isPdfPath(path)).toBe(true);
  });

  it.each(['page.exe', 'page.pdf.exe', 'page.pdfx', 'page.pdf ', 'page', 'page.bat'])(
    'refuses %s',
    (path) => {
      expect(isPdfPath(path)).toBe(false);
    },
  );
});
