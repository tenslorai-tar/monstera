import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useId } from 'react';

import { PageList } from './PageList.js';
import { COMPARE_PICK, COMPARE_SAME, COMPARE_SECOND_LABEL } from './messages/en.js';
import { FIRST_PAGE } from './pageNumbering.js';
import type { RulerUnit } from './rulerGeometry.js';
import { useDocumentView } from './useDocumentView.js';
import type { ZoomMode } from './zoom.js';

/** One open document, as the picker needs to name it. */
export interface ComparableDocument {
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
  readonly name: string;
}

/**
 * The second pane, showing a DIFFERENT document beside the first.
 *
 * ## Why this is a second parser where split view is not
 *
 * Split view's whole property is that two viewports cost one parse: both panes
 * render through the same `DocumentView`, so the second costs one more set of
 * visible page bitmaps and no second worker or byte transport. That property
 * exists because both panes show the same document, and it cannot survive
 * comparison — two documents are two parses, and a design pretending otherwise
 * would be reading one document's pages through the other's parser.
 *
 * So the cost is stated rather than hidden: comparing doubles what §9.17's
 * renderer budget covers, for exactly as long as a reader has two documents
 * side by side. Reverting to *the same document* is one selection away and
 * releases the second view, because the hook closes what it opened.
 *
 * ## The picker is a NATIVE `select`, and that is a CSP decision
 *
 * `docs/FEATURES.md`'s design-substrate row records that Base UI injects a
 * `<style>` element in exactly `ScrollArea` and `SelectPopup` (1.7.0), which
 * invariant 27's `style-src 'self'` forbids — so whichever commit adds either
 * owes `CSPProvider disableStyleElements` or an argument. This is not that
 * commit: a native `select` is one control, styleable from tokens, and needs
 * no grant. The trigger stays unfired and the row stays owed.
 *
 * ## What it does NOT do
 *
 * It reports nothing back — no current page, no zoom, no page count — for the
 * split row's reason: those have one owner in `App`, and a second reporter
 * would make the status bar follow whichever pane moved last. Navigation and
 * zoom act on the first pane. This is the same limitation split view already
 * carries and the same clause closes both: *focus follows the pane*.
 */
export function ComparePane({
  client,
  against,
  others,
  onPick,
  mode,
  onZoom,
  loupe,
  rulers,
  showGrid,
  unit,
}: {
  readonly client: ContractClient;
  /** The document to show here, or `undefined` for a second view of the first. */
  readonly against: ComparableDocument | undefined;
  /** Every open document, as choices. Includes the one the first pane shows. */
  readonly others: readonly ComparableDocument[];
  readonly onPick: (docId: DocId | undefined) => void;
  readonly mode: ZoomMode;
  readonly onZoom: (next: (shown: number) => ZoomMode) => void;
  readonly loupe: boolean;
  readonly rulers: boolean;
  readonly showGrid: boolean;
  readonly unit: RulerUnit;
}): ReactElement {
  const { _ } = useLingui();
  const pickerId = useId();

  return (
    <div className="m-compare">
      <label className="m-compare-pick" htmlFor={pickerId}>
        {_(COMPARE_PICK)}
        <select
          id={pickerId}
          data-compare-pick="true"
          // THE EMPTY STRING IS *the same document*, and it is a value rather
          // than an absent option: a picker whose "no comparison" state is the
          // absence of a selection cannot be returned to.
          value={against?.docId ?? ''}
          onChange={(event) => {
            onPick(event.target.value === '' ? undefined : (event.target.value as DocId));
          }}
        >
          <option value="">{_(COMPARE_SAME)}</option>
          {others.map((document) => (
            <option key={document.docId} value={document.docId}>
              {document.name}
            </option>
          ))}
        </select>
      </label>
      {against === undefined ? null : (
        <CompareView
          client={client}
          against={against}
          mode={mode}
          onZoom={onZoom}
          loupe={loupe}
          rulers={rulers}
          showGrid={showGrid}
          unit={unit}
        />
      )}
    </div>
  );
}

/** Nothing. A compared document's version moving is the FIRST pane's business. */
const ignoreVersion = (): void => undefined;
const ignorePage = (_page: number): void => undefined;
const ignoreZoom = (_shown: number): void => undefined;
const ignoreWentTo = (): void => undefined;

/**
 * The compared document's own scroller, over its own parser.
 *
 * A separate component so {@link useDocumentView} is called unconditionally:
 * the pane renders no view when nothing is being compared, and a hook behind
 * an `if` is not a hook.
 */
function CompareView({
  client,
  against,
  mode,
  onZoom,
  loupe,
  rulers,
  showGrid,
  unit,
}: {
  readonly client: ContractClient;
  readonly against: ComparableDocument;
  readonly mode: ZoomMode;
  readonly onZoom: (next: (shown: number) => ZoomMode) => void;
  readonly loupe: boolean;
  readonly rulers: boolean;
  readonly showGrid: boolean;
  readonly unit: RulerUnit;
}): ReactElement {
  const { _ } = useLingui();
  // THE MODULE CONSTANT DIRECTLY, not wrapped in `useCallback`. Its identity is
  // already stable, which is what the hook's effect needs — and the compiler's
  // rule that a memo takes an inline function is right: memoizing a value that
  // never changes is ceremony that hides where the stability comes from.
  const { ready, failed } = useDocumentView(client, against, ignoreVersion);

  if (failed) return <canvas className="m-page" data-failed="true" />;
  if (ready === undefined) return <div className="m-page-list" />;

  return (
    <PageList
      client={client}
      view={ready}
      pageCount={ready.document.numPages}
      docId={against.docId}
      version={against.version}
      onCurrentPage={ignorePage}
      mode={mode}
      onZoom={onZoom}
      onShownZoom={ignoreZoom}
      goTo={undefined}
      startAt={FIRST_PAGE.kernel}
      onWentTo={ignoreWentTo}
      loupe={loupe}
      rulers={rulers}
      showGrid={showGrid}
      unit={unit}
      // NAMED WITH THE DOCUMENT, not "second view": two scrollable regions a
      // screen-reader user cannot tell apart is what the split row's label
      // exists to prevent, and here they hold different documents, so the name
      // has something true to say.
      label={COMPARE_SECOND_LABEL}
      labelValues={{ name: against.name }}
    />
  );
}
