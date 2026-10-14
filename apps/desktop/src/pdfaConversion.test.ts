import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_PDFA_REMOVALS } from '@monstera/contract';
import {
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
  JOB_UI_RESTRICTIONS_ALL,
} from '@monstera/kernel';
import { ok } from '@monstera/shared';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConverterExecutablePath } from './containedProgram.js';
import type { ConverterPlatform } from './converterSession.js';
import type { JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import type { ExitReading } from './externalConverter.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import {
  PDFA_OUTPUT_INTENT,
  PdfaFailedError,
  type PdfaFailure,
  type PdfaPreparer,
  checkedAs,
  createPdfaSource,
  pdfaArguments,
  removalsOf,
  undeclared,
} from './pdfaConversion.js';
import type { DirectoryCreationSurface } from './sessionDirectories.js';

/**
 * The PDF/A conversion's own rules. Ghostscript itself is measured by
 * `scripts/research/ghostscriptContained.mjs` through the shipped surfaces; here the
 * converter is a fake that writes an output and prints what the case gives it.
 */

let root = '';

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

const aProcess = { __handle: 'process' } as ProcessHandle;
const aThread = { __handle: 'thread' } as ThreadHandle;
const aJob = { __handle: 'job' } as JobHandle;

/** Directories made and removed with `node:fs`, so the session pair exists and its removal is observable. */
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

/** What Ghostscript writes at level 2, measured 2026-10-13: the XMP's attribute spelling and an output intent. */
const DECLARED_2 = "%PDF-1.7 converted <rdf:Description pdfaid:part='2' pdfaid:conformance='B'/> /OutputIntents [3 0 R]";

function platform(
  said: string | null,
  exit: ExitReading = { kind: 'exited', code: 0 },
  writes: string = DECLARED_2,
): {
  readonly platform: ConverterPlatform;
  readonly argumentsSeen: (readonly string[])[];
} {
  root = mkdtempSync(join(tmpdir(), 'monstera-pdfa-'));
  const argumentsSeen: (readonly string[])[] = [];
  let limit = 0;
  return {
    argumentsSeen,
    platform: {
      sessionRoot: join(root, 'sessions'),
      directories,
      user: { sid: 'S-1-5-21-1' } as unknown as UserSid,
      container: { sid: 'S-1-15-2-1' } as unknown as ContainerSid,
      containerName: 'monstera-pdfa-converter',
      executable: 'C:\\tools\\gswin64c.exe' as ConverterExecutablePath,
      bounds: { processMemoryLimitBytes: 64 * 1024 * 1024, timeoutMs: 1_000 },
      component: 'ghostscript',
      cannotStart: () => undefined,
      startProbe: ['-v'],
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
          uiRestrictions: JOB_UI_RESTRICTIONS_ALL,
        }),
        resume: () => 1,
        terminate: () => undefined,
        close: () => undefined,
        diagnostics: () => said,
        discardDiagnostics: () => undefined,
        waitForExit: () => {
          const args = config.program.commandArguments;
          argumentsSeen.push(args);
          const output = args.find((arg) => arg.startsWith('-sOutputFile='))?.slice('-sOutputFile='.length);
          // WHAT THE CONVERTER READ is echoed into what it wrote, so a case can see which copy reached it.
          const input = args.at(-1);
          const read = input === undefined ? '' : readFileSync(input, 'latin1');
          if (output !== undefined) writeFileSync(output, `${writes} read:${read}`);
          return Promise.resolve(exit);
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

describe('pdfaArguments — ADR-0075’s fixed command line', () => {
  it('asks for the chosen level, and only the level varies (the 2026-10-13 correction)', () => {
    const [one, two, three] = ([1, 2, 3] as const).map((level) => pdfaArguments('C:\\in.pdf', 'C:\\out.pdf', level));
    expect([one?.[0], two?.[0], three?.[0]]).toStrictEqual(['-dPDFA=1', '-dPDFA=2', '-dPDFA=3']);
    expect(one?.slice(1)).toStrictEqual(two?.slice(1));
    expect(three?.slice(1)).toStrictEqual(two?.slice(1));
  });

  it('asks for PDF/A-2 under policy 1, SAFER, with the inline output intent before the input', () => {
    expect(pdfaArguments('C:\\in.pdf', 'C:\\out.pdf', 2)).toStrictEqual([
      '-dPDFA=2',
      '-dBATCH',
      '-dNOPAUSE',
      '-dSAFER',
      '-sColorConversionStrategy=RGB',
      '-dPDFACompatibilityPolicy=1',
      '-sDEVICE=pdfwrite',
      '-sOutputFile=C:\\out.pdf',
      '-c',
      PDFA_OUTPUT_INTENT,
      '-f',
      'C:\\in.pdf',
    ]);
    expect(PDFA_OUTPUT_INTENT).toContain('(%rom%iccprofiles/srgb.icc)');
  });
});

describe('removalsOf — Ghostscript’s removal lines as the report', () => {
  it('keeps each line that says something is not permitted in PDF/A, once, in order', () => {
    const said = [
      'Processing pages 1 through 1.',
      'not permitted in PDF/A, annotation will not be present in output file',
      '   not permitted in PDF/A, annotation will not be present in output file',
      'Transparency group not permitted in PDF/A, removing',
    ].join('\r\n');
    expect(removalsOf(said)).toStrictEqual([
      'not permitted in PDF/A, annotation will not be present in output file',
      'Transparency group not permitted in PDF/A, removing',
    ]);
  });

  it('bounds how many lines a crafted document can make it answer', () => {
    const said = Array.from({ length: MAX_PDFA_REMOVALS + 10 }, (_unused, index) => `thing ${String(index)} not permitted in PDF/A`).join('\n');
    expect(removalsOf(said)).toHaveLength(MAX_PDFA_REMOVALS);
  });

  it('CONTROL: nothing printed is nothing removed, and a revert is not a removal', () => {
    expect(removalsOf(null)).toStrictEqual([]);
    expect(removalsOf('not permitted in PDF/A, reverting to normal PDF output')).toStrictEqual([]);
  });
});

/** A preparation that writes `text` as the prepared copy and names a pop-up left out on page 2. */
function preparing(text: string): { readonly prepare: PdfaPreparer; readonly discarded: () => number } {
  let discarded = 0;
  return {
    discarded: () => discarded,
    prepare: () => {
      const directory = mkdtempSync(join(root === '' ? tmpdir() : root, 'prepared-'));
      const path = join(directory, 'prepared.pdf');
      writeFileSync(path, text);
      return Promise.resolve({
        kind: 'prepared' as const,
        path,
        leftOut: [{ page: 1, kind: 'comment-popup' as const, count: 1 }],
        leftOutMore: 3,
        discard: () => {
          discarded += 1;
          rmSync(path, { force: true });
          return Promise.resolve();
        },
      });
    },
  };
}

const UNAVAILABLE: PdfaPreparer = () => Promise.resolve({ kind: 'unavailable' });

describe('createPdfaSource', () => {
  it('converts the PREPARED copy, names what it left out, counts the converter’s own lines, and leaves nothing behind', async () => {
    const built = platform('not permitted in PDF/A, annotation will not be present in output file');
    const prepared = preparing('%PDF-1.7 prepared');
    const source = createPdfaSource(built.platform, () => undefined, prepared.prepare);

    const converted = await source(new TextEncoder().encode('%PDF-1.7 flush'), 2, undefined);

    expect(converted.leftOut).toStrictEqual([{ page: 1, kind: 'comment-popup', count: 1 }]);
    expect(converted.leftOutMore).toBe(3);
    // COUNTED, never quoted: the answer carries no string of the converter's.
    expect(converted.otherLeftOut).toBe(1);
    expect(await drained(converted.output)).toBe(`${DECLARED_2} read:%PDF-1.7 prepared`);
    expect(prepared.discarded()).toBe(1);
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
    // FIXED NAMES in the granted pair, ADR-0075's arguments around them.
    const [args] = built.argumentsSeen;
    expect(args?.at(-1)).toMatch(/in\.pdf$/u);
    expect(args?.find((arg) => arg.startsWith('-sOutputFile='))).toMatch(/out\.pdf$/u);
  });

  it('CONTROL: with no preparation the flush itself is converted, and nothing is named', async () => {
    const built = platform(null);
    const reported: string[] = [];
    const source = createPdfaSource(built.platform, (failure) => reported.push(failure.detail), UNAVAILABLE);

    const converted = await source(new TextEncoder().encode('%PDF-1.7 flush'), 2, undefined);

    expect(converted.leftOut).toStrictEqual([]);
    expect(converted.leftOutMore).toBe(0);
    expect(converted.otherLeftOut).toBe(0);
    expect(await drained(converted.output)).toBe(`${DECLARED_2} read:%PDF-1.7 flush`);
    expect(reported).toStrictEqual(['the PDF/A copy was not prepared (unavailable); converting the document as it is']);
  });

  it('REFUSES an output that does not declare the level asked for, at the end of the stream (control: the same at 2)', async () => {
    // ASKED FOR 3, the converter declares 2: the stream passes every byte through and then fails, which is what makes
    // the atomic write remove its temporary file rather than keep a file that is not what was asked for.
    const asked3 = createPdfaSource(platform(null).platform, () => undefined, UNAVAILABLE);
    const wrongLevel = await asked3(new Uint8Array(4), 3, undefined);
    await expect(drained(wrongLevel.output)).rejects.toBeInstanceOf(PdfaFailedError);

    const noIntent = createPdfaSource(platform(null, undefined, "pdfaid:part='2' pdfaid:conformance='B'").platform, () => undefined, UNAVAILABLE);
    await expect(drained((await noIntent(new Uint8Array(4), 2, undefined)).output)).rejects.toBeInstanceOf(PdfaFailedError);

    const asked2 = createPdfaSource(platform(null).platform, () => undefined, UNAVAILABLE);
    await expect(drained((await asked2(new Uint8Array(4), 2, undefined)).output)).resolves.toContain('read:');
  });

  it('finds a declaration split across two chunks, and passes every byte through unchanged', async () => {
    const failed = (failure: PdfaFailure): PdfaFailedError => new PdfaFailedError(failure);
    async function* chunks(...parts: string[]): AsyncIterable<Uint8Array> {
      for (const part of parts) {
        await Promise.resolve();
        yield new TextEncoder().encode(part);
      }
    }
    // A CHUNK EDGE inside each declaration: the window kept across chunks is what finds them.
    const split = ["<x pdfaid:pa", "rt='3' pdfaid:confor", "mance='B'/> /Output", 'Intents ['];
    expect(await drained(checkedAs(chunks(...split), 3, failed))).toBe(split.join(''));
    // CONTROL: the same text read as one chunk is found too, and asking another level refuses it.
    await expect(drained(checkedAs(chunks(split.join('')), 2, failed))).rejects.toBeInstanceOf(PdfaFailedError);
  });

  it('reads both XMP spellings, and refuses a conformance other than B', () => {
    expect(undeclared('<pdfaid:part>1</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance> /OutputIntents', 1)).toBeNull();
    expect(undeclared("pdfaid:part='2' pdfaid:conformance='A' /OutputIntents", 2)).toContain('conformance');
  });

  it('REFUSES a conversion that reverted to plain PDF, reports it, and leaves no session area', async () => {
    const built = platform('not permitted in PDF/A, reverting to normal PDF output');
    const reported: string[] = [];
    const prepared = preparing('%PDF-1.7 prepared');
    const source = createPdfaSource(built.platform, (failure) => reported.push(failure.detail), prepared.prepare);

    await expect(source(new Uint8Array(4), 2, undefined)).rejects.toBeInstanceOf(PdfaFailedError);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('reverted to plain PDF');
    expect(prepared.discarded()).toBe(1);
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
  });

  it('REFUSES a converter that exits non-zero, having written a partial file (the outside-the-pair reading)', async () => {
    const built = platform('Error: /undefinedfilename', { kind: 'exited', code: 1 });
    const source = createPdfaSource(built.platform, () => undefined, UNAVAILABLE);

    await expect(source(new Uint8Array(4), 2, undefined)).rejects.toBeInstanceOf(PdfaFailedError);
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
  });
});
