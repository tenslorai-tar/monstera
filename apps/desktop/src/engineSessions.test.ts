import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  DocumentNotOpenError,
  DocumentService,
  EngineOpenFailed,
  type HostTermination,
  type MupdfSession,
} from '@monstera/kernel';
// `/engine` because this exercises a LOCAL engine in main's own process — the
// pre-host arrangement — and importing it binds MuPDF. Naming the subpath is
// the point rather than an inconvenience: invariant 20 says main must not
// parse, so a main-side test reaching for the adapter should have to say so
// (ADR-0026).
import { mupdfWriter } from '@monstera/kernel/engine';
import { asDocId, type DocId } from '@monstera/shared';

import type { DocumentSessions } from './documentCommands.js';
import {
  type DocumentOpenSurfaces,
  EngineSessions,
  type HostDeathSurfaces,
  onDocumentOpened,
  onEngineHostEnded,
  openEngineSession,
  type SessionAreaOwner,
} from './engineSessions.js';
import type { ShellFailure } from './shellFailure.js';

/**
 * The engine session supervisor's creation step and its state.
 *
 * Two subjects, and they need different machinery. {@link EngineSessions} is a
 * per-document state machine and is exercised with nothing but `DocId`s.
 * `openEngineSession` writes a real canonical image through the shipped
 * `writeCanonicalImage` and opens it with the real MuPDF adapter — a fake
 * service would prove the sequence and not the thing the sequence is for.
 */

/** Large enough that capacity is never what these tests are measuring. */
const AMPLE_CEILING = 64 * 1024 * 1024;

let directory: string;
let file: string;
/** A second document, so a per-lane claim is not made against one lane. */
let secondFile: string;

async function pdfBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  return document.save();
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'monstera-supervisor-'));
  file = join(directory, 'fixture.pdf');
  writeFileSync(file, await pdfBytes());
  secondFile = join(directory, 'fixture-two.pdf');
  writeFileSync(secondFile, await pdfBytes());
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * Two ids that are not each other.
 *
 * Spelt out rather than minted, because these cases are about a map keyed by
 * `DocId` and nothing here depends on how one is produced.
 */
const first = asDocId('11111111-aaaa');
const second = asDocId('22222222-bbbb');

/**
 * A session value for the state cases.
 *
 * The map stores whatever it is handed and never looks inside, so a branded
 * session would buy nothing here — `openEngineSession`'s cases below use real
 * ones, where it is the engine that looks.
 */
const someSessions = (marker: string): DocumentSessions =>
  ({ mupdf: marker }) as unknown as DocumentSessions;

/**
 * A placeholder resolver that THROWS rather than doing nothing.
 *
 * These cases hand a `resolve` out of a promise executor and call it later, and
 * the executor runs when the lane invokes its callback — not when the promise is
 * constructed. A no-op placeholder turns "called it too early" into a five-second
 * timeout with no line number; this names the mistake at the call that made it.
 * It is also how the closed-in-the-meantime case below was got wrong once.
 *
 * @param what What was released before it existed.
 */
function notYet(what: string): () => void {
  return () => {
    throw new Error(what);
  };
}

describe('the supervisor holds one entry per document, and poisons at two', () => {
  it('a document it has never seen is neither held nor poisoned', () => {
    const engine = new EngineSessions();

    expect(engine.sessions(first)).toBeUndefined();
    expect(engine.poisoned(first)).toBeUndefined();
    expect(engine.held).toBe(0);
  });

  it('one host failure is not enough, and the SECOND is', () => {
    // The counts are spelt out rather than computed from the bound. The bound
    // is a decision (ADR-0023 Decision 9a) and these two lines are what pins
    // it: derived from the constant, they would agree with any value it took.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));

    engine.recordFailure([first], 'host-death');
    expect(engine.poisoned(first)).toBeUndefined();

    engine.recordFailure([first], 'host-death');
    expect(engine.poisoned(first)).toBe(2);
  });

  it('an unreadable document reaches the bound in ONE call, where a host death needs two', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.hold(second, someSessions('b'));

    // The pair is the point. Both lines are one call with one argument
    // different, so the reason is the only thing that can explain the two
    // outcomes — and a version that ignored the reason would make them agree.
    engine.recordFailure([first], 'document-unreadable');
    engine.recordFailure([second], 'host-death');

    expect(engine.poisoned(first)).toBe(2);
    expect(engine.poisoned(second)).toBeUndefined();
  });

  it('never moves a count DOWNWARD, so this is not a route back from poisoned', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first], 'host-death');
    engine.recordFailure([first], 'host-death');
    engine.recordFailure([first], 'host-death');
    expect(engine.poisoned(first)).toBe(3);

    // A bare assignment to the bound would read 2 here, which still says
    // "poisoned" — so the assertion is the NUMBER rather than the state, for
    // the same reason as everything else on this page.
    engine.recordFailure([first], 'document-unreadable');
    expect(engine.poisoned(first)).toBe(3);
  });

  it('a death takes the sessions with it, because the process holding them is gone', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    expect(engine.sessions(first)).toStrictEqual(someSessions('a'));

    engine.recordFailure([first], 'host-death');

    // Not merely absent from the poisoned document — absent after ONE death,
    // which is the case a rebuild recovers from. A handle surviving here is one
    // a queued command finds and calls into a process that no longer exists.
    expect(engine.sessions(first)).toStrictEqual({});
    expect(engine.poisoned(first)).toBeUndefined();
  });

  it('RESET ON SUCCESS is what stops the innocent being poisoned', () => {
    // The load-bearing case for the plain counter. One host per engine means a
    // death rejects calls for documents that had nothing to do with it; this is
    // the sequence that separates them from the one that keeps killing hosts.
    //
    // The fixture is chosen so the defect cannot also produce the expected
    // answer: without the reset, fail-succeed-fail is two failures and poisons.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));

    engine.recordFailure([first], 'host-death');
    engine.recordSuccess(first);
    engine.recordFailure([first], 'host-death');

    expect(engine.poisoned(first)).toBeUndefined();
  });

  it('a death increments EVERY document that had a call rejected, not one', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.hold(second, someSessions('b'));

    engine.recordFailure([first, second], 'host-death');
    engine.recordFailure([first, second], 'host-death');

    expect(engine.poisoned(first)).toBe(2);
    expect(engine.poisoned(second)).toBe(2);
  });

  it('THE RESIDUAL, PINNED: a document that caused neither death is poisoned anyway', () => {
    // Decision 9a's DDDD-17 correction, asserted rather than described, so
    // nobody quietly "fixes" a decided open residual and finds out later that
    // the repair was 9a's rejected attribution.
    //
    // `second` is busy at both deaths and causes neither — it never gets a
    // success in between, which is the condition it was in, so reset-on-success
    // cannot save it. What repairs it is close-and-reopen, which arrives here
    // as a fresh id with no entry.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('guilty'));
    engine.hold(second, someSessions('innocent'));

    engine.recordFailure([first, second], 'host-death');
    engine.recordFailure([first, second], 'host-death');

    expect(engine.poisoned(second)).toBe(2);
  });

  it('RECOVERY needs no mechanism: a fresh DocId has no entry', async () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first], 'host-death');
    engine.recordFailure([first], 'host-death');
    expect(engine.poisoned(first)).toBe(2);

    // Close: the entry's lifetime is the record's. Driven directly here; that
    // the SERVICE is what invokes it is the case at the end of this file.
    await engine.releaseOnClose(first);
    expect(engine.held).toBe(0);

    // Reopen. ADR-0009 mints a new id per open, never derives one, so the
    // reopened document cannot land on the poisoned entry even by accident.
    expect(engine.poisoned(second)).toBeUndefined();
    engine.hold(second, someSessions('b'));
    expect(engine.sessions(second)).toStrictEqual(someSessions('b'));
  });

  it('a document closed between the call and the death is skipped, not resurrected', async () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    await engine.releaseOnClose(first);

    engine.recordFailure([first], 'host-death');
    engine.recordFailure([first], 'host-death');

    expect(engine.poisoned(first)).toBeUndefined();
    expect(engine.held).toBe(0);
  });

  it('offering sessions to a poisoned document is a DEFECT, not a silent recovery', () => {
    // Accepting would leave a session nothing can reach — `poisoned` is read
    // first and refuses — and a supervisor whose two answers disagree.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first], 'host-death');
    engine.recordFailure([first], 'host-death');

    expect(() => {
      engine.hold(first, someSessions('b'));
    }).toThrow(/poisoned/u);
  });

  it('holding again replaces the sessions and leaves the count alone', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first], 'host-death');

    engine.hold(first, someSessions('b'));

    // The death above cleared them; this is the rebuild putting them back.
    expect(engine.sessions(first)).toStrictEqual(someSessions('b'));
    // CONTROL for the case above: a `hold` that reset the count would make the
    // reset-on-success case pass for the wrong reason, since a rebuild holds
    // sessions again on the way back.
    engine.recordFailure([first], 'host-death');
    expect(engine.poisoned(first)).toBe(2);
  });
});

describe('openEngineSession writes the canonical image out and opens it', () => {
  let service: DocumentService;
  let docId: DocId;
  let opened: MupdfSession | undefined;

  beforeAll(async () => {
    const registry = new CapabilityRegistry();
    service = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await service.open(registry.mint(file));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    docId = outcome.docId;
  });

  /** Records what the areas surface was asked to do. */
  function areas(snapshotPath: string): SessionAreaOwner & { readonly removals: number[] } {
    const removals: number[] = [];
    return {
      removals,
      create: () => Promise.resolve({ snapshotPath }),
      remove: (): Promise<void> => {
        removals.push(1);
        return Promise.resolve();
      },
    };
  }

  it('the engine opens the bytes the SERVICE wrote, at the path the area handed out', async () => {
    const snapshotPath = join(directory, 'snapshot-ok.pdf');
    const area = areas(snapshotPath);
    let openedFrom = '';

    const result = await openEngineSession(service, docId, area, async (path) => {
      openedFrom = path;
      opened = await mupdfWriter.open(readFileSync(path));
      return opened;
    });

    // The path is the assertion, not an implementation detail: `open` receiving
    // anything other than what `writeCanonicalImage` was told to write means the
    // engine is reading bytes nobody in this repository put there.
    expect(openedFrom).toBe(snapshotPath);
    expect(result.snapshotBytes).toBe(readFileSync(snapshotPath).byteLength);
    expect(result.snapshotBytes).toBeGreaterThan(0);
    expect(area.removals).toStrictEqual([]);
  });

  it('a document that is not open removes the pair and does not reach the engine', async () => {
    const area = areas(join(directory, 'snapshot-never.pdf'));
    let reached = false;

    await expect(
      openEngineSession(service, asDocId('not-open'), area, () => {
        reached = true;
        return Promise.reject(new Error('unreachable'));
      }),
    ).rejects.toThrow(/not open|write the canonical image/u);

    expect(reached).toBe(false);
    expect(area.removals).toStrictEqual([1]);
  });

  it('CONTROL: the engine refusing to open ALSO removes the pair', async () => {
    // Without this, the case above is satisfied by a rollback that only runs
    // when the write fails — and the write is the step that happens before the
    // user's bytes are on disk in a directory the contained host may read. The
    // failure worth rolling back is the one AFTER that.
    const area = areas(join(directory, 'snapshot-refused.pdf'));

    await expect(
      openEngineSession(service, docId, area, () =>
        Promise.reject(new Error('the host refused this document')),
      ),
    ).rejects.toThrow(/host refused/u);

    expect(area.removals).toStrictEqual([1]);
  });

  afterAll(async () => {
    if (opened !== undefined) await mupdfWriter.close(opened);
    await service.close(docId);
  });
});

describe('a host death is reported, and every document is put back through its own lane', () => {
  /**
   * Decisions 9b and 9c, driven against a **real** `DocumentService` over real
   * documents — the lane ordering is the whole claim, and a fake service would
   * prove only that this function calls something named `run`.
   */
  async function twoOpenDocuments(engine: EngineSessions): Promise<{
    readonly service: DocumentService;
    readonly first: DocId;
    readonly second: DocId;
  }> {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry, {
      documentBytesCeiling: AMPLE_CEILING,
      teardown: engine.releaseOnClose,
    });
    const a = await service.open(registry.mint(file));
    const b = await service.open(registry.mint(secondFile));
    if (a.kind !== 'opened' || b.kind !== 'opened') throw new Error('fixture did not open');
    engine.hold(a.docId, someSessions('a'));
    engine.hold(b.docId, someSessions('b'));
    return { service, first: a.docId, second: b.docId };
  }

  /** Records what was reported and what was rebuilt. */
  function surfaces(
    service: DocumentService,
    over: Partial<HostDeathSurfaces> = {},
  ): HostDeathSurfaces & {
    readonly reported: ShellFailure[];
    readonly rebuilds: number[];
    readonly reopened: DocId[];
  } {
    const reported: ShellFailure[] = [];
    const rebuilds: number[] = [];
    const reopened: DocId[] = [];
    return {
      reported,
      rebuilds,
      reopened,
      documents: service,
      failures: (failure) => reported.push(failure),
      rebuild: () => {
        rebuilds.push(1);
        return Promise.resolve();
      },
      reopen: (docId) => {
        reopened.push(docId);
        return Promise.resolve(someSessions(`reopened-${docId.slice(0, 4)}`));
      },
      closedMeanwhile: (error) => error instanceof DocumentNotOpenError,
      ...over,
    };
  }

  // ANNOTATED, not inferred. A bare object literal widens `code` to `string`,
  // which is how the parameter it feeds came to be `string` in the first place
  // (finding IIII-1) — an unannotated fixture is the same widening arriving
  // from the test side, and it would make the union here decorative.
  const died: HostTermination = {
    code: 'connection-lost',
    detail: 'the reader stopped producing bytes',
  };

  it('reports the death on the shell sink as its OWN event, not as a child process', async () => {
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    await onEngineHostEnded(engine, died, surface);

    expect(surface.reported[0]?.event).toBe('engine-host-gone');
    expect(surface.reported[0]?.detail).toContain('connection-lost');
    await service.close(first);
  });

  it('CONTROL: a deliberate shutdown says so and rebuilds NOTHING', async () => {
    // Without this, the case above is satisfied by a handler that reports every
    // ending identically — and the distinction the report exists for is exactly
    // that a host we killed and a host that crashed produce the same silence.
    const engine = new EngineSessions();
    const { service } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    await onEngineHostEnded(engine, { code: 'shutdown', detail: 'closed' }, surface);

    expect(surface.reported[0]?.detail).toContain('nothing here is a fault');
    expect(surface.rebuilds).toStrictEqual([]);
  });

  it('rebuilds ONCE for a death, not once per document', async () => {
    const engine = new EngineSessions();
    const { service } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    await onEngineHostEnded(engine, died, surface);

    // One host per engine (Decision 9c). Two documents, one rebuild.
    expect(surface.rebuilds).toStrictEqual([1]);
    expect(engine.held).toBe(2);
  });

  it('THE ORDERING: the reopen is queued at DEATH time, ahead of a later command', async () => {
    // The claim 9c rests on, and the only one a fake service could not show.
    // A command issued after the death must find the reopened session, which is
    // true only if the reopen entry is already in the lane when it queues.
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);

    let releaseRebuild = notYet('the rebuild was released before it was requested');
    const held = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    const surface = surfaces(service, { rebuild: () => held });

    const recovering = onEngineHostEnded(engine, died, surface);

    // Issued while the rebuild is still outstanding, so it can only run after.
    const seen: DocumentSessions[] = [];
    const later = service.run(first, () => {
      seen.push(engine.sessions(first) ?? {});
      return Promise.resolve();
    });

    releaseRebuild();
    await Promise.all([recovering, later]);

    expect(seen).toStrictEqual([someSessions(`reopened-${first.slice(0, 4)}`)]);
  });

  it('a POISONED document is not rebuilt for, and the others still are', async () => {
    const engine = new EngineSessions();
    const { service, first, second } = await twoOpenDocuments(engine);
    // One prior death for `first` only, so this death is its second.
    engine.recordFailure([first], 'host-death');
    engine.hold(first, someSessions('a'));
    const surface = surfaces(service);

    await onEngineHostEnded(engine, died, surface);

    // THE ASSERTION IS THE DECISION, NOT THE RESULTING STATE, and the first
    // version of this case got that wrong. It asserted `sessions(first)` was
    // empty — which stays true with the poison filter deleted, because `hold`
    // refuses a poisoned document and the throw leaves the same state. The case
    // survived its own mutation and could not tell the filter from the guard.
    //
    // What only the filter produces: the poisoned document is never asked for,
    // so no engine work is done for it and no failure is reported about it.
    expect(surface.reopened).toStrictEqual([second]);
    expect(surface.reported).toHaveLength(1);

    expect(engine.poisoned(first)).toBe(2);
    expect(engine.sessions(first)).toStrictEqual({});
    expect(engine.sessions(second)).toStrictEqual(someSessions(`reopened-${second.slice(0, 4)}`));
  });

  it('a document closed in the meantime is skipped by the seam, silently', async () => {
    // THE INTERLEAVING IS THE FIXTURE, and the first version of this case used
    // one the branch cannot be reached through. `run` reads the record when it
    // is CALLED, so a document closed after its reopen was queued still runs
    // that entry — closing "during" the recovery proves nothing.
    //
    // The reachable state is narrow: `close` deletes the record synchronously
    // and defers teardown until that document's lane drains, so between those
    // two moments the record is gone while the supervisor still holds an entry.
    // A death landing in that window calls `run` on a closed document.
    const engine = new EngineSessions();
    const { service, first, second } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    let releaseWork = notYet('the lane entry had not started, so there was nothing to release');
    let announceStarted = notYet('the start was announced before the entry ran');
    // Awaited below rather than assumed: `run` invokes its callback in a
    // microtask, so releasing the work before it has started leaves the release
    // pointing at the stub and the lane never drains.
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const busy = service.run(
      first,
      () =>
        new Promise<void>((resolve) => {
          releaseWork = resolve;
          announceStarted();
        }),
    );
    await started;

    // Record gone now; `releaseOnClose` waits for the lane above.
    const closing = service.close(first);
    expect(engine.documentIds()).toContain(first);

    const recovering = onEngineHostEnded(engine, died, surface);
    releaseWork();
    await Promise.all([busy, closing, recovering]);

    // Exactly one report: the death. A close is the correct outcome of
    // get-or-miss, not a failure to tell anybody about.
    expect(surface.reported).toHaveLength(1);
    expect(engine.sessions(second)).toStrictEqual(someSessions(`reopened-${second.slice(0, 4)}`));
  });

  it('CONTROL: a reopen that genuinely fails IS reported, so silence above means something', async () => {
    const engine = new EngineSessions();
    const { service } = await twoOpenDocuments(engine);
    const surface = surfaces(service, {
      reopen: () => Promise.reject(new Error('the rebuilt host refused this document')),
    });

    await onEngineHostEnded(engine, died, surface);

    expect(surface.reported).toHaveLength(3);
    expect(surface.reported[1]?.detail).toContain('reopen failed');
  });
});

describe('the SERVICE releases the entry, because nothing else is told a document closed', () => {
  /**
   * The registration, driven end to end — finding FFFF-1.
   *
   * `releaseOnClose` deleting from a map is not the property. The property is
   * that **`DocumentService.close` invokes it**, because that is the only thing
   * that knows a record ended, and a method somebody has to remember to call is
   * what this replaces. So the service here is the production one, constructed
   * the way `composition.ts` constructs it, over a real file.
   */
  async function openWith(engine: EngineSessions): Promise<{
    readonly service: DocumentService;
    readonly docId: DocId;
  }> {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry, {
      documentBytesCeiling: AMPLE_CEILING,
      teardown: engine.releaseOnClose,
    });
    const outcome = await service.open(registry.mint(file));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    return { service, docId: outcome.docId };
  }

  it('closing the document drops the supervisor entry it opened', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await openWith(engine);

    engine.hold(docId, someSessions('a'));
    expect(engine.held).toBe(1);

    await service.close(docId);

    expect(engine.held).toBe(0);
    expect(service.size).toBe(0);
  });

  it('CONTROL: an unregistered service leaves the entry behind', async () => {
    // Without this, the case above passes against a `close` that drops entries
    // by some other route, and against a harness that never held one — and it
    // is the case that goes red if `composition.ts` stops registering, which is
    // the mistake worth catching rather than the deletion itself.
    const engine = new EngineSessions();
    const registry = new CapabilityRegistry();
    const unregistered = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
    const outcome = await unregistered.open(registry.mint(file));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);

    engine.hold(outcome.docId, someSessions('a'));
    await unregistered.close(outcome.docId);

    expect(engine.held).toBe(1);
    expect(unregistered.size).toBe(0);
  });

  it('the release runs AFTER that document lane drains, so in-flight work still sees it', async () => {
    // `close` removes the index entry first and awaits the lane before teardown.
    // A release that ran at removal time would pull a session out from under
    // work already executing — the stale-handle failure one step earlier.
    const engine = new EngineSessions();
    const { service, docId } = await openWith(engine);
    engine.hold(docId, someSessions('a'));

    let heldDuringLaneWork = -1;
    const inFlight = service.run(docId, async () => {
      await Promise.resolve();
      heldDuringLaneWork = engine.held;
    });

    await Promise.all([inFlight, service.close(docId)]);

    expect(heldDuringLaneWork).toBe(1);
    expect(engine.held).toBe(0);
  });
});

/**
 * ADR-0023's 2026-08-27 correction: a session is created at OPEN, in the
 * document's own lane, bounded by 9a's counter.
 *
 * **Every case here asserts a CALL rather than an end state**, and the reason is
 * this module's own record: three cases on this subject have passed under their
 * own mutation because the state a correct decision produces is the state its
 * absence produces too (`CLAUDE.md` item 4). *Poisoned* is reached by one
 * attempt and by two; only the call count separates them.
 */
describe('onDocumentOpened', () => {
  /** Fails `attempts` times, then succeeds. Records every call. */
  function openSurfaces(
    service: DocumentService,
    attempts: number,
    over: Partial<DocumentOpenSurfaces> = {},
    // The failure's CLASS is a parameter because it is the input the loop
    // branches on. A helper that could only produce one kind of rejection would
    // make the deterministic path untestable through the same door the
    // transient one uses, and comparing two cases built by two helpers proves
    // less than comparing two cases that differ in exactly this.
    rejection: () => Error = () => new Error('no host'),
  ): DocumentOpenSurfaces & { readonly created: DocId[]; readonly reported: ShellFailure[] } {
    const created: DocId[] = [];
    const reported: ShellFailure[] = [];
    return {
      created,
      reported,
      documents: service,
      failures: (failure) => reported.push(failure),
      closedMeanwhile: (error) => error instanceof DocumentNotOpenError,
      documentUnreadable: (error) => error instanceof EngineOpenFailed,
      create: (docId) => {
        created.push(docId);
        if (created.length <= attempts) return Promise.reject(rejection());
        return Promise.resolve(someSessions(`created-${docId.slice(0, 4)}`));
      },
      ...over,
    };
  }

  async function oneOpenDocument(
    engine: EngineSessions,
  ): Promise<{ readonly service: DocumentService; readonly docId: DocId }> {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry, {
      documentBytesCeiling: AMPLE_CEILING,
      teardown: engine.releaseOnClose,
    });
    const opened = await service.open(registry.mint(file));
    if (opened.kind !== 'opened') throw new Error('fixture did not open');
    return { service, docId: opened.docId };
  }

  it('creates the session and holds it, so the document ends sessioned', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(service, 0);

    await onDocumentOpened(engine, docId, s);

    expect(s.created).toEqual([docId]);
    expect(engine.sessioned).toBe(1);
    expect(engine.poisoned(docId)).toBeUndefined();
  });

  it('mints the entry BEFORE the creation runs, so a failure can be counted at all', async () => {
    // The load-bearing case for `begin`. `recordFailure` skips a document with
    // no entry, so without minting first the failure below is a silent no-op and
    // the document ends open, sessionless and NOT poisoned — the exact state
    // this correction exists to make unrepresentable.
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);

    let heldWhenCreationRan = -1;
    const s = openSurfaces(service, 0, {
      create: (id) => {
        heldWhenCreationRan = engine.held;
        return Promise.resolve(someSessions(`created-${id.slice(0, 4)}`));
      },
    });

    await onDocumentOpened(engine, docId, s);

    expect(heldWhenCreationRan).toBe(1);
  });

  it('retries once after a transient failure, and the count resets on the success', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(service, 1);

    await onDocumentOpened(engine, docId, s);

    // TWO calls is the assertion. A version that gave up after one would leave
    // this document sessionless, and a version that poisoned at N = 1 would
    // leave it poisoned — both are end states this call count separates.
    expect(s.created).toHaveLength(2);
    expect(engine.sessioned).toBe(1);
    expect(engine.poisoned(docId)).toBeUndefined();
    expect(s.reported).toEqual([]);
  });

  it('poisons after TWO failures and not before, and stops calling', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(service, Number.POSITIVE_INFINITY);

    await onDocumentOpened(engine, docId, s);

    // Exactly two. `POISON_AT` is what terminates this loop, so a bound that
    // moved would show up here as a different number rather than as a hang, and
    // `toHaveLength(2)` is what separates N = 2 from N = 1 — both poison.
    expect(s.created).toHaveLength(2);
    expect(engine.poisoned(docId)).toBe(2);
    expect(engine.sessioned).toBe(0);
    expect(s.reported).toHaveLength(1);
    expect(s.reported[0]?.event).toBe('engine-host-gone');
  });

  it('spends ONE attempt on a document the host says will never parse', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(
      service,
      Number.POSITIVE_INFINITY,
      {},
      () => new EngineOpenFailed('cannot-parse'),
    );

    await onDocumentOpened(engine, docId, s);

    // THE ASSERTION IS THE ATTEMPT COUNT, and it has to be: the case directly
    // above rejects for ever too, and ends with the document poisoned at a
    // count of 2 and a report in hand. Every end state here is identical to
    // that one. What the guard decides is whether a SECOND host is built to be
    // told the same thing, so `1` against that case's `2` is the whole of it —
    // delete the branch and this line reads 2.
    expect(s.created).toHaveLength(1);
    expect(engine.poisoned(docId)).toBe(2);
    expect(engine.sessioned).toBe(0);
  });

  it('blames the document rather than the host, so nothing reads as an unwell engine', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(
      service,
      Number.POSITIVE_INFINITY,
      {},
      () => new EngineOpenFailed('cannot-parse'),
    );

    await onDocumentOpened(engine, docId, s);

    // Separate from the count above because they fail independently: a version
    // that stopped after one attempt and still said `engine-host-gone` would
    // pass that case and be wrong in the only field anyone reads when asking
    // whether this machine's engine is broken.
    expect(s.reported).toHaveLength(1);
    expect(s.reported[0]?.event).toBe('document-unreadable');
    expect(s.reported[0]?.detail).toContain('cannot-parse');
  });

  it('leaves the document sessioned OR poisoned, never neither', async () => {
    // The property the correction is for, asserted directly on both branches so
    // that a future change which makes one of them fall through is caught here
    // rather than by a `MissingSessionError` in production.
    const rejections: (() => Error)[] = [
      () => new Error('no host'),
      // The deterministic exit returns early from inside the loop, which is the
      // shape that historically falls through to neither — so it is asserted
      // here rather than only where its attempt count is.
      () => new EngineOpenFailed('cannot-parse'),
    ];
    for (const rejection of rejections) {
      for (const attempts of [0, 1, Number.POSITIVE_INFINITY]) {
        const engine = new EngineSessions();
        const { service, docId } = await oneOpenDocument(engine);

        await onDocumentOpened(engine, docId, openSurfaces(service, attempts, {}, rejection));

        const sessioned = engine.sessioned === 1;
        const poisoned = engine.poisoned(docId) !== undefined;
        expect(sessioned !== poisoned).toBe(true);
      }
    }
  });

  it('is skipped for a document closed before the lane is entered, and reports nothing', async () => {
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(service, 0);

    await service.close(docId);
    await onDocumentOpened(engine, docId, s);

    // `create` NOT called is the assertion, not the absence of a session. A
    // document that was never given one also has none.
    expect(s.created).toEqual([]);
    expect(s.reported).toEqual([]);
  });

  it("satisfies 9c's anchor once the entry settles: open minus poisoned equals sessioned", async () => {
    // The anchor's evaluation point for the open path, which the correction
    // names: after the entry settles. The term that makes it load-bearing is
    // `DocumentService.size`, from OUTSIDE this supervisor (audit item 4c).
    const engine = new EngineSessions();
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry, {
      documentBytesCeiling: AMPLE_CEILING,
      teardown: engine.releaseOnClose,
    });

    const good = await service.open(registry.mint(file));
    const bad = await service.open(registry.mint(secondFile));
    if (good.kind !== 'opened' || bad.kind !== 'opened') throw new Error('fixture did not open');

    await onDocumentOpened(engine, good.docId, openSurfaces(service, 0));
    await onDocumentOpened(engine, bad.docId, openSurfaces(service, Number.POSITIVE_INFINITY));

    const poisoned = [good.docId, bad.docId].filter(
      (docId) => engine.poisoned(docId) !== undefined,
    ).length;

    // Asserted as a non-trivial identity: one of each, so a version that
    // poisoned both or neither fails. Two documents in the same state would let
    // 2 - 0 = 2 and 2 - 2 = 0 both pass for the wrong reason.
    expect(poisoned).toBe(1);
    expect(service.size - poisoned).toBe(engine.sessioned);
  });
});
