import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  type CommandWriter,
  DocumentNotOpenError,
  DocumentService,
  EngineDocumentLocked,
  EngineOpenFailed,
  HostConnectionLost,
  type HostEnding,
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
  endingCountsAgainst,
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

/** A password for the cases that hold one. Made up for this file; no document carries it. */
const PASSWORD = 'sample-only-0171';

/** Large enough that capacity is never what these tests are measuring. */
const AMPLE_CEILING = 64 * 1024 * 1024;

/** Where this file's services keep checkpoints (ADR-0121): its own, by process, removed after the file. */
const CHECKPOINTS = join(tmpdir(), `monstera-supervisor-checkpoints-${String(process.pid)}`);

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
  rmSync(CHECKPOINTS, { recursive: true, force: true });
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

  it('one ending of its own is not enough, and the SECOND is', () => {
    // The counts are spelt out rather than computed from the bound. The bound
    // is a decision (ADR-0023 Decision 9a) and these two lines are what pins
    // it: derived from the constant, they would agree with any value it took.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));

    engine.recordEnding([first], first);
    expect(engine.poisoned(first)).toBeUndefined();

    engine.recordEnding([first], first);
    expect(engine.poisoned(first)).toBe(2);
  });

  it('POISON reaches the bound in ONE call, where an ending of its own needs two', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.hold(second, someSessions('b'));

    // The pair is the point: one call each, and only the method explains the two outcomes.
    engine.poison(first);
    engine.recordEnding([second], second);

    expect(engine.poisoned(first)).toBe(2);
    expect(engine.poisoned(second)).toBeUndefined();
    expect(engine.sessions(first)).toStrictEqual({});
  });

  it('never moves a count DOWNWARD, so this is not a route back from poisoned', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordEnding([first], first);
    engine.recordEnding([first], first);
    engine.recordEnding([first], first);
    expect(engine.poisoned(first)).toBe(3);

    // A bare assignment to the bound would read 2 here, which still says
    // "poisoned" — so the assertion is the NUMBER rather than the state, for
    // the same reason as everything else on this page.
    engine.poison(first);
    expect(engine.poisoned(first)).toBe(3);
  });

  it('an ending takes EVERY held document’s sessions with it, because the process holding them is gone', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.hold(second, someSessions('b'));

    engine.recordEnding([first, second], first);

    // Not merely absent from the document that caused it — absent from both,
    // after ONE ending, which is the case a rebuild recovers from. A handle
    // surviving here is one a queued command finds and calls into a process
    // that no longer exists.
    expect(engine.sessions(first)).toStrictEqual({});
    expect(engine.sessions(second)).toStrictEqual({});
  });

  it('an ending counts against the document whose call the host was running, and NO OTHER (P3)', () => {
    // ADR-0023's correction of 2026-10-03. This counted every held document, so
    // `second` — open the whole time, causing neither ending — was poisoned
    // with `first`: the live review's P3. The fixture is the one the defect
    // fails: both documents in the held set at both endings.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('guilty'));
    engine.hold(second, someSessions('innocent'));

    engine.recordEnding([first, second], first);
    engine.recordEnding([first, second], first);

    expect(engine.poisoned(first)).toBe(2);
    expect(engine.poisoned(second)).toBeUndefined();
  });

  it('CONTROL: an ending with NO document’s call running counts against nobody, and still drops every session', () => {
    // The direction a broken count fails safe in would be counting everyone; this asserts the other half of the
    // rule: undefined is "none", not "all".
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.hold(second, someSessions('b'));

    engine.recordEnding([first, second], undefined);
    engine.recordEnding([first, second], undefined);

    expect(engine.poisoned(first)).toBeUndefined();
    expect(engine.poisoned(second)).toBeUndefined();
    expect(engine.sessions(first)).toStrictEqual({});
  });

  it('NO RESET: two endings of a document’s own poison it whatever it answered between them', () => {
    // Reset-on-success was withdrawn (ADR-0023, 2026-10-03): with the count exact it could only undo a correct one, and
    // a document whose command ends the host, then answers a read, then ends it again would never reach the bound.
    // There is no success to record — the method is gone — so what is pinned is that nothing between the two endings
    // brings the first back down: a hold, which a rebuild's reopen does.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordEnding([first], first);
    engine.hold(first, someSessions('reopened'));
    engine.recordEnding([first], first);

    expect(engine.poisoned(first)).toBe(2);
  });

  it('RECOVERY needs no mechanism: a fresh DocId has no entry', async () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordEnding([first], first);
    engine.recordEnding([first], first);
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

  it('closing a document RUNS its release, which is what the pair leak was', async () => {
    const engine = new EngineSessions();
    engine.begin(first);
    engine.hold(first, someSessions('a'));

    const ran: string[] = [];
    await engine.holdRelease(first, async () => {
      ran.push('released');
      return Promise.resolve();
    });

    // THE CONTROL, and it is the whole of what was wrong before: holding a
    // release must not run it. `releaseOnClose` used to delete a map entry and
    // nothing else, and an assertion that only looked after the close would be
    // satisfied by a release that fired at registration — which is a different
    // defect wearing this one's passing test.
    expect(ran).toEqual([]);

    await engine.releaseOnClose(first);
    expect(ran).toEqual(['released']);
    expect(engine.held).toBe(0);
  });

  describe('whether a document’s file opens only with a password (CR-DOC-11)', () => {
    it('is no for an open document, yes while locked, yes once a password unlocked it', () => {
      const engine = new EngineSessions();
      engine.begin(first);
      expect(engine.opensOnlyWithPassword(first)).toBe(false);
      engine.markLocked(first, 'needs-password');
      expect(engine.opensOnlyWithPassword(first)).toBe(true);
      // UNLOCKED, and still yes: the file is the protected one, whatever the session now holds.
      engine.unlock(first, someSessions('a'), PASSWORD);
      expect(engine.locked(first)).toBeUndefined();
      expect(engine.opensOnlyWithPassword(first)).toBe(true);
    });

    it('follows what each removal’s save renewal found, so removing a password makes it no again', async () => {
      const LOCKED = new Error('the saved file opens only with a password');
      const lockedBy = (thrown: unknown): boolean => thrown === LOCKED;
      const engine = new EngineSessions();
      engine.hold(first, someSessions('a'));

      // THE ANSWER AND THE RECORD ARE ONE STEP: a renewal the host refused on a password says so and is remembered.
      expect(await engine.renew(first, () => Promise.reject(LOCKED), lockedBy)).toBe('locked');
      expect(engine.opensOnlyWithPassword(first)).toBe(true);
      expect(engine.sessions(first)).toStrictEqual(someSessions('a'));

      expect(await engine.renew(first, () => Promise.resolve(someSessions('b')), lockedBy)).toBe('renewed');
      expect(engine.opensOnlyWithPassword(first)).toBe(false);

      // AND IT IS THIS DOCUMENT'S: another one's save says nothing about it.
      engine.hold(second, someSessions('c'));
      await engine.renew(second, () => Promise.reject(LOCKED), lockedBy);
      expect(engine.opensOnlyWithPassword(first)).toBe(false);
    });

    it('CONTROL: any other refusal of the renewal is thrown, and records nothing', async () => {
      const engine = new EngineSessions();
      engine.hold(first, someSessions('a'));
      const broken = new Error('the host is gone');
      await expect(engine.renew(first, () => Promise.reject(broken), () => false)).rejects.toBe(broken);
      expect(engine.opensOnlyWithPassword(first)).toBe(false);
    });
  });

  describe('the password a document was unlocked with (ADR-0171)', () => {
    it('is held from the unlock, read by every reopen, and wiped by the close', async () => {
      const engine = new EngineSessions();
      engine.begin(first);
      engine.markLocked(first, 'needs-password');
      engine.unlock(first, someSessions('a'), PASSWORD);
      const held = engine.opensWith(first);
      expect(held?.reveal()).toBe(PASSWORD);

      // A RECYCLE REOPENS, which ADR-0055 refused for this document: the reopen runs, and the password it opens with
      // is the one held. Read inside the reopen, which is where the opener reads it.
      const offered: (string | undefined)[] = [];
      await engine.recycle(first, (id) => {
        offered.push(engine.opensWith(id)?.reveal());
        return Promise.resolve(someSessions('b'));
      });
      expect(offered).toStrictEqual([PASSWORD]);
      expect(engine.sessions(first)).toStrictEqual(someSessions('b'));

      // CONTROL for the wipe below: the bytes are the password's until the close.
      expect(held?.isWiped()).toBe(false);
      await engine.releaseOnClose(first);
      expect(held?.isWiped()).toBe(true);
      expect(engine.opensWith(first)).toBeUndefined();
    });

    it('CONTROL: a document no password opened reopens with none, and another document’s is not its', async () => {
      const engine = new EngineSessions();
      engine.begin(first);
      engine.markLocked(first, 'needs-password');
      engine.unlock(first, someSessions('a'), PASSWORD);
      engine.hold(second, someSessions('c'));

      const offered: (string | undefined)[] = [];
      await engine.recycle(second, (id) => {
        offered.push(engine.opensWith(id)?.reveal());
        return Promise.resolve(someSessions('d'));
      });
      expect(offered).toStrictEqual([undefined]);
    });

    it('a poisoned document is refused its sessions and keeps no password', () => {
      const engine = new EngineSessions();
      engine.begin(first);
      engine.recordEnding([first], first);
      engine.recordEnding([first], first);
      expect(() => {
        engine.unlock(first, someSessions('a'), PASSWORD);
      }).toThrow(/poisoned/u);
      expect(engine.opensWith(first)).toBeUndefined();
    });
  });

  describe('renew opens before it releases (ADR-0164)', () => {
    it('holds the new sessions, and the old release runs once the new open registers its own', async () => {
      const engine = new EngineSessions();
      engine.begin(first);
      engine.hold(first, someSessions('a'));
      const ran: string[] = [];
      await engine.holdRelease(first, () => {
        ran.push('old');
        return Promise.resolve();
      });

      await engine.renew(first, async (id) => {
        // THE OLD PAIR IS STILL HELD while the new one opens: that is the difference from `recycle`.
        expect(ran).toStrictEqual([]);
        await engine.holdRelease(id, () => Promise.resolve());
        return someSessions('b');
      }, () => false);

      expect(engine.sessions(first)).toStrictEqual(someSessions('b'));
      expect(ran).toStrictEqual(['old']);
    });

    it('an open that FAILS leaves the old sessions and their release exactly as they were', async () => {
      const engine = new EngineSessions();
      engine.begin(first);
      engine.hold(first, someSessions('a'));
      const ran: string[] = [];
      await engine.holdRelease(first, () => {
        ran.push('old');
        return Promise.resolve();
      });

      // ANSWERED `locked` where the caller names the refusal, and the old sessions stay either way.
      const refusal = new Error('needs a password');
      expect(await engine.renew(first, () => Promise.reject(refusal), (thrown) => thrown === refusal)).toBe('locked');

      expect(engine.sessions(first)).toStrictEqual(someSessions('a'));
      expect(ran).toStrictEqual([]);
      // AND THE RELEASE IS STILL THE DOCUMENT'S: a close runs it.
      await engine.releaseOnClose(first);
      expect(ran).toStrictEqual(['old']);
    });

    it('CONTROL: recycle, given the same failing open, leaves the document with no session', async () => {
      // Why renew exists rather than a removal's save calling recycle: this is the state the protection case reached.
      const engine = new EngineSessions();
      engine.begin(first);
      engine.hold(first, someSessions('a'));

      await expect(engine.recycle(first, () => Promise.reject(new Error('needs a password')))).rejects.toThrow();

      expect(engine.sessions(first)).toStrictEqual({});
    });
  });

  it('a release that REJECTS still closes the document', async () => {
    const engine = new EngineSessions();
    engine.begin(first);
    await engine.holdRelease(first, () => Promise.reject(new Error('the host is gone')));

    // A close is not an operation the user can retry, and by the time this runs
    // the document is going. Propagating would fail a close that has succeeded
    // in every sense but this one; the cost is a pair left for the next
    // launch's sweep, which is a backstop that exists.
    await expect(engine.releaseOnClose(first)).resolves.toBeUndefined();
    expect(engine.held).toBe(0);
  });

  it('a REBUILT session replaces the release AND releases the pair it replaced', async () => {
    const engine = new EngineSessions();
    engine.begin(first);

    const ran: string[] = [];
    await engine.holdRelease(first, () => {
      ran.push('first');
      return Promise.resolve();
    });

    // `reopen` is `create`: a host death rebuilds this document's session by
    // re-entering the same path, so a second registration is ORDINARY. This
    // threw once, and CI caught it — recovery answered MissingSessionError on
    // the next command.
    await engine.holdRelease(first, () => {
      ran.push('second');
      return Promise.resolve();
    });

    // THE OLD PAIR IS RELEASED HERE, not orphaned. It is a real directory
    // holding a readable copy of the user's document, so replacing the
    // reference without running it leaves exactly the leak this file closed.
    expect(ran).toEqual(['first']);

    await engine.releaseOnClose(first);
    expect(ran).toEqual(['first', 'second']);
  });

  it('CONTROL: a rebuild whose old release REJECTS still installs the new one', async () => {
    const engine = new EngineSessions();
    engine.begin(first);
    await engine.holdRelease(first, () => Promise.reject(new Error('the old host is gone')));

    const ran: string[] = [];
    // The old host being gone is WHY there is a new session, so this is the
    // ordinary case rather than the exceptional one. A throw here would fail
    // the rebuild that recovery exists to perform.
    await expect(
      engine.holdRelease(first, () => {
        ran.push('second');
        return Promise.resolve();
      }),
    ).resolves.toBeUndefined();

    await engine.releaseOnClose(first);
    expect(ran).toEqual(['second']);
  });

  it('a release offered for a document that already closed is dropped, not thrown', async () => {
    const engine = new EngineSessions();
    engine.begin(first);

    // The document closed while its session was still opening — ordinary, and
    // `openEngineSession` removes the pair on every failure path out of itself,
    // so there is nothing left to release. Throwing here would turn a race the
    // design allows into a reported defect.
    await engine.releaseOnClose(first);
    const ran: string[] = [];
    await expect(
      engine.holdRelease(first, () => {
        ran.push('released');
        return Promise.resolve();
      }),
    ).resolves.toBeUndefined();
    // AND IT IS NOT HELD EITHER, which is the half an absence of a throw does
    // not say. A release kept against a closed document is one that never runs.
    expect(ran).toEqual([]);
    expect(engine.held).toBe(0);
  });

  it('a document closed between the call and the death is skipped, not resurrected', async () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    await engine.releaseOnClose(first);

    engine.recordEnding([first], first);
    engine.recordEnding([first], first);

    expect(engine.poisoned(first)).toBeUndefined();
    expect(engine.held).toBe(0);
  });

  it('offering sessions to a poisoned document is a DEFECT, not a silent recovery', () => {
    // Accepting would leave a session nothing can reach — `poisoned` is read
    // first and refuses — and a supervisor whose two answers disagree.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordEnding([first], first);
    engine.recordEnding([first], first);

    expect(() => {
      engine.hold(first, someSessions('b'));
    }).toThrow(/poisoned/u);
  });

  it('holding again replaces the sessions and leaves the count alone', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordEnding([first], first);

    engine.hold(first, someSessions('b'));

    // The death above cleared them; this is the rebuild putting them back.
    expect(engine.sessions(first)).toStrictEqual(someSessions('b'));
    // A `hold` that reset the count would be reset-on-success arriving by the
    // back door: a rebuild holds sessions again on the way back, so the
    // document that caused the ending would start again at zero.
    engine.recordEnding([first], first);
    expect(engine.poisoned(first)).toBe(2);
  });
});

describe('whom a host’s ending counts against (ADR-0023, corrected 2026-10-03)', () => {
  const at = (code: HostTermination['code'], during: DocId | undefined, last: DocId | undefined): HostEnding => ({
    termination: { code, detail: 'x' },
    during,
    last,
  });

  it('the document whose call the host was running, for a crash, a deadline and a memory kill alike', () => {
    for (const code of ['connection-lost', 'deadline', 'memory-budget'] as const) {
      expect(endingCountsAgainst(at(code, first, first)), code).toBe(first);
    }
  });

  it('with no call running, a MEMORY KILL counts against the last call’s document — and nothing else does', () => {
    // A session holds its memory after the call that grew it has ended; counted against nobody, a document whose
    // session alone holds the host over the threshold would be killed and reopened for ever (the addendum).
    expect(endingCountsAgainst(at('memory-budget', undefined, first))).toBe(first);
    // CONTROL, the same two values on another ending: the host ended from outside a call, which no document caused.
    expect(endingCountsAgainst(at('connection-lost', undefined, first))).toBeUndefined();
    expect(endingCountsAgainst(at('deadline', undefined, first))).toBeUndefined();
  });

  it('a deliberate close counts against nobody, even with a call on the wire', () => {
    expect(endingCountsAgainst(at('shutdown', first, first))).toBeUndefined();
  });
});

describe('openEngineSession writes the canonical image out and opens it', () => {
  let service: DocumentService;
  let docId: DocId;
  let opened: MupdfSession | undefined;

  beforeAll(async () => {
    const registry = new CapabilityRegistry();
    service = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING, checkpointDirectory: CHECKPOINTS });
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

    const result = await openEngineSession(
      service,
      docId,
      area,
      async (path) => {
        openedFrom = path;
        opened = await mupdfWriter.open(readFileSync(path));
        return opened;
      },
      { keys: [], standing: 'as-copied' },
    );

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
      openEngineSession(
        service,
        asDocId('not-open'),
        area,
        () => {
          reached = true;
          return Promise.reject(new Error('unreachable'));
        },
        { keys: [], standing: 'as-copied' },
      ),
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
      openEngineSession(
        service,
        docId,
        area,
        () => Promise.reject(new Error('the host refused this document')),
        { keys: [], standing: 'as-copied' },
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
      checkpointDirectory: CHECKPOINTS,
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
    readonly replayed: DocId[];
  } {
    const reported: ShellFailure[] = [];
    const rebuilds: number[] = [];
    const reopened: DocId[] = [];
    const replayed: DocId[] = [];
    return {
      reported,
      rebuilds,
      reopened,
      replayed,
      // RECORDED, and answering nothing to replay: which documents the rebuild's second half ran for is what these
      // cases can see; what a replay re-applies is `commandBus.test.ts`' and the killed-host proof's.
      replay: (docId) => {
        replayed.push(docId);
        return Promise.resolve(0);
      },
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
      hostEnded: (error) => error instanceof HostConnectionLost,
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

  /** That ending, with `during` the document whose call the host was running, which was also the last call sent. */
  const ended = (during?: DocId): HostEnding => ({ termination: died, during, last: during });

  it('reports the death on the shell sink as its OWN event, not as a child process', async () => {
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    await onEngineHostEnded(engine, ended(), surface);

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

    await onEngineHostEnded(engine, { termination: { code: 'shutdown', detail: 'closed' }, during: undefined, last: undefined }, surface);

    expect(surface.reported[0]?.detail).toContain('nothing here is a fault');
    expect(surface.rebuilds).toStrictEqual([]);
  });

  it('rebuilds ONCE for a death, not once per document', async () => {
    const engine = new EngineSessions();
    const { service } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    await onEngineHostEnded(engine, ended(), surface);

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

    const recovering = onEngineHostEnded(engine, ended(), surface);

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
    // One prior ending caused by `first`, so this one — `first`'s call again — is its second.
    engine.recordEnding([first], first);
    engine.hold(first, someSessions('a'));
    const surface = surfaces(service);

    await onEngineHostEnded(engine, ended(first), surface);

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

  it('THE REPLAY (ADR-0115) runs for each reopened document inside the SAME lane entry, before a later command', async () => {
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);
    const order: string[] = [];
    const surface = surfaces(service, {
      replay: (docId) => {
        order.push(`replay ${docId === first ? 'first' : 'second'}`);
        return Promise.resolve(1);
      },
    });

    const recovering = onEngineHostEnded(engine, ended(), surface);
    // QUEUED AFTER THE DEATH: it can only run once the rebuild's lane entry — reopen AND replay — has finished.
    const later = service.run(first, () => {
      order.push('later command on first');
      return Promise.resolve();
    });
    await Promise.all([recovering, later]);

    expect(order.indexOf('replay first')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('replay first')).toBeLessThan(order.indexOf('later command on first'));
    expect(order).toContain('replay second');
  });

  it('a replay that FAILS is clause (i): refused rather than closed, its session released, the person told', async () => {
    const engine = new EngineSessions();
    const { service, first, second } = await twoOpenDocuments(engine);
    const surface = surfaces(service, {
      replay: (docId) => (docId === first ? Promise.reject(new Error('rotate would not re-apply')) : Promise.resolve(0)),
    });

    await onEngineHostEnded(engine, ended(), surface);

    // REFUSED AT ONCE: a failed replay is deterministic — the same entries onto the same image — so it goes straight
    // to the bound rather than being retried at the next death.
    expect(engine.poisoned(first)).toBe(2);
    expect(engine.sessions(first)).toStrictEqual({});
    expect(surface.reported.some((failure) => failure.detail.includes('could not be restored'))).toBe(true);
    // AND ONLY THAT DOCUMENT: the other came back whole.
    expect(engine.poisoned(second)).toBeUndefined();
    expect(engine.sessions(second)).toStrictEqual(someSessions(`reopened-${second.slice(0, 4)}`));
    // THE DOCUMENT IS STILL OPEN — refused, not closed — which is clause (i)'s own word.
    expect(service.openDocIds()).toContain(first);
  });

  it('CONTROL: a replay interrupted because the document CLOSED is not a failure, and poisons nothing', async () => {
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);
    const surface = surfaces(service, {
      replay: (docId) =>
        docId === first ? Promise.reject(new DocumentNotOpenError(first, 'replay')) : Promise.resolve(0),
    });

    await onEngineHostEnded(engine, ended(), surface);

    expect(engine.poisoned(first)).toBeUndefined();
    expect(surface.reported.filter((failure) => failure.detail.includes('could not be restored'))).toStrictEqual([]);
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

    const recovering = onEngineHostEnded(engine, ended(), surface);
    releaseWork();
    await Promise.all([busy, closing, recovering]);

    // Exactly one report: the death. A close is the correct outcome of
    // get-or-miss, not a failure to tell anybody about.
    expect(surface.reported).toHaveLength(1);
    expect(engine.sessions(second)).toStrictEqual(someSessions(`reopened-${second.slice(0, 4)}`));
  });

  it('P3: two endings caused by ONE document poison it, and the OTHER, open the whole time, is rebuilt and works', async () => {
    // The live review's P3, and its control is this same case before ADR-0023's correction of 2026-10-03: the
    // handler counted every held document, and `second` read `poisoned: 2` here, having caused neither ending.
    const engine = new EngineSessions();
    const { service, first, second } = await twoOpenDocuments(engine);
    const surface = surfaces(service);

    await onEngineHostEnded(engine, ended(first), surface);
    await onEngineHostEnded(engine, ended(first), surface);

    expect(engine.poisoned(first)).toBe(2);
    expect(engine.poisoned(second)).toBeUndefined();
    // REBUILT AT BOTH ENDINGS, and `first` only at the first: its second ending poisoned it.
    expect(surface.reopened).toStrictEqual([first, second, second]);
    // AND IT WORKS: a command after both endings finds its rebuilt session in its lane.
    const seen: DocumentSessions[] = [];
    await service.run(second, () => {
      seen.push(engine.sessions(second) ?? {});
      return Promise.resolve();
    });
    expect(seen).toStrictEqual([someSessions(`reopened-${second.slice(0, 4)}`)]);
  });

  it('a replay the host ENDED under is not replay-failed: nothing is poisoned and nothing is reported for it', async () => {
    // The replay runs on the rebuilt host; if THAT host ends — another document's call, say — the replay rejects with
    // the ending. Counting it as `replay-failed` went straight to the bound, poisoning a document that did nothing.
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);
    const surface = surfaces(service, {
      replay: (docId) =>
        docId === first
          ? Promise.reject(new HostConnectionLost({ code: 'connection-lost', detail: 'the rebuilt host ended' }))
          : Promise.resolve(0),
    });

    await onEngineHostEnded(engine, ended(), surface);

    expect(engine.poisoned(first)).toBeUndefined();
    expect(surface.reported).toHaveLength(1);
  });

  it('CONTROL: a replay that fails for its own reason IS still replay-failed', async () => {
    // Without this, a handler that swallowed every replay failure would pass the case above.
    const engine = new EngineSessions();
    const { service, first } = await twoOpenDocuments(engine);
    const surface = surfaces(service, {
      replay: (docId) => (docId === first ? Promise.reject(new Error('rotate would not re-apply')) : Promise.resolve(0)),
    });

    await onEngineHostEnded(engine, ended(), surface);

    expect(engine.poisoned(first)).toBe(2);
  });

  it('CONTROL: a reopen that genuinely fails IS reported, so silence above means something', async () => {
    const engine = new EngineSessions();
    const { service } = await twoOpenDocuments(engine);
    const surface = surfaces(service, {
      reopen: () => Promise.reject(new Error('the rebuilt host refused this document')),
    });

    await onEngineHostEnded(engine, ended(), surface);

    expect(surface.reported).toHaveLength(3);
    expect(surface.reported[1]?.detail).toContain('reopen failed');
  });

  describe('a command that ends the engine on its deadline three times is barred, and the document is not (ADR-0221)', () => {
    const slow = (during: DocId): HostEnding => ({
      termination: { code: 'deadline', detail: 'the call ran past its deadline' },
      during,
      last: during,
    });

    /** One command running when the host ends: what `DocumentCommands.execute` does around the bus. */
    async function loop(engine: EngineSessions, service: DocumentService, docId: DocId, kind: string): Promise<void> {
      engine.commandBegan(docId, kind);
      await onEngineHostEnded(engine, slow(docId), surfaces(service));
      engine.commandEnded(docId, kind, false);
    }

    it('bars that command at the third ending and leaves the document, its session and every other command alone', async () => {
      const engine = new EngineSessions();
      const { service, first } = await twoOpenDocuments(engine);

      await loop(engine, service, first, 'watermarkPages');
      await loop(engine, service, first, 'watermarkPages');
      expect(engine.commandBarred(first, 'watermarkPages')).toBe(false);
      await loop(engine, service, first, 'watermarkPages');

      expect(engine.commandBarred(first, 'watermarkPages')).toBe(true);
      // THE DOCUMENT IS NOT POISONED, where two deadline endings used to poison it, and it was rebuilt each time.
      expect(engine.poisoned(first)).toBeUndefined();
      expect(engine.sessions(first)).toBeDefined();
      // Only that command, only on that document.
      expect(engine.commandBarred(first, 'rotatePages')).toBe(false);
      await service.close(first);
    });

    it('CONTROL: a deadline with no command running, and a crash during one, still count against the document and poison it at two', async () => {
      const engine = new EngineSessions();
      const { service, first, second } = await twoOpenDocuments(engine);

      // A deadline during a read: no command is running.
      await onEngineHostEnded(engine, slow(first), surfaces(service));
      await onEngineHostEnded(engine, slow(first), surfaces(service));
      expect(engine.poisoned(first)).toBe(2);

      // A crash during a command is the document's failure, as Decision 9a says.
      engine.commandBegan(second, 'watermarkPages');
      await onEngineHostEnded(engine, ended(second), surfaces(service));
      await onEngineHostEnded(engine, ended(second), surfaces(service));
      expect(engine.poisoned(second)).toBe(2);
      expect(engine.commandBarred(second, 'watermarkPages')).toBe(false);
    });

    it('a success clears that command’s strikes, and closing the document clears the ledger', async () => {
      const engine = new EngineSessions();
      const { service, first } = await twoOpenDocuments(engine);

      await loop(engine, service, first, 'watermarkPages');
      await loop(engine, service, first, 'watermarkPages');
      engine.commandBegan(first, 'watermarkPages');
      engine.commandEnded(first, 'watermarkPages', true);
      await loop(engine, service, first, 'watermarkPages');
      await loop(engine, service, first, 'watermarkPages');
      // Two, a success, two: never three in a row.
      expect(engine.commandBarred(first, 'watermarkPages')).toBe(false);

      await loop(engine, service, first, 'watermarkPages');
      expect(engine.commandBarred(first, 'watermarkPages')).toBe(true);
      await service.close(first);
      expect(engine.commandBarred(first, 'watermarkPages')).toBe(false);
    });
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
      checkpointDirectory: CHECKPOINTS,
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
    const unregistered = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING, checkpointDirectory: CHECKPOINTS });
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
  /** What the composition root's `HostConnectionLost` is to this module: a class the `hostEnded` predicate names. */
  class ConnectionEnded extends Error {}

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
      hostEnded: (error) => error instanceof HostConnectionLost || error instanceof ConnectionEnded,
      documentUnreadable: (error) => error instanceof EngineOpenFailed,
      documentLocked: (error) =>
        error instanceof EngineDocumentLocked ? error.reason : undefined,
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
      checkpointDirectory: CHECKPOINTS,
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

  it('retries once after a failure with no ending to blame, and counts NOTHING against the document for it', async () => {
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
    // THE ATTEMPT WAS NOT THE DOCUMENT'S: one ending of its own later is one, not the second. Counted in the
    // supervisor, the failed build would have poisoned it here.
    engine.recordEnding([docId], docId);
    expect(engine.poisoned(docId)).toBeUndefined();
  });

  it('a creation rejected by a host ENDING counts nothing and does not retry: the death handler owns it (P3)', async () => {
    // The ending was counted — against the document whose call the host was running — as the connection ended, and a
    // reopen was queued in this document's lane. Counting it here counted one ending twice, and when another
    // document's call had ended the host, poisoned this one at once.
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const s = openSurfaces(
      service,
      Number.POSITIVE_INFINITY,
      {},
      () => new HostConnectionLost({ code: 'connection-lost', detail: 'another document’s call ended the host' }),
    );

    await onDocumentOpened(engine, docId, s);

    expect(s.created).toHaveLength(1);
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

  it('leaves a death under its attempt to the ending: one death is one failure, and one session is made', async () => {
    // THE HOST ENDS DURING THE OPEN-TIME ATTEMPT, as a host that issues a held handle is ended (CR-SEC-10) or one
    // that crashes mid-open does. The ending raises the count of every document the supervisor holds, this one
    // included, and queues its reopen behind this entry. Counting the attempt's failure as well spent the bound on
    // ONE death: the document was poisoned, and the queued reopen made a session the supervisor then refused.
    const engine = new EngineSessions();
    const { service, docId } = await oneOpenDocument(engine);
    const creations: DocId[] = [];
    const reopened: DocId[] = [];
    const ended: ShellFailure[] = [];
    // THE ENDING RUNS OUTSIDE THE LANE, as the transport announces it (`hostTransport.ts`, detached from the async
    // context of whoever ended the connection): its continuation is registered here, so it carries this context
    // rather than the attempt's, and the reopen it queues is not refused as reentry.
    let announce = (): void => undefined;
    const announced = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const ending = announced.then(() =>
      onEngineHostEnded(
        engine,
        {
          termination: { code: 'malformed-response', detail: 'a handle this registry already holds' },
          during: docId,
          last: docId,
        },
        {
          documents: service,
          failures: (failure) => ended.push(failure),
          closedMeanwhile: (error) => error instanceof DocumentNotOpenError,
          hostEnded: (error) => error instanceof HostConnectionLost,
          rebuild: () => Promise.resolve(),
          reopen: (reopening) => {
            reopened.push(reopening);
            return Promise.resolve(someSessions(`reopened-${reopening.slice(0, 4)}`));
          },
          replay: () => Promise.resolve(0),
        },
      ),
    );
    const s = openSurfaces(service, 0, {
      create: (id) => {
        creations.push(id);
        announce();
        return Promise.reject(new ConnectionEnded('the connection ended under the open'));
      },
    });

    await onDocumentOpened(engine, docId, s);
    await ending;

    // ONE failure, so not poisoned, and sessioned by the reopen: the only session made after the death.
    expect(engine.poisoned(docId)).toBeUndefined();
    expect(engine.sessioned).toBe(1);
    expect(reopened).toEqual([docId]);
    // AND THE LOOP MADE NO SECOND ONE beside it, and reported nothing of its own: the death is the ending's alone.
    expect(creations).toEqual([docId]);
    expect(s.reported).toEqual([]);
    expect(ended.map((failure) => failure.detail)).toEqual([expect.stringContaining('malformed-response')]);
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
      checkpointDirectory: CHECKPOINTS,
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

/**
 * Invariant 22's capability: a handle is a cache, droppable and rebuildable
 * between commands. ARCHITECTURE §2 leaves *which moments* open and requires
 * only that the operation exist — so these cases are about the operation, and
 * nothing here schedules it.
 */
describe('recycling drops the handle and builds it again, keeping the record', () => {
  /**
   * The log's writer capability, cast — the same escape and the same reason
   * `documentService.test.ts` records for it: the token is never read, its
   * whole job being unobtainable outside `commandBus.ts` at compile time, and
   * reaching the log through a real `CommandBus` would need a real MuPDF
   * session to exercise a refusal that never touches the engine.
   */
  const COMMAND_WRITER_FOR_TEST = 'command-writer' as CommandWriter;
  let registry: CapabilityRegistry;

  /**
   * A service with a recycle surface that records what it was asked to do.
   *
   * The surface counts **releases and rebuilds separately**, because the order
   * is the operation: rebuilding first and releasing after would hold two
   * sessions at once, which is more memory than before recycling and the
   * opposite of what a caller asked for.
   */
  async function serviceWithRecycling(): Promise<{
    readonly service: DocumentService;
    readonly docId: DocId;
    readonly order: string[];
  }> {
    registry = new CapabilityRegistry();
    const order: string[] = [];
    const engine = new EngineSessions();
    const service = new DocumentService(registry, {
      documentBytesCeiling: AMPLE_CEILING,
      checkpointDirectory: CHECKPOINTS,
      recycleHandle: async (id) => {
        await engine.recycle(id, (forId) => {
          order.push(`rebuild:${forId.slice(0, 4)}`);
          return Promise.resolve({});
        });
      },
    });
    engine.hold(asDocId('unused'), {});
    const outcome = await service.open(registry.mint(file));
    if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
    engine.hold(outcome.docId, {});
    // The release is what a real graph registers after the session opens.
    await engine.holdRelease(outcome.docId, () => {
      order.push(`release:${outcome.docId.slice(0, 4)}`);
      return Promise.resolve();
    });
    return { service, docId: outcome.docId, order };
  }

  it('releases BEFORE it rebuilds, so the interval is one where the memory is back', async () => {
    const { service, docId, order } = await serviceWithRecycling();

    await expect(service.recycle(docId)).resolves.toStrictEqual({ kind: 'recycled' });

    // THE ORDER IS THE CLAIM, not that both happened. A run that rebuilt first
    // holds two sessions and satisfies every "did it recycle" assertion.
    expect(order).toStrictEqual([`release:${docId.slice(0, 4)}`, `rebuild:${docId.slice(0, 4)}`]);
  });

  it('KEEPS the record, which is the whole difference from closing', async () => {
    const { service, docId } = await serviceWithRecycling();
    const before = service.size;

    await service.recycle(docId);

    // A close would have removed it. `size` is the open-document count, so this
    // separates recycling from the teardown it is otherwise shaped like.
    expect(service.size).toBe(before);
    expect(service.size).toBe(1);
  });

  /**
   * INVARIANT 22'S PRECONDITION, ASSERTED RATHER THAN ASSUMED, and asserting it
   * is what found the gap: the invariant permits dropping a handle *because* no
   * mutation exists only on it, and §2 says *"reopening replays the log"*.
   *
   * Nothing replays the log. `openEngineSession` writes the canonical image and
   * opens a session on it, and `document.viewModel` reads geometry from the
   * SESSION — so a document with applied commands would come back visibly older
   * than its log says it is.
   *
   * The refusal is what keeps the capability honest until replay lands, and this
   * case goes red on that day, which is where somebody will be reading.
   */
  it('REFUSES a document whose log holds commands, because nothing replays it', async () => {
    const { service, docId, order } = await serviceWithRecycling();

    await service.run(docId, (context) => {
      context.commandLog(COMMAND_WRITER_FOR_TEST).record({
        kind: 'invertible',
        command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
        inverse: [{ page: 0, prior: { present: false } }],
        read: undefined,
      });
      return Promise.resolve(undefined);
    });

    const outcome = await service.recycle(docId);

    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && outcome.detail).toMatch(/replays the command log/u);
    // AND IT DID NOT TOUCH THE HANDLE. A refusal reported after releasing would
    // leave the document worse off than not asking, and the outcome alone
    // cannot say which happened.
    expect(order).toStrictEqual([]);
  });

  it('says so when there is no recycle surface, rather than reporting success', async () => {
    const plain = new CapabilityRegistry();
    const service = new DocumentService(plain, { documentBytesCeiling: AMPLE_CEILING, checkpointDirectory: CHECKPOINTS });
    const outcome = await service.open(plain.mint(file));
    if (outcome.kind !== 'opened') throw new Error('fixture did not open');

    const recycled = await service.recycle(outcome.docId);

    // `unavailable`, not `recycled`. A no-op default would make *the handle was
    // dropped* and *nothing happened* one observation, which is the failure the
    // whole capability exists to make measurable.
    expect(recycled.kind).toBe('unavailable');
  });

  it('refuses a document that is not open, rather than resurrecting one', async () => {
    const { service, docId } = await serviceWithRecycling();
    await service.close(docId);

    await expect(service.recycle(docId)).rejects.toThrow(DocumentNotOpenError);
  });
});
