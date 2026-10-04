import { Menu } from '@base-ui/react/menu';
import { useLingui } from '@lingui/react';
import type { DocId } from '@monstera/shared';
import { type ReactElement, useLayoutEffect, useRef, useState } from 'react';

import { TAB_ALL_DOCUMENTS, TAB_CLOSE, TAB_OPEN_ANOTHER, TAB_STRIP_LABEL, TAB_UNSAVED } from '../messages/en.js';
import { Icon } from '../primitives/Icon.js';
import { MenuArea, type MenuAt } from './ContextMenu.js';
import { type StripMeasure, tabCapacity, tabsShown } from './tabFit.js';

/** One open document, as the strip needs to draw it. */
export interface DocumentTab {
  readonly docId: DocId;
  readonly name: string;
  /**
   * Whether this document holds changes its file does not.
   *
   * Resolved by the caller from `savedState`, which the status bar also reads — one comparison
   * of main's two version numbers, not one per surface, so a tab can never show a dot beside a
   * bar saying *Saved* (B3a).
   */
  readonly dirty: boolean;
}

/** A gap as computed, or none where the style names none. */
function gapOf(element: Element): number {
  const gap = Number.parseFloat(getComputedStyle(element).columnGap);
  return Number.isFinite(gap) ? gap : 0;
}

/**
 * The row's width and the sizes it is divided by, read from the drawn strip: the narrowest tab from its token, an
 * end control from the *open another* button as drawn (the list button is drawn the same), the gap between tabs from
 * the list and the gap before each control from the strip. `null` before the first layout, or where nothing has a
 * width, so the row is never cut to fit a measure of nothing.
 */
function measured(strip: HTMLElement): StripMeasure | null {
  const minimumTab = Number.parseFloat(getComputedStyle(strip).getPropertyValue('--title-tab-min'));
  const control = strip.querySelector<HTMLElement>('[data-tab-open]')?.offsetWidth ?? 0;
  const list = strip.querySelector('.m-tab-list');
  const available = strip.clientWidth;
  if (!(available > 0 && minimumTab > 0 && control > 0) || list === null) return null;
  return { available, minimumTab, control, tabGap: gapOf(list), controlGap: gapOf(strip) };
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
 *
 * ## A FULL ROW SHRINKS, then LISTS, and never scrolls (Part A1)
 *
 * As a browser's does: every tab shrinks alike to `--title-tab-min`, where its name takes an ellipsis and its glyph
 * and close stay; past that the row draws as many as it holds, always the current one among them (`tabFit.ts`),
 * and a button at its end lists every open document. A row that scrolled instead put a scroll bar in the title bar
 * and let the current tab slide out of view.
 */
export function DocumentTabs({
  tabs,
  activeId,
  onSelect,
  onClose,
  onOpen,
  menuAt,
}: {
  /**
   * The tab context menu (§7) for the tab a right-click lands on, built by the shell so the strip never names the
   * registry. ONE menu around the list (`MenuArea`), which reads the tab from its own `data-tab` when the right-click
   * happens — never one per tab, rebuilt with every render of the window.
   */
  readonly menuAt: MenuAt<DocId>;
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
  const strip = useRef<HTMLElement | null>(null);
  // THE ROW'S MEASURE, read again whenever the row's width changes: a window resized, a pane opened beside the bar.
  const [measure, setMeasure] = useState<StripMeasure | null>(null);
  const hasTabs = tabs.length > 0;
  useLayoutEffect(() => {
    const element = strip.current;
    if (element === null || !hasTabs) return undefined;
    const read = (): void => {
      setMeasure(measured(element));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasTabs]);

  // NOTHING WITH NO DOCUMENTS, for `QuickToolbar`'s reason: an empty strip over
  // the start screen is a control that describes nothing.
  if (!hasTabs) return null;

  // EVERY TAB until the row has been measured, and wherever it cannot be: the shrinking alone keeps a row that fits.
  const capacity = measure === null ? tabs.length : tabCapacity(measure, tabs.length);
  const current = tabs.findIndex((tab) => tab.docId === activeId);
  const drawn = tabsShown(tabs.length, current, capacity).flatMap((at) => {
    const tab = tabs[at];
    return tab === undefined ? [] : [tab];
  });
  const listed = drawn.length < tabs.length;

  // THE TAB A TARGET SITS IN, read from the row's own `data-tab` and answered as this strip's own `DocId`, so a mark
  // naming no open document is no tab.
  const tabAt = (target: EventTarget | null): DocId | undefined => {
    const row = target instanceof Element ? target.closest<HTMLElement>('[data-tab]') : null;
    return tabs.find((tab) => tab.docId === row?.dataset['tab'])?.docId;
  };

  return (
    <nav className="m-tabs" aria-label={_(TAB_STRIP_LABEL)} ref={strip}>
      {/* AROUND THE LIST, so the list keeps list items as its only children; the area adds no box. */}
      <MenuArea keyAt={tabAt} menuAt={menuAt}>
      <ul className="m-tab-list">
        {drawn.map((tab) => {
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
                {/* THE DOT, INSIDE the name button and before the name, so it moves with the
                    text rather than sitting in a column that is empty on every clean tab. It
                    is `aria-hidden` with a worded companion beside it: a screen reader hears
                    "Unsaved changes" and never a bullet character, and the pair is what stops
                    the state being carried by colour and shape alone (§10.6). */}
                {/* v5-02's document glyph at the tab's start; decorative, since the name beside it
                    is the button's text (`Icon`). */}
                <Icon name="FileText" size="dense" />
                {tab.dirty ? (
                  <>
                    <span aria-hidden className="m-tab-dot" />
                    <span className="m-visually-hidden">{_(TAB_UNSAVED)}</span>
                  </>
                ) : null}
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
      </MenuArea>
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
      {/* EVERY OPEN DOCUMENT, at the row's end, only where the row could not draw them all: the ones it left out are
          reached here, in the strip's own order, the current one marked. A Base UI menu, `ChoiceMenu`'s reason. */}
      {listed ? (
        <Menu.Root>
          <Menu.Trigger
            aria-label={_(TAB_ALL_DOCUMENTS, { count: tabs.length })}
            className="m-tab-open m-tab-all"
            data-tab-all=""
          >
            <Icon name="ChevronDown" size="dense" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="end" side="bottom" sideOffset={4}>
              <Menu.Popup className="m-context-menu m-choice-menu__popup m-tab-all__popup">
                <Menu.RadioGroup
                  value={activeId ?? ''}
                  onValueChange={(next: unknown) => {
                    // A DOCUMENT FROM THE STRIP ONLY: Base UI types a radio's value as `unknown`.
                    const picked = tabs.find((tab) => tab.docId === next);
                    if (picked !== undefined) onSelect(picked.docId);
                  }}
                >
                  <Menu.GroupLabel className="m-choice-menu__heading">{_(TAB_STRIP_LABEL)}</Menu.GroupLabel>
                  {tabs.map((tab) => (
                    <Menu.RadioItem
                      className="m-context-menu-item"
                      closeOnClick
                      data-tab-listed={tab.docId}
                      key={tab.docId}
                      label={tab.name}
                      value={tab.docId}
                    >
                      <Menu.RadioItemIndicator className="m-choice-menu__mark" keepMounted>
                        {tab.docId === activeId ? <Icon name="Check" size="dense" /> : null}
                      </Menu.RadioItemIndicator>
                      {/* ONE ENTRY in the item's second column, the mark in its first (`ChoiceMenu`'s grid). */}
                      <span className="m-tab-all__entry">
                        <Icon name="FileText" size="dense" />
                        {tab.dirty ? (
                          <>
                            <span aria-hidden className="m-tab-dot" />
                            <span className="m-visually-hidden">{_(TAB_UNSAVED)}</span>
                          </>
                        ) : null}
                        <span className="m-tab-all__name">{tab.name}</span>
                      </span>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : null}
    </nav>
  );
}
