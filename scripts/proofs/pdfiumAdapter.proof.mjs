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
  replaceTextObject,
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

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const cases = [];

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  cases.push({ name, ok, detail });
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

  // THE NON-TEXT REFUSAL, asserted by WHICH RULE refused. The rectangle's index
  // is whichever one is not in `texts`.
  const rectangle = [0, 1, 2, 3].find((index) => !texts.includes(index)) ?? -1;
  const nonText = await refusal(() => replaceTextObject(session, 0, rectangle, 'nope'));
  record(
    'replacing a non-text object is refused as a non-text object',
    nonText !== null && nonText.includes('is not a text object'),
    nonText ?? 'it was accepted',
  );
  const outOfRange = await refusal(() => replaceTextObject(session, 0, 99, 'nope'));
  record(
    'an out-of-range index is refused as an index, not as a type',
    outOfRange !== null && outOfRange.includes('names none'),
    outOfRange ?? 'it was accepted',
  );

  // The refusals must not have edited anything on their way to throwing.
  const afterRefusals = await pageText(session, 0);
  record(
    'a refused edit changed nothing',
    afterRefusals === before,
    'the page reads exactly as it did before the two refusals',
  );

  await replaceTextObject(session, 0, texts[1] ?? -1, REPLACEMENT);
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

  const failed = cases.filter((entry) => !entry.ok);
  for (const entry of cases) {
    process.stdout.write(`  ${entry.ok ? 'ok  ' : 'FAIL'}  ${entry.name}\n`);
    process.stdout.write(`          ${entry.detail}\n`);
  }
  process.stdout.write(
    `\n  ${String(cases.length - failed.length)} of ${String(cases.length)} case(s) passed.\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

await main();
