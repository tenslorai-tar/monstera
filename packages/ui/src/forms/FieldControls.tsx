import { useLingui } from '@lingui/react';
import { type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactElement, useRef } from 'react';

import { FORMS_CHOICE_EMPTY } from '../messages/en.js';
import { composing } from '../surfaces/shortcuts.js';
import { caretIndexAt } from './fieldCaret.js';
import type { FillOffer } from './fieldFill.js';

/**
 * The box a text field is typed into, for the Forms panel and the page alike (ADR-0168 Decision 2).
 *
 * ## No edit is measured against what the box SHOWED
 *
 * Never against the document's text. A control may show a value other than the one it was given: a one-line input
 * strips line breaks, and a textarea turns a carriage return into a line feed (HTML's value sanitisation and API
 * value). A blur compared with the document then wrote that difference back unasked, which rewrote every multi-line
 * answer a person tabbed past as one line. What was shown is read when the box mounts and again when it takes focus.
 *
 * ## Line breaks are kept
 *
 * A field that takes them, or a value that holds them however it got there (`FillOffer.lines`), is a textarea, where
 * Enter is a new line and leaving the box is what fills. A one-line field fills on Enter as on leaving it.
 *
 * ## Escape keeps the field as it was, where the caller can close the box
 *
 * `onCancel` is the page's: its editor is opened by a press and closed by Escape without filling. The panel's boxes
 * are always there, so it passes none and Escape does nothing of its own.
 */
export function FieldTextBox({
  offer,
  name,
  className,
  rows,
  style,
  autoFocus = false,
  marks,
  onCommit,
  onCancel,
  onDone,
  pressedAt,
  onTab,
  selectsAll = false,
}: {
  /** Data attributes a surface finds the box by. */
  readonly marks?: Readonly<Record<`data-${string}`, string>>;
  readonly offer: Extract<FillOffer, { kind: 'text' }>;
  /** The field's own name, which is document data: the accessible name, never translated. */
  readonly name: string;
  readonly className: string;
  /** How many lines a box for line breaks shows. */
  readonly rows?: number;
  readonly style?: CSSProperties;
  readonly autoFocus?: boolean;
  readonly onCommit: (text: string) => void;
  readonly onCancel?: () => void;
  /** Told once the box has been left, after any commit: the page closes its editor here. */
  readonly onDone?: () => void;
  /**
   * Where the press that opened the box landed, in the window's pixels: the caret goes there when the box takes focus
   * (ADR-0226 Decision 3), never to the end or the start of what it holds.
   */
  readonly pressedAt?: { readonly x: number; readonly y: number } | undefined;
  /**
   * Tab and Shift+Tab: the box is left, filling it, and the next or previous field takes the focus. Absent where the
   * browser's own order is the right one (the Forms panel, whose rows are in the form's order already).
   */
  readonly onTab?: ((backwards: boolean, filled: boolean) => void) | undefined;
  /** The words are selected when the box first takes focus with no press to place the caret: reached by Tab. */
  readonly selectsAll?: boolean;
}): ReactElement {
  const shown = useRef<string | undefined>(undefined);
  const cancelled = useRef(false);
  // THE PRESS IS SPENT BY THE FIRST FOCUS: a later focus, by Tab or by a click, puts the caret where that one says.
  const press = useRef(pressedAt);
  const selectAllOnce = useRef(selectsAll);
  const common = {
    ...marks,
    'aria-label': name,
    autoFocus,
    className: offer.lines ? `${className} ${className}--lines` : className,
    defaultValue: offer.held,
    style,
    // ONCE, AT MOUNT, for a box focused before its handler could see the focus. React calls an inline ref again on
    // every commit, so recording on each call took the half-typed value for the shown one whenever the box rendered
    // while a person typed, and the blur then sent nothing (QQQQQQQ-10); a later focus records it afresh.
    ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (element !== null && shown.current === undefined) shown.current = element.value;
    },
    onFocus: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      shown.current = event.currentTarget.value;
      const at = press.current;
      press.current = undefined;
      const selecting = selectAllOnce.current;
      selectAllOnce.current = false;
      if (at !== undefined) {
        const caret = caretFromPress(event.currentTarget, at);
        event.currentTarget.setSelectionRange(caret, caret);
      } else if (selecting) {
        event.currentTarget.select();
      }
    },
    onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!cancelled.current && event.currentTarget.value !== shown.current) onCommit(event.currentTarget.value);
      onDone?.();
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing(event)) return;
      if (event.key === 'Escape' && onCancel !== undefined) {
        // STOPPED HERE, so the Escape that closes this box does not also leave a tool or close a panel behind it.
        event.stopPropagation();
        cancelled.current = true;
        onCancel();
        return;
      }
      if (event.key === 'Enter' && !offer.lines) event.currentTarget.blur();
      if (event.key === 'Tab' && onTab !== undefined && !event.altKey && !event.ctrlKey && !event.metaKey) {
        // THE FORM'S ORDER, not the document's DOM order: the next field may be on the next page, whose layer is a
        // different subtree, so the page decides where the focus goes after this box has been left and filled.
        event.preventDefault();
        const filling = !cancelled.current && event.currentTarget.value !== shown.current;
        event.currentTarget.blur();
        onTab(event.shiftKey, filling);
      }
    },
  };
  return offer.lines ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />;
}

/** The canvas every caret measurement draws nothing on: one per window, made on first use. */
let measuring: CanvasRenderingContext2D | null | undefined;

/**
 * The caret a press at a point asks for, in a box's own text. A one-line box measures its prefixes in the face it draws
 * them in ({@link caretIndexAt}); a box for line breaks first takes the line the press is on, counted by the box's line
 * height from its top, and measures within it. A line the box wrapped on its own is counted as one: the browser says
 * nothing about where it wrapped, and the caret then lands on the right line's start or end rather than in the wrong one.
 */
function caretFromPress(element: HTMLInputElement | HTMLTextAreaElement, at: { readonly x: number; readonly y: number }): number {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  measuring ??= document.createElement('canvas').getContext('2d');
  const context = measuring;
  if (context === null) return element.value.length;
  context.font = style.font;
  const widthOf = (prefix: string): number => context.measureText(prefix).width;
  const x = at.x - box.left - parseFloat(style.borderLeftWidth) - parseFloat(style.paddingLeft) + element.scrollLeft;
  if (!(element instanceof HTMLTextAreaElement)) return caretIndexAt(element.value, x, widthOf);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  const y = at.y - box.top - parseFloat(style.borderTopWidth) - parseFloat(style.paddingTop) + element.scrollTop;
  const lines = element.value.split('\n');
  const line = Math.min(Math.max(0, Math.floor(y / lineHeight)), lines.length - 1);
  const before = lines.slice(0, line).reduce((sum, each) => sum + each.length + 1, 0);
  return before + caretIndexAt(lines[line] ?? '', x, widthOf);
}

/**
 * A choice field's options, for the panel's list and the page's alike: the empty choice first, named as such, because
 * clearing is a fill, then each of `FillOffer.choices`, which holds a value the document does not offer when the field
 * holds one, so it is shown rather than read as empty.
 */
export function ChoiceOptions({ offer }: { readonly offer: Extract<FillOffer, { kind: 'choice' }> }): ReactElement {
  const { i18n } = useLingui();
  return (
    <>
      {offer.choices.map((choice, at) => (
        // THE POSITION IS THE KEY: a document's options can repeat, and the empty choice is always first.
        <option key={at} value={choice}>
          {at === 0 ? i18n._(FORMS_CHOICE_EMPTY) : choice}
        </option>
      ))}
    </>
  );
}
