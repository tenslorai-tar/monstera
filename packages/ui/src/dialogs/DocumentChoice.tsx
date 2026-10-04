import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import { SOURCE_CHOOSE_FILE, SOURCE_NONE_OPEN, SOURCE_PAGE_COUNT } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { DialogRow } from '../primitives/Dialog.js';
import type { SourceDocument } from './sourceDocuments.js';

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
 * `docs/FEATURES.md`'s design-substrate row records it: Base UI's `SelectPopup` injects a `<style>`
 * element, and §9.27's pinned CSP admits no inline style. So the primitive set
 * has no select, and a picker is written with the platform's own control until
 * that trigger fires. It is also the accessible default — operable by keyboard,
 * screen reader and touch with nothing written here, which is what B9 means by
 * substrate.
 *
 * ## No empty option
 *
 * Every caller opens only when there is at least one choice, and *no document*
 * is expressed by dismissing.
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
  // A ROW OF THE DIALOG PATTERN (2026-10-02): the question at the left, the picker at the right.
  return (
    <DialogRow label={label}>
      <DocumentSelect label={label} choices={choices} value={value} onChange={onChange} marker={marker} />
    </DialogRow>
  );
}

/** The select itself, named by the row's own question, so what is seen and what is announced are one string. */
function DocumentSelect({
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
  readonly marker: string;
}): ReactElement {
  const { _ } = useLingui();
  return (
    <select
      aria-label={_(label)}
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
  );
}

/**
 * Choose the document a page command copies from: an open one, or a file picked with *Choose file…*.
 *
 * The four second-document dialogs' one row (Replace pages, Insert from PDF, Merge, Import page as layer). The note
 * under the question says how many pages the chosen document has, because each of those dialogs then asks which of
 * them, or where they go. With no other document open there is nothing to select, and the row says so beside the one
 * thing that can be done: *Choose file…*.
 *
 * *Choose file…* does not pick here. It calls `onChooseFile`, and the dialog answers with that request
 * (`chooseFileAnswer`): the command opens the file through the one open route (ADR-0040 Decision 2), so the file
 * arrives as a tab, and asks again with it chosen.
 */
export function SourceDocumentRow({
  label,
  choices,
  value,
  onChange,
  onChooseFile,
  marker,
}: {
  readonly label: MessageKey;
  readonly choices: readonly SourceDocument[];
  readonly value: string;
  readonly onChange: (docId: string) => void;
  readonly onChooseFile: () => void;
  /** A `data-` hook so each dialog's control is addressable in its own test. */
  readonly marker: string;
}): ReactElement {
  const chosen = choices.find((choice) => choice.docId === value);
  return (
    <DialogRow
      label={label}
      note={chosen === undefined ? SOURCE_NONE_OPEN : SOURCE_PAGE_COUNT}
      noteValues={chosen === undefined ? undefined : { count: chosen.pageCount }}
    >
      <div className="m-source-document">
        {choices.length === 0 ? null : (
          <DocumentSelect label={label} choices={choices} value={value} onChange={onChange} marker={marker} />
        )}
        <Button label={SOURCE_CHOOSE_FILE} onClick={onChooseFile} />
      </div>
    </DialogRow>
  );
}
