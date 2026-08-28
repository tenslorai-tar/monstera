import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('the composition root, with an engine host platform', () => {
  it('creates a host, verifies its containment, and opens a session for the document', async () => {
    const spy = platformAnswering((channel) =>
      channel === 'engine/probe-containment'
        ? CONTAINED
        : channel === 'engine/open'
          ? SESSION
          : null,
    );
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(aDocument('sessioned.pdf')),
      spy.platform,
    );

    const opened = await handlers['document.open']({});
    if (!opened.ok || opened.value.kind !== 'opened') throw new Error('the document did not open');

    // THE ASSERTION IS *WHICH* FAILURE, and it is the one only a sessioned
    // document can reach. Queued behind the session entry — both run in this
    // document's lane — the command resolves the session, finds one, and dies
    // at the BUS, which has no mupdf adapter registered (KKKK-4 is why).
    //
    // `UnregisteredWriterError` THROWS rather than answering with a code, so a
    // rejection here is the evidence: `document-poisoned` is a declared
    // outcome and is what the no-platform file gets, and a document with no
    // session never reaches the bus at all.
    await expect(
      handlers['document.execute']({
        docId: opened.value.docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      }),
    ).rejects.toThrow(/no adapter registered/u);

    // And the host really was built and really was asked.
    expect(spy.harness.calls).toContain('host.createSuspended');
    expect(spy.harness.calls).toContain('peer.request:engine/probe-containment');
    expect(spy.harness.calls).toContain('peer.request:engine/open');
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
          : null,
    );
    const { handlers } = createShellDependencies(
      appInfo,
      () => Promise.resolve(paths[next++] ?? null),
      spy.platform,
    );

    const first = await handlers['document.open']({});
    const second = await handlers['document.open']({});
    if (!first.ok || first.value.kind !== 'opened') throw new Error('the first did not open');
    if (!second.ok || second.value.kind !== 'opened') throw new Error('the second did not open');

    // Let both lane entries settle. The rejection is the bus with no adapter,
    // which is what a document that HAS a session reaches — see the first case.
    await expect(
      handlers['document.execute']({
        docId: second.value.docId,
        command: { kind: 'rotatePages', pages: [1], quarterTurns: 1 },
      }),
    ).rejects.toThrow(/no adapter registered/u);

    // ONE process, TWO sessions. Counting the creations rather than asserting
    // "a host exists" is the whole case: a lifecycle that rebuilt per document
    // would satisfy every other assertion in this file, and *one host per
    // engine* is ADR-0023 Decision 9c's wording rather than an optimisation.
    const created = spy.harness.calls.filter((call) => call === 'host.createSuspended');
    const opens = spy.harness.calls.filter((call) => call === 'peer.request:engine/open');
    expect(created).toHaveLength(1);
    expect(opens).toHaveLength(2);
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
