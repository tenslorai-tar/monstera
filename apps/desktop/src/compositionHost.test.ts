import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { type EngineHostPlatform, createShellDependencies } from './composition.js';
import type { AppInfo } from './contractHandlers.js';
import {
  FAKE_CONTAINER,
  FAKE_USER,
  type FakePeer,
  type HostHarness,
  hostHarness,
} from './engineHostFake.js';
import type { DirectoryCreationSurface, DirectoryPath } from './sessionDirectories.js';
import { createEphemeralSettings } from './settingsFile.js';

/**
 * The composition root WITH an engine host platform — finding KKKK-7.
 *
 * ## What was untested, and why nobody could see it
 *
 * `composition.test.ts` drives the root with no platform, which is the
 * configuration every other test is in, and its cases are real: an opened
 * document ends poisoned rather than sessionless. What none of them reach is
 * the code that runs when a platform EXISTS — `connect()`'s first statement
 * throws on a null one, so those cases touch one line of the lifecycle and
 * none of the rest.
 *
 * That left the containment verdict, the terminate-on-not-contained branch, the
 * memoised host and the death handler covered by nothing, in the largest
 * changed file of the range that added them.
 *
 * ## Everything here is a fake and none of it is a stub of the thing under test
 *
 * The Win32 surfaces come from `engineHostFake.ts` — the same fake
 * `engineHostConnection.test.ts` drives, so there is one opinion about how this
 * protocol behaves. `createEngineHostConnection` is the REAL one, the frames are
 * encoded and decoded by the shipped codec, and the client is the real
 * validating one. What is faked is the platform, which is exactly the boundary
 * `EngineHostPlatform` was introduced to put a fake behind.
 */
const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development' };

const scratch = mkdtempSync(join(tmpdir(), 'monstera-composition-host-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** A file the service can open. Main never parses, so any bytes are a document. */
function aDocument(name: string): string {
  const path = join(scratch, name);
  writeFileSync(path, '%PDF-1.7\n');
  return path;
}

/**
 * The negative probe target, with CONTENT.
 *
 * `classifyContainment` refuses a request whose `readableBytes` is not
 * positive, before it looks at any outcome — so an empty file here would make
 * every case below answer `unreadable` and pass for the wrong reason. The bytes
 * are what make a refusal by the host mean anything.
 */
const negativePath = join(scratch, 'containment-negative');
writeFileSync(negativePath, 'bytes an uncontained reader would have read\n');

/** Records what the platform was asked to do, so a case can assert a call. */
interface PlatformSpy {
  readonly platform: EngineHostPlatform;
  readonly harness: HostHarness;
  readonly directories: string[];
}

function platformAnswering(peer: FakePeer): PlatformSpy {
  const harness = hostHarness({ peer });
  const directories: string[] = [];
  // THE DIRECTORIES ARE REALLY MADE, and only the DACL is faked. `main` writes
  // the canonical image into the snapshot directory through the service, so a
  // surface that reported `created` without creating one turns every case into
  // an ENOENT that reads as a session failure — which is how the first draft of
  // this file failed.
  const surface: DirectoryCreationSurface = {
    create: (path: DirectoryPath) => {
      directories.push(`create:${path}`);
      mkdirSync(path, { recursive: true });
      return 'created';
    },
    remove: () => true,
    removeTree: (path: DirectoryPath) => {
      directories.push(`removeTree:${path}`);
      rmSync(path, { recursive: true, force: true });
      return true;
    },
    // Never reached here: the sweep runs in `createEngineHostPlatform`, which
    // this harness stands in for rather than calls. `null` — could not look —
    // so a caller that started sweeping through this surface would report an
    // unreadable root rather than a clean one.
    list: () => null,
    listFiles: () => null,
    removeFile: () => true,
    lastError: () => 0,
  };

  return {
    harness,
    directories,
    platform: {
      surfaces: harness.surfaces,
      user: FAKE_USER,
      container: FAKE_CONTAINER,
      sessionRoot: scratch,
      directories: surface,
      probe: {
        positive: { path: join(scratch, 'positive'), origin: 'install-root' },
        negative: { path: negativePath, origin: 'app-created' },
      },
    },
  };
}

/**
 * The answer a contained host gives: it read what it was handed and not what it
 * was not.
 *
 * Wrapped in the boundary's own envelope, because that is what the client
 * parses. A bare body is rejected as malformed — which is the validating client
 * working, and is how this fixture was found to be wrong.
 */
const CONTAINED = {
  ok: true,
  value: {
    positive: { kind: 'read', bytes: 12 },
    // UPPER CASE, because `PROBE_CODE_PATTERN` is an allowlist — the host is
    // hostile by invariant 25 and this string is one it supplies.
    negative: { kind: 'refused', code: 'EACCES' },
  },
};

/** A session the host issued. Lower-case hex and hyphens, like every handed name. */
const SESSION = { ok: true, value: { session: 'ab0f' } };

/**
 * A host that answers the command channels as a working engine would.
 *
 * `capture` reports prior state, so the command is **invertible** and the bus
 * takes no checkpoint — which is the ordinary path for `rotatePages` and the
 * one a user's rotate actually travels. `apply` and `invert` answer with the
 * empty body their channels declare, because a live-session writer mutates in
 * place and returns nothing (§8).
 */
const ENGINE: FakePeer = (channel) => {
  switch (channel) {
    case 'engine/probe-containment':
      return CONTAINED;
    case 'engine/open':
      return SESSION;
    case 'engine/capture':
      // `present: false` is a page that carried NO `/Rotate` key, which is the
      // prior state a rotate most often replaces — and restoring it means
      // deleting the key rather than rotating back, which is why the inverse
      // records state instead of intent.
      return {
        ok: true,
        value: {
          captured: true,
          value: { kind: 'rotatePages', prior: [{ page: 1, prior: { present: false } }] },
        },
      };
    // `engine/close` IS ANSWERED because the product now calls it: closing a
    // document ends its session on the host and removes the granted pair. Left
    // out, this peer returns `null` from its default, which the fake treats as
    // *send no reply at all* — and the teardown then waits for a frame that
    // never comes, so the first run after the leak was closed timed out rather
    // than failing.
    //
    // Worth stating rather than only fixing: nothing in the boundary client
    // bounds a call, so a host that accepts a frame and never answers hangs
    // whoever awaited it. Invariant 25 says the host is hostile, so that is a
    // real property, and it belongs to every channel rather than to this one.
    // Recorded here because this is where it was first met.
    case 'engine/apply':
    case 'engine/invert':
    case 'engine/close':
      return { ok: true, value: {} };
    default:
      return null;
  }
};

describe('the composition root, with an engine host platform', () => {
  it('creates a host, verifies containment, opens a session, and ROTATES through it', async () => {
    const spy = platformAnswering(ENGINE);
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(aDocument('sessioned.pdf')),
      createEphemeralSettings(),
      spy.platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    // A ROTATE, END TO END THROUGH THE ROOT: the lane resolves the session, the
    // bus routes `rotatePages` to the registered remote writer, and the command
    // reaches the host. The version is stamped AFTER the work, so a bump is
    // evidence the apply happened rather than that the call returned.
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    expect(executed.ok).toBe(true);
    if (!executed.ok) throw new Error('the command should have succeeded');
    expect(executed.value.version).toBeGreaterThan(opened.value.version);

    // CAPTURE BEFORE APPLY, asserted on the ORDER the host saw. Both happened
    // is not the property — a bus that applied first would record an inverse
    // holding the state its own command produced, and undo would then restore
    // the document to something it had never been in.
    const capture = spy.harness.calls.indexOf('peer.request:engine/capture');
    const apply = spy.harness.calls.indexOf('peer.request:engine/apply');
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(apply).toBeGreaterThanOrEqual(0);
    expect(capture).toBeLessThan(apply);

    // AND NO CHECKPOINT WAS TAKEN. `serialise` is the terminal branch, reached
    // only when prior state could not be recorded — asserting its absence is
    // what separates the invertible path from the one that copies the whole
    // document per operation.
    expect(spy.harness.calls).not.toContain('peer.request:engine/serialise');

    // And the host really was built and really was asked.
    expect(spy.harness.calls).toContain('host.createSuspended');
    expect(spy.harness.calls).toContain('peer.request:engine/probe-containment');
    expect(spy.harness.calls).toContain('peer.request:engine/open');

    // CONTROL FOR THE VERDICT BRANCH BELOW. A contained host is not terminated,
    // so the terminate the uncontained case asserts separates the two verdicts
    // rather than reporting a teardown every run performs.
    expect(spy.harness.calls).not.toContain('host.terminate');
  });

  it('undoes through the host, and answers nothing-to-undo when the log is spent', async () => {
    const spy = platformAnswering(ENGINE);
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(aDocument('undone.pdf')),
      createEphemeralSettings(),
      spy.platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const docId = opened.value.docId;

    const executed = await handlers['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });
    if (!executed.ok) throw new Error('the rotate should have succeeded');

    const undone = await handlers['document.undo']({ docId });
    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error('the undo should have succeeded');
    expect(undone.value.kind).toBe('undone');

    // THE VERSION GOES UP for an operation that moves the document backwards.
    // §4 bumps for every applied mutation *including undo*, because the counter
    // identifies a STATE rather than a position in the history — and a renderer
    // that saw it go down would treat a stale reply as current.
    if (undone.value.kind !== 'undone') throw new Error('unreachable');
    expect(undone.value.version).toBeGreaterThan(executed.value.version);

    // THE INVERSE REACHED THE HOST, asserted as a call rather than as a state.
    // A `document.undo` that stepped the log cursor and never told the engine
    // would return exactly this same answer, and the document would be one
    // rotation ahead of what the user sees.
    expect(spy.harness.calls).toContain('peer.request:engine/invert');

    // AND THE LOG IS SPENT. A cursor at the start is not a failure — it is
    // where every document begins and where undoing to the beginning ends.
    const again = await handlers['document.undo']({ docId });
    if (!again.ok) throw new Error('the second undo should not have failed');
    expect(again.value.kind).toBe('nothing-to-undo');
  });

  it('THE HARD SHAPE: a page whose /Rotate is non-numeric takes a CHECKPOINT', async () => {
    // `rotatePages.ts:148` refuses to record prior state for a page carrying a
    // non-numeric `/Rotate` — `{ captured: false }` — and that is the ONE input
    // that reaches the bus's terminal branch, where a checkpoint is taken by
    // calling `serialise`.
    //
    // A rotate clause proven only on well-formed pages is proven on the easy
    // shape (audit item 2), and this is the shape A2's repair was about: before
    // it, `serialise` read a map private to the adapter and threw for every
    // session the composition root opened. So this case is the one that would
    // have failed, and it fails again if that route returns.
    const written: string[] = [];
    const spy = platformAnswering((channel, params) => {
      if (channel === 'engine/capture') {
        return {
          ok: true,
          value: { captured: false, reason: 'page 1 carries a non-numeric /Rotate (/Sideways)' },
        };
      }
      if (channel === 'engine/serialise') {
        // The host writes into the directory it was granted MODIFY on, under
        // the name MAIN chose — so main never opens a path the host named.
        const { into } = params as { into: string };
        const output = lastOutputDirectory(spy.directories);
        writeFileSync(join(output, into), '%PDF-1.7 checkpoint\n');
        written.push(into);
        return { ok: true, value: { bytes: 20 } };
      }
      return ENGINE(channel, params);
    });

    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(aDocument('malformed.pdf')),
      createEphemeralSettings(),
      spy.platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    // IT SUCCEEDS. Capture failing is not the command failing — ADR-0009's
    // 2026-08-19 decision is that invertibility is declared per command and
    // DETERMINED per entry, so the bus takes a checkpoint and applies anyway.
    expect(executed.ok).toBe(true);

    // AND THE CHECKPOINT WAS REALLY TAKEN, through the remote writer, which is
    // the assertion the easy shape cannot make: `serialise` is only reached
    // here, and it is the member that used to throw.
    expect(spy.harness.calls).toContain('peer.request:engine/serialise');
    expect(written).toHaveLength(1);

    // AND THE BYTES CAME BACK AND WERE DELETED. `takeOutput` removes the file
    // on the way out: every serialise is another whole copy of the user's
    // document in a directory the contained host may read.
    expect(existsSync(join(lastOutputDirectory(spy.directories), written[0] ?? ''))).toBe(false);
  });

  it('CONTROL: a host that read the negative path is CLOSED, and no session is made', async () => {
    // The loudest case in ADR-0023's table: the host looks healthy and is not
    // contained, and every cheap containment question answers yes for it. The
    // only difference from the case above is one probe outcome.
    const spy = platformAnswering((channel) =>
      channel === 'engine/probe-containment'
        ? {
            ok: true,
            value: {
              positive: { kind: 'read', bytes: 12 },
              negative: { kind: 'read', bytes: 44 },
            },
          }
        : channel === 'engine/open'
          ? SESSION
          : null,
    );
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(aDocument('uncontained.pdf')),
      createEphemeralSettings(),
      spy.platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    expect(executed.ok).toBe(false);
    if (executed.ok) throw new Error('the command should not have succeeded');
    expect(executed.error.code).toBe('document-poisoned');

    // ASSERT THE CALL THAT WAS NOT MADE. A poisoned document is also what a
    // host that failed to BUILD produces, so the state alone cannot say the
    // verdict was acted on — the host was created and then closed, and the
    // engine was never asked to open anything.
    expect(spy.harness.calls).toContain('host.createSuspended');
    expect(spy.harness.calls).toContain('peer.request:engine/probe-containment');
    expect(spy.harness.calls).not.toContain('peer.request:engine/open');

    // AND THE HOST IS SEEN TO DIE, which is the half this case claimed in prose
    // and asserted nowhere until 2026-08-30. Never opening a session is a
    // property a host that merely failed to BUILD also has; what only the
    // verdict branch produces is a host created, probed, and then terminated.
    // The happy path's control below asserts the other side, because an
    // assertion that a terminate happened is worthless if one always does.
    expect(spy.harness.calls).toContain('host.terminate');
  });

  it('CONTROL: an EMPTY negative target is unreadable rather than contained', async () => {
    // The premise `classifyContainment` refuses before looking at any outcome.
    // Without this case the whole check could be satisfied by a negative file
    // nobody can read, which is the state a fresh install is one mistake away
    // from — and the refusal it produces looks exactly like containment.
    const empty = join(scratch, 'empty-negative');
    writeFileSync(empty, '');
    const spy = platformAnswering((channel) =>
      channel === 'engine/probe-containment' ? CONTAINED : null,
    );
    const platform: EngineHostPlatform = {
      ...spy.platform,
      probe: { ...spy.platform.probe, negative: { path: empty, origin: 'app-created' } },
    };
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(aDocument('unreadable.pdf')),
      createEphemeralSettings(),
      platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    expect(executed.ok).toBe(false);
    if (executed.ok) throw new Error('the command should not have succeeded');
    expect(executed.error.code).toBe('document-poisoned');
    expect(spy.harness.calls).not.toContain('peer.request:engine/open');
  });

  it('builds ONE host for two documents, which is what the held promise is for', async () => {
    const paths = [aDocument('first.pdf'), aDocument('second.pdf')];
    let next = 0;
    const spy = platformAnswering((channel) =>
      channel === 'engine/probe-containment'
        ? CONTAINED
        : channel === 'engine/open'
          ? { ok: true, value: { session: `ab0${String(next)}` } }
          : ENGINE(channel, null),
    );
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(paths[next++] ?? null),
      createEphemeralSettings(),
      spy.platform,
    );

    const first = await handlers['document.open']({});
    const second = await handlers['document.open']({});
    if (!first.ok || first.value.kind !== 'opened') throw new Error('the first did not open');
    if (!second.ok || second.value.kind !== 'opened') throw new Error('the second did not open');

    // BOTH LANES ARE WAITED ON, and until 2026-08-30 only one of them was.
    //
    // `onDocumentOpened` queues a session creation in each document's own lane
    // and is deliberately not awaited, so the two entries are independent.
    // Commanding only the second waits only for the second's lane — and then
    // counts `engine/open` for BOTH. Whether the first had run by then was the
    // runner's decision: green on windows-latest and on ubuntu for weeks, red on
    // ubuntu at `a04b808` reporting one open where two were expected.
    //
    // A command is the right waiter because it can only succeed if that document
    // got a session of its own; what was wrong was waiting for one and asserting
    // about two. This is the same repair `proof:rendererpolicy` made when it
    // stopped settling for a fixed duration: wait for the EVENT, and the bound
    // decides nothing while the mechanism works.
    for (const opened of [first.value, second.value]) {
      const executed = await handlers['document.execute']({
        docId: opened.docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      });
      expect(executed.ok).toBe(true);
    }

    // ONE process, TWO sessions. Counting the creations rather than asserting
    // "a host exists" is the whole case: a lifecycle that rebuilt per document
    // would satisfy every other assertion in this file, and *one host per
    // engine* is ADR-0023 Decision 9c's wording rather than an optimisation.
    const created = spy.harness.calls.filter((call) => call === 'host.createSuspended');
    const opens = spy.harness.calls.filter((call) => call === 'peer.request:engine/open');
    expect(created).toHaveLength(1);
    expect(opens).toHaveLength(2);
  });

  it('SHUTDOWN closes the open document and then the host', async () => {
    const spy = platformAnswering((channel) =>
      channel === 'engine/probe-containment'
        ? CONTAINED
        : channel === 'engine/open'
          ? { ok: true, value: { session: 'ab01' } }
          : ENGINE(channel, null),
    );
    const path = aDocument('quitting.pdf');
    const { handlers, shutdown } = createShellDependencies(
      appInfo,
      () => Promise.resolve(path),
      createEphemeralSettings(),
      spy.platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('it did not open');
    // Commanded, so the session exists rather than merely being queued — the
    // lane's entry is not awaited by `open`.
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });
    expect(executed.ok).toBe(true);

    // THE CONTROL FOR THE PAIR ASSERTION BELOW, and it has to be taken here
    // rather than after. An open document's pair must still exist: without
    // this line, "removed by the time the shell has quit" is satisfied by a
    // pair that was removed at open, or by one the shutdown removes for its own
    // reasons, and neither would be the close doing it.
    expect(spy.directories.filter((call) => call.startsWith('removeTree:'))).toEqual([]);

    const before = spy.harness.calls.length;
    await shutdown();
    const during = spy.harness.calls.slice(before);

    // THE WHOLE TEARDOWN, IN ORDER, and the order is the assertion. `reader.signal`
    // is the stop event — the one thing that unwedges a reader thread waiting on
    // two handles — and it comes FIRST. A quit that killed the host and then
    // signalled would be the sequence measured aborting at 134, and a quit that
    // did neither is what the shell did until this landed.
    expect(during).toEqual([
      // THE DOCUMENT'S SESSION GOES FIRST, and this line is the leak's closure
      // arriving in the order assertion. `shutdown` closes open documents
      // before the host, each close now ends its session on the host and
      // removes its granted pair, and only then is the host itself torn down.
      // Ending a session on a host that is already gone would be the same
      // no-op every time, which is how this would silently stop meaning
      // anything if the two halves were ever reordered.
      'peer.request:engine/close',
      'reader.signal',
      'writes.abandon',
      'worker.terminate',
      'reader.closeEvent',
      'host.terminate',
      'host.close:process',
      'host.close:job',
      'host.discardDiagnostics',
      'pipe.close',
    ]);

    // AND THE DOCUMENT'S GRANTED PAIR IS GONE WITH IT.
    //
    // This assertion used to read `toEqual([])`, pinning a leak: `sessionDirectories.ts`
    // says a pair's "lifetime is the session's: created before the image is
    // written, removed when the session closes", and no session was ever
    // closed — `remoteLifecycle`'s `close` is what calls `areas.remove`, and
    // `remoteMupdfWriter` dropped it on the floor, so it had no caller
    // anywhere. `releaseOnClose` deleted a map entry and nothing else, and a
    // readable copy of the user's document stayed where the contained host
    // could reach it until the next launch swept the session root.
    //
    // BOTH DIRECTORIES, and the count is the assertion rather than "at least
    // one": the pair is a pair, and removing the snapshot while leaving the
    // output directory is the half-fix that would still leave a granted path
    // behind.
    expect(spy.directories.filter((call) => call.startsWith('create:'))).toHaveLength(2);
    expect(spy.directories.filter((call) => call.startsWith('removeTree:'))).toHaveLength(2);
  });

  /**
   * THE CONTROL FOR THE ONE ABOVE, and it is the case the whole shape turns on:
   * a shell that tore nothing down also finishes. `shutdown` resolving proves
   * nothing — what only the implemented path produces is a host terminated by a
   * quit that nobody asked a document about. Without a host built, there is
   * nothing to terminate and the calls stay empty.
   */
  it('CONTROL: shutdown with no host built terminates nothing', async () => {
    const spy = platformAnswering((channel) => ENGINE(channel, null));
    const { shutdown } = createShellDependencies(
      appInfo,
      () => Promise.resolve(null),
      createEphemeralSettings(),
      spy.platform,
    );

    await shutdown();

    expect(spy.harness.calls.filter((call) => call === 'host.createSuspended')).toHaveLength(0);
    expect(spy.harness.calls).not.toContain('host.terminate');
  });

  it('does not cache a FAILED attempt, so the next document tries again', async () => {
    // A rejected promise left in the holder would answer every later open with
    // the first attempt's error — a cache that learnt a transient failure
    // permanently. The host build fails here by refusing the job, which is the
    // failure `createEngineHostConnection` reports rather than throws.
    const failing = hostHarness({ host: true, peer: () => null });
    const platform: EngineHostPlatform = {
      ...platformAnswering(() => null).platform,
      surfaces: failing.surfaces,
    };
    const paths = [aDocument('a.pdf'), aDocument('b.pdf')];
    let next = 0;
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(paths[next++] ?? null),
      createEphemeralSettings(),
      platform,
    );

    const first = await handlers['document.open']({});
    const second = await handlers['document.open']({});
    if (!first.ok || first.value.kind !== 'opened') throw new Error('the first did not open');
    if (!second.ok || second.value.kind !== 'opened') throw new Error('the second did not open');
    await handlers['document.execute']({
      docId: second.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    // MORE THAN ONE ATTEMPT IS THE POINT. Decision 9a's bound is two per
    // document, so two documents that each retry once give four creations —
    // the number that matters is that it is greater than one, because a cached
    // rejection would give exactly one for the life of the process.
    const created = spy(failing.calls, 'host.createSuspended');
    expect(created).toBeGreaterThan(1);
  });
});

/** How many times a call appears. Named so a case reads as a count. */
function spy(calls: readonly string[], call: string): number {
  return calls.filter((entry) => entry === call).length;
}

/**
 * The output half of the most recently created pair.
 *
 * Read from what the DIRECTORY SURFACE was asked to create rather than
 * recomputed from the root, so a case cannot agree with a path the product
 * never made.
 */
function lastOutputDirectory(directories: readonly string[]): string {
  const created = directories.filter((entry) => entry.startsWith('create:'));
  const last = created.at(-1);
  if (last === undefined) throw new Error('no session directory was created');
  return last.slice('create:'.length);
}
