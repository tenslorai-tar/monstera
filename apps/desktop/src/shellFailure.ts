import { type App, type WebContents } from 'electron';

/**
 * The failures Electron announces and nothing was listening to.
 *
 * ## The finding this closes, and why it is a class rather than a bug
 *
 * The preload had never executed. Electron said so on `preload-error` and on no
 * other channel — no stderr, no exception, a window that came up looking
 * correct — and `preload-error` was subscribed in exactly one place in this
 * repository: the test harness. So the *product* had the property the finding
 * describes: if the bridge stops loading, for any reason, the app runs and
 * nothing anywhere says otherwise.
 *
 * Closing the one broken preload and leaving the channel that announced it
 * unsubscribed in production is Rule 0's *fix the class, not the instance* with
 * the instance fixed and the class untouched. **A failure channel a runtime
 * announces on, and nothing subscribes to, is not a channel.**
 *
 * ## Its own type, not `Incident`
 *
 * `Incident` is `{ id, channel, diagnostic }` and its `channel` means *the IPC
 * channel a failure was crossing when it did not cross*. A renderer crash has no
 * IPC channel, and reusing the field would make it mean two things a reader
 * cannot tell apart.
 *
 * It also does not belong in `@monstera/contract`: that package is the **wire**
 * contract, and none of these ever reach the wire. The same boundary already
 * rejected a Node-shaped concern there once — `incident.ts` records that a sink
 * which printed was refused because the contract may not reach a process — and
 * the argument is unchanged. This is a shell concern, and the shell is the only
 * package that can observe it.
 *
 * ## Diagnostics keep their paths
 *
 * The opposite of the IPC rule, for the opposite reason. An `Incident`'s
 * diagnostic is stripped because it is about to cross to a renderer that must
 * never see a path (invariant 2). A `ShellFailure` never crosses anything: it
 * goes from main to whoever main logs with. `preload-error` carried the absolute
 * path of the file that failed, and that path is what identified the defect.
 */

/** The lifecycle failures subscribed to. Named, not inherited. */
export type ShellFailureEvent =
  | 'preload-error'
  | 'render-process-gone'
  | 'child-process-gone'
  | 'unresponsive';

/** One lifecycle failure, flattened for a log. */
export interface ShellFailure {
  readonly event: ShellFailureEvent;
  /** What failed, in the terms the event reported it. Keeps paths. */
  readonly detail: string;
}

/**
 * Receives every lifecycle failure.
 *
 * Must not throw, for the same reason `IncidentSink` must not: it runs while a
 * failure is already in progress, and a throwing sink replaces a diagnosable
 * failure with an undiagnosable one.
 */
export type ShellFailureSink = (failure: ShellFailure) => void;

/**
 * The message for a preload that did not load.
 *
 * Separated from the subscription so the wording is unit-testable without an
 * Electron runtime, and because the wording is the entire value of the
 * subscription: this exact string, with this exact path, is what turned a
 * missing bridge into a five-minute fix.
 */
export function describePreloadError(preloadPath: string, error: Error): ShellFailure {
  return {
    event: 'preload-error',
    detail:
      `${preloadPath}: ${error.name}: ${error.message}. The renderer has no bridge, and the ` +
      `window will otherwise look correct. A SyntaxError here means the shell is loading the ` +
      `ESM artefact tsc emits rather than the CommonJS bundle from scripts/build/preload.mjs.`,
  };
}

/** The message for a renderer that died. */
export function describeRenderProcessGone(details: {
  readonly reason: string;
  readonly exitCode: number;
}): ShellFailure {
  return {
    event: 'render-process-gone',
    detail:
      `reason=${details.reason} exitCode=${String(details.exitCode)}. The document is not lost ` +
      `— main owns it — but this window's view of it is gone.`,
  };
}

/** The message for a child process that died. */
export function describeChildProcessGone(details: {
  readonly type: string;
  readonly reason: string;
  readonly exitCode: number;
  readonly name?: string;
  readonly serviceName?: string;
}): ShellFailure {
  return {
    event: 'child-process-gone',
    detail:
      `type=${details.type} reason=${details.reason} exitCode=${String(details.exitCode)}` +
      (details.name === undefined ? '' : ` name=${details.name}`) +
      (details.serviceName === undefined ? '' : ` service=${details.serviceName}`) +
      `. ` +
      `An engine host dying is the DESIGNED response to a containment breach (invariant 25); ` +
      `it is reported here so that a kill and a crash are distinguishable in a log.`,
  };
}

/** The message for a renderer that stopped answering. */
export function describeUnresponsive(): ShellFailure {
  return {
    event: 'unresponsive',
    detail:
      'The renderer stopped answering. Not fatal and not ignorable: a freeze that resolves ' +
      'itself leaves no other trace, so an unlogged one is a bug report with nothing in it.',
  };
}

/**
 * Subscribes a window's contents to the failures it can announce.
 *
 * Called by `createMainWindow`, so a window that exists is a window that
 * reports. The alternative — subscribing at the composition root — would let a
 * window be created without one, which is the state this module exists to make
 * unrepresentable.
 */
export function reportRendererFailures(contents: WebContents, sink: ShellFailureSink): void {
  contents.on('preload-error', (_event, preloadPath, error) => {
    sink(describePreloadError(preloadPath, error));
  });
  contents.on('render-process-gone', (_event, details) => {
    sink(describeRenderProcessGone(details));
  });
  contents.on('unresponsive', () => {
    sink(describeUnresponsive());
  });
}

/**
 * Subscribes the app to failures that are not any one window's.
 *
 * `child-process-gone` is on `app` rather than on `WebContents` — the utility
 * processes it reports are the engine hosts, which belong to no window.
 */
export function reportProcessFailures(app: App, sink: ShellFailureSink): void {
  app.on('child-process-gone', (_event, details) => {
    sink(describeChildProcessGone(details));
  });
}
