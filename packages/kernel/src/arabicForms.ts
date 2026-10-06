/**
 * Arabic-script letters set in their joining forms
 * ([ADR-0181](../../../docs/DECISIONS/0181-right-to-left-text-is-written-in-drawing-order-and-read-back-as-typed.md)).
 *
 * ## Why the forms are written as code points
 *
 * An Arabic letter is drawn in one of four shapes by what stands either side of it, and a PDF text object holds the
 * glyphs already chosen: text set as the bare letters is drawn as disconnected isolated forms, which a reader takes for
 * a misspelling. The Unicode blocks Arabic Presentation Forms-A and -B hold one code point per shape, and a font that
 * carries them draws each as the glyph a shaper would have chosen, so the writer sets those code points, in the same
 * subset and the same `FPDFText_SetText` as any other text, and a text page normalises them back to the letters on the
 * way out (measured 2026-10-06 on PDFium 155.0.8044.0's Linux build: `ﻣﺮﺣﺒﺎ` reads `مرحبا`).
 *
 * ## The tables are the normaliser's, read once
 *
 * Which letter each code point is a form of, and which of its four shapes, is in the platform's own NFKC: a run of
 * consecutive code points that normalise to one letter is that letter's forms, in the order the blocks keep them —
 * isolated, final, initial, medial for a letter that joins on both sides (four forms), isolated and final for one that
 * joins only to the letter before it (two). So no list of letters is kept here to disagree with the standard's.
 *
 * ## What this does not do
 *
 * It is the joining of the Unicode Arabic shaping model and nothing a shaping engine adds: a lam followed by an alef is
 * drawn as the two joined letters and not as the ligature, and a mark is drawn at the font's own offset for it rather
 * than at the anchor the font's positioning table names. Both read back as typed. The ligature is left out because a
 * text page reads one glyph standing for two letters in the reverse of their order and the line could not be read back
 * as it was typed.
 */

/** A letter's shapes, as code points. */
interface Forms {
  readonly isolated: number;
  readonly final: number;
  /** Absent for a letter that joins only to the one before it. */
  readonly initial?: number;
  readonly medial?: number;
}

const FORMS: ReadonlyMap<number, Forms> = (() => {
  const found = new Map<number, Forms>();
  // THE FORMS-B BLOCK FIRST, so a letter both blocks hold takes the form the common fonts carry.
  for (const [from, to] of [
    [0xfe70, 0xfefc],
    [0xfb50, 0xfbff],
  ] as const) {
    const runs: { base: number; points: number[] }[] = [];
    for (let point = from; point <= to; point += 1) {
      const normalised = String.fromCodePoint(point).normalize('NFKC');
      const base = normalised.codePointAt(0) ?? point;
      // A FORM OF ONE LETTER: it normalises to a single other character. A ligature or a mark with a carrier does not,
      // and ends the run it follows.
      if (normalised.length !== String.fromCodePoint(base).length || base === point) {
        runs.push({ base: -1, points: [] });
        continue;
      }
      const last = runs.at(-1);
      if (last?.base === base) last.points.push(point);
      else runs.push({ base, points: [point] });
    }
    for (const { base, points } of runs) {
      const [isolated, final, initial, medial] = points;
      if (base === -1 || found.has(base) || isolated === undefined || final === undefined) continue;
      found.set(base, initial === undefined || medial === undefined ? { isolated, final } : { isolated, final, initial, medial });
    }
  }
  return found;
})();

const TATWEEL = 0x640;
const ZERO_WIDTH_JOINER = 0x200d;

/** Whether the letter reaches toward the one after it: a letter of four forms, the tatweel and the joiner. */
function joinsNext(point: number): boolean {
  return point === TATWEEL || point === ZERO_WIDTH_JOINER || FORMS.get(point)?.initial !== undefined;
}

/** Whether the letter reaches toward the one before it: any letter with forms, the tatweel and the joiner. */
function joinsPrevious(point: number): boolean {
  return point === TATWEEL || point === ZERO_WIDTH_JOINER || FORMS.has(point);
}

/** Marks sit on a letter and do not interrupt its joining. */
const TRANSPARENT = /^\p{Mn}$/u;

/**
 * `text` with each Arabic-script letter replaced by its joining form's code point: logical order in, logical order out,
 * one character for each.
 */
export function arabicForms(text: string): string {
  const characters = Array.from(text);
  if (!characters.some((character) => FORMS.has(character.codePointAt(0) ?? 0))) return text;
  const point = (at: number): number => characters[at]?.codePointAt(0) ?? 0;
  const transparent = (at: number): boolean => TRANSPARENT.test(characters[at] ?? '');
  return characters
    .map((character, at) => {
      const forms = FORMS.get(point(at));
      if (forms === undefined) return character;
      let before = at - 1;
      while (before >= 0 && transparent(before)) before -= 1;
      let after = at + 1;
      while (after < characters.length && transparent(after)) after += 1;
      const fromBefore = before >= 0 && joinsNext(point(before));
      const toAfter = forms.initial !== undefined && after < characters.length && joinsPrevious(point(after));
      const chosen =
        fromBefore && toAfter && forms.medial !== undefined
          ? forms.medial
          : toAfter
            ? forms.initial
            : fromBefore
              ? forms.final
              : forms.isolated;
      return String.fromCodePoint(chosen);
    })
    .join('');
}

/** The code points of the blocks {@link arabicForms} writes into, for a text page's reading of them to be undone. */
const PRESENTATION_FORM = /[\u{fb50}-\u{fdff}\u{fe70}-\u{fefc}]/gu;

/** `text` with each presentation form replaced by the letters it stands for: what a text page reads from them. */
export function lettersOfForms(text: string): string {
  return text.replace(PRESENTATION_FORM, (form) => form.normalize('NFKC'));
}
