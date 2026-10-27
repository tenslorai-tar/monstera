import { useEffect, useState } from 'react';

import type { RunFonts } from '../commands/documentCommands.js';
import type { RunStyle } from '../editorKit/model.js';
import { previewFamilyOf } from '../familyFaces.js';
import type { TextBlock } from '../textBlock.js';
import { faceKeyOf, isKindFace, isPageOnlyFace, kindFace } from './blockModel.js';

/**
 * The faces an open block is drawn in: THE FONTS IN THE FILE
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 4,
 * [ADR-0175](../../../../docs/DECISIONS/0175-the-typing-box-draws-a-run-in-its-own-font-rebuilt-in-the-host.md)).
 *
 * The host rebuilds each run's embedded program (`document.runFonts`), and each is loaded here as a face of this block
 * alone, under a name no other block, document or version shares, and removed when the block is let go. A run is drawn
 * by its font's name in that face first; behind it, for a letter the font does not carry, the KIND of face the page says
 * the run is (serif, sans, mono), and where the page says nothing of a kind — a family the person chose — the kind the
 * person set in Settings (`editing.fallback-face`).
 *
 * The read begins when a block is SELECTED, the first of the two presses that open it, so by the press that places the
 * caret the faces are usually drawn and the caret goes where the person pressed in the layout they see.
 */
export type FaceKind = 'serif' | 'sans' | 'mono';

/** The CSS fallback stack of each kind, as custom properties the stylesheet defines once. */
const KIND_STACK: Readonly<Record<FaceKind, string>> = {
  serif: 'var(--m-face-serif)',
  sans: 'var(--m-face-sans)',
  mono: 'var(--m-face-mono)',
};

/** A block's faces: each page font's loaded family by its name, or none while they are read. */
export interface RunFaces {
  /** Whether the read has answered and every face it gave has loaded or been refused: the layout will not change for them again. */
  readonly settled: boolean;
  /** The family each page font's name is loaded under. */
  readonly loaded: ReadonlyMap<string, string>;
}

const UNSETTLED: RunFaces = { settled: false, loaded: new Map() };

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

/** Counts the reads this window has loaded faces for, so no two reads share a family name. */
let reads = 0;

/** The family a block's face is loaded under: unique to this read, and plain letters and digits. */
function familyOf(owner: string, read: number, place: number): string {
  return `m-kit-${owner.replace(/[^a-zA-Z0-9]/gu, '')}-${String(read)}-${String(place)}`;
}

/**
 * Loads `block`'s run fonts from `read` while `read` is given, removing them when it is taken away or the block changes.
 * `owner` names the block (the version and its place), and each read is numbered besides.
 *
 * ## The answer is the READ's, never the block's
 *
 * A block closed and opened again is the same block and a new read, and its first faces were removed as it closed. Kept
 * by the block, the second opening was handed the first's answer at once — *settled*, naming families no longer loaded —
 * and drew its words in stand-in faces while saying they were the file's: measured 2026-10-26 in Chromium 151
 * (`textFirstClick.pw.ts`), a press 21 characters into a heading landed at 24, its line 21 pixels narrower than the same
 * line drawn in the file's font. So the answer is kept with the read that gave it, and each read's faces have names of
 * their own, so no family is ever both removed and named.
 */
export function useRunFaces(block: TextBlock | undefined, read: (() => Promise<RunFonts>) | undefined, owner: string): RunFaces {
  const [faces, setFaces] = useState<{ readonly read: (() => Promise<RunFonts>) | undefined; readonly faces: RunFaces }>({ read: undefined, faces: UNSETTLED });
  useEffect(() => {
    if (block === undefined || read === undefined) return undefined;
    const fonts = document.fonts;
    reads += 1;
    const serial = reads;
    let current = true;
    const added: FontFace[] = [];
    void read().then(async ({ fonts: programs, runs }) => {
      // EACH FACE DECLARES THE WEIGHT AND SLANT ITS PROGRAM HAS — the page's, as the first run drawn in it states them —
      // so the browser does not embolden a bold program a second time.
      const declared = new Map<number, FontFaceDescriptors>();
      /** Each face key drawn in a program, by the program's place: every run's, so a run with no font name has its own. */
      const keysOf = new Map<number, string[]>();
      for (const line of block.lines) {
        for (const run of line.runs) {
          const place = runs.get(run.index);
          if (place === undefined) continue;
          keysOf.set(place, [...(keysOf.get(place) ?? []), faceKeyOf(run.style, run.index)]);
          if (declared.has(place)) continue;
          declared.set(place, { weight: run.style.bold ? '700' : '400', style: run.style.italic ? 'italic' : 'normal' });
        }
      }
      const loaded = await Promise.all(
        programs.map((bytes, place) => {
          const face = new FontFace(familyOf(owner, serial, place), bytes, declared.get(place));
          return face.load().then(
            () => face,
            () => undefined,
          );
        }),
      );
      if (!current) return;
      const families = new Map<string, string>();
      for (const [place, face] of loaded.entries()) {
        if (face === undefined) continue;
        fonts.add(face);
        added.push(face);
        for (const key of keysOf.get(place) ?? []) if (!families.has(key)) families.set(key, face.family);
      }
      setFaces({ read, faces: { settled: true, loaded: families } });
    });
    return () => {
      current = false;
      for (const face of added) fonts.delete(face);
    };
  }, [block, read, owner]);
  return faces.read === read ? faces.faces : UNSETTLED;
}

/**
 * The CSS `font-family` a style is drawn in: the page font's own face where it loaded, else the family the font picker
 * draws its name in (`previewFamilyOf`, ADR-0250), and behind either the run's kind of face, else the person's fallback.
 */
export function faceCssOf(faces: RunFaces, block: TextBlock | undefined, fallback: FaceKind): (style: RunStyle) => string {
  const kinds = block === undefined ? new Map<string, FaceKind>() : kindsOf(block);
  return (style) => {
    if (isKindFace(style.face)) return KIND_STACK[kindOfFace(style.face)];
    const behind = KIND_STACK[kinds.get(style.face) ?? fallback];
    // A RUN'S UNNAMED FONT has no family to preview: its own face where the host rebuilt it, else its kind.
    const own = faces.loaded.get(style.face) ?? (isPageOnlyFace(style.face) ? undefined : previewFamilyOf(style.face));
    // QUOTED, since a family's name may hold a digit, which an unquoted name may not.
    return own === undefined ? behind : `"${own.replaceAll('"', '')}", ${behind}`;
  };
}

/** The kind a kind face names (`kindFace`). */
function kindOfFace(face: string): FaceKind {
  return face === kindFace({ serif: true, mono: false }) ? 'serif' : face === kindFace({ serif: false, mono: true }) ? 'mono' : 'sans';
}
