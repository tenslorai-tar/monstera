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

import type { ContainedProgram, ConverterExecutablePath } from './containedProgram.js';
import type { JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import type { ConverterSurface, ExitReading } from './externalConverter.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import type { ConverterPlatform } from './converterSession.js';
import { LayoutTextFailedError, createLayoutTextSource } from './layoutText.js';
import type { DirectoryCreationSurface } from './sessionDirectories.js';
import type { ShellFailure } from './shellFailure.js';

/**
 * The layout-text source (ADR-0071) over a real session root on disk, with the
 * Win32 surfaces replaced: directories are made and removed with `node:fs`, and
 * the "converter" writes its output file when it is waited on, from the command
 * line it was given — so the cases see which arguments reached it.
 *
 * What only the real converter can say — that `pdftotext` starts contained and
 * lays text out — is `scripts/research/popplerContained.mjs`' and the live run's.
 */

let root = '';
afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
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

function platform(convert: (program: ContainedProgram) => ExitReading): {
  readonly platform: ConverterPlatform;
  readonly programs: ContainedProgram[];
  readonly inputsSeen: Uint8Array[];
} {
  root = mkdtempSync(join(tmpdir(), 'monstera-layout-text-'));
  const programs: ContainedProgram[] = [];
  const inputsSeen: Uint8Array[] = [];
  let limit = 0;
  return {
    programs,
    inputsSeen,
    platform: {
      sessionRoot: join(root, 'sessions'),
      directories,
      user: { sid: 'S-1-5-21-1' } as unknown as UserSid,
      container: { sid: 'S-1-15-2-1' } as unknown as ContainerSid,
      containerName: 'monstera-text-converter',
      executable: 'C:\\tools\\pdftotext.exe' as ConverterExecutablePath,
      bounds: { processMemoryLimitBytes: 64 * 1024 * 1024, timeoutMs: 1_000 },
      surfaceFor: (config): ConverterSurface => {
        programs.push(config.program);
        return {
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
          diagnostics: () => 'Syntax Error: the converter said so',
          discardDiagnostics: () => undefined,
          waitForExit: () => {
            const input = config.program.commandArguments[3];
            if (input !== undefined) inputsSeen.push(readFileSync(input));
            return Promise.resolve(convert(config.program));
          },
        };
      },
    },
  };
}

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const chunk of chunks) parts.push(chunk);
  return Buffer.concat(parts).toString('utf8');
}

const PDF = Uint8Array.of(0x25, 0x50, 0x44, 0x46);

describe('createLayoutTextSource', () => {
  it('runs pdftotext -layout on FIXED NAMES in the granted pair, streams its output, and leaves no area', async () => {
    const built = platform((program) => {
      const output = program.commandArguments[4];
      if (output !== undefined) writeFileSync(output, 'left column      right column\n\f');
      return { kind: 'exited', code: 0 };
    });

    const text = await collect(await createLayoutTextSource(built.platform, () => undefined)(PDF));

    expect(text).toBe('left column      right column\n\f');
    const [program] = built.programs;
    expect(program?.runs).toBe('converter');
    expect(program?.commandArguments.slice(0, 3)).toEqual(['-layout', '-enc', 'UTF-8']);
    // THE NAMES ARE FIXED: nothing a person named reaches the command line (§8).
    expect(program?.commandArguments[3]?.endsWith('in.pdf')).toBe(true);
    expect(program?.commandArguments[4]?.endsWith('out.txt')).toBe(true);
    // The converter read the bytes it was handed.
    expect(built.inputsSeen).toEqual([Buffer.from(PDF)]);
    // AND THE PAIR IS GONE once the stream is drained: a copy of a document in a
    // directory a container may read does not outlive the export.
    expect(readdirSync(built.platform.sessionRoot)).toEqual([]);
  });

  it('a converter that FAILS throws, is reported to the log with its own words, and leaves no area', async () => {
    const built = platform(() => ({ kind: 'exited', code: 1 }));
    const reported: ShellFailure[] = [];

    await expect(
      createLayoutTextSource(built.platform, (failure) => reported.push(failure))(PDF),
    ).rejects.toBeInstanceOf(LayoutTextFailedError);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.event).toBe('converter-failed');
    expect(reported[0]?.detail).toContain('Syntax Error: the converter said so');
    expect(readdirSync(built.platform.sessionRoot)).toEqual([]);
  });

  it('a stream ABANDONED part way still removes the area', async () => {
    const built = platform((program) => {
      const output = program.commandArguments[4];
      if (output !== undefined) writeFileSync(output, 'x'.repeat(256 * 1024));
      return { kind: 'exited', code: 0 };
    });

    const chunks = await createLayoutTextSource(built.platform, () => undefined)(PDF);
    for await (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      break;
    }

    expect(readdirSync(built.platform.sessionRoot)).toEqual([]);
  });
});
