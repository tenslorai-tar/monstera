import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
} from '@monstera/kernel';
import { ok } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConverterExecutablePath } from './containedProgram.js';
import type { ConverterPlatform } from './converterSession.js';
import type { JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import type { ExitReading } from './externalConverter.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import {
  OfficeConversionFailedError,
  X2T_FORMAT_PDF,
  createOfficeSource,
  officeImportFormatOf,
  x2tInstructions,
} from './officeConversion.js';
import type { DirectoryCreationSurface } from './sessionDirectories.js';

/**
 * Office import's own rules (ADR-0120). x2t itself is measured by `scripts/research/officeLive.mjs`
 * through the shipped surfaces; here the converter is a fake that does what x2t does with its one
 * argument — reads the instructions file, and writes where it says — so what these cases assert is
 * what x2t would have been told.
 */

let root = '';

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

const aProcess = { __handle: 'process' } as ProcessHandle;
const aThread = { __handle: 'thread' } as ThreadHandle;
const aJob = { __handle: 'job' } as JobHandle;

const directories: DirectoryCreationSurface = {
  create: (path) => {
    if (existsSync(path)) return 'exists';
    mkdirSync(path);
    return 'created';
  },
  remove: (path) => {
    rmSync(path, { recursive: true, force: true });
    return true;
  },
  removeTree: (path) => {
    rmSync(path, { recursive: true, force: true });
    return true;
  },
  list: () => [],
  listFiles: () => [],
  removeFile: () => true,
  lastError: () => 0,
};

/** What the fake converter found when it ran: its arguments, the instructions, and what they named. */
interface Seen {
  readonly commandArguments: readonly string[];
  readonly instructions: string;
  readonly inputBytes: string | null;
  readonly scratchExisted: boolean;
}

/** The value of one element in x2t's instructions, unescaped. */
function field(instructions: string, name: string): string | undefined {
  const raw = new RegExp(`<${name}>([^<]*)</${name}>`, 'u').exec(instructions)?.[1];
  return raw?.replaceAll('&apos;', "'").replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
}

function platform(options: { readonly writes?: boolean; readonly exit?: ExitReading } = {}): {
  readonly platform: ConverterPlatform;
  readonly seen: Seen[];
} {
  root = mkdtempSync(join(tmpdir(), 'monstera-office-'));
  const seen: Seen[] = [];
  let limit = 0;
  return {
    seen,
    platform: {
      sessionRoot: join(root, 'sessions'),
      directories,
      user: { sid: 'S-1-5-21-1' } as unknown as UserSid,
      container: { sid: 'S-1-15-2-1' } as unknown as ContainerSid,
      containerName: 'monstera-office-converter',
      executable: 'C:\\tools\\x2t.exe' as ConverterExecutablePath,
      bounds: { processMemoryLimitBytes: 64 * 1024 * 1024, timeoutMs: 1_000 },
      surfaceFor: (config) => ({
        createSuspended: () => ok({ pid: 9, process: aProcess, thread: aThread }),
        createJob: () => aJob,
        applyLimits: (_job, bytes) => {
          limit = bytes;
          return true;
        },
        assignToJob: () => true,
        readJobMembership: () => 'in-job',
        readIntegrity: () => ({ kind: 'read', rid: INTEGRITY_LOW }),
        readJobLimits: () => ({
          kind: 'read',
          limitFlags: JOB_LIMIT_ACTIVE_PROCESS | JOB_LIMIT_PROCESS_MEMORY | JOB_LIMIT_KILL_ON_JOB_CLOSE,
          activeProcessLimit: 1,
          processMemoryLimitBytes: limit,
        }),
        resume: () => 1,
        terminate: () => undefined,
        close: () => undefined,
        diagnostics: () => null,
        discardDiagnostics: () => undefined,
        waitForExit: () => {
          const commandArguments = config.program.commandArguments;
          const instructions = readFileSync(commandArguments[0] ?? '', 'utf8');
          const input = field(instructions, 'm_sFileFrom') ?? '';
          const output = field(instructions, 'm_sFileTo') ?? '';
          const scratch = field(instructions, 'm_sTempDir') ?? '';
          seen.push({
            commandArguments,
            instructions,
            inputBytes: existsSync(input) ? readFileSync(input, 'latin1') : null,
            scratchExisted: existsSync(scratch),
          });
          if (options.writes !== false) writeFileSync(output, '%PDF-1.7 converted');
          return Promise.resolve(options.exit ?? { kind: 'exited', code: 0 });
        },
      }),
    },
  };
}

async function drained(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += Buffer.from(chunk).toString('latin1');
  return text;
}

/** The session area's entries, less the diagnostics log a run leaves beside it. */
function leftovers(built: { readonly platform: ConverterPlatform }): string[] {
  return readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'));
}

describe('x2tInstructions — the file x2t takes its paths from', () => {
  it('names the session paths absolutely, the tree relatively, and PDF by x2t’s number', () => {
    const text = x2tInstructions({ input: 'C:\\s\\in.docx', output: 'C:\\o\\out.pdf', scratch: 'C:\\o\\work' });
    expect(field(text, 'm_sFileFrom')).toBe('C:\\s\\in.docx');
    expect(field(text, 'm_sFileTo')).toBe('C:\\o\\out.pdf');
    expect(field(text, 'm_sTempDir')).toBe('C:\\o\\work');
    expect(field(text, 'm_nFormatTo')).toBe(String(X2T_FORMAT_PDF));
    // RELATIVE, because the cache provisioning pinned names the fonts relative to the tree.
    expect(field(text, 'm_sFontDir')).toBe('fonts');
    expect(field(text, 'm_sAllFontsPath')).toBe('sdkjs/common/AllFonts.js');
    expect(field(text, 'm_sThemeDir')).toBe('sdkjs/slide/themes');
  });

  it('escapes what XML reserves, so a path cannot end an element and start another', () => {
    const text = x2tInstructions({ input: 'C:\\a&b\\<x>\'"\\in.docx', output: 'C:\\o.pdf', scratch: 'C:\\w' });
    expect(text).not.toContain('a&b');
    expect(text).toContain('a&amp;b\\&lt;x&gt;&apos;&quot;');
    expect(field(text, 'm_sFileFrom')).toBe('C:\\a&b\\<x>\'"\\in.docx');
  });
});

describe('officeImportFormatOf — the format a picked name gives', () => {
  it('reads the three measured formats, in any case', () => {
    expect(officeImportFormatOf('C:\\Reports\\Q3.docx')).toBe('docx');
    expect(officeImportFormatOf('C:\\Reports\\Q3.XLSX')).toBe('xlsx');
    expect(officeImportFormatOf('deck.PpTx')).toBe('pptx');
  });

  it('refuses every other name, including one that only CONTAINS a format', () => {
    expect(officeImportFormatOf('C:\\old.doc')).toBeNull();
    expect(officeImportFormatOf('C:\\report.docx.exe')).toBeNull();
    expect(officeImportFormatOf('C:\\folder.docx\\file')).toBeNull();
    expect(officeImportFormatOf('docx')).toBeNull();
  });
});

describe('createOfficeSource', () => {
  it('writes the file under a fixed name, tells x2t where by instructions alone, and streams the PDF', async () => {
    const built = platform();
    const source = createOfficeSource(built.platform, () => undefined);

    const converted = await source('xlsx', new TextEncoder().encode('PK workbook'));

    expect(await drained(converted.output)).toBe('%PDF-1.7 converted');
    const [seen] = built.seen;
    // ONE ARGUMENT, the instructions: x2t's positional form crashed (ADR-0120).
    expect(seen?.commandArguments).toHaveLength(1);
    expect(seen?.commandArguments[0]).toMatch(/x2t\.xml$/u);
    expect(field(seen?.instructions ?? '', 'm_sFileFrom')).toMatch(/in\.xlsx$/u);
    expect(seen?.inputBytes).toBe('PK workbook');
    // THE SCRATCH DIRECTORY EXISTS WHEN x2t STARTS, inside the pair's writable half.
    expect(seen?.scratchExisted).toBe(true);
    expect(leftovers(built)).toStrictEqual([]);
  });

  it('removes the area unread when the caller discards it', async () => {
    const built = platform();
    const converted = await createOfficeSource(built.platform, () => undefined)('docx', new Uint8Array(4));

    converted.discard();

    expect(leftovers(built)).toStrictEqual([]);
  });

  it('REFUSES a converter that exits non-zero, reports why, and leaves no area', async () => {
    const built = platform({ writes: false, exit: { kind: 'exited', code: 80 } });
    const reported: string[] = [];
    const source = createOfficeSource(built.platform, (failure) => reported.push(failure.detail));

    await expect(source('pptx', new Uint8Array(4))).rejects.toBeInstanceOf(OfficeConversionFailedError);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('exited 80');
    expect(leftovers(built)).toStrictEqual([]);
  });

  it('REFUSES a converter that exits 0 having written nothing — at the seam, not as a read error later', async () => {
    const built = platform({ writes: false });
    const reported: string[] = [];
    const source = createOfficeSource(built.platform, (failure) => reported.push(failure.detail));

    const refused = await source('docx', new Uint8Array(4)).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(OfficeConversionFailedError);
    expect((refused as OfficeConversionFailedError).failure.stage).toBe('no-output');
    expect(reported[0]).toContain('exited 0 and wrote nothing');
    expect(leftovers(built)).toStrictEqual([]);
  });
});
