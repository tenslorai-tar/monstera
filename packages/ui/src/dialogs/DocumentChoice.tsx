import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useId } from 'react';

/** One open document, as a picker needs to name it. */
export interface DocumentChoice {
  readonly docId: string;
  readonly name: string;
}

/**
 * Choose one open document.
 *
 * ## Extracted at the THIRD copy, which is where it stopped being a judgement
 *
 * `MergeDocumentBody`, `InsertFromPdfBody` and `ReplacePageBody` ask the same
 * question with different labels. Two copies is a comment; three is a component
 * — and the thing worth sharing is not the markup but the **reason** for it,
 * which was about to be written out three times.
 *
 * ## A NATIVE `<select>`, and that is invariant 27 rather than taste
 *
 * `ComparePane.tsx` records it: Base UI's `SelectPopup` injects a `<style>`
 * element, and §9.27's pinned CSP admits no inline style. So the primitive set
 * has no select, and a picker is written with the platform's own control until
 * that trigger fires. It is also the accessible default — operable by keyboard,
 * screen reader and touch with nothing written here, which is what B9 means by
 * substrate.
 *
 * ## No empty option
 *
 * `ComparePane`'s picker has a legitimate empty state — *the same document* is
 * a choice a reader returns to. These do not: every caller opens only when
 * there is at least one choice, and *no document* is expressed by dismissing.
 * An empty first option would be a value the result schema then has to refuse,
 * which is a failure state invented by the control.
 *
 * The label is a `MessageKey` rather than text, so each caller says what it is
 * choosing FOR — *to merge in*, *to insert*, *to replace with* — and B9's ban
 * on literal strings in JSX holds at the call site as well as here.
 */
export function DocumentChoiceSelect({
  label,
  choices,
  value,
  onChange,
  marker,
}: {
  readonly label: MessageKey;
  readonly choices: readonly DocumentChoice[];
  readonly value: string;
  readonly onChange: (docId: string) => void;
  /** A `data-` hook so each dialog's control is addressable in its own test. */
  readonly marker: string;
}): ReactElement {
  const { _ } = useLingui();
  const pickerId = useId();

  return (
    <label className="m-document-choice" htmlFor={pickerId}>
      {_(label)}
      <select
        id={pickerId}
        data-document-choice={marker}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.docId} value={choice.docId}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
}
