import type { CommandOfKind } from '@monstera/contract';

import type { CaptureResult } from './commandLog.js';
import type { ByteImage } from './engineSeam.js';
import {
  type ObjectMatrix,
  objectMatrix,
  pageObjects,
  pdfiumWriter,
  placeObject,
  removeObjects,
  setObjectFills,
  setObjectMatrix,
} from './pdfiumFfi.js';

/**
 * Object-level editing, as the bus calls it: **move, resize, recolour, remove**.
 *
 * ## Its own module beside `pdfiumTextEdit.ts`, not inside it
 *
 * Both are PDFium byte-image commands and both open per call, so the temptation
 * is one file. What separates them is the walk they are about: that one is
 * about a text object's *string*, this one about any object's *placement and
 * paint*. A single module would be the file every future PDFium command lands
 * in by default, which is how a module acquires two jobs and then four.
 *
 * ## Every function here OPENS, which is ADR-0047's shape rather than waste
 *
 * `pdfiumTextEdit.ts`'s note applies unchanged: PDFium is a byte-image writer
 * of record, so what the bus hands each of these is the document's current
 * bytes and what an apply answers is new bytes. `FPDF_LoadMemDocument` is
 * 0.1–3.5 ms against a `FPDFPage_GenerateContent` that is the whole cost of an
 * edit, so a second open is inside the noise of the operation it belongs to.
 *
 * ## Every session opened here is closed here, on every path
 *
 * A `PdfiumSession` holds a native document and the bytes it is still reading.
 * A throw that skipped the close would leak both in a process whose memory a
 * job object bounds, so each function is a `try`/`finally` around one session.
 */

/** What a placement has to put back: the object's own matrix, and which object. */
export interface PriorPlacement {
  readonly page: number;
  readonly index: number;
  readonly matrix: ObjectMatrix;
}

/** What a recolour has to put back: one fill per object it changed. */
export interface PriorFills {
  readonly page: number;
  readonly objects: readonly {
    readonly index: number;
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
  }[];
}

/**
 * Runs `work` against a session opened from `image`, closing it however it ends.
 *
 * `pdfiumTextEdit.ts` has the same four lines and they are not shared: sharing
 * them would put an import edge between two modules that have no other reason
 * to know about each other, and the shared thing would be a `try`/`finally`.
 */
async function onImage<T>(
  image: ByteImage,
  work: (session: Awaited<ReturnType<typeof pdfiumWriter.open>>) => Promise<T>,
): Promise<T> {
  const session = await pdfiumWriter.open(image);
  try {
    return await work(session);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * The object's matrix before the placement is applied.
 *
 * `captured: false` where the index names no object, which is what the bus
 * answers by taking a checkpoint and applying anyway (ADR-0009's 2026-08-19
 * decision) — the apply refuses the same input a moment later with the
 * adapter's own message, and reporting it twice would be two opinions about one
 * refusal.
 */
export async function capturePlacePageObject(
  image: ByteImage,
  command: CommandOfKind<'placePageObject'>,
): Promise<CaptureResult<PriorPlacement>> {
  return onImage(image, async (session) => {
    try {
      const matrix = await objectMatrix(session, command.page, command.index);
      return { captured: true, prior: { page: command.page, index: command.index, matrix } };
    } catch {
      return {
        captured: false,
        reason:
          `page ${String(command.page)} object ${String(command.index)} is not an object this ` +
          'document has, or PDFium would not describe its placement, so there is nothing to record',
      };
    }
  });
}

/** Moves and resizes the named object, and answers the document's new bytes. */
export async function applyPlacePageObject(
  image: ByteImage,
  command: CommandOfKind<'placePageObject'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await placeObject(session, command.page, command.index, {
      moveBy: command.moveBy,
      scaleBy: command.scaleBy,
    });
    return pdfiumWriter.serialise(session);
  });
}

/**
 * Puts the recorded matrix back, and answers the document's new bytes.
 *
 * Reads nothing off a command — the prior carries page, index and matrix, which
 * is the whole restoring instruction (ADR-0009 §3). And it is a RESTORE rather
 * than an opposite transform: measured 2026-09-10, `setObjectMatrix` of the
 * matrix read before returns the bounds exactly, where composing an inverse
 * transform accumulates floating-point drift over repeated undo and redo.
 */
export async function invertPlacePageObject(
  image: ByteImage,
  inverse: PriorPlacement,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await setObjectMatrix(session, inverse.page, inverse.index, inverse.matrix);
    return pdfiumWriter.serialise(session);
  });
}

/**
 * The fills of every object a recolour names.
 *
 * Read through `pageObjects` — one walk for the whole page — rather than one
 * call per index. The walk is what the read channel uses too, so there is one
 * answer to *what colour is this object* rather than two.
 *
 * ## An object PDFium will not describe refuses the WHOLE capture
 *
 * `pageObjects` answers `fill: null` where `FPDFPageObj_GetFillColor` declines,
 * and a prior of *no colour* is not a colour to put back. Capturing the rest
 * would produce an inverse that restored some of the objects a person
 * recoloured, leaving a state they never saw — `captureReplaceTextObject`'s
 * all-or-nothing rule on a second axis.
 */
export async function captureRecolorPageObjects(
  image: ByteImage,
  command: CommandOfKind<'recolorPageObjects'>,
): Promise<CaptureResult<PriorFills>> {
  return onImage(image, async (session) => {
    const objects = await pageObjects(session, command.page).catch(() => null);
    if (objects === null) {
      return {
        captured: false,
        reason: `page ${String(command.page)} is not a page this document has`,
      };
    }
    const priors: PriorFills['objects'][number][] = [];
    for (const index of command.indices) {
      const found = objects.find((object) => object.index === index);
      if (found?.fill === undefined || found.fill === null) {
        return {
          captured: false,
          reason:
            `page ${String(command.page)} object ${String(index)} has no fill colour PDFium will ` +
            'describe, so there is nothing to put back',
        };
      }
      priors.push({ index, ...found.fill });
    }
    return { captured: true, prior: { page: command.page, objects: priors } };
  });
}

/** Recolours the named objects, and answers the document's new bytes. */
export async function applyRecolorPageObjects(
  image: ByteImage,
  command: CommandOfKind<'recolorPageObjects'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    // ONE CALL FOR THE WHOLE LIST, which is where the cost is: generation is
    // per call and 13.7× over forty objects when paid per object (ADR-0047
    // Decision 2). The colour is shared, so this is a map and not a merge.
    await setObjectFills(
      session,
      command.page,
      command.indices.map((index) => ({ index, ...command.colour })),
    );
    return pdfiumWriter.serialise(session);
  });
}

/** Puts the recorded fills back, and answers the document's new bytes. */
export async function invertRecolorPageObjects(
  image: ByteImage,
  inverse: PriorFills,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await setObjectFills(session, inverse.page, inverse.objects);
    return pdfiumWriter.serialise(session);
  });
}

/**
 * Removes the named objects, and answers the document's new bytes.
 *
 * **No capture and no invert**, and the declaration says the same thing: PDFium
 * offers no way to reconstruct a page object from a description, so there is no
 * prior a capture could hold. Undo takes a checkpoint. That is a fact about the
 * library rather than a choice about the log, which is why it is stated in both
 * places.
 */
export async function applyDeletePageObjects(
  image: ByteImage,
  command: CommandOfKind<'deletePageObjects'>,
): Promise<ByteImage> {
  return onImage(image, async (session) => {
    await removeObjects(session, command.page, command.indices);
    return pdfiumWriter.serialise(session);
  });
}

/**
 * Says why a removal has no prior, so the bus takes a checkpoint.
 *
 * `captureFlattenFormFields`' shape and NOT its reason, which is worth the
 * distinction: that one refuses because the prior is unbounded — every widget
 * in the document, every content stream rewritten. This one refuses because
 * there is no prior at all. PDFium can describe an object and cannot rebuild
 * one from a description, so *what was there* is not a thing this engine can
 * hand back however small it might have been.
 *
 * A refusal rather than an absent function: `CommandSpec` requires the slot for
 * every kind, and `CommandPrior.deletePageObjects` is `never`, so the type is
 * what stops anyone constructing an argument for the invert below.
 */
export function captureDeletePageObjects(): Promise<CaptureResult<never>> {
  return Promise.resolve({
    captured: false,
    reason:
      'a removed page object cannot be recorded as prior state: PDFium can describe an object ' +
      'and cannot rebuild one from a description, so there is nothing an inverse could put back',
  });
}

/**
 * Unreachable, and required by {@link CommandSpec}'s shape.
 *
 * `invertFlattenFormFields`' reason exactly: `CommandPrior` is `never` here, so
 * nothing can construct an argument, and throwing rather than resolving keeps a
 * widened type from landing as an undo that did nothing.
 */
export function invertDeletePageObjects(): Promise<ByteImage> {
  throw new Error(
    'a removed page object has no inverse; undo restores the checkpoint the bus took (ADR-0037)',
  );
}
