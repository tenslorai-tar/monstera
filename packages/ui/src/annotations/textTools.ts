import {
  type AnnotationColour,
  type AnnotationKindName,
  type AnnotationRect,
  type DispatchableCommand,
  MAX_ANNOTATION_TEXT,
} from '@monstera/contract';
import { type MessageKey, type PageTransform, type ViewportPoint, viewportPoint } from '@monstera/shared';
import { z } from 'zod';

import { COMMAND_PROBLEM_DIALOG_ID } from '../dialogs/commandProblem.js';
import {
  HINT_TEXT_BOX,
  HINT_TYPEWRITER,
  WRITE_CALLOUT_LABEL,
  WRITE_TEXT_BOX_LABEL,
  WRITE_TOO_LONG,
  WRITE_TYPEWRITER_LABEL,
} from '../messages/en.js';
import type { Write, WriteRequest } from '../pageWriting.js';
import type { Gesture, ToolController, ToolPreview, UiTool } from '../registries/tools.js';
import { endOf, pointerPath, startOf } from '../registries/tools.js';
import { draggedRect } from './annotationSpace.js';
import type { AnnotationStyle } from './annotationStyle.js';
import { type AnnotationSnapshot, markAt } from './eraserTool.js';
import type { KnownField } from './fieldNameCheck.js';
import type { WordsOf } from './markWords.js';

/**
 * The text tools — the first that cannot answer from the gesture alone.
 *
 * ## What separates this file from `shapeTools.ts`
 *
 * Not the geometry: a text box is dragged exactly as a rectangle is, and this
 * file's preview is the box one. What separates them is that a shape is
 * complete when the pointer comes up and a text box is not — the words are the
 * annotation, and they come from a person.
 *
 * So these tools take their dependencies at construction, the way
 * `deletePagesCommand(deps)` does, and `commit` answers a promise. Both of
 * those are the platform's, not this file's: `ToolController.commit` may answer
 * now or later, and the six shape tools kept answering now.
 *
 * ## Why the dependency is `write` and not a dialog id
 *
 * A tool that returned *"open this box and send that command"* would put the
 * pairing in the overlay, which would then need a table of tool-to-request —
 * the second wiring place the registries exist to forbid. Holding `write`
 * means the tool asks the page for its own words and builds its own command,
 * which is ADR-0038's shape with the page where the dialog was (ADR-0154).
 */

/**
 * What a text box is written in until the style controls exist.
 *
 * **Near-black rather than the shapes' red**, and the difference is not
 * decoration: a shape's stroke is a mark ON the page and reads as annotation,
 * where a text box is words a person is adding TO it and reads as content. A
 * red one looks like a correction whatever it says.
 */
const TEXT_COLOUR: AnnotationColour = [0.1, 0.1, 0.1];

/**
 * The point size moved out on 2026-09-07, to `editing.annotation-font-size`.
 *
 * Twelve is the size a document's own body text usually is, so a box added to
 * one sits with it rather than beside it — which is now the setting's fallback,
 * with that reasoning beside it. Deleted here rather than kept unread, for
 * `shapeTools.ts`' reason.
 */

/**
 * The smallest box worth treating as a text box, in CSS pixels.
 *
 * `shapeTools`' threshold and its argument, with one difference that matters:
 * this tool is about to open a box with the caret in it. A stray click that
 * fell through would take the keyboard from a person who did not ask for a
 * box, which is worse than the stray rectangle the shape tools discard.
 */
const MINIMUM_BOX = 8;

/** What the drag describes, in the overlay's own pixels. */
function box(gesture: Gesture): { x: number; y: number; width: number; height: number } {
  const from = startOf(gesture);
  const to = endOf(gesture);
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/** What a tool needs from the shell to be able to ask. */
export interface TextToolDeps {
  /**
   * Opens a dialog and settles with its answer, or `undefined` if dismissed.
   *
   * The same `ask` the document commands take, typed the same way: `unknown`
   * out, because the registry cannot know which dialog a caller names, and the
   * caller narrows with the dialog's own result schema.
   */
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /**
   * Asks for words typed ON THE PAGE, where they will go (ADR-0154), and settles with them or `undefined` for none.
   * Beside `ask` and held the same way, so a tool still builds its own command from the answer.
   */
  readonly write: Write;
  /**
   * The fields the document has, read when a field tool is about to ask for a name (`undefined` when they cannot be
   * read, which is no check and never a refusal). Optional: the annotation tools beside the field tools take no names.
   */
  readonly fields?: () => Promise<readonly KnownField[] | undefined>;
  /**
   * The style a new annotation is drawn in.
   *
   * A VALUE rather than a reader, and the registry is rebuilt when it moves —
   * `annotationStyle.ts` has the argument. Every tool that writes a colour, a
   * width or a size takes it, which is why it sits on the deps every tool
   * already receives rather than on a second interface.
   */
  readonly style: AnnotationStyle;
}

/** The registry ids, shared with the commands that select these tools. */
export const TEXT_BOX_TOOL_ID = 'annotate.text-box';
export const TYPEWRITER_TOOL_ID = 'annotate.typewriter';

/**
 * A box, then the words that go in it.
 *
 * ## ONE FACTORY FOR TWO TOOLS, and what they differ by is in the DOCUMENT
 *
 * The typewriter is this gesture exactly — a drag, then the words — and until
 * 2026-09-07 it would also have been the same annotation: a text box drew no
 * box, so the two controls would have produced documents nobody could tell
 * apart. The difference was made real in the kernel rather than here (the text
 * box gained the border its name promises), and what this file carries is the
 * two things a surface decides: what the box it opens is called, and which
 * draft it builds.
 *
 * @param deps what the tool needs to ask. Captured here rather than passed to
 *   `commit`, so the six tools that need nothing keep a three-parameter commit
 */
function boxTextTool(
  id: string,
  label: MessageKey,
  type: 'text-box' | 'typewriter',
  deps: TextToolDeps & ReopenDeps,
  placesOnClick = false,
): UiTool {
  const drawn = (gesture: Gesture): ToolPreview | undefined => {
    const measured = box(gesture);
    // BOTH AXES, `shapeTools`' rule: a drag of 40 by 1 is a sliver nobody meant
    // to draw, and a distance test accepts it.
    if (measured.width < MINIMUM_BOX || measured.height < MINIMUM_BOX) return undefined;
    return { shape: 'rect', ...measured };
  };

  const controller: ToolController = {
    ...pointerPath,
    commit: async (
      gesture: Gesture,
      page: number,
      transform: PageTransform,
    ): Promise<DispatchableCommand | undefined> => {
      // THE SAME THRESHOLD AS THE PREVIEW, read from it rather than restated —
      // and here it also decides whether a box opens on the page at all, so the
      // two coming apart would be a box appearing for a drag that showed none.
      // A CLICK is the typewriter's other gesture (`placesOnClick`): there the
      // box starts at the point clicked and grows with the words.
      const clicked = drawn(gesture) === undefined;
      // A CLICK ON WORDS ALREADY ON THE PAGE EDITS THEM rather than starting another mark on top (ADR-0154 Decision 3),
      // so the first click of a double-click does not place a second box. Only a click: a drag over a mark draws a new
      // box, which is what a drag means.
      if (clicked) {
        const reopened = await reopenWords(deps, startOf(gesture), page, transform);
        if (reopened.found) return reopened.command;
      }
      if (clicked && !placesOnClick) return undefined;

      // THE RECTANGLE IS BUILT BEFORE THE WORDS, from the transform the overlay
      // read at pointer-up. Building it after would convert a gesture using
      // whatever zoom the page is at when the person finishes typing. A click's
      // box needs the words, so it is built after the answer — from the same
      // `transform`, the one read at pointer-up, which is what the rule protects.
      const dragged = clicked ? undefined : draggedRect(startOf(gesture), endOf(gesture), transform);

      const text = await writeAnnotationWords(deps, {
        page,
        // A CLICK'S BOX before any words is `clickedRect`'s for none — one line at the point clicked — so the box
        // a person types into and the box the annotation is made from are one rule.
        box: dragged ?? clickedRect(startOf(gesture), '', deps.style.fontSize, transform),
        label,
        colour: TEXT_COLOUR,
        grows: clicked,
      });
      // NOTHING TYPED IS NO ANNOTATION, the outcome a drag too small to see
      // already produces: there is nothing to build a command from.
      if (text === undefined) return undefined;
      const rect = dragged ?? clickedRect(startOf(gesture), text, deps.style.fontSize, transform);

      return {
        kind: 'addAnnotation',
        page,
        annotation: {
          type,
          rect,
          text,
          colour: deps.style.colour(TEXT_COLOUR),
          opacity: deps.style.opacity,
          fontSize: deps.style.fontSize,
          font: deps.style.font,
          direction: deps.style.direction,
        },
      };
    },
    preview: drawn,
    reopen: async (at, page, transform) => (await reopenWords(deps, at, page, transform)).command,
  };

  // THE HINT FOLLOWS THE FLAG that decides whether a click places a box, so what the bar says and what a click does
  // are one decision.
  // THE I-BEAM, since a press here is for words (the owner's item 15d).
  return { id, controller, hint: placesOnClick ? HINT_TYPEWRITER : HINT_TEXT_BOX, cursor: 'text' };
}

/** A box with a border, and the words in it. */
export function textBoxTool(deps: TextToolDeps & ReopenDeps): UiTool {
  return boxTextTool(TEXT_BOX_TOOL_ID, WRITE_TEXT_BOX_LABEL, 'text-box', deps);
}

/**
 * Words typed onto the page, with no box around them.
 *
 * **Its own name for the box**, for the sticky note's reason: the two ask a
 * person the same question and mean different things by it, and a field named
 * *Text box* collecting what somebody is typing onto a form is a control that
 * says what it will do and then does something else.
 *
 * **The preview is still a rectangle**, and that is honest rather than a
 * leftover: what the drag names IS the box the words are laid out in, whether
 * or not the box is drawn afterwards. A preview that showed no region would
 * leave a person guessing where their words are about to go.
 */
export function typewriterTool(deps: TextToolDeps & ReopenDeps): UiTool {
  return boxTextTool(TYPEWRITER_TOOL_ID, WRITE_TYPEWRITER_LABEL, 'typewriter', deps, true);
}

/**
 * The rule words typed for an annotation meet: no more than the payload's limit, after the trim the result schema
 * applies (`ANNOTATION_TEXT_RESULT`, which takes the same `MAX_ANNOTATION_TEXT`). Nothing typed is not refused here —
 * it is no annotation, which `settle` decides.
 */
export function annotationTextCheck(text: string): MessageKey | undefined {
  return text.trim().length > MAX_ANNOTATION_TEXT ? WRITE_TOO_LONG : undefined;
}

/**
 * What an annotation's words are taken as once typed. `.min(1)` and `.trim()` together are the gate: a text box
 * carrying nothing is a rectangle with an invisible border — a control that appears to have done nothing — and
 * whitespace produces exactly that while looking like content, so the trim happens before the bound rather than after
 * it. The upper bound is the contract's `MAX_ANNOTATION_TEXT`, imported rather than restated, so the page cannot accept
 * what the channel refuses.
 */
const ANNOTATION_TEXT_RESULT = z.object({ text: z.string().trim().min(1).max(MAX_ANNOTATION_TEXT) }).strict();

/** What a tool says when it asks the page for what a new annotation says. */
export interface AnnotationWords {
  readonly page: number;
  /** Where the words go, in PDF space. */
  readonly box: AnnotationRect;
  readonly label: MessageKey;
  /**
   * The tool's own colour, resolved through the reader's style as the annotation's will be — or `undefined` for words
   * the page does not draw where they are typed, a note's, which are set in the application's face.
   */
  readonly colour: AnnotationColour | undefined;
  readonly grows: boolean;
}

/**
 * Asks the page for what a new annotation says, and answers it as the dialog it replaces did: trimmed by
 * `ANNOTATION_TEXT_RESULT`, or `undefined` for nothing typed. With {@link writeMarkWords}, the one way an annotation's
 * words are asked for, so the rule they meet and the style they are typed in are not spelt again by each tool (B3a).
 */
export async function writeAnnotationWords(
  deps: Pick<TextToolDeps, 'write' | 'style'>,
  words: AnnotationWords,
): Promise<string | undefined> {
  const { colour } = words;
  return askAnnotationWords(deps.write, {
    page: words.page,
    box: words.box,
    shape: 'block',
    initial: '',
    label: words.label,
    ...(colour === undefined
      ? {}
      : {
          style: {
            fontSize: deps.style.fontSize,
            colour: deps.style.colour(colour),
            font: deps.style.font,
            direction: deps.style.direction,
          },
        }),
    grows: words.grows,
  });
}

/**
 * Asks the page for what an EXISTING mark says or is answered with — *Edit comment* and *Reply* (ADR-0154 Decision 1):
 * on a card beside the mark, from `initial`, in the application's face, since a mark's comment is not drawn where it is
 * typed. Answered as {@link writeAnnotationWords} answers, by the same rule.
 */
export async function writeMarkWords(
  write: Write,
  words: { readonly page: number; readonly beside: AnnotationRect; readonly label: MessageKey; readonly initial: string },
): Promise<string | undefined> {
  return askAnnotationWords(write, {
    page: words.page,
    box: words.beside,
    shape: 'block',
    initial: words.initial,
    label: words.label,
    grows: false,
  });
}

/** What a tool that reopens words on the page needs: the walk, the page writer, the whole words, and the means to say no. */
export interface ReopenDeps {
  /** The same read the eraser and the select tool hold. */
  readonly annotations: () => Promise<AnnotationSnapshot | undefined>;
  readonly write: Write;
  /** The words an edit starts from (`wordsToEdit`), so a reopen of a long comment does not start from the walk's slice. */
  readonly wordsOf: WordsOf;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
}

/**
 * The kinds whose words are DRAWN on the page, which a reopen edits, and what the box it opens is called.
 *
 * Every other kind's words are its comment, which *Edit comment* and the Properties tab edit; a double-click on one
 * reopens nothing, `pointerPath`'s default.
 */
const DRAWN_WORDS: Readonly<Partial<Record<AnnotationKindName, MessageKey>>> = {
  'text-box': WRITE_TEXT_BOX_LABEL,
  typewriter: WRITE_TYPEWRITER_LABEL,
  callout: WRITE_CALLOUT_LABEL,
};

/**
 * Whether a mark with drawn words was under the point, and the edit made of it — a reopen (ADR-0154 Decision 3).
 *
 * `found` is separate from the command because the two mean different things to a text tool's click: a mark found and
 * left unchanged sends nothing AND places nothing, where no mark found lets the click place a new one.
 */
export type Reopened =
  | { readonly found: false; readonly command?: undefined }
  | { readonly found: true; readonly command: DispatchableCommand | undefined };

/**
 * Opens the words of the text mark under `at`, and answers `editAnnotationText` with what they became.
 *
 * ## In their own box, where the file says how they are drawn
 *
 * A text box's and a typewriter's words are typed where they are, in the size, colour and face the walk read from the
 * mark (`typed`). A callout's sit in an inner box the walk does not carry, and a mark whose style could not be read
 * carries none; both are edited on a card beside the mark instead, which is a place to type and never a refusal.
 *
 * ## From the whole words, at the walk's version
 *
 * The starting text is `wordsOf`'s, so a long comment is read whole rather than edited as the walk's slice, and the
 * command names the version the walk was read at, which the bus refuses if the document has moved. Nothing typed or
 * the words left as they were sends nothing: an edit that changes nothing would be an undo step that undoes nothing.
 */
export async function reopenWords(
  deps: ReopenDeps,
  at: ViewportPoint,
  page: number,
  transform: PageTransform,
): Promise<Reopened> {
  const snapshot = await deps.annotations();
  if (snapshot === undefined) return { found: false };
  const hit = markAt(snapshot.annotations, page, at, transform);
  if (hit === undefined) return { found: false };
  const label = DRAWN_WORDS[hit.kind];
  if (hit.rect === null || label === undefined) return { found: false };

  const words = await deps.wordsOf({
    page,
    version: snapshot.version,
    index: hit.index,
    contents: hit.contents,
    cut: hit.cut,
  });
  if (words.kind !== 'words') {
    void deps.ask(COMMAND_PROBLEM_DIALOG_ID, words.kind === 'too-long' ? { code: 'comment-too-long' } : words.problem);
    return { found: true, command: undefined };
  }
  const style = hit.kind === 'callout' ? undefined : hit.typed;
  const text =
    style === undefined
      ? await writeMarkWords(deps.write, { page, beside: hit.rect, label, initial: words.text })
      : await askAnnotationWords(deps.write, {
          page,
          box: hit.rect,
          shape: 'block',
          initial: words.text,
          label,
          style,
          grows: false,
        });
  if (text === undefined || text === words.text) return { found: true, command: undefined };
  return {
    found: true,
    command: { kind: 'editAnnotationText', page, index: hit.index, text, version: snapshot.version },
  };
}

/** The ask both share: the rule the words meet, and the trim and limit of the result schema the dialogs answered with. */
async function askAnnotationWords(write: Write, request: Omit<WriteRequest, 'check'>): Promise<string | undefined> {
  const text = await write({ ...request, check: annotationTextCheck });
  if (text === undefined) return undefined;
  const answered = ANNOTATION_TEXT_RESULT.safeParse({ text });
  return answered.success ? answered.data.text : undefined;
}

/**
 * The widest a character of the three faces may be, as a fraction of the type size: Courier's fixed advance, 0.6 em,
 * which is wider than Helvetica's and Times' average. A typewriter draws no border, so a box a little wide is invisible
 * and one too narrow wraps the words — the safe side is the wide one.
 */
const WIDEST_ADVANCE = 0.6;
/** The distance between lines MuPDF sets a FreeText's text at: 14.4 for 12 points, measured in its appearance stream. */
const LINE_SPACING = 1.2;
/** Room around the words, in points: MuPDF insets a FreeText's text by 2 and its border by half a point. */
const INSET = 3;

/**
 * The box a typewriter's CLICK makes: starting at the point clicked, wide enough for the longest line and tall enough
 * for every line, and no wider than the page's room to its right — a line that does not fit then wraps, and the box is
 * taller by the lines that makes.
 *
 * Its far corner is found in VIEWPORT space and both corners mapped by {@link draggedRect}, as a drag's are, so a
 * rotated or offset page is handled by the one conversion the drag uses rather than by arithmetic of its own.
 */
export function clickedRect(
  at: ViewportPoint,
  text: string,
  fontSize: number,
  transform: PageTransform,
): ReturnType<typeof draggedRect> {
  const lines = text.split('\n');
  const room = Math.max(fontSize, (transform.viewport.width - at.x) / transform.scale);
  const widths = lines.map((line) => line.length * fontSize * WIDEST_ADVANCE + 2 * INSET);
  const width = Math.min(room, Math.max(...widths));
  const drawnLines = widths.reduce((count, each) => count + Math.max(1, Math.ceil(each / width)), 0);
  const height = drawnLines * fontSize * LINE_SPACING + 2 * INSET;
  return draggedRect(at, viewportPoint(at.x + width * transform.scale, at.y + height * transform.scale), transform);
}
