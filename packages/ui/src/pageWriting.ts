import type { AnnotationColour, AnnotationFont, AnnotationRect, TextDirection } from '@monstera/contract';
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
