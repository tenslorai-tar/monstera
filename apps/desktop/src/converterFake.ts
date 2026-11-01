import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
  JOB_UI_RESTRICTIONS_ALL,
} from '@monstera/kernel';
import { ok } from '@monstera/shared';

import type { ConverterExecutablePath } from './containedProgram.js';
import type { ConverterPlatform } from './converterSession.js';
import type { JobHandle, ProcessHandle, ThreadHandle } from './engineHostFactory.js';
import type { ExitReading } from './externalConverter.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import type { DirectoryCreationSurface } from './sessionDirectories.js';

/**
 * A Ghostscript-shaped converter for the cases of the two converters that run it, PDF/A and text to curves: the
 * containment surfaces answer as a contained process would, and the "converter" writes `writes` followed by what it
 * READ, so a case can see which copy reached it. Ghostscript itself is measured by the research instruments.
 */

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

/**
 * @param root a directory the case removes afterwards; the sessions live under it
 * @param said what the converter prints
 */
export function fakeConverterPlatform(
  root: string,
  said: string | null,
  exit: ExitReading,
  writes: string,
): { readonly platform: ConverterPlatform; readonly argumentsSeen: (readonly string[])[] } {
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
        processorTime: () => null,
        diagnostics: () => said,
        discardDiagnostics: () => undefined,
        waitForExit: () => {
          const args = config.program.commandArguments;
          argumentsSeen.push(args);
          const output = args.find((arg) => arg.startsWith('-sOutputFile='))?.slice('-sOutputFile='.length);
          const input = args.at(-1);
          const read = input === undefined ? '' : readFileSync(input, 'latin1');
          if (output !== undefined) writeFileSync(output, `${writes} read:${read}`);
          return Promise.resolve(exit);
        },
      }),
    },
  };
}

/** A converter's output read to its end, as text. */
export async function drained(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += Buffer.from(chunk).toString('latin1');
  return text;
}
