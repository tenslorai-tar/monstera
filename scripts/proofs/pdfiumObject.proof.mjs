// @ts-check
/**
 * Object-level editing, as COMMANDS, against the real library.
 *
 * ## What this is, beside the two proofs either side of it
 *
 * `proof:pdfiumadapter`'s subject is the boundary — does `FPDFPageObj_Transform`
 * reach the saved bytes, is a bad index refused. `proof:pdfiumcommand`'s is the
 * text edit one layer up. This one is the same layer for the three object
 * commands, and its question is the wired-tools rule's kernel half: **does the
 * command produce the document effect, and does it survive a round trip?**
 *
 * Its own file rather than more cases in `pdfiumCommand.proof.mjs` because the
 * two answer different rows of `docs/FEATURES.md` — that one *in-place text
 * editing*, this one *object-level edit* — and a proof whose failure names one
 * row is a proof somebody can act on.
 *
 * ## Every case goes through `localPdfiumExecution`, which is the routing
 *
 * Nothing here calls an adapter function directly. A declaration whose `writer`
 * and whose spec table disagreed would be a refusal here rather than a green
 * proof about a function nothing dispatches to.
 *
 * ## And every reading comes from REOPENED bytes
 *
 * A getter answering what a setter was given proves nothing about what was
 * stored, and for these calls the risk is measured rather than theoretical:
 * without `FPDFPage_GenerateContent` a live session reports the edit and the
 * saved file does not have it.
 *
 * Usage: node scripts/proofs/pdfiumObject.proof.mjs [--require-pdfium]
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { PDFIUM_COMMAND, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the PDFium object-level edit commands',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

refuseStaleBuild(root, PDFIUM_COMMAND, 4);

const { openPdfium, pdfiumWriter, pageObjects, pageText } = await import(
  '../../packages/kernel/dist/pdfiumFfi.js'
);
const { localPdfiumExecution } = await import('../../packages/kernel/dist/pdfiumSpecs.js');
const { declaredCommands } = await import('../../packages/kernel/dist/commandDeclarations.js');

const FIRST = 'FIRST RUN stays exactly where it is';
const SECOND = 'SECOND RUN is the one that changes';

/**
 * A page with two text runs and one black rectangle away from the origin.
 *
 * The rectangle is at x=200, not at 0: a scale about the page's corner and a
 * scale about the object's own are indistinguishable for a shape sitting at the
 * origin, which is the fixture the bug also handles correctly.
 *
 * It is BLACK so that a recolour to red is a luminance change — the fidelity
 * comparator has read luminance since CCCCCC-3, so the row's *recolor* is
 * visible to an instrument this project already has.
 *
 * @returns {Promise<Uint8Array>}
 */
async function twoRunsAndARectangle() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(FIRST, { x: 30, y: 230, size: 11, font });
  page.drawRectangle({ x: 200, y: 100, width: 120, height: 40, color: rgb(0, 0, 0) });
  page.drawText(SECOND, { x: 30, y: 60, size: 11, font });
  return document.save();
}

/**
 * The case roster.
 *
 * `createRoster` rather than a total printed from what ran, because a total
 * computed over the cases that executed agrees with any collection, including
 * one that has quietly shrunk — audit item 4c. Nineteen is an independent
 * claim about this file, not a count of it — three of them come from the loop
 * over the routing, which is why counting `record` calls by eye undercounts.
 *
 * @type {string[]}
 */
const failures = [];
const roster = createRoster(failures, { cases: 19 });

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/**
 * Page 0's objects, read from BYTES rather than from a session that wrote them.
 *
 * @param {Uint8Array} bytes
 */
async function objectsOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return await pageObjects(session, 0);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/** What page 0 says, read from bytes. @param {Uint8Array} bytes */
async function textOf(bytes) {
  const session = await pdfiumWriter.open(bytes);
  try {
    return await pageText(session, 0);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/** The three kinds this file drives, as a typed list the loop below reads. */
const OBJECT_KINDS = /** @type {const} */ ([
  'placePageObject',
  'recolorPageObjects',
  'deletePageObjects',
]);

/**
 * A command literal typed from the contract's own inference.
 *
 * `version` is branded and a `.mjs` cannot mint one, so the annotation names the
 * contract's type and the assertion happens here rather than at each call site.
 *
 * **The kind is a PARAMETER**, which is what makes `K` infer. Taking only the
 * object left `K` in the return position alone, where TypeScript has nothing to
 * infer it from, so every capture came back as the union of all three priors and
 * `prior.matrix` did not exist on it. That is the checker asking for the one
 * thing that identifies the command, which is also what a reader wants to see.
 *
 * @template {(typeof OBJECT_KINDS)[number]} K
 * @param {K} kind
 * @param {object} rest
 * @returns {import('../../packages/contract/dist/commands.js').CommandOfKind<K>}
 */
function command(kind, rest) {
  return /** @type {import('../../packages/contract/dist/commands.js').CommandOfKind<K>} */ ({
    kind,
    ...rest,
  });
}

async function main() {
  process.stdout.write('# Object-level editing as commands, against the real library\n\n');
  process.stdout.write(`  PDFium ${PDFIUM_VERSION}\n  ${library}\n\n`);

  openPdfium(library);

  // THE ROUTING AND THE UNDO SHAPES, asserted before anything is run through
  // them. If a declaration named a different writer, every case below would
  // still pass against a function nothing dispatches to.
  for (const kind of OBJECT_KINDS) {
    record(
      `the declaration routes ${kind} to pdfium`,
      declaredCommands[kind].writer === 'pdfium',
      `it declares ${declaredCommands[kind].writer}`,
    );
  }
  record(
    'a removal is TERMINAL where its two siblings are invertible',
    declaredCommands.deletePageObjects.invertible === false &&
      declaredCommands.deletePageObjects.undo === 'checkpoint' &&
      declaredCommands.placePageObject.invertible === true &&
      declaredCommands.recolorPageObjects.invertible === true,
    'PDFium can describe an object and cannot rebuild one, so there is no prior to restore',
  );

  const original = await twoRunsAndARectangle();
  const before = await objectsOf(original);
  const rectangle = before.find((object) => object.kind === 'path');
  const text = before.find((object) => object.kind === 'text');
  record(
    'the fixture carries a path and two text objects',
    before.length === 3 && rectangle !== undefined && text !== undefined,
    `${before.map((object) => object.kind).join(', ')}`,
  );
  const box = rectangle ?? { index: -1, left: 0, bottom: 0, right: 0, top: 0, fill: null };

  // ── PLACE ──────────────────────────────────────────────────────────────────
  const place = command('placePageObject', {
    page: 0,
    index: box.index,
    moveBy: { x: 40, y: 25 },
    scaleBy: { x: 1.5, y: 1 },
    version: 1,
  });
  const placedPrior = await localPdfiumExecution.capture(original, place);
  record(
    'capture answers the object’s own MATRIX, not merely success',
    placedPrior.captured === true &&
      typeof placedPrior.prior.matrix.a === 'number' &&
      placedPrior.prior.index === box.index,
    placedPrior.captured === true
      ? `matrix a=${String(placedPrior.prior.matrix.a)} e=${String(placedPrior.prior.matrix.e)}`
      : `it refused: ${placedPrior.reason}`,
  );
  const placed = await localPdfiumExecution.apply(original, place);
  const placedBox = (await objectsOf(placed))[box.index] ?? box;
  record(
    'apply moves AND resizes, and the object keeps its own left edge',
    Math.abs(placedBox.left - (box.left + 40)) < 0.01 &&
      Math.abs(placedBox.bottom - (box.bottom + 25)) < 0.01 &&
      Math.abs(placedBox.right - placedBox.left - 1.5 * (box.right - box.left)) < 0.01,
    // A scale about the PAGE's origin would put the left edge at 340, not 240 —
    // measured, and it is the whole reason the payload is an intent.
    `${box.left.toFixed(1)},${box.bottom.toFixed(1)} -> ${placedBox.left.toFixed(1)},${placedBox.bottom.toFixed(1)}, ` +
      `${(placedBox.right - placedBox.left).toFixed(1)} wide`,
  );
  const placeRestored =
    placedPrior.captured === true
      ? await localPdfiumExecution.invert(placed, 'placePageObject', placedPrior.prior)
      : placed;
  const restoredBox = (await objectsOf(placeRestored))[box.index] ?? box;
  record(
    'the inverse restores the box EXACTLY, which is a RESTORE and not an opposite transform',
    Math.abs(restoredBox.left - box.left) < 0.01 &&
      Math.abs(restoredBox.right - box.right) < 0.01 &&
      Math.abs(restoredBox.bottom - box.bottom) < 0.01 &&
      Math.abs(restoredBox.top - box.top) < 0.01,
    `${restoredBox.left.toFixed(1)},${restoredBox.bottom.toFixed(1)} .. ${restoredBox.right.toFixed(1)},${restoredBox.top.toFixed(1)}`,
  );
  record(
    'CONTROL: the placement DID move the box, so the equality above separates something',
    Math.abs(placedBox.left - box.left) > 0.01,
    'an apply that did nothing would satisfy the restore case',
  );

  // ── RECOLOUR ───────────────────────────────────────────────────────────────
  // BOTH KINDS IN ONE COMMAND, which is what the shared colour is for and what
  // a per-object implementation would have to do twice.
  const recolor = command('recolorPageObjects', {
    page: 0,
    indices: [box.index, text?.index ?? -1],
    colour: { red: 255, green: 0, blue: 0, alpha: 255 },
    version: 1,
  });
  const colourPrior = await localPdfiumExecution.capture(original, recolor);
  record(
    'capture answers one prior FILL per named object',
    colourPrior.captured === true && colourPrior.prior.objects.length === 2,
    colourPrior.captured === true
      ? `${String(colourPrior.prior.objects.length)} prior fill(s)`
      : `it refused: ${colourPrior.reason}`,
  );
  const recoloured = await localPdfiumExecution.apply(original, recolor);
  const recolouredObjects = await objectsOf(recoloured);
  record(
    'apply recolours a PATH and a TEXT object in one command',
    recolouredObjects.every(
      (object) =>
        object.index !== box.index && object.index !== text?.index
          ? true
          : object.fill?.red === 255 && object.fill.green === 0 && object.fill.blue === 0,
    ),
    recolouredObjects
      .map((object) => `${object.kind}:${object.fill === null ? 'none' : String(object.fill.red)}`)
      .join(' '),
  );
  record(
    'and the object it did NOT name keeps its colour',
    recolouredObjects.some(
      (object) =>
        object.index !== box.index && object.index !== text?.index && object.fill?.red === 0,
    ),
    'a command that recoloured the page would lose this',
  );
  const colourRestored =
    colourPrior.captured === true
      ? await objectsOf(
          await localPdfiumExecution.invert(recoloured, 'recolorPageObjects', colourPrior.prior),
        )
      : recolouredObjects;
  record(
    'the inverse puts every prior fill back',
    colourRestored.every((object) => object.fill === null || object.fill.red === 0),
    colourRestored
      .map((object) => (object.fill === null ? 'none' : String(object.fill.red)))
      .join(','),
  );

  // ── DELETE ─────────────────────────────────────────────────────────────────
  const remove = command('deletePageObjects', {
    page: 0,
    indices: [box.index, text?.index ?? -1],
    version: 1,
  });
  // THE CAPTURE REFUSES, AND THE REFUSAL IS THE MECHANISM. `captured: false` is
  // what makes the bus take a checkpoint, so a capture that answered a prior
  // here would give undo an inverse that cannot put an object back.
  const removalPrior = await localPdfiumExecution.capture(original, remove);
  record(
    'a removal REFUSES to capture, which is what makes the bus take a checkpoint',
    removalPrior.captured === false && removalPrior.reason.includes('cannot rebuild one'),
    removalPrior.captured === false ? removalPrior.reason : 'it claimed to capture something',
  );
  const removed = await localPdfiumExecution.apply(original, remove);
  const removedObjects = await objectsOf(removed);
  const removedText = await textOf(removed);
  record(
    'apply removes exactly the objects named',
    removedObjects.length === 1 && removedObjects[0]?.kind === 'text',
    `${String(removedObjects.length)} left: ${removedObjects.map((object) => object.kind).join(', ')}`,
  );
  record(
    'and the run it removed is the one that is gone, not a neighbour that slid down',
    !removedText.includes(FIRST) && removedText.includes(SECOND),
    `the page now reads ${JSON.stringify(removedText)}`,
  );

  // WHAT A REMOVAL LEAVES BEHIND, and it is measured here because
  // `commandDeclarations.ts` says it is. `purpose: 'removal'` selects MuPDF's
  // collecting save and PDFium's `FPDF_SaveAsCopy` has no equivalent, so this
  // command declares `'ordinary'` — which leaves open whether an unlinked
  // object survives in the file.
  //
  // ## THE SIZE ALONE IS THE WRONG OBSERVABLE, and this is the control that says so
  //
  // The first version of this case asserted that a removal does not GROW the
  // document, and it went red: 1168 bytes before, 1613 after, +38%. That reads
  // as orphans and it is not — a PDFium save with NO EDIT AT ALL grows the same
  // file by the same kind of margin, because `FPDF_SaveAsCopy` writes a full
  // rewrite with its own object layout and pdf-lib's output is unusually
  // compact. So the growth is the SAVE, and attributing it to the removal would
  // have been a symptom recorded as a cause.
  //
  // What separates them is the untouched round trip, measured here in the same
  // run rather than recalled: the removal must not cost MORE than saving the
  // same document unchanged. That comparison has the rewrite on both sides.
  const untouchedRoundTrip = await (async () => {
    const session = await pdfiumWriter.open(original);
    try {
      return await pdfiumWriter.serialise(session);
    } finally {
      await pdfiumWriter.close(session);
    }
  })();
  record(
    'CONTROL: a PDFium save with NO edit already grows this file, so size alone proves nothing',
    untouchedRoundTrip.length > original.length,
    `${String(original.length)} bytes in, ${String(untouchedRoundTrip.length)} out with no edit ` +
      `(${(((untouchedRoundTrip.length - original.length) / original.length) * 100).toFixed(1)}%)`,
  );
  record(
    'removing objects costs no more than saving the same document UNCHANGED',
    removed.length <= untouchedRoundTrip.length,
    `${String(untouchedRoundTrip.length)} bytes for the untouched save, ${String(removed.length)} ` +
      `after removing two objects (${(((removed.length - untouchedRoundTrip.length) / untouchedRoundTrip.length) * 100).toFixed(1)}%)`,
  );

  // A COMMAND ROUTED ELSEWHERE IS REFUSED BY NAME rather than reaching
  // `undefined.apply`, whose TypeError names neither the command nor the writer.
  let refusal = null;
  try {
    await localPdfiumExecution.apply(original, /** @type {never} */ ({ kind: 'rotatePages' }));
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  record(
    'a command routed to another writer is refused by name',
    refusal !== null && refusal.includes('is not routed to PDFium'),
    refusal ?? 'it was accepted',
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium object case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium object case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
