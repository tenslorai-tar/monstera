import { useLingui } from '@lingui/react';
import type { BlockFormatting } from '@monstera/contract';
import { type DocVersion, joinAfterLine, lineText, paragraphsOfLines, pdfPoint, toViewport } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import type { BlockCommit, BlocksRead, RunFonts, TextBlock } from './commands/documentCommands.js';
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
  TEXT_EDIT_ROTATED,
  TEXT_EDIT_TRUNCATED,
  TEXT_EDIT_UNADDRESSABLE,
} from './messages/en.js';
import { composing } from './surfaces/shortcuts.js';
import { TextFormatBar } from './TextFormatBar.js';
import { formatOpenEditor, registerEditor } from './textEditorControl.js';
import { insertTab, readEditor } from './textFormatting.js';

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
 * nothing writes nothing. Selection handles mark the open block.
 *
 * ## The handles are a MARK, not a control
 *
 * They say *this block is the one open*, as the recording's do. They take no
 * pointer and have no cursor of their own: a handle that looked draggable and
 * did nothing would be the wired-tools rule's defect drawn eight times.
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
  readonly unaddressable: number;
}

export interface TextEditLayerProps {
  /** Zero-based, as a command names it. */
  readonly page: number;
  /** The page as drawn, for the transform. */
  readonly geometry: OverlayPage;
  /** The page's blocks, or `undefined` while they are being read. */
  readonly blocks: PageBlocks | undefined;
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
function wordsOf(block: TextBlock): string {
  return paragraphsOfLines(block.lines.map((line) => ({ text: lineText(line.runs), soft: line.soft })));
}

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
  const open = chosen ?? (regrown === -1 ? undefined : regrown);
  const setOpen = (at: number | undefined, click?: Click): void => {
    setWritten(undefined);
    setOpened(at === undefined || blocks === undefined ? undefined : { at, version: blocks.version, click });
  };

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
  if (blocks !== undefined) {
    if (blocks.blocks.length === 0 && blocks.unaddressable === 0 && blocks.rotated === 0) {
      notes.push(<p key="none">{_(TEXT_EDIT_NONE)}</p>);
    }
    if (blocks.truncated) notes.push(<p key="truncated">{_(TEXT_EDIT_TRUNCATED)}</p>);
    if (blocks.rotated > 0) notes.push(<p key="rotated">{_(TEXT_EDIT_ROTATED)}</p>);
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
              click={chosen === undefined ? undefined : opened?.click}
              geometry={geometry}
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
                setOpened((current) => (current?.at === at ? undefined : current));
              }}
              onCommit={async (text, formatting) => {
                const outcome = await onCommit(block, text, blocks, formatting);
                if (outcome === 'written') setWritten({ box: block.box, version: blocks.version });
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
              setOpen(at, event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY });
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
      {notes.length > 0 ? <div className="m-page-mode__notes">{notes}</div> : null}
    </div>
  );
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
      geometry={geometry}
      onCommit={(block, text, read, formatting) => editing.onCommit(page, block, text, read, formatting)}
      onLeave={editing.onLeave}
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
  useEffect(() => {
    const element = area.current;
    if (element === null) return undefined;
    return registerEditor({ root: element, zoom: () => zoomNow.current });
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

  const finish = useCallback(async (): Promise<void> => {
    if (writing.current) return;
    writing.current = true;
    // THE FORMATTING FROM THE EDITOR AS IT STANDS, read in the one walk that gave the words (`readEditor`).
    const element = area.current;
    const outcome = await onCommit(text, element === null ? {} : readEditor(element).formatting);
    writing.current = false;
    if (outcome !== 'written' && outcome !== 'unchanged') {
      // THE EDITOR STAYS on EVERY refusal (ADR-0169 Decision 5), with the words
      // and the sentence beside them: the person can change what was refused, or
      // — on a signed document they chose to leave as it was (ADR-0149) — keep
      // what they typed until they decide. A blur no longer writes until they type
      // again, so a focus the closing dialog moves cannot ask the same question
      // twice.
      setProblem(outcome);
      area.current?.focus();
      return;
    }
    onClose(outcome);
  }, [onClose, onCommit, text]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (composing(event)) return;
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
        if (problem === undefined) void finish();
      }}
      style={{ ...boxStyle(placed), height: 'auto', minHeight: placed.height }}
    >
      <TextFormatBar />
      <div
        aria-label={_(TEXT_EDIT_EDITOR_LABEL)}
        aria-multiline="true"
        className={`m-text-editor ${faceOf(block.style)}`}
        contentEditable="plaintext-only"
        data-text-editor=""
        onInput={(event) => {
          setText(readEditor(event.currentTarget).text);
          setProblem(undefined);
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
          ...(block.shape.align === 'left' && block.shape.firstIndent !== 0
            ? {
                paddingLeft: Math.max(0, -block.shape.firstIndent) * geometry.zoom,
                textIndent: block.shape.firstIndent * geometry.zoom,
              }
            : {}),
        }}
      />
      {/* THE HANDLES, a mark and not a control — see the file's header. */}
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((corner) => (
        <span aria-hidden className={`m-text-editor-handle m-text-editor-handle--${corner}`} key={corner} />
      ))}
      {problem !== undefined ? (
        <EditorProblem problem={problem} />
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
