import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
} from '@monstera/kernel';
import { MAX_OFFICE_MISSING_BLOCKS } from '@monstera/contract';
import { ok } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConverterExecutablePath } from './containedProgram.js';
import type { ConverterPlatform } from './converterSession.js';
import type { JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import type { ExitReading } from './externalConverter.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import {
  OfficeConversionFailedError,
  MAX_FAILED_PARTS_PER_SHEET,
  type WorkbookComposer,
  type WorkbookSheetOutline,
  X2T_FORMAT_PDF,
  X2T_MAX_PRINT_PAGES,
  createOfficeSource,
  namedBlocks,
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

function platform(
  options: {
    readonly writes?: boolean;
    readonly exit?: ExitReading;
    readonly echo?: boolean;
    /** Exits 80 having written nothing for an input this names — x2t at the job's memory limit. */
    readonly failWhen?: (input: string) => boolean;
  } = {},
): {
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
          if (options.failWhen?.(existsSync(input) ? readFileSync(input, 'latin1') : '') === true) {
            return Promise.resolve({ kind: 'exited', code: 80 });
          }
          // ECHO: the PDF names the part it was made from, so a workbook case can read which rows each part held.
          if (options.writes !== false) {
            writeFileSync(output, options.echo === true ? `%PDF ${readFileSync(input, 'latin1')}` : '%PDF-1.7 converted');
          }
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

/**
 * The compose host's workbook calls, in memory. A part is the text `part <sheet> <from>-<to>`, the fake x2t echoes it into
 * its PDF, and a PDF's page count is its rows over `rowsPerPage` — STOPPING AT x2t's CUT-OFF, as the real converter was
 * measured to, so a part past it reads as exactly {@link X2T_MAX_PRINT_PAGES} pages and its later rows are in no PDF.
 */
function workbookHost(
  sheets: readonly WorkbookSheetOutline[],
  options: {
    readonly rowsPerPage?: number;
    /** Sheets whose print area this host cannot narrow: a part asked for a block of them is `unsplittable`. */
    readonly unsplittable?: readonly string[];
    /** A sheet's print area ends at this row, so a block past it is `nothing`. */
    readonly areaEnds?: Readonly<Record<string, number>>;
    /** Sheets one row of which alone reaches the cut-off. */
    readonly tall?: readonly string[];
  } = {},
): { readonly composer: WorkbookComposer; readonly held: Map<string, string>; readonly parts: string[] } {
  const held = new Map<string, string>();
  const parts: string[] = [];
  let next = 0;
  const rowsPerPage = options.rowsPerPage ?? 25;
  const composer: WorkbookComposer = {
    put: async (source) => {
      let text = '';
      if (source instanceof Uint8Array) text = Buffer.from(source).toString('latin1');
      else for await (const chunk of source) text += Buffer.from(chunk).toString('latin1');
      const name = `n${String((next += 1))}`;
      held.set(name, text);
      return name;
    },
    remove: (name) => {
      held.delete(name);
      return Promise.resolve();
    },
    outline: () => Promise.resolve(sheets),
    part: (_name, index, rows) => {
      const sheet = sheets[index];
      if (sheet === undefined) return Promise.resolve({ kind: 'unreadable' });
      if (rows !== null && (options.unsplittable ?? []).includes(sheet.name)) return Promise.resolve({ kind: 'unsplittable' });
      const block = rows ?? { from: 1, to: sheet.lastRow };
      const areaEnd = options.areaEnds?.[sheet.name];
      if (areaEnd !== undefined && block.from > areaEnd) return Promise.resolve({ kind: 'nothing' });
      const text = `part ${sheet.name} ${String(block.from)}-${String(block.to)}`;
      parts.push(text);
      return Promise.resolve({ kind: 'written', bytes: new TextEncoder().encode(text) });
    },
    pages: (name) => {
      const match = /part (.+) (\d+)-(\d+)$/u.exec(held.get(name) ?? '');
      if (match === null) return Promise.resolve(null);
      if ((options.tall ?? []).includes(match[1] ?? '')) return Promise.resolve(X2T_MAX_PRINT_PAGES);
      const rows = Number(match[3]) - Number(match[2]) + 1;
      return Promise.resolve(Math.min(X2T_MAX_PRINT_PAGES, Math.ceil(rows / rowsPerPage)));
    },
    join: (names) => {
      const text = names.map((name) => held.get(name) ?? '?').join('|');
      async function* output(): AsyncIterable<Uint8Array> {
        await Promise.resolve();
        yield new TextEncoder().encode(text);
      }
      return Promise.resolve({ output: output(), discard: () => undefined });
    },
  };
  return { composer, held, parts };
}

/** The rows each joined part holds, per sheet, from the echoed PDFs. */
function joinedBlocks(text: string): string[] {
  return text.split('|').map((pdf) => pdf.replace(/^%PDF part /u, ''));
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

  /**
   * NO LAYOUT PARAMETER (decision C, measured): any `spreadsheetLayout` redraws a workbook — ten times smaller with
   * `ignorePrintArea: false` alone — so none is ever sent, and a workbook's sheets arrive as parts instead.
   */
  it('sends x2t no layout parameter, which would redraw the workbook', () => {
    const paths = { input: 'C:\\s\\in.xlsx', output: 'C:\\o\\out.pdf', scratch: 'C:\\o\\work' };
    expect(x2tInstructions(paths)).not.toContain('m_sJsonParams');
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

/**
 * Decision C: a workbook arrives whole — every visible sheet, and a sheet past x2t's 1,500-page cut-off in halves — or
 * the rows it lacks are named. Never lost in silence.
 */
describe('createOfficeSource — a workbook in parts', () => {
  const sheet = (name: string, lastRow: number, state: WorkbookSheetOutline['state'] = 'visible'): WorkbookSheetOutline => ({
    name,
    state,
    lastRow,
  });

  it('halves a sheet past the cut-off until every part is under it, and joins every row in order', async () => {
    // THE FIXTURE MUST BE ONE A SINGLE CONVERSION LOSES ROWS ON, or the case separates nothing.
    expect(Math.ceil(50_000 / 25)).toBeGreaterThan(X2T_MAX_PRINT_PAGES);
    const built = platform({ echo: true });
    const host = workbookHost([sheet('Data', 50_000)], { rowsPerPage: 25 });
    const reported: string[] = [];

    const converted = await createOfficeSource(built.platform, (line) => reported.push(line.event), host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['Data 1-25000', 'Data 25001-50000']);
    // THE CONTROL: the whole sheet was converted first and reached the cut-off — what a single conversion hands over.
    expect(host.parts[0]).toBe('part Data 1-50000');
    expect(converted.missing).toStrictEqual([]);
    expect(reported).toStrictEqual([]);
    // EVERYTHING PLACED IS REMOVED: the workbook and each part's PDF.
    expect(host.held.size).toBe(0);
  });

  it('converts every visible sheet as its own part, and no hidden or empty one', async () => {
    const built = platform({ echo: true });
    const host = workbookHost([sheet('First', 10), sheet('Secret', 40, 'hidden'), sheet('Blank', 0), sheet('Second', 30)]);

    const converted = await createOfficeSource(built.platform, () => undefined, host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['First 1-10', 'Second 1-30']);
    // NEVER THE WHOLE FILE: x2t alone prints only the active sheet.
    expect(built.seen.map((seen) => seen.inputBytes)).toStrictEqual(['part First 1-10', 'part Second 1-30']);
  });

  it('NAMES the rows of a sheet it cannot halve, joined into one block, logs them, and keeps the other sheets', async () => {
    const built = platform({ echo: true });
    const host = workbookHost([sheet('Locked', 50_000), sheet('Fine', 20)], { unsplittable: ['Locked'] });
    const reported: { event: string; detail: string }[] = [];

    const converted = await createOfficeSource(built.platform, (line) => reported.push(line), host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(converted.missing).toStrictEqual([{ sheet: 'Locked', from: 1, to: 50_000 }]);
    // THE CUT PDF IS NOT HANDED OVER as though it were the sheet: its rows are named instead.
    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['Fine 1-20']);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.event).toBe('workbook-rows-missing');
    expect(reported[0]?.detail).toContain('"Locked", rows 1 to 50000');
    expect(host.held.size).toBe(0);
  });

  it('names a single row that reaches the cut-off alone', async () => {
    const built = platform({ echo: true });
    const host = workbookHost([sheet('Tall', 2), sheet('Fine', 20)], { tall: ['Tall'] });

    const converted = await createOfficeSource(built.platform, () => undefined, host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(converted.missing).toStrictEqual([{ sheet: 'Tall', from: 1, to: 2 }]);
    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['Fine 1-20']);
  });

  it('skips a block the author’s print area does not reach — printed by nobody, so missing from nothing', async () => {
    const built = platform({ echo: true });
    const host = workbookHost([sheet('Data', 50_000)], { rowsPerPage: 25, areaEnds: { Data: 20_000 } });

    const converted = await createOfficeSource(built.platform, () => undefined, host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(converted.missing).toStrictEqual([]);
    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['Data 1-25000']);
  });

  /** How many rows a part the fake x2t was given holds. */
  const partRows = (input: string): number => {
    const match = /(\d+)-(\d+)$/u.exec(input);
    return match === null ? 0 : Number(match[2]) - Number(match[1]) + 1;
  };

  it('HALVES a part x2t fails on for its size, as it did at the memory limit, and every row arrives', async () => {
    // THE CONTROL IS THE FAKE'S RULE: the whole sheet fails, so a build that failed the import on it would lose it all.
    const built = platform({ echo: true, failWhen: (input) => partRows(input) > 30_000 });
    const host = workbookHost([sheet('Data', 50_000)], { rowsPerPage: 100 });
    const reported: string[] = [];

    const converted = await createOfficeSource(built.platform, (line) => reported.push(line.event), host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['Data 1-25000', 'Data 25001-50000']);
    expect(converted.missing).toStrictEqual([]);
    // SAID, though nothing was lost: the failed whole conversion is in the log with x2t's reason.
    expect(reported).toStrictEqual(['converter-failed']);
    expect(host.held.size).toBe(0);
  });

  it(`NAMES a sheet x2t always fails on once it has spent ${String(MAX_FAILED_PARTS_PER_SHEET)} conversions, and keeps the rest`, async () => {
    const built = platform({ echo: true, failWhen: (input) => input.includes('Broken') });
    const host = workbookHost([sheet('Broken', 1_000), sheet('Fine', 20)]);

    const converted = await createOfficeSource(built.platform, () => undefined, host.composer)(
      'xlsx',
      new TextEncoder().encode('PK workbook'),
    );

    expect(converted.missing).toStrictEqual([{ sheet: 'Broken', from: 1, to: 1_000 }]);
    expect(joinedBlocks(await drained(converted.output))).toStrictEqual(['Fine 1-20']);
    // BOUNDED: the budget, then no more conversions of that sheet — and the other sheet's one.
    expect(built.seen.filter((seen) => seen.inputBytes?.includes('Broken') === true)).toHaveLength(MAX_FAILED_PARTS_PER_SHEET);
    expect(host.held.size).toBe(0);
  });

  it('fails the import when NO part converts, and leaves nothing placed', async () => {
    const built = platform({ writes: false, exit: { kind: 'exited', code: 80 } });
    const host = workbookHost([sheet('Data', 10)]);

    await expect(
      createOfficeSource(built.platform, () => undefined, host.composer)('xlsx', new TextEncoder().encode('PK workbook')),
    ).rejects.toBeInstanceOf(OfficeConversionFailedError);
    expect(host.held.size).toBe(0);
    expect(leftovers(built)).toStrictEqual([]);
  });

  it('SAYS so in the log where there is no compose host, and converts the workbook once', async () => {
    const built = platform();
    const reported: { event: string; detail: string }[] = [];

    await createOfficeSource(built.platform, (line) => reported.push(line))('xlsx', new TextEncoder().encode('PK workbook'));

    expect(built.seen).toHaveLength(1);
    expect(reported[0]?.event).toBe('converter-failed');
    expect(reported[0]?.detail).toContain('active sheet only');
  });
});

describe('namedBlocks — the missing rows as a person is told them', () => {
  it('joins a block to the one before it on the same sheet, and nothing else', () => {
    expect(
      namedBlocks([
        { sheet: 'A', from: 1, to: 10 },
        { sheet: 'A', from: 11, to: 20 },
        { sheet: 'A', from: 30, to: 40 },
        { sheet: 'B', from: 41, to: 50 },
      ]),
    ).toStrictEqual([
      { sheet: 'A', from: 1, to: 20 },
      { sheet: 'A', from: 30, to: 40 },
      { sheet: 'B', from: 41, to: 50 },
    ]);
  });

  it('answers null past the contract’s bound rather than naming some and dropping the rest', () => {
    const apart = (count: number): { sheet: string; from: number; to: number }[] =>
      Array.from({ length: count }, (_, index) => ({ sheet: 'A', from: index * 10 + 1, to: index * 10 + 5 }));
    expect(namedBlocks(apart(MAX_OFFICE_MISSING_BLOCKS))).toHaveLength(MAX_OFFICE_MISSING_BLOCKS);
    expect(namedBlocks(apart(MAX_OFFICE_MISSING_BLOCKS + 1))).toBeNull();
  });
});
