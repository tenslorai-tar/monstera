// @ts-check
/**
 * A page holding Type 3 text, edited end to end by the two engines that do it in the product
 * ([ADR-0176](../../docs/DECISIONS/0176-a-page-holding-type-3-text-is-edited-in-its-own-content-stream-by-mupdf.md)).
 *
 * ## Why this exists beside the kernel's cases
 *
 * `textOperatorEdit.test.ts` hands the MuPDF writer a reading of the page STATED BY HAND, and `pdfiumCommand.proof.mjs`
 * reads PDFium's `pageRuns` without writing anything. Each is right in its own frame, and the pair is green while the
 * one thing that crosses between them, PDFium's numbering of the page's objects against the writer's numbering of its
 * operators, is named in neither: CLAUDE.md's blind spot of a wired pair, where two halves speak different coordinate
 * systems. Here PDFium's real reading is the writer's input, MuPDF writes, and PDFium reads the saved bytes again.
 *
 * ## The fixture
 *
 * The committed Chromium print (`scripts/research/chromiumType3Fixture.mjs`): a heading in a Type 3 subset, one `BT` per
 * line and a move per glyph, and a body line in a Type0 font. Generated, never a person's document.
 *
 * ## Both engines, or a stated could-not-look
 *
 * PDFium and the native MuPDF shim are both the subject, so a machine with either missing runs nothing and says so;
 * `--require-engines` makes that red, which the Windows leg passes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TYPE3_EDIT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { fontsDirectory } from '../provision/fonts.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');
const CHROMIUM = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'chromium-type3.pdf');

const HEADING = 'Monstera fixture heading.';
const EDITED = 'Monstera fixture reading.';
const BODY = 'Body text in the regular face.';
/** A code point no font carries (U+0378 is unassigned), so it can only be drawn as the box. */
const UNASSIGNED = String.fromCodePoint(0x378);
/** The heading with letters the print's Type 3 subset lacks (z, p) and the unassigned code point. */
const FACED = `Monstera fixture zap ${UNASSIGNED}.`;

const CASES = [
  'PDFium reads the print’s heading as one line of runs of page objects, and the body apart from it',
  'given PDFium’s own reading, MuPDF rewrites the heading in its Type 3 font and the edit saves',
  'PDFium, reading the saved bytes, finds the new heading and the body line, and not the old heading',
  'CONTROL: the body line’s operator is byte for byte the one it was',
  'CONTROL: a reading that numbers one more text object than the page has is refused, and nothing is written',
  'with the bundled fonts bound by folder, MuPDF sets the letters the print lacks in a face and answers the one box',
  'PDFium, reading those saved bytes, finds every new letter and the boxed code point as itself',
  'with fit shrink, a heading made half as long again again is set smaller on its OWN baseline, and PDFium reads it back whole',
  'CONTROL: the same words with fit reflow are not written on that row: they wrap onto the heading below it and are refused, or leave only a part of them there',
  'a heading MOVED is read by PDFium from the saved bytes exactly the points further on, with the lines beside it where they were',
  'CONTROL: the same heading written with no placement is read where it was, so the move above is the placement’s',
  'a heading SCALED to half is read half as wide, with its top left where it was',
  'a heading TURNED a quarter is read running up the page, about the centre it had',
  'CONTROL: the heading unturned is wider than it is tall, so the quarter turn above is the one that made it tall',
  'a heading given a NARROWER MEASURE wraps inside it, every word kept in order and the first line where it began',
  'CONTROL: the same words with no measure stay on one line, so it is the measure that wrapped them',
  'a heading resized from its WEST side (moved and given a measure at once) is read at its new left edge and wrapped there',
  'a JOIN of the two headings is one paragraph: the second heading’s words follow the first’s, and its old place is empty',
  'a SPLIT leaves the first half where it was and moves the second half down by the distance asked',
  'a box of text ADDED to the page is read by PDFium at the left and baseline it was given, in a bundled face',
  'CONTROL: before the edit the page holds no such text, and the box added carries a font the page did not have',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 21 });
if (CASES.length !== 21) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 21`);

/** @param {string} name @param {boolean} held @param {string} detail */
function check(name, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/** Every white space removed, for a comparison of words that does not depend on where an engine infers a space. */
const squeezed = (/** @type {string} */ text) => text.replace(/\s/gu, '');

/**
 * @param {any} pdfium
 * @param {any} kernel
 */
async function run(pdfium, kernel) {
  const bytes = new Uint8Array(readFileSync(CHROMIUM));
  /** @param {Uint8Array} image */
  const readRuns = async (image) => {
    const session = await pdfium.pdfiumWriter.open(image);
    try {
      return await pdfium.pageRuns(session, 0);
    } finally {
      await pdfium.pdfiumWriter.close(session);
    }
  };

  const reading = await readRuns(bytes);
  // THE HEADING'S LINE AS THE EDITOR NAMES IT: every run on its baseline, in order. PDFium gives the full stop a run of
  // its own (measured on PDFium 155.0.8044.0: runs 0 and 24), which a reading stated by hand, as the kernel's test is,
  // does not, so the line is taken from the reading and never written down.
  const first = reading.runs.find((/** @type {any} */ each) => each.text.startsWith('Monstera fixture heading'));
  const line =
    first === undefined
      ? []
      : // OVERLAPPING THE FIRST RUN'S HEIGHT, since a run's box is its glyphs' ink and a full stop's is shorter.
        reading.runs.filter((/** @type {any} */ each) => each.bottom < first.top && each.top > first.bottom);
  const body = reading.runs.find((/** @type {any} */ each) => squeezed(each.text) === squeezed(BODY));
  check(
    CASES[0] ?? '',
    first !== undefined &&
      first.members.length > 1 &&
      squeezed(line.map((/** @type {any} */ each) => each.text).join('')) === squeezed(HEADING) &&
      body !== undefined &&
      !line.includes(body),
    `PDFium's runs: ${JSON.stringify(reading.runs.map((/** @type {any} */ each) => ({ index: each.index, text: each.text, members: each.members.length })))}.`,
  );
  if (line.length === 0) return;

  /** @param {any} pageReading @param {string} text @param {'reflow' | 'shrink'} fit */
  const command = (pageReading, text, fit) => ({
    kind: 'editTextOperators',
    page: 0,
    ...kernel.blockEditOf([{ lines: [line.map((/** @type {any} */ each) => each.index)], soft: [false], text }]),
    fit,
    version: 1,
    _reading: pageReading,
  });

  /** @param {Uint8Array} image @param {any} pageReading @param {string} text @param {'reflow' | 'shrink'} fit */
  const edited = async (image, pageReading, text, fit = 'reflow') => {
    const session = await kernel.mupdfWriter.open(image);
    try {
      const before = await kernel.withDocument(session, (/** @type {any} */ document) =>
        kernel.joinedContent(kernel.pageContentStreams(document.findPage(0))),
      );
      const { _reading, ...wire } = command(pageReading, text, fit);
      const outcome = await kernel.applyEditTextOperators(session, wire, _reading).then(
        (/** @type {any} */ drawn) => ({ ok: true, error: null, drawn }),
        (/** @type {unknown} */ error) => ({ ok: false, error, drawn: null }),
      );
      const after = await kernel.withDocument(session, (/** @type {any} */ document) =>
        kernel.joinedContent(kernel.pageContentStreams(document.findPage(0))),
      );
      return { outcome, before, after, saved: outcome.ok ? await kernel.mupdfWriter.serialise(session) : null };
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  };

  const made = await edited(bytes, reading, EDITED);
  check(
    CASES[1] ?? '',
    made.outcome.ok && made.saved !== null,
    `the operator edit answered ${made.outcome.ok ? 'ok' : String(made.outcome.error)}.`,
  );

  const reread = made.saved === null ? null : await readRuns(made.saved);
  const words = reread === null ? '' : squeezed(reread.runs.map((/** @type {any} */ each) => each.text).join(''));
  check(
    CASES[2] ?? '',
    // THE NEW HEADING FOLLOWED BY THE NEXT LINE, so a full stop left behind by an edit of half the line (`reading..`)
    // is not read as success.
    words.includes(squeezed(`${EDITED}A second heading in the same face.`)) &&
      words.includes(squeezed(BODY)) &&
      !words.includes(squeezed(HEADING)),
    `PDFium read the saved page as ${JSON.stringify(reread?.runs.map((/** @type {any} */ each) => each.text) ?? null)}.`,
  );

  // THE BODY'S OWN OPERATOR, found in the content before the edit, must appear unchanged after it.
  const latin1 = (/** @type {Uint8Array} */ data) => new TextDecoder('latin1').decode(data);
  const bodyOperator = /<[0-9A-F]{40,}> Tj/u.exec(latin1(made.before))?.[0] ?? null;
  check(
    CASES[3] ?? '',
    bodyOperator !== null && latin1(made.after).includes(bodyOperator),
    `the body's operator before the edit: ${String(bodyOperator)}.`,
  );

  // A READING THAT IS NOT THIS PAGE'S, one text object too many, built from the real one so it would be written if
  // the writer did not compare the counts.
  const wrong = { ...reading, textObjects: [...reading.textObjects, (reading.textObjects.at(-1) ?? 0) + 1] };
  const refused = await edited(bytes, wrong, EDITED);
  check(
    CASES[4] ?? '',
    !refused.outcome.ok &&
      refused.outcome.error instanceof kernel.EditRefusedError &&
      refused.outcome.error.step === 'read-back' &&
      latin1(refused.after) === latin1(refused.before),
    `the edit with a wrong reading answered ${refused.outcome.ok ? 'ok' : String(refused.outcome.error)}.`,
  );

  // A TRANSLATION KEEPS THE PAGE'S LAYOUT (ADR-0181 Decision 10): the heading made longer, written with fit shrink, is one
  // line at a smaller size on the row it stood on; the same words reflowed wrap and leave only a part of them there. The
  // row is the vertical extent of the heading as PDFium read it before the edit, and what stands on it is read from the
  // saved bytes by PDFium, not by the writer.
  // THE PRINT'S OWN LETTERS ONLY, so no face is needed and the case asks about the layout alone.
  const LONGER = 'Monstera fixture heading. Monstera';
  /** @param {Uint8Array | null} saved */
  const rowAfter = async (saved) => {
    if (saved === null || first === undefined) return null;
    const read = await readRuns(saved);
    return squeezed(
      read.runs
        .filter((/** @type {any} */ each) => each.bottom < first.top && each.top > first.bottom)
        .map((/** @type {any} */ each) => each.text)
        .join(''),
    );
  };
  const shrunk = await edited(bytes, reading, LONGER, 'shrink');
  const shrunkRow = await rowAfter(shrunk.saved);
  check(
    CASES[7] ?? '',
    shrunk.outcome.ok && shrunkRow !== null && shrunkRow.includes(squeezed(LONGER)),
    `with shrink the row read ${JSON.stringify(shrunkRow)} (${shrunk.outcome.ok ? 'written' : String(shrunk.outcome.error)}).`,
  );
  const reflowed = await edited(bytes, reading, LONGER, 'reflow');
  const reflowedRow = await rowAfter(reflowed.saved);
  check(
    CASES[8] ?? '',
    // EITHER WAY IT DOES NOT STAY ON THE ROW: written wrapped, or refused by MuPDF's own reading because the second line
    // lands on the heading below it, which has no room. The same words are written on the row only with shrink.
    !reflowed.outcome.ok || (reflowedRow !== null && !reflowedRow.includes(squeezed(LONGER))),
    `with reflow the row read ${JSON.stringify(reflowedRow)} (${reflowed.outcome.ok ? 'written' : String(reflowed.outcome.error)}).`,
  );

  // A PLACEMENT, A MEASURE, A JOIN AND A SPLIT (ADR-0188): the heading is carried, scaled, turned, wrapped, joined to the
  // heading below it and split from it, and PDFium reads each from the saved bytes. Every number is a reading of where the
  // words stand, never what the writer meant to write.
  /** @param {any[]} blocks @param {any[]} inserts */
  const applied = async (blocks, inserts = []) => {
    const session = await kernel.mupdfWriter.open(bytes);
    try {
      const wire = { kind: 'editTextOperators', page: 0, ...kernel.blockEditOf(blocks, inserts), fit: 'reflow', version: 1 };
      const outcome = await kernel.applyEditTextOperators(session, wire, reading).then(
        (/** @type {any} */ drawn) => ({ ok: true, error: null, drawn }),
        (/** @type {unknown} */ error) => ({ ok: false, error, drawn: null }),
      );
      const content = await kernel.withDocument(session, (/** @type {any} */ document) =>
        kernel.joinedContent(kernel.pageContentStreams(document.findPage(0))),
      );
      return { outcome, content: new TextDecoder('latin1').decode(content), saved: outcome.ok ? await kernel.mupdfWriter.serialise(session) : null };
    } finally {
      await kernel.mupdfWriter.close(session);
    }
  };
  const headingBlock = { lines: [line.map((/** @type {any} */ each) => each.index)], soft: [false], text: HEADING };
  const second = reading.runs.filter((/** @type {any} */ each) => each.bottom < 667 && each.top > 650);
  const secondBlock = { lines: [second.map((/** @type {any} */ each) => each.index)], soft: [false], text: 'A second heading in the same face.' };
  const others = reading.runs.filter((/** @type {any} */ each) => !line.includes(each));
  const near = (/** @type {number} */ a, /** @type {number} */ b, tolerance = 0.9) => Math.abs(a - b) <= tolerance;
  /** The box of a set of runs: where the words stand. */
  const boxOf = (/** @type {any[]} */ runs) => ({
    left: Math.min(...runs.map((each) => each.left)),
    right: Math.max(...runs.map((each) => each.right)),
    bottom: Math.min(...runs.map((each) => each.bottom)),
    top: Math.max(...runs.map((each) => each.top)),
  });
  /** The runs of a saved page that are not one of the lines beside the heading, left where they were: the heading's pieces. */
  const piecesOf = (/** @type {any} */ read) =>
    read.runs.filter((/** @type {any} */ each) => !others.some((/** @type {any} */ other) => other.text === each.text && near(other.left, each.left) && near(other.bottom, each.bottom)));
  const originalBox = boxOf(line);
  /** Whether every line beside the heading is read in the saved page as it was, word for word and place for place. */
  const othersStand = (/** @type {any} */ read) =>
    others.every((/** @type {any} */ other) =>
      read.runs.some((/** @type {any} */ each) => each.text === other.text && near(each.left, other.left) && near(each.bottom, other.bottom)),
    );

  const moved = await applied([{ ...headingBlock, place: { move: { x: 40, y: 30 } } }]);
  const movedRead = moved.saved === null ? null : await readRuns(moved.saved);
  const movedBox = movedRead === null ? null : boxOf(piecesOf(movedRead));
  check(
    CASES[9] ?? '',
    movedBox !== null &&
      near(movedBox.left, originalBox.left + 40) &&
      near(movedBox.right, originalBox.right + 40) &&
      near(movedBox.bottom, originalBox.bottom + 30) &&
      near(movedBox.top, originalBox.top + 30) &&
      movedRead !== null &&
      othersStand(movedRead),
    `the heading read at ${JSON.stringify(movedBox)} against ${JSON.stringify(originalBox)} moved by (40, 30) (${moved.outcome.ok ? 'written' : String(moved.outcome.error)}).`,
  );
  // THE CONTROL: the words written again with no placement are read where the heading was.
  const stayed = await applied([{ ...headingBlock, text: EDITED }]);
  const stayedRead = stayed.saved === null ? null : await readRuns(stayed.saved);
  const stayedBox = stayedRead === null ? null : boxOf(piecesOf(stayedRead));
  check(
    CASES[10] ?? '',
    stayedBox !== null && near(stayedBox.left, originalBox.left) && near(stayedBox.bottom, originalBox.bottom),
    `the heading edited with no placement read at ${JSON.stringify(stayedBox)} against ${JSON.stringify(originalBox)}.`,
  );

  const scaled = await applied([{ ...headingBlock, place: { scale: 0.5 } }]);
  const scaledRead = scaled.saved === null ? null : await readRuns(scaled.saved);
  const scaledBox = scaledRead === null ? null : boxOf(piecesOf(scaledRead));
  const originalWidth = originalBox.right - originalBox.left;
  check(
    CASES[11] ?? '',
    scaledBox !== null &&
      Math.abs((scaledBox.right - scaledBox.left) / originalWidth - 0.5) < 0.03 &&
      near(scaledBox.left, originalBox.left) &&
      near(scaledBox.top, originalBox.top, 1.5) &&
      scaledRead !== null &&
      othersStand(scaledRead),
    `the scaled heading read at ${JSON.stringify(scaledBox)} against ${JSON.stringify(originalBox)}.`,
  );

  const turned = await applied([{ ...headingBlock, place: { rotate: 90 } }]);
  const turnedRead = turned.saved === null ? null : await readRuns(turned.saved);
  const turnedBox = turnedRead === null ? null : boxOf(piecesOf(turnedRead));
  const centreOf = (/** @type {any} */ box) => ({ x: (box.left + box.right) / 2, y: (box.bottom + box.top) / 2 });
  check(
    CASES[12] ?? '',
    turnedBox !== null &&
      turnedBox.top - turnedBox.bottom > 3 * (turnedBox.right - turnedBox.left) &&
      Math.abs(centreOf(turnedBox).x - centreOf(originalBox).x) < 5 &&
      Math.abs(centreOf(turnedBox).y - centreOf(originalBox).y) < 5,
    `the turned heading read at ${JSON.stringify(turnedBox)} against ${JSON.stringify(originalBox)}.`,
  );
  check(
    CASES[13] ?? '',
    originalWidth > 3 * (originalBox.top - originalBox.bottom),
    `the heading as it was is ${originalWidth.toFixed(1)} wide and ${(originalBox.top - originalBox.bottom).toFixed(1)} tall.`,
  );

  // THE MEASURE CASES ARE LIFTED CLEAR of the heading below, since a wrapped heading's lines go down and PDFium reads two
  // lines that overlap as one: moving up a hundred points is a north-west handle's own gesture, and the move is the same
  // in the control.
  const lift = { x: 0, y: 100 };
  /** The lines of a read page's heading pieces: runs grouped by the baseline they stand on, top first. */
  const linesOfPieces = (/** @type {any[]} */ pieces) => {
    /** @type {any[][]} */
    const rows = [];
    for (const piece of [...pieces].sort((a, b) => b.top - a.top)) {
      const row = rows.find((each) => each.some((member) => Math.abs(member.top - piece.top) < 6 || Math.abs(member.bottom - piece.bottom) < 6));
      if (row === undefined) rows.push([piece]);
      else row.push(piece);
    }
    return rows;
  };
  const narrow = await applied([{ ...headingBlock, place: { move: lift, width: 120 } }]);
  const narrowRead = narrow.saved === null ? null : await readRuns(narrow.saved);
  const narrowPieces = narrowRead === null ? [] : piecesOf(narrowRead);
  const narrowRows = linesOfPieces(narrowPieces);
  const readInOrder = (/** @type {any[][]} */ rows) =>
    squeezed(rows.map((row) => [...row].sort((a, b) => a.left - b.left).map((each) => each.text).join('')).join(''));
  check(
    CASES[14] ?? '',
    narrow.outcome.ok &&
      narrowRows.length >= 2 &&
      readInOrder(narrowRows) === squeezed(HEADING) &&
      narrowPieces.every((/** @type {any} */ each) => each.right <= originalBox.left + 120 + 4) &&
      near(Math.min(...(narrowRows[0] ?? []).map((/** @type {any} */ each) => each.left)), originalBox.left, 2) &&
      // AND THE FIRST LINE IS A HUNDRED UP, so the lift this case is made clear of the heading below by is itself read.
      near(Math.max(...(narrowRows[0] ?? []).map((/** @type {any} */ each) => each.top)), originalBox.top + 100, 1.5),
    `the heading with a measure of 120 read as ${JSON.stringify(narrowRows.map((row) => row.map((/** @type {any} */ each) => each.text)))} (${narrow.outcome.ok ? 'written' : String(narrow.outcome.error)}).`,
  );
  const lifted = await applied([{ ...headingBlock, place: { move: lift } }]);
  const liftedRead = lifted.saved === null ? null : await readRuns(lifted.saved);
  check(
    CASES[15] ?? '',
    liftedRead !== null &&
      linesOfPieces(piecesOf(liftedRead)).length === 1 &&
      near(boxOf(piecesOf(liftedRead)).top, originalBox.top + 100, 1.5),
    `the heading lifted with no measure read in ${String(liftedRead === null ? null : linesOfPieces(piecesOf(liftedRead)).length)} line(s).`,
  );
  const west = await applied([{ ...headingBlock, place: { move: { x: 30, y: 100 }, width: 150 } }]);
  const westRead = west.saved === null ? null : await readRuns(west.saved);
  const westRows = westRead === null ? [] : linesOfPieces(piecesOf(westRead));
  check(
    CASES[16] ?? '',
    west.outcome.ok &&
      westRows.length >= 2 &&
      readInOrder(westRows) === squeezed(HEADING) &&
      near(Math.min(...westRows.flat().map((/** @type {any} */ each) => each.left)), originalBox.left + 30, 2.5) &&
      westRows.flat().every((/** @type {any} */ each) => each.right <= originalBox.left + 30 + 150 + 4),
    `the heading moved 30 and given a measure of 150 read as ${JSON.stringify(westRows.map((row) => row.map((/** @type {any} */ each) => each.text)))} (${west.outcome.ok ? 'written' : String(west.outcome.error)}).`,
  );

  // A JOIN is the upper block's words with the lower's after them and the lower emptied: one edit of two blocks.
  const SECOND_WORDS = 'A second heading in the same face.';
  const joined = await applied([{ ...headingBlock, text: `${HEADING} ${SECOND_WORDS}` }, { ...secondBlock, text: '' }]);
  const joinedRead = joined.saved === null ? null : await readRuns(joined.saved);
  const joinedWords = joinedRead === null ? '' : squeezed([...joinedRead.runs].sort((a, b) => b.top - a.top || a.left - b.left).map((/** @type {any} */ each) => each.text).join(''));
  check(
    CASES[17] ?? '',
    joined.outcome.ok &&
      joinedWords.includes(squeezed(`${HEADING}${SECOND_WORDS}`)) &&
      joinedRead !== null &&
      !joinedRead.runs.some((/** @type {any} */ each) => each.text === 'A second heading in the same face' && near(each.bottom, 651.4, 1.5)) &&
      joinedWords.includes(squeezed(BODY)),
    `the joined page read as ${JSON.stringify(joinedRead?.runs.map((/** @type {any} */ each) => each.text) ?? null)} (${joined.outcome.ok ? 'written' : String(joined.outcome.error)}).`,
  );

  // A SPLIT is an entry for each half, the second moved down: here the heading below it is the second half, moved 15 down.
  const split = await applied([headingBlock, { ...secondBlock, text: SECOND_WORDS, place: { move: { x: 0, y: -15 } } }]);
  const splitRead = split.saved === null ? null : await readRuns(split.saved);
  const secondBefore = boxOf(second);
  const secondAfter = splitRead === null ? null : boxOf(splitRead.runs.filter((/** @type {any} */ each) => squeezed(each.text) !== squeezed(BODY) && each.bottom < 660 && each.top > 630));
  check(
    CASES[18] ?? '',
    split.outcome.ok &&
      secondAfter !== null &&
      near(secondAfter.bottom, secondBefore.bottom - 15) &&
      near(secondAfter.left, secondBefore.left) &&
      splitRead !== null &&
      line.every((/** @type {any} */ each) => splitRead.runs.some((/** @type {any} */ run) => run.text === each.text && near(run.left, each.left) && near(run.bottom, each.bottom))),
    `the second half read at ${JSON.stringify(secondAfter)} against ${JSON.stringify(secondBefore)} (${split.outcome.ok ? 'written' : String(split.outcome.error)}).`,
  );

  // THE RESOLVER'S FACE AND THE BOX (ADR-0177), bound as the MuPDF host binds them, by their folders. The new words need
  // z and p, which the print's subset lacks, and a code point no font carries.
  const fonts = fontsDirectory(ROOT);
  if (!existsSync(fonts)) {
    check(CASES[5] ?? '', false, `${fonts} is absent; run scripts/provision/fonts.mjs`);
    check(CASES[6] ?? '', false, 'not reached: the bundled fonts are absent');
    return;
  }
  kernel.bindEditFolders(fonts, null);
  const faced = await edited(bytes, reading, FACED);
  kernel.bindEditFaces(null);
  check(
    CASES[5] ?? '',
    faced.outcome.ok &&
      faced.saved !== null &&
      JSON.stringify(faced.outcome.drawn) === JSON.stringify({ boxed: [{ character: UNASSIGNED, page: 0 }], more: 0 }),
    `the edit needing a face answered ${faced.outcome.ok ? JSON.stringify(faced.outcome.drawn) : String(faced.outcome.error)}.`,
  );
  const facedRead = faced.saved === null ? null : await readRuns(faced.saved);
  const facedWords = facedRead === null ? '' : squeezed(facedRead.runs.map((/** @type {any} */ each) => each.text).join(''));
  check(
    CASES[6] ?? '',
    // THE BOX READS AS ITS CHARACTER, not as U+25A1, and the letters in the added face read as themselves.
    facedWords.includes(squeezed(FACED)) && !facedWords.includes(String.fromCodePoint(0x25a1)) && facedWords.includes(squeezed(BODY)),
    `PDFium read the saved page as ${JSON.stringify(facedRead?.runs.map((/** @type {any} */ each) => each.text) ?? null)}.`,
  );

  // A BOX OF TEXT ADDED TO THE PAGE (ADR-0188), set in the resolver's face where the box says.
  const BOX_WORDS = 'A new box of text';
  kernel.bindEditFolders(fonts, null);
  const boxed = await applied([], [{ left: 100, baseline: 400, measure: 200, size: 14, text: BOX_WORDS }]);
  kernel.bindEditFaces(null);
  const boxedRead = boxed.saved === null ? null : await readRuns(boxed.saved);
  const boxRun = boxedRead?.runs.find((/** @type {any} */ each) => squeezed(each.text) === squeezed(BOX_WORDS));
  check(
    CASES[19] ?? '',
    boxed.outcome.ok &&
      boxRun !== undefined &&
      near(boxRun.left, 100, 1.5) &&
      boxRun.bottom > 400 - 6 &&
      boxRun.bottom < 400 + 1 &&
      boxRun.top - boxRun.bottom > 5 &&
      boxRun.top - boxRun.bottom < 20 &&
      boxedRead !== null &&
      othersStand(boxedRead) &&
      line.every((/** @type {any} */ each) => boxedRead.runs.some((/** @type {any} */ run) => run.text === each.text && near(run.left, each.left) && near(run.bottom, each.bottom))),
    `PDFium read the box as ${JSON.stringify(boxRun === undefined ? null : { text: boxRun.text, left: boxRun.left, bottom: boxRun.bottom, top: boxRun.top })} (${boxed.outcome.ok ? 'written' : String(boxed.outcome.error)}).`,
  );
  check(
    CASES[20] ?? '',
    !reading.runs.some((/** @type {any} */ each) => squeezed(each.text).includes(squeezed(BOX_WORDS))) &&
      /\/MonsteraF\d+ 14 Tf/u.test(boxed.content) &&
      !(await (async () => {
        // WITH NO FACE BOUND the same box is refused, and the page is as it came.
        const refused = await applied([], [{ left: 100, baseline: 400, measure: 200, size: 14, text: BOX_WORDS }]);
        return refused.outcome.ok;
      })()),
    'the page held no such words before, the box carried a font of its own, and with no face bound it was refused.',
  );
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'a Type 3 page edited by PDFium’s reading and MuPDF’s writer',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, TYPE3_EDIT, 3);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const { blockEditOf } = await import('../../packages/contract/dist/commands.js');
  const { mupdfWriter, withDocument } = await import('../../packages/kernel/dist/mupdfWriter.js');
  const { applyEditTextOperators } = await import('../../packages/kernel/dist/textOperatorEdit.js');
  const { EditRefusedError } = await import('../../packages/kernel/dist/textEditRefusals.js');
  const { joinedContent } = await import('../../packages/kernel/dist/textOperators.js');
  const { pageContentStreams } = await import('../../packages/kernel/dist/pageContent.js');
  const { bindEditFaces, bindEditFolders } = await import('../../packages/kernel/dist/editFaces.js');
  await run(pdfium, {
    blockEditOf,
    mupdfWriter,
    withDocument,
    applyEditTextOperators,
    EditRefusedError,
    joinedContent,
    pageContentStreams,
    bindEditFaces,
    bindEditFolders,
  });
  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} Type 3 edit case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('Type 3 edit case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
