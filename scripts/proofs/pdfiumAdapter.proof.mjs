// @ts-check
/**
 * The PDFium adapter, driven against the real library.
 *
 * ## What it proves and why it is here rather than in vitest
 *
 * `packages/kernel/src/pdfiumFfi.ts` is the second sanctioned native-boundary
 * adapter (`BUILD-PROMPT.md`:115). Everything it does happens inside a DLL, so a
 * unit test with the binding stubbed would assert that this file calls the
 * functions this file was written to call — the display-only shape one layer
 * down. The subject is the boundary, so the boundary has to be crossed.
 *
 * It needs `pdfium.dll`, which is provisioned rather than installed. A vitest
 * case would have to `skip` when it is absent, and a skipped case reads as green
 * in a summary. `scripts/lib/unverifiable.mjs` is this project's answer to that:
 * **UNVERIFIABLE** with a stated reason where nothing provisioned it, and a hard
 * failure under `--require-pdfium`, which the job that provisions passes.
 *
 * ## Every case asserts the DECISION, not the tidy end state
 *
 * `CLAUDE.md` item 4: a decision's job is often to avoid doing something, and
 * the state a correct decision produces is routinely the state an absent one
 * produces too. So:
 *
 * - the round trip reads back from a **reopened** document, never the session
 *   that made the edit — a setter agreeing with itself says nothing about what
 *   was stored;
 * - it asserts the new text is **present** AND the old text is **absent**.
 *   Presence alone passes if nothing changed and the fixture already said it;
 *   absence alone passes on a page that rendered nothing at all;
 * - the untouched neighbours are asserted in the same read, because *the edit
 *   worked* and *the edit worked and rewrote the rest of the page* are one
 *   observation on the edited run alone;
 * - the refusals assert **which rule refused**, by message. A wrong index and a
 *   non-text object both fail somewhere; only the message separates the rule
 *   under test from the one downstream of it.
 *
 * ## The plural signature brought two cases with it, 2026-09-09
 *
 * `replaceTextObjects` takes a list and generates content **once** (ADR-0047
 * Decision 2). Two properties of that are not observable through a single
 * replacement, so the file would have kept its old coverage and read as
 * complete:
 *
 * - **two sets and one generate**, asserted from a reopened document. The
 *   change that would break it — the second set living in memory only — is
 *   exactly what moving the generate to the end could produce;
 * - **a replacement naming nothing is refused**, because regenerating a
 *   content stream is the whole cost of an edit and this one would change
 *   nothing.
 *
 * A third was written and removed. See the note at the refusals below: the
 * partial-write guard is real and its effect is not observable through this
 * surface, which the mutation showed and a direct reading of the library
 * explained.
 *
 * ## The retained-bytes case is the one worth reading
 *
 * `FPDF_LoadMemDocument` does not copy: PDFium parses lazily out of the caller's
 * memory for the document's whole life. An adapter that passed a `ByteImage`
 * straight through would work in every short test and fail when a collection or
 * an overwrite landed between two commands.
 *
 * The case overwrites the caller's array with zeros **after** `open` and then
 * serialises. **And it carries its own control**, because the reassuring answer
 * here is *the text is still right*, which is also what happens if the overwrite
 * never landed: it asserts the caller's array really is all zeros before it
 * believes the round trip. A control needs a control.
 *
 * Usage: node scripts/proofs/pdfiumAdapter.proof.mjs [--require-pdfium]
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { PDFIUM_ADAPTER, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the PDFium adapter',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

// The proof imports the BUILT module, so a stale build would prove yesterday's
// adapter and say nothing about the diff under review.
refuseStaleBuild(root, PDFIUM_ADAPTER, 1);

const {
  openPdfium,
  pdfiumIsOpen,
  pdfiumWriter,
  pageCount,
  countObjects,
  textObjectIndices,
  pageText,
  textObjectText,
  textRuns,
  replaceTextObjects,
  pageObjects,
  placeObject,
  objectMatrix,
  setObjectMatrix,
  setObjectFills,
  removeObjects,
  renderPageBitmap,
} = await import('../../packages/kernel/dist/pdfiumFfi.js');

const FIRST = 'FIRST RUN stays exactly where it is';
const SECOND = 'SECOND RUN is the one that changes';
const THIRD = 'THIRD RUN stays exactly where it is';
const REPLACEMENT = 'SECOND RUN has been replaced';

/**
 * A page with three text runs and one filled rectangle.
 *
 * The rectangle is not decoration: it is the input for the non-text refusal,
 * and a fixture with only text objects could not separate *refused because it is
 * not text* from *refused because the index was out of range*.
 *
 * @returns {Promise<Uint8Array>}
 */
async function threeRunsAndARectangle() {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 300]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 20, y: 20, width: 120, height: 40, color: rgb(0.2, 0.4, 0.9) });
  page.drawText(FIRST, { x: 30, y: 230, size: 11, font });
  page.drawText(SECOND, { x: 30, y: 190, size: 11, font });
  page.drawText(THIRD, { x: 30, y: 150, size: 11, font });
  return document.save();
}

/**
 * The case roster.
 *
 * `createRoster` rather than a total printed from what ran, because a total
 * computed over the cases that executed **agrees with any collection**,
 * including one that has quietly shrunk — audit item 4c, and `check:proofanchors`
 * is the scan that refuses a proof without one. Forty-seven is an independent
 * claim about this file, not a count of it.
 *
 * @type {string[]}
 */
const failures = [];
const roster = createRoster(failures, { cases: 47 });

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
 * The message a call threw, or `null` if it did not throw.
 *
 * @param {() => Promise<unknown>} work
 * @returns {Promise<string | null>}
 */
async function refusal(work) {
  try {
    await work();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main() {
  process.stdout.write('# The PDFium adapter, against the real library\n\n');
  process.stdout.write(`  PDFium ${PDFIUM_VERSION}\n  ${library}\n\n`);

  // A CALL BEFORE BINDING is refused by name rather than by TypeError. This runs
  // first because it is the only moment in the process when the library is not
  // yet open, and openPdfium is idempotent — there is no way back to this state.
  record(
    'a call before openPdfium names the missing binding',
    !pdfiumIsOpen() &&
      ((await refusal(() => pageCount(/** @type {never} */ ({ engine: 'pdfium' })))) ?? '').includes(
        'has not been bound',
      ),
    'the adapter says what is missing instead of failing on an undefined',
  );

  openPdfium(library);
  record('openPdfium binds and initialises', pdfiumIsOpen(), 'FPDF_InitLibrary ran');
  openPdfium(library);
  record('openPdfium is idempotent', pdfiumIsOpen(), 'a second call did not rebind');

  const original = await threeRunsAndARectangle();
  const session = await pdfiumWriter.open(original);

  record('the document has one page', (await pageCount(session)) === 1, 'FPDF_GetPageCount');

  const objects = await countObjects(session, 0);
  const texts = await textObjectIndices(session, 0);
  record(
    'the page carries three text objects and one that is not',
    texts.length === 3 && objects === 4,
    `${String(objects)} objects, of which ${String(texts.length)} are text`,
  );

  const before = await pageText(session, 0);
  record(
    'the page reads back before any edit',
    before.includes(FIRST) && before.includes(SECOND) && before.includes(THIRD),
    'all three runs are present, so a later absence means the edit and not the fixture',
  );

  // ---- THE RUNS, which line-level editing is grouped from (ADR-0049) ----
  const runs = await textRuns(session, 0);
  record(
    'textRuns answers one entry per TEXT object and none for the rectangle',
    runs.length === 3 && runs.every((entry) => texts.includes(entry.index)),
    `${String(runs.length)} runs at indices ${JSON.stringify(runs.map((r) => r.index))}, ` +
      `against text objects ${JSON.stringify(texts)}. A rectangle contributes no characters, ` +
      `so a run for it would mean the address table matched the wrong object.`,
  );

  record(
    'each run carries the text its own object carries',
    runs.some((entry) => entry.text === FIRST) &&
      runs.some((entry) => entry.text === SECOND) &&
      runs.some((entry) => entry.text === THIRD),
    `texts: ${JSON.stringify(runs.map((r) => r.text))}. The walk maps each CHARACTER back to ` +
      `its object through FPDFText_GetTextObject; a run holding another's text means the ` +
      `mapping is off by an object, which a count alone cannot see.`,
  );

  // GENERATED CHARACTERS ARE SKIPPED, and this is what says so: PDFium inserts
  // spaces it believes are implied by spacing, they belong to no object, and a
  // walk that did not ask `FPDFText_IsGenerated` would either attribute them to
  // a neighbour or drop the character silently. The runs' text summed against
  // the objects' own text is the check that separates those.
  const own = await Promise.all(texts.map((index) => textObjectText(session, 0, index)));
  record(
    'no run carries a character its object does not, so generated spaces were skipped',
    runs.every((entry) => own.includes(entry.text)),
    `runs: ${JSON.stringify(runs.map((r) => r.text))}\nobjects: ${JSON.stringify(own)}. ` +
      `FPDFTextObj_GetText is the independent reader here — it asks the OBJECT rather than ` +
      `walking the text page — so agreement between the two is what makes the walk's grouping ` +
      `worth anything.`,
  );

  record(
    'a run’s vertical extent covers its characters and is not a point',
    runs.every((entry) => entry.top > entry.bottom),
    `extents: ${JSON.stringify(runs.map((r) => [r.bottom, r.top]))}. The grouping joins runs ` +
      `whose extents OVERLAP, and an empty interval overlaps nothing — a run sized from one ` +
      `character, or from none, would be a line of its own whatever it sits beside.`,
  );

  // THE NON-TEXT REFUSAL, asserted by WHICH RULE refused. The rectangle's index
  // is whichever one is not in `texts`.
  const rectangle = [0, 1, 2, 3].find((index) => !texts.includes(index)) ?? -1;
  const nonText = await refusal(() =>
    replaceTextObjects(session, 0, [{ index: rectangle, text: 'nope' }]),
  );
  record(
    'replacing a non-text object is refused as a non-text object',
    nonText !== null && nonText.includes('is not a text object'),
    nonText ?? 'it was accepted',
  );
  const outOfRange = await refusal(() =>
    replaceTextObjects(session, 0, [{ index: 99, text: 'nope' }]),
  );
  record(
    'an out-of-range index is refused as an index, not as a type',
    outOfRange !== null && outOfRange.includes('names none'),
    outOfRange ?? 'it was accepted',
  );
  const named = await refusal(() => replaceTextObjects(session, 0, []));
  record(
    'a replacement naming no object is refused rather than regenerating for nothing',
    named !== null && named.includes('named no text object'),
    named ?? 'it was accepted',
  );

  // THERE IS NO CASE FOR THE PARTIAL REFUSAL, and the absence is deliberate.
  //
  // `replaceTextObjects` resolves every index before it sets anything, so a
  // list whose second entry is invalid touches nothing. A case for that was
  // written, and the mutation that should have reddened it — validating inside
  // the set loop, so the first entry lands and the second throws — left all
  // twenty-two green.
  //
  // The reason is measured rather than guessed (2026-09-09, against the
  // library, with a control): an `FPDFText_SetText` that is never followed by
  // `FPDFPage_GenerateContent` does **not** survive `FPDF_ClosePage`. A second
  // load of the same page and a generate wrote only the second pass's set;
  // the first pass's string was absent from the saved bytes while the second
  // pass's was present.
  //
  // So the guard protects a property this module's surface cannot observe,
  // because `onPage`'s page lifetime already prevents the half-write. It is
  // kept — it encodes a true rule for any caller that holds a page across sets,
  // which the plural signature invites — and the case is not, because a case
  // that cannot fail is a green check that verifies nothing (item 4, and NNN-3's
  // third animal: an effect no assertion on this surface can see).

  // The refusals must not have edited anything on their way to throwing.
  const afterRefusals = await pageText(session, 0);
  record(
    'a refused edit changed nothing',
    afterRefusals === before,
    'the page reads exactly as it did before the two refusals',
  );

  // THE PRIOR, read before the edit that replaces it. This is what makes the
  // command invertible, so the case asserts it names the run it is about — an
  // empty string would be the reassuring answer for a read that could not see.
  const prior = await textObjectText(session, 0, texts[1] ?? -1);
  record(
    'one text object answers its own text, not the whole page',
    prior.includes(SECOND) && !prior.includes(FIRST) && !prior.includes(THIRD),
    `it answered ${JSON.stringify(prior)}`,
  );
  const priorOfNonText = await refusal(() => textObjectText(session, 0, rectangle));
  record(
    'reading the text of a non-text object is refused rather than answered empty',
    priorOfNonText !== null && priorOfNonText.includes('is not a text object'),
    priorOfNonText ?? "it answered a string for something that has no text",
  );

  await replaceTextObjects(session, 0, [{ index: texts[1] ?? -1, text: REPLACEMENT }]);
  const saved = await pdfiumWriter.serialise(session);

  // READ BACK FROM A REOPENED DOCUMENT. A setter agreeing with itself proves
  // nothing about what was stored.
  const reopened = await pdfiumWriter.open(saved);
  const after = await pageText(reopened, 0);
  record(
    'the replacement survives serialise and reopen',
    after.includes(REPLACEMENT),
    'the new run is in the bytes, not only in the session that made it',
  );
  record(
    'and the text it replaced is gone',
    !after.includes(SECOND),
    'presence alone would pass on a page that never changed',
  );
  record(
    'the runs either side are untouched',
    after.includes(FIRST) && after.includes(THIRD),
    'the edit worked, and did not rewrite the rest of the page',
  );
  await pdfiumWriter.close(reopened);

  // The ORIGINAL bytes still say what they always said. Without this the case
  // above is satisfied by a fixture that already carried the replacement.
  const untouched = await pdfiumWriter.open(original);
  const untouchedText = await pageText(untouched, 0);
  record(
    'the original bytes were not written through',
    untouchedText.includes(SECOND) && !untouchedText.includes(REPLACEMENT),
    'the edit went to the session, and the caller kept its own image',
  );
  await pdfiumWriter.close(untouched);
  await pdfiumWriter.close(session);

  // TWO OBJECTS IN ONE CALL, which is the property the plural signature exists
  // for and the one the single-index version could not express. ADR-0047
  // Decision 2 measures generating per object at 13.7× over forty
  // replacements; what this asserts is the correctness half — that generating
  // ONCE at the end still writes every set into the content stream.
  //
  // Read back from a REOPENED document, for the reason every read here is: a
  // session agreeing with itself says nothing about what was stored, and
  // "generated once" is precisely the change that could leave the second set
  // in memory only.
  const both = await pdfiumWriter.open(await threeRunsAndARectangle());
  const bothTexts = await textObjectIndices(both, 0);
  await replaceTextObjects(both, 0, [
    { index: bothTexts[0] ?? -1, text: 'FIRST REPLACED IN THE SAME CALL' },
    { index: bothTexts[2] ?? -1, text: 'THIRD REPLACED IN THE SAME CALL' },
  ]);
  const bothReopened = await pdfiumWriter.open(await pdfiumWriter.serialise(both));
  const bothText = await pageText(bothReopened, 0);
  record(
    'two replacements in one call both reach the saved bytes',
    bothText.includes('FIRST REPLACED IN THE SAME CALL') &&
      bothText.includes('THIRD REPLACED IN THE SAME CALL'),
    'one generate at the end wrote both sets, not only the last',
  );
  record(
    'and neither original run survives, nor does the one between them change',
    !bothText.includes(FIRST) && !bothText.includes(THIRD) && bothText.includes(SECOND),
    'presence alone would pass on a page that carried both strings already',
  );
  await pdfiumWriter.close(bothReopened);
  await pdfiumWriter.close(both);

  // THE RETAINED-BYTES CASE. FPDF_LoadMemDocument reads the caller's memory for
  // the document's whole life, so an adapter that passed a ByteImage through
  // would serialise whatever the caller did to it afterwards.
  const volatileImage = await threeRunsAndARectangle();
  const held = await pdfiumWriter.open(volatileImage);
  volatileImage.fill(0);
  // THE CONTROL FOR THE CONTROL: if the overwrite did not land, the round trip
  // below is reassuring for the wrong reason.
  record(
    'the overwrite really happened',
    volatileImage.every((byte) => byte === 0),
    "the caller's image is all zeros, so the next case is about the copy",
  );
  const survived = await pageText(held, 0);
  record(
    "the session survives the caller overwriting its image",
    survived.includes(FIRST) && survived.includes(SECOND),
    'open() copied the bytes; PDFium is not reading the array the caller still holds',
  );
  await pdfiumWriter.close(held);

  // PROVENANCE. A PdfiumSession is structural, so a fabricated one satisfies the
  // type; only the WeakMap can refuse it.
  const forged = await refusal(() => pageCount(/** @type {never} */ ({ engine: 'pdfium' })));
  record(
    'a fabricated session is refused',
    forged !== null && forged.includes('not produced by this adapter'),
    forged ?? 'it was accepted',
  );
  const reclosed = await refusal(() => pdfiumWriter.close(held));
  record(
    'closing twice is a named error, not a second free',
    reclosed !== null && reclosed.includes('already been closed'),
    reclosed ?? 'it was accepted',
  );

  await objectCases();

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium adapter case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium adapter case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * Reads page 0's objects out of BYTES, never out of the session that wrote them.
 *
 * Every object case below compares two of these. A getter answering what a
 * setter was just given proves nothing about what was stored, and for these
 * calls that risk is not theoretical: `FPDFPage_GenerateContent` is what carries
 * an object edit into the content stream, and skipping it leaves a live session
 * that reports the edit and a file that does not have it — measured.
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

/**
 * Applies `work` to a fresh fixture and answers the reopened bytes.
 *
 * The session's type is taken from an adapter function's own signature rather
 * than written as `unknown` and cast at each call: `PdfiumSession` is branded,
 * so `unknown` would need thirteen assertions and each one would be a place the
 * brand stopped meaning *this adapter produced it*.
 *
 * @param {(session: Parameters<typeof pageObjects>[0]) => Promise<void>} work
 */
async function edited(work) {
  const session = await pdfiumWriter.open(await threeRunsAndARectangle());
  try {
    await work(session);
    return await pdfiumWriter.serialise(session);
  } finally {
    await pdfiumWriter.close(session);
  }
}

/**
 * Moving, scaling, recolouring and removing a page's objects.
 *
 * Its own function rather than more lines in `main`, because these share a
 * fixture shape and read through one helper — and because the case count in the
 * roster is an independent claim about the file, which a reader checks by
 * counting `record` calls rather than by scrolling one four-hundred-line body.
 */
async function objectCases() {
  const original = await objectsOf(await threeRunsAndARectangle());
  // THE RECTANGLE, found by KIND rather than by a literal index. `drawRectangle`
  // is called first in the fixture, so it is object 0 today; a case pinned to
  // that number would be about the fixture's authoring order rather than about
  // the page.
  const rectangle = original.find((object) => object.kind === 'path');
  const text = original.find((object) => object.kind === 'text');
  record(
    'pageObjects answers EVERY object with a kind, not only the text ones',
    original.length === 4 && rectangle !== undefined && text !== undefined,
    `${String(original.length)} object(s): ${original.map((object) => object.kind).join(', ')}`,
  );
  const box = rectangle ?? { index: -1, left: 0, bottom: 0, right: 0, top: 0, fill: null };
  record(
    'and a box in PAGE space, which is what a surface draws a handle on',
    box.right > box.left && box.top > box.bottom,
    `the path is ${box.left.toFixed(1)},${box.bottom.toFixed(1)} .. ${box.right.toFixed(1)},${box.top.toFixed(1)}`,
  );

  // A MOVE. The fixture's rectangle is at x=20..140, y=20..60.
  const moved = await objectsOf(
    await edited((session) =>
      placeObject(session, 0, box.index, { moveBy: { x: 30, y: 12 }, scaleBy: { x: 1, y: 1 } }),
    ),
  );
  const movedBox = moved[box.index] ?? box;
  record(
    'placeObject moves an object by exactly what it was given, in the SAVED bytes',
    Math.abs(movedBox.left - (box.left + 30)) < 0.01 &&
      Math.abs(movedBox.bottom - (box.bottom + 12)) < 0.01,
    `${box.left.toFixed(1)},${box.bottom.toFixed(1)} -> ${movedBox.left.toFixed(1)},${movedBox.bottom.toFixed(1)}`,
  );
  record(
    'and its SIZE is unchanged, so a move is not a transform that also scales',
    Math.abs(movedBox.right - movedBox.left - (box.right - box.left)) < 0.01 &&
      Math.abs(movedBox.top - movedBox.bottom - (box.top - box.bottom)) < 0.01,
    `${(box.right - box.left).toFixed(1)} wide before, ${(movedBox.right - movedBox.left).toFixed(1)} after`,
  );

  // A SCALE, AND THE CASE THE WHOLE COMPOSITION EXISTS FOR. PDFium's own
  // transform scales about the PAGE's origin: measured, a rectangle at
  // x=200..320 scaled by 2 landed at 400..640. The fixture's rectangle starts
  // at x=20, so a raw transform would put it at 40..280 and this asserts
  // 20..260 — the two differ by exactly the anchor, which is the finding.
  const scaled = await objectsOf(
    await edited((session) =>
      placeObject(session, 0, box.index, { moveBy: { x: 0, y: 0 }, scaleBy: { x: 2, y: 1 } }),
    ),
  );
  const scaledBox = scaled[box.index] ?? box;
  record(
    'a scale keeps the object’s own bottom-left corner, rather than the PAGE’s origin',
    Math.abs(scaledBox.left - box.left) < 0.01,
    `left ${box.left.toFixed(1)} -> ${scaledBox.left.toFixed(1)}; PDFium's raw transform would answer ${(box.left * 2).toFixed(1)}`,
  );
  record(
    'and it is twice as wide and exactly as tall, so the axes did not swap',
    Math.abs(scaledBox.right - scaledBox.left - 2 * (box.right - box.left)) < 0.01 &&
      Math.abs(scaledBox.top - scaledBox.bottom - (box.top - box.bottom)) < 0.01,
    `${(scaledBox.right - scaledBox.left).toFixed(1)} wide, ${(scaledBox.top - scaledBox.bottom).toFixed(1)} tall`,
  );

  // THE INVERSE. Read the matrix, move, put it back — and assert the bounds are
  // what they were, not merely that the call succeeded.
  const restored = await objectsOf(
    await edited(async (session) => {
      const before = await objectMatrix(session, 0, box.index);
      await placeObject(session, 0, box.index, { moveBy: { x: 90, y: 40 }, scaleBy: { x: 3, y: 3 } });
      await setObjectMatrix(session, 0, box.index, before);
    }),
  );
  const restoredBox = restored[box.index] ?? box;
  record(
    'setObjectMatrix(what was read) restores the box EXACTLY, which is the inverse',
    Math.abs(restoredBox.left - box.left) < 0.01 &&
      Math.abs(restoredBox.bottom - box.bottom) < 0.01 &&
      Math.abs(restoredBox.right - box.right) < 0.01 &&
      Math.abs(restoredBox.top - box.top) < 0.01,
    `${restoredBox.left.toFixed(1)},${restoredBox.bottom.toFixed(1)} .. ${restoredBox.right.toFixed(1)},${restoredBox.top.toFixed(1)}`,
  );
  record(
    'CONTROL: that placement DID move the box, so the equality above separates something',
    Math.abs(scaledBox.right - box.right) > 0.01,
    'without this, a placeObject that did nothing would satisfy the restore case',
  );

  // A RECOLOUR, on the TEXT object. The row says *any page object*, and text is
  // the kind a person is most likely to recolour — and the kind an adapter that
  // only handled paths would silently refuse.
  const recoloured = await objectsOf(
    await edited((session) =>
      setObjectFills(session, 0, [{ index: text?.index ?? -1, red: 255, green: 0, blue: 0, alpha: 255 }]),
    ),
  );
  const recolouredText = recoloured[text?.index ?? 0];
  record(
    'setObjectFills recolours a TEXT object, and it survives the round trip',
    recolouredText?.fill?.red === 255 &&
      recolouredText.fill.green === 0 &&
      recolouredText.fill.blue === 0,
    recolouredText?.fill === null
      ? 'PDFium would not say what the fill is'
      : `fill ${String(recolouredText?.fill?.red)},${String(recolouredText?.fill?.green)},${String(recolouredText?.fill?.blue)}`,
  );
  record(
    'CONTROL: it was NOT red before, so the case above is about the recolour',
    text?.fill?.red !== 255,
    `the fixture's text starts at ${String(text?.fill?.red)},${String(text?.fill?.green)},${String(text?.fill?.blue)}`,
  );

  // REMOVAL, AND THE RENUMBERING HAZARD. Removing two indices ascending would
  // delete whatever slid down into the second; this asserts that the objects
  // LEFT are the ones that were not named, by their text and kind rather than
  // by a count — a count of two survives either way.
  const afterRemoval = await objectsOf(
    await edited((session) => removeObjects(session, 0, [box.index, text?.index ?? -1])),
  );
  record(
    'removeObjects drops exactly the objects named, however the indices are ordered',
    afterRemoval.length === 2 && afterRemoval.every((object) => object.kind === 'text'),
    `${String(afterRemoval.length)} left: ${afterRemoval.map((object) => object.kind).join(', ')}`,
  );
  const survivingText = await (async () => {
    const bytes = await edited((session) => removeObjects(session, 0, [box.index, text?.index ?? -1]));
    const session = await pdfiumWriter.open(bytes);
    try {
      return await pageText(session, 0);
    } finally {
      await pdfiumWriter.close(session);
    }
  })();
  record(
    'and the run it removed is the one that is gone, not a neighbour that slid down',
    !survivingText.includes(FIRST) && survivingText.includes(SECOND) && survivingText.includes(THIRD),
    `the page now reads ${JSON.stringify(survivingText)}`,
  );

  // ORDER-INDEPENDENCE, ASSERTED RATHER THAN ASSUMED. Removing an index shifts
  // every later object down, so the ordering question is real — and the answer
  // here is that it cannot bite, because every index is resolved to a HANDLE
  // against the untouched page and a handle does not renumber.
  //
  // This function sorted descending to be safe, and the mutation written to
  // redden that (sorting ascending) left every case green. The sort is gone and
  // this case is what replaces it: the two orders must produce the same page,
  // which is a claim about the resolution rather than about the sort.
  const ascendingBytes = await edited((session) =>
    removeObjects(session, 0, [box.index, text?.index ?? -1]),
  );
  const descendingBytes = await edited((session) =>
    removeObjects(session, 0, [text?.index ?? -1, box.index]),
  );
  const ascendingKinds = (await objectsOf(ascendingBytes)).map((object) => object.kind).join(',');
  const descendingKinds = (await objectsOf(descendingBytes)).map((object) => object.kind).join(',');
  record(
    'the two orderings of one removal produce the SAME page',
    ascendingKinds === descendingKinds && ascendingKinds === 'text,text',
    `ascending left ${ascendingKinds}; descending left ${descendingKinds}`,
  );

  // THE DUPLICATE GUARD, and the mutation is what says what it guards. Deleting
  // the `Set` and running this throws `FPDFPage_RemoveObject refused object 0`:
  // PDFium declines to unlink an object that has already left the page, so the
  // hazard is not a double free — it is a command that removed one object and
  // then failed, leaving the page half-edited and the caller with an error for
  // an input whose meaning is obvious.
  const twice = await objectsOf(
    await edited((session) => removeObjects(session, 0, [box.index, box.index])),
  );
  record(
    'an index named twice removes it ONCE rather than failing halfway',
    twice.length === 3 && twice.every((object) => object.kind === 'text'),
    `${String(twice.length)} left: ${twice.map((object) => object.kind).join(', ')}`,
  );

  // THE THREE EMPTY-LIST REFUSALS, together. A command naming nothing would
  // regenerate a page's content stream for no change, which is the whole cost
  // of an edit paid for nothing.
  const emptyFill = await refusal(async () => {
    await edited((session) => setObjectFills(session, 0, []));
  });
  const emptyRemoval = await refusal(async () => {
    await edited((session) => removeObjects(session, 0, []));
  });
  record(
    'a recolour and a removal that name nothing are both refused',
    emptyFill !== null && emptyRemoval !== null,
    `${emptyFill ?? 'the recolour was accepted'} / ${emptyRemoval ?? 'the removal was accepted'}`,
  );
  const badIndex = await refusal(async () => {
    await edited((session) => placeObject(session, 0, 99, { moveBy: { x: 1, y: 1 }, scaleBy: { x: 1, y: 1 } }));
  });
  record(
    'an index the page does not have is refused by NAME, not by a native crash',
    badIndex !== null && badIndex.includes('names none'),
    badIndex ?? 'it was accepted',
  );

  await rasterCases();
}

/**
 * The rasteriser — §6.1's setting, which is a READER and not a writer.
 *
 * Every case here is about the buffer's shape and its contents, because the
 * shape is where this can go wrong invisibly: `FPDFBitmap_GetStride` may exceed
 * `width * 4`, and copying as if it did not shears the image progressively down
 * the page. That looks like a rendering defect and is a copying one.
 */
async function rasterCases() {
  const session = await pdfiumWriter.open(await threeRunsAndARectangle());
  try {
    const small = await renderPageBitmap(session, 0, 40, 30);
    record(
      'renderPageBitmap answers exactly width x height x 4 bytes',
      small.bgra.length === 40 * 30 * 4 && small.width === 40 && small.height === 30,
      `${String(small.bgra.length)} bytes for ${String(small.width)}x${String(small.height)}`,
    );

    // NO STRIDE CASE, AND THAT IS A MEASUREMENT RATHER THAN AN OMISSION. This
    // file carried one — an odd width, 41 pixels, asserting a tightly packed
    // buffer — written on the belief that PDFium pads a row for alignment and
    // that a stride-blind copy would fail it. Both halves were wrong: the
    // assertion was on the LENGTH, which a flat copy also produces, and
    // `FPDFBitmap_GetStride` answers exactly `width * 4` for every width
    // measured (1, 2, 3, 5, 7, 13, 40, 41, 43, 97, 101, 399, 1191) because a
    // four-byte pixel is already four-byte aligned.
    //
    // So the case could not separate anything, on a build where the thing it
    // guarded cannot happen. The row-by-row copy stays — `FPDFBitmap_Gray` and
    // `BGR` do pad — and the case is gone, a check that cannot fail being worse
    // than no check.

    // THE PAGE WAS DRAWN, which every shape assertion above is silent about: a
    // buffer of the right length full of white is what a render that never
    // happened leaves behind, the fill being opaque white on purpose.
    const bigger = await renderPageBitmap(session, 0, 400, 300);
    let inked = 0;
    for (let at = 0; at + 3 < bigger.bgra.length; at += 4) {
      if ((bigger.bgra[at] ?? 255) < 250) inked += 1;
    }
    record(
      'and the page is actually DRAWN, not merely allocated and filled white',
      inked > 0,
      `${String(inked)} of ${String(400 * 300)} pixels carry ink`,
    );
    record(
      'CONTROL: the same buffer is mostly WHITE, so the count above is ink and not noise',
      inked < 400 * 300 * 0.5,
      'a buffer composited over uninitialised memory would read as ink nearly everywhere',
    );

    // A SIZE PDFIUM CANNOT ALLOCATE IS REFUSED BY NAME. A zero dimension makes
    // `FPDFBitmap_Create` answer null, and a null bitmap's buffer is a null
    // pointer that `koffi.decode` would read through.
    const zero = await refusal(() => renderPageBitmap(session, 0, 0, 30));
    record(
      'a non-positive size is refused before PDFium is asked',
      zero !== null && zero.includes('not a size PDFium can allocate'),
      zero ?? 'it was accepted',
    );
    const missing = await refusal(() => renderPageBitmap(session, 99, 10, 10));
    record(
      'a page the document does not have is refused by name',
      missing !== null && missing.includes('could not load page'),
      missing ?? 'it was accepted',
    );
  } finally {
    await pdfiumWriter.close(session);
  }
}

await main();
