import { useLingui } from '@lingui/react';
import { type DocVersion, lineText, pdfPoint, toViewport } from '@monstera/shared';
import type React from 'react';
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { OverlayPage } from './annotations/annotationSpace.js';
import { overlayTransform } from './annotations/annotationSpace.js';
import type { BlockCommit, TextBlock } from './commands/documentCommands.js';
import { problemMessage, problemParticulars } from './dialogs/problemMessages.js';
import {
  TEXT_EDIT_BLOCK_LABEL,
  TEXT_EDIT_EDITOR_LABEL,
  TEXT_EDIT_LAYER_LABEL,
  TEXT_EDIT_HELD,
  TEXT_EDIT_NONE,
  TEXT_EDIT_PROMOTE,
  TEXT_EDIT_REFUSED_HINT,
  TEXT_EDIT_ROTATED,
  TEXT_EDIT_TRUNCATED,
  TEXT_EDIT_UNADDRESSABLE,
} from './messages/en.js';
import { composing } from './surfaces/shortcuts.js';

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

/** One page's blocks, stamped with the version the read answered at. */
export interface PageBlocks {
  readonly version: DocVersion;
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
  /** Writes one block's new words, at the version the blocks were read at. */
  readonly onCommit: (block: TextBlock, text: string, version: DocVersion) => Promise<BlockCommit>;
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
): string | undefined {
  const margin = 3;
  const samples = [
    paperAt(placed.left - margin, placed.top - margin),
    paperAt(placed.left + placed.width + margin, placed.top - margin),
    paperAt(placed.left - margin, placed.top + placed.height + margin),
    paperAt(placed.left + placed.width + margin, placed.top + placed.height + margin),
  ].filter((sample): sample is string => sample !== undefined);
  let best: string | undefined;
  let most = 0;
  for (const sample of samples) {
    const count = samples.filter((other) => other === sample).length;
    if (count > most) {
      best = sample;
      most = count;
    }
  }
  return best;
}

/** A block's words as the person is shown them: each line by `lineText`, lines by a break. */
function wordsOf(block: TextBlock): string {
  return block.lines.map((line) => lineText(line.runs)).join('\n');
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
  onPromote,
  onLeave,
  paperAt,
}: TextEditLayerProps): ReactElement {
  const { _ } = useLingui();
  /** The open block: its position in the answer, and the version that answer was read at. */
  const [opened, setOpened] = useState<{ readonly at: number; readonly version: DocVersion } | undefined>();
  // A NEW READ CLOSES THE EDITOR, and it is DERIVED rather than reset in an
  // effect: an open block's indices describe the version it was read at, so an
  // editor over a newer answer would write words over objects the page no
  // longer has — and an effect would leave it open for one render first.
  const open = opened !== undefined && opened.version === blocks?.version ? opened.at : undefined;
  const setOpen = (at: number | undefined): void => {
    setOpened(at === undefined || blocks === undefined ? undefined : { at, version: blocks.version });
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
              geometry={geometry}
              // THE BLOCK'S POSITION AND THE VERSION, so a new read — or the
              // same slot holding a different block — is a new editor rather
              // than old words in a new place.
              key={`editor-${String(blocks.version)}-${String(at)}`}
              // CLOSES ONLY ITSELF. A click on another block blurs this one, and
              // the write it starts finishes after that block has opened — an
              // unconditional close would shut the block the person just chose.
              onClose={() => {
                setOpened((current) => (current?.at === at ? undefined : current));
              }}
              onCommit={(text) => onCommit(block, text, blocks.version)}
              paper={paperAround(placed, paperAt)}
              placed={placed}
            />
          );
        }
        const words = wordsOf(block).replace(/\s+/gu, ' ').trim();
        return (
          <button
            aria-label={_(TEXT_EDIT_BLOCK_LABEL, { words: words.length > 40 ? `${words.slice(0, 40)}…` : words })}
            className="m-text-block"
            data-text-block={String(at)}
            key={`block-${String(blocks.version)}-${String(at)}`}
            onClick={() => {
              setOpen(at);
            }}
            style={boxStyle(placed)}
            type="button"
          />
        );
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
  readonly onCommit: (page: number, block: TextBlock, text: string, version: DocVersion) => Promise<BlockCommit>;
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
      onCommit={(block, text, at) => editing.onCommit(page, block, text, at)}
      onLeave={editing.onLeave}
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
  readonly paper: string | undefined;
  readonly onCommit: (text: string) => Promise<BlockCommit>;
  readonly onClose: () => void;
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
function BlockEditor({ block, geometry, placed, paper, onCommit, onClose }: BlockEditorProps): ReactElement {
  const { _ } = useLingui();
  const original = wordsOf(block);
  const [text, setText] = useState(original);
  /** Why the words are still here after a commit wrote nothing: a signed document left as it was, or the refusal. */
  const [problem, setProblem] = useState<Exclude<BlockCommit, 'written' | 'unchanged'> | undefined>(undefined);
  const area = useRef<HTMLDivElement>(null);
  /** Set while a write is in flight, so a blur during it does not write twice. */
  const writing = useRef(false);

  // THE RUNS, each in its own style, and the caret at the end. The block is this editor's for its whole life — a new
  // read or another block is a new editor (`key`) — so this runs once.
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    const owner = element.ownerDocument;
    element.replaceChildren(
      ...block.lines.map((line) => {
        const row = owner.createElement('div');
        row.className = 'm-text-editor__line';
        for (const run of line.runs) {
          const span = owner.createElement('span');
          span.textContent = run.text;
          drawRun(span, run.style, 1);
          row.append(span);
        }
        return row;
      }),
    );
    element.focus();
    const range = owner.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = owner.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [block]);

  // AT THE ZOOM ON SCREEN: each run's size times the zoom, again whenever the zoom moves, on the runs as they are now
  // — what the person typed stays.
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    for (const span of element.querySelectorAll<HTMLElement>('.m-text-editor__run')) {
      span.style.fontSize = `${String(Number(span.dataset['size'] ?? '0') * geometry.zoom)}px`;
    }
  }, [geometry.zoom]);

  const finish = useCallback(async (): Promise<void> => {
    if (writing.current) return;
    writing.current = true;
    const outcome = await onCommit(text);
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
    onClose();
  }, [onClose, onCommit, text]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // A COMPOSITION'S ESCAPE cancels the candidate, and is not the editor's (`composing`).
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    event.stopPropagation();
    // AFTER A REFUSAL, Escape puts the text back rather than trying again: the
    // sentence says so, and a second Escape that re-sent the same words would
    // meet the same refusal.
    if (problem !== undefined) {
      onClose();
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
    <div className="m-text-editor-frame" style={{ ...boxStyle(placed), height: 'auto', minHeight: placed.height }}>
      <div
        aria-label={_(TEXT_EDIT_EDITOR_LABEL)}
        aria-multiline="true"
        className={`m-text-editor ${faceOf(block.style)}`}
        contentEditable="plaintext-only"
        data-text-editor=""
        onBlur={() => {
          if (problem === undefined) void finish();
        }}
        onInput={(event) => {
          setText(event.currentTarget.innerText);
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
          ...(paper === undefined ? {} : { backgroundColor: paper }),
        }}
      />
      {/* THE HANDLES, a mark and not a control — see the file's header. */}
      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((corner) => (
        <span aria-hidden className={`m-text-editor-handle m-text-editor-handle--${corner}`} key={corner} />
      ))}
      {problem === undefined ? null : <EditorProblem problem={problem} />}
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
