import { useLingui } from '@lingui/react';
import { type ReactElement, useId, useState } from 'react';

import {
  STATUS_GO_TO,
  STATUS_GO_TO_OUTSIDE,
  STATUS_LABEL,
  STATUS_PAGE_OF,
  STATUS_ZOOM,
} from './messages/en.js';
import { kernelPageOf, pdfjsPageOf } from './pageNumbering.js';

/**
 * The strip along the bottom: which document this is, where the reader is, how
 * big the page is, and the one place a page can be asked for by number.
 *
 * ## The name comes from MAIN, and could not come from anywhere else
 *
 * A renderer holds an opaque `DocId` and no filesystem path (invariant L2), so
 * there is nothing here to cut a file name out of — which is the invariant
 * working rather than a gap in it. `document.open` carries the name because
 * main is the only side that can state it, and what crosses is a name and never
 * a path: a status bar showing `C:\Users\someone\…` puts a directory layout
 * into every screenshot and screen share.
 *
 * ## It COMPUTES nothing, which is the property that matters
 *
 * Every value shown here is state some other surface already owns — the
 * scroller reports the page, the zoom mode resolves to a scale. A status bar
 * that derived either would be a second answer to a question with one, and the
 * two would disagree exactly when a reader was watching (B3). The go-to field
 * does not change that: it **asks** for a page and shows nothing of its own.
 *
 * ## The go-to field is EMPTY rather than holding the current page
 *
 * The obvious shape is an editable box showing the page you are on. It costs
 * something the readout above it currently gives: this footer is `role="status"`
 * and a screen reader announces the page as it changes, and an `<input>` whose
 * `value` React updates fires no text mutation, so that announcement would
 * quietly stop. An empty box beside the readout keeps both — the page is
 * announced as it always was, and the field is a control rather than a second
 * copy of a number already on screen.
 *
 * ## A page outside the document is REFUSED, not clamped
 *
 * `navigationCommands.ts` clamps, and is right to: *next page* at the end is a
 * reader pressing a control that has nowhere to go, and refusing would need a
 * message saying something they can see. A **typed** number is different — 500
 * in a twelve-page document is not "the last page", it is a number that means
 * nothing here, and answering it with page 12 tells the reader their document
 * has 500 pages.
 *
 * ## `role="status"` and not `aria-live="assertive"`
 *
 * The page number changes on every scroll. An assertive region would interrupt
 * a screen-reader user mid-sentence, several times a second, to tell them
 * something they can ask for — which is worse than not announcing it. `status`
 * is polite by definition, and the tabular figures below keep the digits from
 * shifting the layout as they change.
 */
export function StatusBar({
  name,
  page,
  pageCount,
  zoom,
  onGoTo,
}: {
  /**
   * The document's name, as main stated it on `document.open`.
   *
   * Not derived here and not derivable: the renderer holds no path (L2), which
   * is why this crosses as its own field rather than being cut from one.
   */
  readonly name: string;
  /** Zero-based, as everything that crosses the contract is. */
  readonly page: number;
  readonly pageCount: number;
  /** The scale actually shown, which for a fit is what the scroller resolved. */
  readonly zoom: number;
  /** Takes the reader to a page. Zero-based, like every page that crosses. */
  readonly onGoTo: (page: number) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const [typed, setTyped] = useState('');
  const [outside, setOutside] = useState(false);
  const fieldId = useId();

  return (
    <footer className="m-status-bar" role="status" aria-label={i18n._(STATUS_LABEL)}>
      {/* FIRST, and at the far end of the bar the numbers are not at. A reader
          with two windows open checks which document this is; the page and the
          zoom are things they check while reading it. */}
      <span className="m-status-name" title={name}>
        {name}
      </span>
      <span className="m-status-page">
        {i18n._(STATUS_PAGE_OF, { page: pdfjsPageOf(page), count: pageCount })}
      </span>
      <form
        className="m-status-goto"
        onSubmit={(event) => {
          event.preventDefault();
          // THE ONE CONVERSION, and it is the reason this field exists in this
          // file rather than beside the scroller: a person types the number
          // they can see, which is PDF.js's, and `jumpTo` takes the kernel's.
          // `pageNumbering.ts` is where the two meet, and a `- 1` written here
          // would be the literal at the call site that a rotate already shipped
          // wrong once.
          const wanted = Number(typed);
          if (!Number.isInteger(wanted) || wanted < 1 || wanted > pageCount) {
            setOutside(true);
            return;
          }
          setOutside(false);
          setTyped('');
          onGoTo(kernelPageOf(wanted));
        }}
      >
        <label htmlFor={fieldId}>{i18n._(STATUS_GO_TO)}</label>
        <input
          id={fieldId}
          // `data-goto-input` so `view.go-to` can send the caret here without
          // this surface exporting a ref through the registry — see
          // `findCommand`, which reaches its field the same way and for the
          // same reason.
          data-goto-input="true"
          // `inputMode` rather than `type="number"`, whose spinner and
          // scroll-to-change behaviour are a hazard in a bar a reader scrolls
          // past. The value is validated on submit either way.
          inputMode="numeric"
          value={typed}
          aria-invalid={outside}
          onChange={(event) => {
            setTyped(event.target.value);
            // CLEARED ON EDIT. A refusal that stayed while the reader corrected
            // the number would still be on screen when they pressed Enter on a
            // page that exists.
            setOutside(false);
          }}
        />
      </form>
      {outside ? (
        <span className="m-status-problem">
          {i18n._(STATUS_GO_TO_OUTSIDE, { count: pageCount })}
        </span>
      ) : null}
      <span className="m-status-zoom">
        {/* ROUNDED FOR DISPLAY ONLY. A fit resolves to something like 1.3361,
            and a reader wants 134% — but the value shown is derived from the
            live scale rather than stored, so nothing downstream can pick up the
            rounding. */}
        {i18n._(STATUS_ZOOM, { percent: Math.round(zoom * 100) })}
      </span>
    </footer>
  );
}
