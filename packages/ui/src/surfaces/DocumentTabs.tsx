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
 * ## `tablist` and not a row of buttons
 *
 * Each tab selects which document the whole application is about, which is
 * what the tab role means and what makes arrow-key navigation and the
 * *selected* state available to a screen reader for free. The strip carries an
 * accessible name because a page with an unnamed landmark-like region is one a
 * screen-reader user cannot navigate to by name.
 *
 * **There is no `tabpanel`.** The panel a tab selects is the entire document
 * surface — the scroller, the panels, the status bar — and wrapping all of it
 * in one would put a role on the application rather than on a region. What
 * `aria-controls` would point at does not exist as a single element, and a
 * pointer to a wrong element is worse than an absent one.
 *
 * ## The close control is a BUTTON INSIDE THE TAB, and its name carries the file
 *
 * A tab whose only affordance is *select* leaves closing to a menu nobody
 * finds. Nesting a button inside a `tab` is the shape every editor uses, and
 * the accessible name is *Close annual.pdf* rather than *Close*: a strip of
 * six identical *Close* buttons is six controls a screen-reader user cannot
 * tell apart.
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
    <div className="m-tabs" role="tablist" aria-label={_(TAB_STRIP_LABEL)}>
      {tabs.map((tab) => {
        const selected = tab.docId === activeId;
        return (
          <div
            key={tab.docId}
            className={selected ? 'm-tab m-tab-current' : 'm-tab'}
            role="tab"
            aria-selected={selected}
            data-tab={tab.docId}
          >
            <button
              type="button"
              className="m-tab-name"
              data-tab-select={tab.docId}
              // The whole name, for the pointer: the visible one is ellipsed
              // when the strip is crowded, and a shortened name is exactly what
              // a reader checking which document a tab is cannot use.
              title={tab.name}
              // NOT `disabled` WHEN SELECTED. A disabled control is one a
              // keyboard user cannot land on, so the current tab would be the
              // one they could not read the name of. Selecting the tab you are
              // on is a no-op the store already ignores.
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
          </div>
        );
      })}
      {/* OUTSIDE THE TABS AND INSIDE THE STRIP, with no `tab` role: it selects
          nothing, so a role that says it does would put a control in the
          arrow-key rotation that never becomes the selected one. */}
      <button
        type="button"
        className="m-tab-open"
        data-tab-open="true"
        aria-label={_(TAB_OPEN_ANOTHER)}
        onClick={onOpen}
      >
        {'+'}
      </button>
    </div>
  );
}
