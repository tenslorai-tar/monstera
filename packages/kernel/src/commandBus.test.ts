import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type Command, type CommandOfKind } from '@monstera/contract';
import { type DocVersion, asDocVersion } from '@monstera/shared';

import {
  CheckpointRestoreNotBuiltError,
  CommandBus,
  UnregisteredWriterError,
} from './commandBus.js';
import { CommandLog, type LogEntry } from './commandLog.js';
import { type CommandWriter, type DocumentContext } from './documentService.js';
import { type ByteImage, type MupdfSession } from './engineSeam.js';
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
  /** The same log, reachable without minting a capability inside a test. */
  readonly mutableLog: CommandLog;
} {
  let version = asDocVersion(1);
  let bumps = 0;
  const log = new CommandLog();
  return {
    mutableLog: log,
    docId: 'stub' as DocumentContext['docId'],
    path: 'stub',
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
  function entry(page: number): LogEntry {
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

    expect(undone?.command.pages).toStrictEqual([1]);
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

    expect(log.redo()?.command.pages).toStrictEqual([0]);
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
    expect(log.entries.map((e) => e.command.pages)).toStrictEqual([[0], [9]]);
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
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

  it('and the checkpoint holds the document as it was BEFORE apply', async () => {
    const bus = new CommandBus({ mupdf: mupdfWriter });
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
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
    // only way to reach it — `apply` comes from the spec, not the registry.
    const bus = new CommandBus({
      mupdf: {
        open: mupdfWriter.open.bind(mupdfWriter),
        close: mupdfWriter.close.bind(mupdfWriter),
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      // Apply wrote to the leaf, so the page now declares 180 and no longer
      // tracks its branch.
      expect(await ownRotation(session, 0)).toBe(180);

      const undone = await bus.undo(session, context);

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
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.undo(session, context);

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
    const bus = new CommandBus({ mupdf: mupdfWriter });
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

      await bus.undo(session, context);

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
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.undo(session, context);
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await inheritingSession(90);
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      await bus.undo(session, context);
      expect(context.log.redoDepth).toBe(1);

      await bus.redo(session, context);

      expect(await ownRotation(session, 0)).toBe(180);
      expect(context.log.redoDepth).toBe(0);
      expect(context.log.entries).toHaveLength(1);
      // Three applied mutations: the command, the undo, the redo.
      expect(context.bumps()).toBe(3);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: undoing a TERMINAL entry is refused by name, and changes nothing', async () => {
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await malformedSession();
    const context = contextStub();
    try {
      await bus.execute(session, context, rotateFirst);
      expect(await ownRotation(session, 0)).toBe(90);

      await expect(bus.undo(session, context)).rejects.toThrow(CheckpointRestoreNotBuiltError);

      // Refused rather than half-done: the cursor has not moved and the
      // document is untouched. A checkpoint restore opens a NEW session from
      // those bytes, which is a question about session ownership rather than
      // about this bus.
      expect(context.log.entries).toHaveLength(1);
      expect(await ownRotation(session, 0)).toBe(90);
      expect(context.bumps()).toBe(1);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: undo at the start of the log is a state, not an error', async () => {
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await mupdfWriter.open(flat);
    try {
      expect(await bus.undo(session, contextStub())).toBeUndefined();
      expect(await bus.redo(session, contextStub())).toBeUndefined();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a new command through the bus truncates the redo tail', async () => {
    const bus = new CommandBus({ mupdf: mupdfWriter });
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
    const bus = new CommandBus({ mupdf: mupdfWriter });
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

      await bus.undo(session, first);
      expect(first.log.canUndo).toBe(false);
      expect(second.log.canUndo).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
