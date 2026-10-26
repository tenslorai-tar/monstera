import { useLingui } from '@lingui/react';
import type { BlockFormatting, EditedBlock, WindowEditAction } from '@monstera/contract';
import { type MessageKey, TAB_STOP, toPdf, viewportPoint } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { type OverlayPage, overlayTransform } from '../annotations/annotationSpace.js';
import type { BlockCommit } from '../commands/documentCommands.js';
import { type CommandProblem, problemMessage, problemParticulars } from '../dialogs/problemMessages.js';
import { positionOf, readSelection, writeSelection } from '../editorKit/dom.js';
import { type EditorOps, EditorMenu, type EditorSpelling } from '../editorKit/EditorMenu.js';
import { EditorSurface } from '../editorKit/EditorSurface.js';
import { formatOpenEditor, keepsEditor, openEditorState, registerEditor, steppedSize } from '../editorKit/openEditor.js';
import { caret, insertText, isCollapsed, ordered, replaceRange, selectedText, styleAt, wholeBlock, wordAt } from '../editorKit/model.js';
import { AS_DRAWN_CLASS, type Look } from '../editorKit/paint.js';
import { type EditorStore, createEditorStore } from '../editorKit/store.js';
import {
  TEXT_EDIT_EDITOR_LABEL,
  TEXT_EDIT_HELD,
  TEXT_EDIT_PAST_PAGE,
  TEXT_EDIT_REFUSED_ESC_HINT,
  TEXT_EDIT_REFUSED_HINT,
  TEXT_HANDLE_MOVE,
  TEXT_HANDLE_SCALE,
  TEXT_HANDLE_TURN,
  TEXT_HANDLE_WIDTH,
} from '../messages/en.js';
import { composing } from '../surfaces/shortcuts.js';
import type { TextBlock } from '../textBlock.js';
import { joinEdits, splitEdits } from '../textBlockOps.js';
import { dragged, type Handle, NOT_PLACED, type Nudge, nudged, type Placement, placeOf, placeTransform } from '../textPlacement.js';
import { type OpenedBlock, editOf } from './blockModel.js';
import { type Placed, boxStyle } from './editing.js';
import { type FaceKind, type RunFaces, faceCssOf } from './runFaces.js';

/**
 * One block open for editing, on the editor kit
 * ([ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3).
 *
 * ## Two steps: the BOX, then the words
 *
 * The first press on a block selects its box: a frame with handles and no caret, the words laid out under it in the
 * page's own fonts and not drawn (the page shows through). The box is placed by its handles and keys, formatted whole
 * from the Properties panel, removed with Delete, and Enter puts the caret at its end. The second press, inside the
 * frame, lands on words that are already laid out, and the browser puts the caret exactly where it fell. A double press
 * on a block not yet selected does both at once, the caret at the second press.
 *
 * ## Finishing is one write
 *
 * A press outside the frame (and outside whatever keeps the editor, the Properties panel's text section), a focus moving
 * elsewhere, or Escape finishes: the model is turned into the writer's existing wire once (`editOf`) and sent once. A
 * refusal keeps the editor and the words with the sentence beside them, and Escape then puts the words back.
 */

/** Whether the press opening the editor asked for the box, the caret at the words' end, or the caret at a point. */
export type Opening = { readonly at: 'box' } | { readonly at: 'end' } | { readonly at: 'point'; readonly x: number; readonly y: number };

export interface BlockEditorProps {
  readonly block: TextBlock;
  readonly opened: OpenedBlock;
  readonly opening: Opening;
  readonly geometry: OverlayPage;
  readonly placed: Placed;
  readonly paper: React.CSSProperties | undefined;
  readonly faces: RunFaces;
  readonly fallback: FaceKind;
  /** Written, and held as the words' look until the page draws them: locked, so nothing typed now is lost. */
  readonly parting?: boolean;
  /** Whether the block's words run past the page as read, which the editor says beside them (the owner's Q7). */
  readonly past: boolean;
  readonly onCommit: (text: string, formatting: BlockFormatting) => Promise<BlockCommit>;
  /** Closes the editor: after a write, after nothing to write, or put back with Escape after a refusal. */
  readonly onClose: (outcome: 'written' | 'unchanged' | 'put-back') => void;
  /** Whether the block can be placed with handles and keys: not a box of new text, whose place is where it was begun. */
  readonly placeable?: boolean;
  readonly native?: ((action: WindowEditAction) => void) | undefined;
  readonly spell?: EditorSpelling | undefined;
  /** The blocks beside this one it may be joined with, and the write of a join or a split (ADR-0180 Decision 7). */
  readonly restructure?:
    | {
        readonly above: TextBlock | undefined;
        readonly below: TextBlock | undefined;
        readonly apply: (edits: EditedBlock[], kept?: boolean) => Promise<BlockCommit>;
        readonly families: () => Promise<(font: string) => string | undefined>;
      }
    | undefined;
  /** Where this editor puts the function that writes it, so a press on another block can ask for the write. */
  readonly finishingRef: React.RefObject<(() => Promise<void>) | undefined>;
  /** Where this editor says whether it holds words it could not write. */
  readonly stuckRef: React.RefObject<boolean>;
  /** The names of the fonts the page's text is drawn in, for the font picker. */
  readonly pageFonts: readonly string[];
}

/** The handles a block is placed by, and what each says it does. */
const HANDLES = [
  { handle: 'nw', label: TEXT_HANDLE_SCALE },
  { handle: 'ne', label: TEXT_HANDLE_SCALE },
  { handle: 'se', label: TEXT_HANDLE_SCALE },
  { handle: 'sw', label: TEXT_HANDLE_SCALE },
  { handle: 'e', label: TEXT_HANDLE_WIDTH },
  { handle: 'w', label: TEXT_HANDLE_WIDTH },
  { handle: 'n', label: TEXT_HANDLE_MOVE },
  { handle: 'r', label: TEXT_HANDLE_TURN },
] as const satisfies readonly { readonly handle: Handle; readonly label: MessageKey }[];

/**
 * The distance between a block's lines, in points — its first two lines' BASELINES apart, the writer's own rule — or
 * `undefined` for a block of one line, set at the face's own spacing.
 */
export function pitchOf(block: TextBlock): number | undefined {
  const [first, second] = block.lines;
  return first !== undefined && second !== undefined && first.baseline > second.baseline ? first.baseline - second.baseline : undefined;
}

/** Where the page drew each paragraph, from the block's top, in pixels: what the paper covers once its row is drawn. */
function paragraphBands(block: TextBlock, zoom: number): { readonly top: number; readonly height: number }[] {
  const bands: { top: number; height: number }[] = [];
  let lines: TextBlock['lines'][number][] = [];
  for (const [at, line] of block.lines.entries()) {
    lines.push(line);
    if (line.soft && at < block.lines.length - 1) continue;
    const top = (block.box.y1 - Math.max(...lines.map((each) => each.box.y1))) * zoom;
    const bottom = (block.box.y1 - Math.min(...lines.map((each) => each.box.y0))) * zoom;
    bands.push({ top, height: bottom - top });
    lines = [];
  }
  return bands;
}

/** A key's placement of the block, for a person who cannot drag a handle: Alt with an arrow, a bracket, plus, minus, comma or full stop. */
function nudgeOf(event: KeyboardEvent): Nudge | undefined {
  if (!event.altKey || event.ctrlKey || event.metaKey) return undefined;
  const far = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { kind: 'move', x: -far, y: 0 };
    case 'ArrowRight':
      return { kind: 'move', x: far, y: 0 };
    case 'ArrowUp':
      return { kind: 'move', x: 0, y: far };
    case 'ArrowDown':
      return { kind: 'move', x: 0, y: -far };
    case '=':
    case '+':
      return { kind: 'scale', by: 0.05 };
    case '-':
      return { kind: 'scale', by: -0.05 };
    case ']':
      return { kind: 'width', by: 10 * far };
    case '[':
      return { kind: 'width', by: -10 * far };
    case '.':
      return { kind: 'turn', degrees: -5 };
    case ',':
      return { kind: 'turn', degrees: 5 };
    default:
      return undefined;
  }
}

/** The formatting keys of a word processor, the editor's own while it has the focus: answers whether it took the key. */
function formatKey(event: KeyboardEvent, blockSize: number): boolean {
  const chord = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (!chord) return false;
  // BY THE KEY'S PLACE, so a layout that puts > elsewhere still reaches the size steps.
  if (event.shiftKey && (event.code === 'Period' || event.code === 'Comma')) {
    formatOpenEditor({ kind: 'set', change: { size: steppedSize(openEditorState()?.size ?? blockSize, event.code === 'Period' ? 1 : -1) } });
    return true;
  }
  if (event.shiftKey) return false;
  // THE LETTER IN EITHER CASE: with Caps Lock on, Ctrl+B arrives as `B`.
  const key = event.key.toLowerCase();
  const toggle = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : undefined;
  if (toggle !== undefined) {
    formatOpenEditor({ kind: 'toggle', property: toggle });
    return true;
  }
  const align = key === 'l' ? 'left' : key === 'e' ? 'center' : key === 'r' ? 'right' : key === 'j' ? 'justify' : undefined;
  if (align !== undefined) {
    formatOpenEditor({ kind: 'align', align });
    return true;
  }
  return false;
}

/** A focus that leaves the page where it is: the editor's own focus is never a request to scroll. */
const NO_SCROLL: FocusOptions = { preventScroll: true };

/** How long letters typed after the press that put the caret wait for the file's faces, at most (C1b). */
const HOLD_KEYS_MS = 1500;

/** Puts the model's caret at the character under a point of the window, where the browser can say which that is. */
function caretAtPoint(store: EditorStore, words: HTMLElement, x: number, y: number): void {
  const owner = words.ownerDocument;
  const at = (owner as Partial<Document>).caretPositionFromPoint?.call(owner, x, y);
  const position = at === null || at === undefined ? undefined : positionOf(words, at.offsetNode, at.offset);
  if (at === null || at === undefined || position === undefined) {
    writeSelection(words, store.get().selection);
    return;
  }
  // THE BROWSER'S OWN POINT for the press, put as it named it: where a line wraps, the end of one line and the start of
  // the next are one offset, and only the node the browser named says which line the press was on (measured in Chromium
  // 151, `textFirstClick.pw.ts`: mapped back from the offset, a press at a line's start showed the caret at the line
  // above's end).
  owner.getSelection()?.setBaseAndExtent(at.offsetNode, at.offset, at.offsetNode, at.offset);
  store.select(caret(position));
}

/** Whether a different choice of words can pass a refusal: only characters the page's font cannot show. */
function wordsCanPass(refused: CommandProblem): boolean {
  return refused.code === 'text-not-writable';
}

/** What the editor says under the words it kept: the signed document's sentence, or the refusal's, with the way out. */
function EditorProblem({ problem }: { readonly problem: Exclude<BlockCommit, 'written' | 'unchanged'> }): ReactElement {
  const { _ } = useLingui();
  if (problem === 'held') {
    return (
      <div className="m-text-editor-problem" role="alert">
        <p>{_(TEXT_EDIT_HELD)}</p>
      </div>
    );
  }
  const particulars = problemParticulars(problem.refused);
  return (
    <div className="m-text-editor-problem" role="alert">
      <p>{_(problemMessage(problem.refused))}</p>
      {particulars === undefined ? null : (
        <dl className="m-command-problem-reference">
          <dt>{_(particulars.label)}</dt>
          <dd>{particulars.value}</dd>
        </dl>
      )}
      <p>{_(wordsCanPass(problem.refused) ? TEXT_EDIT_REFUSED_HINT : TEXT_EDIT_REFUSED_ESC_HINT)}</p>
    </div>
  );
}

export function BlockEditor({
  block,
  opened,
  opening,
  geometry,
  placed,
  paper,
  faces,
  fallback,
  parting = false,
  past,
  onCommit,
  onClose,
  placeable = true,
  native,
  spell,
  restructure,
  finishingRef,
  stuckRef,
  pageFonts,
}: BlockEditorProps): ReactElement {
  const { _ } = useLingui();
  const frame = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  // THE BLOCK'S WORDS FOR THE EDITOR'S LIFE: a new read or another block is a new editor (`key`), so one store.
  const [store] = useState(() =>
    createEditorStore({ model: opened.model, selection: opening.at === 'box' ? wholeBlock(opened.model) : caret(wholeBlock(opened.model).focus) }),
  );
  const [mode, setMode] = useState<'box' | 'text'>(opening.at === 'box' ? 'box' : 'text');
  const [placement, setPlacement] = useState<Placement>(NOT_PLACED);
  const moved = placeOf(placement, block.box) !== undefined;
  const [problem, setProblem] = useState<Exclude<BlockCommit, 'written' | 'unchanged'> | undefined>(undefined);
  const [notice, setNotice] = useState<MessageKey | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const busy = sending || parting;
  const writing = useRef(false);
  const wrote = useRef(false);
  const menuOpen = useRef(false);
  const [covers, setCovers] = useState<readonly { readonly top: number; readonly height: number }[]>([]);
  const [shift, setShift] = useState(0);

  // THE FACES the page's runs are drawn in, else their kind, else the person's fallback (`runFaces.ts`).
  const faceCss = useMemo(() => faceCssOf(faces, block, fallback), [faces, block, fallback]);
  const pitch = pitchOf(block);
  const look = useMemo<Look>(() => ({ zoom: geometry.zoom, pitch, faceCss }), [geometry.zoom, pitch, faceCss]);
  // A BLOCK MOVED OFF ITS PLACE draws every paragraph: the page's copy of it is papered whole.
  const drawn = useMemo(() => (moved ? undefined : { paragraphs: opened.model.paragraphs, wraps: opened.wraps }), [moved, opened]);

  // THE EDITOR IS OPEN for the formatting commands to act on (ADR-0180), for its whole life.
  const actions = useRef<{ remove: () => void; nudge: (step: Nudge) => void; finish: () => void }>({
    remove: () => undefined,
    nudge: () => undefined,
    finish: () => undefined,
  });
  const [fontsAtOpen] = useState(() => pageFonts);
  useEffect(
    () =>
      registerEditor({
        store,
        root: () => surface.current,
        block: {
          remove: () => {
            actions.current.remove();
          },
          nudge: (step) => {
            actions.current.nudge(step);
          },
        },
        finish: () => {
          actions.current.finish();
        },
        fonts: fontsAtOpen,
      }),
    [store, fontsAtOpen],
  );

  /** Sends ONE write for this editor and takes its outcome, the words' write and a join's or a split's alike (B3a). */
  const settle = useCallback(
    async (send: () => Promise<BlockCommit>): Promise<void> => {
      if (writing.current || wrote.current) return;
      writing.current = true;
      setSending(true);
      // A WRITE THAT REJECTS must still free the editor, and is said as the editor's own `internal` refusal.
      let outcome: BlockCommit;
      try {
        outcome = await send();
      } catch {
        outcome = { refused: { code: 'internal', incident: 'write-rejected' } };
      } finally {
        writing.current = false;
        setSending(false);
      }
      if (outcome !== 'written' && outcome !== 'unchanged') {
        // THE EDITOR STAYS on every refusal (ADR-0169 Decision 5), with the words and the sentence beside them.
        setProblem(outcome);
        return;
      }
      if (outcome === 'written') wrote.current = true;
      onClose(outcome);
    },
    [onClose],
  );
  /** Writes the words as they stand, or `override`'s, with the place the person gave the block: one command. */
  const finishWith = useCallback(
    (override?: { readonly text: string; readonly formatting: BlockFormatting }): Promise<void> =>
      settle(() => {
        const { text, formatting } = override ?? editOf(store.get().model);
        const place = placeOf(placement, block.box);
        return onCommit(text, place === undefined ? formatting : { ...formatting, place });
      }),
    [block.box, onCommit, placement, settle, store],
  );
  const finish = useCallback((): Promise<void> => finishWith(), [finishWith]);
  useEffect(() => {
    actions.current = {
      // REMOVED BY ITS WORDS GOING, which is what removes a block (ADR-0096 Decision 5).
      remove: () => {
        void finishWith({ text: '', formatting: {} });
      },
      nudge: (step) => {
        if (placeable) setPlacement((now) => nudged(step, now, block.box, geometry.zoom));
      },
      finish: () => {
        if (problem === undefined && !menuOpen.current) void finish();
      },
    };
  }, [block.box, finish, finishWith, geometry.zoom, placeable, problem]);
  useEffect(() => {
    finishingRef.current = finish;
    return () => {
      if (finishingRef.current === finish) finishingRef.current = undefined;
    };
  }, [finish, finishingRef]);
  useEffect(() => {
    stuckRef.current = problem !== undefined;
    return () => {
      stuckRef.current = false;
    };
  }, [problem, stuckRef]);
  // ANY CHANGE AFTER A REFUSAL clears it: the person is changing what was refused.
  useEffect(
    () =>
      store.subscribe(() => {
        setProblem(undefined);
        setNotice(undefined);
      }),
    [store],
  );

  // FINISHED BY A PRESS OR A FOCUS ANYWHERE ELSE: outside the frame, outside what keeps the editor, outside the menu.
  useEffect(() => {
    const element = frame.current;
    if (element === null) return undefined;
    const owner = element.ownerDocument;
    // A TARGET NO LONGER IN THE DOCUMENT says nothing about where the press was, so it finishes nothing: a node replaced
    // under a press in flight is not *outside* (`restyleParagraph`'s measurement).
    const away = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      target.isConnected &&
      !element.contains(target) &&
      !keepsEditor(target) &&
      !(target instanceof Element && target.closest('[role="menu"]') !== null);
    const onPress = (event: PointerEvent): void => {
      if (away(event.target)) actions.current.finish();
    };
    const onFocus = (event: FocusEvent): void => {
      if (away(event.target)) actions.current.finish();
    };
    owner.addEventListener('pointerdown', onPress, true);
    owner.addEventListener('focusin', onFocus);
    return () => {
      owner.removeEventListener('pointerdown', onPress, true);
      owner.removeEventListener('focusin', onFocus);
    };
  }, []);

  // THE FOCUS AS IT OPENS: the frame for the box, the words for a caret — at their end, or where the second press fell.
  // The opening as it was when the editor opened, kept: a later press is the person's, and the browser places it.
  // EVERY FOCUS THE EDITOR GIVES ITSELF leaves the page where it is (`NO_SCROLL`): opening a block at the window's foot
  // scrolled the page 8 px to bring the frame in (Chromium 151, `editorFidelity.pw.ts`), and the person asked for no
  // scroll.
  const [start] = useState(opening);
  useLayoutEffect(() => {
    const words = surface.current;
    if (start.at === 'box') {
      frame.current?.focus(NO_SCROLL);
      return;
    }
    if (words === null) return;
    words.focus(NO_SCROLL);
    if (start.at === 'point') caretAtPoint(store, words, start.x, start.y);
    else writeSelection(words, store.get().selection);
  }, [start, store]);

  /**
   * A press that put the caret while the words were still laid out in stand-in faces, and the letters typed since
   * (cloud run 21's C1b, kept for the kit): the press is held, in the frame's own pixels so a scroll does not move it,
   * and once the file's faces are drawn the caret is put at it again in the layout the person now sees and the letters
   * go in there, in order. Measured 2026-10-26 in Chromium 151 with the faces 900 ms late (`textFirstClick.pw.ts`):
   * letters typed in the press's breath landed one or two characters away. Any other key or press, or
   * {@link HOLD_KEYS_MS}, settles at once with the layout as it is.
   */
  const held = useRef<{ readonly x: number; readonly y: number; readonly width: number; readonly letters: string[] } | undefined>(undefined);
  const settlePress = useCallback((): void => {
    const press = held.current;
    const words = surface.current;
    const corner = frame.current?.getBoundingClientRect();
    held.current = undefined;
    if (press === undefined || words === null || corner === undefined) return;
    // A FRAME OF ANOTHER SIZE (a zoom, a block scaled) is not the one pressed: the caret stays where it is.
    if (Math.abs(corner.width - press.width) <= 0.5) caretAtPoint(store, words, corner.left + press.x, corner.top + press.y);
    if (press.letters.length === 0) return;
    const { model, selection, pending } = store.get();
    store.change(insertText(model, selection, press.letters.join(''), pending), 'typing', press.letters.join(''));
  }, [store]);
  const holdPress = (x: number, y: number): void => {
    const corner = frame.current?.getBoundingClientRect();
    if (faces.settled || corner === undefined) return;
    held.current = { x: x - corner.left, y: y - corner.top, width: corner.width, letters: [] };
  };
  // THE FACES DRAWN: the layout will not change for them again, so the held press is placed in it.
  useLayoutEffect(() => {
    if (faces.settled) settlePress();
  }, [faces.settled, settlePress]);
  useEffect(() => {
    const bound = setTimeout(settlePress, HOLD_KEYS_MS);
    return () => {
      clearTimeout(bound);
    };
  }, [settlePress]);
  /** Letters typed while a press is held wait for it; anything else settles it first. */
  const onType = (text: string): boolean => {
    const press = held.current;
    if (press === undefined) return false;
    // TYPED LETTERS, as a key or an input method gives them; a line break or a tab is a key of its own, and settles.
    if (!/[\n\t]/u.test(text)) {
      press.letters.push(text);
      return true;
    }
    settlePress();
    return false;
  };

  // THE SECOND PRESS: inside the box, on words already laid out, the browser's caret is the one the person meant. A
  // double press that opened the box sends its second press here too, which the browser would take as *select a word*:
  // it is the caret at the press instead (section 3).
  useEffect(() => {
    const words = surface.current;
    if (words === null) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (mode !== 'box') {
        // A LATER PRESS is the person's own: a held one is placed first, then let go.
        settlePress();
        return;
      }
      if (event.detail >= 2) {
        event.preventDefault();
        words.focus(NO_SCROLL);
        caretAtPoint(store, words, event.clientX, event.clientY);
      }
      holdPress(event.clientX, event.clientY);
      setMode('text');
    };
    words.addEventListener('mousedown', onDown);
    return () => {
      words.removeEventListener('mousedown', onDown);
    };
  });
  const enterText = (): void => {
    const words = surface.current;
    if (words === null) return;
    store.select(caret(wholeBlock(store.get().model).focus));
    setMode('text');
    words.focus(NO_SCROLL);
    writeSelection(words, store.get().selection);
  };

  // THE FIRST BASELINE ON THE PAGE'S: a zero-size marker at the start of the first paragraph stands on its baseline, and
  // its offset is where the browser put it, whatever faces the runs are in. Measured again when a face loads.
  useLayoutEffect(() => {
    const words = surface.current;
    if (words === null) return undefined;
    const wanted = (block.box.y1 - (block.lines[0]?.baseline ?? block.box.y0)) * geometry.zoom;
    const measure = (): void => {
      const row = words.firstElementChild;
      if (!(row instanceof HTMLElement)) return;
      const marker = words.ownerDocument.createElement('span');
      marker.className = 'm-kit__baseline';
      row.prepend(marker);
      const at = marker.offsetTop;
      marker.remove();
      setShift(wanted - at);
    };
    measure();
    const fonts = words.ownerDocument.fonts;
    fonts.addEventListener('loadingdone', measure);
    return () => {
      fonts.removeEventListener('loadingdone', measure);
    };
  }, [block, geometry.zoom, look]);

  /** The paper under every paragraph the editor now draws, and over where the page drew the paragraphs it replaces. */
  const onPainted = useCallback(
    (words: HTMLElement): void => {
      const rows = Array.from(words.children).filter((row): row is HTMLElement => row instanceof HTMLElement);
      const drawnHere = rows.filter((row) => !row.classList.contains(AS_DRAWN_CLASS));
      const bands = paragraphBands(block, geometry.zoom);
      // THE PAGE'S COPY IS PAPERED only where the editor draws instead: under each paragraph it draws, and under any of the
      // page's paragraphs the model no longer has. A paragraph still as the page drew it keeps the page's own pixels —
      // papering every paragraph after the first change hid commands of a code block nobody had touched
      // (`editorFidelity.pw.ts`).
      const gone = bands.slice(rows.length);
      if (drawnHere.length === 0 && gone.length === 0) {
        setCovers((now) => (now.length === 0 ? now : []));
        return;
      }
      const found: { top: number; height: number }[] = [
        ...bands.filter((_band, index) => {
          const row = rows[index];
          return row !== undefined && !row.classList.contains(AS_DRAWN_CLASS);
        }),
        ...gone,
      ];
      const corner = frame.current?.getBoundingClientRect();
      for (const row of drawnHere) {
        // THE WORDS' OWN EXTENT where the page is upright, so the paper does not clip the next line's letters; the row's
        // box on a page drawn turned, whose screen rectangles are not the frame's.
        const range = words.ownerDocument.createRange();
        range.selectNodeContents(row);
        const extent = range.getBoundingClientRect();
        if (placed.rotation === 0 && corner !== undefined && extent.height > 0) found.push({ top: extent.top - corner.top, height: extent.height });
        else found.push({ top: words.offsetTop + row.offsetTop, height: row.offsetHeight });
      }
      // A PIXEL EITHER WAY, for the edge of a glyph's anti-aliasing.
      const next = found.map((cover) => ({ top: cover.top - 1, height: cover.height + 2 }));
      setCovers((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
    },
    [block, geometry.zoom, placed.rotation],
  );

  /** What the menu may do to the BLOCK: join or split, only while nothing is unwritten (ADR-0180 Decision 7). */
  const blockOps = (paragraph: number | undefined): EditorOps => {
    if (restructure === undefined || busy || problem !== undefined || store.changed() || moved) return {};
    const { above, below, apply, families } = restructure;
    // THE PARAGRAPH AS THE PAGE HAS IT: nothing is unwritten here, so the model's paragraphs are the page's.
    const split = paragraph === undefined ? undefined : splitEdits(block, paragraph);
    const join = async (upper: TextBlock, lower: TextBlock): Promise<BlockCommit> => {
      const { edits, kept } = joinEdits(upper, lower, await families());
      return apply(edits, kept);
    };
    return {
      ...(above === undefined ? {} : { joinAbove: () => void settle(() => join(above, block)) }),
      ...(below === undefined ? {} : { joinBelow: () => void settle(() => join(block, below)) }),
      ...(split === undefined ? {} : { split: () => void settle(() => apply(split)) }),
    };
  };

  /** The word and paragraph under a point, from the model: what the menu offers replacements for and splits before. */
  const under = (x: number, y: number) => {
    const words = surface.current;
    const owner = words?.ownerDocument;
    const at = owner === undefined ? undefined : (owner as Partial<Document>).caretPositionFromPoint?.call(owner, x, y);
    const live = words === null ? undefined : readSelection(words);
    const position = words === null || at === null || at === undefined ? live?.focus : positionOf(words, at.offsetNode, at.offset);
    const selected = live !== undefined && !isCollapsed(live);
    if (position === undefined) return { word: undefined, paragraph: undefined, selected };
    const { model } = store.get();
    const span = wordAt(model, position);
    const text = selectedText(model, span);
    const word =
      isCollapsed(span) || text.trim() === ''
        ? undefined
        : {
            word: text,
            replace: (replacement: string) => {
              const now = store.get().model;
              const { from, to } = ordered(span);
              store.change(replaceRange(now, from, to, replacement, styleAt(now, from)), 'other');
            },
          };
    return { word, paragraph: position.paragraph, selected };
  };

  // A DRAG OF A HANDLE: where the pointer went down and the placement it began from, the movement in PDF points by the
  // page's one transform.
  const dragging = useRef<{ handle: Handle; x: number; y: number; from: Placement } | undefined>(undefined);
  const pdfDelta = (dx: number, dy: number): { x: number; y: number } => {
    const shown = overlayTransform(geometry);
    const origin = toPdf(viewportPoint(0, 0), shown);
    const to = toPdf(viewportPoint(dx, dy), shown);
    return { x: to.x - origin.x, y: to.y - origin.y };
  };
  const handleProps = (handle: Handle) => ({
    // A PRESS ON A HANDLE KEEPS THE FOCUS where it was: the editor finishes when a press leaves the frame, not here.
    onMouseDown: (event: React.MouseEvent) => {
      event.preventDefault();
    },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (busy) return;
      event.preventDefault();
      event.stopPropagation();
      dragging.current = { handle, x: event.clientX, y: event.clientY, from: placement };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = dragging.current;
      if (drag === undefined) return;
      setPlacement(dragged(drag.handle, drag.from, pdfDelta(event.clientX - drag.x, event.clientY - drag.y), block.box, geometry.zoom));
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      dragging.current = undefined;
      event.currentTarget.releasePointerCapture(event.pointerId);
    },
  });

  /** The editor's own keys, in the words and on the box alike: answers whether it took the key. */
  const onKey = (event: KeyboardEvent): boolean => {
    if (composing(event)) return false;
    // ANY KEY BUT A LETTER settles a held press first, so it acts where the person pressed.
    const letter = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!letter) settlePress();
    const step = nudgeOf(event);
    if (step !== undefined) {
      actions.current.nudge(step);
      return true;
    }
    if (formatKey(event, block.style.size)) return true;
    if (event.key === 'Escape') {
      // AFTER A REFUSAL, Escape puts the words back rather than meeting the same refusal again.
      if (problem !== undefined) onClose('put-back');
      else void finish();
      return true;
    }
    return false;
  };

  // THE BOX'S OWN KEYS while no caret is in the words: Enter to the words' end, Delete to remove, and the editor's keys.
  const onBoxKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (mode !== 'box' || event.target !== frame.current) return;
    const native = event.nativeEvent;
    if (onKey(native)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      enterText();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      actions.current.remove();
    }
  };

  const wraps = !block.lines.some((line) => line.soft) && placement.width === undefined;
  return (
    // THE FRAME GROWS WITH ITS WORDS: at least the block's height, as tall as the words, so its outline shows where they
    // now reach and what they overlap (growth by overlap, ADR-0271 section 3).
    <div
      aria-busy={busy}
      className={`m-text-editor-frame m-kit-frame${mode === 'box' ? ' m-kit-frame--box' : ''}`}
      data-kit-frame=""
      data-kit-mode={mode}
      onKeyDown={onBoxKey}
      ref={frame}
      style={{ ...boxStyle(placed), height: 'auto', minHeight: placed.height }}
      tabIndex={-1}
    >
      {(moved ? [{ top: 0, height: undefined }] : covers).map((cover, at) => (
        <div aria-hidden="true" className="m-text-editor-cover" key={at} style={{ top: cover.top, height: cover.height ?? '100%', ...paper }} />
      ))}
      <div
        className="m-text-editor-placer"
        data-placed={moved ? '' : undefined}
        style={{
          ...(placement.width === undefined ? {} : { width: placement.width * geometry.zoom }),
          transform: placeTransform(placement, { width: placed.width, height: placed.height }, geometry.zoom),
        }}
      >
        <EditorMenu
          native={native}
          onNotice={setNotice}
          onOpenChange={(now) => {
            menuOpen.current = now;
          }}
          ops={blockOps}
          refocus={() => {
            const words = surface.current;
            if (words === null) return;
            words.focus(NO_SCROLL);
            writeSelection(words, store.get().selection);
          }}
          root={surface}
          spell={spell}
          under={under}
        >
          <EditorSurface
            className={`m-kit-surface${wraps ? ' m-kit-surface--lines' : ''}${moved ? ' m-kit-surface--placed' : ''}`}
            drawn={drawn}
            editable={!busy}
            label={_(TEXT_EDIT_EDITOR_LABEL)}
            look={look}
            onKey={onKey}
            onType={onType}
            onPainted={onPainted}
            store={store}
            style={{
              marginTop: shift,
              ...(moved ? paper : {}),
              tabSize: `${String(TAB_STOP * geometry.zoom)}px`,
            }}
            surfaceRef={surface}
          />
        </EditorMenu>
        {(placeable ? HANDLES : []).map(({ handle, label }) => (
          <button
            aria-label={_(label)}
            className={`m-text-editor-handle m-text-editor-handle--${handle}`}
            data-handle={handle}
            disabled={busy}
            key={handle}
            tabIndex={-1}
            type="button"
            {...handleProps(handle)}
          />
        ))}
      </div>
      {problem !== undefined ? (
        <EditorProblem problem={problem} />
      ) : notice !== undefined ? (
        <div className="m-text-editor-problem" role="status">
          <p>{_(notice)}</p>
        </div>
      ) : past ? (
        <div className="m-text-editor-problem m-text-editor-problem--above" role="status">
          <p>{_(TEXT_EDIT_PAST_PAGE)}</p>
        </div>
      ) : null}
    </div>
  );
}
