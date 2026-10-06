import { useLingui } from '@lingui/react';
import { type CSSProperties, type FocusEvent, type KeyboardEvent, type ReactElement, useRef } from 'react';

import { FORMS_CHOICE_EMPTY } from '../messages/en.js';
import { composing } from '../surfaces/shortcuts.js';
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
}): ReactElement {
  const shown = useRef<string | undefined>(undefined);
  const cancelled = useRef(false);
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
    },
  };
  return offer.lines ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />;
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
