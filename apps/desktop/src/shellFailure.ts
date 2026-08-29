// `import type`, NOT `import { type … }`, and the difference is the whole
// reason this line has a comment.
//
// The second form keeps the module specifier in the emitted JavaScript —
// `import {} from 'electron'` — which is a side-effect import that runs. This
// file is imported by `shellFailure.test.ts`, which vitest runs in **plain
// Node**, and in plain Node importing `electron` IS the download: `index.js`
// ends with `module.exports = getElectronPath()`, which fetches when the binary
// is absent, through an installer that bypasses our pin (invariant 26).
//
// Measured: it fetched. `node_modules/electron/dist` appeared at the minute the
// new unit test first ran. `import type` is erased entirely, so nothing remains
// to execute.
import type { App, WebContents } from 'electron';

// `import type` for the reason above, and the reason applies here with a
// different destination: `@monstera/kernel`'s barrel reaches `mupdfWriter.js`,
// which binds 38.1 MB of native MuPDF. Erased entirely, so this costs nothing
// at runtime and buys the union below.
import type { HostTermination } from '@monstera/kernel';

/**
 * The lifecycle failures nothing was listening to.
 *
 * **Scope widened 2026-08-27** (ADR-0023 Decision 9b). This said *"the failures
 * Electron announces"*, and that was true of all four members while all four
 * were Electron events. `engine-host-gone` is announced by **our own** transport,
 * because ADR-0022 made the engine hosts processes we create rather than
 * children Electron forks for us — so Electron does not know they exist and has
 * nothing to say about them.
 *
 * (Electron's fork API is deliberately not named here. `check:advisories`
 * watches that symbol for invariant 25, and its matcher is a `git grep` that
 * cannot tell naming a symbol from calling it — so a doc comment expires a live
 * verdict. That is KKK-1's shape, and the register's own re-triage records
 * rewording as the answer when the trigger's SUBJECT has not occurred. It fired
 * on this paragraph, at commit time, which is the mechanism working.)
 *
 * The reason the type exists is the **subscription**, not the identity of the
 * announcer: a failure channel a runtime announces on with nothing subscribed is
 * not a channel. That argument never depended on the runtime being Electron's,
 * so the members widen and the reasoning does not.
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

/**
 * The lifecycle failures subscribed to. Named, not inherited.
 *
 * `engine-host-gone` is deliberately **not** `child-process-gone`. That member
 * is Electron's event for a process Electron created; the engine host is a
 * process we create (ADR-0022), announced by our own transport. Sharing the name
 * would say the runtime told us when it did not — and the two carry different
 * fields, so a reader could not tell which one a detail line came from.
 *
 * `document-unreadable` is separate from `engine-host-gone` for the same reason
 * one step in: the host answered, and what it said was that these bytes will
 * never parse. Reporting that as the host having gone names a healthy process as
 * the fault, and every reading downstream — is the engine flaky, should it be
 * rebuilt, is this machine's install broken — is then drawn from a document's
 * own defect. `EngineOpenFailed`'s message states the same thing at the throw
 * site; this is where it stops being a message and becomes a category.
 */
export type ShellFailureEvent =
  | 'preload-error'
  | 'render-process-gone'
  | 'child-process-gone'
  | 'engine-host-gone'
  | 'document-unreadable'
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

/**
 * The message for an engine host connection that ended.
 *
 * ## Decision 9b asks for THREE things and this takes one — both departures
 *
 * The requirement is *"the `TransportEnd`'s `by` and `detail`, plus the
 * `HostTermination` code"*. Only the termination is taken. Each half is answered
 * here, because an earlier version of this comment quoted the phrase and then
 * addressed `by` alone, leaving `detail` substituted rather than considered
 * (finding GGGG-2).
 *
 * **`by` is folded into the code.** `engineHostConnection.ts`'s `reasonFor` has
 * already decided by the time this is called: a violation the client raised
 * keeps that violation's code, `by: 'peer'` with nothing raised becomes
 * `connection-lost`, and `by: 'us'` with nothing raised becomes `shutdown`. So
 * the code determines `by`, and passing both would be two fields that can
 * disagree about one fact. The distinction that mapping exists for survives:
 * **a host that crashed and a host we killed produce the same silence on the
 * pipe, and only the first is a defect.**
 *
 * **`detail` is the same string on the paths where it could have differed.**
 * `TransportEnd` and `HostTermination` carry separate diagnostics, so this was
 * read rather than assumed: `reasonFor` returns `detail: end.detail` **verbatim**
 * for both `connection-lost` and `shutdown` — which are exactly the endings where
 * no termination was constructed for a specific cause, and therefore where the
 * transport's own text is the informative one. On the violation path the detail
 * is the client's own, which is the better of the two there, since the client is
 * what detected the violation.
 *
 * ## The parameter is `HostTermination`, and a structural stand-in was a defect
 *
 * It was declared as `{ code: string; detail: string }` (finding IIII-1). The
 * whole behaviour of this function is one comparison against a string literal,
 * so a structural parameter made that comparison **a spelling test nothing
 * runs**: misspell `'shutdown'`, or rename the member in `runtime.ts` and miss
 * this line, and it compiles — and every deliberate close then reports the
 * crash message, on the ordinary shutdown path, where it would be read as a
 * real defect.
 *
 * The caller already had the union and handed it to a weaker parameter, which is
 * the tell for the general shape: **a structural parameter standing where a
 * declared union is available turns every literal comparison inside it into an
 * unchecked spelling test.** `proof:contract` holds the pair that proves it —
 * the wrong code is refused, and the right one still compiles.
 */
export function describeEngineHostGone(termination: HostTermination): ShellFailure {
  const deliberate = termination.code === 'shutdown';
  return {
    event: 'engine-host-gone',
    detail:
      `code=${termination.code} ${termination.detail}. ` +
      (deliberate
        ? 'We closed this connection, so nothing here is a fault.'
        : 'The host was supposed to be there. Sessions it held are gone and every document ' +
          'that had a call in flight has had its consecutive-failure count raised ' +
          '(ADR-0023 Decision 9a); at two with no success in between, that document is ' +
          'refused engine work rather than rebuilt for.'),
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
