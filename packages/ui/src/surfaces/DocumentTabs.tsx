import { useLingui } from '@lingui/react';
import type { DocId } from '@monstera/shared';
import type { ReactElement } from 'react';

import { TAB_CLOSE, TAB_OPEN_ANOTHER, TAB_STRIP_LABEL } from '../messages/en.js';

/** One open document, as the strip needs to draw it. */
export interface DocumentTab {
  readonly docId: DocId;
  readonly name: string;
}

/**
 * The open documents, as a tab strip.
 *
 * ## NOT A PROJECTION OF THE COMMAND REGISTRY, and that is the distinction
 *
 * The ribbon, the palette and the quick toolbar are projections: what appears
 * is whatever is registered. This is not one, for `RecentFiles`' reason — an
 * open document is **data with controls**, not a registered command, and
 * registering one command per open file would mean rebuilding the registry
 * every time somebody opened a document. §7's rule is that there is no second
 * place a FEATURE is wired; a list of the reader's own documents is not a
 * feature list.
 *
 * ## A NAVIGATION LIST, and `role="tablist"` was written here and removed
 *
 * The obvious markup is `tablist`/`tab`, and it was the first version. Two
 * things make it the wrong claim rather than the natural one, and both are
 * properties of what is actually built:
 *
 * - **ARIA says a `tab`'s children are presentational**, so the close button
 *   inside each tab is a focusable descendant of a role that declares it has
 *   none. Moving the close outside the tab is not available either: a
 *   `tablist` may contain only `tab` children, and the strip needs a close
 *   control per document and one *open another* control at the end.
 * - **`tab` promises arrow-key rotation with a roving tabindex**, and this
 *   strip implements none. A role announcing a keyboard model the component
 *   does not have leaves a screen-reader user pressing keys that do nothing —
 *   which is worse than plain buttons, because plain buttons promise nothing
 *   they do not deliver.
 *
 * So it is a `nav` with a list of buttons and `aria-current` on the one
 * showing. That is what this component is: a set of controls that change which
 * document the application is about. The name on the region is what a
 * screen-reader user navigates to.
 *
 * Recorded rather than left as a shape somebody re-derives: *use tablist* is
 * the first thing a reader will think, and the reason not to is not visible
 * from the markup.
 *
 * ## The close control's name carries the file
 *
 * A strip whose only affordance is *select* leaves closing to a menu nobody
 * finds. The accessible name is *Close annual.pdf* rather than *Close*: six
 * identical *Close* buttons are six controls a screen-reader user cannot tell
 * apart.
 *
 * A single tab still shows its close control. Hiding it would make the last
 * document the one you cannot put down, and *close the only open file* is an
 * ordinary thing to want — the start screen is where it lands.
 */
export function DocumentTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onOpen,
}: {
  readonly tabs: readonly DocumentTab[];
  readonly activeId: DocId | undefined;
  readonly onSelect: (docId: DocId) => void;
  readonly onClose: (docId: DocId) => void;
  /**
   * Opens another document — the registered command's own `run`.
   *
   * The strip does not know how a document is opened and must not: what it
   * carries is a trigger for the one implementation, the same way the start
   * screen's projection does.
   */
  readonly onOpen: () => void;
}): ReactElement | null {
  const { _ } = useLingui();

  // NOTHING WITH NO DOCUMENTS, for `QuickToolbar`'s reason: an empty strip over
  // the start screen is a control that describes nothing.
  if (tabs.length === 0) return null;

  return (
    <nav className="m-tabs" aria-label={_(TAB_STRIP_LABEL)}>
      <ul className="m-tab-list">
        {tabs.map((tab) => {
          const showing = tab.docId === activeId;
          return (
            <li
              key={tab.docId}
              className={showing ? 'm-tab m-tab-current' : 'm-tab'}
              data-tab={tab.docId}
            >
              <button
                type="button"
                className="m-tab-name"
                data-tab-select={tab.docId}
                // WHICH DOCUMENT IS SHOWING, on the control rather than on the
                // row: `aria-current` belongs to the thing a reader activates.
                aria-current={showing ? 'true' : undefined}
                // The whole name, for the pointer: the visible one is ellipsed
                // when the strip is crowded, and a shortened name is exactly
                // what a reader checking which document this is cannot use.
                title={tab.name}
                // NOT `disabled` WHEN SHOWING. A disabled control is one a
                // keyboard user cannot land on, so the current document would
                // be the one whose name they could not read. Selecting the
                // document you are on is a no-op the store already ignores.
                onClick={() => {
                  onSelect(tab.docId);
                }}
              >
                {tab.name}
              </button>
              <button
                type="button"
                className="m-tab-close"
                data-tab-close={tab.docId}
                aria-label={_(TAB_CLOSE, { name: tab.name })}
                onClick={() => {
                  onClose(tab.docId);
                }}
              >
                {/* A GLYPH, and it is not an emoji icon: §10.4 bans those. The
                    multiplication sign is the character every close control in
                    every application already is, and the button's accessible
                    name is what a screen reader announces. */}
                {'×'}
              </button>
            </li>
          );
        })}
      </ul>
      {/* OUTSIDE THE LIST, because it is not one of the documents. */}
      <button
        type="button"
        className="m-tab-open"
        data-tab-open="true"
        aria-label={_(TAB_OPEN_ANOTHER)}
        onClick={onOpen}
      >
        {'+'}
      </button>
    </nav>
  );
}
