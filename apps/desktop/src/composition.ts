import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ENGINE_HOST_MAX_IN_FLIGHT, type IncidentSink, createClient } from '@monstera/contract';
import {
  CapabilityRegistry,
  CommandBus,
  type ContainmentVerdict,
  DocumentNotOpenError,
  DocumentService,
  type HostTermination,
  type ProbeTarget,
  type RegisteredWriter,
  type SessionAreaSurface,
  type WriterRegistry,
  classifyContainment,
  createRemoteSessions,
  engineChannels,
  nodeFileSurface,
  remoteMupdfWriter,
  siblingNames,
} from '@monstera/kernel';
import type { DocId } from '@monstera/shared';

import {
  ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES,
  MAIN_DOCUMENT_BYTES_CEILING,
} from './budget.js';
import { type AppInfo, type PickDocument, createContractHandlers } from './contractHandlers.js';
import {
  DocumentCommands,
  type DocumentSessions,
  MissingSessionError,
} from './documentCommands.js';
import {
  type EngineHostConnection,
  type EngineHostConnectionSurfaces,
  createEngineHostConnection,
} from './engineHostConnection.js';
import {
  type EngineOpenFromPath,
  type SessionAreaOwner,
  EngineSessions,
  onDocumentOpened,
  onEngineHostEnded,
  openEngineSession,
} from './engineSessions.js';
import type { ContainerSid, UserSid } from './hostDacl.js';
import {
  type DirectoryCreationSurface,
  type DirectoryPath,
  createSessionDirectories,
  removeSessionDirectories,
  sessionDirectoryName,
  sessionDirectoryPaths,
} from './sessionDirectories.js';
import type { ShellFailureSink } from './shellFailure.js';
import type { ShellDependencies } from './main.js';

/**
 * Everything creating a contained engine host needs that this file may not hold.
 *
 * ## Injected for the same reason `PickDocument` is, and a second one
 *
 * The four surfaces bind Win32 through `koffi`. Importing them here would put a
 * native binding in every process that builds this graph — including
 * `perf:gate`'s main-service role, whose whole subject is main's fixed cost, and
 * including the platforms where those calls do not exist. `pickDocument` makes
 * the same trade against Electron; this one is against the platform.
 *
 * `createEngineHostConnection` itself is imported rather than injected, and that
 * is deliberate: its entire import graph is free of both Electron and `koffi`
 * because every native call it makes arrives through these surfaces. So the
 * ORDERING — what is created, in what order, and what happens when it dies — is
 * assembled here where it can be read, and only the foreign calls come from
 * outside.
 */
export interface EngineHostPlatform {
  /** The Win32 surfaces the connection factory drives. */
  readonly surfaces: EngineHostConnectionSurfaces;
  /** This process's user, and the container the host runs as. */
  readonly user: UserSid;
  readonly container: ContainerSid;
  /** Where a session's granted directory pair is created. */
  readonly sessionRoot: string;
  /** `CreateDirectoryW` and its siblings. */
  readonly directories: DirectoryCreationSurface;
  /**
   * The two paths ADR-0023 §5's startup check is taken against.
   *
   * `positive` is one the host MUST reach and `negative` one it must not. The
   * negative's bytes are read by main immediately before the ask, in
   * {@link engineSessionOpener}, because a refusal against a path nothing could
   * read separates nothing — which is the input the classifier refuses outright.
   */
  readonly probe: {
    readonly positive: ProbeTarget;
    readonly negative: ProbeTarget;
  };
}

/**
 * The composition root: the one place that builds the object graph.
 *
 * ## Why this is assembly and not design
 *
 * Everything it constructs was decided elsewhere. `ARCHITECTURE.md` §2 fixes
 * what `DocumentService` owns, §3 fixes the writer of record, ADR-0009 §7 fixes
 * the lane and §6 the routing, ADR-0021 fixes the retention policy. This file
 * makes no decision that is not already law; if it starts to, that is B4 and the
 * law changes first.
 *
 * It is deliberately **not** the Electron entry point. `entry.ts` is, and it does
 * one thing: call `startShell` with what this returns. Keeping them apart is
 * what lets the whole graph be built and inspected without an Electron runtime —
 * nothing here imports Electron, which the boundary lint enforces for every
 * package and does not enforce for this one, so it is stated instead.
 *
 * ## THE ENGINE SESSION IS CREATED AT OPEN, AND NEVER IN THIS PROCESS
 *
 * `document.execute` resolves a session inside the document's lane and reports a
 * miss as a defect. The session itself is never opened here:
 *
 * - §2's process diagram puts MuPDF in a separate process, and says of it
 *   *"NO in-main fallback — native faults are uncatchable (L20)"*. Opening a
 *   MuPDF session here would put the native parser in `main`, which invariant 20
 *   forbids by name.
 * - §9.17 argues `main`'s budget from *"main holds canonical bytes and never
 *   parses"*. A parser in `main` is the regression that number exists to catch,
 *   and it was measured at 38.1 MB arriving by accident through a type-only
 *   import.
 *
 * So what this file wires is the **contained host** and the moment a session is
 * asked for: {@link onDocumentOpened}, entered as `document.open` returns, per
 * [ADR-0023](../../../docs/DECISIONS/0023-how-the-contained-engine-host-is-built.md)
 * Decision 9c.
 *
 * ## THE HOST IS BUILT AT THE FIRST OPEN, NOT AT STARTUP
 *
 * Decided here because the ADR does not settle it, and a first implementation
 * would settle it silently. The alternatives were: at startup, or at the first
 * open.
 *
 * At startup, every launch pays for a `CreateProcessW` with an AppContainer and
 * a job object whether or not a document is ever opened — and this application
 * has a start screen, so *no document* is a state it is designed to sit in.
 *
 * The rebuild path decides it. Decision 9c already requires the supervisor to
 * rebuild a dead host, so a **build-if-absent** call has to exist regardless;
 * making the first open take that same path means there is one way a host comes
 * into existence rather than two, and the startup case would have been the
 * second (B3a). The promise is held so that two documents opened together share
 * one host — *one host per engine* is 9c's own words — and cleared when it ends
 * so the next open rebuilds rather than awaiting a dead one.
 *
 * ## WHAT HAPPENS WITH NO PLATFORM, WHICH IS NOT NOTHING
 *
 * `enginePlatform` is `null` wherever the Win32 surfaces do not exist — every
 * unit test, and every platform that is not Windows. A document still opens,
 * and {@link onDocumentOpened} still runs: creation fails, the failure is
 * counted, and at Decision 9a's bound of two the document is **poisoned**.
 *
 * That is the point rather than a consolation. `document.execute` against a
 * poisoned document answers the **declared** `document-poisoned`; against an
 * open document with no entry at all it answers `internal`, because a
 * `MissingSessionError` is defined as a defect. Those are two very different
 * things to show a user, and the difference is whether this call is made.
 *
 * Finding KKKK-3: for one commit it was not. `document.open` landed while three
 * documents and one proof still said *opening a document is not a channel*, and
 * every input the renderer could construct reached a declared outcome only
 * because it could not open one. `proof:shell` passed throughout, correctly —
 * its case executes against a `DocId` that was never opened, so it cannot reach
 * the state its own header called unreachable.
 */
export function createShellDependencies(
  appInfo: AppInfo,
  pickDocument: PickDocument,
  enginePlatform: EngineHostPlatform | null = null,
): ShellDependencies {
  const capabilities = new CapabilityRegistry();

  // Built before the service because the service **registers** it, not after
  // because something later calls it. `EngineSessions` entries are defined to
  // live exactly as long as the record, and `DocumentService` is the only thing
  // that knows a record ended — so the supervisor learns about a close by being
  // handed to the seam that already exists for it (`DocumentTeardown`: *"releases
  // whatever a document holds outside this index — the engine session, above
  // all"*), rather than by a `release(docId)` some future close path has to
  // remember to call. Finding FFFF-1.
  const engine = new EngineSessions();

  const documents = new DocumentService(capabilities, {
    documentBytesCeiling: MAIN_DOCUMENT_BYTES_CEILING,
    teardown: engine.releaseOnClose,
  });

  // BUILT BEFORE THE BUS, because the bus routes `mupdf` to a writer this
  // returns. The order is the dependency: a writer that talks to the engine
  // host cannot exist before something can build one.
  const engineHost = engineSessionOpener(
    enginePlatform,
    documents,
    engine,
    reportShellFailure,
  );

  // NO LONGER EMPTY. `WriterRegistry` stays partial because the seam declares
  // four writers of record and one has an adapter; a command routed to an
  // unregistered writer is refused by name rather than failing at a native
  // call. What changed is that `mupdf` is now registered, and the object behind
  // it runs commands in the engine host rather than in this process —
  // invariant 20 is satisfied by *where the session is*, not by the registry
  // being empty.
  const bus = new CommandBus(engineHost.writers);

  // The real supervisor rather than two inline arrows: a stubbed lookup and a
  // stubbed predicate are a second implementation of a rule the supervisor owns
  // (B3a). It is no longer empty by construction — {@link onDocumentOpened}
  // below puts an entry in it for every document that opens, sessioned where a
  // host can be built and poisoned where one cannot.
  // THE FLUSH IS COMPOSED HERE, and here is the only place it can be. The
  // registered writer and the session are both in scope on this line and
  // nowhere else — `engineHost.writers` was just built and `engine` holds the
  // sessions — so this is where §4's "flush each writer of record once" is a
  // determinate instruction rather than a routing decision. `documentCommands`
  // therefore names no writer of record, which is what keeps the one routing
  // table in `commandDeclarations` (B3a).
  //
  // `mupdf` is named because it is the one adapter that exists, and it is
  // reached through the registry rather than around it: an unregistered writer
  // is refused by name here exactly as `CommandBus` refuses one.
  const commands = new DocumentCommands(documents, bus, engine, {
    deps: {
      checkWriteTarget: (docId) => documents.checkWriteTarget(docId),
      surface: nodeFileSurface,
      names: siblingNames,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    flush: (docId, sessions) => {
      const writer = engineHost.writers.mupdf;
      const session = sessions.mupdf;
      // A DEFECT, not an outcome, and the same one `MissingSessionError` names
      // for a command: the holder of sessions and the open-document index have
      // diverged, or a document is being saved through a writer that was never
      // registered. Reported as a class so the boundary turns it into
      // `internal` with the diagnostic kept main-side, rather than telling a
      // user their save was refused for a reason they can act on.
      if (writer === undefined || session === undefined) {
        throw new MissingSessionError(docId, 'mupdf');
      }
      return writer.serialise(session);
    },
  });

  const openedDocument = engineHost.openedDocument;

  return {
    // `pickDocument` is a PARAMETER, not an import, and that is what keeps this
    // file's stated property true: nothing here imports Electron, so the whole
    // graph can be built and inspected in a plain Node test. The picker is the
    // one part of opening that genuinely needs a runtime, so it is the one part
    // that arrives from `entry.ts` — the same trade this file already makes for
    // `AppInfo`, which is a value rather than a call to `app.getVersion()`.
    handlers: createContractHandlers({
      appInfo,
      capabilities,
      commands,
      documents,
      openedDocument,
      pickDocument,
    }),
    incidents: reportIncident,
    failures: reportShellFailure,
  };
}

/**
 * The host's lifetime and one document's session, assembled.
 *
 * ## The returned function is deliberately not awaited by its caller
 *
 * {@link onDocumentOpened} queues the entry in the document's lane **before**
 * its first `await`, so by the time this returns, the entry sits ahead of every
 * command the user can issue next. Awaiting it would make every open as slow as
 * a host build, and the ordering that makes *sessioned or poisoned, never
 * neither* a property of the shape rather than a check does not depend on it.
 *
 * ## One host, and the promise is the thing that makes it one
 *
 * Two documents opened together both call `ensure`; the second finds the
 * promise the first left and awaits the same connection. The promise is
 * cleared on failure and on the host's ending — a rejected promise left in
 * place would refuse every later open with the first attempt's error, which is
 * the shape of a cache that has learnt a transient failure permanently.
 *
 * @param platform the Win32 surfaces, or `null` where they do not exist
 * @param documents the service holding the canonical image
 * @param sessions the supervisor whose state this fills in
 * @param failures where a host death is reported
 */
function engineSessionOpener(
  platform: EngineHostPlatform | null,
  documents: DocumentService,
  sessions: EngineSessions,
  failures: ShellFailureSink,
): { readonly openedDocument: (docId: DocId) => void; readonly writers: WriterRegistry } {
  /** The live host, or the attempt to build one. Cleared when it ends. */
  let host: Promise<EngineHostConnection> | null = null;

  /**
   * The writer the bus routes `mupdf` to, bound to whichever host is live.
   *
   * ## Why it is late-bound rather than passed in
   *
   * The bus is constructed once, at startup, and a writer that talks to the
   * engine host cannot exist until a host does — which is at the first open, by
   * this file's own decision. So the registration is a stable object whose
   * members read this on every call.
   *
   * ## Why `null` here is a DEFECT and not a state to tolerate
   *
   * A command only reaches the bus if `documentCommands` already resolved a
   * session for its document, and a session exists only because a host issued
   * it. So a `mupdf` command arriving with no writer means the sessions and the
   * host have diverged — the same inconsistency `MissingSessionError` names one
   * layer up, and it is reported the same way rather than being papered over
   * with a refusal that would read as an outcome.
   */
  let writer: RegisteredWriter<'mupdf'> | null = null;

  const live = (): RegisteredWriter<'mupdf'> => {
    if (writer === null) {
      throw new Error(
        'A mupdf command reached the bus with no engine host writer registered. A session was ' +
          'resolved for this document, so one was issued by a host — the supervisor and the ' +
          'host connection have diverged.',
      );
    }
    return writer;
  };

  // WRITTEN OUT rather than produced by a proxy or a generic delegator. Four
  // named members are what a reader can check against `RegisteredWriter`; a
  // clever one is a second opinion about what the bus calls, and it would keep
  // compiling after the interface changed (B7's no-premature-abstraction, and
  // the reason `localMupdfExecution` is written out too).
  const writers: WriterRegistry = {
    mupdf: {
      capture: (session, command) => live().capture(session, command),
      apply: (session, command) => live().apply(session, command),
      // THREE ARGUMENTS, because a recorded inverse does not carry its own
      // kind the way a command does — the asymmetry is `CommandExecution`'s and
      // is the same one the pipe has.
      invert: (session, kind, inverse) => live().invert(session, kind, inverse),
      serialise: (session) => live().serialise(session),
    },
  };

  /**
   * Tokens are minted from handles ONE host issued, and
   * `createRemoteSessions`' own words are that they are *"not transferable
   * between hosts"*. So the registry is rebuilt with the host rather than held
   * across a death, where a surviving token would name a handle in a process
   * that no longer exists.
   */
  let remote = createRemoteSessions();

  const connect = async (): Promise<EngineHostConnection> => {
    if (platform === null) {
      throw new Error(
        'No engine host platform was supplied to the composition root, so no engine session ' +
          'can be created. This is the state every unit test and every non-Windows run is in; ' +
          'a document opened here is poisoned rather than left sessionless.',
      );
    }
    remote = createRemoteSessions();
    const live = await createEngineHostConnection(platform.surfaces, {
      // A fresh name per host. A pipe name that outlived its host would be one
      // a later process could be waiting on while a different one answers.
      pipeName: `\\\\.\\pipe\\monstera-engine-${randomBytes(16).toString('hex')}`,
      user: platform.user,
      container: platform.container,
      readBytes: 64 * 1024,
      maxOutstandingWrites: 16,
      maxInFlight: ENGINE_HOST_MAX_IN_FLIGHT,
      processMemoryLimitBytes: ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES,
      correlate: () => randomBytes(8).toString('hex'),
      onEnded: (termination: HostTermination) => {
        // CLEARED FIRST, so that the reopen entries this schedules find no host
        // and build a new one. Left in place, every one of them would await a
        // connection whose client has already settled every call.
        host = null;
        // AND THE WRITER WITH IT. A writer left bound to a dead host answers
        // every command with a rejection from a client that has already
        // terminated — which is a worse shape than the diagnostic `live()`
        // raises, because it names the transport rather than the divergence.
        writer = null;
        void onEngineHostEnded(sessions, termination, {
          documents,
          failures,
          closedMeanwhile: (error) => error instanceof DocumentNotOpenError,
          // SWALLOWED HERE, DELIBERATELY, AND THIS IS THE ONE PLACE IT IS
          // CORRECT. `onEngineHostEnded` awaits this before entering each
          // document's lane, and a rejection would escape into a `void`ed
          // promise — an unhandled rejection in `main`, with the reopen
          // entries never queued and no diagnostic naming why.
          //
          // A failed rebuild is not lost: every document's reopen then fails to
          // create a session, `recordFailure` counts it, and Decision 9a
          // poisons at the bound. The state each document ends in is the same
          // whether the host could not be built or its session could not be
          // opened, which is what makes discarding the reason here safe rather
          // than convenient. Found by a case that reddened with an unhandled
          // rejection rather than a failure (KKKK-7).
          rebuild: async () => {
            await ensure().catch(() => undefined);
          },
          reopen: create,
        });
      },
    });
    if (!live.ok) {
      throw new Error(
        `the engine host was refused at ${live.error.stage}: ${live.error.detail}`,
      );
    }

    // ADR-0023 §5's STARTUP CHECK, before this host is handed a document, and
    // the reason it is here rather than inside the connection factory: the
    // factory is the side that can kill the process, and `classifyContainment`
    // lives in `packages/kernel`, which may not name Electron. This is the one
    // place that holds both.
    //
    // A host whose verdict is anything but `contained` is closed and reported.
    // The failure it exists to catch is not a crash — it is a host that WORKS
    // and is not contained, which every cheap question answers `yes` for.
    const verdict = await containmentOf(live.value, platform);
    if (verdict.kind !== 'contained') {
      live.value.close();
      throw new Error(
        `the engine host was created and is not contained (${verdict.kind}): ` +
          ('detail' in verdict ? verdict.detail : 'no detail'),
      );
    }

    // BOUND AFTER THE VERDICT, which is the whole of the ordering. A writer
    // registered before the containment check is one the bus could route a
    // command to while the host is still unverified — and the verdict's job is
    // to catch a host that WORKS and is not contained, so nothing downstream
    // would notice.
    writer = remoteMupdfWriter(
      createClient(engineChannels, live.value.client.invoke),
      remote,
      sessionAreas(platform),
    );
    return live.value;
  };

  const ensure = (): Promise<EngineHostConnection> =>
    (host ??= connect().catch((error: unknown) => {
      host = null;
      throw error;
    }));

  const create = async (docId: DocId): Promise<DocumentSessions> => {
    const live = await ensure();
    if (platform === null) throw new Error('unreachable: a host exists without a platform');

    // The typed surface, derived from the channel declarations rather than
    // spelled here: a channel name this file gets wrong is a missing property
    // rather than a frame the host silently refuses (B3a).
    const client = createClient(engineChannels, live.client.invoke);

    // LOWER-CASE HEX, which is what both allowlists accept — the directory
    // name's and `engine/open`'s. They agree because the host is hostile by
    // invariant 25 and normally the one supplying such a name.
    const minted = sessionDirectoryName(randomBytes(16).toString('hex'));
    if (!minted.ok) throw new Error(`the session directory name was refused: ${minted.error}`);
    const snapshotName = randomBytes(16).toString('hex');
    const paths = sessionDirectoryPaths(platform.sessionRoot, minted.value);

    // The pair is created INSIDE `create` rather than before it, because
    // `openEngineSession` removes it on every failure path out of itself and
    // takes that responsibility only from the moment it calls this.
    const areas: SessionAreaOwner = {
      create: () => {
        const made = createSessionDirectories(
          platform.directories,
          paths,
          platform.user,
          platform.container,
        );
        if (!made.ok) {
          throw new Error(`the handed pair was not created: ${made.error.stage}: ${made.error.detail}`);
        }
        return Promise.resolve({ snapshotPath: join(paths.snapshot, snapshotName) });
      },
      remove: () => {
        removeSessionDirectories(platform.directories, paths);
        return Promise.resolve();
      },
    };

    // THE PATH, NEVER THE BYTES. `openEngineSession` has the service write the
    // canonical image straight into the granted directory, so main never holds
    // a second copy and this function never holds the document at all.
    const open: EngineOpenFromPath = async () => {
      const answer = await client['engine/open']({
        snapshotDirectory: paths.snapshot,
        snapshotName,
        outputDirectory: paths.output,
      });
      if (!answer.ok) throw new Error(`engine/open answered ${answer.error.code}`);
      // THE AREA GOES IN WITH THE HANDLE. A token stands for both halves and
      // the registry owns the pair (ADR-0030 Decision 2), which is what lets
      // `serialise` and `close` work on a session this root opened — they read
      // the area from here rather than from a map private to the adapter.
      return remote.adopt(answer.value.session, {
        snapshotDirectory: paths.snapshot,
        outputDirectory: paths.output,
      });
    };

    const { session } = await openEngineSession(documents, docId, areas, open);
    return { mupdf: session };
  };

  const openedDocument = (docId: DocId): void => {
    void onDocumentOpened(sessions, docId, {
      documents,
      failures,
      closedMeanwhile: (error) => error instanceof DocumentNotOpenError,
      create,
    });
  };

  return { openedDocument, writers };
}

/**
 * How a session's granted directories are reached once it exists.
 *
 * `takeOutput` reads what the host wrote and **deletes it on the way out**:
 * every serialise is another whole copy of the user's document, and a
 * save-heavy session would otherwise leave one per save in a directory the
 * contained host may read.
 *
 * ## The paths are re-branded, and that is a restoration rather than a forgery
 *
 * `DirectoryPath` is minted by `sessionDirectoryPaths`, which
 * {@link engineSessionOpener}'s own `create` calls twenty lines up — these are
 * those strings, arriving back through a kernel type that cannot carry the
 * brand because `packages/kernel` may not name it. The cast is visible in a
 * diff, which is what the brand is for: it makes forging one a sentence a
 * reviewer reads rather than an accident.
 */
function sessionAreas(platform: EngineHostPlatform): SessionAreaSurface {
  return {
    // LOWER-CASE HEX, which is what `outputNameSchema` accepts. Main mints the
    // name and sends it, so the host never names a file main reads back — a
    // host that could would have main open an arbitrary path and take the bytes
    // as the user's document.
    mintName: () => randomBytes(16).toString('hex'),
    takeOutput: async (area, name) => {
      const path = join(area.outputDirectory, name);
      const bytes = await readFile(path);
      await rm(path, { force: true });
      return new Uint8Array(bytes);
    },
    remove: (area) => {
      removeSessionDirectories(platform.directories, {
        snapshot: area.snapshotDirectory as DirectoryPath,
        output: area.outputDirectory as DirectoryPath,
      });
      return Promise.resolve();
    },
  };
}

/**
 * ADR-0023 §5's check, asked of one live host.
 *
 * ## Main reads the negative path FIRST, and that is the whole rigour
 *
 * `classifyContainment` refuses a request whose `readableBytes` is not positive
 * before it looks at any outcome, because a refusal against a path an
 * uncontained reader could not read either is not evidence of anything. The
 * reading is taken here, immediately before the ask, rather than carried from
 * a manifest or an earlier run — so the only difference between the two
 * readings is the container.
 *
 * A read that throws is passed on as zero, which the classifier answers
 * `unreadable` for. That is the correct answer and not a swallowed error: main
 * could not establish the premise, so no verdict about the host is available.
 */
async function containmentOf(
  live: EngineHostConnection,
  platform: EngineHostPlatform,
): Promise<ContainmentVerdict> {
  const client = createClient(engineChannels, live.client.invoke);

  let readableBytes: number;
  try {
    readableBytes = (await readFile(platform.probe.negative.path)).byteLength;
  } catch {
    // ZERO IS THE HONEST ANSWER AND THE CLASSIFIER ACTS ON IT. `unreadable` is
    // its verdict for a request whose negative path main could not read, which
    // is what this is — not an error to swallow, an absent premise.
    readableBytes = 0;
  }

  const report = await client['engine/probe-containment']({
    positive: platform.probe.positive.path,
    negative: platform.probe.negative.path,
  });
  if (!report.ok) {
    return {
      kind: 'unreadable',
      detail: `the host could not be asked: engine/probe-containment answered ${report.error.code}`,
    };
  }

  return classifyContainment(
    {
      positive: platform.probe.positive,
      negative: { ...platform.probe.negative, readableBytes },
    },
    report.value,
  );
}

/**
 * Where a diagnostic goes until a logger exists.
 *
 * `stderr`, with a marker, and it is a real destination rather than a
 * placeholder: an incident that reached nowhere is the failure `IncidentSink`
 * was made required to prevent. The logging row will replace this; a sink that
 * silently dropped would make that replacement look optional.
 *
 * Diagnostics keep their absolute paths here. That is correct and is the
 * opposite of the renderer-facing rule: this side already knows the path, and
 * only the incident id crosses (invariant 2).
 */
const reportIncident: IncidentSink = (incident) => {
  process.stderr.write(
    `MONSTERA_INCIDENT ${incident.id} on ${incident.channel}: ` +
      `${JSON.stringify(incident.diagnostic)}\n`,
  );
};

/** Where a lifecycle failure goes until a logger exists. */
const reportShellFailure: ShellFailureSink = (failure) => {
  process.stderr.write(`MONSTERA_SHELL_FAILURE ${failure.event}: ${failure.detail}\n`);
};
