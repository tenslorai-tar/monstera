import { type DocId, type DocVersion, asDocId, asDocVersion } from '@monstera/shared';
import { describe, expect, it } from 'vitest';

import type { AtomicWriteSurface } from './atomicWrite.js';
import type { CommandLog } from './commandLog.js';
import type {
  CommandWriter,
  DocumentContext,
  SaveWriter,
  WriteTargetVerdict,
} from './documentService.js';
import { type SaveDependencies, saveDocument } from './savePipeline.js';

/**
 * §4's save pipeline, and above all **invariant 18**, which words its own
 * control:
 *
 * > Proven with a control case that shows the same scenario losing work without
 * > the guard.
 *
 * So the control here is not a nearby one and not an easier one. It drives the
 * **same filesystem failure** through a save with no atomic ordering and shows
 * the user's document destroyed. Without it, every case below is satisfied by a
 * scenario in which nothing was ever at risk — which is the difference between
 * proving a guard works and proving a guard was needed.
 */

const DOC = asDocId('doc-under-save');
const TARGET = '/docs/report.pdf';
const NAMES = { temp: '/docs/report.pdf.tmp', backup: '/docs/report.pdf.bak' };
const NEW_BYTES = new TextEncoder().encode('saved contents');

/** A file the fake surface holds, so a case can assert what survived. */
type Files = Map<string, string>;

/** A lane entry's context, with what the pipeline may do to a document recorded. */
interface Held {
  readonly context: DocumentContext;
  /** The version `markSaved` stamped, or null when it was never called. */
  stamped: () => DocVersion | null;
}

/**
 * `markSaved` RECORDS rather than being stubbed away.
 *
 * The property under test is a **decision**: on a failed write the pipeline's
 * job is to not stamp, and the state that produces — a dirty document — is also
 * the state a pipeline that crashed one line earlier produces. Asserting the
 * call is what separates the two, and asserting `isDirty()` alone would not.
 */
function held(version: number): Held {
  const at = asDocVersion(version);
  const recorded: { stamped: DocVersion | null } = { stamped: null };
  const log = { entries: [], retainedBytes: () => 0 } as unknown as CommandLog;

  return {
    stamped: () => recorded.stamped,
    context: {
      docId: DOC,
      path: TARGET,
      version: at,
      // Unread here, like `path` was before the pipeline existed: saving is
      // about what reaches the file, and the canonical image's length is the
      // renderer's question rather than this one's.
      byteLength: 0,
      // A save does not grow the log, so this stub is never reached. It throws
      // rather than answering zero: a save that trimmed history would be a
      // finding, and a quiet stub is how it would arrive unnoticed.
      enforceRetention: (): never => {
        throw new Error('saving does not enforce retention');
      },
      // Same treatment and the same reason one line up: a save never restores a
      // checkpoint, so this stub is unreachable and says so rather than
      // answering a plausible zero.
      writeCheckpoint: (): never => {
        throw new Error('saving does not write a checkpoint');
      },
      // Same treatment again, and for a save it is the sharper claim of the
      // three: a save READS the document's current bytes and must never change
      // what `main` holds. A quiet stub here would let a pipeline that
      // installed its own output pass every case in this file.
      writeImage: (): never => {
        throw new Error('saving does not write a command image');
      },
      replaceCanonicalImage: (): never => {
        throw new Error('saving does not replace the canonical image');
      },
      bumpVersion: (_writer: CommandWriter): DocVersion => at,
      commandLog: (_writer: CommandWriter): CommandLog => log,
      log,
      markSaved: (_writer: SaveWriter): DocVersion => {
        recorded.stamped = at;
        return at;
      },
      isDirty: (): boolean => recorded.stamped === null,
    },
  };
}

/**
 * A filesystem that can be told to fail one call.
 *
 * `truncates` is what makes the control below mean anything: a real partial
 * write leaves the file it was writing to shortened or empty, and a failure
 * that left the target byte-identical would make the unguarded ordering look
 * safe for a reason that has nothing to do with the guard.
 */
function fake(
  files: Files,
  failure: { step: 'write' | 'rename'; code: string; truncates?: boolean } | null = null,
): { surface: AtomicWriteSurface; files: Files; calls: string[] } {
  const calls: string[] = [];
  const refuse = (step: 'write' | 'rename', path: string): void => {
    if (failure?.step !== step) return;
    if (failure.truncates === true) files.set(path, '');
    const error: Error & { code?: string } = new Error(`${step} refused`);
    error.code = failure.code;
    throw error;
  };

  return {
    files,
    calls,
    surface: {
      write: (path, bytes) => {
        calls.push(`write:${path}`);
        refuse('write', path);
        files.set(path, new TextDecoder().decode(bytes));
        return Promise.resolve();
      },
      sync: (path) => {
        calls.push(`sync:${path}`);
        return Promise.resolve();
      },
      rename: (from, to) => {
        calls.push(`rename:${from}->${to}`);
        refuse('rename', to);
        const moved = files.get(from);
        if (moved === undefined) throw new Error('rename: nothing at source');
        files.delete(from);
        files.set(to, moved);
        return Promise.resolve();
      },
      copy: (from, to) => {
        calls.push(`copy:${from}->${to}`);
        const held_ = files.get(from);
        if (held_ !== undefined) files.set(to, held_);
        return Promise.resolve();
      },
      remove: (path) => {
        calls.push(`remove:${path}`);
        files.delete(path);
        return Promise.resolve();
      },
      exists: (path) => Promise.resolve(files.has(path)),
    },
  };
}

function deps(surface: AtomicWriteSurface, verdict: WriteTargetVerdict): SaveDependencies {
  return {
    checkWriteTarget: (_docId: DocId) => Promise.resolve(verdict),
    surface,
    names: () => NAMES,
    wait: () => Promise.resolve(),
  };
}

/**
 * THE SAME SAVE WITHOUT THE GUARD — invariant 18's control, in one function.
 *
 * No temp, no sync, no backup, no rename: the new bytes go straight at the
 * user's file, which is what a save looks like before anyone has thought about
 * failure. It is here rather than in a comment because the invariant asks for a
 * case, and a case needs something to run.
 */
async function saveWithoutTheGuard(
  surface: AtomicWriteSurface,
  bytes: Uint8Array,
): Promise<'wrote' | 'failed'> {
  try {
    await surface.write(TARGET, bytes);
    return 'wrote';
  } catch {
    return 'failed';
  }
}

describe('saveDocument', () => {
  it('checks, flushes, writes atomically and stamps', async () => {
    const files: Files = new Map([[TARGET, 'original']]);
    const f = fake(files);
    const document = held(4);
    const flushes = { count: 0 };

    const outcome = await saveDocument(
      deps(f.surface, { kind: 'sole-writer' }),
      document.context,
      () => {
        flushes.count += 1;
        return Promise.resolve(NEW_BYTES);
      },
    );

    expect(outcome.kind).toBe('saved');
    if (outcome.kind === 'saved') {
      expect(outcome.bytes).toBe(NEW_BYTES.byteLength);
      expect(outcome.backedUp).toBe(true);
    }
    expect(flushes.count).toBe(1);
    expect(files.get(TARGET)).toBe('saved contents');
    // §4's `.bak`: the user's previous version, surviving a successful save.
    expect(files.get(NAMES.backup)).toBe('original');
    expect(document.stamped()).not.toBeNull();
  });

  it('THE ORDERING: the stamp happens after the rename, never before', async () => {
    // Invariant 18's silent-loss shape, and it is an ORDERING rather than a bug
    // in any step. A document stamped before the write believes the file holds
    // its current version, so closing it prompts nobody and the work is gone.
    const files: Files = new Map([[TARGET, 'original']]);
    const f = fake(files);
    const document = held(4);
    const stampedAfter: string[] = [];
    const watching: DocumentContext = {
      ...document.context,
      markSaved: (writer: SaveWriter): DocVersion => {
        stampedAfter.push(f.calls.join(','));
        return document.context.markSaved(writer);
      },
    };

    await saveDocument(deps(f.surface, { kind: 'sole-writer' }), watching, () =>
      Promise.resolve(NEW_BYTES),
    );

    expect(stampedAfter).toHaveLength(1);
    expect(stampedAfter[0]).toContain(`rename:${NAMES.temp}->${TARGET}`);
  });

  it('THE INVARIANT: a failed write leaves the original, and does NOT stamp', async () => {
    const files: Files = new Map([[TARGET, 'original']]);
    // The rename is held by something that will not let go — the ladder's own
    // terminal case, and the one place the original could be destroyed.
    const f = fake(files, { step: 'rename', code: 'EPERM' });
    const document = held(4);

    const outcome = await saveDocument(
      deps(f.surface, { kind: 'sole-writer' }),
      document.context,
      () => Promise.resolve(NEW_BYTES),
    );

    expect(outcome.kind).toBe('write-failed');
    if (outcome.kind === 'write-failed') expect(outcome.failure.stage).toBe('rename');
    // Half one: the file on disk is what it was.
    expect(files.get(TARGET)).toBe('original');
    // Half two, and it is the half a filesystem assertion cannot reach: the
    // document still knows it is dirty, so the work is still offered to the
    // user. ASSERT THE CALL, because "dirty" is also what a pipeline that never
    // reached the stamp for an unrelated reason leaves behind.
    expect(document.stamped()).toBeNull();
    expect(document.context.isDirty()).toBe(true);
  });

  it('CONTROL: the same scenario loses the work when the guard is not there', async () => {
    // Invariant 18 names this case in its own text. Same failure, same code,
    // same bytes — the only difference is the ordering under test.
    const guarded: Files = new Map([[TARGET, 'original']]);
    const unguarded: Files = new Map([[TARGET, 'original']]);
    const failure = { step: 'write', code: 'ENOSPC', truncates: true } as const;

    const withGuard = fake(guarded, failure);
    const outcome = await saveDocument(
      deps(withGuard.surface, { kind: 'sole-writer' }),
      held(4).context,
      () => Promise.resolve(NEW_BYTES),
    );

    const withoutGuard = fake(unguarded, failure);
    const naive = await saveWithoutTheGuard(withoutGuard.surface, NEW_BYTES);

    // Both saves failed. That is the scenario, and it is identical.
    expect(outcome.kind).toBe('write-failed');
    expect(naive).toBe('failed');

    // WITHOUT THE GUARD the user's document is gone — truncated to nothing by a
    // write that then refused. This is the assertion that makes the case above
    // evidence rather than decoration: if this ever reads 'original', the
    // scenario is one in which nothing was at risk and the guard proves nothing.
    expect(unguarded.get(TARGET)).toBe('');

    // WITH IT, the same failure never touched the file.
    expect(guarded.get(TARGET)).toBe('original');
  });

  it('refuses every verdict but sole-writer, WITHOUT flushing', async () => {
    // The flush is a round trip to the engine host. Asserting it was not called
    // is asserting the decision; asserting the file is unchanged would pass for
    // a pipeline that flushed, then refused, then did nothing — which is the
    // same end state by a route that costs a contained process a round trip.
    const refused: WriteTargetVerdict[] = [
      { kind: 'contested', others: [asDocId('the-other-document')] },
      { kind: 'replaced' },
      { kind: 'target-absent' },
      { kind: 'unverifiable', reason: 'index-reused-or-modified' },
      { kind: 'unverifiable', reason: 'no-file-index' },
      { kind: 'unverifiable', reason: 'no-change-time' },
    ];

    for (const verdict of refused) {
      const files: Files = new Map([[TARGET, 'original']]);
      const f = fake(files);
      const document = held(4);
      const flushes = { count: 0 };

      const outcome = await saveDocument(deps(f.surface, verdict), document.context, () => {
        flushes.count += 1;
        return Promise.resolve(NEW_BYTES);
      });

      expect(outcome).toStrictEqual({ kind: 'refused', verdict });
      expect(flushes.count).toBe(0);
      expect(f.calls).toStrictEqual([]);
      expect(files.get(TARGET)).toBe('original');
      expect(document.stamped()).toBeNull();
    }
  });

  it('CONTROL: target-absent is a refusal, not a quiet create', async () => {
    // The verdict list above would be satisfied by a pipeline that permitted
    // `target-absent`, because with no file present nothing can be observed to
    // be lost. `checkWriteTarget`'s own comment settles it — "sole-writer is
    // what permits the write" — and the reason is that the control which finds
    // this document at its own file did not run, so nothing verified that no
    // OTHER open document reaches the path the write would create.
    const files: Files = new Map();
    const f = fake(files);

    const outcome = await saveDocument(
      deps(f.surface, { kind: 'target-absent' }),
      held(4).context,
      () => Promise.resolve(NEW_BYTES),
    );

    expect(outcome.kind).toBe('refused');
    expect(files.has(TARGET)).toBe(false);
  });

  it('a flush that throws never reaches the filesystem', async () => {
    // A dead engine host is a failed save, not a damaged file. The bytes are
    // produced before anything on disk is touched precisely so this ordering
    // needs no cleanup.
    const files: Files = new Map([[TARGET, 'original']]);
    const f = fake(files);
    const document = held(4);

    await expect(
      saveDocument(deps(f.surface, { kind: 'sole-writer' }), document.context, () =>
        Promise.reject(new Error('the engine host is gone')),
      ),
    ).rejects.toThrow('the engine host is gone');

    expect(f.calls).toStrictEqual([]);
    expect(files.get(TARGET)).toBe('original');
    expect(document.stamped()).toBeNull();
  });
});
