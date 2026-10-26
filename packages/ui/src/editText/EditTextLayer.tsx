import { useLingui } from '@lingui/react';
import type { BlockFormatting, EditedBlock, FormPath, PageInsert, WindowEditAction } from '@monstera/contract';
import { type DocVersion, NEW_TEXT_MARGIN } from '@monstera/shared';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { OverlayPage } from '../annotations/annotationSpace.js';
import type { BlockCommit, BlocksRead, PageBlocksRead, RunFonts } from '../commands/documentCommands.js';
import type { EditorSpelling } from '../editorKit/EditorMenu.js';
import {
  TEXT_ADD_SURFACE,
  TEXT_EDIT_BLOCK_LABEL,
  TEXT_EDIT_COVERS,
  TEXT_EDIT_LAYER_LABEL,
  TEXT_EDIT_MIRRORED,
  TEXT_EDIT_NONE,
  TEXT_EDIT_PAST_PAGE,
  TEXT_EDIT_RECOGNISE,
  TEXT_EDIT_SLANTED,
  TEXT_EDIT_TRUNCATED,
  TEXT_EDIT_TURNED,
  TEXT_EDIT_UNREADABLE,
  TEXT_EDIT_VERTICAL,
} from '../messages/en.js';
import { paperAround } from '../paperAround.js';
import type { TextBlock } from '../textBlock.js';
import { neighbourOf, wordsOfBlock } from '../textBlockOps.js';
import { modelOfBlock } from './blockModel.js';
import { BlockEditor, type Opening } from './BlockEditor.js';
import { type FreshBox, type PageBlocks, boxStyle, fontsOfPage, freshBox, insertOf, newlyCovered, overlaps, pastItsPage, place } from './editing.js';
import { type FaceKind, useRunFaces } from './runFaces.js';

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
  readonly runFonts: (block: TextBlock, read: BlocksRead) => Promise<RunFonts>;
  readonly objects?: () => Promise<{ readonly version: DocVersion; readonly boxes: readonly TextBlock['box'][] } | undefined>;
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
}

/** No family known for any font: a join carries none. */
const NO_FAMILIES = (): Promise<(font: string) => string | undefined> => Promise.resolve(() => undefined);

/** A box's area in PDF points squared: the order outlines are stacked in. */
function area(box: TextBlock['box']): number {
  return (box.x1 - box.x0) * (box.y1 - box.y0);
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
  runFonts,
  objects,
  onRecognise,
  pictureNoted = false,
  onLeave,
  onHolding,
  paperAt,
  fallbackFace = 'sans',
}: EditTextLayerProps): ReactElement {
  const { _ } = useLingui();
  /** The open block: its place in the answer, the version that answer was read at, and how it was opened. */
  const [opened, setOpened] = useState<{ readonly at: number; readonly version: DocVersion; readonly opening: Opening; readonly parting?: boolean } | undefined>();
  // A NEW READ CLOSES THE EDITOR, DERIVED rather than reset in an effect: an open block's indices describe the version it
  // was read at, and an editor over a newer answer would write words over objects the page no longer has.
  const chosen = opened !== undefined && opened.version === blocks?.version ? opened.at : undefined;
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
      : blocks.blocks.findIndex((block) => overlaps(block.box, written.box) && pastItsPage(block.box, geometry.crop));
  // THE BLOCK A WRITE GREW, and what it now runs over that it did not before (B1.6).
  const grown = written === undefined || blocks === undefined || blocks.version === written.version ? undefined : blocks.blocks.find((block) => overlaps(block.box, written.box));
  const coveredWords =
    grown === undefined || written === undefined || blocks === undefined
      ? 0
      : newlyCovered(
          written.box,
          grown.box,
          blocks.blocks.filter((block) => block !== grown).map((block) => block.box),
        );
  const [coveredObjects, setCoveredObjects] = useState<{ readonly version: DocVersion; readonly count: number }>();
  const readAt = blocks?.version;
  useEffect(() => {
    if (grown === undefined || written === undefined || objects === undefined || readAt === undefined) return undefined;
    let current = true;
    void objects().then((read) => {
      if (current && read?.version === readAt) setCoveredObjects({ version: readAt, count: newlyCovered(written.box, grown.box, read.boxes) });
    });
    return () => {
      current = false;
    };
  }, [grown, written, objects, readAt]);
  const covers = grown !== undefined && (coveredWords > 0 || (coveredObjects?.version === readAt && (coveredObjects?.count ?? 0) > 0));
  /** The block pressed WHILE ANOTHER WAS OPEN, opened in the read after that one's write (ADR-0180 Decision 8). */
  const [next, setNext] = useState<{ readonly box: TextBlock['box']; readonly opening: Opening; readonly version: DocVersion } | undefined>();
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  }, [next]);
  const handed = next === undefined || blocks === undefined || blocks.version === next.version ? -1 : blocks.blocks.findIndex((block) => overlaps(block.box, next.box));
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

  const openBlock = open === undefined ? undefined : blocks?.blocks[open];
  // THE OPEN BLOCK'S FACES, read once as it is selected and kept for its life (`runFaces.ts`).
  // ONE READ PER BLOCK AND VERSION: the parent hands a new `runFonts` each render, and it asks the same question.
  const runFontsNow = useRef(runFonts);
  useEffect(() => {
    runFontsNow.current = runFonts;
  }, [runFonts]);
  const readFaces = useMemo(
    () => (openBlock === undefined || blocks === undefined ? undefined : () => runFontsNow.current(openBlock, blocks)),
    [openBlock, blocks],
  );
  const faces = useRunFaces(openBlock, readFaces, `${String(blocks?.version ?? '')}-${String(open ?? -1)}-${String(page)}`);
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
    if (!pictureNoted && blocks.blocks.length === 0 && blocks.unaddressable === 0 && blocks.rotated === 0) {
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
    // A WRITE THAT GREW OVER SOMETHING is said, not undone (B1.6): nothing else moves, so the person is told.
    if (covers) notes.push(<p key="covers" role="status">{_(TEXT_EDIT_COVERS)}</p>);
    const angled = blocks.angled;
    if (angled.turned > 0) notes.push(<p key="turned">{_(TEXT_EDIT_TURNED)}</p>);
    if (angled.vertical > 0) notes.push(<p key="vertical">{_(TEXT_EDIT_VERTICAL)}</p>);
    if (angled.slanted > 0) notes.push(<p key="slanted">{_(TEXT_EDIT_SLANTED)}</p>);
    if (angled.mirrored > 0) notes.push(<p key="mirrored">{_(TEXT_EDIT_MIRRORED)}</p>);
  }

  /** What a press or a key on an outline asks: the box, or the caret at a double press's point. */
  const choose = (at: number, block: TextBlock, how: Opening): void => {
    if (blocks === undefined) return;
    if (editing && open !== at) {
      // ANOTHER EDITOR IS OPEN: it finishes on the press that reached here, and this block opens in the read after it.
      if (stuckRef.current) return;
      setNext({ box: block.box, opening: how, version: blocks.version });
      void finishingRef.current?.();
      return;
    }
    setOpen(at, how);
  };

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
      role="group"
    >
      {blocks?.blocks.map((block, at) => {
        const placed = place(block.box, geometry);
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
                  const target = blocks.blocks.findIndex((other, where) => where !== at && overlaps(other.box, waiting.box));
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
                const outcome = await onCommit(block, text, blocks, formatting);
                if (outcome !== 'written') setCommitting((current) => (current === at ? undefined : current));
                if (outcome === 'written') setWritten({ box: block.box, version: blocks.version });
                else if (outcome !== 'unchanged') setNext(undefined);
                return outcome;
              }}
              opened={openedModel}
              opening={opening}
              pageFonts={fontsOfPage(blocks.blocks)}
              paper={paperAround(placed, paperAt)}
              parting={chosen === at && opened?.parting === true}
              past={pastItsPage(block.box, geometry.crop)}
              placed={placed}
              restructure={
                onRestructure === undefined
                  ? undefined
                  : {
                      above: blocks.blocks[neighbourOf(blocks.blocks, at, 'above') ?? -1],
                      below: blocks.blocks[neighbourOf(blocks.blocks, at, 'below') ?? -1],
                      apply: (edits, kept) => onRestructure(edits, blocks, block.form ?? null, kept),
                      families: familiesOf,
                    }
              }
              spell={spell}
              stuckRef={stuckRef}
            />
          );
        }
        const words = wordsOfBlock(block).replace(/\s+/gu, ' ').trim();
        const past = pastItsPage(block.box, geometry.crop);
        const outline = (
          <button
            aria-label={_(TEXT_EDIT_BLOCK_LABEL, { words: words.length > 40 ? `${words.slice(0, 40)}…` : words })}
            {...(past ? { 'aria-description': _(TEXT_EDIT_PAST_PAGE) } : {})}
            className={past ? 'm-text-block m-text-block--past' : 'm-text-block'}
            data-text-block={String(at)}
            key={`block-${String(blocks.version)}-${String(at)}`}
            onClick={(event) => {
              // A DOUBLE PRESS reaches the outline only where the editor did not open under the first; a key's activation
              // (`detail` 0) and a single press select the box.
              choose(at, block, event.detail >= 2 ? { at: 'point', x: event.clientX, y: event.clientY } : { at: 'box' });
            }}
            // A SMALLER BLOCK ABOVE A LARGER ONE that holds it, so the press on a heading inside a column is the heading's.
            style={{ ...boxStyle(placed), zIndex: 1 + blocks.blocks.filter((other) => area(other.box) > area(block.box)).length }}
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
        // ADD TEXT: the empty page is a surface under the outlines, so a press on a block still edits that block.
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
              const target = blocks.blocks.findIndex((other) => overlaps(other.box, waiting.box));
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
const NO_FACES = { settled: true, loaded: new Map<string, string>() } as const;
