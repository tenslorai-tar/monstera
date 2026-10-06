import { useLingui } from '@lingui/react';
import type { BlockFormatting, EditedBlock, PageInsert, WindowEditAction } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import {
  type DocVersion,
  joinAfterLine,
  lineText,
  pdfPoint,
  toPdf,
  toViewport,
  viewportPoint,
} from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import { type BlockCommit, type BlocksRead, NO_RUN_FONTS, type RunFonts, type TextBlock } from './commands/documentCommands.js';
import { problemMessage, problemParticulars } from './dialogs/problemMessages.js';
import {
  TEXT_EDIT_BLOCK_LABEL,
  TEXT_EDIT_EDITOR_LABEL,
  TEXT_EDIT_LAYER_LABEL,
  TEXT_EDIT_HELD,
  TEXT_EDIT_NONE,
  TEXT_EDIT_PAST_PAGE,
  TEXT_EDIT_PROMOTE,
  TEXT_EDIT_REFUSED_HINT,
  TEXT_EDIT_MIRRORED,
  TEXT_EDIT_SLANTED,
  TEXT_EDIT_TURNED,
  TEXT_EDIT_VERTICAL,
  TEXT_EDIT_TRUNCATED,
  TEXT_EDIT_UNADDRESSABLE,
  TEXT_EDIT_UNREADABLE,
  TEXT_ADD_SURFACE,
  TEXT_HANDLE_MOVE,
  TEXT_HANDLE_SCALE,
  TEXT_HANDLE_TURN,
  TEXT_HANDLE_WIDTH,
} from './messages/en.js';
import { composing } from './surfaces/shortcuts.js';
import { joinEdits, neighbourOf, splitEdits, wordsOfBlock } from './textBlockOps.js';
import { type EditorOps, type EditorSpelling, TextEditorMenu } from './TextEditorMenu.js';
import { TextFormatBar } from './TextFormatBar.js';
import { formatOpenEditor, registerEditor } from './textEditorControl.js';
import { insertTab, isFormatted, readEditor } from './textFormatting.js';
import {
  dragged,
  type Handle,
  NOT_PLACED,
  type Nudge,
  nudged,
  type Placement,
  placeOf,
  placeTransform,
} from './textPlacement.js';

/**
 * Text edited where it is on the page — Edit text's mode, drawn over one page
 * ([ADR-0096](../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md)).
 *
 * ## What it draws
 *
 * Every editable block on the page, OUTLINED in place — the owner's standard,
 * from their recording of another editor. A click (or Enter on a focused
 * outline) opens an editor exactly over the block, set in the block's size,
 * colour and kind of face, with the page's own paper colour behind it so the
 * words it replaces do not show through. Typing wraps inside the block's
 * width; Escape or a click anywhere else writes the edit; an edit that changed
 * nothing writes nothing. Selection handles mark the open block and place it.
 *
 * ## The handles are CONTROLS, and each does what it looks like it does
 *
 * Until ADR-0180 they were a mark that said *this block is the one open*, with no pointer and no cursor, because a
 * handle that looked draggable and did nothing would be the wired-tools rule's defect drawn eight times. Now the sides
 * set the block's measure, the corners scale it, the top grip moves it and the one to the right turns it; the same
 * placements are made by keys (Alt with an arrow, a bracket, plus or minus, a comma or a full stop). What is done is
 * shown at once and written WITH the words, as one command.
 *
 * ## What it knows, which is deliberately little
 *
 * Nothing here reads a client or builds a command. The blocks arrive from the
 * application's read, and an edit leaves through `onCommit`, which is
 * `commitTextBlock` — the one way a block is written. The boxes are placed
 * through the page's `PageTransform`, as every overlay's are, and decide
 * nothing: hit-testing is the browser's, on the elements they position.
 */

/** One page's blocks, stamped with the version the read answered at and the writer it named. */
export interface PageBlocks extends BlocksRead {
  readonly blocks: readonly TextBlock[];
  readonly truncated: boolean;
  readonly rotated: number;
  /** `rotated` by kind, which the note names (ADR-0181 Decision 7). */
  readonly angled: { readonly turned: number; readonly vertical: number; readonly slanted: number; readonly mirrored: number };
  readonly unaddressable: number;
}

export interface TextEditLayerProps {
  /** Zero-based, as a command names it. */
  readonly page: number;
  /** The page as drawn, for the transform. */
  readonly geometry: OverlayPage;
  /** The page's blocks, or `undefined` while they are being read or where the read was refused. */
  readonly blocks: PageBlocks | undefined;
  /** Whether the read of this page was REFUSED: the page says so, and the mode stays on for the others. */
  readonly unreadable?: boolean;
  /** Whether a press on the empty page opens a box of new text (Add text), rather than being nothing. */
  readonly adding?: boolean;
  /** Adds a box of new text to the page, at the version the blocks were read at. */
  readonly onInsert?: (insert: PageInsert, read: BlocksRead) => Promise<BlockCommit>;
  /** Called when a box was added or abandoned, so the mode goes back to editing what is there. */
  readonly onAdded?: () => void;
  /** The browser's own edit verbs, run by main on the window, for the editor's right-click menu. */
  readonly native?: (action: WindowEditAction) => void;
  /** The spelling checker's answers for the editor's right-click menu. */
  readonly spell?: EditorSpelling;
  /** Writes blocks joined or split in one command (ADR-0180 Decision 7), at the version the blocks were read at. */
  readonly onRestructure?: (edits: EditedBlock[], read: BlocksRead) => Promise<BlockCommit>;
  /** Writes one block's new words, at the version the blocks were read at and by the writer that read named. */
  readonly onCommit: (block: TextBlock, text: string, read: BlocksRead, formatting?: BlockFormatting) => Promise<BlockCommit>;
  /** The fonts the open block's runs are drawn in, rebuilt by the host, at the version it was read at (ADR-0175). */
  readonly runFonts: (block: TextBlock, version: DocVersion) => Promise<RunFonts>;
  /** Unpacks the page's blocked-in text so it can be edited. */
  readonly onPromote: () => void;
  /** Leaves the mode: Escape pressed with no block open. */
  readonly onLeave: () => void;
  /**
   * The page's own colour behind a point of the drawn page, in the overlay's
   * CSS pixels, or `undefined` where it cannot be read.
   */
  readonly paperAt: (x: number, y: number) => string | undefined;
}

/** A box in the overlay's CSS pixels, and the turn the page is drawn at. */
interface Placed {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

/**
 * Where a PDF box lands on the drawn page.
 *
 * The box's top-left IN PDF SPACE is placed, and the width and height are the
 * box's own at the zoom; a page drawn turned is then turned by CSS about that
 * corner, so the editor's text runs the way the page's does. Placing the four
 * corners' bounding box instead would give a rotated page a box of the right
 * size holding text that reads the wrong way.
 */
function place(box: TextBlock['box'], geometry: OverlayPage): Placed {
  const transform = overlayTransform(geometry);
  const corner = toViewport(pdfPoint(box.x0, box.y1), transform);
  return {
    left: corner.x,
    top: corner.y,
    width: (box.x1 - box.x0) * geometry.zoom,
    height: (box.y1 - box.y0) * geometry.zoom,
    rotation: geometry.rotation,
  };
}

/**
 * How far, in points, a block's ink may cross the page's edge before it is said not to fit: a quarter of a point,
 * under anything a reader sees and over the rounding of a glyph's box set flush against the edge.
 */
const PAGE_EDGE_TOLERANCE = 0.25;

/**
 * Whether a block's words run past the page's visible box, so some of them are written and cannot be seen (the
 * owner's Q7). Both boxes are in PDF space, the pair {@link place} already puts on screen, so this asks no second
 * conversion. Measured 2026-10-06 on PDFium 155.0.8044.0's Linux build: a block typed past the foot of the page is
 * saved whole and PDFium's reading answers every line, its box reaching below the page, while MuPDF's reading of the
 * same bytes drops the lines past the edge, so the read this layer outlines is the one that can see them.
 */
export function pastItsPage(box: TextBlock['box'], crop: OverlayPage['crop']): boolean {
  const [x0, y0, x1, y1] = crop;
  return (
    box.x0 < x0 - PAGE_EDGE_TOLERANCE ||
    box.y0 < y0 - PAGE_EDGE_TOLERANCE ||
    box.x1 > x1 + PAGE_EDGE_TOLERANCE ||
    box.y1 > y1 + PAGE_EDGE_TOLERANCE
  );
}

/**
 * Whether two boxes share any area: how a new read finds the block a write grew. Its first line stays where it was and
 * the rest grows down, so the new block covers the old one's top; a corner is not enough, since a box is its glyphs'
 * ink and a first line that gains a capital or an accent moves its own top.
 */
function overlaps(a: TextBlock['box'], b: TextBlock['box']): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Where a person clicked, in the window's pixels. */
interface Click {
  readonly x: number;
  readonly y: number;
}

/** A box's area in PDF points squared: the order outlines are stacked in. */
function area(box: TextBlock['box']): number {
  return (box.x1 - box.x0) * (box.y1 - box.y0);
}

/**
 * Puts the caret where the person clicked, in the words just built: the browser's own answer to *which character is
 * under this point*, so it is right for wrapped, aligned and indented lines alike. Where it names nothing in the editor
 * (the point is outside the words, or the browser has no such call), the caret stays where the caller left it.
 */
function caretAt(element: HTMLElement, click: Click): boolean {
  const owner = element.ownerDocument;
  const place = (node: Node, offset: number): boolean => {
    if (!element.contains(node)) return false;
    const range = owner.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = owner.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  };
  // THE CALL CHROMIUM 128 ADDED; an engine without it (the test DOM) leaves the caret where the caller put it.
  const position = (owner as Partial<Document>).caretPositionFromPoint?.call(owner, click.x, click.y);
  if (position === null || position === undefined) return false;
  return place(position.offsetNode, position.offset);
}

/** The CSS a placed box is drawn with. */
function boxStyle(placed: Placed): React.CSSProperties {
  return {
    left: placed.left,
    top: placed.top,
    width: placed.width,
    height: placed.height,
    ...(placed.rotation === 0 ? {} : { transform: `rotate(${String(placed.rotation)}deg)` }),
  };
}

/**
 * The page's own colour around a block: the most common of four points just
 * OUTSIDE its corners.
 *
 * Outside, because a block's box is the union of its glyphs' ink — measured
 * 2026-09-23 in the running build, a point one pixel inside the top-left corner
 * landed on the first letter and set the editor's paper to the text's colour.
 * Four, because one point outside can land on a neighbouring rule or a line of
 * another block; the page's paper is the answer most of them agree on.
 */
function paperAround(
  placed: Placed,
  paperAt: (x: number, y: number) => string | undefined,
): React.CSSProperties | undefined {
  const margin = 3;
  const at = [
    paperAt(placed.left - margin, placed.top - margin),
    paperAt(placed.left + placed.width + margin, placed.top - margin),
    paperAt(placed.left - margin, placed.top + placed.height + margin),
    paperAt(placed.left + placed.width + margin, placed.top + placed.height + margin),
  ];
  const samples = at.filter((sample): sample is string => sample !== undefined);
  let best: string | undefined;
  let most = 0;
  for (const sample of samples) {
    const count = samples.filter((other) => other === sample).length;
    if (count > most) {
      best = sample;
      most = count;
    }
  }
  if (best === undefined) return undefined;
  // THREE OF FOUR AGREEING is flat paper with a stray neighbour at the fourth. PAPER THAT IS NOT ONE COLOUR is shading,
  // and a flat patch of its commonest sample would be a visible rectangle over it: where no three agree, the editor's
  // paper is the gradient between the top pair and the bottom pair, which is how a page shades (a fill that varies
  // across the block's height), and it ends at the same colours.
  if (most >= Math.min(3, samples.length)) return { backgroundColor: best };
  const top = averageColour(at[0], at[1]) ?? averageColour(at[2], at[3]);
  const bottom = averageColour(at[2], at[3]) ?? top;
  if (top === undefined || bottom === undefined) return { backgroundColor: best };
  return { backgroundImage: `linear-gradient(to bottom, ${top}, ${bottom})` };
}

/** The mean of two sampled `rgb(r, g, b)` colours, or of the one there is; `undefined` where neither reads. */
function averageColour(a: string | undefined, b: string | undefined): string | undefined {
  const read = (sample: string | undefined): readonly number[] | undefined => {
    const found = /^rgb\((\d+), (\d+), (\d+)\)$/u.exec(sample ?? '');
    return found === null ? undefined : [Number(found[1]), Number(found[2]), Number(found[3])];
  };
  const x = read(a);
  const y = read(b);
  const mixed = x === undefined ? y : y === undefined ? x : x.map((value, at) => (value + (y[at] ?? value)) / 2);
  if (mixed === undefined) return undefined;
  return `rgb(${mixed.map((value) => String(Math.round(value))).join(', ')})`;
}

/**
 * A block's words as the person is shown them: its PARAGRAPHS, each line by `lineText`, a soft wrap one space and a hard
 * break a line break, by the one join the kernel diffs them against
 * ([ADR-0179](../../../docs/DECISIONS/0179-a-paragraph-is-the-editors-unit-and-a-reflow-keeps-each-word-in-its-own-style.md)).
 */
const wordsOf = wordsOfBlock;

/** A block's lines grouped into the paragraphs the editor draws: a line that ends soft continues in the next. */
function paragraphsOf(block: TextBlock): TextBlock['lines'][number][][] {
  const paragraphs: TextBlock['lines'][number][][] = [];
  let open: TextBlock['lines'][number][] = [];
  for (const [at, line] of block.lines.entries()) {
    open.push(line);
    if (!line.soft || at === block.lines.length - 1) {
      paragraphs.push(open);
      open = [];
    }
  }
  return paragraphs;
}

/**
 * The distance between a block's lines, in points — its first two lines' tops
 * apart — or `undefined` for a block of one line, which has no spacing of its
 * own to copy and is set at the face's normal spacing.
 */
function pitchOf(block: TextBlock): number | undefined {
  const [first, second] = block.lines;
  if (first !== undefined && second !== undefined && first.box.y1 > second.box.y1) {
    return first.box.y1 - second.box.y1;
  }
  return undefined;
}

/** The face kind a block or a run is set in, as the class that names it. */
function faceOf(style: TextBlock['style']): string {
  if (style.mono) return 'm-text-editor--mono';
  if (style.serif) return 'm-text-editor--serif';
  return 'm-text-editor--sans';
}

export function TextEditLayer({
  page,
  geometry,
  blocks,
  unreadable = false,
  adding = false,
  onInsert,
  onAdded,
  native,
  spell,
  onRestructure,
  onCommit,
  runFonts,
  onPromote,
  onLeave,
  paperAt,
}: TextEditLayerProps): ReactElement {
  const { _ } = useLingui();
  /** The open block: its position in the answer, and the version that answer was read at. */
  const [opened, setOpened] = useState<
    { readonly at: number; readonly version: DocVersion; readonly click: Click | undefined } | undefined
  >();
  // A NEW READ CLOSES THE EDITOR, and it is DERIVED rather than reset in an
  // effect: an open block's indices describe the version it was read at, so an
  // editor over a newer answer would write words over objects the page no
  // longer has — and an effect would leave it open for one render first.
  const chosen = opened !== undefined && opened.version === blocks?.version ? opened.at : undefined;
  /**
   * The block a written edit was made to, and the version it was read at, until the editor that reopens over it closes
   * or the person opens another (the owner's Q7).
   */
  const [written, setWritten] = useState<{ readonly box: TextBlock['box']; readonly version: DocVersion } | undefined>();
  // A WRITE THAT RAN PAST THE PAGE REOPENS ITS EDITOR, with every word in it and the sentence under them, so the
  // person sees what they typed and can shorten it. DERIVED, for the reason `chosen` is: the read after the write
  // is the first that holds the block as written, and an effect would draw that read once with no editor first.
  const regrown =
    written === undefined || blocks === undefined || blocks.version === written.version
      ? -1
      : blocks.blocks.findIndex((block) => overlaps(block.box, written.box) && pastItsPage(block.box, geometry.crop));
  /**
   * The block a click chose WHILE ANOTHER WAS OPEN, held until that one is written and the page read again, and then
   * opened where it now is (ADR-0180 Decision 8): the open editor is written first and the next opens after it, one
   * ordered sequence, so nothing typed is replaced unwritten by the block clicked next.
   */
  const [next, setNext] = useState<
    { readonly box: TextBlock['box']; readonly click: Click | undefined; readonly version: DocVersion } | undefined
  >();
  /** The same request, readable by the close of an editor that began before the click was seen. */
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);
  // THE BLOCK HANDED TO, in the read after the write: DERIVED for `regrown`'s reason, so it is the editor that is drawn
  // when the read arrives and not a second render with none.
  const handed =
    next === undefined || blocks === undefined || blocks.version === next.version
      ? -1
      : blocks.blocks.findIndex((block) => overlaps(block.box, next.box));
  const open = chosen ?? (handed === -1 ? (regrown === -1 ? undefined : regrown) : handed);
  /** Finishes the open editor: the write its blur began, or one begun here when no blur preceded the click. */
  const finishingRef = useRef<(() => Promise<void>) | undefined>(undefined);
  /** Whether the open editor holds words it could not write, which a click elsewhere must not replace. */
  const stuckRef = useRef(false);
  const setOpen = (at: number | undefined, click?: Click): void => {
    setWritten(undefined);
    setNext(undefined);
    setOpened(at === undefined || blocks === undefined ? undefined : { at, version: blocks.version, click });
  };
  /**
   * The box of NEW text being typed, and the version of the read it was begun over (ADR-0180 Decision 6). Like an open
   * block it is a read's: a newer read closes it, derived for `chosen`'s reason.
   */
  const [fresh, setFresh] = useState<{ readonly made: FreshBox; readonly version: DocVersion } | undefined>();
  const freshOpen = fresh !== undefined && fresh.version === blocks?.version ? fresh.made : undefined;
  /** Whether any editor is open on this page, a block's or a new box's: what a click on another block must write first. */
  const editing = open !== undefined || freshOpen !== undefined;

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === 'Escape' && open === undefined) {
        event.stopPropagation();
        onLeave();
      }
    },
    [onLeave, open],
  );

  const notes: ReactElement[] = [];
  if (unreadable && blocks === undefined) notes.push(<p key="unreadable">{_(TEXT_EDIT_UNREADABLE)}</p>);
  if (blocks !== undefined) {
    if (blocks.blocks.length === 0 && blocks.unaddressable === 0 && blocks.rotated === 0) {
      notes.push(<p key="none">{_(TEXT_EDIT_NONE)}</p>);
    }
    if (blocks.truncated) notes.push(<p key="truncated">{_(TEXT_EDIT_TRUNCATED)}</p>);
    // THE KINDS THE PAGE HAS, each in its own sentence, in a fixed order (ADR-0181 Decision 7).
    const angled = blocks.angled;
    if (angled.turned > 0) notes.push(<p key="turned">{_(TEXT_EDIT_TURNED)}</p>);
    if (angled.vertical > 0) notes.push(<p key="vertical">{_(TEXT_EDIT_VERTICAL)}</p>);
    if (angled.slanted > 0) notes.push(<p key="slanted">{_(TEXT_EDIT_SLANTED)}</p>);
    if (angled.mirrored > 0) notes.push(<p key="mirrored">{_(TEXT_EDIT_MIRRORED)}</p>);
    if (blocks.unaddressable > 0) {
      notes.push(
        <p key="unaddressable">
          {_(TEXT_EDIT_UNADDRESSABLE)}{' '}
          <button className="m-text-edit__promote" onClick={onPromote} type="button">
            {_(TEXT_EDIT_PROMOTE)}
          </button>
        </p>,
      );
    }
  }

  return (
    <div
      aria-label={_(TEXT_EDIT_LAYER_LABEL, { page: page + 1 })}
      className="m-text-edit-layer"
      data-text-edit-layer={String(page)}
      onKeyDown={onKeyDown}
      role="group"
    >
      {blocks?.blocks.map((block, at) => {
        const placed = place(block.box, geometry);
        if (at === open) {
          return (
            <BlockEditor
              block={block}
              click={chosen === undefined ? (handed === at ? next?.click : undefined) : opened?.click}
              finishingRef={finishingRef}
              geometry={geometry}
              native={native}
              restructure={
                onRestructure === undefined
                  ? undefined
                  : {
                      above: blocks.blocks[neighbourOf(blocks.blocks, at, 'above') ?? -1],
                      below: blocks.blocks[neighbourOf(blocks.blocks, at, 'below') ?? -1],
                      apply: (edits) => onRestructure(edits, blocks),
                    }
              }
              spell={spell}
              stuckRef={stuckRef}
              // THE BLOCK'S POSITION AND THE VERSION, so a new read — or the
              // same slot holding a different block — is a new editor rather
              // than old words in a new place.
              key={`editor-${String(blocks.version)}-${String(at)}`}
              // CLOSES ONLY ITSELF. A click on another block blurs this one, and
              // the write it starts finishes after that block has opened — an
              // unconditional close would shut the block the person just chose.
              // A WRITE KEEPS `written` for the read after it; any other close ends the reopening.
              onClose={(outcome) => {
                if (outcome !== 'written') setWritten(undefined);
                // THE BLOCK CLICKED WHILE THIS ONE WAS OPEN, when this wrote nothing: the page is as it was, so the
                // block opens where it is. After a WRITE it opens in the read that follows (`handed`).
                const waiting = nextRef.current;
                if (outcome === 'unchanged' && waiting !== undefined) {
                  const target = blocks.blocks.findIndex((other, place) => place !== at && overlaps(other.box, waiting.box));
                  if (target !== -1) {
                    setOpen(target, waiting.click);
                    return;
                  }
                }
                // THE HANDED-TO EDITOR CLOSING ends the hand-over; the one being written closing does not.
                if (at === handed || outcome === 'put-back') setNext(undefined);
                setOpened((current) => (current?.at === at ? undefined : current));
              }}
              onCommit={async (text, formatting) => {
                const outcome = await onCommit(block, text, blocks, formatting);
                if (outcome === 'written') setWritten({ box: block.box, version: blocks.version });
                // A REFUSED WRITE KEEPS ITS EDITOR AND ITS WORDS, so the block clicked meanwhile does not open over them.
                else if (outcome !== 'unchanged') setNext(undefined);
                return outcome;
              }}
              paper={paperAround(placed, paperAt)}
              past={pastItsPage(block.box, geometry.crop)}
              placed={placed}
              runFonts={() => runFonts(block, blocks.version)}
            />
          );
        }
        const words = wordsOf(block).replace(/\s+/gu, ' ').trim();
        const past = pastItsPage(block.box, geometry.crop);
        const outline = (
          <button
            aria-label={_(TEXT_EDIT_BLOCK_LABEL, { words: words.length > 40 ? `${words.slice(0, 40)}…` : words })}
            {...(past ? { 'aria-description': _(TEXT_EDIT_PAST_PAGE) } : {})}
            className={past ? 'm-text-block m-text-block--past' : 'm-text-block'}
            data-text-block={String(at)}
            key={`block-${String(blocks.version)}-${String(at)}`}
            onClick={(event) => {
              // A KEY'S ACTIVATION reports a click at no point (`detail` 0): the caret then goes to the end, as before.
              const click = event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY };
              if (editing && open !== at) {
                // ANOTHER EDITOR IS OPEN, a block's or a new box's: its words are written first and this block opens after
                // it (`next`). One that holds words it could not write is left as it is: the editor says why, and a click
                // elsewhere replaces nothing.
                if (stuckRef.current) return;
                setNext({ box: block.box, click, version: blocks.version });
                void finishingRef.current?.();
                return;
              }
              setOpen(at, click);
            }}
            // A SMALLER BLOCK ABOVE A LARGER ONE that holds it, so the click on a heading inside a column's box is the
            // heading's, and the larger is reached where the smaller is not: stacked by area, the smallest on top.
            style={{ ...boxStyle(placed), zIndex: 1 + blocks.blocks.filter((other) => area(other.box) > area(block.box)).length }}
            type="button"
          />
        );
        if (!past) return outline;
        // SAID AT THE BLOCK'S TOP, which stays on the page when its words run off the foot: a note at the page's top
        // was scrolled away whenever the block was on screen, measured in Chromium 151. Hidden from the accessibility
        // tree, since the outline it labels already describes itself with the same sentence.
        return [
          outline,
          <p
            aria-hidden="true"
            className="m-text-block__past"
            data-text-block-past={String(at)}
            key={`past-${String(blocks.version)}-${String(at)}`}
            style={{ left: placed.left, top: placed.top }}
          >
            {_(TEXT_EDIT_PAST_PAGE)}
          </p>,
        ];
      })}
      {adding && blocks !== undefined && freshOpen === undefined ? (
        // ADD TEXT: the empty page is a surface under the outlines, so a press on a block still edits that block and a
        // press anywhere else is where the new words go. A key's activation reports no point and puts it at the margin.
        <button
          aria-label={_(TEXT_ADD_SURFACE)}
          className="m-text-add-surface"
          data-text-add-surface=""
          onClick={(event) => {
            const edge = event.currentTarget.getBoundingClientRect();
            const css =
              event.detail === 0
                ? { x: NEW_TEXT_MARGIN * geometry.zoom, y: NEW_TEXT_MARGIN * geometry.zoom }
                : { x: event.clientX - edge.left, y: event.clientY - edge.top };
            setFresh({ made: freshBox(css, geometry), version: blocks.version });
            setNext(undefined);
          }}
          type="button"
        />
      ) : null}
      {freshOpen !== undefined && blocks !== undefined ? (
        <BlockEditor
          block={freshOpen.block}
          click={undefined}
          finishingRef={finishingRef}
          geometry={geometry}
          key={`fresh-${String(blocks.version)}`}
          native={native}
          spell={spell}
          onClose={(outcome) => {
            const waiting = nextRef.current;
            setFresh(undefined);
            // BACK TO EDITING what is on the page, whether the box was written or abandoned: one box at a time. A block
            // clicked while this was open opens now where nothing was written, and after the read where it was.
            if (outcome === 'unchanged' && waiting !== undefined) {
              const target = blocks.blocks.findIndex((other) => overlaps(other.box, waiting.box));
              if (target !== -1) {
                setOpen(target, waiting.click);
                return;
              }
            }
            if (outcome === 'put-back' || outcome === 'unchanged') setNext(undefined);
            if (outcome !== 'written') onAdded?.();
          }}
          onCommit={async (text, formatting) => {
            const outcome = (await onInsert?.(insertOf(freshOpen, text, formatting), blocks)) ?? 'unchanged';
            if (outcome !== 'written' && outcome !== 'unchanged') setNext(undefined);
            if (outcome === 'written') onAdded?.();
            return outcome;
          }}
          paper={undefined}
          past={false}
          placeable={false}
          placed={place(freshOpen.block.box, geometry)}
          runFonts={() => Promise.resolve(NO_RUN_FONTS)}
          stuckRef={stuckRef}
        />
      ) : null}
      {notes.length > 0 ? <div className="m-page-mode__notes">{notes}</div> : null}
    </div>
  );
}

/** The margin a new box keeps from the page's edge, in points, and the size and colour its words start in. */
const NEW_TEXT_MARGIN = 36;
const NEW_TEXT_SIZE = 12;

/** A box of new text as the editor opens it: a synthetic block holding one empty run, and where it goes on the page. */
interface FreshBox {
  readonly block: TextBlock;
  readonly left: number;
  readonly baseline: number;
  readonly measure: number;
}

/**
 * The box a press at `css` (the layer's pixels) begins: its top left where the person pressed, the measure the page's
 * margin leaves it and a first baseline one ascent below its top. The block it is drawn as is the editor's own shape, with
 * a run no page holds (index 0 names no object: nothing reads it, since a box is written by its words alone).
 */
function freshBox(css: { readonly x: number; readonly y: number }, geometry: OverlayPage): FreshBox {
  const [x0, , x1] = geometry.crop;
  const at = toPdf(viewportPoint(css.x, css.y), overlayTransform(geometry));
  const left = Math.min(Math.max(at.x, x0), Math.max(x0, x1 - NEW_TEXT_MARGIN));
  const measure = Math.min(Math.max(x1 - NEW_TEXT_MARGIN - left, 80), 360);
  const baseline = at.y - NEW_TEXT_SIZE * 0.8;
  const style = { size: NEW_TEXT_SIZE, colour: { r: 0, g: 0, b: 0 }, serif: false, mono: false, italic: false, bold: false };
  const box = { x0: left, y0: at.y - NEW_TEXT_SIZE * 1.2, x1: left + measure, y1: at.y };
  return {
    block: {
      box,
      lines: [{ runs: [{ index: 0, text: '', style }], box, soft: false }],
      style,
      shape: { align: 'left', firstIndent: 0 },
    },
    left,
    baseline,
    measure,
  };
}

/** The wire's box from what the editor says of it: its words, with the marks and paragraph settings the person gave them. */
function insertOf(made: FreshBox, text: string, formatting: BlockFormatting): PageInsert {
  return {
    left: made.left,
    baseline: made.baseline,
    measure: made.measure,
    size: NEW_TEXT_SIZE,
    text,
    ...(formatting.marks === undefined ? {} : { marks: [...formatting.marks] }),
    ...(formatting.paragraphs === undefined ? {} : { paragraphs: [...formatting.paragraphs] }),
  };
}

/** What the mode hands each page: where blocks come from and where an edit goes. */
export interface TextEditing {
  /** Which of the page list's two modes this is (ADR-0153 Decision 1). */
  readonly mode: 'text';
  /** The document version on screen; a new one is a new read. */
  readonly version: DocVersion;
  /** Reads one page's blocks, or `undefined` where the read was refused. */
  readonly read: (page: number) => Promise<PageBlocks | undefined>;
  readonly onCommit: (
    page: number,
    block: TextBlock,
    text: string,
    read: BlocksRead,
    formatting?: BlockFormatting,
  ) => Promise<BlockCommit>;
  /** The fonts one block's runs are drawn in, as the host rebuilt them, at the version the block was read at (ADR-0175). */
  readonly runFonts: (page: number, block: TextBlock, version: DocVersion) => Promise<RunFonts>;
  readonly onPromote: (page: number) => void;
  readonly onLeave: () => void;
  /** Whether a press on the empty page opens a box of new text: Edit text's ADD flavour (ADR-0180 Decision 6). */
  readonly adding: boolean;
  /** Adds a box of new text to a page. */
  readonly onInsert: (page: number, insert: PageInsert, read: BlocksRead) => Promise<BlockCommit>;
  /** A box was added or abandoned: back to editing what is on the page. */
  readonly onAdded: () => void;
  /** The browser's own edit verbs, run by main on the window. */
  readonly native: (action: WindowEditAction) => void;
  /** The spelling checker's answers for the editor's right-click menu. */
  readonly spell: EditorSpelling;
  /** Writes blocks joined or split, in one command. */
  readonly onRestructure: (page: number, edits: EditedBlock[], read: BlocksRead) => Promise<BlockCommit>;
}

/**
 * One page's editing surface: reads the page's blocks at the version on screen
 * and draws {@link TextEditLayer} over them.
 *
 * ## The answer carries the question it answers
 *
 * `usePageText`'s rule: a read resolving after the version moved is discarded,
 * because blocks read at version 4 outlined over the page at version 5 would
 * put an editor over words that are not there.
 */
export function TextEditPage({
  page,
  geometry,
  editing,
  paperAt,
}: {
  readonly page: number;
  readonly geometry: OverlayPage;
  readonly editing: TextEditing;
  /**
   * The paper's colour at a point, in CSS pixels from the page's corner — read by the slot from whatever it drew
   * there, a whole page or a tile (E1). `undefined` where nothing is drawn yet.
   */
  readonly paperAt: (x: number, y: number) => string | undefined;
}): ReactElement {
  const [answer, setAnswer] = useState<{ readonly version: DocVersion; readonly blocks: PageBlocks | undefined }>();
  const { read, version } = editing;
  useEffect(() => {
    let current = true;
    void read(page).then((blocks) => {
      if (current) setAnswer({ version, blocks });
    });
    return () => {
      current = false;
    };
  }, [page, read, version]);

  return (
    <TextEditLayer
      blocks={answer?.version === version ? answer.blocks : undefined}
      // AN ANSWER AT THIS VERSION WITH NO BLOCKS is a refused read (the read answers `undefined` for one), as against no
      // answer yet.
      unreadable={answer?.version === version && answer.blocks === undefined}
      geometry={geometry}
      onCommit={(block, text, read, formatting) => editing.onCommit(page, block, text, read, formatting)}
      onLeave={editing.onLeave}
      adding={editing.adding}
      onAdded={editing.onAdded}
      native={editing.native}
      spell={editing.spell}
      onRestructure={(edits, read) => editing.onRestructure(page, edits, read)}
      onInsert={(insert, read) => editing.onInsert(page, insert, read)}
      runFonts={(block, at) => editing.runFonts(page, block, at)}
      onPromote={() => {
        editing.onPromote(page);
      }}
      page={page}
      paperAt={paperAt}
    />
  );
}

interface BlockEditorProps {
  readonly block: TextBlock;
  readonly geometry: OverlayPage;
  readonly placed: Placed;
  readonly paper: React.CSSProperties | undefined;
  /** Where the person clicked to open it, in the window's pixels: the caret goes there. None for a key. */
  readonly click: { readonly x: number; readonly y: number } | undefined;
  /** Whether the block's words run past the page as read, which the editor says beside them (the owner's Q7). */
  readonly past: boolean;
  readonly onCommit: (text: string, formatting: BlockFormatting) => Promise<BlockCommit>;
  /** Closes the editor: after a write, after nothing to write, or put back with Escape after a refusal. */
  readonly onClose: (outcome: 'written' | 'unchanged' | 'put-back') => void;
  /** The fonts this block's runs are drawn in, read once when the editor opens (ADR-0175). */
  readonly runFonts: () => Promise<RunFonts>;
  /**
   * Whether the block can be placed with handles and keys. False for a box of new text, whose place is where it was
   * begun and which can be moved once it is on the page like any block.
   */
  readonly placeable?: boolean;
  /** The browser's own edit verbs, for the right-click menu (`window.edit`). */
  readonly native?: ((action: WindowEditAction) => void) | undefined;
  /** The spelling checker's answers, for the right-click menu. */
  readonly spell?: EditorSpelling | undefined;
  /** The blocks beside this one it may be joined with, and the write of a join or a split (ADR-0180 Decision 7). */
  readonly restructure?:
    | {
        readonly above: TextBlock | undefined;
        readonly below: TextBlock | undefined;
        readonly apply: (edits: EditedBlock[]) => Promise<BlockCommit>;
      }
    | undefined;
  /** Where this editor puts the function that writes it, so a click on another block can ask for the write. */
  readonly finishingRef: React.RefObject<(() => Promise<void>) | undefined>;
  /** Where this editor says whether it holds words it could not write. */
  readonly stuckRef: React.RefObject<boolean>;
}

/**
 * The family a rebuilt font is loaded under: this editor's and the font's place, so two editors, two documents or two
 * versions never share a name (ADR-0175's correction). `useId`'s punctuation is dropped, since the name is written into
 * a CSS value and a family of letters and digits needs no quoting rule.
 */
function familyOf(editor: string, place: number): string {
  return `m-run-${editor.replace(/[^a-zA-Z0-9]/gu, '')}-${String(place)}`;
}

/**
 * Loads `fonts` as faces of this editor and draws every run that has one in it, removing the faces when the editor
 * closes. A face the browser refuses to load — its own sanitiser declining the bytes — leaves its runs in their kind of
 * face and marks them `data-run-font="refused"`, so the outcome is on the element rather than nowhere.
 */
function useRunFonts(
  area: React.RefObject<HTMLDivElement | null>,
  read: () => Promise<RunFonts>,
  editor: string,
): void {
  useEffect(() => {
    const element = area.current;
    if (element === null) return;
    const owner = element.ownerDocument;
    let current = true;
    const added: FontFace[] = [];
    void read().then(async ({ fonts, runs }) => {
      if (fonts.length === 0) return;
      const faces = await Promise.all(
        fonts.map((bytes, place) => {
          const face = new FontFace(familyOf(editor, place), bytes);
          return face.load().then(
            () => face,
            () => undefined,
          );
        }),
      );
      if (!current) return;
      for (const face of faces) {
        if (face === undefined) continue;
        owner.fonts.add(face);
        added.push(face);
      }
      for (const span of element.querySelectorAll<HTMLElement>('.m-text-editor__run[data-run]')) {
        const place = runs.get(Number(span.dataset['run']));
        if (place === undefined) continue;
        if (faces[place] === undefined) {
          span.dataset['runFont'] = 'refused';
          continue;
        }
        span.dataset['runFont'] = familyOf(editor, place);
        span.classList.add('m-text-editor__run--own');
        span.style.setProperty('--m-run-font', familyOf(editor, place));
      }
    });
    return () => {
      current = false;
      for (const face of added) owner.fonts.delete(face);
    };
  }, [area, editor, read]);
}

/** What a run is drawn in: the page's own values — size, fill, weight, slant — and the face kind by class. */
function drawRun(span: HTMLElement, style: TextBlock['style'], zoom: number): void {
  const { r, g, b } = style.colour;
  span.className = `m-text-editor__run ${faceOf(style)}`;
  span.dataset['size'] = String(style.size);
  span.style.fontSize = `${String(style.size * zoom)}px`;
  span.style.fontWeight = style.bold ? '700' : '400';
  span.style.fontStyle = style.italic ? 'italic' : 'normal';
  span.style.color = `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
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
 * The open block: an editable element over the words, each run set like the page's
 * ([ADR-0145](../../../docs/DECISIONS/0145-the-text-editor-shows-each-run-in-its-own-style.md)).
 *
 * ## PLAIN-TEXT editable, a line per `div` and a run per `span`
 *
 * A textarea draws one style, and a line set as a bold lead word and a regular
 * rest is two. `contenteditable="plaintext-only"` keeps what the textarea gave —
 * a caret, selection, the platform's own typing undo, a line break where a
 * person presses Enter, and no markup that a paste can bring in — and draws each
 * run as the page does: typing lands in the run at the caret and takes its
 * style, measured in Chromium 151. What is read back is `innerText`, the same
 * plain lines the textarea's value was, so the write is unchanged. The browser
 * wraps a line that grows past the block's width, which is the reflow a person
 * sees while typing; where the words FINALLY break is the kernel's, measured
 * with the page's own fonts.
 *
 * ## Its content is BUILT ONCE, not rendered
 *
 * React renders the element empty and a layout effect fills it: once the person
 * types, the DOM is theirs, and a render that reconciled the runs over it would
 * put the page's words back over what they typed.
 */
function BlockEditor({
  block,
  click,
  geometry,
  placed,
  paper,
  past,
  onCommit,
  onClose,
  runFonts,
  placeable = true,
  native,
  spell,
  restructure,
  finishingRef,
  stuckRef,
}: BlockEditorProps): ReactElement {
  const { _ } = useLingui();
  const original = wordsOf(block);
  const [text, setText] = useState(original);
  /** Why the words are still here after a commit wrote nothing: a signed document left as it was, or the refusal. */
  const [problem, setProblem] = useState<Exclude<BlockCommit, 'written' | 'unchanged'> | undefined>(undefined);
  const area = useRef<HTMLDivElement>(null);
  /** Set while a write is in flight, so a blur during it does not write twice. */
  const writing = useRef(false);
  // THE READ THIS EDITOR OPENED WITH, kept for its life: the layer hands a new function each render, and the block it
  // reads for is this editor's until it closes (`key`), so a second read would only load the same fonts again.
  const [readFonts] = useState(() => runFonts);
  useRunFonts(area, readFonts, useId());
  // THE EDITOR IS OPEN, for the formatting commands to act on (ADR-0180): registered for its life, at the zoom now.
  const zoomNow = useRef(geometry.zoom);
  useEffect(() => {
    zoomNow.current = geometry.zoom;
  }, [geometry.zoom]);
  // THE BLOCK'S OWN ACTIONS, for the bar's Remove and the keys' steps, read through a ref so the registration made once
  // for this editor's life always reaches the latest of them.
  const actions = useRef<{ remove: () => void; nudge: (step: Nudge) => void }>({
    remove: () => undefined,
    nudge: () => undefined,
  });
  useEffect(() => {
    const element = area.current;
    if (element === null) return undefined;
    return registerEditor({
      root: element,
      zoom: () => zoomNow.current,
      block: {
        remove: () => {
          actions.current.remove();
        },
        nudge: (step) => {
          actions.current.nudge(step);
        },
      },
    });
  }, []);

  // THE RUNS, each in its own style, and the caret at the end. The block is this editor's for its whole life — a new
  // read or another block is a new editor (`key`) — so this runs once.
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    const owner = element.ownerDocument;
    element.replaceChildren(
      // A PARAGRAPH A `div`, its soft-wrapped lines run together, so the browser wraps it at the block's width and the
      // words read back are the paragraphs the kernel is sent (ADR-0179).
      ...paragraphsOf(block).map((lines) => {
        const row = owner.createElement('div');
        row.className = 'm-text-editor__line';
        for (const line of lines) {
          for (const run of line.runs) {
            const span = owner.createElement('span');
            span.textContent = run.text;
            drawRun(span, run.style, 1);
            // THE RUN'S FIRST OBJECT, which its font is answered by (`useRunFonts`).
            span.dataset['run'] = String(run.index);
            row.append(span);
          }
          // THE SPACE A SOFT WRAP STANDS FOR, in the style of the run before it, so a paragraph reads and measures as it
          // was set. None where the line already ends in white space: it is in the run.
          const last = line.runs.at(-1);
          if (line.soft && last !== undefined && joinAfterLine(lineText(line.runs), true) === ' ') {
            const join = owner.createElement('span');
            join.textContent = ' ';
            drawRun(join, last.style, 1);
            join.dataset['run'] = String(last.index);
            row.append(join);
          }
        }
        return row;
      }),
    );
    element.focus();
    // WHERE THE PERSON CLICKED, when they clicked: the character under that point, which is why a click in the middle of
    // a paragraph opens it there and not at its end. A key, or a point outside the words, leaves it at the end.
    if (click !== undefined && caretAt(element, click)) return;
    const range = owner.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = owner.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [block, click]);

  // AT THE ZOOM ON SCREEN: each run's size times the zoom, again whenever the zoom moves, on the runs as they are now
  // — what the person typed stays.
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    for (const span of element.querySelectorAll<HTMLElement>('.m-text-editor__run, .m-text-editor__fmt[data-size]')) {
      span.style.fontSize = `${String(Number(span.dataset['size'] ?? '0') * geometry.zoom)}px`;
    }
  }, [geometry.zoom]);

  /** Whether a write is in flight: the words are not editable meanwhile, so nothing is typed into a block already sent. */
  const [busy, setBusy] = useState(false);
  /** Whether the right-click menu is open, which has the focus in a popup outside this element. */
  const menuOpen = useRef(false);
  /** A sentence a menu item says beside the words, cleared by the next thing typed. */
  const [notice, setNotice] = useState<MessageKey | undefined>(undefined);
  /** Where the block is being put (ADR-0180, corrected): shown over the editor and sent with its words when it writes. */
  const [placement, setPlacement] = useState<Placement>(NOT_PLACED);
  /**
   * Sends ONE write for this editor and takes its outcome: the words' write and a join's or a split's alike, so what is
   * done while it is in flight, and what a refusal does, have one answer (B3a).
   */
  const settle = useCallback(
    async (send: () => Promise<BlockCommit>): Promise<void> => {
      if (writing.current) return;
      writing.current = true;
      setBusy(true);
      const outcome = await send();
      writing.current = false;
      setBusy(false);
      if (outcome !== 'written' && outcome !== 'unchanged') {
        // THE EDITOR STAYS on EVERY refusal (ADR-0169 Decision 5), with the words
        // and the sentence beside them: the person can change what was refused, or
        // — on a signed document they chose to leave as it was (ADR-0149) — keep
        // what they typed until they decide. A blur no longer writes until they type
        // again, so a focus the closing dialog moves cannot ask the same question
        // twice.
        setProblem(outcome);
        return;
      }
      onClose(outcome);
    },
    [onClose],
  );
  const finishWith = useCallback(
    (words: string): Promise<void> =>
      settle(() => {
        // THE FORMATTING FROM THE EDITOR AS IT STANDS, read in the one walk that gave the words (`readEditor`), and where
        // the person put the block: one command, so one undo step for words, style and place alike.
        const element = area.current;
        const place = placeOf(placement, block.box);
        const formatting = element === null ? {} : readEditor(element).formatting;
        return onCommit(words, place === undefined ? formatting : { ...formatting, place });
      }),
    [block.box, onCommit, placement, settle],
  );
  /**
   * What the right-click menu may do to the BLOCK, asked when it opens: join with the block above or below, and split
   * before the paragraph the caret is in (ADR-0180 Decision 7). Offered only while nothing is unwritten — a join writes the
   * block as the page has it, and words typed since would be dropped by it — so the person finishes first, with Escape.
   */
  const blockOps = (caret: number | undefined): EditorOps => {
    const element = area.current;
    if (restructure === undefined || element === null || busy || problem !== undefined) return {};
    const untouched =
      text === wordsOfBlock(block) && !isFormatted(readEditor(element).formatting) && placeOf(placement, block.box) === undefined;
    if (!untouched) return {};
    const { above, below, apply } = restructure;
    const split = caret === undefined ? undefined : splitEdits(block, caret);
    return {
      ...(above === undefined ? {} : { joinAbove: () => void settle(() => apply(joinEdits(above, block))) }),
      ...(below === undefined ? {} : { joinBelow: () => void settle(() => apply(joinEdits(block, below))) }),
      ...(split === undefined ? {} : { split: () => void settle(() => apply(split)) }),
    };
  };
  const finish = useCallback((): Promise<void> => finishWith(text), [finishWith, text]);
  useEffect(() => {
    actions.current = {
      // REMOVED BY ITS WORDS GOING, which is what removes a block (ADR-0096 Decision 5): the editor is emptied and written.
      remove: () => {
        area.current?.replaceChildren();
        setText('');
        void finishWith('');
      },
      nudge: (step) => {
        if (placeable) setPlacement((now) => nudged(step, now, block.box, geometry.zoom));
      },
    };
  }, [block.box, finishWith, geometry.zoom, placeable]);
  // READABLE BY THE LAYER, which asks for this write when another block is clicked and must not replace words that were
  // refused (`stuckRef`).
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
  // THE WORDS COME BACK TO THE PERSON after a refusal, once they are editable again: a write in flight made them not.
  useEffect(() => {
    if (!busy && problem !== undefined) area.current?.focus();
  }, [busy, problem]);

  // A DRAG OF A HANDLE: where the pointer went down and the placement it began from. The movement is converted to PDF
  // points by the page's one transform, and every placement is worked out in the text's own axes (`textPlacement`).
  const dragging = useRef<{ handle: Handle; x: number; y: number; from: Placement } | undefined>(undefined);
  const pdfDelta = (dx: number, dy: number): { x: number; y: number } => {
    const shown = overlayTransform(geometry);
    const origin = toPdf(viewportPoint(0, 0), shown);
    const moved = toPdf(viewportPoint(dx, dy), shown);
    return { x: moved.x - origin.x, y: moved.y - origin.y };
  };
  const handleProps = (handle: Handle) => ({
    // A PRESS ON A HANDLE KEEPS THE FOCUS IN THE WORDS: the editor writes when focus leaves it, not when a block is dragged.
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
      area.current?.focus();
    },
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (composing(event)) return;
    // THE BLOCK PLACED BY KEYS, for a person who cannot drag a handle: Alt with an arrow moves it a point (ten with
    // Shift), Alt with plus or minus scales it, and Alt with a bracket changes its width.
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const far = event.shiftKey ? 10 : 1;
      const step: Nudge | undefined =
        event.key === 'ArrowLeft'
          ? { kind: 'move', x: -far, y: 0 }
          : event.key === 'ArrowRight'
            ? { kind: 'move', x: far, y: 0 }
            : event.key === 'ArrowUp'
              ? { kind: 'move', x: 0, y: far }
              : event.key === 'ArrowDown'
                ? { kind: 'move', x: 0, y: -far }
                : event.key === '=' || event.key === '+'
                  ? { kind: 'scale', by: 0.05 }
                  : event.key === '-'
                    ? { kind: 'scale', by: -0.05 }
                    : event.key === ']'
                      ? { kind: 'width', by: 10 * far }
                      : event.key === '['
                        ? { kind: 'width', by: -10 * far }
                        : event.key === '.'
                          ? { kind: 'turn', degrees: -5 }
                          : event.key === ','
                            ? { kind: 'turn', degrees: 5 }
                            : undefined;
      if (step !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        actions.current.nudge(step);
        return;
      }
    }
    // TAB INSERTS A TAB, not a move of the focus out of the words: spaces to the next stop (ADR-0180 Decision 8).
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      if (area.current !== null && !event.shiftKey) insertTab(area.current, geometry.zoom);
      return;
    }
    // THE CHORDS OF FORMATTING, the editor's own while it has the focus: the page's shortcuts do not reach a field.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      const property = event.key === 'b' ? 'bold' : event.key === 'i' ? 'italic' : event.key === 'u' ? 'underline' : undefined;
      if (property !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        formatOpenEditor({ kind: 'toggle', property });
        return;
      }
    }
    // A COMPOSITION'S ESCAPE cancels the candidate, and is not the editor's (`composing`).
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    // AFTER A REFUSAL, Escape puts the text back rather than trying again: the
    // sentence says so, and a second Escape that re-sent the same words would
    // meet the same refusal.
    if (problem !== undefined) {
      onClose('put-back');
      return;
    }
    void finish();
  };

  const size = block.style.size * geometry.zoom;
  const pitch = pitchOf(block);
  const { r, g, b } = block.style.colour;
  return (
    // THE FRAME GROWS WITH ITS WORDS: at least the block's height, and as tall as
    // the editor inside it, so the handles enclose a line typed past the last.
    <div
      className="m-text-editor-frame"
      // THE FRAME, NOT THE EDITOR, IS WHAT LOSES THE FOCUS: it moves between the words and the bar's own fields (a size, a
      // colour) without writing, and writes only when it leaves both.
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        // THE RIGHT-CLICK MENU HAS THE FOCUS while it is open, in a popup outside this element: the words are not finished.
        if (menuOpen.current) return;
        if (problem === undefined) void finish();
      }}
      style={{ ...boxStyle(placed), height: 'auto', minHeight: placed.height }}
    >
      <TextFormatBar />
      {/* THE PLACER: what the person has done to the block so far, shown as a transform over the editor and its handles so
          the bar and the sentences stay upright where they are. The measure is its width, so the words wrap at it live. */}
      <div
        className="m-text-editor-placer"
        data-placed={placeOf(placement, block.box) === undefined ? undefined : ''}
        style={{
          ...(placement.width === undefined ? {} : { width: placement.width * geometry.zoom }),
          transform: placeTransform(placement, { width: placed.width, height: placed.height }, geometry.zoom),
        }}
      >
      <TextEditorMenu
        native={native}
        ops={blockOps}
        onNotice={setNotice}
        onOpenChange={(now) => {
          menuOpen.current = now;
        }}
        root={area}
        spell={spell}
      >
      <div
        aria-label={_(TEXT_EDIT_EDITOR_LABEL)}
        aria-multiline="true"
        className={`m-text-editor ${faceOf(block.style)}`}
        aria-busy={busy}
        contentEditable={busy ? false : 'plaintext-only'}
        data-text-editor=""
        onInput={(event) => {
          setText(readEditor(event.currentTarget).text);
          setProblem(undefined);
          setNotice(undefined);
        }}
        onKeyDown={onKeyDown}
        ref={area}
        role="textbox"
        spellCheck
        // THE BLOCK'S OWN VALUES, the base for what belongs to no run — a paste, a line typed below the last — and
        // the spacing and the paper behind them; each run sets its own (`drawRun`). Dynamic, and not design tokens.
        style={{
          fontSize: size,
          lineHeight: pitch === undefined ? 'normal' : `${String(pitch * geometry.zoom)}px`,
          fontWeight: block.style.bold ? 700 : 400,
          fontStyle: block.style.italic ? 'italic' : 'normal',
          color: `rgb(${String(r)}, ${String(g)}, ${String(b)})`,
          ...paper,
          // THE PARAGRAPHS' SHAPE (ADR-0179): the alignment the lines keep, and a first line set in or out from the rest.
          // A hanging indent is a negative one, drawn as padding on the block and the first line taken back out.
          textAlign: block.shape.align,
          // EACH PARAGRAPH RUNS THE WAY ITS OWN FIRST LETTER SAYS (ADR-0181): a Hebrew or Arabic line is laid out right to
          // left as it is typed, the next paragraph of the same block by its own letters, which one `dir` on the element
          // could not do. The page is written by the writer's own reading of the same line (`lineDirection`), which agrees
          // for every line that is mostly one script.
          unicodeBidi: 'plaintext',
          ...(block.shape.align === 'left' && block.shape.firstIndent !== 0
            ? {
                paddingLeft: Math.max(0, -block.shape.firstIndent) * geometry.zoom,
                textIndent: block.shape.firstIndent * geometry.zoom,
              }
            : {}),
        }}
      />
      </TextEditorMenu>
      {/* THE HANDLES, each one doing what it looks like it does (the wired-tools rule): the sides set the width, the
          corners scale, the top grip moves and the one to the right turns. The same placements are made by keys. */}
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
        // WHAT A MENU ITEM COULD NOT DO, said beside the words (the dictionary's refusal of a word), until they are typed in.
        <div className="m-text-editor-problem" role="status">
          <p>{_(notice)}</p>
        </div>
      ) : past ? (
        // THE WORDS ARE ALL WRITTEN and some are past the page's edge: said as a status and not a refusal, since
        // nothing was refused and the way to make them fit is this editor. ABOVE the words, where they begin on the
        // page: below them is past the foot the words ran off, and out of the window (measured in Chromium 151).
        <div className="m-text-editor-problem m-text-editor-problem--above" role="status">
          <p>{_(TEXT_EDIT_PAST_PAGE)}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the editor says under the words it kept: the signed document's sentence, or the refusal's — the same sentence
 * and particulars the problem dialog shows (`problemMessage`, `problemParticulars`), with the editor's own way out.
 */
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
      <p>{_(TEXT_EDIT_REFUSED_HINT)}</p>
    </div>
  );
}
