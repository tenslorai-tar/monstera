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
/** The list as read: what a family chosen in the editor is previewed against (`previewFamilyOf`). */
let listed: readonly FontFamilyEntry[] = [];
/** The client the list was read through, which a bundled family's bytes are asked of. */
let listedClient: ContractClient | undefined;

/**
 * Notes the list as read and the client it came through. NO DOCUMENT IS TOUCHED HERE: the read is also taken by commands
 * that hand the list to a dialog, which run where no window exists (their cases do), and giving faces is the drawing's
 * business, done by {@link drawFamilies} where a list is drawn.
 */
export function noteFamilies(families: readonly FontFamilyEntry[], client: ContractClient): void {
  listed = families;
  listedClient = client;
}
/** The families given a face here, by lower-case name: drawable in themselves, whether or not the browser knew them. */
const registered = new Set<string>();
/** {@link drawnByBrowser}'s answers, by name: a canvas measurement is cheap once and not on every render of a list. */
const browserDraws = new Map<string, boolean>();

/**
 * The families given a face here, as `useSyncExternalStore`'s snapshot: a new set each time a face is given and the same
 * set between, so a list already on screen draws a family again once it has one — and reads it from this value rather
 * than from {@link registered}, which a compiled render would read once and keep (ADR-0258).
 */
let given: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
function gave(): void {
  given = new Set(registered);
  for (const listener of listeners) listener();
}
/** `useSyncExternalStore`'s subscribe: told each time a family is given a face. */
export function subscribeFaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** `useSyncExternalStore`'s snapshot: the families given a face here, by lower-case name. */
export function facesGiven(): ReadonlySet<string> {
  return given;
}

/**
 * Whether `family` is drawn in itself here, as a render reads it: a face given to it in `faces` — the snapshot it
 * subscribed to — or the browser drawing it by name.
 */
export function drawnWith(faces: ReadonlySet<string>): (family: string) => boolean {
  return (family) => faces.has(family.toLowerCase()) || drawnByBrowser(family);
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
  return drawnWith(registered)(family);
}

/**
 * Registers a face for every family in `families` the browser cannot draw by name, at most once a window: the installed
 * ones from `local()`, the bundled ones from their bytes, asked of main through the client the list was read through
 * ({@link noteFamilies}). Called by the picker as it draws a list. A face the browser refuses, or bytes main could not
 * read, leave that family in the interface font, which is what the picker shows for any family with no face.
 */
export function drawFamilies(families: readonly FontFamilyEntry[]): void {
  const before = registered.size;
  for (const family of families) giveFace(family);
  // ONLY WHERE A FACE WAS GIVEN, as `given`'s own contract says (a new set each time a face is given, the same set
  // between): a bundled face is given later, by `give`. This announced a new set on every call, so every block opened
  // after its families had their faces made a new look and fitted its lines again inside the press: one paint of three
  // in the first press on a block (document 2, 2026-11-14, JOURNAL).
  if (registered.size !== before) gave();
}

/** One family of {@link drawFamilies}: given a face where the browser cannot draw it by name, once a window. */
function giveFace(family: FontFamilyEntry): void {
  const key = family.name.toLowerCase();
  if (handled.has(key)) return;
  handled.add(key);
  if (drawnByBrowser(family.name)) return;
  if (family.origin === 'installed' && family.locals !== undefined) {
    // EACH NAME IN TURN, in one source list: the browser takes the first its system has (CSS Fonts 4, `src`). ADDED
    // UNLOADED: the browser reads the file the first time the family is drawn, so a list of three hundred families
    // costs nothing until a picker shows them. The names are the face's own, which Chromium matched for every family on
    // this project's Windows machine (text regression 7b, 2026-10-16).
    document.fonts.add(new FontFace(family.name, family.locals.map((name) => `local("${name}")`).join(', ')));
    registered.add(key);
    return;
  }
  const bundled = BUNDLED_FAMILIES.find((name) => name.toLowerCase() === key);
  const client = listedClient;
  if (family.origin === 'bundled' && bundled !== undefined && client !== undefined) void addBundled(bundled, client);
}

/** Runs `step` when the window is next idle, with the time it may take; a timer where the host has no idle callback. */
type IdleSchedule = (step: (remaining: () => number) => void) => void;
const whenIdle: IdleSchedule = (step) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback((deadline) => {
      step(() => deadline.timeRemaining());
    });
  } else {
    setTimeout(() => {
      step(() => 0);
    }, 0);
  }
};

/**
 * {@link drawFamilies} over a WHOLE LIST, a few families at a time while the window is idle, announced once at the end.
 *
 * Whether the browser draws a family by name is measured (`drawnByBrowser`), and the first measure of a family looks
 * it up among the computer's fonts. Over the computer's whole list that cost 1,685 ms of a 2,190 ms first press on a
 * block in a window just started (canvas `measureText`, `editOpenCost.mjs --profile`, document 2, 2026-11-14): the
 * picker drew the list as the editor's panel mounted, inside the press. Nothing waits on the whole list: a shown name
 * is measured as it is drawn (`drawnWith`), and an open block's own families are given at once (`drawFamiliesNamed`).
 * ONE ANNOUNCEMENT for the list, not one a slice, since each is a new look and a refit for an open editor.
 *
 * @param schedule when each slice runs; the window's idle callback, which a case replaces to run the slices itself.
 */
export function drawFamiliesWhenIdle(families: readonly FontFamilyEntry[], schedule: IdleSchedule = whenIdle): void {
  const left = families.filter((family) => !handled.has(family.name.toLowerCase()));
  if (left.length === 0) return;
  const before = registered.size;
  const slice = (remaining: () => number): void => {
    // AT LEAST ONE A SLICE, so a host with no idle time still finishes; more while the idle period lasts.
    do {
      const next = left.shift();
      if (next !== undefined) giveFace(next);
    } while (left.length > 0 && remaining() > 1);
    if (left.length > 0) schedule(slice);
    else if (registered.size !== before) gave();
  };
  schedule(slice);
}

/**
 * {@link drawFamilies} for the listed families of these names: the faces an open block's new words are set in, which the
 * editor draws before any picker has drawn the list. A name not in the list as read is given nothing.
 */
export function drawFamiliesNamed(names: readonly string[]): void {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  drawFamilies(listed.filter((family) => wanted.has(family.name.toLowerCase())));
}

async function addBundled(family: BundledFamily, client: ContractClient): Promise<void> {
  const answer = await client['app.bundledFace']({ family }).catch(() => undefined);
  if (!answer?.ok) return;
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
  const candidates = [
    ...listedFamiliesFor(name, families),
    // A NAME THE BROWSER DRAWS ITSELF, where no list was read for this consumer (the standard faces a stamp offers).
    families.length === 0 ? withoutSubsetTag(name) : undefined,
  ];
  // THE FIRST THAT IS DRAWN IN ITSELF HERE: a listed family with no face given and no system name falls through, so a
  // preview is never a name drawn in the browser's default.
  return candidates.find((candidate): candidate is string => candidate !== undefined && drawnHere(candidate));
}

/**
 * THE LISTED FAMILIES a font name the page states may stand for, best first: the family of that name, one listed under
 * the same normalised name (*TimesNewRomanPSMT* is *Times New Roman*), and the bundled stand-in the resolver would write
 * it in (*Times-Roman* is Tinos). ONE RULE, which the picker's preview and a join's carried family both take (B3a): a
 * family not in the list is one the resolver does not know, so a mark naming it could not be written.
 */
export function listedFamiliesFor(name: string, families: readonly FontFamilyEntry[]): string[] {
  const index = familyIndexOf(families);
  const key = normaliseFamily(name);
  const standIn = STAND_INS[key];
  return [
    index.byLowerName.get(withoutSubsetTag(name).toLowerCase()),
    index.byKey.get(key),
    standIn === undefined ? undefined : index.byName.get(standIn),
  ].filter((family): family is string => family !== undefined);
}

/** A list's families by the three keys {@link listedFamiliesFor} asks by, each holding the FIRST family in list order. */
export interface FamilyIndex {
  readonly byName: ReadonlyMap<string, string>;
  readonly byLowerName: ReadonlyMap<string, string>;
  readonly byKey: ReadonlyMap<string, string>;
}

/** Each list read, indexed once. Keyed on the list itself, so a new read is a new list and a new index. */
const indexes = new WeakMap<readonly FontFamilyEntry[], FamilyIndex>();

/**
 * THE LIST'S INDEX, BUILT ONCE PER LIST. {@link listedFamiliesFor} is asked once per run of words each time the open
 * editor fits its block (`faceCssOf`), and it used to normalise every listed family's name on every ask, four regular
 * expressions each: on 2026-11-12 that was 320–400 ms of the 1.0–1.2 s the first press on a block of corpus document 2
 * waited (`normaliseFamily` 171–211 ms of its own, `editOpenCost.mjs --profile` and `cpuProfileTop.mjs`, two warm
 * rounds). The answers are the ones `Array.find` gave: where two families share a key the first in the list is kept.
 */
export function familyIndexOf(families: readonly FontFamilyEntry[]): FamilyIndex {
  const known = indexes.get(families);
  if (known !== undefined) return known;
  const byName = new Map<string, string>();
  const byLowerName = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const { name } of families) {
    if (!byName.has(name)) byName.set(name, name);
    const lower = name.toLowerCase();
    if (!byLowerName.has(lower)) byLowerName.set(lower, name);
    const key = normaliseFamily(name);
    if (!byKey.has(key)) byKey.set(key, name);
  }
  const index = { byName, byLowerName, byKey };
  indexes.set(families, index);
  return index;
}
