import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Command, channels, type Incident, wrapHandler, IncidentLog } from '@monstera/contract';
import {
  CapabilityRegistry,
  CommandBus,
  DocumentService,
  localMupdfWriter,
  type MupdfSession,
  mupdfWriter,
  withDocument,
} from '@monstera/kernel';
import { type DocId } from '@monstera/shared';

/** Large enough that capacity is never what these tests are measuring. */
const AMPLE_CEILING = 64 * 1024 * 1024;

import { executeCommandHandler } from './commandHandlers.js';
import {
  DocumentCommands,
  DocumentPoisonedError,
  MissingSessionError,
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

describe('the composition point owns DocumentService.run -> CommandBus.execute', () => {
  beforeAll(openDocument);

  it('applies the command and returns the version the LANE stamped', async () => {
    const commands = new DocumentCommands(service, bus(), engine());

    // Opened at 1; one applied mutation makes it 2 (ADR-0009 §5).
    await expect(commands.execute(docId, rotateOnce)).resolves.toBe(2);
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
    const commands = new DocumentCommands(service, bus(), engine());

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
    const commands = new DocumentCommands(service, bus(), noSessions());

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
    poisoned.recordFailure([docId]);
    poisoned.recordFailure([docId]);

    const commands = new DocumentCommands(service, bus(), poisoned);

    await expect(commands.execute(docId, rotateOnce)).rejects.toThrow(DocumentPoisonedError);
  });

  it('CONTROL: the same document, unpoisoned, reaches the engine and applies', async () => {
    // Without this the case above is satisfied by an `execute` that refuses
    // everything, and by a supervisor whose `poisoned` answers a count for a
    // document it has never heard of.
    const commands = new DocumentCommands(service, bus(), engine());

    await expect(commands.execute(docId, rotateOnce)).resolves.toBeGreaterThan(0);
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
    const commands = new DocumentCommands(closed, bus(), engine());
    const result = await wrapped(commands)({ docId, command: rotateOnce });

    // The whole failure, asserted as a whole: a declared outcome hides nothing,
    // so there is no log entry for an id to point at.
    expect(result).toStrictEqual({ ok: false, error: { code: 'document-not-open' } });
  });

  it('CONTROL: a defect becomes `internal` with an id the log actually minted', async () => {
    // Without this, the case above is satisfied by a handler that reports
    // `document-not-open` for everything.
    const { sink, seen } = recorder();
    const commands = new DocumentCommands(service, bus(), noSessions());
    const result = await wrapped(commands, sink)({ docId, command: rotateOnce });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('internal');
    if (result.error.code !== 'internal') return;
    expect(seen[0]?.id).toBe(result.error.incident);
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
      });
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
    const commands = new DocumentCommands(service, bus(), engine());
    const params = { docId, command: rotateOnce };
    expect(structuredClone(params)).toStrictEqual(params);

    const success = await wrapped(commands)(params);
    expect(structuredClone(success)).toStrictEqual(success);

    const closed = new DocumentService(new CapabilityRegistry(), { documentBytesCeiling: AMPLE_CEILING });
    const declined = await wrapped(new DocumentCommands(closed, bus(), engine()))(params);
    expect(structuredClone(declined)).toStrictEqual(declined);
  });
});
