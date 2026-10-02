import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { X } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, type ReactNode, useId, useState } from 'react';

import {
  SPLIT_BOTH,
  SPLIT_BOTH_BACK,
  SPLIT_BOTH_FORWARD,
  SPLIT_CLOSE,
  SPLIT_HALF_PAGE,
  SPLIT_LEFT_PAGE,
  SPLIT_OF,
  SPLIT_RIGHT_PAGE,
  SPLIT_TITLE,
} from './messages/en.js';
import { kernelPageOf, pdfjsPageOf } from './pageNumbering.js';
import { Icon } from './primitives/Icon.js';
import { IconButton } from './primitives/IconButton.js';

/**
 * Split view: ONE document, two pages side by side, each half chosen on its own — the owner's design from the old
 * app's split panel (FEATURES row 65), in this app's tokens and primitives.
 *
 * ## What this component owns, and what it does not
 *
 * The header and the two halves' frames. It does NOT own a parser or a page: each half is a page list the caller
 * renders over the SAME `DocumentView` (row 65's one-parser property), passed in as `left` and `right`, and the pages
 * those lists show are the caller's state, which this reads and asks to change. So the header is one more writer of
 * a request, never a second owner of the page on show.
 *
 * ## Pages are typed as a person reads them and held as the kernel counts them
 *
 * The boxes show and accept the number on screen; `pageNumbering.ts` converts in one place each way, so the header
 * and the status bar's page field cannot disagree about which page *4* is.
 *
 * ## Esc closes it, from anywhere inside
 *
 * A key handler on the view's own box rather than a window listener: a dialog or menu opened over the document owns
 * its Esc, and a split that closed underneath an open menu would be two things closing at once.
 */
export function SplitView({
  pageCount,
  left,
  right,
  leftPage,
  rightPage,
  onLeftPage,
  onRightPage,
  onClose,
}: {
  readonly pageCount: number;
  /** The left half's page list, over the document's one view. */
  readonly left: ReactNode;
  /** The right half's page list, over the same view. */
  readonly right: ReactNode;
  /** The page each half shows, zero-based as the kernel counts. */
  readonly leftPage: number;
  readonly rightPage: number;
  /** Asks a half to show a page, zero-based. The caller decides; this only asks. */
  readonly onLeftPage: (page: number) => void;
  readonly onRightPage: (page: number) => void;
  readonly onClose: () => void;
}): ReactElement {
  const { i18n } = useLingui();
  const last = pageCount - 1;
  // BOTH MOVE TOGETHER, one page, and stop at the ends: a step that moved one side and not the other would no longer
  // be "both", so it is disabled the moment either side has nowhere to go.
  const canBack = leftPage > 0 && rightPage > 0;
  const canForward = leftPage < last && rightPage < last;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  return (
    <section aria-label={i18n._(SPLIT_TITLE)} className="m-split" data-split-view="" onKeyDown={onKeyDown}>
      <header className="m-split__bar">
        <span className="m-split__title">{i18n._(SPLIT_TITLE)}</span>
        <PageNumberField label={SPLIT_LEFT_PAGE} page={leftPage} pageCount={pageCount} onPage={onLeftPage} side="left" />
        <PageNumberField label={SPLIT_RIGHT_PAGE} page={rightPage} pageCount={pageCount} onPage={onRightPage} side="right" />
        <span className="m-split__of">{i18n._(SPLIT_OF, { count: pageCount })}</span>
        <span className="m-split__spacer" />
        <button
          aria-label={i18n._(SPLIT_BOTH_BACK)}
          className="m-split__both"
          data-split-both="back"
          disabled={!canBack}
          onClick={() => {
            onLeftPage(leftPage - 1);
            onRightPage(rightPage - 1);
          }}
          type="button"
        >
          <Icon name="ChevronLeft" size="dense" />
          {i18n._(SPLIT_BOTH)}
        </button>
        <button
          aria-label={i18n._(SPLIT_BOTH_FORWARD)}
          className="m-split__both"
          data-split-both="forward"
          disabled={!canForward}
          onClick={() => {
            onLeftPage(leftPage + 1);
            onRightPage(rightPage + 1);
          }}
          type="button"
        >
          {i18n._(SPLIT_BOTH)}
          <Icon name="ChevronRight" size="dense" />
        </button>
        <IconButton icon={X} label={SPLIT_CLOSE} onClick={onClose} size="dense" />
      </header>
      <div className="m-split__halves">
        <div className="m-split__half" data-split-half="left">
          <span className="m-split__label">{i18n._(SPLIT_HALF_PAGE, { page: pdfjsPageOf(leftPage) })}</span>
          {left}
        </div>
        <div className="m-split__half" data-split-half="right">
          <span className="m-split__label">{i18n._(SPLIT_HALF_PAGE, { page: pdfjsPageOf(rightPage) })}</span>
          {right}
        </div>
      </div>
    </section>
  );
}

/**
 * One half's page box: the page on show, editable, sent on Enter or when the field is left.
 *
 * `inputMode` rather than `type="number"`, the status bar's reason: a spinner and scroll-to-change in a bar a reader
 * scrolls past move the page by accident. A number outside the document is not sent; the field shows the page on
 * show again, so a box never names a page that is not there.
 */
function PageNumberField({
  label,
  page,
  pageCount,
  onPage,
  side,
}: {
  readonly label: MessageKey;
  readonly page: number;
  readonly pageCount: number;
  readonly onPage: (page: number) => void;
  readonly side: 'left' | 'right';
}): ReactElement {
  const { i18n } = useLingui();
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const send = (): void => {
    if (typed === null) return;
    const wanted = Number(typed);
    setTyped(null);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > pageCount) return;
    onPage(kernelPageOf(wanted));
  };
  return (
    <span className="m-split__field">
      <label htmlFor={id}>{i18n._(label)}</label>
      <input
        className="m-split__page"
        data-split-page={side}
        id={id}
        inputMode="numeric"
        onBlur={send}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        onFocus={(event) => {
          event.target.select();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            send();
          } else if (event.key === 'Escape' && typed !== null) {
            // ESC IN A FIELD BEING EDITED PUTS THE PAGE BACK, and is spent there: the view closes on the next Esc.
            event.preventDefault();
            setTyped(null);
          }
        }}
        value={typed ?? String(pdfjsPageOf(page))}
      />
    </span>
  );
}
