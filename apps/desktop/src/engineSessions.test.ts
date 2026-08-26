import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PDFDocument } from '@cantoo/pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CapabilityRegistry,
  DocumentService,
  type MupdfSession,
  mupdfWriter,
} from '@monstera/kernel';
import { asDocId, type DocId } from '@monstera/shared';

import { type DocumentSessions } from './documentCommands.js';
import { EngineSessions, openEngineSession, type SessionAreaOwner } from './engineSessions.js';

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

async function pdfBytes(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  return document.save();
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'monstera-supervisor-'));
  file = join(directory, 'fixture.pdf');
  writeFileSync(file, await pdfBytes());
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

    engine.recordFailure([first]);
    expect(engine.poisoned(first)).toBeUndefined();

    engine.recordFailure([first]);
    expect(engine.poisoned(first)).toBe(2);
  });

  it('a death takes the sessions with it, because the process holding them is gone', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    expect(engine.sessions(first)).toStrictEqual(someSessions('a'));

    engine.recordFailure([first]);

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

    engine.recordFailure([first]);
    engine.recordSuccess(first);
    engine.recordFailure([first]);

    expect(engine.poisoned(first)).toBeUndefined();
  });

  it('a death increments EVERY document that had a call rejected, not one', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.hold(second, someSessions('b'));

    engine.recordFailure([first, second]);
    engine.recordFailure([first, second]);

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

    engine.recordFailure([first, second]);
    engine.recordFailure([first, second]);

    expect(engine.poisoned(second)).toBe(2);
  });

  it('RECOVERY needs no mechanism: a fresh DocId has no entry', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first]);
    engine.recordFailure([first]);
    expect(engine.poisoned(first)).toBe(2);

    // Close: the entry's lifetime is the record's.
    engine.release(first);
    expect(engine.held).toBe(0);

    // Reopen. ADR-0009 mints a new id per open, never derives one, so the
    // reopened document cannot land on the poisoned entry even by accident.
    expect(engine.poisoned(second)).toBeUndefined();
    engine.hold(second, someSessions('b'));
    expect(engine.sessions(second)).toStrictEqual(someSessions('b'));
  });

  it('a document closed between the call and the death is skipped, not resurrected', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.release(first);

    engine.recordFailure([first]);
    engine.recordFailure([first]);

    expect(engine.poisoned(first)).toBeUndefined();
    expect(engine.held).toBe(0);
  });

  it('offering sessions to a poisoned document is a DEFECT, not a silent recovery', () => {
    // Accepting would leave a session nothing can reach — `poisoned` is read
    // first and refuses — and a supervisor whose two answers disagree.
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first]);
    engine.recordFailure([first]);

    expect(() => {
      engine.hold(first, someSessions('b'));
    }).toThrow(/poisoned/u);
  });

  it('holding again replaces the sessions and leaves the count alone', () => {
    const engine = new EngineSessions();
    engine.hold(first, someSessions('a'));
    engine.recordFailure([first]);

    engine.hold(first, someSessions('b'));

    // The death above cleared them; this is the rebuild putting them back.
    expect(engine.sessions(first)).toStrictEqual(someSessions('b'));
    // CONTROL for the case above: a `hold` that reset the count would make the
    // reset-on-success case pass for the wrong reason, since a rebuild holds
    // sessions again on the way back.
    engine.recordFailure([first]);
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
