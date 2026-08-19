import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type Command, type CommandOfKind } from '@monstera/contract';
import { type DocVersion, asDocVersion } from '@monstera/shared';

import { CommandBus, UnregisteredWriterError } from './commandBus.js';
import { CommandLog, type LogEntry } from './commandLog.js';
import { type DocumentContext } from './documentService.js';
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

/** A minimal lane context. The counter is §5's; the bus only bumps it. */
function contextStub(): DocumentContext & { readonly bumps: () => number } {
  let version = asDocVersion(1);
  let bumps = 0;
  return {
    docId: 'stub' as DocumentContext['docId'],
    path: 'stub',
    get version(): DocVersion {
      return version;
    },
    bumpVersion(): DocVersion {
      bumps += 1;
      version = asDocVersion(version + 1);
      return version;
    },
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
      expect(bus.log.entries).toHaveLength(1);
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
      expect(bus.log.entries).toStrictEqual([]);
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
      expect(bus.log.entries).toStrictEqual([]);
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
      expect(bus.log.entries).toStrictEqual([]);
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

  it('a new command through the bus truncates the redo tail', async () => {
    const bus = new CommandBus({ mupdf: mupdfWriter });
    const session = await mupdfWriter.open(flat);
    try {
      await bus.execute(session, contextStub(), rotateFirst);
      await bus.execute(session, contextStub(), rotateFirst);
      bus.log.undo();
      expect(bus.log.redoDepth).toBe(1);

      await bus.execute(session, contextStub(), rotateFirst);
      expect(bus.log.redoDepth).toBe(0);
      expect(bus.log.entries).toHaveLength(2);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
