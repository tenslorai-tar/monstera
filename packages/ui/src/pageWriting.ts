import {
  type AnnotationColour,
  type AnnotationFont,
  type AnnotationRect,
  type AnnotationTextRun,
  MAX_TEXT_RUN_CHARS,
  MAX_TEXT_RUNS,
  type TextDirection,
} from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

/**
 * Words a person types ON THE PAGE, asked for by a tool or a command
 * ([ADR-0154](../../../docs/DECISIONS/0154-words-are-typed-on-the-page-and-the-page-is-asked-for-them.md)).
 *
 * `write` stands beside `ask`: a tool holds it, constructed with it, and asks for the words where they will go rather
 * than in a dialog away from them. The application holds the one pending request and the page list draws it over its
 * own page as `InlineWriter`. This module is the request and the rule for what each way of ending one answers, so the
 * editor, the application and their cases read one rule.
 */

/** What is asked for: what an annotation says, or one line — a field's name, a link's address (Decision 1). */
export type WriteShape = 'block' | 'line';

/** How the words are drawn while typed: the style the annotation will be drawn in. */
export interface WriteStyle {
  /** In points; drawn at the zoom on screen. */
  readonly fontSize: number;
  readonly colour: AnnotationColour;
  /** The face KIND the page will draw them in; the renderer has no base-14 font, so a face of the same kind. */
  readonly font: AnnotationFont;
  /** The family by name the page will draw them in (K2), which the box shows them in where this computer has it. */
  readonly family?: string;
  readonly direction: TextDirection;
}

export interface WriteRequest {
  /** Zero-based, as a command names it. */
  readonly page: number;
  /** Where the words go, in PDF space. A growing request's box is where they start and how small it may be. */
  readonly box: AnnotationRect;
  readonly shape: WriteShape;
  /** The words to start from: empty for new ones, a mark's own for an edit. Nothing typed answers nothing either way. */
  readonly initial: string;
  /** The field's accessible name, which says what is being typed. */
  readonly label: MessageKey;
  /** The style a block's words are drawn in; a line is the application's own field. */
  readonly style?: WriteStyle;
  /** Whether the box widens and lengthens with the words — a typewriter's click gives a point, not a box. */
  readonly grows?: boolean;
  /**
   * The words' rule, as the dialog it replaces had it: the message to show under the box, or `undefined` for words
   * that pass. Taken from the dialog's own result schema or bound by the caller, so the rule is written once (B3a).
   * Words the rule refuses are said to be at once; nothing typed, only once the person has tried to finish.
   */
  readonly check?: (text: string) => MessageKey | undefined;
  /**
   * Where a block's words styled one by one while typed are kept (the owner's B5.8): present, the box takes Ctrl+B, Ctrl+I
   * and Ctrl+U on the words chosen. The asker holds it and reads it once the words are answered ({@link styledRunsFor}).
   */
  readonly styled?: StyledWords;
}

/** A run of typed words and the styles a key gave them: the text box's own run, so nothing is translated on the way. */
export type TypedRun = Pick<AnnotationTextRun, 'text' | 'bold' | 'italic' | 'underline' | 'strike'>;

/**
 * The runs a styled request's words were typed in, kept as they change, so an editor drawn again when its document
 * returns starts from them as it starts from its {@link Draft}.
 */
export interface StyledWords {
  readonly read: () => readonly TypedRun[];
  readonly keep: (runs: readonly TypedRun[]) => void;
}

export function styledWords(): StyledWords {
  let runs: readonly TypedRun[] = [];
  return {
    read: () => runs,
    keep: (next) => {
      runs = next;
    },
  };
}

/** Whether any run says a style: runs that say none are the plain words, which a command carries as its text alone. */
function anyStyle(runs: readonly TypedRun[]): boolean {
  return runs.some((run) => run.bold === true || run.italic === true || run.underline === true || run.strike === true);
}

/** The runs as the wire takes them: a run longer than {@link MAX_TEXT_RUN_CHARS} as pieces of that length in its style. */
function wireRuns(runs: readonly TypedRun[]): TypedRun[] {
  return runs.flatMap((run) => {
    const characters = Array.from(run.text);
    const pieces: TypedRun[] = [];
    // BY CODE POINT, so a piece never ends inside a character a surrogate pair spells: half the bound in code points is
    // at most the bound in the UTF-16 units the schema counts.
    for (let at = 0; at < characters.length; at += MAX_TEXT_RUN_CHARS / 2) {
      pieces.push({ ...run, text: characters.slice(at, at + MAX_TEXT_RUN_CHARS / 2).join('') });
    }
    return pieces;
  });
}

/** Whether the runs fit what one text box may carry, {@link MAX_TEXT_RUNS} of them as the wire cuts them. */
export function runsFit(runs: readonly TypedRun[]): boolean {
  return !anyStyle(runs) || wireRuns(runs).length <= MAX_TEXT_RUNS;
}

/**
 * The runs the answered `text` was typed in, or `undefined` where none says a style. The answer is the words with the
 * space around them taken off where the asker trims them, so the runs are cut the same way; runs that do not make the
 * text are not the words that were answered, and answer `undefined` rather than another box's styles.
 */
export function styledRunsFor(text: string, runs: readonly TypedRun[]): readonly TypedRun[] | undefined {
  if (!anyStyle(runs)) return undefined;
  const joined = runs.map((run) => run.text).join('');
  const from = joined.indexOf(text);
  if (from < 0 || joined.slice(0, from).trim() !== '' || joined.slice(from + text.length).trim() !== '') return undefined;
  const cut: TypedRun[] = [];
  let at = 0;
  for (const run of runs) {
    const start = Math.max(at, from);
    const end = Math.min(at + run.text.length, from + text.length);
    if (end > start) cut.push({ ...run, text: run.text.slice(start - at, end - at) });
    at += run.text.length;
  }
  return anyStyle(cut) ? wireRuns(cut) : undefined;
}

/**
 * The words typed so far in one request, kept with the request rather than in the editor, so an editor drawn again
 * when its document returns starts from them (Correction before building: *drawn again, with its draft*). Read where a
 * second request finishes this one, and once by an editor as it is drawn.
 */
export interface Draft {
  readonly read: () => string;
  readonly keep: (words: string) => void;
}

export function draftOf(initial: string): Draft {
  let words = initial;
  return {
    read: () => words,
    keep: (next) => {
      words = next;
    },
  };
}

/** The means to ask the page for words: the words, or `undefined` for none — abandoned, or nothing typed. */
export type Write = (request: WriteRequest) => Promise<string | undefined>;

/** How a request ended. */
export type WriteEnd =
  /** Escape, Ctrl+Enter in a block, Enter in a line: what the person pressed to say *done* or *never mind*. */
  | 'escape'
  | 'enter'
  /** A press anywhere else, or focus leaving the box. */
  | 'outside'
  /** A second request arriving while this one was open (Correction before building). */
  | 'replaced';

/**
 * What ending a request this way does: it STAYS open — a line whose rule does not pass, at a key that means *commit* —
 * or it answers the words, or `undefined` for nothing. A tagged value rather than a sentinel string, since a person can
 * type any string, including one that would spell *stay*.
 */
export type Settled = { readonly stays: true } | { readonly stays: false; readonly answer: string | undefined };

/**
 * How a request ends with these words.
 *
 * **A block keeps its words however it ends** (Decision 1: *click outside or Esc to finish*), and nothing typed is
 * nothing — for an edit too, which then changes nothing, since a comment cannot be emptied (the edit dialog's rule:
 * *to remove it, delete the mark*). Words its rule refuses — more than one
 * annotation holds — keep it OPEN with the rule's message at any ending a person chose, since finishing could only
 * drop them: *preserve, never drop*.
 *
 * **A line commits at Enter, a click outside or a replacement only once its rule passes.** Escape abandons it; Enter
 * on words the rule refuses keeps it open, and a click outside on them abandons it rather than leaving it open behind
 * a press elsewhere — a line is a few words, retyped where a block's are not.
 *
 * A REPLACED request cannot stay open, since the next one takes the page: refused words answer nothing.
 */
export function settle(request: WriteRequest, words: string, end: WriteEnd): Settled {
  if (request.shape === 'line' && end === 'escape') return { stays: false, answer: undefined };
  if (request.check?.(words) !== undefined) {
    const stays = end !== 'replaced' && (request.shape === 'block' || end === 'enter');
    return stays ? { stays: true } : { stays: false, answer: undefined };
  }
  if (request.shape === 'line') return { stays: false, answer: words };
  return { stays: false, answer: words.trim() === '' ? undefined : words };
}
