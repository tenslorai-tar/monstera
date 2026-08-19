import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type DocId, asDocId, asFileHandle } from '@monstera/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CapabilityRegistry } from './capabilityRegistry.js';
import { type CanonicalPath, type FileIdentity } from './documentIdentity.js';
import {
  DocumentBusyError,
  DocumentService,
  type IdentityReader,
  type OpenOutcome,
} from './documentService.js';

/**
 * What carries the weight here, as in the identity tests, is the set of cases
 * that must **fail**.
 *
 * Every positive case below — "the same file twice is one document", "a lone
 * document may write" — is satisfied by an implementation that merges
 * everything, or by one whose write check returns `sole-writer` unconditionally.
 * The cases that distinguish a working service from that one are:
 *
 * - two copies of a document, matching on name, size and last-write time,
 *   opening as two documents;
 * - a document that must not be told it may write, because another open
 *   document reaches the same file or because the file was replaced;
 * - the write check refusing to answer at all when its own walk comes back
 *   empty.
 */

const WINDOWS = process.platform === 'win32';

let root = '';
const original = (): string => join(root, 'annual.pdf');
const hardLink = (): string => join(root, 'link.pdf');
const other = (): string => join(root, 'other.pdf');
const copy = (): string => join(root, 'backup', 'annual.pdf');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'monstera-docservice-'));
  writeFileSync(original(), 'document bytes\n');
  writeFileSync(other(), 'a different document entirely\n');

  mkdirSync(join(root, 'backup'), { recursive: true });
  writeFileSync(copy(), 'document bytes\n');

  // The copy matches the original on every corroborating attribute: same
  // filename, same size, same last-write time. This is what a backup looks
  // like, and it is the pair a merge-by-attributes service would wrongly join.
  const when = new Date(1_700_000_000_000);
  utimesSync(original(), when, when);
  utimesSync(copy(), when, when);

  if (WINDOWS) {
    execFileSync('cmd', ['/c', 'mklink', '/H', hardLink(), original()], { stdio: 'ignore' });
  }
});

afterAll(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

/** A constructed identity, for the cases that must not touch a filesystem. */
function identity(): FileIdentity {
  return {
    // Cast locally: `CanonicalPath` has one producer in production, which is
    // what makes row 1's `===` sound.
    canonicalPath: 'C:\\docs\\a.pdf' as CanonicalPath,
    dev: 1,
    ino: 100,
    size: 2048,
    modifiedMs: 1_700_000_000_000,
  };
}

/** A byte source of the right width whose output is fully determined. */
function bytesOf(fill: number): () => Uint8Array {
  return () => Uint8Array.from({ length: 32 }, () => fill);
}

/** Narrows an outcome that must have opened a new document. */
function mustOpen(outcome: OpenOutcome): DocId {
  if (outcome.kind !== 'opened') throw new Error(`expected 'opened', got '${outcome.kind}'`);
  return outcome.docId;
}

describe('DocumentService — minting a DocId', () => {
  it('mints from the byte source verbatim rather than deriving from the path', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry, {
      randomBytesSource: bytesOf(0x41),
      readIdentity: () => Promise.resolve(identity()),
    });

    const outcome = await service.open(registry.mint('C:\\docs\\a.pdf'));

    // 32 bytes of 0x41, base64url. Neither a hash of the path nor a counter can
    // produce this, which is the point: ADR-0009 §1 rejects both, the first
    // because it is the path in a lossy coat and the second because ids get
    // reused after close.
    expect(mustOpen(outcome)).toBe(Buffer.alloc(32, 0x41).toString('base64url'));
  });

  it('refuses a byte source that returns a short draw', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry, {
      randomBytesSource: () => new Uint8Array(4),
      readIdentity: () => Promise.resolve(identity()),
    });

    await expect(service.open(registry.mint('C:\\docs\\a.pdf'))).rejects.toThrow(
      /4 bytes, expected 32/,
    );
  });

  it('does not reuse an id after close — a counter would', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const handle = registry.mint(original());

    const first = mustOpen(await service.open(handle));
    await service.close(first);
    const second = mustOpen(await service.open(handle));

    // A counter reset on close hands out `first` again, and a late renderer
    // message naming it lands on a different document. That is invariant L10's
    // failure mode; a minted token makes it a lookup miss.
    expect(second).not.toBe(first);
  });
});

describe('DocumentService — one file is one document', () => {
  it('opens a file and reports the version it starts at', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const outcome = await service.open(registry.mint(original()));

    // 1, because 0 is reserved for "never" (ADR-0009 §5).
    expect(outcome).toMatchObject({ kind: 'opened', version: 1 });
    expect(service.size).toBe(1);
  });

  it('a second open by a different path form returns the same DocId', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const first = mustOpen(await service.open(registry.mint(original())));
    const second = await service.open(registry.mint(original().toUpperCase()));

    expect(second).toStrictEqual({ kind: 'already-open', docId: first });
    expect(service.size).toBe(1);
  });

  it("the 'already-open' outcome carries no state to build a second view from", async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    await service.open(registry.mint(original()));
    const second = await service.open(registry.mint(original()));

    // No version, no snapshot, nothing. "Render a second copy of an already-open
    // document" is not a bug to be caught here; it is a sentence with no words.
    expect(Object.keys(second).sort()).toStrictEqual(['docId', 'kind']);
  });

  it.runIf(WINDOWS)('a hard link is the same document', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const first = mustOpen(await service.open(registry.mint(original())));
    const second = await service.open(registry.mint(hardLink()));

    // `realpath.native` cannot fold these — both names are equally canonical.
    // This case is the whole reason the identity rule has a second row.
    expect(second).toStrictEqual({ kind: 'already-open', docId: first });
  });

  it('CONTROL: a copy matching on name, size and mtime opens as a SECOND document', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const first = mustOpen(await service.open(registry.mint(original())));
    const second = mustOpen(await service.open(registry.mint(copy())));

    expect(second).not.toBe(first);
    expect(service.size).toBe(2);
  });

  it('CONTROL: concurrent opens of one file cannot both mint', async () => {
    const registry = new CapabilityRegistry();

    // Identity reads are released by hand, so the interleaving is chosen rather
    // than raced for. Written first against the real filesystem, this case
    // passed with the lane REMOVED — the two `realpath`+`stat` pairs happened to
    // complete far enough apart that the second open saw the first's record. A
    // control that depends on I/O landing in a convenient order is not a
    // control; it is the vacuous proof of audit item 4.
    const pending: (() => void)[] = [];
    const service = new DocumentService(registry, {
      readIdentity: () =>
        new Promise((resolve) => {
          pending.push(() => {
            resolve(identity());
          });
        }),
    });

    const both = Promise.all([
      service.open(registry.mint('C:\\docs\\a.pdf')),
      service.open(registry.mint('C:\\DOCS\\A.PDF')),
    ]);

    // Release everything in flight together, repeatedly. Without the lane both
    // opens are in flight at the same time: both see an empty index in the same
    // release and both mint, which is the two-documents-over-one-file state the
    // check exists to prevent.
    for (let tick = 0; tick < 10; tick += 1) {
      for (const release of pending.splice(0)) release();
      await new Promise((resolve) => setImmediate(resolve));
    }

    const [a, b] = await both;
    expect(service.size).toBe(1);
    expect([a.kind, b.kind].sort()).toStrictEqual(['already-open', 'opened']);
  });

  it('a path with no file gets no identity, and mints nothing', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const outcome = await service.open(registry.mint(join(root, 'absent.pdf')));

    expect(outcome).toStrictEqual({ kind: 'absent' });
    expect(service.size).toBe(0);
  });

  it('a failed open does not poison the lane for the next one', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    await expect(service.open(asFileHandle('never-minted'))).rejects.toThrow(/Unknown FileHandle/);
    // One bad handle must not turn into a dead service.
    await expect(service.open(registry.mint(original()))).resolves.toMatchObject({
      kind: 'opened',
    });
  });
});

describe('DocumentService — close removes the document before it tears down', () => {
  it('the index misses while teardown is still pending', async () => {
    const registry = new CapabilityRegistry();
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new DocumentService(registry, { teardown: () => blocked });

    const docId = mustOpen(await service.open(registry.mint(original())));
    const closing = service.close(docId);

    // Nothing has been awaited yet: this is the state a message arriving during
    // teardown sees. It must be a lookup miss rather than a document mid-close,
    // which is what makes invariant L10 structural instead of a discipline
    // every handler has to remember.
    expect(service.isOpen(docId)).toBe(false);
    expect(service.size).toBe(0);

    release();
    await closing;
    expect(service.isOpen(docId)).toBe(false);
  });

  it('closing an unknown document is a no-op and tears nothing down', async () => {
    const registry = new CapabilityRegistry();
    let torn = 0;
    const service = new DocumentService(registry, {
      teardown: () => {
        torn += 1;
        return Promise.resolve();
      },
    });

    await service.close(asDocId('never-opened'));
    expect(torn).toBe(0);
  });

  it('a closed document reopens as a genuinely new document', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const first = mustOpen(await service.open(registry.mint(original())));
    await service.close(first);

    expect(await service.open(registry.mint(original()))).toMatchObject({ kind: 'opened' });
  });
});

describe('DocumentService — the per-document lane', () => {
  /** A promise plus its resolver, for holding a lane entry open on purpose. */
  function deferred(): { promise: Promise<void>; release: () => void } {
    let release = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  it('two entries on one document do not interleave', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    const first = deferred();
    const order: string[] = [];

    const a = service.run(docId, async () => {
      order.push('a:start');
      await first.promise;
      order.push('a:end');
      return 'a';
    });
    const b = service.run(docId, () => {
      order.push('b:start');
      return Promise.resolve('b');
    });

    // b must not have started. A save serialising a live engine session while a
    // command mutates it writes a byte image mixing pre- and post-command
    // state, and the atomic rename then promotes it over the user's file.
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toStrictEqual(['a:start']);

    first.release();
    await Promise.all([a, b]);
    expect(order).toStrictEqual(['a:start', 'a:end', 'b:start']);
  });

  it('hands work the version it runs at, and stamps a query with the same one', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    const result = await service.run(docId, (context) => Promise.resolve(context.version));

    // The stamp comes from the lane, not from the caller. There is no accessor
    // for a document's current version, so "read it after the await and stamp
    // the result with it" has no words.
    expect(result).toStrictEqual({ value: 1, version: 1 });
    expect('versionOf' in service).toBe(false);
  });

  it('CONTROL: a command that bumps is stamped with the version it PRODUCED', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    const result = await service.run(docId, (context) => {
      expect(context.version).toBe(1); // what the work operates against
      context.bumpVersion();
      return Promise.resolve('mutated');
    });

    // Stamping the PRE-work version returns the version this command REPLACED.
    // That is §7's failure with the sign flipped: instead of a query stamped
    // too new, a command stamped too old — a fresh result the renderer's
    // staleness check reads as stale, and a later stale one it can read as
    // fresh. The two values are different and only one of them is the stamp.
    expect(result).toStrictEqual({ value: 'mutated', version: 2 });
  });

  it('CONTROL: a query queued behind a command sees the version the command produced', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    const held = deferred();
    const command = service.run(docId, async (context) => {
      await held.promise;
      context.bumpVersion();
      return 'command';
    });
    const query = service.run(docId, (context) => Promise.resolve(context.version));

    held.release();
    expect(await command).toStrictEqual({ value: 'command', version: 2 });
    // Not 1. The lane is serial, so the query cannot observe the pre-bump
    // value — which is the same argument that makes reading the stamp after
    // the work exact for both kinds.
    expect(await query).toStrictEqual({ value: 2, version: 2 });
  });

  it('a freshly opened document is CLEAN — savedVersion seeds from the initial version', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    // Seeding savedVersion to 0 — the reading the old FIRST_VERSION comment
    // invited — makes every freshly opened document dirty, and closing one
    // prompts a user who changed nothing.
    await expect(
      service.run(docId, (context) => Promise.resolve(context.isDirty())),
    ).resolves.toStrictEqual({ value: false, version: 1 });
  });

  it('a bump makes it dirty, and markSaved makes it clean again', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    // isDirty is read live, not snapshotted at entry start, so work that bumps
    // and then asks gets the answer it just produced.
    const afterBump = await service.run(docId, (context) => {
      context.bumpVersion();
      return Promise.resolve(context.isDirty());
    });
    expect(afterBump).toStrictEqual({ value: true, version: 2 });

    const afterSave = await service.run(docId, (context) => {
      context.markSaved();
      return Promise.resolve(context.isDirty());
    });
    expect(afterSave).toStrictEqual({ value: false, version: 2 });
  });

  it('CONTROL: dirty is dirty across lane entries, not just within one', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    await service.run(docId, (context) => {
      context.bumpVersion();
      return Promise.resolve();
    });
    // Dirtiness is DOCUMENT state, not entry state. Confirmed by mutation:
    // re-seeding savedVersion at each lane entry — which looks harmless, since
    // every entry then starts "clean" — satisfies the case above and reports
    // clean here, so a document would go clean the moment anything else ran.
    await expect(
      service.run(docId, (context) => Promise.resolve(context.isDirty())),
    ).resolves.toMatchObject({ value: true });
  });

  it('CONTROL: dirty is CONSERVATIVE — undo/redo back to saved content still reports dirty', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    const result = await service.run(docId, (context) => {
      context.bumpVersion(); // a command      -> v2
      context.markSaved(); //  saved at        -> v2
      context.bumpVersion(); // undo           -> v3
      context.bumpVersion(); // redo           -> v4
      return Promise.resolve(context.isDirty());
    });

    // The content is byte-identical to the file and this says dirty. That is
    // the RIGHT TRADE and not an exact answer: it fails towards prompting for a
    // save nobody needed, never towards losing work. Asserted so the
    // approximation is a recorded property rather than a surprise — and so
    // nobody "fixes" it into cursor equality, which fails the other way.
    expect(result).toStrictEqual({ value: true, version: 4 });
  });

  it('the version is monotonic across undo and redo — it never goes backwards', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    const seen = await service.run(docId, (context) =>
      Promise.resolve([context.version, context.bumpVersion(), context.bumpVersion()]),
    );

    // §5: bumped by every applied mutation INCLUDING undo and redo, never
    // reused. A late async result stamped with an old version is then
    // unambiguously stale.
    expect(seen.value).toStrictEqual([1, 2, 3]);
  });

  it('REENTRY: work cannot close its own document, and the index is untouched', async () => {
    const registry = new CapabilityRegistry();
    let torn = 0;
    const service = new DocumentService(registry, {
      teardown: () => {
        torn += 1;
        return Promise.resolve();
      },
    });
    const docId = mustOpen(await service.open(registry.mint(original())));

    // `run(A, async () => { await save(); await close(A); })` is the obvious
    // implementation of close-with-unsaved-changes, and it is the hang. Unlike
    // every other refusal here, this hazard punishes the CAREFUL caller —
    // `await close(A)` hangs while `void close(A)` behaves — so the person who
    // meets it is one whose fire-and-forget version already worked.
    await expect(service.run(docId, () => service.close(docId))).rejects.toThrow(
      /Cannot close a document from inside its own lane/,
    );

    // BOTH assertions are needed. The guard must be the FIRST statement in
    // `close`: placed after the removal it would refuse AND remove, handing the
    // caller an error with the index already mutated. A misplaced guard passes
    // the assertion above and fails only this one.
    expect(service.isOpen(docId)).toBe(true);
    expect(torn).toBe(0);

    // And closing from outside the lane — the correct flow — still works.
    await service.close(docId);
    expect(service.isOpen(docId)).toBe(false);
    expect(torn).toBe(1);
  });

  it('REENTRY: work cannot re-enter its own document lane', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    // The inner entry queues behind the outer while the outer awaits the inner.
    // Without the guard this test does not fail — it HANGS, which is why the
    // guard exists: a named error is debuggable in seconds, a hang is a bug
    // report.
    await expect(
      service.run(docId, () => service.run(docId, () => Promise.resolve('inner'))),
    ).rejects.toThrow(/Lane reentry/);

    // And the document still works afterwards.
    await expect(service.run(docId, () => Promise.resolve('after'))).resolves.toMatchObject({
      value: 'after',
    });
  });

  it('a failed entry does not poison the lane for the next one', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    await expect(service.run(docId, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      /boom/,
    );
    // One bad command must not turn into a dead document.
    await expect(service.run(docId, () => Promise.resolve('fine'))).resolves.toMatchObject({
      value: 'fine',
    });
  });

  // -------------------------------------------------------------------------
  // THE CONTROLS.
  // -------------------------------------------------------------------------

  it('GET-OR-MISS: a closed document gets no lane, it gets a miss', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));
    await service.close(docId);

    // A lazily-filled Map<DocId, lane> would mint a lane here and run the work
    // against a torn-down document — the resurrection L10 forbids, arriving
    // through the structure meant to prevent it.
    await expect(service.run(docId, () => Promise.resolve('x'))).rejects.toThrow(/not open/);
  });

  it('CLOSE SPLITS: removal is immediate, teardown waits for the lane to drain', async () => {
    const registry = new CapabilityRegistry();
    const held = deferred();
    const torn: string[] = [];
    const service = new DocumentService(registry, {
      teardown: () => {
        torn.push('teardown');
        return Promise.resolve();
      },
    });
    const docId = mustOpen(await service.open(registry.mint(original())));

    const running = service.run(docId, async () => {
      await held.promise;
      torn.push('command');
      return 'done';
    });

    const closing = service.close(docId);

    // Half 1: the index entry is already gone, with nothing awaited. This is
    // what makes invariant L10 a lookup miss.
    expect(service.isOpen(docId)).toBe(false);
    expect(torn).toStrictEqual([]);

    // Half 2: teardown has NOT run — it is queued behind the command. Tearing
    // an engine session down underneath a command still executing against it is
    // what §7's lane exists to prevent.
    await new Promise((resolve) => setImmediate(resolve));
    expect(torn).toStrictEqual([]);

    held.release();
    await Promise.all([running, closing]);
    expect(torn).toStrictEqual(['command', 'teardown']);
  });

  it('teardown still runs when the pending work failed', async () => {
    const registry = new CapabilityRegistry();
    let torn = 0;
    const service = new DocumentService(registry, {
      teardown: () => {
        torn += 1;
        return Promise.resolve();
      },
    });
    const docId = mustOpen(await service.open(registry.mint(original())));

    const failing = service.run(docId, () => Promise.reject(new Error('boom')));
    const closing = service.close(docId);

    await expect(failing).rejects.toThrow(/boom/);
    await closing;
    // A command that threw still leaves an engine session to release.
    expect(torn).toBe(1);
  });

  it('THE CAP: a saturated lane refuses with a named busy failure', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    // Drive the cap without a pathological loop — which is why the limit is 64
    // and not 1000. A cap no proof can reach is a vacuous check.
    const held = deferred();
    const queued = [service.run(docId, () => held.promise)];
    for (let i = 1; i < 64; i += 1) queued.push(service.run(docId, () => Promise.resolve()));

    await expect(service.run(docId, () => Promise.resolve())).rejects.toThrow(DocumentBusyError);

    held.release();
    await Promise.all(queued);

    // And the lane recovers: refusing is back-pressure, not a broken document.
    await expect(service.run(docId, () => Promise.resolve('after'))).resolves.toMatchObject({
      value: 'after',
    });
  });

  it('LANE ORDER: awaiting a document lane from inside the index lane is refused', async () => {
    const registry = new CapabilityRegistry();

    // It must be the SAME service on both sides. Written first with a second
    // DocumentService reaching into the first, this case passed while proving
    // nothing: the marker is per-instance, so one service's index lane is not
    // inside the other's — and two independent lanes do not deadlock either, so
    // there was nothing there to catch. The hazard is one service re-entering
    // its own lanes.
    const state: { doc?: DocId; attempt?: Promise<unknown> } = {};

    const service: DocumentService = new DocumentService(registry, {
      readIdentity: () => {
        // `checkWriteTarget` calls this from inside the index lane. A
        // service-wide saveAll or closeAll would reach for a document lane from
        // exactly here — and these are promise chains with no reentrancy, so it
        // would DEADLOCK silently rather than fail.
        if (state.doc !== undefined && state.attempt === undefined) {
          state.attempt = service.run(state.doc, () => Promise.resolve('x'));
        }
        return Promise.resolve(identity());
      },
    });

    const docId = mustOpen(await service.open(registry.mint('C:\\docs\\a.pdf')));
    state.doc = docId;

    await service.checkWriteTarget(docId);

    expect(state.attempt).toBeDefined();
    await expect(state.attempt).rejects.toThrow(/Lane ordering violation/);
  });
});

describe('DocumentService — the write-target check', () => {
  it('a lone document is the sole writer of its file', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const docId = mustOpen(await service.open(registry.mint(original())));

    expect(await service.checkWriteTarget(docId)).toStrictEqual({ kind: 'sole-writer' });
  });

  it('two genuinely distinct documents are each the sole writer of their own', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);
    const a = mustOpen(await service.open(registry.mint(original())));
    const b = mustOpen(await service.open(registry.mint(other())));

    expect(await service.checkWriteTarget(a)).toStrictEqual({ kind: 'sole-writer' });
    expect(await service.checkWriteTarget(b)).toStrictEqual({ kind: 'sole-writer' });
  });

  it('refuses to answer for a document that is not open', async () => {
    const service = new DocumentService(new CapabilityRegistry());
    await expect(service.checkWriteTarget(asDocId('never-opened'))).rejects.toThrow(/not open/);
  });

  // -------------------------------------------------------------------------
  // THE CONTROLS. Each is a case where `sole-writer` would permit a write that
  // destroys something.
  // -------------------------------------------------------------------------

  it.runIf(WINDOWS)('CONTESTED: a file hard-linked to another open document', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const targetPath = join(root, 'contested-a.pdf');
    const rivalPath = join(root, 'contested-b.pdf');
    writeFileSync(targetPath, 'target\n');
    writeFileSync(rivalPath, 'a rival document\n');

    const a = mustOpen(await service.open(registry.mint(targetPath)));
    const b = mustOpen(await service.open(registry.mint(rivalPath)));
    // They were genuinely different when opened. Without this assertion the
    // case proves nothing: a service that merged them at open would also reach
    // the expectation below.
    expect(b).not.toBe(a);

    // Now the rival's path becomes a second name for the target's file. No
    // identity taken at open can see this; only re-reading can.
    unlinkSync(rivalPath);
    execFileSync('cmd', ['/c', 'mklink', '/H', rivalPath, targetPath], { stdio: 'ignore' });

    expect(await service.checkWriteTarget(a)).toStrictEqual({ kind: 'contested', others: [b] });
  });

  it('REPLACED: the file at this path is not the file that was opened', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const path = join(root, 'replaced.pdf');
    writeFileSync(path, 'the file we opened\n');
    const docId = mustOpen(await service.open(registry.mint(path)));

    // Delete and recreate: same path, same name, different file. A sync client,
    // a git checkout, or another application's Save As does exactly this.
    unlinkSync(path);
    writeFileSync(path, 'a different file wearing the same name\n');

    expect(await service.checkWriteTarget(docId)).toStrictEqual({ kind: 'replaced' });
  });

  it('TARGET ABSENT is its own answer, never a quiet clear verdict', async () => {
    const registry = new CapabilityRegistry();
    const service = new DocumentService(registry);

    const path = join(root, 'vanishing.pdf');
    writeFileSync(path, 'here for now\n');
    const docId = mustOpen(await service.open(registry.mint(path)));
    unlinkSync(path);

    // The write would create rather than overwrite — and, the reason this is
    // not folded into `sole-writer`, the walk never ran, so nothing was
    // verified. "Had nothing to check" must not read as "checked and clear".
    expect(await service.checkWriteTarget(docId)).toStrictEqual({ kind: 'target-absent' });
  });

  it('CONTROL: with no file index, replacement is reported as unverifiable', async () => {
    const registry = new CapabilityRegistry();
    // A filesystem that supplies no index. `dev:ino` is the only evidence that
    // can answer "is this still the file we opened" once the path is held
    // fixed, so without it the honest answer is that the check could not
    // settle it — never a clear verdict, and never a claim of replacement.
    const service = new DocumentService(registry, {
      readIdentity: () => Promise.resolve({ ...identity(), dev: null, ino: null }),
    });

    const docId = mustOpen(await service.open(registry.mint('C:\\docs\\a.pdf')));
    expect(await service.checkWriteTarget(docId)).toStrictEqual({
      kind: 'unverifiable',
      reason: 'no-file-index',
    });
  });

  it('a close landing mid-check refuses the write instead of reporting a verdict', async () => {
    const registry = new CapabilityRegistry();

    // `close` bypasses the index lane by design, so it can land inside this
    // check's first read. That is not an exotic race: it is what the
    // close-with-unsaved-changes flow will do routinely. Refusing to write a
    // document that is being closed is correct — what would be wrong is a
    // message sending the next reader after a filesystem race that never
    // happened.
    let releaseTargetRead = (): void => undefined;
    let reads = 0;
    const service = new DocumentService(registry, {
      readIdentity: () => {
        reads += 1;
        if (reads !== 2) return Promise.resolve(identity());
        return new Promise((resolve) => {
          releaseTargetRead = () => {
            resolve(identity());
          };
        });
      },
    });

    const docId = mustOpen(await service.open(registry.mint('C:\\docs\\a.pdf')));
    const checking = service.checkWriteTarget(docId);
    // Let the check reach its first read before closing; otherwise close wins
    // outright and the check fails at the record lookup instead, which is a
    // different branch.
    await new Promise((resolve) => setImmediate(resolve));
    await service.close(docId);
    releaseTargetRead();

    await expect(checking).rejects.toThrow(/CLOSED WHILE THIS CHECK WAS RUNNING/);
  });

  it('THE 4b CONTROL: refuses a verdict when its own walk comes back empty', async () => {
    const registry = new CapabilityRegistry();

    // The file answers the target read and is gone by the scan, so the walk
    // returns nothing. Every other way of breaking the walk — an empty index, a
    // mis-keyed map, a reader that fails on every path — produces this same
    // empty result, and the empty result is the one that permits the write.
    let reads = 0;
    const vanishingMidCheck: IdentityReader = () => {
      reads += 1;
      return Promise.resolve(reads <= 2 ? identity() : null);
    };
    const service = new DocumentService(registry, { readIdentity: vanishingMidCheck });

    const docId = mustOpen(await service.open(registry.mint('C:\\docs\\a.pdf')));
    await expect(service.checkWriteTarget(docId)).rejects.toThrow(
      /could not find this document at its own file/,
    );
  });
});
