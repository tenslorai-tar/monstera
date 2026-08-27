import { PDFDocument } from '@cantoo/pdf-lib';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createClient, type Incident, wrapHandlers } from '@monstera/contract';

import { localMupdfExecution } from '../commandSpecs.js';
import type { ByteImage } from '../engineSeam.js';
import { mupdfWriter } from '../mupdfWriter.js';
import { engineChannels } from './engineChannels.js';
import { type HostSession, createEngineHandlers } from './engineHandlers.js';
import { createRemoteSessions } from './remoteEngine.js';
import {
  EngineOpenFailed,
  EngineSerialiseMismatch,
  type SessionArea,
  type SessionAreaSurface,
  remoteMupdfLifecycle,
} from './remoteLifecycle.js';

/**
 * BOTH HALVES, JOINED, AGAINST ONE REAL DOCUMENT AND REAL DIRECTORIES.
 *
 * The point of the design is that a document image reaches the engine **without
 * crossing the pipe**, and there is exactly one way to be convinced of that: run
 * main's adapter and the host's handlers against each other over a real client,
 * with a real MuPDF session at the far end and real files on disk, and check
 * that the bytes arrive.
 *
 * A test with a stubbed writer would prove that the two halves agree about a
 * message shape, which is the thing least likely to be wrong.
 */

let flat: ByteImage;

/**
 * A DELIBERATELY LARGER FIXTURE, for the one case that compares message size
 * against document size.
 *
 * The four-page document is ~700 bytes, and a single `engine/open` request
 * carries two temp-directory paths — so with that fixture the ratio assertion
 * is not merely weak, it is **false in the correct implementation**. Caught by
 * this file's own premise check rather than by the ratio silently passing,
 * which is the reason that check is there: a comparison whose two sides are the
 * same order of magnitude separates nothing.
 */
let bulky: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) document.addPage([200, 200]);
  flat = await document.save();

  const large = await PDFDocument.create();
  for (let index = 0; index < 900; index += 1) large.addPage([200, 200]);
  bulky = await large.save();
});

/**
 * A real filesystem area under the OS temp directory.
 *
 * NOT the shipped one — `createSessionDirectories` writes DACLs and lives in
 * `apps/desktop`, which this package may not import. What is under test here is
 * the ORDER of operations against that surface: created before bytes are
 * written, removed on every path out. Whether the DACL is right is
 * `hostDacl.test.ts` and `proof:hostcontainment`.
 */
/**
 * The temp ROOTS this file's fixture minted, so an `afterEach` can remove them.
 *
 * `remove(area)` deletes the two directories the surface's contract names —
 * snapshot and output — and it must keep doing exactly that, because what is
 * under test is the ORDER of operations against that contract. The root above
 * them is not part of the contract: it is this fixture's own grouping, created
 * by `mkdtemp` so two areas cannot collide.
 *
 * So it had no owner, and nothing removed it. Measured 2026-08-27: **284
 * `monstera-lifecycle-*` directories** in `%TEMP%`, every one empty — the
 * children removed exactly as the contract says and the parent left behind on
 * every single call. Not a killed run and not a Windows handle: a leak by
 * construction, which is why it is the largest of the 39 prefixes on this
 * machine by a factor of two.
 */
const mintedRoots: string[] = [];

function realAreas(): SessionAreaSurface & {
  readonly made: SessionArea[];
  readonly removed: SessionArea[];
} {
  const made: SessionArea[] = [];
  const removed: SessionArea[] = [];
  let minted = 0;

  return {
    made,
    removed,
    mintName: () => `f${String((minted += 1))}`,
    create: async () => {
      const root = await mkdtemp(join(tmpdir(), 'monstera-lifecycle-'));
      mintedRoots.push(root);
      const area: SessionArea = {
        snapshotDirectory: join(root, 'in'),
        outputDirectory: join(root, 'out'),
      };
      await mkdir(area.snapshotDirectory, { recursive: true });
      await mkdir(area.outputDirectory, { recursive: true });
      made.push(area);
      return area;
    },
    writeSnapshot: async (area, name, image) => {
      await writeFile(join(area.snapshotDirectory, name), image);
    },
    takeOutput: async (area, name) => {
      const path = join(area.outputDirectory, name);
      const bytes = await readFile(path);
      // DELETED ON THE WAY OUT. Every serialise is another whole copy of the
      // user's document, and a save-heavy session would otherwise leave one per
      // save in a directory the contained host may read.
      await rm(path);
      return new Uint8Array(bytes);
    },
    remove: async (area) => {
      removed.push(area);
      await rm(area.snapshotDirectory, { recursive: true, force: true });
      await rm(area.outputDirectory, { recursive: true, force: true });
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Main's adapter wired to the host's handlers, with a real engine behind them.
 *
 * `transport` wraps the dispatch, because a HOST failure and a TRANSPORT
 * failure are different shapes and only one of them can reject. `wrapHandler`
 * catches anything a handler throws and answers with a `Result`, so overriding
 * the writer can never make a call reject — a dead host, a closed pipe or a
 * call that is never answered can. A case that confuses the two tests the
 * wrong path (measured: the `finally` in `close` survived its own mutation
 * against a writer override, because nothing was throwing).
 */
function joined(
  areas: SessionAreaSurface,
  override: Partial<typeof mupdfWriter> = {},
  transport?: (id: string) => Promise<never> | undefined,
) {
  const held = new Map<string, HostSession>();
  let issued = 0;
  const incidents: Incident[] = [];

  const wrapped = wrapHandlers(
    engineChannels,
    createEngineHandlers(
      {
        lookup: (id) => held.get(id),
        issue: (session) => {
          const id = `s${String((issued += 1))}`;
          held.set(id, session);
          return id;
        },
        forget: (id) => {
          held.delete(id);
        },
      },
      localMupdfExecution,
      { ...mupdfWriter, ...override },
      {
        readSnapshot: async (directory, name) =>
          new Uint8Array(await readFile(join(directory, name))),
        writeOutput: async (directory, name, bytes) => {
          await writeFile(join(directory, name), bytes);
          return bytes.length;
        },
      },
      () => {
        throw new Error('the lifecycle half must not probe containment');
      },
    ),
    (incident) => incidents.push(incident),
  );

  const client = createClient(engineChannels, async (id, params) => {
    const refusal = transport?.(id);
    if (refusal !== undefined) return refusal;
    return wrapped[id](params);
  });
  const sessions = createRemoteSessions();
  return {
    incidents,
    held,
    lifecycle: remoteMupdfLifecycle(client, sessions, areas),
  };
}

describe('remoteMupdfLifecycle', () => {
  // The fixture's own grouping directory, removed here rather than inside
  // `remove` — see {@link mintedRoots}. `force` because a case that never
  // reached `create` leaves nothing to delete, and that is not a failure.
  afterEach(async () => {
    while (mintedRoots.length > 0) {
      const root = mintedRoots.pop();
      if (root !== undefined) await rm(root, { recursive: true, force: true });
    }
  });

  /**
   * THE LOAD-BEARING CASE. Bytes go in through a directory, come back through
   * another, and the returned image is one MuPDF can open again — which is the
   * only evidence that a real document made the round trip rather than a
   * plausible buffer.
   */
  it('carries a document in and out through files, and the result reopens', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas);

    const session = await lifecycle.open(flat);
    const round = await lifecycle.serialise(session);

    expect(round.length).toBeGreaterThan(0);
    const reopened = await mupdfWriter.open(round);
    expect(reopened).toBeDefined();
    await mupdfWriter.close(reopened);

    await lifecycle.close(session);
  });

  /**
   * NOTHING DOCUMENT-SIZED CROSSED THE PIPE, and this asserts it on the
   * MESSAGES rather than by inspecting the design.
   *
   * The mutation this separates is the one a first implementation reaches for:
   * putting the image in the `open` request and the bytes in the `serialise`
   * response. Both would pass the case above.
   */
  it('sends no request or response as large as the document', async () => {
    const areas = realAreas();
    const held = new Map<string, HostSession>();
    let issued = 0;
    /** @see joined — duplicated here because this case must see the wire. */
    const sizes: number[] = [];

    const wrapped = wrapHandlers(
      engineChannels,
      createEngineHandlers(
        {
          lookup: (id) => held.get(id),
          issue: (session) => {
            const id = `s${String((issued += 1))}`;
            held.set(id, session);
            return id;
          },
          forget: (id) => {
            held.delete(id);
          },
        },
        localMupdfExecution,
        mupdfWriter,
        {
          readSnapshot: async (directory, name) =>
            new Uint8Array(await readFile(join(directory, name))),
          writeOutput: async (directory, name, bytes) => {
            await writeFile(join(directory, name), bytes);
            return bytes.length;
          },
        },
        () => {
          throw new Error('the byte-size case must not probe containment');
        },
      ),
      () => undefined,
    );

    const client = createClient(engineChannels, async (id, params) => {
      sizes.push(JSON.stringify(params).length);
      const answer = await wrapped[id](params);
      sizes.push(JSON.stringify(answer).length);
      return answer;
    });

    const lifecycle = remoteMupdfLifecycle(client, createRemoteSessions(), areas);
    const session = await lifecycle.open(bulky);
    const round = await lifecycle.serialise(session);
    await lifecycle.close(session);

    // Every message is orders below the image. Asserted against the DOCUMENT's
    // size rather than a constant, so the case keeps its meaning if the fixture
    // changes — and against the smaller of the two images, so it cannot pass by
    // the round trip happening to inflate.
    //
    // THE PREMISE IS ASSERTED FIRST, and it earned its place: with the small
    // fixture this comparison was between two numbers of the same order, where
    // "no message is a quarter of the document" is false however correct the
    // implementation is.
    const document = Math.min(bulky.length, round.length);
    expect(document).toBeGreaterThan(20_000);
    expect(Math.max(...sizes)).toBeLessThan(document / 20);
  });

  /**
   * THE LIFETIME PROPERTY, and it is the reason the reviewer asked for the
   * directories in this unit: a snapshot that outlives its session is a copy of
   * the user's document sitting where the contained host can read it.
   */
  it('removes both directories on close, with the snapshot gone from disk', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas);

    const session = await lifecycle.open(flat);
    const [area] = areas.made;
    expect(area).toBeDefined();
    if (area === undefined) return;

    // The premise: the image really is on disk while the session is open. A
    // case that only checked the directory is gone afterwards would pass
    // against an implementation that never wrote anything.
    expect(await exists(area.snapshotDirectory)).toBe(true);

    await lifecycle.close(session);

    expect(await exists(area.snapshotDirectory)).toBe(false);
    expect(await exists(area.outputDirectory)).toBe(false);
  });

  /**
   * THE CONTROL FOR THE ONE ABOVE, and it is the case that separates "removes
   * on the happy path" from "removes". A host that has gone away is exactly
   * when the files would otherwise be left, because the close call throws
   * before any cleanup a naive `try` would reach.
   */
  it('removes the directories when the TRANSPORT is gone mid-close', async () => {
    const areas = realAreas();
    let dead = false;
    const { lifecycle } = joined(areas, {}, (id) =>
      dead && id === 'engine/close'
        ? Promise.reject(new Error('the pipe is gone; this call will never be answered'))
        : undefined,
    );

    const session = await lifecycle.open(flat);
    const [area] = areas.made;
    expect(area).toBeDefined();
    if (area === undefined) return;
    dead = true;

    // THE CALL REJECTS AND THE FILES STILL GO. This is the only path between
    // the call and the cleanup, and it is the case that gives `close`'s
    // `finally` something to protect.
    //
    // MEASURED: an earlier version of this case rejected the host's WRITER
    // instead, and the mutation that deletes the `finally` passed against it —
    // because `wrapHandler` catches a handler's throw and answers with a
    // Result, so nothing ever rejected and the cleanup ran on the ordinary
    // path either way. A fixture the bug also handles correctly, wearing the
    // name of the property it did not test.
    await expect(lifecycle.close(session)).rejects.toThrow('the pipe is gone');

    expect(areas.removed).toHaveLength(1);
    expect(await exists(area.snapshotDirectory)).toBe(false);
    expect(await exists(area.outputDirectory)).toBe(false);
  });

  /**
   * ITS PAIR, and both are needed. This one is about the ANSWER rather than the
   * call: a host that refuses the close, or has already forgotten the session,
   * is not something this side can act on — so `close` resolves rather than
   * throwing at a caller with nothing to do about it.
   */
  it('resolves when the host itself refuses the close, and still removes', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas, {
      close: () => Promise.reject(new Error('the engine faulted mid-close')),
    });

    const session = await lifecycle.open(flat);
    await expect(lifecycle.close(session)).resolves.toBeUndefined();
    expect(areas.removed).toHaveLength(1);
  });

  /**
   * A FAILED OPEN LEAVES NOTHING. By the time the engine refuses, the image is
   * already on disk — and the caller receives an error rather than a session,
   * so nothing else will ever remove it.
   */
  it('removes the directories when the engine refuses the image', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas, {
      open: () => Promise.reject(new Error('not a PDF')),
    });

    await expect(lifecycle.open(flat)).rejects.toThrow(EngineOpenFailed);

    expect(areas.made).toHaveLength(1);
    expect(areas.removed).toHaveLength(1);
    const [area] = areas.made;
    expect(area).toBeDefined();
    if (area === undefined) return;
    expect(await exists(area.snapshotDirectory)).toBe(false);
  });

  /**
   * A REFUSED DOCUMENT IS NOT A SICK HOST. `open-failed` is a declared code, so
   * the supervisor can decline to count it — an `internal` here would be read
   * as the host being unhealthy, answered with a rebuild, and the rebuilt host
   * would fail on the same file.
   */
  it('reports a refused document as a declared code, never as an incident', async () => {
    const areas = realAreas();
    const { lifecycle, incidents } = joined(areas, {
      open: () => Promise.reject(new Error('not a PDF')),
    });

    await expect(lifecycle.open(flat)).rejects.toThrow(EngineOpenFailed);
    expect(incidents).toEqual([]);
  });

  /**
   * THE COUNT IS COMPARED, and this is why it is on the wire at all: a host
   * that wrote nothing and a read that found nothing are the same empty buffer,
   * and only one of them is this side's problem.
   */
  it('refuses a byte count that disagrees with the file it read', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas, {
      // Writes a SHORTER image than the count the handler reports, by
      // serialising something the host then truncates on the way to disk. The
      // handler returns what it wrote, so the disagreement is injected in the
      // surface main reads through instead.
    });
    const session = await lifecycle.open(flat);

    const shortened: SessionAreaSurface = {
      ...areas,
      takeOutput: async (area, name) => (await areas.takeOutput(area, name)).slice(0, 10),
    };
    const { lifecycle: lying } = joined(shortened);
    const other = await lying.open(flat);
    await expect(lying.serialise(other)).rejects.toThrow(EngineSerialiseMismatch);

    await lifecycle.close(session);
    await lying.close(other);
  });

  /**
   * A CLOSED SESSION IS NOT REUSABLE. `close` releases the token and forgets
   * the area, so a later call through it is refused here rather than reaching a
   * path built from `undefined`.
   */
  it('refuses a session it has already closed', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas);

    const session = await lifecycle.open(flat);
    await lifecycle.close(session);

    await expect(lifecycle.serialise(session)).rejects.toThrow();
  });

  /**
   * TWO SESSIONS GET TWO AREAS. One host serves every document (Decision 9c),
   * so a lifecycle that reused one area would put both documents' images in one
   * directory — and closing either would remove the other's.
   */
  it('gives each session its own pair of directories', async () => {
    const areas = realAreas();
    const { lifecycle } = joined(areas);

    const first = await lifecycle.open(flat);
    const second = await lifecycle.open(flat);

    expect(areas.made).toHaveLength(2);
    const [one, two] = areas.made;
    expect(one?.snapshotDirectory).not.toBe(two?.snapshotDirectory);

    await lifecycle.close(first);
    expect(await exists(two?.snapshotDirectory ?? '')).toBe(true);

    await lifecycle.close(second);
  });
});
