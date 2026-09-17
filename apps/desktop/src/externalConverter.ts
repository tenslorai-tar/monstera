import { type Result, err, ok } from '@monstera/shared';

import {
  type HostCreationFailure,
  type HostCreationSurface,
  type ProcessHandle,
  createContainedHost,
} from './engineHostFactory.js';

/**
 * How a contained converter's process ended, as Win32 reports it.
 *
 * `unreadable` is its own state: a wait that failed, or an exit code that could
 * not be read, is *could not look* — never *exited 0*.
 */
export type ExitReading =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'timed-out' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/**
 * The host surface, plus the one thing a converter needs that a host does not:
 * to know when it has finished.
 *
 * An engine host announces itself by connecting to its pipe and lives until it
 * is told to stop. An external converter is *"run once on one input, producing
 * one output"* (§8), and says nothing on any pipe, so its end is its exit — and
 * the contract's *"a hung conversion is terminated"* needs that wait to be
 * bounded.
 */
export interface ConverterSurface extends HostCreationSurface {
  /**
   * Resolves when `process` exits or `timeoutMs` passes. Never blocks the
   * calling thread: the wait runs off it, so `main` keeps serving the renderer
   * while a conversion runs.
   */
  readonly waitForExit: (process: ProcessHandle, timeoutMs: number) => Promise<ExitReading>;
}

/** Why a conversion produced no output. */
export type ConverterFailure =
  | { readonly stage: 'start'; readonly failure: HostCreationFailure }
  | { readonly stage: 'timed-out'; readonly afterMs: number }
  | { readonly stage: 'exit-unreadable'; readonly detail: string }
  | { readonly stage: 'exit-code'; readonly code: number; readonly said: string | null };

/** The bounds §8 puts on every converter, from the job object and the wait. */
export interface ConverterBounds {
  readonly processMemoryLimitBytes: number;
  readonly timeoutMs: number;
}

/**
 * Runs one contained converter to its end: §8's external-converter seam.
 *
 * ## The containment is the ENGINE HOSTS', not a copy of it
 *
 * `createContainedHost` creates the process suspended, puts it in its job with
 * the memory limit, reads back membership, integrity and limits, and only then
 * resumes it. A converter needs exactly that and nothing else, so it takes it —
 * the second implementation of *start a contained process* is the defect §3's
 * one-host-body rule exists to prevent.
 *
 * ## The job is closed on EVERY path, and that is the kill
 *
 * The job is kill-on-close. Closing it after a timeout, an unreadable exit or a
 * failure ends anything the converter left running; closing it after a clean
 * exit ends nothing, because nothing is left. So there is no separate
 * kill-the-tree step to forget.
 */
export async function runContainedConverter(
  surface: ConverterSurface,
  bounds: ConverterBounds,
): Promise<Result<void, ConverterFailure>> {
  if (!Number.isInteger(bounds.timeoutMs) || bounds.timeoutMs < 1) {
    throw new RangeError(
      `timeoutMs must be a positive integer, received ${String(bounds.timeoutMs)}. A converter ` +
        'with no time bound is the hung conversion §8 says is terminated.',
    );
  }
  const started = createContainedHost(surface, bounds.processMemoryLimitBytes);
  if (!started.ok) return err({ stage: 'start', failure: started.error });
  const { process, job } = started.value;

  try {
    const exit = await surface.waitForExit(process, bounds.timeoutMs);
    switch (exit.kind) {
      case 'timed-out':
        surface.terminate(process);
        return err({ stage: 'timed-out', afterMs: bounds.timeoutMs });
      case 'unreadable':
        surface.terminate(process);
        return err({ stage: 'exit-unreadable', detail: exit.detail });
      case 'exited':
        return exit.code === 0
          ? ok(undefined)
          : err({ stage: 'exit-code', code: exit.code, said: surface.diagnostics() });
    }
  } finally {
    surface.close(process);
    surface.close(job);
    surface.discardDiagnostics();
  }
}
