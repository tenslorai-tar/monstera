import { BUNDLED_FAMILIES, type BundledFamily, type ContractClient, type FontFamilyEntry } from '@monstera/contract';
import { STAND_INS, normaliseFamily, withoutSubsetTag } from '@monstera/shared';

/**
 * Each listed family drawn in itself, in the font picker and in the open editor alike
 * ([ADR-0250](../../../docs/DECISIONS/0250-the-font-picker-draws-each-family-in-itself.md)).
 *
 * ## Only a family the browser does not already draw is given a face
 *
 * Chromium resolves a family's CSS name against the system's typographic families, so *Arial* draws itself with no help,
 * bold and italic included. A face registered under such a name would REPLACE that family with the one face given, and
 * every bold word in it would be a slanted guess. So a family is given a face only where the browser draws its name in
 * a fallback ({@link drawnByBrowser}): an installed family by `local()` under its face's PostScript name (Decision 1), a
 * bundled family from the bytes `app.bundledFace` answers (Decision 2). Registered on the document's `FontFaceSet`, so
 * the editor that draws a chosen family by its name draws it in the same face.
 */

/** The families this window has already been asked to draw, by lower-case name: each is registered once. */
const handled = new Set<string>();
/** The list the faces were given from: what a family chosen in the editor is previewed against (`previewFamilyOf`). */
let listed: readonly FontFamilyEntry[] = [];
/** The families given a face here, by lower-case name: drawable in themselves, whether or not the browser knew them. */
const registered = new Set<string>();
/** {@link drawnByBrowser}'s answers, by name: a canvas measurement is cheap once and not on every render of a list. */
const browserDraws = new Map<string, boolean>();

/** How many times a face has been given here, for a list already on screen to draw a family again once it has one. */
let given = 0;
const listeners = new Set<() => void>();
function gave(): void {
  given += 1;
  for (const listener of listeners) listener();
}
/** `useSyncExternalStore`'s subscribe: told each time a family is given a face. */
export function subscribeFaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** `useSyncExternalStore`'s snapshot: how many faces have been given. */
export function facesGiven(): number {
  return given;
}

/**
 * Whether the browser draws `family` itself: its name measured against two different fallbacks, a sans and a monospace.
 * A name it resolves draws the same width after either; a name it does not draws as each fallback does. The walk's own
 * instrument (step 7b), run here on the family before a face is given to it.
 */
export function drawnByBrowser(family: string): boolean {
  const known = browserDraws.get(family);
  if (known !== undefined) return known;
  const pen = document.createElement('canvas').getContext('2d');
  // NO CANVAS, NO ANSWER: treated as drawn, so nothing is registered over a family on a guess.
  if (pen === null) return true;
  const width = (font: string): number => {
    pen.font = font;
    return pen.measureText('Findings 0123 WMiq').width;
  };
  const quoted = `"${family.replaceAll('"', '')}"`;
  const draws = width(`40px ${quoted}, sans-serif`) !== width('40px sans-serif') || width(`40px ${quoted}, monospace`) !== width('40px monospace');
  browserDraws.set(family, draws);
  return draws;
}

/** Whether `family` is drawn in itself here: the browser knows it, or a face was given to it. */
function drawable(family: string): boolean {
  return registered.has(family.toLowerCase()) || drawnByBrowser(family);
}

/**
 * Registers a face for every family in `families` the browser cannot draw by name, at most once a window: the installed
 * ones from `local()`, the bundled ones from their bytes, read from main as they are needed. A face the browser refuses,
 * or bytes main could not read, leave that family in the interface font, which is what the picker shows for any family
 * with no face.
 */
export function drawFamilies(families: readonly FontFamilyEntry[], client: ContractClient): void {
  listed = families;
  for (const family of families) {
    const key = family.name.toLowerCase();
    if (handled.has(key)) continue;
    handled.add(key);
    if (drawnByBrowser(family.name)) continue;
    if (family.origin === 'installed' && family.locals !== undefined) {
      // EACH NAME IN TURN, in one source list: the browser takes the first its system has (CSS Fonts 4, `src`). ADDED
      // UNLOADED: the browser reads the file the first time the family is drawn, so a list of three hundred families
      // costs nothing until a picker shows them. The names are the face's own, which Chromium matched for every family on
      // this project's Windows machine (text regression 7b, 2026-10-16).
      document.fonts.add(new FontFace(family.name, family.locals.map((name) => `local("${name}")`).join(', ')));
      registered.add(key);
      continue;
    }
    const bundled = BUNDLED_FAMILIES.find((name) => name.toLowerCase() === key);
    if (family.origin === 'bundled' && bundled !== undefined) void addBundled(bundled, client);
  }
  gave();
}

async function addBundled(family: BundledFamily, client: ContractClient): Promise<void> {
  const answer = await client['app.bundledFace']({ family }).catch(() => undefined);
  if (answer === undefined || !answer.ok) return;
  await give(new FontFace(family, answer.value.bytes));
}

/**
 * Loads a bundled `face` from its bytes and, once it draws, gives it to its family on the document's `FontFaceSet`. A
 * face the browser's sanitiser refuses is given to nothing, so its family stays in the interface font rather than drawn
 * by a name that falls to the default.
 */
async function give(face: FontFace): Promise<void> {
  const loaded = await face.load().then(
    () => true,
    () => false,
  );
  if (!loaded) return;
  document.fonts.add(face);
  registered.add(face.family.replaceAll('"', '').toLowerCase());
  gave();
}

/**
 * The family a name the picker shows is drawn in, or `undefined` for the interface font (Decision 3, the owner's locked
 * decision 6): the listed family of that name, else one listed under the same normalised name (*TimesNewRomanPSMT* is
 * *Times New Roman*), else the bundled stand-in the resolver would write it in (*Times-Roman* is Tinos), else none.
 */
export function previewFamilyOf(
  name: string,
  /** The list to choose from: the one the faces were given from, unless a caller holds its own read. */
  families: readonly FontFamilyEntry[] = listed,
  /** Whether a family is drawn in itself here; the browser's and this window's answer, which a case states instead. */
  drawnHere: (family: string) => boolean = drawable,
): string | undefined {
  const plain = withoutSubsetTag(name);
  const key = normaliseFamily(name);
  const standIn = STAND_INS[key];
  const candidates = [
    families.find((family) => family.name.toLowerCase() === plain.toLowerCase())?.name,
    families.find((family) => normaliseFamily(family.name) === key)?.name,
    standIn === undefined ? undefined : families.find((family) => family.name === standIn)?.name,
    // A NAME THE BROWSER DRAWS ITSELF, where no list was read for this consumer (the standard faces a stamp offers).
    families.length === 0 ? plain : undefined,
  ];
  // THE FIRST THAT IS DRAWN IN ITSELF HERE: a listed family with no face given and no system name falls through, so a
  // preview is never a name drawn in the browser's default.
  return candidates.find((candidate): candidate is string => candidate !== undefined && drawnHere(candidate));
}
