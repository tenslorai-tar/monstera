import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  INTEGRITY_LOW,
  JOB_LIMIT_ACTIVE_PROCESS,
  JOB_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_LIMIT_PROCESS_MEMORY,
  JOB_UI_RESTRICTIONS_ALL,
  type PreparedSignature,
} from '@monstera/kernel';
import { prepareSignature } from '@monstera/kernel/engine';
import { type BoxedCharacter, type ComposeSkip, type FormPath, blockEditOf, replacementFieldsOf } from '@monstera/contract';
import { type DocVersion, asDocId, err, ok } from '@monstera/shared';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { type EngineHostPlatform, createShellDependencies } from './composition.js';
import type { ConverterExecutablePath } from './containedProgram.js';
import type { BakedAppInfo as AppInfo } from './contractHandlers.js';
import type { ConverterPlatform } from './converterSession.js';
import type { ImageRead } from './documentCommands.js';
import {
  FAKE_CONTAINER,
  FAKE_CREATED,
  FAKE_JOB,
  FAKE_USER,
  type FakePeer,
  type HostHarness,
  hostHarness,
} from './engineHostFake.js';
import type { DirectoryCreationSurface, DirectoryPath } from './sessionDirectories.js';
import { harnessSurfaces } from './harnessComposition.js';
import { createEphemeralSettings } from './settingsFile.js';
import { pictureName } from './recentPictures.js';

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
const appInfo: AppInfo = { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' };

/** A mebibyte, so a low-memory reading reads as one a computer gives. */
const MIB = 1_048_576;

/** The name every conversion here runs under (ADR-0234). */
const WORK = 'work-under-test';

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
const ENGINE: FakePeer = (channel, params) => {
  switch (channel) {
    // A COMMAND THAT PLACES ON PAGES READS THIS FIRST since ADR-0254, to name the pages it leaves, and the default
    // below sends no reply — so such a command through this peer waited for ever. Answered as a one-page document
    // whose named pages are Letter, unturned, and display something.
    case 'engine/page-geometry': {
      const { pages } = params as { pages: readonly number[] };
      return {
        ok: true,
        value: {
          pageCount: 1,
          rotations: pages.map(() => 0),
          sizes: pages.map(() => ({ width: 612, height: 792 })),
          boxes: pages.map(() => ({ x0: 0, y0: 0, x1: 612, y1: 792 })),
        },
      };
    }
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
    // EVERY SAVE ASKS THIS FIRST since item 6 (the answer also says whether the save is a removal's, which keeps no
    // backup), and the default below sends no reply — so a save through this peer waited for ever. Answered as an
    // unsigned document with no removal: an ordinary save.
    case 'engine/signatures-kept':
      return { ok: true, value: { signatures: 0, kept: true } };
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

  it('an open KEEPS A PICTURE of page 1 through the host, and a command after it still runs (ADR-0100)', async () => {
    // THE CAPTURE THE ROOT CHAINS ON EVERY OPEN, through the real lane and the real remote writer. The
    // handler cases drive it with a fake picture function; every other case here passes no folder, so without
    // this one the join `picture: (docId) => commands.firstPagePicture(docId)` was reached by nothing — and it
    // runs in the document's lane, where a capture that never finished would hold every later command.
    // NOT an ordering claim: a command sent straight after the open was measured to reach the lane BEFORE the
    // capture (2026-09-25, this case's first draft), since the capture waits for the open's sessions.
    const peer = picturingEngine();
    const spy = platformAnswering(peer.answer);
    const held = new Map<string, Uint8Array>();
    const path = aDocument('pictured.pdf');
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(path),
      enginePlatform: spy.platform,
      recentPictureFiles: {
        write: (name, bytes) => held.set(name, bytes),
        read: (name) => (held.has(name) ? new Uint8Array(held.get(name) ?? []) : null),
        remove: (name) => held.delete(name),
        names: () => [...held.keys()],
      },
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    // The capture is chained on the open's sessions and is not awaited by the open, so the picture lands after.
    await vi.waitFor(() => {
      expect(held.size).toBe(1);
    });

    // AND THE LANE IS FREE AFTERWARDS: a command sent once the picture is kept completes. A capture that held
    // its lane would leave this waiting, which is how the fake host's unanswered page image first showed.
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
    });
    expect(executed.ok).toBe(true);

    // PAGE 1 AS A JPEG AT QUALITY 60 — the parameters ADR-0100 measured, as the host received them.
    expect(peer.asked).toStrictEqual([{ page: 0, format: 'jpeg', quality: 60 }]);
    // AND THE BYTES THE HOST WROTE are the picture kept, under the path's digest.
    expect([...held.keys()]).toStrictEqual([pictureName(path)]);
    expect([...(held.get(pictureName(path)) ?? [])]).toStrictEqual([...PICTURE]);
  });

  it('an open the host answers NEEDS A PASSWORD deletes the picture it had and draws none (CR-DOC-11)', async () => {
    // THE PICTURE OF A FILE SINCE PROTECTED, here or by another program: the open's capture is the one chance to take
    // it back, and a capture that failed for want of a session kept it. Through the root, so the supervisor's answer
    // reaches `firstPagePicture` and the picture store by the joins the application uses.
    const peer = picturingEngine();
    const locked: FakePeer = (channel, params) =>
      channel === 'engine/open' ? { ok: false, error: { code: 'needs-password' } } : peer.answer(channel, params);
    const spy = platformAnswering(locked);
    const path = aDocument('protected.pdf');
    const held = new Map<string, Uint8Array>([[pictureName(path), PICTURE]]);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(path),
      enginePlatform: spy.platform,
      recentPictureFiles: {
        write: (name, bytes) => held.set(name, bytes),
        read: (name) => (held.has(name) ? new Uint8Array(held.get(name) ?? []) : null),
        remove: (name) => held.delete(name),
        names: () => [...held.keys()],
      },
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    await vi.waitFor(() => {
      expect(held.size).toBe(0);
    });
    // NOTHING WAS DRAWN: the rule is asked before the session, and a locked document has none to draw from.
    expect(peer.asked).toStrictEqual([]);
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
    const checkpoints = join(scratch, 'checkpoints-hard-shape');
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
      // This case's own, so what it finds there is this document's and nothing another case left.
      checkpointDirectory: checkpoints,
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

    // AND THE FILE MOVED OUT OF THE HOST'S REACH, INTO MAIN'S CHECKPOINTS (ADR-0121). Both ends in one case, because
    // they are two files a composition root joins: the output directory no longer holds it — every serialise is a
    // whole copy of the user's document where the contained host may read — and the one document directory under
    // the checkpoint root holds exactly the bytes the host wrote, which a move that lost them or a checkpoint made
    // any other way would not.
    expect(existsSync(join(lastOutputDirectory(spy.directories), written[0] ?? ''))).toBe(false);
    const [documentDirectory, ...others] = readdirSync(checkpoints);
    expect(others).toStrictEqual([]);
    const [checkpoint, ...more] = readdirSync(join(checkpoints, documentDirectory ?? ''));
    expect(more).toStrictEqual([]);
    expect(readFileSync(join(checkpoints, documentDirectory ?? '', checkpoint ?? ''), 'utf8')).toBe(
      '%PDF-1.7 checkpoint\n',
    );
  });

  describe('a document opened with its password (ADR-0171)', () => {
    const PASSWORD = 'sample-only-0171';

    /** A host whose document opens only with {@link PASSWORD}, taking a checkpoint per rotate, recording every open. */
    function lockedHost(): { readonly spy: ReturnType<typeof platformAnswering>; readonly opens: unknown[] } {
      const opens: unknown[] = [];
      const spy = platformAnswering((channel, params) => {
        if (channel === 'engine/open') {
          // EVERY KEY, as the host's `openCopy` tries them (ADR-0171 Decision 8): this file opens when one is right.
          const { keys } = params as { keys: readonly unknown[] };
          opens.push(keys);
          // `access: 2`, what a user password buys, beside this file's `SESSION`, which no password opened.
          if (keys.includes(PASSWORD)) return { ok: true, value: { session: 'ab0f', access: 2 } };
          return { ok: false, error: { code: keys.length === 0 ? 'needs-password' : 'wrong-password' } };
        }
        if (channel === 'engine/capture') {
          return { ok: true, value: { captured: false, reason: 'page 1 carries a non-numeric /Rotate (/Sideways)' } };
        }
        if (channel === 'engine/serialise') {
          const { into } = params as { into: string };
          writeFileSync(join(lastOutputDirectory(spy.directories), into), '%PDF-1.7 checkpoint\n');
          return { ok: true, value: { bytes: 20 } };
        }
        return ENGINE(channel, params);
      });
      return { spy, opens };
    }

    it('an undo past a checkpoint reopens the session with the password the document was unlocked with', async () => {
      const { spy, opens } = lockedHost();
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        pickDocument: () => Promise.resolve(aDocument('locked.pdf')),
        enginePlatform: spy.platform,
        checkpointDirectory: join(scratch, 'checkpoints-locked'),
      });

      const opened = await handlers['document.open']({});
      if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
      const docId = opened.value.docId;
      const unlocked = await handlers['document.unlock']({ docId, password: PASSWORD });
      expect(unlocked.ok && unlocked.value.kind).toBe('unlocked');

      const executed = await handlers['document.execute']({
        docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      });
      expect(executed.ok).toBe(true);
      const before = opens.length;

      // THE RESTORE IS A RECYCLE, which ADR-0055 refused for this document: the undo failed. Now it reopens, and the
      // open that rebuilt the session carried the password, asserted on what the host was sent.
      const undone = await handlers['document.undo']({ docId });
      expect(undone.ok && undone.value.kind).toBe('undone');
      expect(opens.slice(before)).toStrictEqual([[PASSWORD]]);
      // AND THE OPEN-TIME ATTEMPT CARRIED NONE: nothing is held before the unlock.
      expect(opens[0]).toStrictEqual([]);
    });

    /**
     * CR-DOC-08: a host that ENDS under a document a password opened. The rebuild is the supervisor's, in the document's
     * own lane, and it is the one reopen the review found refused: it opened with no password, was answered
     * `needs-password`, and left the document with no session, no unlock and no save.
     */
    function endingHost(): {
      readonly handlers: ReturnType<typeof createShellDependencies>['handlers'];
      readonly spy: ReturnType<typeof platformAnswering>;
      readonly opens: unknown[];
      readonly applies: unknown[];
      readonly crash: { armed: boolean };
    } {
      const opens: unknown[] = [];
      const applies: unknown[] = [];
      const crash = { armed: false };
      let sessions = 0;
      const spy = platformAnswering((channel, params) => {
        if (channel === 'engine/open') {
          // EVERY KEY the open carries (ADR-0171 Decision 8), as `lockedHost` reads them: the frame says `keys`, not `password`.
          const { keys } = params as { keys: readonly unknown[] };
          opens.push(keys);
          if (keys.includes(PASSWORD)) return { ok: true, value: { session: `ab0${String(sessions++)}`, access: 2 } };
          return { ok: false, error: { code: keys.length === 0 ? 'needs-password' : 'wrong-password' } };
        }
        if (channel === 'engine/apply') {
          applies.push(params);
          if (crash.armed) return null;
        }
        return ENGINE(channel, params);
      });
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        pickDocument: () => Promise.resolve(aDocument('locked.pdf')),
        enginePlatform: spy.platform,
        checkpointDirectory: join(scratch, 'checkpoints-ending'),
      });
      return { handlers, spy, opens, applies, crash };
    }

    it('a host that ends under it rebuilds the session with the held password, and the edits made so far are replayed (CR-DOC-08)', async () => {
      const { handlers, spy, opens, applies, crash } = endingHost();
      const opened = await handlers['document.open']({});
      if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
      const docId = opened.value.docId;
      expect((await handlers['document.unlock']({ docId, password: PASSWORD })).ok).toBe(true);
      const rotate = () => handlers['document.execute']({ docId, command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 } });
      expect((await rotate()).ok).toBe(true);

      // THE HOST ENDS UNDER THE SECOND EDIT, as a crash would, with its call on the wire.
      crash.armed = true;
      const before = applies.length;
      const dying = rotate();
      await vi.waitFor(() => {
        expect(applies.length).toBe(before + 1);
      });
      const opensBeforeDeath = opens.length;
      spy.harness.exit(1);
      await dying.then(
        () => undefined,
        () => undefined,
      );
      crash.armed = false;

      // THE NEXT COMMAND COMPLETES ONLY AFTER THE LANE'S REBUILD HAS: a session with no password would have been answered
      // `needs-password` and the command would find no session. It runs, and the document is saved and closed as any other.
      expect((await rotate()).ok).toBe(true);
      const rebuilds = opens.slice(opensBeforeDeath);
      expect(rebuilds.length).toBeGreaterThan(0);
      // EVERY OPEN THE REBUILD MADE CARRIED THE PASSWORD, and the first attempt at the document's life carried none: the
      // password is the one `document.unlock` was given, held in main and not asked for again.
      expect(rebuilds.every((keys) => Array.isArray(keys) && keys.includes(PASSWORD))).toBe(true);
      expect(opens[0]).toStrictEqual([]);
      // THE EDIT MADE BEFORE THE DEATH IS REPLAYED onto the rebuilt session: the log held it, and the canonical image
      // (the file as opened) does not.
      expect(applies.length).toBeGreaterThanOrEqual(before + 1 + 1 + 1);
    });
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
    // A HANDLE PER OPEN, as a real host issues them. This read `next`, which the picks move before either open reaches
    // the host, so both were issued the same handle — which main now refuses (CR-SEC-10), as the host's own `issue` does.
    let issued = 0;
    const spy = platformAnswering((channel) => {
      if (channel === 'engine/probe-containment') return CONTAINED;
      if (channel !== 'engine/open') return ENGINE(channel, null);
      issued += 1;
      return { ok: true, value: { session: `ab0${String(issued)}`, access: 1 } };
    });
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
    // AND IT WAS NEVER ENDED: the control for the duplicate-handle case below, where the same two opens end the host.
    expect(spy.harness.calls).not.toContain('host.terminate');
  });

  it('a host that issues ONE HANDLE FOR TWO DOCUMENTS is ended, never left aliasing them (CR-SEC-10)', async () => {
    const paths = [aDocument('first.pdf'), aDocument('second.pdf')];
    let next = 0;
    // THE FIRST HOST ISSUES `ab0f` TO BOTH, so the second document would be adopted under the first's handle: its area
    // overwriting the first's in main's table, the first's prior state written into the second's snapshot directory.
    // The host built after it issues a handle per open, so the documents' recovery has somewhere to land.
    let issued = 0;
    const spy = platformAnswering((channel) => {
      if (channel === 'engine/probe-containment') return CONTAINED;
      if (channel !== 'engine/open') return ENGINE(channel, null);
      issued += 1;
      return { ok: true, value: { session: issued <= 2 ? 'ab0f' : `ab1${String(issued)}`, access: 1 } };
    });
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

    // THE COMMANDS GO IN AFTER THE ENDING, which is the event waited for. One sent before it can be in flight on the
    // ended host, and an in-flight call fails with the connection by design; whether it was is the runner's choice.
    // After it, each command queues behind its document's reopen, and succeeds only once that document has a session
    // of its own again.
    await vi.waitFor(() => {
      expect(spy.harness.calls).toContain('host.terminate');
    });
    for (const opened of [first.value, second.value]) {
      const executed = await handlers['document.execute']({
        docId: opened.docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      });
      expect(executed.ok).toBe(true);
    }

    // THE DECISION: the host that issued the handle twice was ended, and a second built, in which each document was
    // opened again under a handle of its own, ONCE. The second document's open met the duplicate and is not poisoned:
    // one host's ending is one failure for it, as for the first, so its command above succeeded.
    const built = spy.harness.calls.lastIndexOf('host.createSuspended');
    expect(spy.harness.calls.filter((call) => call === 'host.createSuspended')).toHaveLength(2);
    expect(spy.harness.calls.slice(built).filter((call) => call === 'peer.request:engine/open')).toHaveLength(2);
  });

  it('P3: a host that ends twice under ONE document’s command poisons that document, and the OTHER keeps working', async () => {
    // THROUGH THE COMPOSITION ROOT, the code between the client that knows which call was on the wire and the handler
    // that counts it: which lane a call was made in, the connection's ending, and `onEngineHostEnded`. The control is
    // this same case before ADR-0023's correction of 2026-10-03: the second document answered `document-poisoned`.
    const paths = [aDocument('guilty.pdf'), aDocument('bystander.pdf')];
    let next = 0;
    let opened = 0;
    // WHILE SET, an apply is taken and never answered: the case ends the host under it, as a crash would.
    const crash = { armed: false };
    const spy = platformAnswering((channel, params) => {
      if (channel === 'engine/open') return { ok: true, value: { session: `ab0${String(opened++)}`, access: 1 } };
      if (channel === 'engine/apply' && crash.armed) return null;
      return ENGINE(channel, params);
    });
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(paths[next++] ?? null),
      enginePlatform: spy.platform,
    });
    const guilty = await handlers['document.open']({});
    const bystander = await handlers['document.open']({});
    if (!guilty.ok || guilty.value.kind !== 'opened') throw new Error('the first did not open');
    if (!bystander.ok || bystander.value.kind !== 'opened') throw new Error('the second did not open');
    const rotate = (docId: typeof guilty.value.docId) =>
      handlers['document.execute']({ docId, command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 } });

    const applies = (): number => spy.harness.calls.filter((call) => call === 'peer.request:engine/apply').length;
    const outcomes: string[] = [];
    for (let ending = 0; ending < 2; ending += 1) {
      // SETTLED FIRST: after an ending each document's lane reopens and REPLAYS its log, and the bystander's replay is
      // an apply of its own. Ended under that, the ending is the bystander's — rightly — which is how this case was
      // first written wrong. A command through each lane completes only once that lane's rebuild has; and the guilty
      // document answering one between its two endings is the withdrawn reset-on-success's case, which must not save it.
      for (const docId of [guilty.value.docId, bystander.value.docId]) expect((await rotate(docId)).ok).toBe(true);
      crash.armed = true;
      const before = applies();
      const dying = rotate(guilty.value.docId);
      // THE GUILTY DOCUMENT'S CALL IS ON THE WIRE when the host ends, and nothing else is.
      await vi.waitFor(() => {
        expect(applies()).toBe(before + 1);
      });
      spy.harness.exit(1);
      outcomes.push(
        await dying.then(
          (answer) => (answer.ok ? 'ok' : answer.error.code),
          (thrown: unknown) => `threw:${String(thrown)}`,
        ),
      );
      crash.armed = false;
    }
    // EACH COMMAND THE DYING HOST TOOK FAILED — thrown to the IPC wrapper, which answers `internal` — and none read ok.
    expect(outcomes).toHaveLength(2);
    expect(outcomes.filter((outcome) => !outcome.startsWith('threw:'))).toStrictEqual([]);

    const answered = await rotate(bystander.value.docId);
    expect(answered.ok).toBe(true);
    const refused = await rotate(guilty.value.docId);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('document-poisoned');
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
    // THE READER'S OWN ENDING, which the fake delivers one turn after the stop as the shipped thread does tens of
    // milliseconds after it — and only then are its stop event and its pipe released.
    await new Promise((settled) => setImmediate(settled));
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
      // THE SAMPLER BEFORE THE TERMINATE, so it never reads, or kills, a process this shell is ending on purpose.
      'sampler.stop',
      'host.terminate',
      'host.close:process',
      'host.close:job',
      'host.discardDiagnostics',
      // NO TERMINATE OF THE READER THREAD, and its handles LAST: released when its ending arrives. A terminate here
      // was the order that aborted the process at 134 when it landed inside a koffi call (`readerDispose.proof.mjs`).
      'reader.closeEvent',
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
 * An engine a MERGE can run against: one session and one output directory per open document, because a merge holds
 * two — the target and the composed source — and a serialise must write into the area of the session it names, as a
 * host does. A merge captures nothing, as the kernel's `captureMergeDocument` says.
 */
function mergingEngine(): FakePeer {
  const outputs = new Map<string, string>();
  return (channel, params) => {
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
  };
}

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

/** The bytes {@link picturingEngine} writes: a JPEG's start-of-image marker and a few more, distinct from any other. */
const PICTURE = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x4d, 0x6f);

/**
 * A MuPDF peer that also draws `engine/pageImage` into the granted output directory, as the host does, and
 * records what it was asked. The directory is the one the product SENT on `engine/open`, for
 * {@link serialisingEngine}'s reason.
 */
function picturingEngine(): {
  readonly answer: FakePeer;
  readonly asked: { page: number; format: string; quality: number }[];
} {
  let output: string | null = null;
  const asked: { page: number; format: string; quality: number }[] = [];
  return {
    asked,
    answer: (channel, params) => {
      if (channel === 'engine/open') {
        output = (params as { outputDirectory: string }).outputDirectory;
        return SESSION;
      }
      if (channel !== 'engine/pageImage') return ENGINE(channel, params);
      if (output === null) throw new Error('engine/pageImage before engine/open');
      const { page, format, quality, into } = params as {
        page: number;
        format: string;
        quality: number;
        into: string;
      };
      asked.push({ page, format, quality });
      writeFileSync(join(output, into), PICTURE);
      return { ok: true, value: { bytes: PICTURE.length } };
    },
  };
}

/** What a PDFium peer was asked, so a case can assert the four-step dance. */
interface PdfiumPeerLog {
  readonly peer: FakePeer;
  /** Every `from` name the host was told to read, in order. */
  readonly inputs: string[];
  /** Whether each input file still existed at the moment the peer was called. */
  readonly inputsPresent: boolean[];
  /** The `password` each of those frames carried (ADR-0171's addendum): the text, or `null` for none. */
  readonly passwords: unknown[];
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
function pdfiumPeer(drawn: readonly { character: string; page: number }[] = []): PdfiumPeerLog {
  let area: { snapshot: string; output: string } | null = null;
  const inputs: string[] = [];
  const inputsPresent: boolean[] = [];
  const passwords: unknown[] = [];

  const noteInput = (params: unknown): void => {
    const { from, password } = params as { from: string; password: unknown };
    if (area === null) throw new Error('a PDFium call arrived before engine/open');
    inputs.push(from);
    inputsPresent.push(existsSync(join(area.snapshot, from)));
    passwords.push(password);
  };

  const answerWrite = (params: unknown): unknown => {
    noteInput(params);
    if (area === null) throw new Error('unreachable');
    const { into } = params as { into: string };
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    writeFileSync(join(area.output, into), bytes);
    // AND THE BOXES IT DREW, which a case hands it (ADR-0174), none by default; nothing noted (ADR-0270).
    return { ok: true, value: { bytes: bytes.length, boxed: [...drawn], more: 0, noted: [] } };
  };

  return {
    inputs,
    inputsPresent,
    passwords,
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
      command: {
        kind: 'replacePage',
        source: source.value.docId,
        pages: [0],
        sourcePages: 'all',
        version: target.value.version,
      },
    });
    expect(replaced.ok).toBe(true);

    const replace = applyOf(engine.applies, 'replacePage');
    expect(replace?.['sources']).toStrictEqual([sourceHandle]);
    // AND NOT THE TARGET'S OWN, which is the transposition `Apply`'s note says no type can catch:
    // both are `MupdfSession`.
    expect(replace?.['session']).not.toBe(sourceHandle);

    // CONTROL FOR THE RECORD: a command naming no second document crosses with an EMPTY list,
    // so a peer that stored every apply with some source could not pass the assertion above.
    const rotate = applyOf(engine.applies, 'rotatePages');
    expect(rotate?.['sources']).toStrictEqual([]);
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
    // A BOX THE HOST DREW (ADR-0174), so the answer below says whether the composition root carries it to the renderer.
    const pdfium = pdfiumPeer([{ character: '中', page: 0 }]);
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
        ...replacementFieldsOf([{ index: 2, text: 'hi' }]),
        version: opened.value.version,
      },
    });
    expect(executed.ok, JSON.stringify(executed)).toBe(true);
    if (!executed.ok) throw new Error('the edit should have succeeded');
    expect(executed.value.version).toBeGreaterThan(opened.value.version);
    // THE HOST'S BOX REACHED THE ANSWER, across every hop between the host's frame and `document.execute`: the remote
    // writer, the bus, main's commands and the handler (ADR-0174). The kernel and renderer halves cannot see these.
    expect(executed.value.boxed).toStrictEqual([{ character: '中', page: 0 }]);
    expect(executed.value.more).toBe(0);

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

    // A DOCUMENT THAT OPENS WITH NO PASSWORD SENDS `null` on every frame: the control for the case below.
    expect(pdfium.passwords).toStrictEqual(pdfium.inputs.map(() => null));
  });

  // THE OWNER'S PART 7 A (0.1.14.0): after every document closed, the hosts an edit had started stayed alive at full
  // size until the application quit. The last document out stops them, and the next document builds new ones.
  it('the LAST document closed stops the MuPDF and PDFium hosts an edit started, and the next document builds new ones', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const second = platformAnswering(pdfiumPeer([]).peer);
    const names = ['closed-first.pdf', 'opened-after.pdf'];
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument(names.shift() ?? 'more.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const edited = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: opened.value.version },
    });
    expect(edited.ok, JSON.stringify(edited)).toBe(true);
    // BOTH HOSTS RUNNING before the close, so what follows is a stop and not a host that never started.
    expect(spy(mupdf.harness.calls, 'host.createSuspended')).toBe(1);
    expect(spy(second.harness.calls, 'host.createSuspended')).toBe(1);
    expect(spy(mupdf.harness.calls, 'host.terminate') + spy(second.harness.calls, 'host.terminate')).toBe(0);

    expect(await handlers['document.close']({ docId: opened.value.docId })).toStrictEqual(ok({ closed: true }));
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(1);
    expect(spy(second.harness.calls, 'host.terminate')).toBe(1);
    // AND NOTHING OF THEIRS LEFT ON DISK: every pair either host was granted is removed.
    const created = (list: readonly string[]): number => list.filter((entry) => entry.startsWith('create:')).length;
    const removed = (list: readonly string[]): number => list.filter((entry) => entry.startsWith('removeTree:')).length;
    expect(removed(mupdf.directories)).toBe(created(mupdf.directories));
    expect(removed(second.directories)).toBe(created(second.directories));

    // THE NEXT DOCUMENT BUILDS A NEW MuPDF HOST, and opens in it: a stopped host is never asked again.
    const next = await handlers['document.open']({});
    expect(next.ok && next.value.kind === 'opened', JSON.stringify(next)).toBe(true);
    // THE SESSION OPENS IN THE DOCUMENT'S LANE after `document.open` has answered, so it is waited for.
    await vi.waitFor(() => {
      expect(spy(mupdf.harness.calls, 'peer.request:engine/open')).toBeGreaterThan(2);
    });
    expect(spy(mupdf.harness.calls, 'host.createSuspended')).toBe(2);
  });

  it('an IDLE PDFium host is stopped with the document still open, the MuPDF host is not, and the next edit builds a new one (item 13b)', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const second = platformAnswering(pdfiumPeer([]).peer);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('idle.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
      hostIdleMs: 50,
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const { docId } = opened.value;
    const edit = (version: DocVersion) =>
      handlers['document.execute']({
        docId,
        command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version },
      });
    const first = await edit(opened.value.version);
    if (!first.ok) throw new Error(JSON.stringify(first));
    expect(spy(second.harness.calls, 'host.createSuspended')).toBe(1);

    // STOPPED WHILE THE DOCUMENT IS OPEN, and nothing of it left on disk.
    await vi.waitFor(() => {
      expect(spy(second.harness.calls, 'host.terminate')).toBe(1);
    });
    const created = (list: readonly string[]): number => list.filter((entry) => entry.startsWith('create:')).length;
    const removed = (list: readonly string[]): number => list.filter((entry) => entry.startsWith('removeTree:')).length;
    expect(removed(second.directories)).toBe(created(second.directories));
    // THE MuPDF HOST HOLDS THE DOCUMENT'S SESSION, so no idle stops it.
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(0);

    // THE NEXT EDIT BUILDS A NEW PDFium HOST, and its answer is installed as the first one's was.
    const next = await edit(first.value.version);
    expect(next.ok, JSON.stringify(next)).toBe(true);
    expect(spy(second.harness.calls, 'host.createSuspended')).toBe(2);
  });

  it('LOW MEMORY stops the idle PDFium host at once, leaves the MuPDF host and the document, logs it and tells the person nothing (item 13e)', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const second = platformAnswering(pdfiumPeer([]).peer);
    let available = 90;
    // THE SHELL'S OWN SINK, which writes each failure line to stderr when no log is given.
    const written = vi.spyOn(process.stderr, 'write');
    const logged = (): string[] =>
      written.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('MONSTERA_SHELL_FAILURE memory-low'));
    // WHAT THE PERSON IS TOLD: every event main pushes, of any name, so a notice restored under any event would show
    // (ADR-0253's correction of 2026-10-23 withdrew the one there was).
    const pushed: string[] = [];
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('low.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
      memoryPressure: { intervalMs: 20, belowFraction: 0.1, read: () => ({ available: available * MIB, total: 100 * MIB }) },
      sendEvent: (event) => {
        pushed.push(event);
      },
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const { docId } = opened.value;
    const edit = (version: DocVersion) =>
      handlers['document.execute']({
        docId,
        command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version },
      });
    const first = await edit(opened.value.version);
    if (!first.ok) throw new Error(JSON.stringify(first));
    // CONTROL: readings above the line stop nothing.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(spy(second.harness.calls, 'host.terminate')).toBe(0);

    const beforeLow = pushed.length;
    available = 5;
    await vi.waitFor(() => {
      expect(spy(second.harness.calls, 'host.terminate')).toBe(1);
    });
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(0);
    await vi.waitFor(() => {
      expect(logged()).toStrictEqual([
        // THE FIGURE THE LINE WAS CROSSED AT (R15), so a person's report says how low it was.
        'MONSTERA_SHELL_FAILURE memory-low: available memory fell below 10% (5 of 100 MiB available): PDFium host stopped, compose host kept\n',
      ]);
    });
    // NOTHING PUSHED, though the readings stayed low for several intervals since: the stop above is the whole answer.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(pushed.slice(beforeLow)).toStrictEqual([]);
    // THE DOCUMENT IS AS IT WAS: the next edit lands on the version the first one made.
    const next = await edit(first.value.version);
    expect(next.ok, JSON.stringify(next)).toBe(true);
    written.mockRestore();
  });

  it('LOW MEMORY CROSSED AGAIN AND AGAIN, with actions and a renderer renewal between, is logged per spell and tells the person nothing', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const second = platformAnswering(pdfiumPeer([]).peer);
    let available = 90;
    const written = vi.spyOn(process.stderr, 'write');
    const lows = (): number =>
      written.mock.calls.filter(([line]) => String(line).startsWith('MONSTERA_SHELL_FAILURE memory-low: available memory fell')).length;
    const pushed: string[] = [];
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('low.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
      memoryPressure: { intervalMs: 20, belowFraction: 0.1, read: () => ({ available: available * MIB, total: 100 * MIB }) },
      sendEvent: (event) => {
        pushed.push(event);
      },
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const { docId } = opened.value;
    let version = opened.value.version;
    const beforeLow = pushed.length;
    // THE OWNER'S 8 GB COMPUTER FORCED: the reading falls under the line and climbs back over it ten times, an edit
    // between each, and the renderer's memory released (the renewal's own call, ADR-0252) halfway through.
    for (let crossing = 1; crossing <= 10; crossing += 1) {
      available = 5;
      await vi.waitFor(() => {
        expect(lows()).toBe(crossing);
      });
      const edited = await handlers['document.execute']({
        docId,
        command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: `hi ${String(crossing)}` }]), version },
      });
      if (!edited.ok) throw new Error(JSON.stringify(edited));
      version = edited.value.version;
      if (crossing === 5) await handlers['app.releaseMemory']({});
      available = 90;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    // TEN SPELLS, each answered by giving memory back and logged with its figure; and nothing pushed to the person.
    expect(lows()).toBe(10);
    expect(pushed.slice(beforeLow)).toStrictEqual([]);
    written.mockRestore();
  });

  it('LOW MEMORY tells the person nothing on an 8 GiB computer or a 16 GiB one, and stops the idle host on both (ADR-0253, 2026-10-23)', async () => {
    const GIB = 1024 * MIB;
    const told: Record<string, string[]> = {};
    for (const total of [8 * GIB, 16 * GIB]) {
      const name = `${String(total / GIB)} GiB`;
      const mupdf = platformAnswering(serialisingEngine());
      const second = platformAnswering(pdfiumPeer([]).peer);
      // LOW BY THE SAME SHARE on both, 5% of the total, and crossing twice in the run.
      let available = 0.9 * total;
      const pushed: string[] = [];
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        pickDocument: () => Promise.resolve(aDocument('low.pdf')),
        enginePlatform: mupdf.platform,
        pdfiumPlatform: second.platform,
        memoryPressure: { intervalMs: 20, belowFraction: 0.1, read: () => ({ available, total }) },
        sendEvent: (event) => {
          pushed.push(event);
        },
      });
      const opened = await handlers['document.open']({});
      if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
      const edited = await handlers['document.execute']({
        docId: opened.value.docId,
        command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: opened.value.version },
      });
      if (!edited.ok) throw new Error(JSON.stringify(edited));
      const beforeLow = pushed.length;
      available = 0.05 * total;
      // CONTROL: THE HOST STOPS ON EVERY COMPUTER, so a run that told nothing because it never read low memory cannot
      // pass for one that read it and told nothing. The 8 GiB run is the one the withdrawn notice told, so restoring the
      // notice, under any event name, turns this case red there.
      await vi.waitFor(() => {
        expect(spy(second.harness.calls, 'host.terminate'), name).toBe(1);
      });
      // A SECOND CROSSING IN THE SAME RUN, which tells nothing more.
      available = 0.9 * total;
      await new Promise((resolve) => setTimeout(resolve, 60));
      available = 0.05 * total;
      await new Promise((resolve) => setTimeout(resolve, 200));
      told[name] = pushed.slice(beforeLow);
    }
    expect(told).toStrictEqual({ '8 GiB': [], '16 GiB': [] });
  });

  it('LOW MEMORY while the PDFium host is working leaves it running, and says it was kept (item 13e)', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const pdfium = pdfiumPeer([]);
    // A CALL THAT DOES NOT FINISH: once holding, the peer answers no apply, so that edit stays in the host.
    let holding = false;
    let held = 0;
    const second = platformAnswering((channel, params) => {
      if (holding && channel === 'engine/apply') {
        held += 1;
        return null;
      }
      return pdfium.peer(channel, params);
    });
    let available = 90;
    const written = vi.spyOn(process.stderr, 'write');
    const logged = (): string[] =>
      written.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith('MONSTERA_SHELL_FAILURE memory-low'));
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('busy.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
      memoryPressure: { intervalMs: 20, belowFraction: 0.1, read: () => ({ available: available * MIB, total: 100 * MIB }) },
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const { docId } = opened.value;
    const edit = (version: DocVersion) =>
      handlers['document.execute']({
        docId,
        command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version },
      });
    const first = await edit(opened.value.version);
    if (!first.ok) throw new Error(JSON.stringify(first));
    holding = true;
    void edit(first.value.version);
    await vi.waitFor(() => {
      expect(held).toBe(1);
    });

    available = 5;
    await vi.waitFor(() => {
      expect(logged()).toStrictEqual([
        'MONSTERA_SHELL_FAILURE memory-low: available memory fell below 10% (5 of 100 MiB available): PDFium host kept, compose host kept\n',
      ]);
    });
    expect(spy(second.harness.calls, 'host.terminate')).toBe(0);
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(0);
    written.mockRestore();
  });

  it('CONTROL: with the shell’s idle time, the same edit leaves the PDFium host running', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const second = platformAnswering(pdfiumPeer([]).peer);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('kept.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const edited = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: opened.value.version },
    });
    expect(edited.ok, JSON.stringify(edited)).toBe(true);
    // THE SAME WAIT the case above stopped its host within.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(spy(second.harness.calls, 'host.createSuspended')).toBe(1);
    expect(spy(second.harness.calls, 'host.terminate')).toBe(0);
  });

  it('CONTROL: closing one of two documents stops no host; closing the second stops them', async () => {
    // A HANDLE PER OPEN, as a real host issues them (the one-host case's reason), around the serialising engine.
    const serialising = serialisingEngine();
    let issued = 0;
    const mupdf = platformAnswering((channel, params) => {
      const answer = serialising(channel, params);
      if (channel !== 'engine/open') return answer;
      issued += 1;
      return { ok: true, value: { session: `cd0${String(issued)}`, access: 1 } };
    });
    const second = platformAnswering(pdfiumPeer([]).peer);
    const names = ['kept-a.pdf', 'kept-b.pdf'];
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument(names.shift() ?? 'more.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
    });
    // THE EDIT BEFORE THE SECOND OPEN, so the serialising engine's one output directory is the first document's.
    const first = await handlers['document.open']({});
    if (!first.ok || first.value.kind !== 'opened') throw new Error('the first did not open');
    const edited = await handlers['document.execute']({
      docId: first.value.docId,
      command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: first.value.version },
    });
    expect(edited.ok, JSON.stringify(edited)).toBe(true);
    const other = await handlers['document.open']({});
    if (!other.ok || other.value.kind !== 'opened') throw new Error('the second did not open');
    expect(spy(second.harness.calls, 'host.createSuspended')).toBe(1);

    await handlers['document.close']({ docId: first.value.docId });
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(0);
    expect(spy(second.harness.calls, 'host.terminate')).toBe(0);

    await handlers['document.close']({ docId: other.value.docId });
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(1);
    expect(spy(second.harness.calls, 'host.terminate')).toBe(1);
  });

  it('an UNLOCKED document’s PDFium command carries its password on every frame, and the rebuild opens with it (ADR-0171)', async () => {
    const PASSWORD = 'sample-only-0171';
    // THE MUPDF HOST OPENS THIS DOCUMENT ONLY WITH ITS PASSWORD, as for a file protected by one; every other answer
    // is the routing case's.
    const opens: unknown[] = [];
    const inner = serialisingEngine();
    const mupdf = platformAnswering((channel, params) => {
      if (channel === 'engine/open') {
        // THE CURRENT KEY FIRST (ADR-0171 Decision 8), so the first of the keys is the one the document opens with now.
        const { keys } = params as { keys: readonly unknown[] };
        opens.push(keys[0]);
        if (!keys.includes(PASSWORD)) return { ok: false, error: { code: 'needs-password' } };
      }
      return inner(channel, params);
    });
    const pdfium = pdfiumPeer();
    const second = platformAnswering(pdfium.peer);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('locked-edit.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const unlocked = await handlers['document.unlock']({ docId: opened.value.docId, password: PASSWORD });
    expect(unlocked.ok && unlocked.value.kind).toBe('unlocked');

    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: opened.value.version },
    });
    expect(executed.ok, JSON.stringify(executed)).toBe(true);

    // EVERY PDFIUM FRAME CARRIED THE KEY (a capture and an apply at least), and the session the edit's bytes were
    // adopted into was opened with it too: the open after the unlock's, which the command's install made.
    expect(pdfium.passwords.length).toBeGreaterThanOrEqual(2);
    expect(pdfium.passwords.every((sent) => sent === PASSWORD)).toBe(true);
    expect(opens.slice(2)).toStrictEqual(opens.slice(2).map(() => PASSWORD));
    expect(opens.length).toBeGreaterThan(2);
    // AND NO FILE ON THE DISK HELD IT (ADR-0171's correction, RRRRRRR-1): PDFium's commands take their params from a
    // file, and the key rode in the frame beside each one. CONTROL: those files exist and are the commands' params, so
    // an empty or unrelated list cannot pass for one that held no key.
    const onDisk = second.harness.filesOnDisk;
    expect(onDisk.filter((text) => text.includes('"replaceTextObject"')).length).toBeGreaterThanOrEqual(2);
    expect(onDisk.filter((text) => text.includes(PASSWORD))).toStrictEqual([]);
  });

  /**
   * AN UNDO'S "FONT CANNOT CARRY IT" REACHES THE RENDERER BY NAME (finding RRRRRRR-6). The stretch neither half
   * crosses: `contractHandlers.test.ts` stubs `DocumentCommands` to throw the error, and the kernel proof throws it
   * in process. Between them sat the host's invert, which answered it as `engine-refused`, and the person read
   * *Something went wrong*. The peer names one character the prior holds and one it never sent, and only the first
   * may reach the person: a host is hostile, and what an undo writes is the prior.
   */
  it('an undo the PDFium host refuses for a font that cannot carry it reaches the renderer BY NAME', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const base = pdfiumPeer();
    const pdfium: FakePeer = (channel, params) =>
      channel === 'engine/invert'
        ? { ok: false, error: { code: 'text-not-writable', detail: { characters: 'AZ' } } }
        : base.peer(channel, params);
    const second = platformAnswering(pdfium);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('undo-refused.pdf')),
      enginePlatform: mupdf.platform,
      pdfiumPlatform: second.platform,
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'replaceTextObject', page: 0, ...replacementFieldsOf([{ index: 2, text: 'hi' }]), version: opened.value.version },
    });
    expect(executed.ok, JSON.stringify(executed)).toBe(true);

    const undone = await handlers['document.undo']({ docId: opened.value.docId });
    // THE PRIOR IS `WAS` (the peer's capture), so `A` is a character the undo wrote back and `Z` is not.
    expect(undone).toStrictEqual({ ok: false, error: { code: 'text-not-writable', detail: { characters: 'A' } } });
    expect(second.harness.calls).toContain('peer.request:engine/invert');
  });

  it('routes editTextBlock to the PDFium host, and its "font cannot carry it" refusal reaches the renderer BY NAME', async () => {
    // THE STRETCH NEITHER HALF OF THE PAIR CROSSES (ADR-0096): the kernel proof
    // throws `TextNotWritableError` in-process, and the UI case stubs the whole
    // kernel. Between them sit the host's code, main's `answered`, and the
    // execute handler's mapping — and a break anywhere there turns a sentence a
    // person can act on into `internal` with an incident id.
    const run = async (applyAnswer: 'bytes' | 'text-not-writable' | 'edit-refused') => {
      const mupdf = platformAnswering(serialisingEngine());
      const base = pdfiumPeer();
      const pdfium: FakePeer = (channel, params) => {
        if (channel === 'engine/capture') {
          // TERMINAL, as the declaration says, so the bus checkpoints and applies.
          return { ok: true, value: { captured: false, reason: 'a block edit has no prior' } };
        }
        if (channel === 'engine/apply' && applyAnswer === 'text-not-writable') {
          // ONE CHARACTER TYPED AND ONE NOT: the host is hostile by invariant 25's premise, so `main` forwards only
          // characters the command carries (ADR-0169 Decision 4), and the case asserts which one survived.
          return { ok: false, error: { code: 'text-not-writable', detail: { characters: 'w中' } } };
        }
        if (channel === 'engine/apply' && applyAnswer === 'edit-refused') {
          // THE STEP AND PDFIUM'S NUMBER (ADR-0169 Decision 3), which `main` forwards as they came.
          return { ok: false, error: { code: 'edit-refused', detail: { step: 'generate', engineError: 6 } } };
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
          ...blockEditOf([{ lines: [[2, 4], [7]], soft: [false, false], text: 'new words' }]),
          fit: 'reflow',
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
    // BY NAME: not `internal`, which is what an unmapped engine refusal becomes — and naming `w`, which `new words`
    // holds, and not `中`, which the host named and nobody typed.
    expect(refused.executed).toStrictEqual({
      ok: false,
      error: { code: 'text-not-writable', detail: { characters: 'w' } },
    });

    // A STEP THE HOST NAMED reaches the renderer as the same step and number, never as `internal`.
    expect((await run('edit-refused')).executed).toStrictEqual({
      ok: false,
      error: { code: 'edit-refused', detail: { step: 'generate', engineError: 6 } },
    });
  });

  it('a replacement the host found nothing to change in reaches the renderer BY NAME, and the version does not move', async () => {
    // ADR-0169 Decision 6, across the stretch neither half crosses: the host's code, main's `answered` and the execute
    // handler's mapping. The FIRST apply answers nothing-to-replace and every later one bytes, so an edit sent next at
    // the version the document opened at is refused as stale if the refusal moved the version, and written if it did not.
    const mupdf = platformAnswering(serialisingEngine());
    const base = pdfiumPeer();
    let applies = 0;
    const pdfium: FakePeer = (channel, params) => {
      if (channel === 'engine/capture') return { ok: true, value: { captured: false, reason: 'document-scaled' } };
      if (channel === 'engine/apply') {
        applies += 1;
        if (applies === 1) return { ok: false, error: { code: 'nothing-to-replace' } };
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

    const replaced = await handlers['document.execute']({
      docId: opened.value.docId,
      command: { kind: 'replaceAllText', find: 'absent', replace: 'present' },
    });
    // BY NAME: an unmapped host code becomes `internal` with an incident id, *Something went wrong* for a find that
    // simply matched nothing.
    expect(replaced).toStrictEqual({ ok: false, error: { code: 'nothing-to-replace' } });

    const next = await handlers['document.execute']({
      docId: opened.value.docId,
      command: {
        kind: 'editTextBlock',
        page: 0,
        ...blockEditOf([{ lines: [[2, 4], [7]], soft: [false, false], text: 'new words' }]),
        fit: 'reflow',
        version: opened.value.version,
      },
    });
    expect(next.ok, JSON.stringify(next)).toBe(true);
    expect(applies).toBe(2);
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
        ...replacementFieldsOf([{ index: 2, text: 'hi' }]),
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

/**
 * PDFium's pre-read for the read on open, numbered so a translation that did not happen shows: no run's index is its
 * first object's place among the text objects (10 is the 0th, 12 the 1st, 20 the 3rd, 30 the 5th), so a run sent with
 * its index where the content's numbering belongs is a different number on the wire.
 */
const PAGE_RUNS = {
  textObjects: [10, 12, 15, 20, 21, 30],
  runs: [
    { index: 10, members: [10], text: 'zero', left: 0, right: 10, bottom: 0, top: 10 },
    { index: 12, members: [12, 15], text: 'alpha', left: 0, right: 10, bottom: 20, top: 30 },
    { index: 20, members: [20, 21], text: 'beta', left: 0, right: 10, bottom: 40, top: 50 },
    { index: 30, members: [30], text: 'gamma', left: 0, right: 10, bottom: 60, top: 70 },
  ],
};

/** A font that carries its own new words, and one whose new words the chain sets in another face. Distinct, so a swap shows. */
const OWN_FONT = { own: true, chosen: null, candidates: [] };
const SUBSTITUTED_FONT = {
  own: false,
  chosen: { family: 'Noto Serif', weight: 700, italic: false, styles: ['regular', 'bold'] },
  candidates: [{ family: 'Noto Serif', weight: 700, italic: false, styles: ['regular', 'bold'] }],
};

/**
 * The MuPDF host's answer, for the runs in the order they crossed: the first run sent is in {@link OWN_FONT} and the
 * second in {@link SUBSTITUTED_FONT}. Positional, as the host's is, so only the root's reorder puts each on its index.
 */
const BLOCK_FACES = { fonts: [OWN_FONT, SUBSTITUTED_FONT], runs: [0, 1] };

/** The bytes the MuPDF peer writes for `engine/form-pages`: distinct from the document's, so PDFium's input says which it read. */
const FORM_PAGES_TEXT = '%PDF-1.7 the page’s form placements\n';

/** The placements {@link FORM_PAGES_TEXT} holds, in its page order: the one a case names is the SECOND, so its page is 1. */
const FORM_PLACEMENTS: readonly FormPath[] = [[{ name: 'Fm0', occurrence: 0 }], [{ name: 'Fm1', occurrence: 0 }]];

/**
 * A MuPDF peer for the read on open: {@link serialisingEngine}, plus `engine/form-pages` written into the granted output
 * directory as the host writes it, and `engine/block-faces` answered {@link BLOCK_FACES}. Both record what they were
 * asked, which is what the cases assert: the end state is the answer, and the hops are the calls.
 */
function blockFacesEngine(): {
  readonly peer: FakePeer;
  readonly faces: Record<string, unknown>[];
  readonly formPages: number[];
} {
  const inner = serialisingEngine();
  let output: string | null = null;
  const faces: Record<string, unknown>[] = [];
  const formPages: number[] = [];
  const peer: FakePeer = (channel, params) => {
    if (channel === 'engine/open') output = (params as { outputDirectory: string }).outputDirectory;
    if (channel === 'engine/block-faces') {
      faces.push(params as Record<string, unknown>);
      return { ok: true, value: BLOCK_FACES };
    }
    if (channel !== 'engine/form-pages') return inner(channel, params);
    if (output === null) throw new Error('engine/form-pages before engine/open');
    const { page, into } = params as { page: number; into: string };
    formPages.push(page);
    const bytes = new TextEncoder().encode(FORM_PAGES_TEXT);
    writeFileSync(join(output, into), bytes);
    return { ok: true, value: { bytes: bytes.length, paths: FORM_PLACEMENTS, omitted: 0 } };
  };
  return { peer, faces, formPages };
}

/**
 * A PDFium peer that answers `engine/page-runs` {@link PAGE_RUNS}, and records the page it was asked for and the bytes of
 * the image it was handed — read from inside the peer, the only moment the input exists ({@link pdfiumPeer}'s reason).
 */
function pageRunsPeer(): { readonly peer: FakePeer; readonly asked: { page: number; image: string }[] } {
  const inner = pdfiumPeer();
  let snapshot: string | null = null;
  const asked: { page: number; image: string }[] = [];
  const peer: FakePeer = (channel, params) => {
    if (channel === 'engine/open') snapshot = (params as { snapshotDirectory: string }).snapshotDirectory;
    if (channel !== 'engine/page-runs') return inner.peer(channel, params);
    if (snapshot === null) throw new Error('engine/page-runs before engine/open');
    const { page, from } = params as { page: number; from: string };
    asked.push({ page, image: readFileSync(join(snapshot, from), 'utf8') });
    return { ok: true, value: PAGE_RUNS };
  };
  return { peer, asked };
}

describe('the composition root, THE READ ON OPEN through both engine hosts (ADR-0271 section 5)', () => {
  // THE DELEGATE BETWEEN THE TWO HALVES, which no other case crosses (finding ZZZZZZZZ-8): `documentCommands.test.ts`
  // stubs the reader, the kernel's tests call `blockFaceRunsOf` and `facesInOrder` directly, and `remoteEngine.test.ts`
  // crosses only the host's channel. A dropped `form`, indices sent where the content's numbering belongs, or answers put
  // back on the wrong runs would pass all three — the wired-tools rule's second blind spot.
  const opening = async (name: string) => {
    const mupdf = blockFacesEngine();
    const pdfium = pageRunsPeer();
    const first = platformAnswering(mupdf.peer);
    const second = platformAnswering(pdfium.peer);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument(name)),
      enginePlatform: first.platform,
      pdfiumPlatform: second.platform,
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    return { handlers, opened: opened.value, mupdf, pdfium, first };
  };

  it('asks PDFium for the page, MuPDF for the runs in the content’s numbering, and puts each font back on its index', async () => {
    const { handlers, opened, mupdf, pdfium, first } = await opening('read-on-open.pdf');

    // OUT OF ORDER, and with an index the pre-read holds no run for IN THE MIDDLE: an answer laid on the indices by
    // position would put the second font on 99 and none on 12.
    const read = await handlers['document.blockFaces']({ docId: opened.docId, page: 3, indices: [30, 99, 12] });

    // HOP ONE: PDFium was asked for the page the renderer named, and handed the document's own image.
    expect(pdfium.asked).toStrictEqual([{ page: 3, image: '%PDF-1.7\n' }]);
    // AND NO FORM'S PAGES WERE BUILT, the page's own content being what was asked about.
    expect(mupdf.formPages).toStrictEqual([]);
    expect(first.harness.calls).not.toContain('peer.request:engine/form-pages');

    // HOP TWO: MuPDF was asked about the runs in the order asked, each named by its first object's place among the text
    // objects (30 is the 5th, 12 the 1st), the unplaced 99 left out, and no form.
    expect(mupdf.faces).toStrictEqual([
      {
        session: 'ab0f',
        page: 3,
        runs: [
          { index: 30, object: 5, text: 'gamma' },
          { index: 12, object: 1, text: 'alpha' },
        ],
      },
    ]);

    // HOP THREE: each font is back on the index that asked for it, and the index the host could not place answers none.
    expect(read).toStrictEqual(ok({ version: opened.version, fonts: [OWN_FONT, SUBSTITUTED_FONT], runs: [0, null, 1] }));
  });

  it('asks MuPDF NOTHING when no asked index names a run, and answers no font for each, rather than an internal error', async () => {
    const { handlers, opened, mupdf } = await opening('read-on-open-unplaced.pdf');
    // NEITHER INDEX IS A RUN THE PRE-READ HOLDS: `engine/block-faces` takes at least one run, and an empty list sent to the
    // real host is refused by its schema and reaches the renderer as an internal failure (found by this case's author).
    const read = await handlers['document.blockFaces']({ docId: opened.docId, page: 3, indices: [99, 98] });
    // THE DECISION: no call to the host, which this fake answers whatever it is sent.
    expect(mupdf.faces).toStrictEqual([]);
    expect(read).toStrictEqual(ok({ version: opened.version, fonts: [], runs: [null, null] }));
  });

  it('reads a FORM’s runs from its placement’s page of the built form pages, and names the form to MuPDF', async () => {
    const { handlers, opened, mupdf, pdfium } = await opening('read-on-open-form.pdf');
    const form = FORM_PLACEMENTS[1];
    if (form === undefined) throw new Error('unreachable');

    const read = await handlers['document.blockFaces']({ docId: opened.docId, page: 3, indices: [30, 99, 12], form });

    // HOP ONE, THE FORM'S ROUTE: MuPDF built the page's placements, and PDFium read the named placement's page (the
    // second, so 1 — never the document's page 3) out of THOSE bytes rather than the document's.
    expect(mupdf.formPages).toStrictEqual([3]);
    expect(pdfium.asked).toStrictEqual([{ page: 1, image: FORM_PAGES_TEXT }]);

    // HOP TWO: the document's page and the form both reached MuPDF, with the runs in the content's numbering.
    expect(mupdf.faces).toStrictEqual([
      {
        session: 'ab0f',
        page: 3,
        form,
        runs: [
          { index: 30, object: 5, text: 'gamma' },
          { index: 12, object: 1, text: 'alpha' },
        ],
      },
    ]);

    // HOP THREE, as for the page's own content.
    expect(read).toStrictEqual(ok({ version: opened.version, fonts: [OWN_FONT, SUBSTITUTED_FONT], runs: [0, null, 1] }));
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

/** What a signing host was asked and what it answered, so a case can hold both ends of a signature. */
interface SigningLog {
  /** Every `engine/prepareSignature` request, as it arrived. */
  readonly requests: unknown[];
  /** What the host answers with: `prepareSignature`'s output on the served document. */
  readonly prepared: PreparedSignature;
  /** The snapshot every `engine/open` was handed, in order. */
  readonly opened: Uint8Array[];
}

/**
 * A host that serialises a REAL document.
 *
 * `serialisingEngine` answers five bytes, which is enough for every writer that
 * only moves bytes. A signer parses what it is given, so a signing case needs a
 * document pdf-lib can open — and the bytes come from the host, exactly as the
 * product's byte-image path takes them.
 */
function documentServingEngine(document: Uint8Array, signing?: SigningLog): FakePeer {
  let output: string | null = null;
  return (channel, params) => {
    if (channel === 'engine/open') {
      const sent = params as { snapshotDirectory: string; snapshotName: string; outputDirectory: string };
      output = sent.outputDirectory;
      signing?.opened.push(new Uint8Array(readFileSync(join(sent.snapshotDirectory, sent.snapshotName))));
      return SESSION;
    }
    // THE REAL PLACEHOLDER WRITER's output, made from the document this host serves before the case ran — a peer
    // answers synchronously — and written where main takes it from, as the MuPDF host does (ADR-0148).
    if (channel === 'engine/prepareSignature' && signing !== undefined) {
      if (output === null) throw new Error('engine/prepareSignature before engine/open');
      const { into } = params as { into: string };
      signing.requests.push(params);
      writeFileSync(join(output, into), signing.prepared.bytes);
      return {
        ok: true,
        value: { bytes: signing.prepared.bytes.byteLength, byteRange: [...signing.prepared.byteRange] },
      };
    }
    if (channel !== 'engine/serialise') return ENGINE(channel, params);
    if (output === null) throw new Error('engine/serialise before engine/open');
    const { into } = params as { into: string };
    writeFileSync(join(output, into), document);
    return { ok: true, value: { bytes: document.byteLength } };
  };
}

describe('the composition root, a HOSTED pdf-lib command (ADR-0121 Decision 3)', () => {
  it('runs pdf-lib in the MuPDF host, rebuilds the session from its file, and takes the image from the session', async () => {
    // BOTH ENDS, for the wired pair's second blind spot: `commandBus.test.ts` runs a hosted apply against a local
    // session and `remoteLifecycle.test.ts` runs the real spec behind the real handler, and neither holds the root
    // that registers the writer, routes the command down `engine/applyPdfLib` and rebuilds through `adopt`.
    // The peer answers with a document `main` never had, so each assertion can only hold if that file travelled.
    const result = new TextEncoder().encode('%PDF-1.7\n% what pdf-lib wrote, in the host\n');
    const rebuilt: Uint8Array[] = [];
    let output: string | null = null;
    const spy = platformAnswering((channel, params) => {
      if (channel === 'engine/open') {
        const sent = params as { snapshotDirectory: string; snapshotName: string; outputDirectory: string };
        output = sent.outputDirectory;
        rebuilt.push(new Uint8Array(readFileSync(join(sent.snapshotDirectory, sent.snapshotName))));
        return SESSION;
      }
      if (channel === 'engine/applyPdfLib' || channel === 'engine/serialise') {
        if (output === null) throw new Error(`${channel} before engine/open`);
        // THE APPLY WRITES pdf-lib's RESULT; a SERIALISE writes what the session now holds — the last document it
        // was opened from, which is what a rebuilt session serialises to.
        const bytes = channel === 'engine/applyPdfLib' ? result : (rebuilt.at(-1) ?? new Uint8Array());
        writeFileSync(join(output, (params as { into: string }).into), bytes);
        return { ok: true, value: { bytes: bytes.length } };
      }
      return ENGINE(channel, params);
    });
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('hosted-background.pdf')),
      enginePlatform: spy.platform,
      checkpointDirectory: join(scratch, 'checkpoints-hosted'),
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const executed = await handlers['document.execute']({
      docId: opened.value.docId,
      // THE PAGE BACKGROUND, a pdf-lib command: the watermark this case ran is the MuPDF writer's since ADR-0235.
      command: { kind: 'setPageBackground', pages: 'all', red: 1, green: 1, blue: 0.9 },
    });

    expect(executed.ok, JSON.stringify(executed)).toBe(true);
    if (!executed.ok) throw new Error('the page background should have succeeded');
    // THE HOST RAN IT — main sent the command, not an image.
    expect(spy.harness.calls).toContain('peer.request:engine/applyPdfLib');
    // THE SESSION WAS REBUILT FROM THE HOST'S OWN FILE: a second open, of exactly what the apply wrote.
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt[1]).toStrictEqual(result);
    // AND MAIN'S IMAGE IS THE REBUILT SESSION'S BYTES, by length — the renderer's answer.
    expect(executed.value.byteLength).toBe(result.length);
  });

});

describe('the composition root, SAVING (ADR-0121 addendum)', () => {
  it('saves the host’s bytes into the file by a move, and leaves no copy where the host may read', async () => {
    // BOTH ENDS IN ONE CASE, for the wired pair's second blind spot: `savePipeline.test.ts` stages bytes through a
    // fake surface and `remoteLifecycle.test.ts` moves a real host file, and neither holds the root that joins them.
    // The host writes a document main never had — so the file can only hold it if the save took the host's file.
    const hostDocument = new TextEncoder().encode('%PDF-1.7\n% the host serialised this, main never read it\n');
    const spy = platformAnswering(documentServingEngine(hostDocument));
    const path = aDocument('saved-by-a-move.pdf');
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(path),
      enginePlatform: spy.platform,
      checkpointDirectory: join(scratch, 'checkpoints-saving'),
    });

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');
    const saved = await handlers['document.save']({ docId: opened.value.docId, breakSignatures: true });

    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(new Uint8Array(readFileSync(path))).toStrictEqual(hostDocument);
    // THE STAGED FILE IS GONE from the host's output directory — moved, or copied and then discarded, which end the
    // same (measured: a copy in place of the rename leaves this green, because the discard removes what is left).
    expect(readdirSync(lastOutputDirectory(spy.directories))).toStrictEqual([]);
  });
});

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

    // THE HOST'S ANSWER, by the real placeholder writer: an invisible signature with no timestamp, which is what this
    // case asks for, so the reserved hole matches the one main checks.
    const signing: SigningLog = {
      requests: [],
      prepared: await prepareSignature(document, { kind: 'signDocument' }),
      opened: [],
    };
    const mupdf = platformAnswering(documentServingEngine(document, signing));
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

    // AND THE SIGNED BYTES WERE INSTALLED: a hosted command's result becomes
    // the canonical image and rebuilds the live session, which is a further
    // `engine/open` on the host. A root that answered `signed` and dropped the
    // bytes would pass the lines above.
    expect(spy(mupdf.harness.calls, 'peer.request:engine/open')).toBeGreaterThan(opensBefore);

    // THE HOST WAS ASKED, ONCE, AND HANDED NO CREDENTIAL (ADR-0148): neither the certificate's bytes nor the
    // passphrase, by name or by value.
    expect(signing.requests).toHaveLength(1);
    const asked = JSON.stringify(signing.requests[0]);
    expect(asked).not.toMatch(/"bytes"|passphrase/u);

    // MAIN SIGNED WHAT THE HOST PREPARED, AND NOTHING ELSE: the session was rebuilt from the prepared file with only
    // its hole changed, and the hole now holds a signature. A root that installed the host's file unsigned, or signed
    // bytes of its own, fails one of the two.
    const rebuilt = signing.opened.at(-1);
    const [, holeStart, holeEnd] = signing.prepared.byteRange;
    expect(rebuilt?.byteLength).toBe(signing.prepared.bytes.byteLength);
    if (rebuilt === undefined) throw new Error('unreachable');
    expect(Buffer.from(rebuilt.subarray(0, holeStart)).equals(Buffer.from(signing.prepared.bytes.subarray(0, holeStart)))).toBe(true);
    expect(Buffer.from(rebuilt.subarray(holeEnd)).equals(Buffer.from(signing.prepared.bytes.subarray(holeEnd)))).toBe(true);
    expect(Buffer.from(rebuilt.subarray(holeStart + 1, holeStart + 9)).toString('latin1')).not.toBe('00000000');
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
  /** The family each call asked the prose to be set in (D1). */
  readonly families: string[];
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
 *
 * @param boxed the characters its text composers answer as drawn as the box, and how many more it counts; none by
 *   default, so a case about the route is not also a case about the boxes
 */
function composePeer(
  boxed: { readonly places: readonly BoxedCharacter[]; readonly more: number } = { places: [], more: 0 },
  /** The parts every composer answers it left out, and how many more it counts; none by default, `boxed`'s reason. */
  skipped: { readonly parts: readonly ComposeSkip[]; readonly more: number } = { parts: [], more: 0 },
): ComposePeerLog {
  let area: { snapshot: string; output: string } | null = null;
  const sources: string[] = [];
  const fromPaths: string[] = [];
  const channels: string[] = [];
  const families: string[] = [];

  return {
    sources,
    fromPaths,
    channels,
    families,
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
          const { from, into, family } = params as { from: string; into: string; family: string };
          families.push(family);
          const source = join(area.snapshot, from);
          fromPaths.push(source);
          sources.push(existsSync(source) ? readFileSync(source, 'utf8') : '(absent at the call)');
          writeFileSync(join(area.output, into), new Uint8Array(COMPOSED_BYTES));
          return {
            ok: true,
            value: {
              kind: 'composed',
              bytes: COMPOSED_BYTES.length,
              boxed: [...boxed.places],
              more: boxed.more,
              skipped: [...skipped.parts],
              skippedMore: skipped.more,
            },
          };
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
          return {
            ok: true,
            value: { kind: 'composed', bytes: COMPOSED_BYTES.length, boxed: [], more: 0, skipped: [...skipped.parts], skippedMore: skipped.more },
          };
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

    // A FAMILY THAT IS NOT THE DEFAULT, so a handler that set every new document in Arimo fails here (the owner's L4).
    const answer = await handlers['document.newFromMarkdown']({ family: 'Tinos', work: WORK });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(answer.value.kind, JSON.stringify(answer.value)).toBe('opened');
    if (answer.value.kind !== 'opened') throw new Error('unreachable');

    // THE HOST READ THE PERSON'S TEXT, and it was on disk when it was asked, and set it in the family they chose.
    expect(compose.sources).toStrictEqual(['# Title\n']);
    expect(compose.families).toStrictEqual(['Tinos']);
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

  // THE OWNER'S PART 7 A, for the host that serves calls no document makes: it stops with the last document only where
  // it is idle by its own account. THE CONTROL is a file left in its area, which a workbook's parts are between calls.
  for (const held of [false, true]) {
    it(`the compose host ${held ? 'is KEPT while its area holds a file' : 'stops with the last document when its area is empty'}`, async () => {
      const mupdf = platformAnswering(serialisingEngine());
      const compose = composePeer();
      const third = platformAnswering(compose.peer);
      // ITS AREA LISTED FROM DISK, as the Win32 surface lists it; the harness's own listing answers *could not look*.
      const listing: EngineHostPlatform = {
        ...third.platform,
        directories: { ...third.platform.directories, listFiles: (path) => readdirSync(path) },
      };
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        pickMarkdown: () => Promise.resolve(join(scratch, `draft-${String(held)}.md`)),
        readMarkdown: () => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('# Title\n') }),
        pickDestination: () => Promise.resolve(join(scratch, `composed-${String(held)}.pdf`)),
        enginePlatform: mupdf.platform,
        composePlatform: listing,
      });
      const answer = await handlers['document.newFromMarkdown']({ family: 'Tinos', work: WORK });
      if (!answer.ok || answer.value.kind !== 'opened') throw new Error(`the composed document did not open: ${JSON.stringify(answer)}`);
      expect(spy(third.harness.calls, 'host.createSuspended')).toBe(1);

      const area = third.directories.find((entry) => entry.startsWith('create:'))?.slice('create:'.length);
      if (area === undefined) throw new Error('the compose host was granted no area');
      if (held) writeFileSync(join(area, 'a-part-between-calls'), 'held');

      await handlers['document.close']({ docId: answer.value.docId });
      // THE DOCUMENT ENGINE STOPS EITHER WAY: the area that keeps one host is not a reason to keep the other.
      expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(1);
      expect(spy(third.harness.calls, 'host.terminate')).toBe(held ? 0 : 1);
    }, 120_000);
  }

  it('the compose host is KEPT while a call no document made is still running in it', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const compose = composePeer();
    // THE FONT LIST LEFT UNANSWERED, so the call is still running when the last document closes.
    const third = platformAnswering((channel, params) => (channel === 'engine/font-families' ? null : compose.peer(channel, params)));
    const listing: EngineHostPlatform = {
      ...third.platform,
      directories: { ...third.platform.directories, listFiles: (path) => readdirSync(path) },
    };
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickMarkdown: () => Promise.resolve(join(scratch, 'draft-running.md')),
      readMarkdown: () => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('# Title\n') }),
      pickDestination: () => Promise.resolve(join(scratch, 'composed-running.pdf')),
      enginePlatform: mupdf.platform,
      composePlatform: listing,
    });
    const answer = await handlers['document.newFromMarkdown']({ family: 'Tinos', work: WORK });
    if (!answer.ok || answer.value.kind !== 'opened') throw new Error(`the composed document did not open: ${JSON.stringify(answer)}`);

    void handlers['app.fontFamilies']({});
    await vi.waitFor(() => {
      expect(third.harness.calls).toContain('peer.request:engine/font-families');
    });
    await handlers['document.close']({ docId: answer.value.docId });
    expect(spy(mupdf.harness.calls, 'host.terminate')).toBe(1);
    expect(spy(third.harness.calls, 'host.terminate')).toBe(0);
  }, 120_000);

  /**
   * ADR-0237 (the owner's 13a): the font picker's list, kept on disk under the font folders' fingerprint, is answered with
   * NO compose host started, where it was the reason an edit started one (206 MB). CONTROL: a changed fingerprint starts
   * the host once and keeps its answer, and so does a first run with nothing kept.
   */
  it('the font list kept under the same fingerprint starts no compose host; a changed one asks the host once', async () => {
    const file = createEphemeralSettings();
    const listOnce = (fingerprint: string) => {
      const compose = composePeer();
      const third = platformAnswering((channel, params) =>
        channel === 'engine/font-families'
          ? { ok: true, value: { families: [{ name: 'Tinos', origin: 'bundled', embedding: 'subset', bold: true, italic: true }], more: 0, next: null } }
          : compose.peer(channel, params),
      );
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        enginePlatform: platformAnswering(serialisingEngine()).platform,
        composePlatform: third.platform,
        fontList: { file, fingerprint: () => Promise.resolve(fingerprint) },
      });
      return { handlers, calls: third.harness.calls };
    };
    const SAME = 'a'.repeat(64);

    const first = listOnce(SAME);
    const listed = await first.handlers['app.fontFamilies']({});
    expect(listed).toStrictEqual({ ok: true, value: { listed: true, families: [{ name: 'Tinos', origin: 'bundled', embedding: 'subset', bold: true, italic: true }], more: 0 } });
    expect(spy(first.calls, 'host.createSuspended')).toBe(1);

    // A LATER SESSION, the same fonts: the kept list, and no host.
    const later = listOnce(SAME);
    expect(await later.handlers['app.fontFamilies']({})).toStrictEqual(listed);
    expect(spy(later.calls, 'host.createSuspended')).toBe(0);

    // CONTROL: a font installed since — a changed fingerprint — is read from the host again.
    const changed = listOnce('b'.repeat(64));
    expect(await changed.handlers['app.fontFamilies']({})).toStrictEqual(listed);
    expect(spy(changed.calls, 'host.createSuspended')).toBe(1);
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
    const mupdf = platformAnswering(mergingEngine());
    // WITH A BOX, so this case also carries the append's own list through the root (ADR-0172).
    const boxedPlaces = [{ character: '中', line: 1, column: 1 }];
    const compose = composePeer({ places: boxedPlaces, more: 0 });
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

    // NOT THE DEFAULT, so a hop that dropped the family and composed in Arimo fails below.
    const appended = await handlers['document.appendMarkdown']({ docId: opened.value.docId, at: 1, family: 'Tinos', work: WORK });
    expect(appended.ok, JSON.stringify(appended)).toBe(true);
    if (!appended.ok) throw new Error('unreachable');
    expect(appended.value.kind, JSON.stringify(appended.value)).toBe('appended');
    if (appended.value.kind !== 'appended') throw new Error('unreachable');

    // THE TARGET MOVED, and the composed document is a different document, open.
    expect(appended.value.version).toBeGreaterThan(opened.value.version);
    expect(appended.value.opened.docId).not.toBe(opened.value.docId);
    expect(appended.value.opened.name).toBe('appended-from-markdown.pdf');
    expect(appended.value.boxed).toStrictEqual(boxedPlaces);
    expect(appended.value.more).toBe(0);
    // THE CHOSEN FAMILY CROSSED THE ROOT to the compose host's request, the pair's middle (D1).
    expect(compose.families).toStrictEqual(['Tinos']);

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

  it('carries the host’s BOXED CHARACTERS through the whole root to the open (ADR-0172)', async () => {
    // THE PAIR'S MIDDLE (CLAUDE.md, the wired-tools rule): the composer reports boxes against a local writer, the
    // renderer shows them against a stubbed kernel, and every hop between — the client, the command, the handler —
    // is crossed only here. A hop that dropped the list would answer `opened` and pass both halves.
    // The append's own list is asserted in the append case below, which has the engine a merge needs.
    const places = [{ character: '中', line: 3, column: 8 }];
    const mupdf = platformAnswering(serialisingEngine());
    const third = platformAnswering(composePeer({ places, more: 4 }).peer);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickMarkdown: () => Promise.resolve(join(scratch, 'boxed.md')),
      readMarkdown: () => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('中\n') }),
      pickDestination: () => Promise.resolve(join(scratch, 'boxed.pdf')),
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });
    expect(await handlers['document.newFromMarkdown']({ family: 'Arimo', work: WORK })).toMatchObject({
      ok: true,
      value: { kind: 'opened-with-boxes', name: 'boxed.pdf', boxed: places, more: 4 },
    });
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

    const answer = await handlers['document.newFromCsv']({ family: 'Cousine', work: WORK });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(answer.value.kind, JSON.stringify(answer.value)).toBe('opened');

    expect(compose.channels).toStrictEqual(['engine/compose-csv']);
    expect(compose.sources).toStrictEqual(['a,b\n']);
    // THE TABLE IN THE FAMILY CHOSEN, not the default (the owner's L4).
    expect(compose.families).toStrictEqual(['Cousine']);
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
      readPageImage: (path) =>
        Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode(path) }),
      pickDestination: (name) => {
        suggested.push(name);
        return Promise.resolve(destination);
      },
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });

    const answer = await handlers['document.newFromImages']({ work: WORK });
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

  it('a compose host that FAILS is never told to the person as their picture: unreadable is the file’s answer alone (EEEEEEEE-2)', async () => {
    // THE ROUTE SINCE O3 is a composition and then a merge, and 75a1603e's deleted case held this for the old one: a
    // failure that is the engine's must not read as *this picture could not be read*. Here the host answers a failure
    // for the composition itself, with every file read whole.
    const failing = (log: ComposePeerLog): FakePeer => (channel, params) =>
      channel === 'engine/compose-images' ? { ok: false, error: { code: 'internal', incident: 'host-incident-1' } } : log.peer(channel, params);
    const run = async (readImage: (path: string) => Promise<ImageRead>) => {
      const mupdf = platformAnswering(serialisingEngine());
      const third = platformAnswering(failing(composePeer()));
      const { handlers } = createShellDependencies({
        ...harnessSurfaces('the composition-host test'),
        appInfo,
        pickImages: () => Promise.resolve([join(scratch, 'one.png')]),
        sizeImage: () => Promise.resolve(16),
        readPageImage: readImage,
        pickDestination: () => Promise.resolve(join(scratch, 'never.pdf')),
        enginePlatform: mupdf.platform,
        composePlatform: third.platform,
      });
      return handlers['document.newFromImages']({ work: WORK });
    };

    // A THROW, which the boundary turns into `internal` with an incident (Monstera's failure in the window), never an
    // answer: no `unreadable`, no refusal naming the file.
    const failed = run((path) => Promise.resolve({ kind: 'read', bytes: new TextEncoder().encode(path) }));
    await expect(failed).rejects.toThrow('the compose host could not compose the images: internal');
    expect(existsSync(join(scratch, 'never.pdf'))).toBe(false);

    // CONTROL: a picture that could not be read when its turn came IS the person's file, and is answered as unreadable,
    // so the answer above is the host's failure and not a route that can never say unreadable.
    const changed = await run(() => Promise.resolve({ kind: 'unreadable' }));
    expect(changed.ok, JSON.stringify(changed)).toBe(true);
    if (!changed.ok) throw new Error('unreachable');
    expect(changed.value).toStrictEqual({ kind: 'unreadable' });
  }, 120_000);

  it('carries an image the host LEFT OUT through the whole root, named by its FILE, never its place or its path', async () => {
    // THE HOP NEITHER HALF CROSSES: the composer's case asserts the place it leaves out, the command's case the dialog it
    // opens, and between them this root turns the host's place into the name the person knows (Codex's importer audit).
    const mupdf = platformAnswering(serialisingEngine());
    // PLACE 2 IN NAME ORDER is `page 10.png`, which the picker answered FIRST: a root that named by the picker's order
    // would name `page 2.jpg`.
    const third = platformAnswering(composePeer(undefined, { parts: [{ reason: 'image-unreadable', line: null, item: 2 }], more: 0 }).peer);
    const tenth = join(scratch, 'page 10.png');
    const second = join(scratch, 'page 2.jpg');
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickImages: () => Promise.resolve([tenth, second]),
      sizeImage: () => Promise.resolve(16),
      readPageImage: (path) => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode(path) }),
      pickDestination: () => Promise.resolve(join(scratch, 'skipped.pdf')),
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });
    expect(await handlers['document.newFromImages']({ work: WORK })).toMatchObject({
      ok: true,
      value: { kind: 'opened-with-skips', skipped: [{ reason: 'image-unreadable', line: null, file: 'page 10.png' }], skippedMore: 0 },
    });
  }, 120_000);

  it('INSERTS PICKED IMAGES (O3): composes them in name order, opens the result as a tab, and merges every page of it at the place asked, in ONE apply', async () => {
    // THE PAIR'S MIDDLE: the UI case asserts the dialog's `at` reaches the channel against a stubbed kernel, the merge's
    // kernel proof asserts the graft against a local writer, and only this root carries `at` from one to the other.
    const applies: unknown[] = [];
    const merging = mergingEngine();
    const mupdf = platformAnswering((channel, params) => {
      if (channel === 'engine/apply') applies.push(params);
      return merging(channel, params);
    });
    const compose = composePeer(undefined, { parts: [{ reason: 'image-unreadable', line: null, item: 2 }], more: 0 });
    const third = platformAnswering(compose.peer);
    const tenth = join(scratch, 'page 10.png');
    const second = join(scratch, 'page 2.jpg');
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDocument: () => Promise.resolve(aDocument('insert-images-target.pdf')),
      pickImages: () => Promise.resolve([tenth, second]),
      sizeImage: () => Promise.resolve(16),
      readPageImage: (path) => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode(path) }),
      pickDestination: () => Promise.resolve(join(scratch, 'inserted-images.pdf')),
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });
    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    const inserted = await handlers['document.insertImage']({ docId: opened.value.docId, at: 3, work: WORK });
    expect(inserted.ok, JSON.stringify(inserted)).toBe(true);
    if (!inserted.ok || inserted.value.kind !== 'inserted') throw new Error(JSON.stringify(inserted));
    expect(inserted.value.version).toBeGreaterThan(opened.value.version);
    expect(inserted.value.opened.name).toBe('inserted-images.pdf');
    expect(inserted.value.opened.docId).not.toBe(opened.value.docId);
    // THE PICTURE LEFT OUT, by its file, `newFromImages`' naming through the same composition.
    expect(inserted.value.skipped).toStrictEqual([{ reason: 'image-unreadable', line: null, file: 'page 10.png' }]);
    expect(compose.sources).toStrictEqual([`image/jpeg:${second}`, `image/png:${tenth}`]);
    // ONE MERGE, at 3, of every page of the composed tab — one undo step for every picture.
    const merges = applies.filter((params) => JSON.stringify(params).includes('"mergeDocument"'));
    expect(merges).toHaveLength(1);
    expect(JSON.stringify(merges[0])).toContain('"at":3');
    expect(JSON.stringify(merges[0])).toContain('"sourcePages":"all"');
  }, 120_000);

  it('CONTROL: an image insert into a document that is not open is refused BEFORE the picker opens', async () => {
    let picked = 0;
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickImages: () => {
        picked += 1;
        return Promise.resolve([join(scratch, 'never.png')]);
      },
      enginePlatform: platformAnswering(mergingEngine()).platform,
      composePlatform: platformAnswering(composePeer().peer).platform,
    });
    expect(await handlers['document.insertImage']({ docId: asDocId('not-open'), at: 0, work: WORK })).toStrictEqual(
      err({ code: 'document-not-open' }),
    );
    expect(picked).toBe(0);
  }, 120_000);

  it('carries a CSV record the host LEFT OUT through the whole root, by its line', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const third = platformAnswering(composePeer(undefined, { parts: [{ reason: 'quote-never-closed', line: 4, item: null }], more: 2 }).peer);
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickCsv: () => Promise.resolve(join(scratch, 'rows.csv')),
      readCsv: () => Promise.resolve({ kind: 'read' as const, bytes: new TextEncoder().encode('a,b\n') }),
      pickDestination: () => Promise.resolve(join(scratch, 'rows.pdf')),
      enginePlatform: mupdf.platform,
      composePlatform: third.platform,
    });
    expect(await handlers['document.newFromCsv']({ family: 'Arimo', work: WORK })).toMatchObject({
      ok: true,
      value: { kind: 'opened-with-skips', skipped: [{ reason: 'quote-never-closed', line: 4, file: null }], skippedMore: 2 },
    });
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

    const answer = await handlers['document.newFromMarkdown']({ family: 'Arimo', work: WORK });
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error('unreachable');
    expect(answer.error.code).toBe('engine-unavailable');
    expect(picks).toBe(0);
  });
});

/** The bytes the fake x2t writes as its PDF. */
const X2T_BYTES = '%PDF-1.7 from the fake x2t';

/**
 * A converter platform whose "x2t" does what x2t does with its one argument: reads the instructions
 * file, and writes where it says. Directories are really made; containment reads as contained.
 */
function officeConverter(): { readonly platform: ConverterPlatform; readonly read: string[] } {
  const read: string[] = [];
  const root = mkdtempSync(join(scratch, 'office-'));
  let limit = 0;
  return {
    read,
    platform: {
      sessionRoot: root,
      directories: {
        create: (path) => {
          mkdirSync(path, { recursive: true });
          return 'created';
        },
        remove: () => true,
        removeTree: (path) => {
          rmSync(path, { recursive: true, force: true });
          return true;
        },
        list: () => null,
        listFiles: () => null,
        removeFile: () => true,
        lastError: () => 0,
      },
      user: FAKE_USER,
      container: FAKE_CONTAINER,
      containerName: 'monstera-office-converter',
      executable: 'C:\\tools\\x2t.exe' as ConverterExecutablePath,
      bounds: { processMemoryLimitBytes: 64 * 1024 * 1024, timeoutMs: 5_000 },
      component: 'onlyoffice',
      cannotStart: () => undefined,
      startProbe: [],
      surfaceFor: (config) => ({
        createSuspended: () => ok({ pid: 11, process: FAKE_CREATED.process, thread: FAKE_CREATED.thread }),
        createJob: () => FAKE_JOB,
        applyLimits: (_job, bytes) => {
          limit = bytes;
          return true;
        },
        assignToJob: () => true,
        readJobMembership: () => 'in-job',
        readIntegrity: () => ({ kind: 'read', rid: INTEGRITY_LOW }),
        readJobLimits: () => ({
          kind: 'read',
          limitFlags: JOB_LIMIT_ACTIVE_PROCESS | JOB_LIMIT_PROCESS_MEMORY | JOB_LIMIT_KILL_ON_JOB_CLOSE,
          activeProcessLimit: 1,
          processMemoryLimitBytes: limit,
          uiRestrictions: JOB_UI_RESTRICTIONS_ALL,
        }),
        resume: () => 1,
        terminate: () => undefined,
        close: () => undefined,
        processorTime: () => null,
        diagnostics: () => null,
        discardDiagnostics: () => undefined,
        waitForExit: () => {
          const instructions = readFileSync(config.program.commandArguments[0] ?? '', 'utf8');
          const from = /<m_sFileFrom>([^<]*)<\/m_sFileFrom>/u.exec(instructions)?.[1] ?? '';
          const to = /<m_sFileTo>([^<]*)<\/m_sFileTo>/u.exec(instructions)?.[1] ?? '';
          read.push(`${from.slice(-7)}:${existsSync(from) ? readFileSync(from, 'utf8') : '(absent at the call)'}`);
          writeFileSync(to, X2T_BYTES);
          return Promise.resolve({ kind: 'exited', code: 0 });
        },
      }),
    },
  };
}

describe('the composition root, with the OFFICE converter (ADR-0120)', () => {
  it('converts the picked file, writes the PDF where the person chose, and opens that file', async () => {
    // WHAT SITS BETWEEN THE PAIR'S TWO ENDS: the part `entry.ts` hands in, the composition's
    // `createOfficeSource`, the command, and the channel's open. Neither the command's cases nor
    // the renderer's reach all four.
    const mupdf = platformAnswering(serialisingEngine());
    const office = officeConverter();
    const destination = join(scratch, 'from-office.pdf');
    const suggested: string[] = [];

    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      pickDestination: (name) => {
        suggested.push(name);
        return Promise.resolve(destination);
      },
      enginePlatform: mupdf.platform,
      officeImport: {
        platform: office.platform,
        source: {
          pick: () => Promise.resolve(join(scratch, 'Budget.xlsx')),
          read: () => Promise.resolve({ kind: 'read', bytes: new TextEncoder().encode('PK the workbook') }),
        },
      },
    });

    const answer = await handlers['document.newFromOffice']({ work: WORK });
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (!answer.ok) throw new Error('unreachable');
    expect(answer.value.kind, JSON.stringify(answer.value)).toBe('opened');
    if (answer.value.kind !== 'opened') throw new Error('unreachable');

    // x2t WAS TOLD THE PICKED FILE'S BYTES, under the fixed name its format gives.
    expect(office.read).toStrictEqual(['in.xlsx:PK the workbook']);
    expect(readFileSync(destination, 'utf8')).toBe(X2T_BYTES);
    expect(answer.value.name).toBe('from-office.pdf');
    expect(suggested).toStrictEqual(['Budget.pdf']);
  }, 120_000);

  it('CONTROL: with no Office converter the import is refused as unavailable', async () => {
    const mupdf = platformAnswering(serialisingEngine());
    const { handlers } = createShellDependencies({
      ...harnessSurfaces('the composition-host test'),
      appInfo,
      enginePlatform: mupdf.platform,
    });

    const answer = await handlers['document.newFromOffice']({ work: WORK });
    expect(answer.ok).toBe(false);
    if (answer.ok) throw new Error('unreachable');
    expect(answer.error.code).toBe('engine-unavailable');
  });
});
