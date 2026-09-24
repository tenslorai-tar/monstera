import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { harnessSurfaces } from './harnessComposition.js';

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

// The destination picker and the ephemeral stores come from
// `harnessComposition.ts` — see `composition.test.ts`.

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
    // Invariant 25(c). `ETIMEDOUT` is what the container produced in
    // `lowboxSpike.mjs`'s contained cell, so the fixture is the observed answer
    // rather than a plausible one.
    loopback: { kind: 'refused', code: 'ETIMEDOUT' },
  },
};

/** A session the host issued. Lower-case hex and hyphens, like every handed name. */
// `access: 1` — a document with no `/Encrypt` dictionary, which is what every
// fixture in this file is. `2` would be the answer for one a user password
// opened, and using it here would have the composition root record a password
// it never sent (ADR-0055).
const SESSION = { ok: true, value: { session: 'ab0f', access: 1 } };

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
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('sessioned.pdf')),
      enginePlatform: spy.platform,
    });

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
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('undone.pdf')),
      enginePlatform: spy.platform,
    });

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

  it('redoes through the host what undo stepped back, and answers nothing-to-redo otherwise', async () => {
    // THE COMPOSITION ROOT IS THE SUBJECT: the kernel's redo is proven in `commandBus.test.ts`
    // against a local writer, and until 2026-09-24 nothing in this process called it. This case
    // runs the handler the renderer reaches, through the host the product builds.
    const spy = platformAnswering(ENGINE);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('redone.pdf')),
      enginePlatform: spy.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const docId = opened.value.docId;
    const applies = (): number => spy.harness.calls.filter((call) => call === 'peer.request:engine/apply').length;

    const executed = await handlers['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });
    if (!executed.ok) throw new Error('the rotate should have succeeded');

    // CONTROL: nothing has been undone, so there is nothing to redo — and the engine is NOT asked,
    // which is what separates a redo that consults the log from one that re-runs the last command.
    const early = await handlers['document.redo']({ docId });
    if (!early.ok) throw new Error('an early redo should not fail');
    expect(early.value.kind).toBe('nothing-to-redo');
    expect(applies()).toBe(1);

    const undone = await handlers['document.undo']({ docId });
    if (!undone.ok || undone.value.kind !== 'undone') throw new Error('the undo should have succeeded');

    const redone = await handlers['document.redo']({ docId });
    if (!redone.ok) throw new Error('the redo should have succeeded');
    if (redone.value.kind !== 'redone') throw new Error(`expected redone, got ${redone.value.kind}`);
    // UP AGAIN, for undo's reason: the version names a state, not a position in the history.
    expect(redone.value.version).toBeGreaterThan(undone.value.version);
    // THE COMMAND REACHED THE HOST A SECOND TIME — re-applied, as `reapply-intent` declares.
    expect(applies()).toBe(2);

    const spent = await handlers['document.redo']({ docId });
    if (!spent.ok) throw new Error('a spent redo should not fail');
    expect(spent.value.kind).toBe('nothing-to-redo');
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

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('malformed.pdf')),
      enginePlatform: spy.platform,
    });

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
              loopback: { kind: 'refused', code: 'ETIMEDOUT' },
            },
          }
        : channel === 'engine/open'
          ? SESSION
          : null,
    );
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('uncontained.pdf')),
      enginePlatform: spy.platform,
    });

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

  /**
   * Invariant 25(c), ADR-0023 Decision 15, and the one difference from the
   * `contained` case above is one probe outcome — the loopback one.
   *
   * **The `contained` cases in this file are what prove main took its own
   * reading**, and that is worth saying because nothing here asserts
   * `mainReadBytes` directly. `loopbackControl` binds a real listener and
   * connects to it; if either half failed it would carry zero, and
   * `classifyContainment` answers `unreadable` for a zero — so every green
   * `contained` in this file is a run in which main's control genuinely
   * succeeded. A broken listener cannot produce the reassuring verdict here.
   */
  it('CONTROL: a host that reached the loopback listener is CLOSED, and no session is made', async () => {
    const spy = platformAnswering((channel) =>
      channel === 'engine/probe-containment'
        ? {
            ok: true,
            value: {
              positive: { kind: 'read', bytes: 12 },
              negative: { kind: 'refused', code: 'EACCES' },
              loopback: { kind: 'read', bytes: 23 },
            },
          }
        : channel === 'engine/open'
          ? SESSION
          : null,
    );
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('networked.pdf')),
      enginePlatform: spy.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });

    expect(executed.ok).toBe(false);
    if (executed.ok) throw new Error('the command should not have succeeded');
    expect(executed.error.code).toBe('document-poisoned');

    // THE DECISION, not the tidy state both arrive at: created, probed, never
    // opened, then terminated.
    expect(spy.harness.calls).toContain('host.createSuspended');
    expect(spy.harness.calls).toContain('peer.request:engine/probe-containment');
    expect(spy.harness.calls).not.toContain('peer.request:engine/open');
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
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('unreadable.pdf')),
      enginePlatform: platform,
    });

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
          ? { ok: true, value: { session: `ab0${String(next)}`, access: 1 } }
          : ENGINE(channel, null),
    );
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(paths[next++] ?? null),
      enginePlatform: spy.platform,
    });

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
          ? { ok: true, value: { session: 'ab01', access: 1 } }
          : ENGINE(channel, null),
    );
    const path = aDocument('quitting.pdf');
    const { handlers, shutdown } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(path),
      enginePlatform: spy.platform,
    });

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
    const { shutdown } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(null),
      enginePlatform: spy.platform,
    });

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
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(paths[next++] ?? null),
      enginePlatform: platform,
    });

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

/**
 * A MuPDF peer that also answers `engine/serialise` with a REAL FILE.
 *
 * {@link ENGINE} does not, because no case above reaches the terminal branch
 * against a live host. A **byte-image** command reaches it on every run:
 * `CommandBus.#sessionFor` calls `ByteImageAccess.current()` before `capture`,
 * and that is `remoteMupdfWriter.serialise` — which mints a name, asks this
 * channel for it, and then reads the file out of the granted output directory.
 * A peer answering a count with nothing behind it makes the PDFium case below
 * die in `takeOutput`, which reads as a transport failure.
 *
 * The directory is remembered from what the product SENT on `engine/open`,
 * never recomputed from the root: a fixture that derives a path independently
 * is one that can agree with a directory the product never made.
 */
function serialisingEngine(): FakePeer {
  let output: string | null = null;
  return (channel, params) => {
    if (channel === 'engine/open') {
      output = (params as { outputDirectory: string }).outputDirectory;
      return SESSION;
    }
    if (channel !== 'engine/serialise') return ENGINE(channel, params);
    if (output === null) throw new Error('engine/serialise before engine/open');
    const { into } = params as { into: string };
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    writeFileSync(join(output, into), bytes);
    return { ok: true, value: { bytes: bytes.length } };
  };
}

/** What a PDFium peer was asked, so a case can assert the four-step dance. */
interface PdfiumPeerLog {
  readonly peer: FakePeer;
  /** Every `from` name the host was told to read, in order. */
  readonly inputs: string[];
  /** Whether each input file still existed at the moment the peer was called. */
  readonly inputsPresent: boolean[];
}

/**
 * A PDFium peer that reads its input and writes its output, on the real disk.
 *
 * ## It CHECKS the input rather than assuming it
 *
 * `inputsPresent` is what makes the dance's first step provable. Main writes
 * the image, calls, reads back and removes — and a writer that called before it
 * wrote would satisfy every assertion made after the call returns, because the
 * file is gone by then either way. The only moment the input can be observed is
 * from inside the peer, which is where this looks.
 */
function pdfiumPeer(): PdfiumPeerLog {
  let area: { snapshot: string; output: string } | null = null;
  const inputs: string[] = [];
  const inputsPresent: boolean[] = [];

  const noteInput = (params: unknown): void => {
    const { from } = params as { from: string };
    if (area === null) throw new Error('a PDFium call arrived before engine/open');
    inputs.push(from);
    inputsPresent.push(existsSync(join(area.snapshot, from)));
  };

  const answerWrite = (params: unknown): unknown => {
    noteInput(params);
    if (area === null) throw new Error('unreachable');
    const { into } = params as { into: string };
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    writeFileSync(join(area.output, into), bytes);
    return { ok: true, value: { bytes: bytes.length } };
  };

  return {
    inputs,
    inputsPresent,
    peer: (channel, params) => {
      switch (channel) {
        case 'engine/probe-containment':
          return CONTAINED;
        case 'engine/open': {
          const sent = params as { snapshotDirectory: string; outputDirectory: string };
          area = { snapshot: sent.snapshotDirectory, output: sent.outputDirectory };
          // NO `access`, and the strict schema is what enforces it: a
          // byte-image host's open registers a granted area and parses nothing,
          // so it has no password and nothing to report about one. The MuPDF
          // fakes above all carry `access: 1`; this one carrying it would be
          // refused, which is the pair being a property rather than a
          // description (ADR-0055).
          return { ok: true, value: { session: 'cd12' } };
        }
        case 'engine/capture':
          noteInput(params);
          return {
            ok: true,
            value: {
              captured: true,
              value: {
                kind: 'replaceTextObject',
                prior: { page: 0, objects: [{ index: 2, text: 'WAS' }] },
              },
            },
          };
        case 'engine/apply':
        case 'engine/invert':
          return answerWrite(params);
        default:
          return null;
      }
    },
  };
}

/**
 * A MuPDF peer that issues a DIFFERENT handle per open and records every `engine/apply`.
 *
 * {@link SESSION} answers one handle for every open, which is right for one document and blind
 * for two: a source sent as the target's own handle and a source sent correctly would cross as
 * the same string. A command that names a second document is the case that needs them apart.
 *
 * `capture` refuses for anything but a rotate, because a replaced page has no recordable prior
 * state and the bus takes a checkpoint instead — so `serialise` writes a real file into the
 * output directory the product sent for that handle, for {@link serialisingEngine}'s reason.
 */
function twoSessionEngine(): {
  readonly peer: FakePeer;
  readonly applies: readonly Record<string, unknown>[];
} {
  const outputs = new Map<string, string>();
  const applies: Record<string, unknown>[] = [];
  const peer: FakePeer = (channel, params) => {
    switch (channel) {
      case 'engine/open': {
        const session = `ab0${String(outputs.size + 1)}`;
        outputs.set(session, (params as { outputDirectory: string }).outputDirectory);
        return { ok: true, value: { session, access: 1 } };
      }
      case 'engine/capture': {
        const { command } = params as { command: { kind: string } };
        if (command.kind === 'rotatePages') return ENGINE(channel, params);
        return { ok: true, value: { captured: false, reason: 'a replaced page has no recordable prior state' } };
      }
      case 'engine/serialise': {
        const { session, into } = params as { session: string; into: string };
        const output = outputs.get(session);
        if (output === undefined) throw new Error(`engine/serialise for a handle never issued: ${session}`);
        const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
        writeFileSync(join(output, into), bytes);
        return { ok: true, value: { bytes: bytes.length } };
      }
      case 'engine/apply':
        applies.push(params as Record<string, unknown>);
        return ENGINE(channel, params);
      default:
        return ENGINE(channel, params);
    }
  };
  return { peer, applies };
}

/** The recorded apply for one command kind, or `undefined` where the host was never asked. */
function applyOf(
  applies: readonly Record<string, unknown>[],
  kind: string,
): Record<string, unknown> | undefined {
  return applies.find((params) => (params['command'] as { kind: string }).kind === kind);
}

describe('the composition root, a command that names a SECOND document', () => {
  it('sends the source document’s session to the host, and not the target’s (replacePage)', async () => {
    // THE WIRING BETWEEN THE BUS AND THE REMOTE WRITER, which no other case crosses with a
    // source. `remoteEngine.test.ts` calls the remote writer directly and `documentCommands.test.ts`
    // runs the in-process one, so both were green while the delegate this root registers forwarded
    // two of the bus's four arguments — and every cross-document command reached the host with no
    // source (the 2026-09-15 live external-edit run; ADR-0040's three commands).
    const engine = twoSessionEngine();
    const spy = platformAnswering(engine.peer);
    const picks = [aDocument('replace-target.pdf'), aDocument('replace-source.pdf')];
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(picks.shift() ?? null),
      enginePlatform: spy.platform,
    });

    const target = await handlers['document.open']({});
    if (!target.ok || target.value.kind !== 'opened') throw new Error('the target did not open');
    const source = await handlers['document.open']({});
    if (!source.ok || source.value.kind !== 'opened') throw new Error('the source did not open');

    // A COMMAND ON THE SOURCE FIRST, and it does two jobs. `open` answers before the session
    // exists and the replace enters only the TARGET's lane, so this is what makes the source's
    // session held when the replace reads it. And its own apply names the source's handle, so the
    // case learns which handle is the source's from the product rather than from the order the
    // host happened to answer two opens in.
    const rotated = await handlers['document.execute']({
      docId: source.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });
    expect(rotated.ok).toBe(true);
    const sourceHandle = applyOf(engine.applies, 'rotatePages')?.['session'];
    expect(typeof sourceHandle).toBe('string');

    const replaced = await handlers['document.execute']({
      docId: target.value.docId,
      command: { kind: 'replacePage', source: source.value.docId, at: 0, version: target.value.version },
    });
    expect(replaced.ok).toBe(true);

    const replace = applyOf(engine.applies, 'replacePage');
    expect(replace?.['source']).toBe(sourceHandle);
    // AND NOT THE TARGET'S OWN, which is the transposition `Apply`'s note says no type can catch:
    // both are `MupdfSession`.
    expect(replace?.['session']).not.toBe(sourceHandle);

    // CONTROL FOR THE RECORD: a command naming no second document crosses with no `source` at all,
    // so a peer that stored every apply with some `source` could not pass the assertion above.
    const rotate = applyOf(engine.applies, 'rotatePages');
    expect(rotate !== undefined && 'source' in rotate).toBe(false);
  });
});

describe('the composition root, with BOTH engine hosts', () => {
  it('routes replaceTextObject to the PDFium host and installs the bytes it answered', async () => {
    // TWO PLATFORMS, TWO HARNESSES. Handing one platform to both fields would
    // make the two hosts one AppContainer profile and one pipe — the exact
    // merge `engineHostPrograms.ts` exists to prevent — and every assertion
    // below would still pass, because a single host answering both channel sets
    // is indistinguishable from two at this layer. The separation is asserted
    // where it lives, on the monikers; this case asserts the ROUTING.
    const mupdf = platformAnswering(serialisingEngine());
    const pdfium = pdfiumPeer();
    const second = platformAnswering(pdfium.peer);

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('edited.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      // THE VERSION IS PART OF THE PAYLOAD, because `targets: 'text-object'`
      // makes this command staleness-checked: an index means nothing except
      // against the document the user was looking at. `CommandBus.#refuseIfStale`
      // throws a REGISTRATION defect when a targeting command names none, which
      // is what the first draft of this case met — and it is the same thing the
      // UI half has to send.
      command: {
        kind: 'replaceTextObject',
        page: 0,
        replacements: [{ index: 2, text: 'hi' }],
        version: opened.value.version,
      },
    });
    expect(executed.ok, JSON.stringify(executed)).toBe(true);
    if (!executed.ok) throw new Error('the edit should have succeeded');
    expect(executed.value.version).toBeGreaterThan(opened.value.version);

    // THE SECOND HOST WAS BUILT AND PROBED. Its own containment verdict, not
    // the first host's — the two run under different profiles, so a verdict
    // inherited from the other would be a claim about a token nobody asked.
    expect(second.harness.calls).toContain('host.createSuspended');
    expect(second.harness.calls).toContain('peer.request:engine/probe-containment');
    expect(second.harness.calls).toContain('peer.request:engine/open');
    expect(second.harness.calls).toContain('peer.request:engine/apply');

    // AND THE FIRST HOST NEVER SAW THE COMMAND, which is the routing property
    // rather than a restatement of the one above: a registry that fell back to
    // `mupdf` would reach a host whose `mupdfCommandSchema` refuses this kind,
    // and the refusal would arrive as a malformed envelope rather than as a
    // route.
    expect(mupdf.harness.calls).not.toContain('peer.request:engine/apply');

    // THE INPUT IMAGE WAS THERE WHEN THE HOST WAS CALLED, every time. This is
    // the leg `remoteMupdfExecution` does not have, and the only assertion that
    // can separate *written, then called* from *called, then written* — the
    // file is removed on the way out either way.
    expect(pdfium.inputsPresent.length).toBeGreaterThan(0);
    expect(pdfium.inputsPresent.every(Boolean)).toBe(true);

    // A FRESH NAME PER CALL. One area serves every document and every command
    // (ADR-0048's withdrawn Decision 3), which is safe only because no two
    // calls name one file — two in flight would otherwise overwrite each other
    // in a directory neither can see the other in.
    expect(new Set(pdfium.inputs).size).toBe(pdfium.inputs.length);

    // AND THE BYTES CAME BACK AND WERE INSTALLED. `#install` adopts them, which
    // rebuilds the MuPDF session from the new image — so a SECOND `engine/open`
    // on the first host is what says the answer reached the canonical image
    // rather than being read and dropped.
    expect(spy(mupdf.harness.calls, 'peer.request:engine/open')).toBeGreaterThan(1);
  });

  it('routes editTextBlock to the PDFium host, and its "font cannot carry it" refusal reaches the renderer BY NAME', async () => {
    // THE STRETCH NEITHER HALF OF THE PAIR CROSSES (ADR-0096): the kernel proof
    // throws `TextNotWritableError` in-process, and the UI case stubs the whole
    // kernel. Between them sit the host's code, main's `answered`, and the
    // execute handler's mapping — and a break anywhere there turns a sentence a
    // person can act on into `internal` with an incident id.
    const run = async (applyAnswer: 'bytes' | 'text-not-writable') => {
      const mupdf = platformAnswering(serialisingEngine());
      const base = pdfiumPeer();
      const pdfium: FakePeer = (channel, params) => {
        if (channel === 'engine/capture') {
          // TERMINAL, as the declaration says, so the bus checkpoints and applies.
          return { ok: true, value: { captured: false, reason: 'a block edit has no prior' } };
        }
        if (channel === 'engine/apply' && applyAnswer === 'text-not-writable') {
          return { ok: false, error: { code: 'text-not-writable' } };
        }
        return base.peer(channel, params);
      };
      const second = platformAnswering(pdfium);
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        pickDocument: () => Promise.resolve(aDocument('edited.pdf')),
        enginePlatform: mupdf.platform,
        pdfiumPlatform: second.platform,
      });
      const opened = await handlers['document.open']({});
      if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
      const executed = await handlers['document.execute']({
        docId: opened.value.docId,
        command: {
          kind: 'editTextBlock',
          page: 0,
          blocks: [{ lines: [[2, 4], [7]], text: 'new words', fit: 'reflow' }],
          version: opened.value.version,
        },
      });
      return { executed, second, mupdf, version: opened.value.version };
    };

    const written = await run('bytes');
    expect(written.executed.ok, JSON.stringify(written.executed)).toBe(true);
    expect(written.second.harness.calls).toContain('peer.request:engine/apply');
    expect(written.mupdf.harness.calls).not.toContain('peer.request:engine/apply');

    const refused = await run('text-not-writable');
    // BY NAME: not `internal`, which is what an unmapped engine refusal becomes.
    expect(refused.executed).toStrictEqual({ ok: false, error: { code: 'text-not-writable' } });
  });

  it('answers engine-unavailable when there is no PDFium platform', async () => {
    // THE CONTROL, and it is the state most machines are in: no `pdfium.dll`,
    // so no host, so no registration. The refusal must come from the ROUTE —
    // `CommandBus` looking the writer up and not finding it — and not from a
    // native call into `undefined`, which is what a registry entry set to
    // `undefined` would produce. The conditional spread in the root is what
    // makes the key genuinely absent, and this is what reads it back.
    const mupdf = platformAnswering(serialisingEngine());
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('unedited.pdf')),
      enginePlatform: mupdf.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    // A DECLARED OUTCOME AND NOT A REJECTION, which is what the first draft of
    // this case found and reported: `UnregisteredWriterError` reached the
    // boundary and became `internal` plus an incident id — an unexplained defect
    // for a build assembled exactly as intended, on the one refusal whose cause
    // a user can actually be told.
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: {
        kind: 'replaceTextObject',
        page: 0,
        replacements: [{ index: 2, text: 'hi' }],
        version: opened.value.version,
      },
    });
    expect(executed.ok).toBe(false);
    // THE CODE, not merely `ok: false`. Every other refusal on this channel is
    // also `ok: false`, so a mapping that answered `document-poisoned` — or one
    // that never ran at all, leaving the throw to become `internal` — satisfies
    // the line above and separates nothing.
    if (executed.ok) throw new Error('unreachable');
    expect(executed.error.code).toBe('engine-unavailable');

    // AND NOTHING WAS SERIALISED. A refusal that happened AFTER the bus took
    // the document's bytes would have cost a whole-document round trip through
    // the first host for a command that was never going to run — and it would
    // read as this same failure.
    expect(mupdf.harness.calls).not.toContain('peer.request:engine/serialise');
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

/**
 * A host that serialises a REAL document.
 *
 * `serialisingEngine` answers five bytes, which is enough for every writer that
 * only moves bytes. A signer parses what it is given, so a signing case needs a
 * document pdf-lib can open — and the bytes come from the host, exactly as the
 * product's byte-image path takes them.
 */
function documentServingEngine(document: Uint8Array): FakePeer {
  let output: string | null = null;
  return (channel, params) => {
    if (channel === 'engine/open') {
      output = (params as { outputDirectory: string }).outputDirectory;
      return SESSION;
    }
    if (channel !== 'engine/serialise') return ENGINE(channel, params);
    if (output === null) throw new Error('engine/serialise before engine/open');
    const { into } = params as { into: string };
    writeFileSync(join(output, into), document);
    return { ok: true, value: { bytes: document.byteLength } };
  };
}

describe('the composition root, SIGNING', () => {
  it('signs a document through the writers it registers', async () => {
    // THE SHIPPED ROUTE, END TO END, and the reason this case exists. Every
    // signing test before it built its own bus — `documentSign.test.ts` calls the
    // apply, and `documentCommands.test.ts` registers a signer by hand — so none
    // could see whether the composition root registers one. A route no test
    // takes through the root is a route the product may not have.
    const [{ PDFDocument, StandardFonts }, { default: forge }] = await Promise.all([
      import('@cantoo/pdf-lib'),
      import('node-forge'),
    ]);

    const made = await PDFDocument.create();
    const font = await made.embedFont(StandardFonts.Helvetica);
    made.addPage([400, 600]).drawText('A document to sign', { font, size: 18, x: 20, y: 540 });
    const document = await made.save();

    // A SELF-SIGNED P12, minted in memory: B10 forbids committing a credential.
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86_400_000);
    cert.validity.notAfter = new Date(Date.now() + 86_400_000);
    const names = [{ name: 'commonName', value: 'Monstera Test' }];
    cert.setSubject(names);
    cert.setIssuer(names);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.asn1
      .toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'passphrase', { algorithm: '3des' }))
      .getBytes();
    const certificate = Uint8Array.from(p12, (character: string) => character.charCodeAt(0));

    const mupdf = platformAnswering(documentServingEngine(document));
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('to-sign.pdf')),
      pickCertificate: () => Promise.resolve('certificate.p12'),
      readCertificate: () => Promise.resolve({ kind: 'read', bytes: certificate }),
      enginePlatform: mupdf.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const opensBefore = spy(mupdf.harness.calls, 'peer.request:engine/open');

    const signed = await handlers['document.sign']({
      docId: opened.value.docId,
      passphrase: 'passphrase',
    });

    // THE OUTCOME, with the whole answer in the message, because what this case
    // guards against is an answer that is not `signed` for a reason the root
    // decided rather than the signer.
    expect(signed.ok, JSON.stringify(signed)).toBe(true);
    if (!signed.ok) throw new Error('unreachable');
    expect(signed.value.kind, JSON.stringify(signed.value)).toBe('signed');
    if (signed.value.kind !== 'signed') throw new Error('unreachable');
    expect(signed.value.version).toBeGreaterThan(opened.value.version);

    // AND THE SIGNED BYTES WERE INSTALLED: a byte-image command's result becomes
    // the canonical image and rebuilds the live session, which is a further
    // `engine/open` on the host. A root that answered `signed` and dropped the
    // bytes would pass the lines above.
    expect(spy(mupdf.harness.calls, 'peer.request:engine/open')).toBeGreaterThan(opensBefore);
  }, 120_000);
});

/** What a compose peer was asked, so a case can assert what reached the host. */
interface ComposePeerLog {
  readonly peer: FakePeer;
  /** The source's text, read from the snapshot directory AT THE MOMENT of the call. */
  readonly sources: string[];
  /** Every `from` name, so a case can check the source is gone afterwards. */
  readonly fromPaths: string[];
  /** Which compose channel each call arrived on, so a case can assert the route. */
  readonly channels: string[];
}

/** The bytes the compose peer answers as its PDF. */
const COMPOSED_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x37];

/**
 * A compose host peer that reads its source and writes its output on the real disk.
 *
 * `pdfiumPeer`'s reason for reading the input from INSIDE the call: main writes the
 * source, calls, and removes it, so after the call returns *written, then called*
 * and *called, then written* leave the same directory. Only the peer can tell them
 * apart.
 */
function composePeer(): ComposePeerLog {
  let area: { snapshot: string; output: string } | null = null;
  const sources: string[] = [];
  const fromPaths: string[] = [];
  const channels: string[] = [];

  return {
    sources,
    fromPaths,
    channels,
    peer: (channel, params) => {
      switch (channel) {
        case 'engine/probe-containment':
          return CONTAINED;
        case 'engine/open': {
          const sent = params as { snapshotDirectory: string; outputDirectory: string };
          area = { snapshot: sent.snapshotDirectory, output: sent.outputDirectory };
          return { ok: true, value: { session: 'ef56' } };
        }
        case 'engine/compose-markdown':
        case 'engine/compose-csv': {
          if (area === null) throw new Error(`${channel} arrived before engine/open`);
          channels.push(channel);
          const { from, into } = params as { from: string; into: string };
          const source = join(area.snapshot, from);
          fromPaths.push(source);
          sources.push(existsSync(source) ? readFileSync(source, 'utf8') : '(absent at the call)');
          writeFileSync(join(area.output, into), new Uint8Array(COMPOSED_BYTES));
          return { ok: true, value: { kind: 'composed', bytes: COMPOSED_BYTES.length } };
        }
        // EVERY LISTED IMAGE, read at the call and recorded with its decoder, so a case
        // can assert what was on disk, in which order, routed to which decoder.
        case 'engine/compose-images': {
          if (area === null) throw new Error(`${channel} arrived before engine/open`);
          channels.push(channel);
          const { images, into } = params as {
            images: { from: string; mediaType: string }[];
            into: string;
          };
          for (const image of images) {
            const source = join(area.snapshot, image.from);
            fromPaths.push(source);
            sources.push(
              `${image.mediaType}:${existsSync(source) ? readFileSync(source, 'utf8') : '(absent at the call)'}`,
            );
          }
          writeFileSync(join(area.output, into), new Uint8Array(COMPOSED_BYTES));
          return { ok: true, value: { kind: 'composed', bytes: COMPOSED_BYTES.length } };
        }
        default:
          return null;
      }
    },
  };
}

describe('the composition root, with the COMPOSE host (ADR-0060)', () => {
  it('composes in the compose host, writes where the person chose, and opens that file', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const compose = composePeer();
    const third = platformAnswering(compose.peer);
    const destination = join(scratch, 'from-markdown.pdf');
    const suggested: string[] = [];

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickMarkdown: () => Promise.resolve(join(scratch, 'draft.md')),
      readMarkdown: () =>
        Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('# Title\n') }),
      pickDestination: (name) => {
        suggested.push(name);
        return Promise.resolve(destination);
      },
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });

    const answer = await handlers['document.newFromMarkdown']({});
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(answer.value.kind, JSON.stringify(answer.value)).toBe('opened');
    if (answer.value.kind !== 'opened') throw new Error('unreachable');

    // THE HOST READ THE PERSON'S TEXT, and it was on disk when it was asked.
    expect(compose.sources).toStrictEqual(['# Title\n']);
    // AND IT IS GONE NOW: a copy of a picked file does not stay in a directory a
    // contained process may read.
    expect(compose.fromPaths.map((path) => existsSync(path))).toStrictEqual([false]);

    // THE FILE ON DISK IS THE HOST'S OUTPUT, byte for byte, at the chosen place —
    // and the document that opened is that file, by its name.
    expect([...readFileSync(destination)]).toStrictEqual(COMPOSED_BYTES);
    expect(answer.value.name).toBe('from-markdown.pdf');
    expect(answer.value.byteLength).toBe(COMPOSED_BYTES.length);
    expect(suggested).toStrictEqual(['draft.pdf']);

    // ITS OWN HOST, probed on its own token; the document engine never saw the source.
    expect(third.harness.calls).toContain('peer.request:engine/probe-containment');
    expect(third.harness.calls).toContain('peer.request:engine/compose-markdown');
    expect(mupdf.harness.calls).not.toContain('peer.request:engine/compose-markdown');
  }, 120_000);

  it('appends: opens the composed file as a tab, waits for its session, and merges it', async () => {
    // A MuPDF COMMAND WITH A SOURCE. `mergeDocument` reads the composed document
    // through ITS OWN session, so the order under test is open, session, merge — a
    // merge that reached the bus before the source's session existed is refused for
    // a document that was about to have one.
    // A MERGE CAPTURES NOTHING, and the peer says so as the kernel's
    // `captureMergeDocument` does. `ENGINE` answers every capture with a rotate's prior
    // state, which the bus rightly refuses for a merge — the first draft of this case
    // met exactly that refusal, which is the check working, not the route failing.
    //
    // AND ONE OUTPUT DIRECTORY PER SESSION. `serialisingEngine` remembers the last
    // `engine/open` and answers one session id for every document, which holds while
    // one document is open. Here two are — the target and the composed file — and the
    // target's checkpoint serialise wrote into the composed document's area, which main
    // then could not find. So each open gets its own session, and a serialise writes
    // into the area of the session it names, as a host does.
    const outputs = new Map<string, string>();
    const mupdf = platformAnswering((channel, params) => {
      if (channel === 'engine/open') {
        const session = `ab${String(outputs.size + 10)}`;
        outputs.set(session, (params as { outputDirectory: string }).outputDirectory);
        return { ok: true, value: { session, access: 1 } };
      }
      if (channel === 'engine/serialise') {
        const { session, into } = params as { session: string; into: string };
        const output = outputs.get(session);
        if (output === undefined) throw new Error(`engine/serialise named an unopened session ${session}`);
        const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
        writeFileSync(join(output, into), bytes);
        return { ok: true, value: { bytes: bytes.length } };
      }
      if (channel === 'engine/capture') {
        return { ok: true, value: { captured: false, reason: 'merging has no recordable prior state' } };
      }
      return ENGINE(channel, params);
    });
    const compose = composePeer();
    const third = platformAnswering(compose.peer);
    const target = aDocument('append-target.pdf');
    const destination = join(scratch, 'appended-from-markdown.pdf');

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(target),
      pickMarkdown: () => Promise.resolve(join(scratch, 'more.md')),
      readMarkdown: () =>
        Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('More\n') }),
      pickDestination: () => Promise.resolve(destination),
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const opensBefore = spy(mupdf.harness.calls, 'peer.request:engine/open');

    const appended = await handlers['document.appendMarkdown']({ docId: opened.value.docId, at: 1 });
    expect(appended.ok, JSON.stringify(appended)).toBe(true);
    if (!appended.ok) throw new Error('unreachable');
    expect(appended.value.kind, JSON.stringify(appended.value)).toBe('appended');
    if (appended.value.kind !== 'appended') throw new Error('unreachable');

    // THE TARGET MOVED, and the composed document is a different document, open.
    expect(appended.value.version).toBeGreaterThan(opened.value.version);
    expect(appended.value.opened.docId).not.toBe(opened.value.docId);
    expect(appended.value.opened.name).toBe('appended-from-markdown.pdf');

    // THE MERGE REACHED THE ENGINE HOST, after the composed document got a session
    // there: at least one more `engine/open` than before, then an `engine/apply`.
    const calls = mupdf.harness.calls;
    const lastOpen = calls.lastIndexOf('peer.request:engine/open');
    const apply = calls.lastIndexOf('peer.request:engine/apply');
    expect(spy(calls, 'peer.request:engine/open')).toBeGreaterThan(opensBefore);
    expect(apply).toBeGreaterThan(-1);
    expect(calls.indexOf('peer.request:engine/open', opensBefore)).toBeLessThan(apply);
    expect(lastOpen).toBeGreaterThan(-1);
  }, 120_000);

  it('a CSV import reaches the CSV channel, and never the Markdown one', async () => {
    // THE ROUTE IS THE ASSERTION. Both channels answer `composed` with a count, so a
    // binding that sent a CSV file down the Markdown channel would open a file and
    // pass every other check here — with `markdown-it` reading a CSV.
    const mupdf = platformAnswering(serialisingEngine());
    const compose = composePeer();
    const third = platformAnswering(compose.peer);
    const destination = join(scratch, 'from-csv.pdf');

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickCsv: () => Promise.resolve(join(scratch, 'table.csv')),
      readCsv: () => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('a,b\n') }),
      pickDestination: () => Promise.resolve(destination),
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });

    const answer = await handlers['document.newFromCsv']({});
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(answer.value.kind, JSON.stringify(answer.value)).toBe('opened');

    expect(compose.channels).toStrictEqual(['engine/compose-csv']);
    expect(compose.sources).toStrictEqual(['a,b\n']);
    expect([...readFileSync(destination)]).toStrictEqual(COMPOSED_BYTES);
  }, 120_000);

  it('an image import writes every picked file into the area IN NAME ORDER, and removes each', async () => {
    // THE PICKER'S ORDER IS NOT NAME ORDER, so a binding that kept the dialog's order —
    // or that sent one file's bytes for both — is visible in what the host read.
    const mupdf = platformAnswering(serialisingEngine());
    const compose = composePeer();
    const third = platformAnswering(compose.peer);
    const destination = join(scratch, 'from-images.pdf');
    const suggested: string[] = [];
    const tenth = join(scratch, 'page 10.png');
    const second = join(scratch, 'page 2.jpg');

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickImages: () => Promise.resolve([tenth, second]),
      sizeImage: () => Promise.resolve(16),
      readImage: (path) =>
        Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode(path) }),
      pickDestination: (name) => {
        suggested.push(name);
        return Promise.resolve(destination);
      },
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });

    const answer = await handlers['document.newFromImages']({});
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(answer.value.kind, JSON.stringify(answer.value)).toBe('opened');

    expect(compose.channels).toStrictEqual(['engine/compose-images']);
    expect(compose.sources).toStrictEqual([`image/jpeg:${second}`, `image/png:${tenth}`]);
    // EVERY COPY IS GONE, not only the last one written.
    expect(compose.fromPaths.map((path) => existsSync(path))).toStrictEqual([false, false]);
    expect([...readFileSync(destination)]).toStrictEqual(COMPOSED_BYTES);
    // The suggested name is the FIRST PAGE's file, which is the first in name order.
    expect(suggested).toStrictEqual(['page 2.pdf']);
  }, 120_000);

  it('CONTROL: with no compose platform the import is refused before any picker opens', async () => {
    // THE STATE A MACHINE WITH NO WIN32 PLATFORM IS IN. The refusal must come before
    // the person is asked for a file — and it must be a refusal rather than the
    // source being parsed in main, which a fallback would do.
    const mupdf = platformAnswering(serialisingEngine());
    let picks = 0;
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickMarkdown: () => {
        picks += 1;
        return Promise.resolve(null);
      },
      enginePlatform: mupdf.platform,
    });

    const answer = await handlers['document.newFromMarkdown']({});
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error('unreachable');
    expect(answer.error.code).toBe('engine-unavailable');
    expect(picks).toBe(0);
  });
});
