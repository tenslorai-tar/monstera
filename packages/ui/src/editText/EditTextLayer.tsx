import { useLingui } from '@lingui/react';
import type { BlockFormatting, EditedBlock, FormPath, PageInsert, WindowEditAction } from '@monstera/contract';
import { type DocVersion, NEW_TEXT_MARGIN, oneLineReach, pageAlongFrame, sameTextFrame } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { OverlayPage } from '../annotations/annotationSpace.js';
import type { BlockCommit, BlockFaces, BlocksRead, PageBlocksRead } from '../commands/documentCommands.js';
import type { EditorSpelling } from '../editorKit/EditorMenu.js';
import { leaveOpenEditor } from '../editorKit/openEditor.js';
import {
  TEXT_ADD_SURFACE,
  TEXT_EDIT_BLOCK_LABEL,
  TEXT_EDIT_COVERS,
  TEXT_EDIT_FORMS_DEEPER,
  TEXT_EDIT_FORMS_MORE,
  TEXT_EDIT_LAYER_LABEL,
  TEXT_EDIT_NONE,
  TEXT_EDIT_PAST_PAGE,
  TEXT_EDIT_RECOGNISE,
  TEXT_EDIT_TRUNCATED,
  TEXT_EDIT_UNREADABLE,
} from '../messages/en.js';
import { paperAround } from '../paperAround.js';
import type { TextBlock } from '../textBlock.js';
import { neighbourOf, pageBox, wordsOfBlock } from '../textBlockOps.js';
import { AreaPatch, type CssArea, type PatchArea } from './AreaPatch.js';
import { modelOfBlock } from './blockModel.js';
import { BlockEditor, type Opening } from './BlockEditor.js';
import { type FreshBox, type PageBlocks, type Placed, boxStyle, cssMatrixOf, fontsOfPage, freshBox, insertOf, newlyCovered, overlaps, pastItsPage, place } from './editing.js';
import { type ShownPage, runFamiliesOf } from './pdfjsFaces.js';
import { type FaceKind, type FaceRead, type RunFaces, useRunFaces } from './runFaces.js';

/**
 * Text edited where it is on the page — Edit text's mode, drawn over one page
 * ([ADR-0096](../../../../docs/DECISIONS/0096-text-is-edited-in-place-on-the-page-in-blocks-that-reflow.md),
 * [ADR-0271](../../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md)).
 *
 * ## What it draws
 *
 * Every editable block on the page, OUTLINED in place. A press on an outline selects the block's BOX (`BlockEditor`'s
 * first step), and a press inside the selected box puts the caret where it fell; a double press does both. Enter on a
 * focused outline selects it, as a press does. The editor is the kit's; the words leave through `onCommit`, which is
 * `commitTextBlock`, the one way a block is written.
 *
 * ## One block at a time, written before the next opens
 *
 * A press on another block while one is open finishes the open one (its own press-outside rule), and the block pressed
 * opens in the read that follows the write, found again by where it was — the open block's words are never replaced
 * unwritten by the next. A block that holds words it could not write keeps them, and a press elsewhere replaces nothing.
 */
export interface EditTextLayerProps {
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
  readonly onInsert?: (insert: PageInsert, read: BlocksRead) => Promise<BlockCommit>;
  readonly onAdded?: () => void;
  readonly native?: (action: WindowEditAction) => void;
  readonly spell?: EditorSpelling;
  readonly onRestructure?: (edits: EditedBlock[], read: BlocksRead, form: FormPath | null, kept?: boolean) => Promise<BlockCommit>;
  readonly familiesOf?: () => Promise<(font: string) => string | undefined>;
  readonly onCommit: (block: TextBlock, text: string, read: PageBlocksRead, formatting?: BlockFormatting) => Promise<BlockCommit>;
  /** The read on open for a block (`document.blockFaces`). */
  readonly blockFaces: (block: TextBlock, read: BlocksRead) => Promise<BlockFaces>;
  /** The text PDF.js shows on this page and the face it loaded for each piece; absent where no page is drawn. */
  readonly shown?: () => Promise<ShownPage | undefined>;
  /** The page's pictures and drawings that meet `within`, at the version read (B1.6). */
  readonly objects?: (within: TextBlock['box']) => Promise<{ readonly version: DocVersion; readonly boxes: readonly TextBlock['box'][] } | undefined>;
  readonly onRecognise?: () => void;
  readonly pictureNoted?: boolean;
  readonly onLeave: () => void;
  /**
   * Told the version of the read an editor here was opened over while it is writing or holds words written and not yet
   * drawn ([ADR-0261](../../../../docs/DECISIONS/0261-a-page-command-is-shown-at-once-from-the-pages-already-drawn.md)
   * Decision 7), and `undefined` otherwise.
   */
  readonly onHolding?: (holding: DocVersion | undefined) => void;
  /** The page's own colour behind a point of the drawn page, in the overlay's CSS pixels. */
  readonly paperAt: (x: number, y: number) => string | undefined;
  /** The kind of face a letter is drawn in where nothing closer is known (`editing.fallback-face`). */
  readonly fallbackFace?: FaceKind;
  /** Draws one area of the page at the newest version (`AreaPatch`); absent where nothing can, and the page's redraw is waited for. */
  readonly patch?: PatchArea;
  /** The version the page on screen is drawn from, which a patch is kept until. */
  readonly drawn?: DocVersion;
}

/** The margin drawn around an edited area, in CSS pixels: a letter's antialiased edge reaches past its box. */
const PATCH_MARGIN = 4;

/** No family known for any font: a join carries none. */
const NO_FAMILIES = (): Promise<(font: string) => string | undefined> => Promise.resolve(() => undefined);

/**
 * The area a written edit changed, in the layer's CSS pixels with {@link PATCH_MARGIN} around it: the block as it was
 * read, turned as the page is, and the editor's frame as it last stood, which is larger where the words grew.
 */
function editedArea(root: HTMLElement | null, placed: Placed, zoom: number): CssArea {
  // CSS CARRIES THE BOX ABOUT THE PLACED CORNER by its matrix, the page's turn or a framed block's (ADR-0273): (x, y)
  // lands at (a x + c y, b x + d y) from it.
  const [a, b, c, d] = cssMatrixOf(placed);
  const corners = [
    [0, 0],
    [placed.width, 0],
    [0, placed.height],
    [placed.width, placed.height],
  ].map(([x = 0, y = 0]) => ({ x: placed.left + a * x + c * y, y: placed.top + b * x + d * y }));
  const frame = root?.querySelector('[data-kit-frame]');
  const box = frame?.getBoundingClientRect();
  // A FRAME WITH NO SIZE is one not laid out, whose corner is the viewport's origin and no part of the edit.
  if (root !== null && box !== undefined && box.width > 0 && box.height > 0) {
    const own = root.getBoundingClientRect();
    corners.push({ x: box.left - own.left, y: box.top - own.top }, { x: box.right - own.left, y: box.bottom - own.top });
  }
  const left = Math.min(...corners.map((corner) => corner.x)) - PATCH_MARGIN;
  const top = Math.min(...corners.map((corner) => corner.y)) - PATCH_MARGIN;
  return {
    left,
    top,
    width: Math.max(...corners.map((corner) => corner.x)) + PATCH_MARGIN - left,
    height: Math.max(...corners.map((corner) => corner.y)) + PATCH_MARGIN - top,
    zoom,
  };
}

/**
 * The overlay's own box around a placed block's corners: where the paper beside a block set at an angle is sampled
 * (ADR-0273), since its own box's corners are not the overlay's.
 */
function overlayBox(placed: Placed): { left: number; top: number; width: number; height: number } {
  const [a, b, c, d] = cssMatrixOf(placed);
  const xs = [0, a * placed.width, c * placed.height, a * placed.width + c * placed.height].map((x) => placed.left + x);
  const ys = [0, b * placed.width, d * placed.height, b * placed.width + d * placed.height].map((y) => placed.top + y);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** A box's area in PDF points squared: the order outlines are stacked in. */
function area(box: TextBlock['box']): number {
  return (box.x1 - box.x0) * (box.y1 - box.y0);
}

/**
 * Each block's place in the stack of outlines: one more than the number of blocks larger than it, so a smaller block
 * that sits inside a larger one is above it. FROM ONE SORT, not a count over every block for each block: that was n²
 * a render on a page of many blocks, and the outlines render as a scroll brings each page in.
 */
export function stackingOf(blocks: readonly TextBlock[]): number[] {
  const areas = blocks.map((block) => area(block.box));
  const larger = [...areas].sort((a, b) => b - a);
  return areas.map((own) => {
    // THE FIRST AREA NOT LARGER THAN THIS ONE, by halving: its place is how many are larger.
    let low = 0;
    let high = larger.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((larger[middle] ?? 0) > own) low = middle + 1;
      else high = middle;
    }
    return 1 + low;
  });
}

export function EditTextLayer({
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
  familiesOf = NO_FAMILIES,
  onCommit,
  blockFaces,
  shown = NOTHING_SHOWN,
  objects,
  onRecognise,
  pictureNoted = false,
  onLeave,
  onHolding,
  paperAt,
  fallbackFace = 'sans',
  patch,
  drawn,
}: EditTextLayerProps): ReactElement {
  const { _ } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  /** The open block: its place in the answer, the version that answer was read at, and how it was opened. */
  const [opened, setOpened] = useState<{ readonly at: number; readonly version: DocVersion; readonly opening: Opening; readonly parting?: boolean } | undefined>();
  /** A written edit's area, the version of the read it was made over, and the version it was drawn at once it is. */
  const [patching, setPatching] = useState<{ readonly after: DocVersion; readonly area: CssArea; readonly version?: DocVersion } | undefined>();
  const onPatched = useCallback((version: DocVersion): void => {
    setPatching((current) => (current === undefined ? undefined : { ...current, version }));
  }, []);
  // A WRITTEN EDITOR LETS GO when its area is drawn at the new version: the patch shows the words from here.
  const patched = opened?.parting === true && patching?.version !== undefined && patching.after === opened.version;
  // A NEW READ CLOSES THE EDITOR, DERIVED rather than reset in an effect: an open block's indices describe the version it
  // was read at, and an editor over a newer answer would write words over objects the page no longer has.
  const chosen = opened !== undefined && opened.version === blocks?.version && !patched ? opened.at : undefined;
  const [committing, setCommitting] = useState<number | undefined>();
  // HOLDING FROM THE MOMENT THE WRITE IS SENT: the version moves at the answer, and the page must already keep the read.
  const holding = chosen !== undefined && (opened?.parting === true || committing === chosen) ? opened?.version : undefined;
  useEffect(() => {
    onHolding?.(holding);
  }, [holding, onHolding]);
  /** The block a written edit was made to, and the version it was read at, until the editor that reopens over it closes. */
  const [written, setWritten] = useState<{ readonly box: TextBlock['box']; readonly version: DocVersion } | undefined>();
  // A WRITE THAT RAN PAST THE PAGE REOPENS ITS EDITOR over the read after it, with the sentence under the words (Q7).
  const regrown =
    written === undefined || blocks === undefined || blocks.version === written.version
      ? -1
      : blocks.blocks.findIndex((block) => overlaps(pageBox(block), written.box) && pastItsPage(pageBox(block), geometry.crop));
  // THE BLOCK A WRITE GREW, and what it now runs over that it did not before (B1.6). EVERY BOX HERE IS THE PAGE'S: a block
  // set at an angle has its own in its frame (ADR-0273), and two frames' boxes cannot be compared.
  const grown = written === undefined || blocks === undefined || blocks.version === written.version ? undefined : blocks.blocks.find((block) => overlaps(pageBox(block), written.box));
  const coveredWords =
    grown === undefined || written === undefined || blocks === undefined
      ? 0
      : newlyCovered(
          written.box,
          pageBox(grown),
          blocks.blocks.filter((block) => block !== grown).map((block) => pageBox(block)),
        );
  const [coveredObjects, setCoveredObjects] = useState<{ readonly version: DocVersion; readonly count: number }>();
  const readAt = blocks?.version;
  const covers = grown !== undefined && (coveredWords > 0 || (coveredObjects?.version === readAt && (coveredObjects?.count ?? 0) > 0));
  /** The block pressed WHILE ANOTHER WAS OPEN, opened in the read after that one's write (ADR-0180 Decision 8). */
  const [next, setNext] = useState<{ readonly box: TextBlock['box']; readonly opening: Opening; readonly version: DocVersion } | undefined>();
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);
  const handed = next === undefined || blocks === undefined || blocks.version === next.version ? -1 : blocks.blocks.findIndex((block) => overlaps(pageBox(block), next.box));
  const open = chosen ?? (handed === -1 ? (regrown === -1 ? undefined : regrown) : handed);
  const opening: Opening = chosen === undefined ? (handed === open ? (next?.opening ?? { at: 'box' }) : { at: 'end' }) : (opened?.opening ?? { at: 'box' });
  const finishingRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const stuckRef = useRef(false);
  const setOpen = (at: number | undefined, how: Opening): void => {
    setWritten(undefined);
    setNext(undefined);
    setOpened(at === undefined || blocks === undefined ? undefined : { at, version: blocks.version, opening: how });
  };
  /** The box of NEW text being typed, and the version of the read it was begun over (ADR-0180 Decision 6). */
  const [fresh, setFresh] = useState<{ readonly made: FreshBox; readonly version: DocVersion } | undefined>();
  const freshOpen = fresh !== undefined && fresh.version === blocks?.version ? fresh.made : undefined;
  const editing = open !== undefined || freshOpen !== undefined;

  // THE CHECK AFTER A WRITE (B1.6), once per write and only when the editor has let go, about the written block's area
  // alone: before, it read every object of the page, in many parts on a dense page, each a walk in the document's lane
  // ahead of the next finish (77 reads, 125.7 s on the owner's laptop, ADR-0274's measurement).
  const objectsNow = useRef(objects);
  useEffect(() => {
    objectsNow.current = objects;
  }, [objects]);
  // THE BOX BY VALUE, so a render that rebuilt the same block asks nothing.
  const { x0: gx0, y0: gy0, x1: gx1, y1: gy1 } = grown === undefined ? { x0: Number.NaN, y0: Number.NaN, x1: Number.NaN, y1: Number.NaN } : pageBox(grown);
  useEffect(() => {
    const ask = objectsNow.current;
    const grownBox = { x0: gx0, y0: gy0, x1: gx1, y1: gy1 };
    if (editing || Number.isNaN(gx0) || written === undefined || ask === undefined || readAt === undefined) return undefined;
    let current = true;
    const area = {
      x0: Math.min(written.box.x0, grownBox.x0),
      y0: Math.min(written.box.y0, grownBox.y0),
      x1: Math.max(written.box.x1, grownBox.x1),
      y1: Math.max(written.box.y1, grownBox.y1),
    };
    void ask(area).then((read) => {
      if (current && read?.version === readAt) setCoveredObjects({ version: readAt, count: newlyCovered(written.box, grownBox, read.boxes) });
    });
    return () => {
      current = false;
    };
  }, [editing, gx0, gy0, gx1, gy1, written, readAt]);

  const openBlock = open === undefined ? undefined : blocks?.blocks[open];
  // THE OPEN BLOCK'S FACES, read once as it is selected and kept for its life (`runFaces.ts`).
  // ONE READ PER BLOCK AND VERSION: the parent hands new functions each render, and they ask the same question.
  const readsNow = useRef({ blockFaces, shown });
  useEffect(() => {
    readsNow.current = { blockFaces, shown };
  }, [blockFaces, shown]);
  const readFaces = useMemo(
    () =>
      openBlock === undefined || blocks === undefined
        ? undefined
        : async (): Promise<FaceRead> => {
            const [faces, page] = await Promise.all([readsNow.current.blockFaces(openBlock, blocks), readsNow.current.shown()]);
            // PDF.JS'S TEXT AT ANOTHER VERSION describes words the open block may no longer have, so it lends no face.
            return { faces, shown: page?.version === blocks.version ? runFamiliesOf(openBlock, page.items) : new Map() };
          },
    [openBlock, blocks],
  );
  const faces = useRunFaces(openBlock, readFaces);
  const openedModel = useMemo(() => (openBlock === undefined ? undefined : modelOfBlock(openBlock)), [openBlock]);
  const freshModel = useMemo(() => (freshOpen === undefined ? undefined : modelOfBlock(freshOpen.block)), [freshOpen]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === 'Escape' && !editing) {
        event.stopPropagation();
        onLeave();
      }
    },
    [onLeave, editing],
  );

  const notes: ReactElement[] = [];
  if (unreadable && blocks === undefined) notes.push(<p key="unreadable">{_(TEXT_EDIT_UNREADABLE)}</p>);
  if (blocks !== undefined) {
    // NOT WHERE THE PAGE ITSELF SAYS IT IS A PICTURE: its note says so and makes the offer there (`PageList`, W7).
    if (!pictureNoted && blocks.blocks.length === 0 && blocks.unaddressable === 0) {
      // A PAGE WITH NO TEXT MAY BE A SCAN (ADR-0181 Decision 9): it offers to be recognised.
      notes.push(
        <p key="none">
          {_(TEXT_EDIT_NONE)}
          {onRecognise === undefined ? null : (
            <>
              {' '}
              <button className="m-text-edit__promote" onClick={onRecognise} type="button">
                {_(TEXT_EDIT_RECOGNISE)}
              </button>
            </>
          )}
        </p>,
      );
    }
    if (blocks.truncated) notes.push(<p key="truncated">{_(TEXT_EDIT_TRUNCATED)}</p>);
    // TEXT IN FORMS PAST THE WALK'S BOUNDS, each reason in its own words (ADR-0269's correction of 2026-10-30).
    if (blocks.formsLeft.deeper) notes.push(<p key="forms-deeper">{_(TEXT_EDIT_FORMS_DEEPER)}</p>);
    if (blocks.formsLeft.more) notes.push(<p key="forms-more">{_(TEXT_EDIT_FORMS_MORE)}</p>);
    // A WRITE THAT GREW OVER SOMETHING is said, not undone (B1.6): nothing else moves, so the person is told.
    if (covers) notes.push(<p key="covers" role="status">{_(TEXT_EDIT_COVERS)}</p>);
  }

  /** What a press or a key on an outline asks: the box, or the caret at a double press's point. */
  const choose = (at: number, block: TextBlock, how: Opening): void => {
    if (blocks === undefined) return;
    if (editing && open !== at) {
      // ANOTHER EDITOR IS OPEN: it finishes on the press that reached here, and this block opens in the read after it.
      // ONE HOLDING REFUSED WORDS is asked about first (ADR-0278): on Discard its text is put back and this block opens.
      if (stuckRef.current) {
        void leaveOpenEditor().then((go) => {
          if (go) setOpen(at, how);
        });
        return;
      }
      setNext({ box: pageBox(block), opening: how, version: blocks.version });
      void finishingRef.current?.();
      return;
    }
    setOpen(at, how);
  };
  // WORKED OUT ONCE PER ANSWER, from the blocks alone: each outline's place in the stack and the words its label names.
  const stacking = stackingOf(blocks?.blocks ?? []);
  const labelled = (blocks?.blocks ?? []).map((block) => wordsOfBlock(block).replace(/\s+/gu, ' ').trim());

  return (
    <div
      aria-label={_(TEXT_EDIT_LAYER_LABEL, { page: page + 1 })}
      className="m-text-edit-layer"
      data-text-edit-layer={String(page)}
      onKeyDown={onKeyDown}
      // A SELECTION OF THE PAGE'S WORDS STILL STANDING as the mode is used goes at the next press: a plain press never
      // selects page text (ADR-0271 section 3). One inside the editor is the person's own and stays.
      onPointerDown={(event) => {
        const selection = event.currentTarget.ownerDocument.getSelection();
        if (selection === null || selection.isCollapsed) return;
        const anchor = selection.anchorNode;
        const holder = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
        if ((holder?.closest('[data-kit-surface]') ?? null) === null) selection.removeAllRanges();
      }}
      ref={root}
      role="group"
    >
      {/* UNTIL THE PAGE ITSELF IS DRAWN AT THE PATCH'S VERSION, after which the page shows the same pixels. */}
      {patch === undefined || patching === undefined || (patching.version !== undefined && drawn !== undefined && drawn >= patching.version) ? null : (
        <AreaPatch after={patching.after} area={patching.area} key={`patch-${String(patching.after)}`} onDrawn={onPatched} patch={patch} zoom={geometry.zoom} />
      )}
      {blocks?.blocks.map((block, at) => {
        const placed = place(block.box, geometry, block.frame);
        if (at === open && openedModel !== undefined) {
          return (
            <BlockEditor
              block={block}
              fallback={fallbackFace}
              faces={faces}
              finishingRef={finishingRef}
              geometry={geometry}
              // THE BLOCK'S POSITION AND THE VERSION, so a new read is a new editor rather than old words in a new place.
              key={`editor-${String(blocks.version)}-${String(at)}`}
              native={native}
              onClose={(outcome) => {
                if (outcome !== 'written') setWritten(undefined);
                // THE BLOCK PRESSED WHILE THIS ONE WAS OPEN, when this wrote nothing: it opens where it is.
                const waiting = nextRef.current;
                if (outcome === 'unchanged' && waiting !== undefined) {
                  const target = blocks.blocks.findIndex((other, where) => where !== at && overlaps(pageBox(other), waiting.box));
                  if (target !== -1) {
                    setOpen(target, waiting.opening);
                    return;
                  }
                }
                if (at === handed || outcome === 'put-back') setNext(undefined);
                // A WRITTEN EDITOR STAYS, locked, as its words' look until the page draws them (ADR-0261 Decision 7).
                setOpened((current) => (current?.at !== at ? current : outcome === 'written' ? { ...current, parting: true } : undefined));
                setCommitting((current) => (current === at ? undefined : current));
              }}
              onCommit={async (text, formatting) => {
                setCommitting(at);
                let outcome: BlockCommit;
                try {
                  outcome = await onCommit(block, text, blocks, formatting);
                } catch (error: unknown) {
                  // A WRITE THAT THREW holds nothing, as a refused one does not: the editor's own catch says it beside the
                  // words, and the page must not go on keeping the read for a write that will never land.
                  setCommitting((current) => (current === at ? undefined : current));
                  throw error;
                }
                if (outcome !== 'written') setCommitting((current) => (current === at ? undefined : current));
                if (outcome === 'written') {
                  setWritten({ box: pageBox(block), version: blocks.version });
                  // THE AREA THE WRITE CHANGED, measured while the editor still shows it: the block as read and the frame
                  // as it grew, since growth overlaps what is below and the page there changed too.
                  setPatching({ after: blocks.version, area: editedArea(root.current, placed, geometry.zoom) });
                }
                else if (outcome !== 'unchanged') setNext(undefined);
                return outcome;
              }}
              opened={openedModel}
              opening={opening}
              pageFonts={fontsOfPage(blocks.blocks)}
              paper={paperAround(placed.matrix === undefined ? placed : overlayBox(placed), paperAt)}
              parting={chosen === at && opened?.parting === true}
              past={pastItsPage(pageBox(block), geometry.crop)}
              placed={placed}
              // A BLOCK OF ONE LINE grows to its column's edge or the page's margin before it wraps. A TURNED ONE grows the
              // same way in its own frame (ADR-0273), where its box and the boxes of the blocks set in its frame are, and
              // where the writer lays it out: the page seen along its line (`pageAlongFrame`).
              reach={
                block.lines.length === 1
                  ? oneLineReach(
                      block.box,
                      blocks.blocks.filter((other) => other !== block && sameTextFrame(other.frame ?? null, block.frame ?? null)).map((other) => other.box),
                      block.frame === undefined
                        ? { x0: geometry.crop[0], y0: geometry.crop[1], x1: geometry.crop[2], y1: geometry.crop[3] }
                        : pageAlongFrame({ x0: geometry.crop[0], y0: geometry.crop[1], x1: geometry.crop[2], y1: geometry.crop[3] }, block.frame, block.box),
                    )
                  : undefined
              }
              restructure={
                onRestructure === undefined
                  ? undefined
                  : {
                      above: blocks.blocks[neighbourOf(blocks.blocks, at, 'above') ?? -1],
                      below: blocks.blocks[neighbourOf(blocks.blocks, at, 'below') ?? -1],
                      page: blocks.blocks,
                      apply: (edits, kept) => onRestructure(edits, blocks, block.form ?? null, kept),
                      families: familiesOf,
                    }
              }
              spell={spell}
              stuckRef={stuckRef}
            />
          );
        }
        const words = labelled[at] ?? '';
        const past = pastItsPage(pageBox(block), geometry.crop);
        const outline = (
          <button
            aria-label={_(TEXT_EDIT_BLOCK_LABEL, { words: words.length > 40 ? `${words.slice(0, 40)}…` : words })}
            {...(past ? { 'aria-description': _(TEXT_EDIT_PAST_PAGE) } : {})}
            className={['m-text-block', past ? 'm-text-block--past' : '', adding ? 'm-text-block--adding' : ''].filter(Boolean).join(' ')}
            data-text-block={String(at)}
            key={`block-${String(blocks.version)}-${String(at)}`}
            onClick={(event) => {
              // A DOUBLE PRESS reaches the outline only where the editor did not open under the first; a key's activation
              // (`detail` 0) and a single press select the box.
              choose(at, block, event.detail >= 2 ? { at: 'point', x: event.clientX, y: event.clientY } : { at: 'box' });
            }}
            // A SMALLER BLOCK ABOVE A LARGER ONE that holds it, so the press on a heading inside a column is the heading's.
            style={{ ...boxStyle(placed), zIndex: stacking[at] ?? 1 }}
            type="button"
          />
        );
        if (!past) return outline;
        return [
          outline,
          <p aria-hidden="true" className="m-text-block__past" data-text-block-past={String(at)} key={`past-${String(blocks.version)}-${String(at)}`} style={{ left: placed.left, top: placed.top }}>
            {_(TEXT_EDIT_PAST_PAGE)}
          </p>,
        ];
      })}
      {adding && blocks !== undefined && freshOpen === undefined ? (
        // ADD TEXT: the page is a surface under the outlines, which take no press while it is armed, so a press over text
        // places a box there too.
        <button
          aria-label={_(TEXT_ADD_SURFACE)}
          className="m-text-add-surface"
          data-text-add-surface=""
          onClick={(event) => {
            const edge = event.currentTarget.getBoundingClientRect();
            const css =
              event.detail === 0 ? { x: NEW_TEXT_MARGIN * geometry.zoom, y: NEW_TEXT_MARGIN * geometry.zoom } : { x: event.clientX - edge.left, y: event.clientY - edge.top };
            setFresh({ made: freshBox(css, geometry, blocks.blocks), version: blocks.version });
            setNext(undefined);
          }}
          type="button"
        />
      ) : null}
      {freshOpen !== undefined && freshModel !== undefined && blocks !== undefined ? (
        <BlockEditor
          block={freshOpen.block}
          fallback={fallbackFace}
          faces={NO_FACES}
          finishingRef={finishingRef}
          geometry={geometry}
          key={`fresh-${String(blocks.version)}`}
          native={native}
          onClose={(outcome) => {
            const waiting = nextRef.current;
            setFresh(undefined);
            if (outcome === 'unchanged' && waiting !== undefined) {
              const target = blocks.blocks.findIndex((other) => overlaps(pageBox(other), waiting.box));
              if (target !== -1) {
                setOpen(target, waiting.opening);
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
          opened={freshModel}
          opening={{ at: 'end' }}
          pageFonts={fontsOfPage(blocks.blocks)}
          paper={undefined}
          past={false}
          placeable={false}
          placed={place(freshOpen.block.box, geometry)}
          spell={spell}
          stuckRef={stuckRef}
        />
      ) : null}
      {notes.length > 0 ? <div className="m-page-mode__notes">{notes}</div> : null}
    </div>
  );
}

/** A box of new text has no faces of its own to read: its words are drawn in the nearby words' kind. */
const NO_FACES: RunFaces = { settled: true, loaded: new Map(), fonts: new Map() };

/** No page drawn to read PDF.js's faces from: every run is drawn in the chain's face, or its kind. */
const NOTHING_SHOWN = (): Promise<ShownPage | undefined> => Promise.resolve(undefined);
