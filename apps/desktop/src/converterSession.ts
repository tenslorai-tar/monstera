import { randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ContainedProgram, ConverterExecutablePath } from './containedProgram.js';
import {
  type ConverterBounds,
  type ConverterFailure,
  type ConverterSurface,
  runContainedConverter,
} from './externalConverter.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import {
  type DirectoryCreationSurface,
  createSessionDirectories,
  hostDiagnosticPath,
  removeSessionDirectories,
  sessionDirectoryName,
  sessionDirectoryPaths,
} from './sessionDirectories.js';

/**
 * One document through one external converter, as §8's seam runs it — the part every
 * converter of a document shares: layout text (ADR-0071) and PDF/A-2b (ADR-0075).
 *
 * A session pair granted to the converter's own container, the document's current
 * bytes copied in under a fixed name, the converter run to its end under the job's
 * bounds, and its output read back as a STREAM, so `main` holds one read buffer's
 * worth of it (ADR-0035).
 *
 * ## The pair goes on EVERY path
 *
 * A failed start, a failed conversion, a write that stopped part way and a write that
 * finished all remove the pair: the stream's own `finally` for the paths that reach it,
 * and this function's `catch` for the ones that do not.
 */

/** Everything a conversion needs from the machine, injectable so it can be tested without one. */
export interface ConverterPlatform {
  readonly sessionRoot: string;
  readonly directories: DirectoryCreationSurface;
  readonly user: UserSid;
  readonly container: ContainerSid;
  readonly containerName: string;
  readonly executable: ConverterExecutablePath;
  readonly surfaceFor: (config: {
    readonly program: ContainedProgram;
    readonly workingDirectory: string;
    readonly containerName: string;
    readonly diagnosticPath: string;
  }) => ConverterSurface;
  readonly bounds: ConverterBounds;
}

/** Why a conversion produced nothing: the seam's own failures, or the session area's. */
export type ConversionFailure = ConverterFailure | { readonly stage: 'area'; readonly detail: string };

/** A failure in words, for a converter's error message and the shell log. */
export function describeConversionFailure(failure: ConversionFailure): string {
  switch (failure.stage) {
    case 'area':
      return `the converter's directories: ${failure.detail}`;
    case 'start':
      return `the converter did not start contained (${failure.failure.stage}): ${failure.failure.detail}`;
    case 'timed-out':
      return `the converter ran past ${String(failure.afterMs)} ms and was terminated`;
    case 'exit-unreadable':
      return `the converter's exit could not be read: ${failure.detail}`;
    case 'exit-code':
      return `the converter exited ${String(failure.code)}${failure.said === null ? '' : `: ${failure.said}`}`;
  }
}

/** What one conversion asks of the converter. */
export interface Conversion {
  /** The input's fixed name in the snapshot directory. A picked file's name never reaches a command line (§8). */
  readonly input: string;
  /** The output's fixed name in the output directory. */
  readonly output: string;
  /** The command line, given the two paths. */
  readonly commandArguments: (input: string, output: string) => readonly string[];
}

/** A conversion that succeeded: what the converter printed, and its output as it is read. */
export interface Converted {
  readonly said: string | null;
  readonly output: AsyncIterable<Uint8Array>;
  /** Removes the pair without reading the output — for a caller that refuses what was written. */
  readonly discard: () => void;
}

/** A fresh session-directory name. Through the allowlist, as every host area's is. */
function mintName(): ReturnType<typeof sessionDirectoryName> {
  return sessionDirectoryName(randomBytes(16).toString('hex'));
}

/**
 * Runs `conversion` on `pdf`.
 *
 * @param failed turns a failure into the error its caller throws, so each converter's
 *   refusal keeps its own name and report
 */
export async function convertDocument(
  platform: ConverterPlatform,
  pdf: Uint8Array,
  conversion: Conversion,
  failed: (failure: ConversionFailure) => Error,
): Promise<Converted> {
  const areaName = mintName();
  const diagnostic = mintName();
  if (!areaName.ok || !diagnostic.ok) {
    throw failed({ stage: 'area', detail: 'a session name was refused' });
  }
  mkdirSync(platform.sessionRoot, { recursive: true });
  const paths = sessionDirectoryPaths(platform.sessionRoot, areaName.value);
  const made = createSessionDirectories(platform.directories, paths, platform.user, platform.container);
  if (!made.ok) {
    throw failed({ stage: 'area', detail: `${made.error.stage}: ${made.error.detail}` });
  }

  const remove = (): void => {
    removeSessionDirectories(platform.directories, paths);
  };

  try {
    const input = join(paths.snapshot, conversion.input);
    const output = join(paths.output, conversion.output);
    await writeFile(input, pdf);

    const surface = platform.surfaceFor({
      program: {
        runs: 'converter',
        executablePath: platform.executable,
        commandArguments: [...conversion.commandArguments(input, output)],
      },
      workingDirectory: dirname(platform.executable),
      containerName: platform.containerName,
      diagnosticPath: hostDiagnosticPath(platform.sessionRoot, diagnostic.value),
    });
    const ran = await runContainedConverter(surface, platform.bounds);
    if (!ran.ok) throw failed(ran.error);

    // The input has done its work, and a copy of the document in a directory a
    // container may read does not wait for the write to finish.
    await rm(input, { force: true });
    return { said: ran.value.said, output: streamThenRemove(output, remove), discard: remove };
  } catch (thrown) {
    remove();
    throw thrown;
  }
}

async function* streamThenRemove(path: string, remove: () => void): AsyncIterable<Uint8Array> {
  try {
    for await (const chunk of createReadStream(path)) {
      yield chunk as Uint8Array;
    }
  } finally {
    remove();
  }
}
