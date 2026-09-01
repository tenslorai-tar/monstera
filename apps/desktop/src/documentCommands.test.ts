import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Command, channels, type Incident, wrapHandler, IncidentLog } from '@monstera/contract';
import {
  CapabilityRegistry,
  CommandBus,
  DocumentService,
  type MupdfSession,
  nodeFileSurface,
  siblingNames,
} from '@monstera/kernel';
// See the note in `engineSessions.test.ts`: a local engine in main's process is
// the pre-host arrangement, and `/engine` is what makes that import say so
// (ADR-0026).
import {
  localMupdfWriter,
  mupdfWriter,
  readPageGeometry,
  withDocument,
} from '@monstera/kernel/engine';
import type { DocId } from '@monstera/shared';

/** Large enough that capacity is never what these tests are measuring. */
const AMPLE_CEILING = 64 * 1024 * 1024;

import { executeCommandHandler } from './commandHandlers.js';
import { createContractHandlers } from './contractHandlers.js';
import {
  DocumentCommands,
  type DocumentGeometry,
  DocumentPoisonedError,
  MissingSessionError,
  type SaveSource,
} from './documentCommands.js';
import { EngineSessions } from './engineSessions.js';

/**
 * The composition point and the first handler, driven end to end against a real
 * engine.
 *
 * Every collaborator here is the production one — a real `DocumentService` over
 * a real file, a real `CommandBus` with the real MuPDF adapter, a real
 * `wrapHandler`. The one thing that is not is the **session lookup**, because
 * nothing owns engine session lifetime yet (ADR-0009 §8's open question, held
 * behind its own trigger). That is a seam this unit deliberately does not fill,
 * not a collaborator being avoided.
 */

let directory: string;
let file: string;
let service: DocumentService;
let docId: DocId;
let openedBytes: number;
let session: MupdfSession;

/** The rotation MuPDF currently reports for a page, or `null` if it has none. */
async function ownRotation(page: number): Promise<number | null> {
  return withDocument(session, (document) => {
    const own = document.loadPage(page).getObject().get('Rotate');
    return own.isNull() ? null : own.asNumber();
  });
}

async function openDocument(): Promise<void> {
  const registry = new CapabilityRegistry();
  service = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
  const outcome = await service.open(registry.mint(file));
  if (outcome.kind !== 'opened') throw new Error(`Fixture did not open: ${outcome.kind}`);
  docId = outcome.docId;
  // KEPT, so a command's answer can be compared against the document it
  // replaced. Without this the only available assertion is "greater than zero",
  // which a length captured before the command satisfies too.
  openedBytes = outcome.byteLength;
  session = await mupdfWriter.open(await pdfBytes());
}

async function pdfBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  return document.save();
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'monstera-compose-'));
  file = join(directory, 'fixture.pdf');
  writeFileSync(file, await pdfBytes());
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/**
 * The production bus, with the one adapter that exists.
 *
 * `localMupdfWriter` rather than `mupdfWriter` since ADR-0023 Decision 10: a
 * registered writer is a session lifecycle **and** the execution of commands
 * against one of its sessions, and the local assembly is what a process holding
 * the session registers.
 */
function bus(): CommandBus {
  return new CommandBus({ mupdf: localMupdfWriter });
}

/**
 * The production supervisor state, holding this document's session.
 *
 * The real component rather than an inline lookup: an arrow that answers
 * `{ mupdf: session }` is a second implementation of get-or-miss, and it would
 * keep passing after the real one stopped agreeing with it.
 */
function engine(): EngineSessions {
  const held = new EngineSessions();
  held.hold(docId, { mupdf: session });
  return held;
}

/** The same component holding nothing — the miss path, not a stub of it. */
function noSessions(): EngineSessions {
  return new EngineSessions();
}

const rotateOnce: Command = { kind: 'rotatePages', pages: [0], quarterTurns: 1 };

/**
 * A save source for the cases that are not about saving.
 *
 * Every member REFUSES rather than returning something plausible. These cases
 * exercise `execute` and `undo`, and a save source that quietly worked would let
 * one of them reach the filesystem without any case saying it should — the
 * failure being that nothing would ever report it. A throw names the file.
 */
const noSaving: SaveSource = {
  deps: {
    checkWriteTarget: () => Promise.reject(new Error('this case does not save')),
    surface: {
      write: () => Promise.reject(new Error('this case does not save')),
      sync: () => Promise.reject(new Error('this case does not save')),
      rename: () => Promise.reject(new Error('this case does not save')),
      copy: () => Promise.reject(new Error('this case does not save')),
      remove: () => Promise.reject(new Error('this case does not save')),
      exists: () => Promise.reject(new Error('this case does not save')),
    },
    names: (target) => ({ temp: `${target}.tmp`, backup: `${target}.bak` }),
    wait: () => Promise.resolve(),
  },
  flush: () => Promise.reject(new Error('this case does not save')),
};

/**
 * A geometry source for the cases that are not about the view model.
 *
 * Refuses for the same reason {@link noSaving} does: a reader that quietly
 * worked would let a case reach the engine's page tree without any case saying
 * it should, and nothing would ever report it.
 */
const noGeometry: DocumentGeometry = () =>
  Promise.reject(new Error('this case does not read the view model'));

/**
 * The production composition of the geometry read, assembled the way
 * `composition.ts` assembles it — a session lookup and `readPageGeometry`.
 *
 * The real reader rather than a stub returning a plausible array: what the
 * view-model cases below claim is that the number a renderer would draw with is
 * the one the ENGINE holds after a command, and a stub is the one thing that
 * cannot say so.
 */
const localGeometry: DocumentGeometry = (id, sessions, pages) => {
  const held = sessions.mupdf;
  if (held === undefined) throw new MissingSessionError(id, 'mupdf');
  return readPageGeometry(held, pages);
};

/** Every page of the three-page fixture, in order. */
const ALL_PAGES = [0, 1, 2];

describe('the composition point owns DocumentService.run -> CommandBus.execute', () => {
  beforeAll(openDocument);

  it('applies the command and returns the version the LANE stamped', async () => {
    const commands = new DocumentCommands(service, bus(), engine(), noSaving, noGeometry);

    // Opened at 1; one applied mutation makes it 2 (ADR-0009 §5).
    const applied = await commands.execute(docId, rotateOnce);
    expect(applied.version).toBe(2);

    // THE BYTE LENGTH, and two findings meet at this assertion.
    //
    // NNNNN-1: it said `toBeGreaterThan(0)`, which a length captured at lane
    // entry satisfies just as well — the pre-command document also has bytes.
    // So the one property `DocumentContext.byteLength` has an argument written
    // about, *read after the bus and not before*, was the one property nothing
    // here separated. `Versioned`'s hazard with the sign flipped, in a case
    // written an hour after the mechanism it guards.
    //
    // The assertion was going to be `not.toBe(openedBytes)`: only the correct
    // path produces a post-command length. MEASURED before it was written,
    // because *they differ* is an assumption about MuPDF rather than a rule —
    // and they do not differ. THEY ARE EQUAL, and that is finding OOOOO-1.
    //
    // A `DocumentRecord`'s `bytes` is `readonly` and a command never replaces
    // it: the mutation lands in the ENGINE SESSION, and main's canonical image
    // stays the bytes that were opened. So `context.byteLength` is correct and
    // **constant**, `document.readRange` serves the pre-command document, and
    // the renderer's view cannot show a rotation whatever it rebinds to.
    //
    // That is a gap between the code and ADR-0031, which argues staleness from
    // *"answering a stale offset out of the new bytes"* — there are no new
    // bytes. This assertion is the evidence, and it is deliberately written as
    // the equality rather than deleted: an equality that passes is what says the
    // mechanism above has nothing to act on yet.
    expect(applied.byteLength).toBeGreaterThan(0);
    expect(applied.byteLength).toBe(openedBytes);

    await expect(ownRotation(0)).resolves.toBe(90);
  });

  it('THE ORDERING CONTROL: two concurrent commands do not interleave their captures', async () => {
    // This is what running the bus INSIDE the lane buys, and the failure it
    // prevents is invisible in the document's final state — both orderings
    // leave page 0 at 180. The evidence is in the second entry's INVERSE.
    //
    // Serialised, the second command captures after the first applied, so its
    // inverse records `{ present: true, raw: 90 }`. Interleaved, both capture
    // before either applies and BOTH inverses record the pre-command state —
    // so undoing twice would leave the page at 90 rather than back where it
    // started, and the document would be in a state it was never in.
    const commands = new DocumentCommands(service, bus(), engine(), noSaving, noGeometry);

    await Promise.all([commands.execute(docId, rotateOnce), commands.execute(docId, rotateOnce)]);

    await expect(ownRotation(0)).resolves.toBe(180 + 90);

    const entries = await service.run(docId, (context) => Promise.resolve(context.log.entries));
    const inverses = entries.value.map((entry) =>
      entry.kind === 'invertible' ? entry.inverse : null,
    );

    // COUPLED TO THE TEST ABOVE, deliberately and with a cost worth stating.
    // The service, the session and the document are module-level, so these
    // figures encode the first test's effect: 90 is what it left, 180 is what
    // the first of this pair produced. Run alone, this case fails loudly rather
    // than passing — so it is not vacuous — but a change to the first test moves
    // this one's expectations for a reason that has nothing to do with what it
    // asserts. Left as it is because the alternative is computing the expected
    // values from the observed ones, which is the assertion agreeing with
    // itself.
    //
    // Three commands have run in this describe block: the first test's, and the
    // two above. Read the LAST TWO, and they must differ — which is the whole
    // assertion, because interleaving makes them identical.
    expect(inverses.at(-2)).toStrictEqual([{ page: 0, prior: { present: true, raw: 90 } }]);
    expect(inverses.at(-1)).toStrictEqual([{ page: 0, prior: { present: true, raw: 180 } }]);
  });

  it('a session that cannot be found is a DEFECT, not an outcome', async () => {
    const commands = new DocumentCommands(service, bus(), noSessions(), noSaving, noGeometry);

    await expect(commands.execute(docId, rotateOnce)).rejects.toThrow(MissingSessionError);
  });

  it('a POISONED document is refused before the session is looked up', async () => {
    // Built through the real state transitions, so the fixture is the one a
    // poisoned document is actually in — including that the deaths took its
    // session with them.
    //
    // Which is why the assertion is on the CLASS and not merely on rejecting:
    // with the two reads in the other order this document's missing session
    // wins and the failure arrives as MissingSessionError, a `internal` defect
    // rather than the declared outcome the supervisor decided. Those are the
    // two errors this ordering exists to choose between, so an assertion that
    // accepted either would separate nothing.
    const poisoned = noSessions();
    poisoned.hold(docId, { mupdf: session });
    poisoned.recordFailure([docId], 'host-death');
    poisoned.recordFailure([docId], 'host-death');

    const commands = new DocumentCommands(service, bus(), poisoned, noSaving, noGeometry);

    await expect(commands.execute(docId, rotateOnce)).rejects.toThrow(DocumentPoisonedError);
  });

  it('CONTROL: the same document, unpoisoned, reaches the engine and applies', async () => {
    // Without this the case above is satisfied by an `execute` that refuses
    // everything, and by a supervisor whose `poisoned` answers a count for a
    // document it has never heard of.
    const commands = new DocumentCommands(service, bus(), engine(), noSaving, noGeometry);

    const applied = await commands.execute(docId, rotateOnce);
    expect(applied.version).toBeGreaterThan(0);
  });
});

describe('the view model is the route a mutation reaches the screen by (OOOOO-1)', () => {
  beforeAll(openDocument);

  it('reports the geometry the session holds, stamped with the lane version', async () => {
    const commands = new DocumentCommands(service, bus(), engine(), noSaving, localGeometry);

    const model = await commands.viewModel(docId, ALL_PAGES);

    expect(model.pageCount).toBe(3);
    expect(model.rotations).toHaveLength(ALL_PAGES.length);
    expect(model.version).toBeGreaterThan(0);
  });

  it('THE CLAIM: a rotate moves the view model while the BYTE ROUTE reports nothing', async () => {
    const commands = new DocumentCommands(service, bus(), engine(), noSaving, localGeometry);

    const before = await commands.viewModel(docId, ALL_PAGES);
    const applied = await commands.execute(docId, rotateOnce);
    const after = await commands.viewModel(docId, ALL_PAGES);

    // The two halves of the finding, side by side, which is the only place they
    // can be compared. `byteLength` is main's canonical image and it does NOT
    // move — a `DocumentRecord`'s bytes are `readonly` — so everything the
    // renderer reads through `document.readRange` is the document it opened.
    expect(applied.byteLength).toBe(openedBytes);
    expect(after.rotations[0]).toBe((before.rotations[0] ?? 0) + 90);
    // AND THE REST OF THE MODEL DID NOT MOVE. Without this, an implementation
    // that reported the last command's rotation for every page passes, and so
    // does one that rebuilt the model from the command's intent rather than
    // from the engine.
    expect(after.rotations.slice(1)).toStrictEqual(before.rotations.slice(1));
    expect(after.version).toBe(applied.version);
  });

  it('a POISONED document refuses the READ rather than answering an empty model', async () => {
    const poisoned = new EngineSessions();
    poisoned.hold(docId, { mupdf: session });
    poisoned.recordFailure([docId], 'host-death');
    poisoned.recordFailure([docId], 'host-death');

    const commands = new DocumentCommands(service, bus(), poisoned, noSaving, localGeometry);

    // The asymmetry this rejects: refusing every command while answering reads
    // would draw a document nobody can act on, and a plausible-looking model is
    // exactly what a caller cannot tell from a current one.
    await expect(commands.viewModel(docId, ALL_PAGES)).rejects.toThrow(DocumentPoisonedError);
  });

  it('a document with no session is a DEFECT here, as it is for a command', async () => {
    const commands = new DocumentCommands(service, bus(), noSessions(), noSaving, localGeometry);

    await expect(commands.viewModel(docId, ALL_PAGES)).rejects.toThrow(MissingSessionError);
  });
});

describe('the handler answers ADR-0009 §9 rather than assuming wrapHandler did', () => {
  /** Discards a diagnostic, for the cases that are not about where it went. */
  function ignore(_incident: Incident): void {
    // The sink is required rather than defaulted, so "not interested" has to be
    // written down. See `incident.ts`.
  }

  /** The real boundary, so what is asserted is what would cross a process. */
  function wrapped(commands: DocumentCommands, sink: (incident: Incident) => void = ignore) {
    return wrapHandler(
      channels,
      'document.execute',
      executeCommandHandler(commands),
      new IncidentLog(sink),
    );
  }

  function recorder(): { sink: (incident: Incident) => void; seen: Incident[] } {
    const seen: Incident[] = [];
    return { sink: (incident) => seen.push(incident), seen };
  }

  it('a document that is not open is a DECLARED code, carrying no incident id', async () => {
    const closed = new DocumentService(new CapabilityRegistry(), { documentBytesCeiling: AMPLE_CEILING });
    const commands = new DocumentCommands(closed, bus(), engine(), noSaving, noGeometry);
    const result = await wrapped(commands)({ docId, command: rotateOnce });

    // The whole failure, asserted as a whole: a declared outcome hides nothing,
    // so there is no log entry for an id to point at.
    expect(result).toStrictEqual({ ok: false, error: { code: 'document-not-open' } });
  });

  it('CONTROL: a defect becomes `internal` with an id the log actually minted', async () => {
    // Without this, the case above is satisfied by a handler that reports
    // `document-not-open` for everything.
    const { sink, seen } = recorder();
    const commands = new DocumentCommands(service, bus(), noSessions(), noSaving, noGeometry);
    const result = await wrapped(commands, sink)({ docId, command: rotateOnce });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal');
    if (result.error.code !== 'internal') return;
    expect(seen[0]?.id).toBe(result.error.incident);
  });

  describe('the VIEW MODEL handler maps the same classes, and nothing had checked (RRRRR-1)', () => {
    /**
     * The real boundary again, for the read rather than the command.
     *
     * A separate wrapper because `wrapHandler` is bound to one channel: it
     * validates against that channel's schemas, so asserting the view model's
     * codes through `document.execute`'s wrapper would prove nothing about the
     * channel a renderer actually calls.
     */
    function wrappedRead(commands: DocumentCommands, sink: (incident: Incident) => void = ignore) {
      return wrapHandler(
        channels,
        'document.viewModel',
        createContractHandlers({
          appInfo: { version: '0.0.0', installChannel: 'development' },
          capabilities: new CapabilityRegistry(),
          commands,
          documents: service,
          openedDocument: () => undefined,
          pickDocument: () => Promise.resolve(null),
          settings: { read: () => ({}), write: () => undefined },
          revealLog: () => Promise.resolve(false),
        })['document.viewModel'],
        new IncidentLog(sink),
      );
    }

    it('a POISONED document reaches the renderer as a declared code, not as `internal`', async () => {
      // The mapping is what `commandHandlers.ts` exists to do, and its failure
      // mode is a class that stops being matched and arrives as `internal` with
      // its diagnostic withheld — an unexplained defect for the one refusal a
      // user can be told about. `documentCommands.test.ts` proved the METHOD
      // throws; nothing proved the handler answers.
      const poisoned = new EngineSessions();
      poisoned.hold(docId, { mupdf: session });
      poisoned.recordFailure([docId], 'host-death');
      poisoned.recordFailure([docId], 'host-death');
      const commands = new DocumentCommands(service, bus(), poisoned, noSaving, localGeometry);

      const result = await wrappedRead(commands)({ docId, pages: [0] });

      expect(result).toStrictEqual({ ok: false, error: { code: 'document-poisoned' } });
    });

    it('CONTROL: the same handler ANSWERS for a document that is fine', async () => {
      // Without this, the case above is satisfied by a handler that refuses
      // everything — which would blank the renderer while looking like careful
      // error mapping.
      const commands = new DocumentCommands(service, bus(), engine(), noSaving, localGeometry);

      const result = await wrappedRead(commands)({ docId, pages: [0] });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.pageCount).toBe(3);
      expect(result.value.rotations).toHaveLength(1);
    });

    it('a defect is `internal` with an id, so the two are not one bucket', async () => {
      const { sink, seen } = recorder();
      const commands = new DocumentCommands(service, bus(), noSessions(), noSaving, localGeometry);

      const result = await wrappedRead(commands, sink)({ docId, pages: [0] });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('internal');
      if (result.error.code !== 'internal') return;
      expect(seen[0]?.id).toBe(result.error.incident);
    });
  });

  describe('THE PATH DOES NOT CROSS, and the control proves it was there to cross', () => {
    /**
     * The measured shape, constructed directly so it holds on every platform.
     *
     * A rethrown `EPERM` from the kernel's identity read looks exactly like
     * this, with the same path in the stack — and the main-side diagnostic
     * copies the message, copies the stack, and recurses into the cause with
     * itself, so all three carry it.
     *
     * The function that does that copying is deliberately **not named here**.
     * The advisory register's reachability walk is a text search over this
     * glob and cannot tell a comment from a call, so naming it would expire
     * the verdict this file exists to evidence. That is the instrument being
     * right rather than blunt: a comment in a scanned file is scanned text,
     * and `mupdfWriter.ts` learned the same thing about the format dispatcher.
     */
    const SECRET = 'C:\\Users\\someone\\Documents\\salary-review.pdf';

    function throwsWithPath(): DocumentCommands {
      return new DocumentCommands(service, bus(), {
        poisoned: () => undefined,
        sessions: () => {
          const cause = new Error(`EPERM: operation not permitted, stat '${SECRET}'`);
          cause.stack = `Error: EPERM: operation not permitted, stat '${SECRET}'\n    at readFileIdentity (${SECRET}:1:1)`;
          const thrown = new Error(`Could not read ${SECRET}`, { cause });
          thrown.stack = `Error: Could not read ${SECRET}\n    at sessionFor (${SECRET}:2:2)`;
          throw thrown;
        },
      }, noSaving, noGeometry);
    }

    it('the renderer-facing failure carries the path in NO field', async () => {
      const result = await wrapped(throwsWithPath())({ docId, command: rotateOnce });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      // Serialised, so a field nobody thought to name is covered too.
      expect(JSON.stringify(result.error)).not.toContain(SECRET);
      expect(JSON.stringify(result.error)).not.toContain('salary-review');
      // And by name, one at a time: a sanitiser that missed one of the three
      // would pass a test that checked the other two.
      const asRecord = result.error as unknown as Record<string, unknown>;
      expect(asRecord['message']).toBeUndefined();
      expect(asRecord['stack']).toBeUndefined();
      expect(asRecord['cause']).toBeUndefined();
      expect(Object.keys(result.error).sort()).toStrictEqual(['code', 'incident']);
    });

    it('CONTROL: and the path IS in message, stack and a NESTED cause, main-side', async () => {
      // B2's control: this reproduces the leak the case above asserts is
      // closed. Without it that case passes against an error that never
      // carried a path — the vacuous shape, in the exact place §9 is about.
      const { sink, seen } = recorder();
      await wrapped(throwsWithPath(), sink)({ docId, command: rotateOnce });

      const diagnostic = seen[0]?.diagnostic;
      expect(diagnostic).toBeDefined();
      expect(diagnostic?.message).toContain(SECRET);
      expect(diagnostic?.stack).toContain(SECRET);
      expect(diagnostic?.cause?.message).toContain(SECRET);
      expect(diagnostic?.cause?.stack).toContain(SECRET);
    });
  });

  it('everything this channel puts on the wire survives structuredClone, deep-equal', async () => {
    // The hard shape an in-process test cannot see (audit item 2): the
    // transport clones, and a value carrying anything unclonable passes every
    // function call and dies at the first Electron call.
    const commands = new DocumentCommands(service, bus(), engine(), noSaving, noGeometry);
    const params = { docId, command: rotateOnce };
    expect(structuredClone(params)).toStrictEqual(params);

    const success = await wrapped(commands)(params);
    expect(structuredClone(success)).toStrictEqual(success);

    const closed = new DocumentService(new CapabilityRegistry(), { documentBytesCeiling: AMPLE_CEILING });
    const declined = await wrapped(new DocumentCommands(closed, bus(), engine(), noSaving, noGeometry))(params);
    expect(structuredClone(declined)).toStrictEqual(declined);
  });

  describe('save, through the real service and the real filesystem', () => {
    /** Names each case's own file. A counter rather than a clock: same run, same names. */
    let savables = 0;

    /**
     * ITS OWN FILE AND ITS OWN SERVICE, deliberately.
     *
     * These cases WRITE, and the shared fixture is opened once in `beforeAll`
     * and read by every other case in this file. A save over it would leave
     * later cases running against bytes MuPDF produced rather than the bytes
     * `pdfBytes` wrote — which would not fail, and that is the problem: a
     * fixture quietly replaced mid-file is the kind of coupling that surfaces
     * as an unrelated case going red weeks later.
     */
    async function aSavableDocument(): Promise<{
      commands: DocumentCommands;
      saved: DocId;
      path: string;
      before: Uint8Array;
    }> {
      savables += 1;
      const path = join(directory, `save-${String(savables)}.pdf`);
      const before = await pdfBytes();
      writeFileSync(path, before);

      const registry = new CapabilityRegistry();
      const own = new DocumentService(registry, { documentBytesCeiling: AMPLE_CEILING });
      const outcome = await own.open(registry.mint(path));
      if (outcome.kind !== 'opened') throw new Error(`fixture did not open: ${outcome.kind}`);

      const held = new EngineSessions();
      held.hold(outcome.docId, { mupdf: session });

      return {
        path,
        before,
        saved: outcome.docId,
        commands: new DocumentCommands(own, bus(), held, {
          // THE REAL SURFACE AND THE REAL CHECK. Every other case in this file
          // is about a decision; this one is the first caller, and a seam whose
          // every test injects its surfaces is unproven against a filesystem
          // that has opinions about renaming open files on Windows.
          deps: {
            checkWriteTarget: (id) => own.checkWriteTarget(id),
            surface: nodeFileSurface,
            names: siblingNames,
            wait: () => Promise.resolve(),
          },
          flush: (_docId, sessions) => {
            const held_ = sessions.mupdf;
            if (held_ === undefined) throw new Error('the fixture holds a session');
            return mupdfWriter.serialise(held_);
          },
        }, localGeometry),
      };
    }

    it('writes the engine bytes to the document own file, and leaves a .bak', async () => {
      const { commands, saved, path, before } = await aSavableDocument();

      const outcome = await commands.save(saved);

      expect(outcome.kind).toBe('saved');
      if (outcome.kind !== 'saved') throw new Error('the save did not happen');
      expect(outcome.backedUp).toBe(true);

      // THE BYTES ON DISK ARE THE ENGINE'S, not the ones the fixture wrote.
      // Asserting only that the file still exists would pass for a pipeline
      // that wrote nothing at all — and for one that copied the original over
      // itself, which is the failure a save silently produces when the flush
      // is wired to the wrong thing.
      const after = readFileSync(path);
      expect(after.byteLength).toBe(outcome.bytes);
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
      // It is still a PDF, which is what separates "MuPDF serialised" from
      // "something wrote bytes".
      expect(after.subarray(0, 5).toString('latin1')).toBe('%PDF-');

      // §4's `.bak`: the user's previous version, surviving a successful save.
      const backup = readFileSync(siblingNames(path).backup);
      expect(Buffer.from(backup).equals(Buffer.from(before))).toBe(true);
    });

    it('CONTROL: the check RUNS — a target that vanished refuses, and does not flush', async () => {
      // The case that proves `checkWriteTarget` is wired in at all. Without it
      // a pipeline that never called the check passes the case above, since a
      // sole-writer verdict and no verdict lead to the same successful write.
      //
      // `target-absent` rather than `contested`, and the reason is a fact about
      // the service worth recording: `DocumentService` DEDUPLICATES — one file
      // is one document — so opening the same path twice returns the same
      // `DocId` and cannot produce a contest. That needs two paths naming one
      // file, which is a hard link, and it is `documentService.test.ts`'
      // territory rather than this seam's.
      const { commands, saved, path } = await aSavableDocument();
      rmSync(path);

      const outcome = await commands.save(saved);

      expect(outcome.kind).toBe('refused');
      if (outcome.kind !== 'refused') throw new Error('the save should have been refused');
      expect(outcome.verdict.kind).toBe('target-absent');
      // NOT RECREATED. A pipeline that treated `target-absent` as permission
      // would leave a file here, and the user's document would have been
      // silently re-established at a path something else had removed.
      expect(existsSync(path)).toBe(false);
    });
  });
});
