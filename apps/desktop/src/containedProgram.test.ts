import { describe, expect, it } from 'vitest';

import {
  type ContainedProgram,
  type ConverterExecutablePath,
  type ElectronBinaryPath,
  NODE_MODE_FLAGS,
  commandLineFor,
  environmentFor,
} from './containedProgram.js';

// Casts are the test's own mints: this file checks what each branch PRODUCES, and
// the brands' job — restricting who may mint — is `proof:contract`'s and
// `check:electronbinary`'s, not this file's.
const HOST: ContainedProgram = {
  runs: 'electron-node',
  executablePath: 'C:/tools/electron/electron.exe' as ElectronBinaryPath,
  commandArguments: ['C:/app/hostEntry.js', '--pipe', 'p1'],
};

const CONVERTER: ContainedProgram = {
  runs: 'converter',
  executablePath: 'C:/tools/libreoffice/program/soffice.bin' as ConverterExecutablePath,
  commandArguments: ['--headless', '--convert-to', 'pdf', 'in.docx'],
};

describe('the command line follows from the program, never from the surface', () => {
  it('an engine host gets the Node interpreter flags, between the executable and its own arguments', () => {
    expect(commandLineFor(HOST)).toBe(
      '"C:/tools/electron/electron.exe" --preserve-symlinks --preserve-symlinks-main ' +
        '--no-stdio-init "C:/app/hostEntry.js" "--pipe" "p1"',
    );
  });

  it('THE DEFECT: a converter gets NONE of them, only its own arguments', () => {
    // This is the command line LibreOffice refused on 2026-09-16, with
    // `Error in option: --preserve-symlinks`, inside the container and outside
    // it. Asserted as the whole string rather than as the absence of one flag,
    // because a surface that dropped only the first would pass an absence check
    // and still be refused on the second.
    const line = commandLineFor(CONVERTER);
    expect(line).toBe(
      '"C:/tools/libreoffice/program/soffice.bin" "--headless" "--convert-to" "pdf" "in.docx"',
    );
    for (const flag of NODE_MODE_FLAGS) expect(line).not.toContain(flag);
  });

  it('CONTROL: the flag list is the three Node flags, so the case above is not vacuous', () => {
    // An empty NODE_MODE_FLAGS would satisfy "the converter's line contains none of
    // them" for free, and the host case would then fail for a different reason.
    expect(NODE_MODE_FLAGS).toStrictEqual([
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      '--no-stdio-init',
    ]);
  });
});

describe('the environment follows from the program', () => {
  const inherited = { PATH: 'C:/Windows', TEMP: 'C:/t', MISSING: undefined };

  it('an engine host runs as Node, whatever the parent had', () => {
    expect(environmentFor(HOST, inherited)).toStrictEqual([
      'PATH=C:/Windows',
      'TEMP=C:/t',
      'ELECTRON_RUN_AS_NODE=1',
    ]);
  });

  it('a converter carries NO run-as-node variable, even when the parent set one', () => {
    // BUILT FROM WHAT THE ABSENT GUARD WOULD PASS THROUGH: the parent here is an
    // Electron process in Node mode, which is exactly what a driver under
    // `scripts/` is. A converter environment that merely failed to ADD the
    // variable would still hand this one on.
    const fromNodeMode = { ...inherited, ELECTRON_RUN_AS_NODE: '1' };
    expect(environmentFor(CONVERTER, fromNodeMode)).toStrictEqual(['PATH=C:/Windows', 'TEMP=C:/t']);
  });

  it('the variable is removed case-insensitively, as Windows compares environment names', () => {
    const lower = { ...inherited, electron_run_as_node: '0' };
    expect(environmentFor(HOST, lower)).toStrictEqual([
      'PATH=C:/Windows',
      'TEMP=C:/t',
      'ELECTRON_RUN_AS_NODE=1',
    ]);
    expect(environmentFor(CONVERTER, lower)).toStrictEqual(['PATH=C:/Windows', 'TEMP=C:/t']);
  });
});
