/**
 * What a font's NAME says, and which bundled family stands in for it: the rules the kernel's resolver writes with and the
 * renderer's font picker previews with, in one place so the two cannot disagree about a family
 * ([ADR-0250](../../../docs/DECISIONS/0250-the-font-picker-draws-each-family-in-itself.md) Decision 3). Pure: names in,
 * names out. Moved here from the kernel's `fontResolver.ts` and `subsetName.ts`, which take them from here.
 */

/** A tag of six capitals and a plus, which a subset's name begins with (PDF 32000-1, 9.6.4). */
export const SUBSET_TAG = /^[A-Z]{6}\+/u;

/**
 * A font name without its subset tag: `ABCDEF+Arimo-Regular` is a subset of `Arimo-Regular`.
 *
 * ISO 32000-2 §9.9.2: a subset's name begins with six upper-case letters and a plus sign, and the tag says only which
 * subset it is. So two fonts that differ by their tag alone are subsets of one font, and the name with the tag dropped
 * is the font's: the one rule for that, which the resolver, the Word export, an edit's sibling fonts and the font
 * picker take ([ADR-0173](../../../docs/DECISIONS/0173-an-edits-word-its-font-cannot-carry-is-its-own-piece-in-the-resolvers-face.md)
 * Decision 4).
 */
export function withoutSubsetTag(name: string): string {
  return name.replace(SUBSET_TAG, '');
}

/**
 * Which bundled family stands in for which, by normalised family name: the metric-compatible pairs (Arimo for Arial
 * and Helvetica, Tinos for Times New Roman, Cousine for Courier New, Carlito for Calibri, Caladea for Cambria) and the
 * bundled faces' own names.
 */
export const STAND_INS: Readonly<Record<string, string>> = {
  arial: 'Arimo',
  helvetica: 'Arimo',
  helveticaneue: 'Arimo',
  liberationsans: 'Arimo',
  arimo: 'Arimo',
  timesnewroman: 'Tinos',
  times: 'Tinos',
  timesroman: 'Tinos',
  liberationserif: 'Tinos',
  tinos: 'Tinos',
  couriernew: 'Cousine',
  courier: 'Cousine',
  liberationmono: 'Cousine',
  cousine: 'Cousine',
  calibri: 'Carlito',
  carlito: 'Carlito',
  cambria: 'Caladea',
  caladea: 'Caladea',
};

/**
 * The family each bundled one is drawn to the measure of, as a person knows it: what a picker says beside a bundled
 * name, *Carlito (looks like Calibri)*. Beside {@link STAND_INS} because it is the same fact read the other way, and a
 * test holds each pair to that table, so the two cannot come to disagree.
 */
export const LOOKS_LIKE: Readonly<Record<string, string>> = {
  Arimo: 'Arial',
  Tinos: 'Times New Roman',
  Cousine: 'Courier New',
  Carlito: 'Calibri',
  Caladea: 'Cambria',
};

/**
 * A family name as the stand-in table keys it: no subset tag, no PostScript style suffix, lower case, letters only.
 * `ABCDEF+TimesNewRomanPS-BoldItalicMT` is `timesnewroman`.
 */
export function normaliseFamily(name: string): string {
  return withoutSubsetTag(name)
    .replace(/[-,](?:Bold|Italic|Oblique|Regular|Roman|Book|Medium|Light|Semibold|Black)\w*$/iu, '')
    .replace(/(?:PS)?MT$/u, '')
    .replace(/PS$/u, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
}
