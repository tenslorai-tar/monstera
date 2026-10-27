// @ts-check
/**
 * What an Edit text edit of one block of a catalogue page (`scripts/research/editCatalogue.mjs`) must leave behind,
 * checked from the bytes before and after: the reusable check every later test of the editor and the writer runs.
 *
 * ## What is checked
 *
 * - READ BACK BY BOTH ENGINES: the block's characters after the edit, as MuPDF reads them and as PDFium's reading (the
 *   editor's) reads them, are the expected words. Spaces are not compared: each engine infers its own from gaps.
 * - NOTHING OUTSIDE THE BLOCK CHANGED: every character MuPDF read outside the block is where it was; every PDFium run
 *   outside it is as it was; every drawing and picture not inside the block is as it was; every link is as it was; and
 *   no pixel outside the block's ink before, or the ink of its characters after, differs at all. The block may grow
 *   DOWNWARD in its own direction and overlap what is below (the owner's decision, cloud run 22); its new characters
 *   must stay in its column, between its left and right, and not above its top.
 * - NOTHING REFUSED, NOTHING UNSEEN, NOTHING LOGGED: the write was made, it changed a pixel inside the block, each of
 *   the block's characters after the edit draws something, and the writer noted no defect.
 * - THE FONT RULE: no character the edit wrote is in a drawn (Type 3) font.
 *
 * ## The threshold, and how it was measured
 *
 * A pixel is changed if any channel differs by any amount — exact, because MuPDF draws the same operators to the same
 * pixels: re-saving every catalogue page with no change differs in 0 pixels (`editCatalogue.proof.mjs`, ROUND TRIP).
 * What tolerance there is lies in WHERE a block may draw, which is its characters' boxes widened by {@link MARGIN}:
 * anti-aliasing and a glyph's overshoot put ink outside the box MuPDF reads for it. That spread is measured on every
 * run of the proof, by drawing each block of each page and the same page without it and finding the farthest changed
 * pixel from the block's character boxes.
 *
 * Usage: import { expectEdit } from './editExpectations.mjs'
 *   const failures = await expectEdit({ kernel, pdfium }, { before, after, block, expected, outcome })
 */

import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from '@cantoo/pdf-lib';

import { charactersOf, compare, inkOf, render, renderWithoutText, SCALE } from './pageDisturbance.mjs';

/**
 * How far outside its characters' boxes a block's own pixels may lie, in points. MEASURED 2026-10-26 by
 * `editCatalogue.proof.mjs` (ANTI-ALIASING SPREAD) over every visible block of the 24 catalogue pages at 144 dpi on
 * Linux, the native MuPDF 1.28.0: the farthest pixel was 0.5 pt out — one device pixel, on the Times paragraph of
 * `03-standard-fonts-not-embedded`. The proof fails unless a run measures exactly this, rounded up to the device pixel
 * — the instrument's step — so the figure cannot drift from the measurement in either direction unseen. One pixel is
 * the smallest step there is: the figure has no headroom, and it was measured on Linux; Windows CI measures it again.
 */
export const MARGIN = 0.5;

/**
 * @typedef {import('./pageDisturbance.mjs').Box} Box
 * @typedef {import('../research/editCatalogue.mjs').Block} Block
 * @typedef {{ character: string, x: number, y: number, box: Box, font: string }} Char
 * @typedef {{ refused?: unknown, noted?: readonly string[] }} Outcome
 */

/** Text without the spaces either engine infers. @param {string} text */
const bare = (text) => text.replace(/\s+/gu, '');

/** @param {[number, number]} point @param {number} angle @returns {[number, number]} */
function unturned([x, y], angle) {
  const r = (-angle * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}

/** How a block is set on the page: its turn, and the slant of its letters. @typedef {{ angle: number, skew?: number }} Direction */

/**
 * A box in the block's own space: its corners turned back by the block's angle and its slant taken out, so that
 * "below" and "within its width" mean what they mean to the block's own lines.
 * @param {Box} box @param {Direction} direction
 */
function inBlockSpace(box, { angle, skew = 0 }) {
  const corners = [
    [box.left, box.bottom],
    [box.right, box.bottom],
    [box.left, box.top],
    [box.right, box.top],
  ].map((point) => {
    const [x, y] = unturned(/** @type {[number, number]} */ (point), angle);
    return /** @type {[number, number]} */ ([x - y * skew, y]);
  });
  return {
    left: Math.min(...corners.map(([x]) => x)),
    right: Math.max(...corners.map(([x]) => x)),
    bottom: Math.min(...corners.map(([, y]) => y)),
    top: Math.max(...corners.map(([, y]) => y)),
  };
}

/** Whether a box's centre lies in `box` widened by `margin`. @param {Box} inner @param {Box} box @param {number} margin */
function centredIn(inner, box, margin) {
  const x = (inner.left + inner.right) / 2;
  const y = (inner.bottom + inner.top) / 2;
  return x >= box.left - margin && x <= box.right + margin && y >= box.bottom - margin && y <= box.top + margin;
}

/**
 * The words among `members`, in the reading order of `chars` (a page's characters as MuPDF read them): runs of letters
 * and digits on one line. A WORD IS A RUN OF LETTERS AND DIGITS: punctuation touching a new word is the old text's.
 * @param {Char[]} chars @param {Char[]} members @param {Direction} direction @returns {Char[][]}
 */
function wordsIn(chars, members, direction) {
  const letter = /[\p{L}\p{N}\p{M}]/u;
  const inBlock = new Set(members.filter((each) => letter.test(each.character)));
  /** @type {Char[][]} */
  const words = [];
  /** @type {Box | null} */
  let previous = null;
  for (const each of chars) {
    if (!inBlock.has(each)) {
      previous = null;
      continue;
    }
    // IN THE BLOCK'S OWN SPACE, so a turned block's letters run along its lines and not the page's x axis (measured
    // 2026-10-26: the turned page read every letter as a word of its own).
    // A WORD ENDS at a gap as well as at a space: a writer may part two words by moving the pen and write no space
    // character, and the engines infer one from the gap (measured 2026-10-26: "reader" and "whatever" read as one word).
    const at = inBlockSpace(each.box, direction);
    const height = at.top - at.bottom;
    const sameLine = previous !== null && Math.abs((previous.top + previous.bottom) / 2 - (at.top + at.bottom) / 2) < height / 2;
    const gap = previous === null ? 0 : Math.max(at.left - previous.right, previous.left - at.right);
    if (sameLine && gap < height * 0.15) words[words.length - 1]?.push(each);
    else words.push([each]);
    previous = at;
  }
  return words;
}

/** @param {Char[]} word */
const textOfWord = (word) => word.map((each) => each.character).join('');

/** The box round a word's characters. @param {Char[]} word @returns {Box} */
const boxOfWord = (word) => ({
  left: Math.min(...word.map((each) => each.box.left)),
  right: Math.max(...word.map((each) => each.box.right)),
  bottom: Math.min(...word.map((each) => each.box.bottom)),
  top: Math.max(...word.map((each) => each.box.top)),
});

/** A character by what it is, where its pen is and how tall it is, to half a point. @param {Char} each */
const keyOfChar = (each) =>
  `${each.character}@${String(Math.round(each.x * 2))},${String(Math.round(each.y * 2))}/${String(Math.round((each.box.top - each.box.bottom) * 2))}`;

/**
 * `after` less every item of `kept` matched by key, one for one — the multiset difference — with the items of `kept`
 * that found no match.
 * @template T @param {T[]} after @param {T[]} kept @param {(item: T) => string} key
 */
function remainder(after, kept, key) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const item of after) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  const missing = kept.filter((item) => {
    const left = counts.get(key(item)) ?? 0;
    if (left === 0) return true;
    counts.set(key(item), left - 1);
    return false;
  });
  const rest = after.filter((item) => {
    const left = counts.get(key(item)) ?? 0;
    if (left === 0) return false;
    counts.set(key(item), left - 1);
    return true;
  });
  return { rest, missing };
}

/**
 * A reading's text in the engine's own order and in line order — lines top down in the block's own direction, each
 * left to right — since a writer may write a block's lines in another order than they read. Either is accepted.
 * @param {{ text: string, box: Box }[]} pieces @param {Direction} direction
 */
function readings(pieces, direction) {
  const placed = pieces.map((piece) => ({ ...piece, at: inBlockSpace(piece.box, direction) }));
  const sorted = [...placed].sort((a, b) => {
    const height = Math.max(a.at.top - a.at.bottom, b.at.top - b.at.bottom, 1);
    const ay = (a.at.top + a.at.bottom) / 2;
    const by = (b.at.top + b.at.bottom) / 2;
    return Math.abs(ay - by) > height / 2 ? by - ay : a.at.left - b.at.left;
  });
  return [bare(pieces.map((piece) => piece.text).join('')), bare(sorted.map((piece) => piece.text).join(''))];
}

/**
 * PDFium's reading of a page, its forms promoted into it in memory so a form's words and drawings are read as the
 * page's: objects read before the promotion saw a form as one object, so a drawing removed inside one went unseen as an
 * object (measured 2026-10-26, the pull quote's rule).
 * @param {any} pdfium @param {Uint8Array} bytes @param {number} page
 */
async function pdfiumReading(pdfium, bytes, page) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    await pdfium.promoteFormObjects(session, page);
    const objects = await pdfium.pageObjects(session, page);
    const read = await pdfium.textRuns(session, page);
    return { runs: /** @type {{ text: string, left: number, right: number, bottom: number, top: number }[]} */ (read.runs), objects: /** @type {any[]} */ (objects) };
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/**
 * A page drawn by MuPDF with its text and without it (`renderWithoutText`): what the text draws is where they differ.
 * MuPDF's own fallback faces draw a font the file does not embed alike on every machine; PDFium's drawing of one depends
 * on the machine's fonts, and judged a Japanese line unseen on a runner without a Japanese font (2026-10-26).
 * @param {any} kernel @param {Uint8Array} bytes @param {number} page
 */
function textInk(kernel, bytes, page) {
  return { withText: render(kernel, bytes, page).rgb, without: renderWithoutText(kernel, bytes, page).rgb };
}

/**
 * The names MuPDF gives the page's drawn (Type 3) fonts, its forms' included: a font is drawn by its dictionary's
 * `/Subtype`, as the kernel decides it, and MuPDF names one by its `/Name` where it has one and `Type3 (n 0 R)` where
 * not (`pdf-type3.c`, MuPDF 1.28.0). Telling a drawn font by MuPDF's name alone was blind to a named one (the stage
 * audit of 2026-10-26). A name an ordinary font on the page also has cannot say which drew a character, so it throws.
 * @param {Uint8Array} bytes @param {number} index @returns {Promise<Set<string>>}
 */
async function drawnFontNames(bytes, index) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const context = doc.context;
  /** @param {unknown} value */
  const resolved = (value) => (value instanceof PDFRef ? context.lookup(value) : value);
  const drawn = new Set();
  const ordinary = new Set();
  const seen = new Set();
  /** @param {unknown} resources */
  const walk = (resources) => {
    if (!(resources instanceof PDFDict) || seen.has(resources)) return;
    seen.add(resources);
    const fonts = resolved(resources.get(PDFName.of('Font')));
    if (fonts instanceof PDFDict) {
      for (const [, ref] of fonts.entries()) {
        const font = resolved(ref);
        if (!(font instanceof PDFDict)) continue;
        const own = font.get(PDFName.of('Name'));
        if (String(font.get(PDFName.of('Subtype'))) === '/Type3') {
          drawn.add(own instanceof PDFName ? own.decodeText() : `Type3 (${ref instanceof PDFRef ? String(ref.objectNumber) : '0'} 0 R)`);
        } else {
          ordinary.add(String(font.get(PDFName.of('BaseFont')) ?? '').replace(/^\/(?:[A-Z]{6}\+)?/u, ''));
        }
      }
    }
    const xobjects = resolved(resources.get(PDFName.of('XObject')));
    if (xobjects instanceof PDFDict) {
      for (const [, ref] of xobjects.entries()) {
        const xobject = resolved(ref);
        if (xobject instanceof PDFRawStream) walk(resolved(xobject.dict.get(PDFName.of('Resources'))));
      }
    }
  };
  walk(resolved(doc.getPage(index).node.get(PDFName.of('Resources'))));
  const shared = [...drawn].filter((name) => ordinary.has(name.replace(/^[A-Z]{6}\+/u, '')));
  if (shared.length > 0) throw new Error(`a drawn font and an ordinary one are both named ${shared.join(', ')}, so MuPDF's name cannot say which drew a character`);
  return drawn;
}

/** MuPDF's links on a page, by their box and target. @param {any} kernel @param {Uint8Array} bytes @param {number} page */
function linksOf(kernel, bytes, page) {
  const document = kernel.mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  try {
    return /** @type {any[]} */ (document.loadPage(page).getLinks()).map((link) => `${link.getBounds().map((/** @type {number} */ n) => Math.round(n * 2)).join(',')} ${String(link.getURI())}`);
  } finally {
    document.destroy();
  }
}

/**
 * A list item a page declares: its first word, the baseline it stands on before any edit, and where its marker is drawn
 * as a shape rather than as characters, that shape's box.
 * @typedef {{ word: string, y: number }} ListItem
 */

/**
 * The item's first word as MuPDF reads it, the occurrence nearest the line it stood on, and its marker: the characters
 * on its line before it (a bullet, a number), or a drawn shape just before it. `undefined` where the word is not read.
 * @param {readonly Char[]} chars @param {ListItem} item @param {readonly Box[]} drawn
 */
function itemAndMarker(chars, item, drawn) {
  const visible = chars.filter((each) => each.character.trim() !== '');
  /** @type {{ word: Char, line: Char[] } | undefined} */
  let found;
  for (const first of visible) {
    if (first.character !== item.word[0]) continue;
    const line = visible.filter((each) => Math.abs(each.y - first.y) <= 1).sort((a, b) => a.x - b.x);
    const at = line.indexOf(first);
    const spelt = line.slice(at, at + item.word.length).map((each) => each.character).join('');
    if (spelt !== item.word || /\p{L}/u.test(line[at - 1]?.character ?? '') && (first.x - (line[at - 1]?.box.right ?? 0)) < 1) continue;
    if (found === undefined || Math.abs(first.y - item.y) < Math.abs(found.word.y - item.y)) found = { word: first, line };
  }
  if (found === undefined) return undefined;
  const { word, line } = found;
  const height = word.box.top - word.box.bottom;
  const before = line.filter((each) => each.box.right <= word.box.left + 0.5 && word.box.left - each.box.right <= 3 * height);
  if (before.length > 0) {
    return { word, marker: { left: Math.min(...before.map((each) => each.box.left)), y: word.y } };
  }
  const shape = drawn.find((box) => {
    const middle = (box.bottom + box.top) / 2;
    return middle >= word.box.bottom && middle <= word.box.top && box.right <= word.box.left + 0.5 && word.box.left - box.right <= 3 * height;
  });
  return { word, marker: shape === undefined ? undefined : { left: shape.left, y: (shape.bottom + shape.top) / 2 } };
}

/**
 * EVERY LIST ITEM'S MARKER KEEPS ITS PLACE AND ITS GAP: its left to the item's first letter, and its height against the
 * first letter's, are what they were (the local agent's walk of 2026-10-27, a browser-printed list whose edited item's
 * bullet moved onto its words). A marker that the edit left beside other words, or whose gap closed, is a failure.
 * @param {readonly Char[]} beforeChars @param {readonly Char[]} afterChars @param {{ items: readonly ListItem[], drawn: readonly Box[] }} list
 */
export function listMarkerFailures(beforeChars, afterChars, list) {
  /** @type {string[]} */
  const failures = [];
  for (const item of list.items) {
    const was = itemAndMarker(beforeChars, item, list.drawn);
    if (was?.marker === undefined) throw new Error(`the list item “${item.word}” at ${String(item.y)} has no marker before the edit, so nothing below could fail`);
    const now = itemAndMarker(afterChars, item, list.drawn);
    if (now === undefined) continue;
    if (now.marker === undefined) {
      failures.push(`A LIST MARKER LEFT ITS ITEM: no marker stands before “${item.word}” on its line`);
      continue;
    }
    const gapWas = was.word.box.left - was.marker.left;
    const gapNow = now.word.box.left - now.marker.left;
    const riseWas = was.word.y - was.marker.y;
    const riseNow = now.word.y - now.marker.y;
    if (Math.abs(gapNow - gapWas) > 0.5 || Math.abs(riseNow - riseWas) > 0.5) {
      failures.push(`A LIST MARKER MOVED: before “${item.word}” its gap was ${gapWas.toFixed(2)} pt and is ${gapNow.toFixed(2)}, its rise ${riseWas.toFixed(2)} and ${riseNow.toFixed(2)}`);
    }
  }
  return failures;
}

/**
 * Every way the edit of `block` broke what an Edit text edit must leave, as sentences; empty when it held.
 *
 * @param {{ kernel: any, pdfium: any }} engines `kernel.mupdf` is the built `mupdfRaw.js`; `pdfium` the built `pdfiumFfi.js`
 * @param {{ before: Uint8Array, after: Uint8Array | null, page: number, block: Block, expected: string, outcome?: Outcome, list?: { items: readonly ListItem[], drawn: readonly Box[] } | undefined }} edit
 *   `after` is null where the write was refused; `expected` is the block's text as the edit should leave it; `list` the
 *   page's list items, whose markers must keep their place and gap ({@link listMarkerFailures})
 * @returns {Promise<string[]>}
 */
export async function expectEdit({ kernel, pdfium }, { before, after, page, block, expected, outcome = {}, list }) {
  /** @type {string[]} */
  const failures = [];
  if (outcome.refused !== undefined || after === null) {
    failures.push(`REFUSED: ${String(/** @type {any} */ (outcome.refused)?.message ?? outcome.refused ?? 'no bytes were written')}`);
    return failures;
  }
  for (const note of outcome.noted ?? []) failures.push(`LOGGED: the write noted “${note}”`);

  /** The block's turn and slant, which "below" and "its width" are measured in. @type {Direction} */
  const direction = block;
  const beforeChars = /** @type {Char[]} */ (charactersOf(kernel, before, page));
  const afterChars = /** @type {Char[]} */ (charactersOf(kernel, after, page));
  if (list !== undefined) failures.push(...listMarkerFailures(beforeChars, afterChars, list));
  const owned = (/** @type {Box} */ box) => centredIn(box, block.box, MARGIN);
  const ownBefore = beforeChars.filter((each) => owned(each.box));
  if (ownBefore.filter((each) => each.character.trim() !== '').length === 0) {
    // AN EMPTY BLOCK IS A BROKEN LOOKUP, not a clean one (CLAUDE.md item 4b): every check below would pass on it.
    throw new Error(`MuPDF reads no character in block “${block.id}” before the edit, so nothing below could fail`);
  }

  // OUTSIDE THE BLOCK, MuPDF: every character there before is there after, the same character at the same place.
  const othersBefore = beforeChars.filter((each) => !owned(each.box) && each.character.trim() !== '');
  const { rest: unmatched, missing: lost } = remainder(
    afterChars.filter((each) => each.character.trim() !== ''),
    othersBefore,
    keyOfChar,
  );
  // A CHARACTER FROM OUTSIDE THE BLOCK THAT MOVED is the same character found near where it was, and is the
  // neighbour's, not the block's: left among the block's, it would read as the block's words and make the pixels it
  // moved through an area the block may draw in — the pixel check was blind to a moved neighbour until this (measured
  // 2026-10-26). Within 3 pt; one moved farther stays among the block's and fails the read-back instead.
  const displaced = new Set();
  for (const gone of lost) {
    const near = unmatched.find(
      (each) => !displaced.has(each) && each.character === gone.character && Math.abs(each.x - gone.x) <= 3 && Math.abs(each.y - gone.y) <= 3,
    );
    if (near !== undefined) displaced.add(near);
  }
  const written = unmatched.filter((each) => !displaced.has(each));
  if (lost.length > 0) {
    failures.push(
      `MOVED OR REMOVED OUTSIDE THE BLOCK (MuPDF): ${String(lost.length)} character(s) are not where they were, ` +
        `the first “${lost.slice(0, 12).map((each) => each.character).join('')}” at ${lost[0]?.x.toFixed(1) ?? '?'}, ${lost[0]?.y.toFixed(1) ?? '?'}`,
    );
  }

  // THE BLOCK'S CHARACTERS AFTER: what is left once the unchanged outside is taken away. They stay in its column, in
  // the block's own direction: not left or right of it, not above its top.
  // EACH CHARACTER TURNED BACK, then their extent: the extent of a turned block taken first and turned back after is a
  // box tens of points too large, and a block moved 30 pt up still sat inside it (measured 2026-10-26, the 30° block).
  const column = ownBefore
    .map((each) => inBlockSpace(each.box, direction))
    .reduce(
      (box, at) => ({
        left: Math.min(box.left, at.left),
        right: Math.max(box.right, at.right),
        bottom: Math.min(box.bottom, at.bottom),
        top: Math.max(box.top, at.top),
      }),
      { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity },
    );
  const astray = written.filter((each) => {
    const at = inBlockSpace(each.box, direction);
    const x = (at.left + at.right) / 2;
    const y = (at.bottom + at.top) / 2;
    return x < column.left - MARGIN || x > column.right + MARGIN || y > column.top + MARGIN;
  });
  if (astray.length > 0) {
    failures.push(`OUTSIDE ITS COLUMN: ${String(astray.length)} of the block’s characters lie left, right or above it, the first “${astray.slice(0, 12).map((each) => each.character).join('')}”`);
  }

  const want = bare(expected);
  const mupdfRead = readings(written.map((each) => ({ text: each.character, box: each.box })), direction);
  if (!mupdfRead.includes(want)) failures.push(`READ BACK (MuPDF): “${mupdfRead[0] ?? ''}”, where “${want}” was expected`);

  // THE FONT RULE: a NEW word — one the block did not hold before — is never in a drawn font. By word and not by place,
  // since the owner's rule lets an unchanged word that re-flows keep the face the page drew it in.
  // The same comparison says which words the edit REPLACED and which it KEPT, which the scan's rule below needs.
  const wordsBefore = wordsIn(beforeChars, ownBefore, direction);
  const wordsAfter = wordsIn(afterChars, written, direction);
  const { rest: newWords, missing: replacedWords } = remainder(wordsAfter, wordsBefore, textOfWord);
  const { rest: keptWords } = remainder(wordsBefore, replacedWords, textOfWord);
  // A SCAN IS REDRAWN BY THE LINE (ADR-0271's correction of 2026-10-26, the owner's answer): every word on a line that
  // holds a replaced or a new word is drawn again and its old ink covered. Two words stand on one line where their
  // middles, in the block's own space, are within half the shorter one's height.
  const changed = [...replacedWords, ...newWords];
  const middleOf = (/** @type {Char[]} */ word) => {
    const box = inBlockSpace(boxOfWord(word), direction);
    return { y: (box.bottom + box.top) / 2, height: box.top - box.bottom };
  };
  const onAChangedLine = (/** @type {Char[]} */ word) => {
    const here = middleOf(word);
    return changed.some((other) => {
      const there = middleOf(other);
      return Math.abs(here.y - there.y) <= Math.min(here.height, there.height) / 2;
    });
  };
  const redrawnBefore = wordsBefore.filter(onAChangedLine);
  const redrawnAfter = wordsAfter.filter(onAChangedLine);
  // WORDS AS WORDS: the read-back above leaves spaces out, so two words set against each other with neither a space nor
  // a gap pass it. The block's words, as letter runs, must be the expected ones (measured 2026-10-26: today's writer set
  // a new word against the next with no space after a re-wrap, and the page read "readerwhatever").
  const wordsWanted = expected.match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
  const { rest: wordsExtra, missing: wordsLost } = remainder(wordsAfter.map(textOfWord), wordsWanted, (word) => word);
  if (wordsExtra.length > 0 || wordsLost.length > 0) {
    failures.push(`WORDS RUN TOGETHER OR SPLIT (MuPDF): read “${wordsExtra.slice(0, 4).join('”, “')}” where “${wordsLost.slice(0, 4).join('”, “')}” were expected`);
  }
  const drawnFonts = await drawnFontNames(after, page);
  const drawn = newWords.flat().filter((each) => drawnFonts.has(each.font));
  if (drawn.length > 0) {
    failures.push(`A DRAWN FONT FOR NEW WORDS: ${String(drawn.length)} written character(s) are in a Type 3 font (${[...new Set(drawn.map((each) => each.font))].join(', ')}), the first “${drawn.slice(0, 12).map((each) => each.character).join('')}”`);
  }

  // PDFium, THE EDITOR'S READING: the runs outside the block are as they were; the block's read as expected; every
  // drawing and picture not inside the block is as it was.
  const pdfiumBefore = await pdfiumReading(pdfium, before, page);
  const pdfiumAfter = await pdfiumReading(pdfium, after, page);
  const runKey = (/** @type {{ text: string, left: number, right: number, bottom: number, top: number }} */ run) =>
    `${bare(run.text)}@${[run.left, run.bottom, run.right, run.top].map((n) => String(Math.round(n * 2))).join(',')}`;
  const runBox = (/** @type {{ left: number, right: number, bottom: number, top: number }} */ run) => ({ left: run.left, right: run.right, bottom: run.bottom, top: run.top });
  const runsOutside = pdfiumBefore.runs.filter((run) => !owned(runBox(run)) && bare(run.text) !== '');
  const { rest: runsUnmatched, missing: runsLost } = remainder(pdfiumAfter.runs.filter((run) => bare(run.text) !== ''), runsOutside, runKey);
  // A RUN FROM OUTSIDE THAT MOVED, by the rule the characters above follow: the same words within 3 pt are the neighbour's.
  const runsDisplaced = new Set();
  for (const gone of runsLost) {
    const near = runsUnmatched.find(
      (run) => !runsDisplaced.has(run) && bare(run.text) === bare(gone.text) && Math.abs(run.left - gone.left) <= 3 && Math.abs(run.bottom - gone.bottom) <= 3,
    );
    if (near !== undefined) runsDisplaced.add(near);
  }
  const blockRuns = runsUnmatched.filter((run) => !runsDisplaced.has(run));
  if (runsLost.length > 0) failures.push(`MOVED OR CHANGED OUTSIDE THE BLOCK (PDFium): ${String(runsLost.length)} run(s), the first “${runsLost[0]?.text ?? ''}”`);
  const pdfiumRead = readings(blockRuns.map((run) => ({ text: run.text, box: runBox(run) })), direction);
  if (!pdfiumRead.includes(want)) failures.push(`READ BACK (PDFium): “${pdfiumRead[0] ?? ''}”, where “${want}” was expected`);

  const objectKey = (/** @type {any} */ object) =>
    `${String(object.kind)}@${[object.left, object.bottom, object.right, object.top].map((n) => String(Math.round(n * 2))).join(',')}#${JSON.stringify(object.fill)}`;
  const inside = (/** @type {any} */ object) =>
    object.left >= block.box.left - MARGIN && object.right <= block.box.right + MARGIN && object.bottom >= block.box.bottom - MARGIN && object.top <= block.box.top + MARGIN;
  const drawingsBefore = pdfiumBefore.objects.filter((object) => object.kind !== 'text' && !inside(object));
  const { missing: drawingsLost } = remainder(pdfiumAfter.objects.filter((object) => object.kind !== 'text'), drawingsBefore, objectKey);
  if (drawingsLost.length > 0) failures.push(`A DRAWING OR PICTURE OUTSIDE THE BLOCK CHANGED: ${String(drawingsLost.length)}, the first a ${String(drawingsLost[0]?.kind)}`);
  const linksBefore = linksOf(kernel, before, page);
  const linksAfter = linksOf(kernel, after, page);
  if (JSON.stringify(linksBefore) !== JSON.stringify(linksAfter)) failures.push(`A LINK CHANGED: ${JSON.stringify(linksBefore)} became ${JSON.stringify(linksAfter)}`);

  // PIXELS: none outside the block's ink before and its characters' after; and some inside, or the edit was unseen.
  const drawnBefore = render(kernel, before, page);
  const drawnAfter = render(kernel, after, page);
  // RECOGNISED WORDS OVER A SCAN (ADR-0181 Decision 9, ADR-0187) are invisible over their own ink, so the block may
  // change the picture only where the ink of a word on a REDRAWN line is — its cover, grown through that ink by at most
  // ADR-0187's caps, 5 pt sideways and a third of its height (at least 2 pt) up and down — and where that line's words
  // are drawn now.
  const zones = block.scan
    ? [
        ...redrawnBefore.map((word) => {
          const box = boxOfWord(word);
          const up = Math.max(2, (box.top - box.bottom) / 3);
          return { left: box.left - 5, right: box.right + 5, bottom: box.bottom - up, top: box.top + up };
        }),
        ...redrawnAfter.flat().map((each) => each.box),
      ]
    : [inkOf(kernel, before, page, block.box), ...written.map((each) => each.box)];
  const { outside, inside: changedInside, farthest } = compare(drawnBefore, drawnAfter, zones, MARGIN);
  if (outside > 0) failures.push(`PIXELS OUTSIDE THE BLOCK: ${String(outside)} changed, up to ${String(farthest / SCALE)} pt from where the block may draw`);
  const shown = block.visible || block.scan === true;
  if (shown && changedInside === 0) failures.push('UNSEEN: the edit changed no pixel of the block');
  if (block.scan) {
    // A KEPT WORD ON A LINE THE EDIT DID NOT REACH: its ink is the page's visible text, and no cover may reach it. Its box
    // less a point each side, since a redrawn word's cover may come within the space between them.
    const covered = keptWords.filter((word) => !redrawnBefore.includes(word)).filter((word) => {
      const box = boxOfWord(word);
      return compare(drawnBefore, drawnAfter, [{ ...box, left: box.left + 1, right: box.right - 1 }], 0).inside > 0;
    });
    if (covered.length > 0) failures.push(`A KEPT WORD COVERED: the picture under “${covered.map(textOfWord).join(' ')}” changed, which the edit kept`);
  }

  // EVERY CHARACTER THE BLOCK SHOWS DRAWS SOMETHING: its box differs between the page drawn with its text and without.
  // Over a scan that is the redrawn lines' words; the words of the lines it did not reach stay invisible over their ink.
  if (shown) {
    const judged = block.scan ? redrawnAfter.flat() : written;
    const unseen = undrawn(drawnAfter, judged, textInk(kernel, after, page));
    if (unseen.length > 0) failures.push(`UNSEEN WORDS: ${String(unseen.length)} of the block’s characters draw nothing, “${unseen.slice(0, 24).map((each) => each.character).join('')}”`);
  }
  return failures;
}

/**
 * The characters whose box is the same drawn with the page's text and without it: they draw nothing a person can see —
 * invisible, clipped away, covered, or the paper's colour.
 *
 * THE MIDDLE HALF of each box, in both directions: a box MuPDF reads runs from the font's ascender to its descender,
 * which reaches into the lines above and below, and their ink made an invisible word read as drawn (measured
 * 2026-10-26, the two-column page). The middle half lies in every glyph's body, a full stop's included.
 * @param {import('./pageDisturbance.mjs').Render} drawn MuPDF's drawing, for the map from PDF space to pixels
 * @param {Char[]} chars @param {{ withText: Uint8Array, without: Uint8Array }} ink MuPDF's two drawings, RGB
 */
function undrawn(drawn, chars, { withText, without }) {
  return chars.filter((each) => {
    const w = (each.box.right - each.box.left) / 4;
    const h = (each.box.top - each.box.bottom) / 4;
    const corners = [drawn.toDevice(each.box.left + w, each.box.bottom + h), drawn.toDevice(each.box.right - w, each.box.top - h)];
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(([x]) => x))));
    const x1 = Math.min(drawn.width - 1, Math.ceil(Math.max(...corners.map(([x]) => x))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(([, y]) => y))));
    const y1 = Math.min(drawn.height - 1, Math.ceil(Math.max(...corners.map(([, y]) => y))));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const at = (y * drawn.width + x) * 3;
        if (withText[at] !== without[at] || withText[at + 1] !== without[at + 1] || withText[at + 2] !== without[at + 2]) return false;
      }
    }
    return true;
  });
}

/**
 * A block's words as each engine reads them where the block is, in the engine's order and in line order, spaces
 * removed: what a generator's block must read as, by the rule {@link expectEdit} reads an edited one by (B3a).
 * @param {{ kernel: any, pdfium: any }} engines @param {Uint8Array} bytes @param {number} page @param {Block} block
 */
export async function readBlock({ kernel, pdfium }, bytes, page, block) {
  const own = /** @type {Char[]} */ (charactersOf(kernel, bytes, page)).filter((each) => centredIn(each.box, block.box, MARGIN) && each.character.trim() !== '');
  const { runs } = await pdfiumReading(pdfium, bytes, page);
  const box = (/** @type {{ left: number, right: number, bottom: number, top: number }} */ run) => ({ left: run.left, right: run.right, bottom: run.bottom, top: run.top });
  return {
    want: bare(block.text),
    mupdf: readings(own.map((each) => ({ text: each.character, box: each.box })), block),
    pdfium: readings(runs.filter((run) => centredIn(box(run), block.box, MARGIN) && bare(run.text) !== '').map((run) => ({ text: run.text, box: box(run) })), block),
  };
}

/**
 * Whether every non-space character MuPDF reads in each box draws something, as {@link expectEdit} judges it — the
 * instrument a generator's own visibility is checked with, so that check and this one are the same rule (B3a).
 * @param {{ kernel: any, pdfium: any }} engines @param {Uint8Array} bytes @param {number} page @param {Box} box
 * @returns {Promise<{ read: number, unseen: string }>}
 */
export async function inkedCharacters({ kernel }, bytes, page, box) {
  const drawn = render(kernel, bytes, page);
  const own = /** @type {Char[]} */ (charactersOf(kernel, bytes, page)).filter((each) => centredIn(each.box, box, MARGIN) && each.character.trim() !== '');
  const unseen = undrawn(drawn, own, textInk(kernel, bytes, page));
  return { read: own.length, unseen: unseen.map((each) => each.character).join('') };
}
