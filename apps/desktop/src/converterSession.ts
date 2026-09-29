import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
 * One file through one external converter, as §8's seam runs it — the part every
 * converter shares: layout text (ADR-0071), PDF/A-2b (ADR-0075) and Office import (ADR-0120).
 *
 * A session pair granted to the converter's own container, the bytes to convert — a
 * document's, or a picked file's — copied in under a fixed name, the converter run to its end under the job's
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

/** Why a conversion produced nothing: the seam's own failures, the session area's, or an exit with no file. */
export type ConversionFailure =
  | ConverterFailure
  | { readonly stage: 'area'; readonly detail: string }
  | { readonly stage: 'no-output'; readonly said: string | null };

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
    case 'no-output':
      return `the converter exited 0 and wrote nothing${failure.said === null ? '' : `: ${failure.said}`}`;
  }
}

/**
 * What one conversion asks of the converter: its paths on the command line, or in a file of instructions.
 *
 * ## Two kinds, because a converter takes one or the other
 *
 * `x2t` takes its paths only from an instructions file — its positional form crashes (ADR-0120) — so the seam writes
 * that file into the snapshot directory under a fixed name, beside the input, and makes the working directory the
 * converter writes its intermediate files in. A kind rather than optional fields: a conversion with instructions and
 * a command line that ignores them is the state this cannot express.
 */
export type Conversion = ArgumentConversion | InstructedConversion;

interface ConversionNames {
  /** The input's fixed name in the snapshot directory. A picked file's name never reaches a command line (§8). */
  readonly input: string;
  /** The output's fixed name in the output directory. */
  readonly output: string;
}

/** A converter told its paths on the command line. */
export interface ArgumentConversion extends ConversionNames {
  readonly kind: 'arguments';
  /** The command line, given the two paths. */
  readonly commandArguments: (input: string, output: string) => readonly string[];
}

/** Where an instructed conversion's paths are, for the instructions that name them. */
export interface InstructedPaths {
  readonly input: string;
  readonly output: string;
  /** A directory in the output directory, made empty, for the converter's intermediate files. */
  readonly scratch: string;
}

/** A converter told its paths in a file. */
export interface InstructedConversion extends ConversionNames {
  readonly kind: 'instructions';
  /** The instructions file's fixed name in the snapshot directory. */
  readonly instructions: string;
  /** The scratch directory's fixed name in the output directory. */
  readonly scratch: string;
  /** The instructions' text, given the paths. */
  readonly instructionsText: (paths: InstructedPaths) => string;
  /** The command line, given the instructions file's path. */
  readonly commandArguments: (instructions: string) => readonly string[];
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
 * Runs `conversion` on `source`.
 *
 * @param failed turns a failure into the error its caller throws, so each converter's
 *   refusal keeps its own name and report
 */
export async function convertDocument(
  platform: ConverterPlatform,
  source: Uint8Array,
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
    await writeFile(input, source);

    let commandArguments: readonly string[];
    if (conversion.kind === 'arguments') {
      commandArguments = conversion.commandArguments(input, output);
    } else {
      const scratch = join(paths.output, conversion.scratch);
      const instructions = join(paths.snapshot, conversion.instructions);
      await mkdir(scratch);
      await writeFile(instructions, conversion.instructionsText({ input, output, scratch }), 'utf8');
      commandArguments = conversion.commandArguments(instructions);
    }

    const surface = platform.surfaceFor({
      program: {
        runs: 'converter',
        executablePath: platform.executable,
        commandArguments: [...commandArguments],
      },
      workingDirectory: dirname(platform.executable),
      containerName: platform.containerName,
      diagnosticPath: hostDiagnosticPath(platform.sessionRoot, diagnostic.value),
    });
    const ran = await runContainedConverter(surface, platform.bounds);
    if (!ran.ok) throw failed(ran.error);
    // EXITED 0 IS NOT WROTE ONE. Without this the missing file surfaced as a read error part way into the caller's
    // write, where it names a path in the session area rather than the converter.
    if (!existsSync(output)) throw failed({ stage: 'no-output', said: ran.value.said });

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
