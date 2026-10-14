import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CREATION_FLAGS,
  PROCESS_CREATION_FLAGS,
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

  it('hands on the variables Windows defines and none a shell or a person added (CR-SEC-18)', () => {
    // BUILT FROM WHAT THE ABSENT GUARD WOULD PASS: a launching shell holding a client secret, a key and NODE_OPTIONS,
    // beside the system's own variables in the case Windows reports them.
    const shell = {
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      Path: 'C:\\Windows\\system32',
      TMP: 'C:\\t',
      LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
      MONSTERA_GOOGLE_CLIENT_SECRET: 'not-for-the-host',
      ANTHROPIC_API_KEY: 'not-for-the-host',
      NODE_OPTIONS: '--require C:\\elsewhere.js',
    };
    for (const program of [HOST, CONVERTER]) {
      const handed = environmentFor(program, shell);
      expect(handed.filter((entry) => !entry.startsWith('ELECTRON_RUN_AS_NODE='))).toStrictEqual([
        'SystemRoot=C:\\Windows',
        'windir=C:\\Windows',
        'Path=C:\\Windows\\system32',
        'TMP=C:\\t',
        'LOCALAPPDATA=C:\\Users\\a\\AppData\\Local',
      ]);
      expect(handed.join('\n')).not.toContain('not-for-the-host');
      expect(handed.join('\n')).not.toContain('NODE_OPTIONS');
    }
  });
});

describe('every contained process is created with no console window (the owner’s N7)', () => {
  /** Whether a set of creation flags carries `bit`. */
  const carries = (flags: number, bit: number): boolean => (flags & bit) === bit;

  it('the one flag set carries CREATE_NO_WINDOW beside the three the containment needs', () => {
    expect(carries(PROCESS_CREATION_FLAGS, 0x08000000)).toBe(true);
    for (const flag of [CREATION_FLAGS.EXTENDED_STARTUPINFO_PRESENT, CREATION_FLAGS.CREATE_UNICODE_ENVIRONMENT, CREATION_FLAGS.CREATE_SUSPENDED]) {
      expect(carries(PROCESS_CREATION_FLAGS, flag)).toBe(true);
    }
    // CONTROL: the set the owner's build created Ghostscript with is told apart by the same reading, so the check above
    // is not one any number passes.
    expect(carries(0x00080000 | 0x00000400 | 0x00000004, 0x08000000)).toBe(false);
  });

  it('the one creation site passes that set and spells no flag of its own', () => {
    // A SOURCE READING, because `win32HostSurface.ts` loads koffi and no Linux test can create a process with it: what is
    // asserted is that the call takes the named set and that no second spelling of a flag exists beside it (B3a).
    const surface = readFileSync(fileURLToPath(new URL('./win32HostSurface.ts', import.meta.url)), 'utf8');
    const call = /bindings\.createProcess\(([\s\S]*?)\);/u.exec(surface)?.[1] ?? '';
    expect(call).toContain('PROCESS_CREATION_FLAGS');
    expect(surface).not.toMatch(/const CREATE_[A-Z_]+ = 0x/u);
    expect(surface).not.toMatch(/const EXTENDED_STARTUPINFO_PRESENT = 0x/u);
  });

  /**
   * THE CHECK THAT DOES NOT DEPEND ON HOW LONG A CONVERSION RUNS (item 9, 2026-10-14). The exports walk looks for a
   * console window every 100 ms, so a conversion shorter than one look passes unseen. What makes every conversion
   * windowless is that every process this application creates goes through the one call above; so the shipped code is
   * scanned for any other way to start one: a `child_process` import, or a binding to a Windows function that starts
   * a program. CONTROL: the scan finds the one site it must, so an empty answer is never a blind one.
   */
  it('no shipped module starts a process any other way than the one creation site', () => {
    const roots = ['.', '../../../packages/kernel/src', '../../../packages/nodemode/src'].map((root) =>
      fileURLToPath(new URL(`${root}/`, import.meta.url)),
    );
    const files = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) && !name.endsWith('.d.ts'))
        .map((name) => join(root, name)),
    );
    const starters: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/from ['"](?:node:)?child_process['"]/u.test(text)) starters.push(`${basename(file)}: child_process`);
      for (const match of text.matchAll(/func\(\s*['"][^'"]*\b(CreateProcess\w*|ShellExecute\w*|WinExec)\s*\(/gu)) {
        starters.push(`${basename(file)}: ${match[1] ?? ''}`);
      }
    }
    expect(files.length, 'the scan read the shipped sources').toBeGreaterThan(100);
    expect(starters).toStrictEqual(['win32HostSurface.ts: CreateProcessW']);
  });
});
