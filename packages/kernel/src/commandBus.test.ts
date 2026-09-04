import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Command, CommandOfKind } from '@monstera/contract';
import { type DocVersion, asDocVersion } from '@monstera/shared';

import {
  type CheckpointRestore,
  CommandBus,
  type SnapshotWrite,
  UnregisteredWriterError,
} from './commandBus.js';
import {
  type Checkpoint,
  CommandLog,
  type LogEntry,
  type LogEntryFor,
  type LogTrim,
} from './commandLog.js';
import type { CommandWriter, DocumentContext } from './documentService.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import { localMupdfWriter } from './localEngine.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * The log and the one path from a command to an entry (ADR-0009 §4).
 *
 * The terminal branch is exercised by a **real** constructor rather than a
 * fixture invented to reach it: a page whose `/Rotate` is a name is malformed,
 * opens in every other reader, and cannot have prior state recorded — so the
 * bus takes a checkpoint and applies anyway. §4's terminal variant would
 * otherwise land with nothing constructing it, which is an unexercised branch.
 */

let flat: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 3; index += 1) document.addPage([612, 792]);
  flat = await document.save();
});

/**
 * A minimal lane context.
 *
 * It carries a **real `CommandLog`**, because that is where the log now lives —
 * on the document's record, not on the bus (ADR-0009's composition decision).
 * One context stands for one document, so two contexts are two logs, which is
 * the property the decision exists to make structural.
 */
function contextStub(): DocumentContext & {
  readonly bumps: () => number;
  /** How many times the bus asked for retention to be enforced. */
  readonly trims: () => number;
  /** Lowers the stand-in for the service's document-bytes ceiling. */
  readonly ceiling: (bytes: number) => void;
  /** The same log, reachable without minting a capability inside a test. */
  readonly mutableLog: CommandLog;
  /** Every checkpoint write the bus asked for, in order. */
  readonly written: () => readonly { readonly destination: string; readonly bytes: Checkpoint }[];
} {
  let version = asDocVersion(1);
  let bumps = 0;
  let trims = 0;
  let ceiling = Number.MAX_SAFE_INTEGER;
  const log = new CommandLog();
  const written: { destination: string; bytes: Checkpoint }[] = [];
  return {
    mutableLog: log,
    docId: 'stub' as DocumentContext['docId'],
    path: 'stub',
    // A CONSTANT, and the stub says so rather than modelling a rewrite. Nothing
    // in this file reads it: the bus's subject is what it records and what it
    // bumps, and a fake that pretended to resize would be inventing behaviour
    // the real service owns.
    byteLength: 0,
    get version(): DocVersion {
      return version;
    },
    bumpVersion(_writer: CommandWriter): DocVersion {
      bumps += 1;
      version = asDocVersion(version + 1);
      return version;
    },
    commandLog(_writer: CommandWriter): CommandLog {
      return log;
    },
    // THE CEILING IS THE SERVICE'S, so this stub carries the one number the bus
    // is entitled to know nothing about. `ceiling` is settable per case: the
    // default is generous, so every pre-existing case in this file keeps asking
    // what it asked, and the retention cases lower it.
    enforceRetention(_writer: CommandWriter): LogTrim {
      trims += 1;
      return log.trimTo(ceiling);
    },
    ceiling: (bytes: number): void => {
      ceiling = bytes;
    },
    // RECORDED RATHER THAN WRITTEN. The service's half of a restore is one line
    // — put these bytes at that path — and what the bus has to get right is
    // WHICH bytes, so the recorder keeps them for a case to compare against the
    // entry's own checkpoint. Writing to a temporary directory would measure the
    // filesystem and prove nothing about the choice.
    writeCheckpoint(
      _writer: CommandWriter,
      checkpoint: Checkpoint,
      destination: string,
    ): Promise<number> {
      written.push({ destination, bytes: checkpoint });
      return Promise.resolve(checkpoint.byteLength);
    },
    written: () => written,
    trims: () => trims,
    log,
    markSaved(): DocVersion {
      return version;
    },
    isDirty(): boolean {
      return false;
    },
    bumps: () => bumps,
  };
}

const rotateFirst: CommandOfKind<'rotatePages'> = {
  kind: 'rotatePages',
  pages: [0],
  quarterTurns: 1,
};

/** A session whose pages inherit `/Rotate` from the `/Pages` node. */
async function inheritingSession(value: number): Promise<MupdfSession> {
  const session = await mupdfWriter.open(flat);
  await withDocument(session, (document) => {
    document.getTrailer().get('Root').get('Pages').put('Rotate', value);
  });
  return session;
}

/** The `/Rotate` a page declares itself, or `null` if it inherits. */
function ownRotation(session: MupdfSession, page: number): Promise<number | null> {
  return withDocument(session, (document) => {
    const own = document.loadPage(page).getObject().get('Rotate');
    return own.isNull() ? null : own.asNumber();
  });
}

/**
 * A stand-in for the session supervisor's restore, which **calls the writer**.
 *
 * A stub that recorded the call and never called `write` would pass any
 * assertion about *a restore happened* while proving nothing about which bytes
 * the bus chose — and the bytes are the whole decision. This one behaves like
 * the real supervisor: it grants a destination, calls the writer with it, and
 * keeps what came back.
 */
function restoreStub(): {
  readonly restore: CheckpointRestore;
  readonly calls: () => readonly { readonly destination: string; readonly bytes: number }[];
} {
  const calls: { destination: string; bytes: number }[] = [];
  return {
    restore: async (write: SnapshotWrite): Promise<void> => {
      const destination = `granted-pair-${String(calls.length)}/snapshot`;
      calls.push({ destination, bytes: await write(destination) });
    },
    calls: () => calls,
  };
}

/**
 * A restore for the cases that never reach one — every invertible undo.
 *
 * It **throws**, rather than resolving quietly. A no-op here would let a bus
 * that restored on every undo pass every case in this file, which is the
 * mutation those cases exist to catch.
 */
const noRestoreExpected: CheckpointRestore = () => {
  throw new Error('this case undoes an invertible entry and must not reach a restore');
};

/** A session whose page 0 carries a `/Rotate` that is a name, not an integer. */
async function malformedSession(): Promise<MupdfSession> {
  const session = await mupdfWriter.open(flat);
  await withDocument(session, (document) => {
    document.loadPage(0).getObject().put('Rotate', document.newName('Landscape'));
  });
  return session;
}

/** The `/Rotate` page 0 declares in a serialised document, as text. */
async function ownRotationIn(bytes: ByteImage): Promise<string> {
  const session = await mupdfWriter.open(bytes);
  try {
    return await withDocument(session, (document) =>
      document.loadPage(0).getObject().get('Rotate').toString(),
    );
  } finally {
    await mupdfWriter.close(session);
  }
}

describe('CommandLog — a cursor, not a stack', () => {
  /** Entries distinguishable by their inverse, so order is observable. */
  /**
   * TYPED TO THE KIND IT BUILDS, not to `LogEntry`.
   *
   * It returned `LogEntry` while there was one command, so `entry.command.pages`
   * read straight off the union. With two commands the union has a member that
   * carries no `pages`, and every assertion below stopped compiling — correctly:
   * a log entry read out of the log genuinely may be either.
   *
   * The fixture knows which one it made, so it says so. That keeps the
   * assertions about the pages this fixture put in rather than about a narrowing
   * the cases would otherwise have to perform on every line.
   */
  /**
   * The pages a recorded entry rotated, refusing an entry of another kind.
   *
   * **A CHECK, not a convenience.** Everything read back out of the log is a
   * `LogEntry` — either kind — so these cases have to narrow, and narrowing by
   * refusing is what turns *the log gave me the wrong entry* into a named
   * failure rather than a missing property. That distinction did not exist
   * while one command did.
   */
  function pagesOf(recorded: LogEntry | undefined): readonly number[] {
    if (recorded === undefined) throw new Error('expected an entry, got none');
    if (recorded.command.kind !== 'rotatePages') {
      throw new Error(`expected a rotatePages entry, got ${recorded.command.kind}`);
    }
    return recorded.command.pages;
  }

  function entry(page: number): LogEntryFor<'rotatePages'> {
    return {
      kind: 'invertible',
      command: { kind: 'rotatePages', pages: [page], quarterTurns: 1 },
      inverse: [{ page, prior: { present: false } }],
    };
  }

  it('records, and undo steps back WITHOUT popping', () => {
    const log = new CommandLog();
    log.record(entry(0));
    log.record(entry(1));

    expect(log.entries).toHaveLength(2);
    const undone = log.undo();

    expect(pagesOf(undone)).toStrictEqual([1]);
    expect(log.entries).toHaveLength(1);
    // The entry is still there — that is the whole difference from a stack, and
    // it is what makes redo possible at all.
    expect(log.redoDepth).toBe(1);
    expect(log.canRedo).toBe(true);
  });

  it('redo steps forward over the same entry', () => {
    const log = new CommandLog();
    log.record(entry(0));
    log.undo();

    expect(pagesOf(log.redo())).toStrictEqual([0]);
    expect(log.entries).toHaveLength(1);
    expect(log.canRedo).toBe(false);
  });

  it('a new command TRUNCATES the redo tail', () => {
    const log = new CommandLog();
    log.record(entry(0));
    log.record(entry(1));
    log.record(entry(2));
    log.undo();
    log.undo();
    expect(log.redoDepth).toBe(2);

    log.record(entry(9));

    // Keeping the tail would let redo replay a command against a document that
    // has since diverged — a corrupted document, not a surprising history.
    expect(log.redoDepth).toBe(0);
    expect(log.entries.map((recorded) => pagesOf(recorded))).toStrictEqual([[0], [9]]);
  });

  it('CONTROL: the ends are states, not errors', () => {
    const log = new CommandLog();
    expect(log.canUndo).toBe(false);
    expect(log.undo()).toBeUndefined();
    expect(log.redo()).toBeUndefined();

    log.record(entry(0));
    log.undo();
    expect(log.undo()).toBeUndefined();
    // "Nothing to undo" is what the UI asks constantly. Throwing would make
    // every caller wrap it.
    expect(log.entries).toStrictEqual([]);
  });
});

describe('CommandBus — capture, then checkpoint if it must, then apply', () => {
  it('records an INVERTIBLE entry when prior state can be captured', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      const { entry, version } = await bus.execute(session, context, rotateFirst);

      expect(entry.kind).toBe('invertible');
      expect(entry).toMatchObject({ inverse: [{ page: 0, prior: { present: false } }] });
      expect(version).toBe(2);
      expect(context.bumps()).toBe(1);
      expect(context.log.entries).toHaveLength(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE TERMINAL BRANCH: a malformed /Rotate gets a checkpoint, and the rotation still happens', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await malformedSession();
    const context = contextStub();
    try {
      const { entry } = await bus.execute(session, context, rotateFirst);

      expect(entry.kind).toBe('terminal');
      expect(entry).toMatchObject({ reason: /non-numeric \/Rotate/u });

      // The user asked for a rotation and got one. Refusing would lose function
      // over a byte they cannot see, with no route forward — ADR-0009's
      // 2026-08-19 decision, which is why this branch exists.
      const applied = await withDocument(session, (document) =>
        document.loadPage(0).getObject().get('Rotate').asNumber(),
      );
      expect(applied).toBe(90);
      expect(context.bumps()).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  /**
   * §4's retention cap, enforced during a session rather than at `open`.
   *
   * The ceiling was consulted once, when a document arrived, and never again —
   * so checkpoints accumulated for the whole life of a session and the only
   * thing ever refused was the *next* open. These cases run against **real**
   * checkpoints from the malformed-`/Rotate` branch, because the whole subject
   * is byte counts and a fabricated checkpoint would be a number this file
   * chose.
   */
  describe('retention', () => {
    /**
     * A bus whose capture always declines, so every command records a terminal
     * entry with a **real** checkpoint from the shipped `serialise`.
     *
     * The malformed-`/Rotate` fixture cannot supply more than one: the first
     * rotation replaces the malformed value with a numeric one, so the second
     * command captures cleanly and records an invertible entry with no
     * checkpoint at all. A ceiling set from the first checkpoint is then never
     * crossed, and every case here passes by measuring nothing — which is how
     * they first ran.
     */
    const alwaysCheckpointing = (): CommandBus =>
      new CommandBus({
        mupdf: {
          ...localMupdfWriter,
          capture: () =>
            Promise.resolve({ captured: false as const, reason: 'retention cases checkpoint' }),
        },
      });

    it('CONTROL: an ample ceiling keeps every checkpoint, and the trim reports nothing', async () => {
      const bus = alwaysCheckpointing();
      const session = await malformedSession();
      const context = contextStub();
      try {
        const first = await bus.execute(session, context, rotateFirst);
        const second = await bus.execute(session, context, rotateFirst);

        // Without this the shedding case below is satisfied by a bus that
        // discards every checkpoint it takes, which passes a "the log shrank"
        // assertion perfectly and is the opposite of the feature.
        expect(first.trimmed).toEqual({ droppedEntries: 0, droppedBytes: 0 });
        expect(second.trimmed).toEqual({ droppedEntries: 0, droppedBytes: 0 });
        expect(context.mutableLog.entries).toHaveLength(2);
        expect(context.mutableLog.canUndo).toBe(true);
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('sheds the oldest checkpoint when the next command crosses the ceiling', async () => {
      const bus = alwaysCheckpointing();
      const session = await malformedSession();
      const context = contextStub();
      try {
        const first = await bus.execute(session, context, rotateFirst);
        if (first.entry.kind !== 'terminal') throw new Error('expected a terminal entry');

        // THE CEILING IS SET FROM WHAT WAS MEASURED, not chosen: one checkpoint
        // fits and two do not. A literal here would be a number that stops
        // separating anything the day the fixture changes size.
        context.ceiling(first.entry.checkpoint.byteLength);

        const second = await bus.execute(session, context, rotateFirst);

        expect(second.trimmed.droppedEntries).toBe(1);
        expect(second.trimmed.droppedBytes).toBe(first.entry.checkpoint.byteLength);
        // AND THE LOG IS ACTUALLY UNDER IT. Reporting a drop and retaining the
        // bytes is the failure a report-only assertion cannot see.
        expect(context.mutableLog.retainedBytes()).toBeLessThanOrEqual(
          first.entry.checkpoint.byteLength,
        );
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('shortens UNDO by exactly what it dropped, rather than leaving a history nothing can walk', async () => {
      const bus = alwaysCheckpointing();
      const session = await malformedSession();
      const context = contextStub();
      try {
        const first = await bus.execute(session, context, rotateFirst);
        if (first.entry.kind !== 'terminal') throw new Error('expected a terminal entry');
        await bus.execute(session, context, rotateFirst);
        expect(context.mutableLog.entries).toHaveLength(2);

        context.ceiling(first.entry.checkpoint.byteLength);
        await bus.execute(session, context, rotateFirst);

        // TWO went, not one: a terminal entry is terminal for not being
        // invertible, so undo cannot step over the second checkpoint either
        // once the first is gone — and an entry undo cannot reach is a
        // `canUndo` that lies rather than a history worth keeping.
        expect(context.mutableLog.entries.length).toBeLessThan(3);
        expect(context.mutableLog.entries.length).toBe(
          context.mutableLog.retainedBytes() > 0 ? 1 : 0,
        );
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('is asked on EVERY command, so the cap cannot be crossed between checks', async () => {
      const bus = new CommandBus({ mupdf: localMupdfWriter });
      const session = await malformedSession();
      const context = contextStub();
      try {
        await bus.execute(session, context, rotateFirst);
        await bus.execute(session, context, rotateFirst);
        await bus.execute(session, context, rotateFirst);

        // ASSERT THE CALL, not the state. Three commands under an ample ceiling
        // leave a log that looks identical whether retention was enforced three
        // times or never — which is `§4`'s *"every N commands"* having no N,
        // stated as a test: N is 1, and nothing else can say so.
        expect(context.trims()).toBe(3);
      } finally {
        await mupdfWriter.close(session);
      }
    });

    /**
     * A redo tail that holds no checkpoint reclaims nothing, so shedding it is
     * pure loss — and a shedding loop keyed on bytes alone empties it anyway,
     * because popping an invertible entry never moves the figure the loop tests.
     * That is what the first draft of `trimTo` did.
     *
     * This is the reachable half of the tail rule. The other half — a tail
     * holding a checkpoint being shed before applied history — cannot be
     * produced by any code in this repository: a checkpoint reaches the tail
     * only by undoing a terminal entry, and `undo` throws
     * `CheckpointRestoreNotBuiltError` for exactly that (invariant 18 clause
     * (ii)). The branch is kept unbuilt-but-correct rather than deleted, for
     * JJJ-1's reason.
     */
    it('leaves a checkpoint-free REDO tail alone while shedding applied history', async () => {
      const bus = new CommandBus({ mupdf: localMupdfWriter });
      const session = await malformedSession();
      const context = contextStub();
      try {
        // The malformed `/Rotate` makes the FIRST command terminal and repairs
        // itself, so the second is invertible — which is the only shape that
        // can put an entry in the redo tail today.
        const first = await bus.execute(session, context, rotateFirst);
        if (first.entry.kind !== 'terminal') throw new Error('expected a terminal entry');
        const second = await bus.execute(session, context, rotateFirst);
        expect(second.entry.kind).toBe('invertible');

        await bus.undo({ mupdf: session }, context, noRestoreExpected);
        expect(context.mutableLog.canRedo).toBe(true);

        context.mutableLog.trimTo(0);

        // The checkpoint went, because it was the only thing holding bytes.
        expect(context.mutableLog.retainedBytes()).toBe(0);
        // AND THE TAIL SURVIVED. A loop that popped it would satisfy every
        // byte-count assertion above while destroying redo for nothing.
        expect(context.mutableLog.canRedo).toBe(true);
      } finally {
        await mupdfWriter.close(session);
      }
    });

    /**
     * The other half of the tail rule, **unreachable until 2026-09-04**.
     *
     * A checkpoint reaches the redo tail only by undoing a terminal entry, and
     * `undo` used to refuse exactly that — so this branch was kept as a correct
     * unbuilt one for JJJ-1's reason, with a control asserting the refusal.
     * ADR-0037 built the restore, the state is now ordinary, and the branch
     * therefore owes a case rather than a comment.
     *
     * **The mutation this separates:** a front-first shedding walk. It empties
     * the byte figure just as well, and it does it by discarding the applied
     * history the user is standing on while keeping speculative entries behind
     * them. Both assertions below are needed — `canRedo` alone passes for a walk
     * that shed nothing at all.
     */
    it('sheds a checkpoint-bearing REDO tail before it touches applied history', async () => {
      const bus = alwaysCheckpointing();
      const session = await malformedSession();
      const context = contextStub();
      const supervisor = restoreStub();
      try {
        const first = await bus.execute(session, context, rotateFirst);
        const second = await bus.execute(session, context, rotateFirst);
        if (first.entry.kind !== 'terminal' || second.entry.kind !== 'terminal') {
          throw new Error('expected two terminal entries');
        }

        // THE UNDO IS WHAT PUTS A CHECKPOINT IN THE TAIL, and it is the step
        // that could not be taken before the restore existed.
        await bus.undo({ mupdf: session }, context, supervisor.restore);
        expect(context.mutableLog.redoDepth).toBe(1);
        expect(context.mutableLog.entries).toHaveLength(1);

        // FROM WHAT WAS MEASURED, not chosen: room for exactly the applied
        // entry's checkpoint, so one of the two has to go and only one.
        context.mutableLog.trimTo(first.entry.checkpoint.byteLength);

        expect(context.mutableLog.canRedo).toBe(false);
        expect(context.mutableLog.entries).toHaveLength(1);
        expect(context.mutableLog.retainedBytes()).toBe(first.entry.checkpoint.byteLength);
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('stops rather than deleting undo when nothing document-scaled is left to shed', () => {
      // An invertible-only log holds no checkpoints, so a ceiling of zero
      // cannot be met by shedding. Deleting the history anyway would be a
      // guard answering a question nobody asked with the user's work.
      const log = new CommandLog();
      log.record({
        kind: 'invertible',
        command: rotateFirst,
        inverse: [{ page: 0, prior: { present: false } }],
      });

      expect(log.trimTo(0)).toEqual({ droppedEntries: 0, droppedBytes: 0 });
      expect(log.canUndo).toBe(true);
    });
  });

  it('and the checkpoint holds the document as it was BEFORE apply', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await malformedSession();
    try {
      const { entry } = await bus.execute(session, contextStub(), rotateFirst);
      if (entry.kind !== 'terminal') throw new Error('expected a terminal entry');

      // Not "a checkpoint exists" — that passes for an empty buffer taken at
      // the wrong moment. The bytes must restore the PRE-command document, and
      // the malformed value is what proves the ordering: it is gone from the
      // live session and present in the checkpoint.
      expect(await ownRotationIn(entry.checkpoint)).toBe('/Landscape');
      expect(entry.checkpoint.byteLength).toBeGreaterThan(500);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: an invertible execution takes NO checkpoint', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    try {
      const { entry } = await bus.execute(session, contextStub(), rotateFirst);
      // Without this, "the bus checkpoints when capture fails" is satisfied by a
      // bus that checkpoints unconditionally — which is the memory behaviour
      // §4 rejected, wearing a passing test.
      expect(entry).not.toHaveProperty('checkpoint');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: an unregistered writer refuses, applying nothing and logging nothing', async () => {
    const bus = new CommandBus({});
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      await expect(bus.execute(session, context, rotateFirst)).rejects.toThrow(
        UnregisteredWriterError,
      );
      const untouched = await withDocument(session, (document) =>
        document.loadPage(0).getObject().get('Rotate').isNull(),
      );
      expect(untouched).toBe(true);
      expect(context.log.entries).toStrictEqual([]);
      expect(context.bumps()).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a failing CAPTURE records nothing and does not bump the version', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    const outOfRange: Command = { kind: 'rotatePages', pages: [0, 99], quarterTurns: 1 };
    try {
      await expect(bus.execute(session, context, outOfRange)).rejects.toThrow(
        /outside this document/u,
      );
      // An entry for work that did not happen is worse than no entry: undo
      // would then reverse a change the document never received.
      expect(context.log.entries).toStrictEqual([]);
      expect(context.bumps()).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a failing CHECKPOINT records nothing and applies nothing', async () => {
    // The failure between capture and apply, which is the window the ordering
    // in `execute` exists to protect. A writer whose `serialise` throws is the
    // only way to reach it, and the rest of the writer must be the working one:
    // since ADR-0023 Decision 10 `apply` and `capture` come from the REGISTRY
    // too, so a stub carrying only a lifecycle would fail at the capture before
    // it ever reached the checkpoint, and this case would pass for the wrong
    // reason.
    const bus = new CommandBus({
      mupdf: {
        ...localMupdfWriter,
        serialise: () => Promise.reject(new Error('engine refused to serialise')),
      },
    });
    const session = await malformedSession();
    const context = contextStub();
    try {
      await expect(bus.execute(session, context, rotateFirst)).rejects.toThrow(
        /refused to serialise/u,
      );
      expect(context.log.entries).toStrictEqual([]);
      expect(context.bumps()).toBe(0);
      // And the document is untouched, because the checkpoint is taken before
      // apply rather than beside it.
      const applied = await withDocument(session, (document) =>
        document.loadPage(0).getObject().get('Rotate').toString(),
      );
      expect(applied).toBe('/Landscape');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('UNDO RESTORES THE LEAF TO INHERITING, not to declaring what it inherited', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      // Apply wrote to the leaf, so the page now declares 180 and no longer
      // tracks its branch.
      expect(await ownRotation(session, 0)).toBe(180);

      const undone = await bus.undo({ mupdf: session }, context, noRestoreExpected);

      // THE ASSERTION §3 EXISTS FOR, and it is STRUCTURAL. Restoring the value
      // that was showing — writing 90 back — renders identically and leaves the
      // leaf declaring what it used to inherit, so it silently stops tracking
      // its branch. Only `delete` restores the same document, and only reading
      // own-state can tell the two apart.
      expect(await ownRotation(session, 0)).toBeNull();
      expect(undone?.entry.kind).toBe('invertible');
      // Undo is an applied mutation (§5), so it bumps.
      expect(context.bumps()).toBe(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: and the page still SHOWS 90, so a rendering comparison would pass either way', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.undo({ mupdf: session }, context, noRestoreExpected);

      // The point of the control: the effective rotation after a correct undo
      // and after the WRONG one are identical. A test comparing rendered output
      // passes on the implementation §3 forbids — *an inverse that restores the
      // rendering is not an inverse*.
      const effective = await withDocument(session, (document) =>
        document.loadPage(0).getObject().getInheritable('Rotate').asNumber(),
      );
      expect(effective).toBe(90);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('UNDO RESTORES A RAW VALUE VERBATIM — 45 and -90 come back unnormalised', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      await withDocument(session, (document) => {
        document.loadPage(0).getObject().put('Rotate', 45);
        document.loadPage(1).getObject().put('Rotate', -90);
      });
      await bus.execute(session, context, { kind: 'rotatePages', pages: [0, 1], quarterTurns: 1 });
      expect(await ownRotation(session, 0)).toBe(180);
      expect(await ownRotation(session, 1)).toBe(0);

      await bus.undo({ mupdf: session }, context, noRestoreExpected);

      // Forward NORMALISES; the inverse restores VERBATIM. If prior state were
      // typed as a quarter turn these would come back as 90 and 270 — silently
      // rewriting a document that arrived carrying values MuPDF keeps and
      // documents in the wild have.
      expect(await ownRotation(session, 0)).toBe(45);
      expect(await ownRotation(session, 1)).toBe(-90);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('survives a round trip after undo, read back by a DIFFERENT library', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.undo({ mupdf: session }, context, noRestoreExpected);
      const written = await mupdfWriter.serialise(session);

      // pdf-lib resolves inheritance the way a reader does, so this asserts the
      // restored document is the one that was there — not merely that MuPDF
      // agrees with itself about it.
      const reopened = await PDFDocument.load(written, { updateMetadata: false });
      expect(reopened.getPage(0).getRotation().angle).toBe(90);
      expect(reopened.getPage(1).getRotation().angle).toBe(90);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('redo re-applies, and undo then redo is a round trip through the cursor', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.undo({ mupdf: session }, context, noRestoreExpected);
      expect(context.log.redoDepth).toBe(1);

      await bus.redo({ mupdf: session },context);

      expect(await ownRotation(session, 0)).toBe(180);
      expect(context.log.redoDepth).toBe(0);
      expect(context.log.entries).toHaveLength(1);
      // Three applied mutations: the command, the undo, the redo.
      expect(context.bumps()).toBe(3);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  /**
   * Undo of a terminal entry, and the assertion is on **the call**, not on the
   * state.
   *
   * The state a correct restore leaves behind, in this file, is the state an
   * absent restore leaves behind: the bus never touches the session on this
   * path — the supervisor swaps it — so `ownRotation` reads 90 either way. A
   * case asserting the document afterwards would pass with the whole mechanism
   * deleted, which is the shape `docs/JOURNAL.md` names as *a decision asserted
   * by its end state*.
   *
   * So what is asserted is what the bus **chose**: it handed the supervisor a
   * writer, and that writer produced exactly this entry's checkpoint. Three
   * mutations redden it and nothing else does — restoring the wrong entry's
   * checkpoint, restoring without calling the writer, and reverting to the old
   * refusal.
   */
  it('undoing a TERMINAL entry restores THAT entry’s checkpoint through the supervisor', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await malformedSession();
    const context = contextStub();
    const supervisor = restoreStub();
    try {
      const executed = await bus.execute(session, context, rotateFirst);
      if (executed.entry.kind !== 'terminal') throw new Error('expected a terminal entry');
      expect(await ownRotation(session, 0)).toBe(90);

      const undone = await bus.undo({ mupdf: session }, context, supervisor.restore);

      expect(supervisor.calls()).toHaveLength(1);
      // THE BYTES, compared against the entry's own checkpoint rather than
      // against a length. A bus that restored a different entry's checkpoint
      // would satisfy a byte-count assertion whenever the two happened to
      // serialise to the same size, which for two rotations of one fixture is
      // exactly what happens.
      expect(context.written()).toHaveLength(1);
      expect(context.written()[0]?.bytes).toStrictEqual(executed.entry.checkpoint);
      expect(context.written()[0]?.destination).toBe(supervisor.calls()[0]?.destination);

      // The cursor stepped exactly once and the version moved, which is what
      // separates a restore from a refusal that happened to leave things alone.
      expect(undone?.entry.kind).toBe('terminal');
      expect(context.log.entries).toHaveLength(0);
      expect(context.log.canRedo).toBe(true);
      expect(context.bumps()).toBe(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  /**
   * The restore's failure is the log's failure too.
   *
   * A supervisor that cannot rebuild leaves the document holding the session it
   * had, so a cursor that stepped anyway would put the log and the document in
   * different states — silently, and in the direction where undo appears to
   * have worked.
   */
  it('CONTROL: a restore that throws leaves the cursor and the version alone', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await malformedSession();
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);

      await expect(
        bus.undo({ mupdf: session }, context, () => {
          throw new Error('the host would not rebuild');
        }),
      ).rejects.toThrow(/would not rebuild/u);

      expect(context.log.entries).toHaveLength(1);
      expect(context.log.canRedo).toBe(false);
      expect(context.bumps()).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: undo at the start of the log is a state, not an error', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    try {
      expect(
        await bus.undo({ mupdf: session }, contextStub(), noRestoreExpected),
      ).toBeUndefined();
      expect(await bus.redo({ mupdf: session },contextStub())).toBeUndefined();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a new command through the bus truncates the redo tail', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    // ONE context, because one context is one document's log. This test used a
    // fresh stub per call and passed, which it could only do while the log lived
    // on the bus and was therefore shared across every document — the defect the
    // composition decision removed. Three stubs now means three logs and the
    // assertions below would be meaningless.
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.execute(session, context, rotateFirst);
      context.mutableLog.undo();
      expect(context.log.redoDepth).toBe(1);

      await bus.execute(session, context, rotateFirst);
      expect(context.log.redoDepth).toBe(0);
      expect(context.log.entries).toHaveLength(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: two documents have two logs, so undo cannot cross between them', async () => {
    const bus = new CommandBus({ mupdf: localMupdfWriter });
    const session = await mupdfWriter.open(flat);
    const first = contextStub();
    const second = contextStub();
    try {
      await bus.execute(session, first, rotateFirst);
      await bus.execute(session, second, rotateFirst);

      // The reason the log is on the record rather than on an application-wide
      // bus. A shared log would report two entries on both and let undo on one
      // document walk the other's — which is the cross-document corruption the
      // per-document store rule makes unrepresentable by shape.
      expect(first.log.entries).toHaveLength(1);
      expect(second.log.entries).toHaveLength(1);

      await bus.undo({ mupdf: session }, first, noRestoreExpected);
      expect(first.log.canUndo).toBe(false);
      expect(second.log.canUndo).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

/**
 * ADR-0023 Decision 10 — the bus asks the REGISTERED WRITER to run a command,
 * rather than calling the declared spec itself.
 *
 * Every case here substitutes one member of the registered writer and asserts
 * two things: that the substitute ran, **and** that the declared spec's own
 * function did not run as well. One assertion alone would not separate the
 * defect — a bus that called both would satisfy the first, and a bus that
 * called only the spec would fail both for the same reason without saying
 * which.
 *
 * The fixture is the `flat` document, deliberately, because its real capture
 * SUCCEEDS. A malformed one produces a terminal entry either way, so a case
 * built on it would pass whether or not the substitution took effect — the
 * fixture the defect also handles correctly.
 */
describe('CommandBus — execution goes through the registered writer (ADR-0023 Decision 10)', () => {
  /** The page's `/Rotate`, or `null` where the key is absent. */
  const rotationOf = (session: MupdfSession): Promise<number | null> =>
    withDocument(session, (document) => {
      const rotate = document.loadPage(0).getObject().get('Rotate');
      return rotate.isNull() ? null : rotate.asNumber();
    });

  it('THE CONTROL: a substituted APPLY runs, and the declared one does not', async () => {
    const applied: Command[] = [];
    const bus = new CommandBus({
      mupdf: {
        ...localMupdfWriter,
        apply: (_session, command) => {
          applied.push(command);
          return Promise.resolve();
        },
      },
    });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      const { entry } = await bus.execute(session, context, rotateFirst);

      // The registry's apply received the command.
      expect(applied).toStrictEqual([rotateFirst]);
      // And the spec's did not also run: a bus still calling `spec.apply` would
      // leave 90 here while `applied` stayed empty.
      expect(await rotationOf(session)).toBeNull();

      // The bus's OWN path is untouched by the move — it still captures first,
      // records, and bumps.
      expect(entry.kind).toBe('invertible');
      expect(context.log.entries).toHaveLength(1);
      expect(context.bumps()).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE CONTROL: a substituted CAPTURE decides the entry', async () => {
    const bus = new CommandBus({
      mupdf: {
        ...localMupdfWriter,
        capture: () =>
          Promise.resolve({ captured: false as const, reason: 'the registered capture ran' }),
      },
    });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      const { entry } = await bus.execute(session, context, rotateFirst);

      // `flat`'s declared capture succeeds, so a bus calling the spec would
      // record an INVERTIBLE entry here. The reason string is one only the
      // substitute produces.
      expect(entry.kind).toBe('terminal');
      expect(entry).toMatchObject({ reason: 'the registered capture ran' });

      // The checkpoint still came from the registry's `serialise`, and apply
      // still happened — the capture moved, not the ordering around it.
      expect(await rotationOf(session)).toBe(90);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE CONTROL: undo inverts through the registry, and the kind travels with it', async () => {
    const inverted: { kind: string; inverse: unknown }[] = [];
    const real = new CommandBus({ mupdf: localMupdfWriter });
    const substituted = new CommandBus({
      mupdf: {
        ...localMupdfWriter,
        invert: (_session, kind, inverse) => {
          inverted.push({ kind, inverse });
          return Promise.resolve();
        },
      },
    });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      // Two buses over one context, which the bus being stateless is what makes
      // legal: the log lives on the record, so the setup and the act can use
      // different registries.
      await real.execute(session, context, rotateFirst);
      expect(await rotationOf(session)).toBe(90);

      await substituted.undo({ mupdf: session }, context, noRestoreExpected);

      // A recorded inverse carries no kind, so `invert` takes one — the
      // asymmetry with `apply` that `CommandExecution` states.
      expect(inverted).toStrictEqual([
        { kind: 'rotatePages', inverse: [{ page: 0, prior: { present: false } }] },
      ]);
      // The declared invert did not also run: it would have deleted the key.
      expect(await rotationOf(session)).toBe(90);
      expect(context.log.canUndo).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE CONTROL: redo re-applies through the registry', async () => {
    const applied: Command[] = [];
    const real = new CommandBus({ mupdf: localMupdfWriter });
    const substituted = new CommandBus({
      mupdf: {
        ...localMupdfWriter,
        apply: (_session, command) => {
          applied.push(command);
          return Promise.resolve();
        },
      },
    });
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      await real.execute(session, context, rotateFirst);
      await real.undo({ mupdf: session }, context, noRestoreExpected);
      expect(await rotationOf(session)).toBeNull();

      await substituted.redo({ mupdf: session }, context);

      expect(applied).toStrictEqual([rotateFirst]);
      // The declared apply did not also run: it would have written 90 back.
      expect(await rotationOf(session)).toBeNull();
      expect(context.log.canUndo).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: undo through an UNREGISTERED writer refuses by name', async () => {
    const real = new CommandBus({ mupdf: localMupdfWriter });
    const empty = new CommandBus({});
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      await real.execute(session, context, rotateFirst);

      // Reachable independently of `execute`'s refusal: ADR-0009 puts the log
      // on the document's record and the registry on the bus, so a log can
      // outlive the registration that produced it. Without the guard this is a
      // property access on `undefined`, which is a TypeError rather than a
      // named refusal — so the error CLASS is what separates the two.
      await expect(
        empty.undo({ mupdf: session }, context, noRestoreExpected),
      ).rejects.toThrow(UnregisteredWriterError);

      // And nothing moved.
      expect(await rotationOf(session)).toBe(90);
      expect(context.log.canUndo).toBe(true);
      expect(context.bumps()).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: redo through an UNREGISTERED writer refuses by name', async () => {
    const real = new CommandBus({ mupdf: localMupdfWriter });
    const empty = new CommandBus({});
    const session = await mupdfWriter.open(flat);
    const context = contextStub();
    try {
      await real.execute(session, context, rotateFirst);
      await real.undo({ mupdf: session }, context, noRestoreExpected);

      await expect(empty.redo({ mupdf: session }, context)).rejects.toThrow(UnregisteredWriterError);

      expect(await rotationOf(session)).toBeNull();
      expect(context.log.canRedo).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
