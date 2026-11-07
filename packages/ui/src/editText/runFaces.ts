import { useEffect, useState } from 'react';

import { type BlockFaces, type BlockFontRead, NO_BLOCK_FACES } from '../commands/documentCommands.js';
import type { RunStyle } from '../editorKit/model.js';
import type { EditorFaces } from '../editorKit/openEditor.js';
import { drawFamiliesNamed, drawnWith, previewFamilyOf } from '../familyFaces.js';
import type { TextBlock } from '../textBlock.js';
import { faceKeyOf, isKindFace, isPageOnlyFace, kindFace } from './blockModel.js';

/**
 * The faces an open block is drawn in: EACH WORD IN THE FACE THAT WILL DRAW IT ON THE PAGE
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3, the
 * owner's font rule).
 *
 * A run is drawn first in the face PDF.js already loaded for its font (`pdfjsFaces.ts`), which is the page's own font
 * program and draws the run's unchanged words as the page does; behind it, the face the writer sets a word in that the
 * run's font cannot carry, the chain's answer from the read on open (`document.blockFaces`); behind that, the KIND of face
 * the page says the run is, else the kind the person set in Settings (`editing.fallback-face`).
 *
 * The browser falls back per letter where the writer decides per word, so a new word whose letters the page's font has
 * only some of is drawn across two faces here and written whole in the chain's. A run with no face from PDF.js (a Type 3
 * font, a standard font the page does not embed) draws every word in the chain's face, which for a new word is what is
 * written; an unchanged word in it is written again in its own codes and font, so the page shows the original.
 *
 * The read begins when a block is SELECTED, the first of the two presses that open it, so by the press that places the
 * caret the faces are usually known and the caret goes where the person pressed in the layout they see.
 */
export type FaceKind = 'serif' | 'sans' | 'mono';

/** The CSS fallback stack of each kind, as custom properties the stylesheet defines once. */
const KIND_STACK: Readonly<Record<FaceKind, string>> = {
  serif: 'var(--m-face-serif)',
  sans: 'var(--m-face-sans)',
  mono: 'var(--m-face-mono)',
};

/** What the editor reads for a block as it opens: the read on open, and PDF.js's face for each run, by run index. */
export interface FaceRead {
  readonly faces: BlockFaces;
  readonly shown: ReadonlyMap<number, string>;
}

/** A block's faces by the kit's face key (`faceKeyOf`), or none while they are read. */
export interface RunFaces {
  /** Whether the read has answered: the layout will not change for it again. */
  readonly settled: boolean;
  /** The family PDF.js loaded each page font in. */
  readonly loaded: ReadonlyMap<string, string>;
  /** What the writer does with a new word in each page font: the read on open's answer. */
  readonly fonts: ReadonlyMap<string, BlockFontRead>;
}

const UNSETTLED: RunFaces = { settled: false, loaded: new Map(), fonts: new Map() };

/** The kind of face each of a block's faces is, by its key (`faceKeyOf`): what the page says of the runs drawn in it. */
function kindsOf(block: TextBlock): Map<string, FaceKind> {
  const kinds = new Map<string, FaceKind>();
  for (const line of block.lines) {
    for (const run of line.runs) {
      const key = faceKeyOf(run.style, run.index);
      if (!kinds.has(key)) kinds.set(key, run.style.mono ? 'mono' : run.style.serif ? 'serif' : 'sans');
    }
  }
  return kinds;
}

/** `read`'s answer keyed as the kit keys a run's face: each key takes the first run drawn in it that has an answer. */
export function runFacesOf(block: TextBlock, read: FaceRead): RunFaces {
  const loaded = new Map<string, string>();
  const fonts = new Map<string, BlockFontRead>();
  for (const line of block.lines) {
    for (const run of line.runs) {
      const key = faceKeyOf(run.style, run.index);
      const family = read.shown.get(run.index);
      if (family !== undefined && !loaded.has(key)) loaded.set(key, family);
      const place = read.faces.runs.get(run.index);
      const font = place === undefined ? undefined : read.faces.fonts[place];
      if (font !== undefined && !fonts.has(key)) fonts.set(key, font);
    }
  }
  return { settled: true, loaded, fonts };
}

/** The two reads a block's faces come from, begun together: PDF.js's faces for its runs, and the read on open. */
export interface FaceReads {
  readonly shown: Promise<ReadonlyMap<number, string>>;
  readonly faces: Promise<BlockFaces>;
}

/**
 * Reads `block`'s faces from `read` while `read` is given. The answer is kept with the READ that gave it, never the
 * block: a block closed and opened again is a new read, and is not settled until that read answers. The chain's
 * families are given their faces as the answer arrives (`drawFamiliesNamed`), so a new word is drawn in its face rather
 * than in its kind while a picker has never drawn the list.
 *
 * PDF.JS'S FACES ARE TAKEN AS THEY ARRIVE, never held for the read on open: measured 2026-11-07 on a corpus page whose
 * words are in a form, PDF.js answered in 0.4 to 5.0 s and the read on open in 6.5 to 9.7 s, and every word the page's
 * own font draws was drawn in its kind's face until the second came, so a paragraph broke its lines elsewhere while it
 * was typed in. Until the read on open answers, the faces are not settled.
 */
export function useRunFaces(block: TextBlock | undefined, read: (() => FaceReads) | undefined): RunFaces {
  const [faces, setFaces] = useState<{ readonly read: (() => FaceReads) | undefined; readonly faces: RunFaces }>({ read: undefined, faces: UNSETTLED });
  useEffect(() => {
    if (block === undefined || read === undefined) return undefined;
    let current = true;
    let whole = false;
    const asked = read();
    void asked.shown.then((shown) => {
      if (!current || whole) return;
      setFaces({ read, faces: { ...runFacesOf(block, { faces: NO_BLOCK_FACES, shown }), settled: false } });
    });
    void Promise.all([asked.faces, asked.shown]).then(([blockFaces, shown]) => {
      if (!current) return;
      whole = true;
      const found = runFacesOf(block, { faces: blockFaces, shown });
      drawFamiliesNamed(
        [...found.fonts.values()].flatMap((font) => [font.chosen, ...font.candidates].flatMap((face) => (face === null ? [] : [face.family]))),
      );
      setFaces({ read, faces: found });
    });
    return () => {
      current = false;
    };
  }, [block, read]);
  return faces.read === read ? faces.faces : UNSETTLED;
}

/** The read on open as the picker takes it (`openEditor.ts`): each page font's chain faces, Monstera's choice marked. */
export function editorFacesOf(faces: RunFaces): (face: string) => EditorFaces | undefined {
  return (face) => {
    const font = faces.fonts.get(face);
    if (font === undefined || font.candidates.length === 0) return undefined;
    return { closest: font.candidates.map(({ family, styles }) => ({ family, styles })), chosen: font.chosen?.family };
  };
}

/** A family name as CSS names it: quoted, since a family's name may hold a digit, which an unquoted name may not. */
const quoted = (family: string): string => `"${family.replaceAll('"', '')}"`;

/**
 * The CSS `font-family` a style is drawn in: the stack this module's header describes. A face the person chose from the
 * list, or a page font the read gave nothing for, is drawn in the family the font picker draws its name in
 * (`previewFamilyOf`, ADR-0250), and behind it the run's kind of face, else the person's fallback.
 */
export function faceCssOf(
  faces: RunFaces,
  block: TextBlock | undefined,
  fallback: FaceKind,
  /** The families given a face here (`facesGiven`), which a render that reads them subscribes to. */
  given: ReadonlySet<string> = new Set(),
): (style: RunStyle) => string {
  const kinds = block === undefined ? new Map<string, FaceKind>() : kindsOf(block);
  const preview = (name: string): string | undefined => previewFamilyOf(name, undefined, drawnWith(given));
  return (style) => {
    if (isKindFace(style.face)) return KIND_STACK[kindOfFace(style.face)];
    const behind = KIND_STACK[kinds.get(style.face) ?? fallback];
    const shown = faces.loaded.get(style.face);
    const chosen = faces.fonts.get(style.face)?.chosen;
    const chain = chosen === null || chosen === undefined ? undefined : preview(chosen.family);
    const own = shown === undefined && chain === undefined && !isPageOnlyFace(style.face) ? preview(style.face) : undefined;
    return [shown, chain, own].flatMap((family) => (family === undefined ? [] : [quoted(family)])).concat(behind).join(', ');
  };
}

/**
 * The colour a style is drawn in while it is typed: the colour the writer will draw it in (ADR-0289). Where the read on
 * open says a font's words paint nothing over words a person sees, that is those words' colour, for every word still in
 * the colour the page read for that font; a colour the person chose differs from it and is drawn as chosen, as it is written.
 */
export function inkOfFaces(faces: RunFaces, block: TextBlock | undefined): (style: RunStyle) => RunStyle['colour'] {
  const asRead = new Map<string, TextBlock['style']['colour']>();
  for (const line of block?.lines ?? []) {
    for (const run of line.runs) {
      const key = faceKeyOf(run.style, run.index);
      if (!asRead.has(key)) asRead.set(key, run.style.colour);
    }
  }
  return (style) => {
    const ink = faces.fonts.get(style.face)?.ink;
    const read = asRead.get(style.face);
    const unchosen = read?.r === style.colour.r && read.g === style.colour.g && read.b === style.colour.b;
    return ink !== undefined && unchosen ? ink : style.colour;
  };
}

/** The kind a kind face names (`kindFace`). */
function kindOfFace(face: string): FaceKind {
  return face === kindFace({ serif: true, mono: false }) ? 'serif' : face === kindFace({ serif: false, mono: true }) ? 'mono' : 'sans';
}
