import { describe, expect, it } from 'vitest';

import { MAX_LAUNCH_DOCUMENTS, createLaunchDocuments, documentPathsIn } from './launchDocuments.js';

/** The command line reads a launch's own arguments; each case names what a real one carries. */
describe('documentPathsIn — what a launch asked to open', () => {
  it('a packaged launch opened by a file association: the one path after the executable', () => {
    expect(documentPathsIn(['C:\\Program Files\\Monstera\\Monstera.exe', 'C:\\Users\\a\\Report.PDF'], true)).toStrictEqual([
      'C:\\Users\\a\\Report.PDF',
    ]);
  });

  it('a development launch skips the application folder the launcher passes second', () => {
    // THE FOLDER IS ABSOLUTE and would be taken for a document by a reader that skipped one argument only — except
    // that it is not a .pdf, so the case also carries a .pdf folder name to make the skip itself the only reason.
    const argv = ['C:\\tools\\electron.exe', 'C:\\repo\\apps\\desktop.pdf', 'D:\\docs\\a.pdf'];
    expect(documentPathsIn(argv, false)).toStrictEqual(['D:\\docs\\a.pdf']);
    // CONTROL: the same arguments read as a packaged launch keep the second one.
    expect(documentPathsIn(argv, true)).toStrictEqual(['C:\\repo\\apps\\desktop.pdf', 'D:\\docs\\a.pdf']);
  });

  it('a second instance’s switches, relative paths, other files and repeats are not documents', () => {
    const argv = [
      'Monstera.exe',
      '--allow-file-access-from-files',
      '--original-process-start-time=13370000000000000',
      'relative.pdf',
      'C:\\docs\\notes.txt',
      '\\\\server\\share\\scan.pdf',
      'C:\\docs\\a.pdf',
      'C:\\docs\\a.pdf',
    ];
    // A UNC PATH IS ABSOLUTE, and a document on a share is one a person can open.
    expect(documentPathsIn(argv, true)).toStrictEqual(['\\\\server\\share\\scan.pdf', 'C:\\docs\\a.pdf']);
  });

  it(`takes at most ${String(MAX_LAUNCH_DOCUMENTS)}, the first ones given`, () => {
    const many = Array.from({ length: MAX_LAUNCH_DOCUMENTS + 3 }, (_, index) => `C:\\d\\${String(index)}.pdf`);
    const taken = documentPathsIn(['Monstera.exe', ...many], true);
    expect(taken).toHaveLength(MAX_LAUNCH_DOCUMENTS);
    expect(taken[0]).toBe('C:\\d\\0.pdf');
  });
});

describe('createLaunchDocuments — handed over once', () => {
  it('the first launch’s paths, then a later launch’s, each taken once', () => {
    const waiting = createLaunchDocuments(['C:\\a.pdf']);
    waiting.add(['C:\\b.pdf']);
    expect(waiting.take()).toStrictEqual(['C:\\a.pdf', 'C:\\b.pdf']);
    // CONTROL: a second take answers nothing, so a page that asked twice opens nothing twice.
    expect(waiting.take()).toStrictEqual([]);
    waiting.add(['C:\\c.pdf']);
    expect(waiting.take()).toStrictEqual(['C:\\c.pdf']);
  });
});
