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
import type { ShellFailureSink } from './shellFailure.js';

/**
 * Layout-preserving text: §3's *Text extraction* row, its layout half
 * ([ADR-0071](../../../docs/DECISIONS/0071-layout-preserving-text-is-popplers-pdftotext-in-a-contained-process.md)).
 *
 * Poppler's `pdftotext -layout`, run once per export through §8's external-
 * converter seam: a session pair granted to the converter's own container, the
 * document's current bytes copied in under a fixed name, the converter run to
 * its end under the job's bounds, and the text read back out of the output
 * directory as a STREAM.
 *
 * ## The text is never resident in `main`, which is ADR-0035
 *
 * The answer is an async iterable over the output file's chunks, which
 * `writeStreamedDocument` pulls as it writes — so `main` holds one read
 * buffer's worth of text at a time, as the plain export holds one page's.
 *
 * ## The pair goes on EVERY path
 *
 * A failed start, a failed conversion, a write that stopped part way and a
 * write that finished all remove the pair: the stream's own `finally` for the
 * paths that reach it, and this function's `catch` for the ones that do not.
 */
export type LayoutTextSource = (pdf: Uint8Array) => Promise<AsyncIterable<Uint8Array>>;

/** A conversion that produced no text, with why — thrown, so the export reports it. */
export class LayoutTextFailedError extends Error {
  readonly failure: ConverterFailure | { readonly stage: 'area'; readonly detail: string };

  constructor(failure: LayoutTextFailedError['failure']) {
    super(`layout-preserving text could not be extracted: ${describeFailure(failure)}`);
    this.name = 'LayoutTextFailedError';
    this.failure = failure;
  }
}

function describeFailure(failure: LayoutTextFailedError['failure']): string {
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

/**
 * The bounds §8 puts on this converter.
 *
 * **Ceilings against a hung or hostile conversion, not performance budgets.**
 * Measured 2026-09-17 on this machine with `pdftotext -layout` 26.09.0, uncontained:
 * the eleven-document corpus at most **1,090 ms and 11.8 MB peak working set**,
 * and a generated 2,000-page text-dense document (6.4 MB) **9,021 ms and
 * 41.2 MB**, writing 10.3 MB of text. Ten minutes is 66 times the larger reading
 * and a gibibyte 25 times its memory: nothing a person would wait for is cut
 * off, and a parser spinning on a crafted file is.
 */
export const LAYOUT_TEXT_BOUNDS: ConverterBounds = {
  processMemoryLimitBytes: 1024 * 1024 * 1024,
  timeoutMs: 10 * 60 * 1000,
};

/** Everything the extraction needs from the machine, injectable so it can be tested without one. */
export interface LayoutTextPlatform {
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

/** A fresh session-directory name. Through the allowlist, as every host area's is. */
function mintName(): ReturnType<typeof sessionDirectoryName> {
  return sessionDirectoryName(randomBytes(16).toString('hex'));
}

/**
 * @param report where a failed conversion's reason goes. The export answers the
 *   renderer only *failed*; the converter's own words land in the shell log.
 */
export function createLayoutTextSource(platform: LayoutTextPlatform, report: ShellFailureSink): LayoutTextSource {
  const failed = (failure: LayoutTextFailedError['failure']): LayoutTextFailedError => {
    const error = new LayoutTextFailedError(failure);
    report({ event: 'converter-failed', detail: error.message });
    return error;
  };
  return async (pdf) => {
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
      // FIXED NAMES. A picked file's name never reaches a command line (§8); the
      // document's own name never reaches this function at all.
      const input = join(paths.snapshot, 'in.pdf');
      const output = join(paths.output, 'out.txt');
      await writeFile(input, pdf);

      const surface = platform.surfaceFor({
        program: {
          runs: 'converter',
          executablePath: platform.executable,
          commandArguments: ['-layout', '-enc', 'UTF-8', input, output],
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
      return streamThenRemove(output, remove);
    } catch (thrown) {
      remove();
      throw thrown;
    }
  };
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
