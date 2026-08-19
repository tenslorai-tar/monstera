import { PDFDocument } from '@cantoo/pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';

import { type CommandOfKind } from '@monstera/contract';

import { type ByteImage, type MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';
import { applyRotatePages, captureRotatePages, snapRotation } from './rotatePages.js';

/**
 * The first command, exercised end to end against a real engine.
 *
 * ADR-0009 §3 came out of running this command rather than reasoning about it,
 * so these run it too. Two things are asserted that a rendering comparison
 * cannot see, and both are the finding §3 records:
 *
 * - **structure, not appearance.** A page that inherited its rotation and a
 *   page that declares the same value render identically. Only the page tree
 *   tells them apart, so the assertions read `/Rotate` own-state rather than
 *   comparing output — *"an inverse that restores the rendering is not an
 *   inverse"*.
 * - **verbatim raw values.** `/Rotate 45` and `-90` exist in the wild and MuPDF
 *   keeps them, so capture must report what is there and not a tidied quarter
 *   turn.
 */

let flat: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  for (let index = 0; index < 4; index += 1) document.addPage([612, 792]);
  flat = await document.save();
});

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

describe('rotatePages — capture reads OWN state (ADR-0009 §3)', () => {
  it('reports ABSENCE for a page that inherits its rotation', async () => {
    const session = await inheritingSession(90);
    try {
      const prior = await captureRotatePages(session, {
        kind: 'rotatePages',
        pages: [0],
        quarterTurns: 1,
      });
      // Not `{ present: true, raw: 90 }`. The page shows 90 and declares
      // nothing, and only the second fact makes the inverse a delete.
      expect(prior).toStrictEqual({
        captured: true,
        prior: [{ page: 0, prior: { present: false } }],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: and reports the value for a page that declares one, so absence is a finding', async () => {
    const session = await inheritingSession(90);
    try {
      await withDocument(session, (document) => {
        document.loadPage(0).getObject().put('Rotate', 180);
      });
      const prior = await captureRotatePages(session, {
        kind: 'rotatePages',
        pages: [0],
        quarterTurns: 1,
      });
      expect(prior).toStrictEqual({
        captured: true,
        prior: [{ page: 0, prior: { present: true, raw: 180 } }],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reports raw values VERBATIM, not snapped to a quarter turn', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      await withDocument(session, (document) => {
        document.loadPage(0).getObject().put('Rotate', 45);
        document.loadPage(1).getObject().put('Rotate', -90);
        document.loadPage(2).getObject().put('Rotate', 450);
      });
      const prior = await captureRotatePages(session, {
        kind: 'rotatePages',
        pages: [0, 1, 2],
        quarterTurns: 1,
      });
      // 45 does not become 90 here even though the engine renders it as 90.
      // Forward normalises; the inverse restores verbatim, and this is the read
      // the inverse will be built from.
      expect(prior).toStrictEqual({
        captured: true,
        prior: [
          { page: 0, prior: { present: true, raw: 45 } },
          { page: 1, prior: { present: true, raw: -90 } },
          { page: 2, prior: { present: true, raw: 450 } },
        ],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('is not consumed by apply — the bus must capture FIRST', async () => {
    const session = await inheritingSession(90);
    const command: CommandOfKind<'rotatePages'> = {
      kind: 'rotatePages',
      pages: [0],
      quarterTurns: 1,
    };
    try {
      const before = await captureRotatePages(session, command);
      await applyRotatePages(session, command);
      const after = await captureRotatePages(session, command);

      // The whole reason capture is a separate step the bus runs before apply:
      // once apply has written to the leaf, the prior own-state is gone from
      // the document and no later read can recover it.
      expect(before).toStrictEqual({
        captured: true,
        prior: [{ page: 0, prior: { present: false } }],
      });
      expect(after).toStrictEqual({
        captured: true,
        prior: [{ page: 0, prior: { present: true, raw: 180 } }],
      });
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('rotatePages — apply', () => {
  it('writes to the LEAF, so an inheriting page stops inheriting', async () => {
    const session = await inheritingSession(90);
    try {
      expect(await ownRotation(session, 0)).toBeNull();
      await applyRotatePages(session, { kind: 'rotatePages', pages: [0], quarterTurns: 1 });

      // 90 inherited + one quarter turn. Written on the page itself, which is
      // correct — and exactly why the inverse must be able to DELETE the key
      // rather than write 90 back.
      expect(await ownRotation(session, 0)).toBe(180);
      // The branch is untouched, so its other pages still inherit.
      expect(await ownRotation(session, 1)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('rotates from what the user SEES, so a raw 45 turns to 180 rather than 135', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      await withDocument(session, (document) => {
        document.loadPage(0).getObject().put('Rotate', 45);
      });
      await applyRotatePages(session, { kind: 'rotatePages', pages: [0], quarterTurns: 1 });
      // MuPDF renders 45 as 90. Adding 90 to the raw value instead would write
      // 135, which the engine renders as 180 — the page would jump two turns.
      expect(await ownRotation(session, 0)).toBe(180);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('wraps at 360 and rotates every named page', async () => {
    const session = await inheritingSession(270);
    try {
      await applyRotatePages(session, { kind: 'rotatePages', pages: [1, 3], quarterTurns: 3 });
      expect(await ownRotation(session, 1)).toBe(180);
      expect(await ownRotation(session, 3)).toBe(180);
      expect(await ownRotation(session, 0)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('survives a round trip, read back by a DIFFERENT library', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      await applyRotatePages(session, { kind: 'rotatePages', pages: [2], quarterTurns: 2 });
      const written = await mupdfWriter.serialise(session);

      // pdf-lib, not MuPDF. A round trip verified by the engine that wrote it
      // proves the engine is self-consistent and nothing else.
      const reopened = await PDFDocument.load(written, { updateMetadata: false });
      expect(reopened.getPage(2).getRotation().angle).toBe(180);
      expect(reopened.getPage(0).getRotation().angle).toBe(0);
      expect(reopened.getPageCount()).toBe(4);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('rotatePages — snapRotation agrees with the ENGINE, not with a tidier rule', () => {
  const RAW = [0, 1, 44, 45, 46, 89, 90, 135, 179, 180, 269, 270, 315, 340, 359, 360, 450, -1, -90, -180, -270, -360, -450];

  it('matches the engine on every raw value, compared engine-to-engine', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      const disagreements = await withDocument(session, (document) => {
        /** The page transform the engine produces for a given raw /Rotate. */
        const transformFor = (value: number): string => {
          const object = document.loadPage(0).getObject();
          object.put('Rotate', value);
          return document
            .loadPage(0)
            .getTransform()
            .map((n) => Math.round(n))
            .join(',');
        };
        return RAW.filter((raw) => transformFor(raw) !== transformFor(snapRotation(raw))).map(
          (raw) => `${String(raw)} -> ${String(snapRotation(raw))}`,
        );
      });

      // No hardcoded matrices: the port's answer is fed back to the engine and
      // the two transforms are compared. A rule of our own devising that looked
      // reasonable — truncating instead of rounding, so 45 became 0 — would
      // fail here and pass any test written from the same assumption.
      expect(disagreements).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: the comparison can FAIL — the transform separates all four turns', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      const transforms = await withDocument(session, (document) => {
        return [0, 90, 180, 270].map((value) => {
          document.loadPage(0).getObject().put('Rotate', value);
          return document
            .loadPage(0)
            .getTransform()
            .map((n) => Math.round(n))
            .join(',');
        });
      });
      // Page bounds would collapse 0 with 180 and 90 with 270, which is an
      // instrument that cannot distinguish two of the values it exists to
      // compare. The transform gives four states.
      expect(new Set(transforms).size).toBe(4);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

describe('rotatePages — refusals leave the document untouched', () => {
  it('CONTROL: an out-of-range page refuses BEFORE writing any page', async () => {
    const session = await inheritingSession(90);
    try {
      await expect(
        applyRotatePages(session, { kind: 'rotatePages', pages: [0, 9], quarterTurns: 1 }),
      ).rejects.toThrow(/outside this document/);
      // Page 0 is valid and named first. Validating the whole set before the
      // first write is what stops a partly rotated document.
      expect(await ownRotation(session, 0)).toBeNull();
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a non-numeric /Rotate is NOT captured, and is not an exception either', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      await withDocument(session, (document) => {
        document.loadPage(0).getObject().put('Rotate', document.newName('Landscape'));
      });
      const result = await captureRotatePages(session, {
        kind: 'rotatePages',
        pages: [0],
        quarterTurns: 1,
      });

      // An ordinary outcome the bus answers with a checkpoint (ADR-0009,
      // 2026-08-19), not a refusal. It is a value in the type rather than a
      // throw, so the caller cannot fail to consider it.
      expect(result.captured).toBe(false);
      expect(result).toMatchObject({ reason: /non-numeric \/Rotate/u });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: an invalid COMMAND still throws — it is not routed around', async () => {
    const session = await mupdfWriter.open(flat);
    try {
      // A bad page index is the caller getting it wrong, not a document to
      // work around. Turning this into a checkpoint would hide a bug behind a
      // byte snapshot.
      await expect(
        captureRotatePages(session, { kind: 'rotatePages', pages: [99], quarterTurns: 1 }),
      ).rejects.toThrow(/outside this document/);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a forged session is refused before any page is loaded', async () => {
    const forged = { engine: 'mupdf' } as unknown as MupdfSession;
    await expect(
      applyRotatePages(forged, { kind: 'rotatePages', pages: [0], quarterTurns: 1 }),
    ).rejects.toThrow(/not produced by this adapter/);
  });
});
