import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MAX_PDFA_REMOVALS } from '@monstera/contract';
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
import { PDFA_OUTPUT_INTENT, PdfaFailedError, createPdfaSource, pdfaArguments, removalsOf } from './pdfaConversion.js';
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

function platform(said: string | null, exit: ExitReading = { kind: 'exited', code: 0 }): {
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
        diagnostics: () => said,
        discardDiagnostics: () => undefined,
        waitForExit: () => {
          const args = config.program.commandArguments;
          argumentsSeen.push(args);
          const output = args.find((arg) => arg.startsWith('-sOutputFile='))?.slice('-sOutputFile='.length);
          if (output !== undefined) writeFileSync(output, '%PDF-1.7 converted');
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
  it('asks for PDF/A-2 under policy 1, SAFER, with the inline output intent before the input', () => {
    expect(pdfaArguments('C:\\in.pdf', 'C:\\out.pdf')).toStrictEqual([
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

describe('createPdfaSource', () => {
  it('answers the converted file and what was removed, and leaves no session area once read', async () => {
    const built = platform('not permitted in PDF/A, annotation will not be present in output file');
    const source = createPdfaSource(built.platform, () => undefined);

    const converted = await source(new TextEncoder().encode('%PDF-1.7 input'));

    expect(converted.removed).toStrictEqual(['not permitted in PDF/A, annotation will not be present in output file']);
    expect(await drained(converted.output)).toBe('%PDF-1.7 converted');
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
    // FIXED NAMES in the granted pair, ADR-0075's arguments around them.
    const [args] = built.argumentsSeen;
    expect(args?.at(-1)).toMatch(/in\.pdf$/u);
    expect(args?.find((arg) => arg.startsWith('-sOutputFile='))).toMatch(/out\.pdf$/u);
  });

  it('REFUSES a conversion that reverted to plain PDF, reports it, and leaves no session area', async () => {
    const built = platform('not permitted in PDF/A, reverting to normal PDF output');
    const reported: string[] = [];
    const source = createPdfaSource(built.platform, (failure) => reported.push(failure.detail));

    await expect(source(new Uint8Array(4))).rejects.toBeInstanceOf(PdfaFailedError);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('reverted to plain PDF');
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
  });

  it('REFUSES a converter that exits non-zero, having written a partial file (the outside-the-pair reading)', async () => {
    const built = platform('Error: /undefinedfilename', { kind: 'exited', code: 1 });
    const source = createPdfaSource(built.platform, () => undefined);

    await expect(source(new Uint8Array(4))).rejects.toBeInstanceOf(PdfaFailedError);
    expect(readdirSync(built.platform.sessionRoot).filter((name) => !name.endsWith('.log'))).toStrictEqual([]);
  });
});
