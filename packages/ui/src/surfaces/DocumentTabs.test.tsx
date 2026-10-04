// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type DocId, asDocId } from '@monstera/shared';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentTabs } from './DocumentTabs.js';
import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';

const FIRST = asDocId('00000000-0000-4000-8000-00000000000a');
const SECOND = asDocId('00000000-0000-4000-8000-00000000000b');

// ONE OF EACH, and that is the fixture doing work: two clean tabs cannot tell a strip that
// draws a dot per dirty document from one that draws none, and two dirty ones cannot tell it
// from one that dots every tab. The dirty one is also NOT the showing one, so a strip that
// keyed the dot on `activeId` is red as well.
const TABS = [
  { docId: FIRST, name: 'annual.pdf', dirty: true },
  { docId: SECOND, name: 'notes.pdf', dirty: false },
];

const NOTHING = {
  onSelect: (): void => undefined,
  onClose: (): void => undefined,
  onOpen: (): void => undefined,
  menuAt: (): undefined => undefined,
};

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** The one element a selector must find, or a named failure. */
function only<T extends Element>(container: HTMLElement, selector: string, kind: new () => T): T {
  const found = container.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`the strip renders ${selector}`);
  return found;
}

describe('DocumentTabs', () => {
  it('renders one tab per document and marks the SHOWING one', () => {
    // TWO TABS AND THE SECOND SHOWING. A fixture with one tab cannot tell a
    // strip that marks the active document from one that marks every tab, and
    // marking the FIRST cannot tell it from one that marks index 0.
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={SECOND} />
      </Wrapped>,
    );

    const rows = container.querySelectorAll('.m-tab');
    expect(rows).toHaveLength(2);
    expect(container.querySelector('.m-tab-current')?.getAttribute('data-tab')).toBe(SECOND);
    // `aria-current` ON THE CONTROL, and on exactly one of them. NOT
    // `role="tab"`: that role's children are declared presentational, which
    // the close button inside each row contradicts, and it promises arrow-key
    // rotation this strip does not implement — see the component's header.
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('data-tab-select')).toBe(SECOND);
  });

  it('DOTS the document with unsaved changes, and only that one', () => {
    // The owner could not tell whether Ctrl+S had worked, and this is the half of the answer
    // that is still on screen a minute later. `TABS` is one dirty and one clean, so this
    // separates a per-document dot from one drawn on every tab or on the active one.
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={SECOND} />
      </Wrapped>,
    );

    const dots = container.querySelectorAll('.m-tab-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]?.closest('.m-tab')?.getAttribute('data-tab')).toBe(FIRST);
    // AND IT IS NOT CARRIED BY THE SHAPE ALONE. The dot is `aria-hidden`, so without the
    // worded companion a screen reader hears nothing at all — which is the same defect as
    // the silent save, one population along (§10.6).
    expect(container.textContent).toContain('Unsaved changes');
  });

  it('SELECTS BY DOCUMENT ID, not by position', () => {
    // The separating assertion. An id and an index agree on the first tab for
    // ever, and they stop agreeing the moment a tab before it closes — at
    // which point an index-dispatching strip switches to a different document
    // than the one under the pointer, silently.
    const selected = vi.fn();
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={FIRST} onSelect={selected} />
      </Wrapped>,
    );

    only(container, `[data-tab-select="${SECOND}"]`, HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledWith(SECOND);
  });

  it('offers a close control on EVERY tab, named with the file it closes', () => {
    // Two things at once, and both are a11y rather than decoration: a strip of
    // identical "Close" buttons is a strip a screen-reader user cannot
    // navigate, and hiding the control on the last tab would make the only
    // open document the one that cannot be put down.
    const closed = vi.fn();
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={TABS} activeId={FIRST} onClose={closed} />
      </Wrapped>,
    );

    const control = only(container, `[data-tab-close="${SECOND}"]`, HTMLButtonElement);
    expect(control.getAttribute('aria-label')).toBe('Close notes.pdf');
    control.click();

    expect(closed).toHaveBeenCalledWith(SECOND);
    expect(container.querySelectorAll('[data-tab-close]')).toHaveLength(2);
  });

  it('renders NOTHING with no documents open', () => {
    // The control for every case above: an empty strip over the start screen
    // is a region that describes nothing, and a `tablist` with no tabs is one
    // a screen reader still announces.
    const { container } = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={[]} activeId={undefined} />
      </Wrapped>,
    );

    expect(container.querySelector('.m-tabs')).toBeNull();
  });

  it('asks the menu for THAT tab’s document when a tab’s control is right-clicked, through ONE menu (§7)', () => {
    // The tab menu acts on the document it is asked for, so a strip that asked for the active document
    // from every tab would close the one on show from any tab's *Close*. The active tab here is the
    // SECOND, so a strip asking for the active id each time is red.
    const asked: DocId[] = [];
    const { container } = render(
      <Wrapped>
        <DocumentTabs
          {...NOTHING}
          tabs={TABS}
          activeId={SECOND}
          menuAt={(docId) => {
            asked.push(docId);
            return undefined;
          }}
        />
      </Wrapped>,
    );

    fireEvent.contextMenu(only(container, `[data-tab-select="${FIRST}"]`, HTMLButtonElement));
    fireEvent.contextMenu(only(container, `[data-tab-close="${SECOND}"]`, HTMLButtonElement));
    expect(asked).toStrictEqual([FIRST, SECOND]);
    // ONE MENU FOR THE STRIP, never one per tab — and the list keeps `<li>` as its only children.
    expect(container.querySelectorAll('.m-context-menu-region')).toHaveLength(1);
    expect([...container.querySelectorAll('.m-tab-list > *')].every((child) => child.tagName === 'LI')).toBe(true);
  });
});

describe('DocumentTabs on a full row (Part A1)', () => {
  const SIX = Array.from({ length: 6 }, (_, at) => ({
    docId: asDocId(`00000000-0000-4000-8000-00000000010${String(at)}`),
    name: `document ${String(at)}.pdf`,
    dirty: false,
  }));

  /** The strip drawn in a row `width` wide, with the narrowest tab 112 and each end control 24, as measured. */
  function drawnIn(width: number, activeId: DocId, onSelect: (docId: DocId) => void = () => undefined) {
    const sized = (element: unknown, property: 'clientWidth' | 'offsetWidth'): number => {
      if (!(element instanceof HTMLElement)) return 0;
      if (property === 'clientWidth' && element.classList.contains('m-tabs')) return width;
      if (property === 'offsetWidth' && element.hasAttribute('data-tab-open')) return 24;
      return 0;
    };
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return sized(this, 'clientWidth');
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return sized(this, 'offsetWidth');
    });
    // THE STRIP'S COMPUTED STYLE, as the stylesheet makes it: this DOM has no layout and does not resolve an inherited
    // custom property, so the token and the gaps are stated for the two elements the strip measures.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const measuredHere = element instanceof HTMLElement && (element.classList.contains('m-tabs') || element.classList.contains('m-tab-list'));
      if (!measuredHere) return computed(element, pseudo);
      const style = { columnGap: '0px', getPropertyValue: (name: string) => (name === '--title-tab-min' ? '112px' : '') };
      return style as unknown as CSSStyleDeclaration;
    });
    const view = render(
      <Wrapped>
        <DocumentTabs {...NOTHING} tabs={SIX} activeId={activeId} onSelect={onSelect} />
      </Wrapped>,
    );
    return {
      view,
      drawn: () => [...view.container.querySelectorAll('.m-tab')].map((tab) => tab.getAttribute('data-tab')),
    };
  }

  // EVERY SPY GOES, whatever a case did, so a case that throws cannot leave the next one measuring through it.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('DRAWS what fits, the current document among them in its own place, and lists every one from the row’s end', () => {
    const selected: DocId[] = [];
    const last = SIX[5]?.docId ?? FIRST;
    const strip = drawnIn(400, last, (docId) => selected.push(docId));
    // 400 holds three narrowest tabs beside the two end controls (3 * 112 = 336 of 352), so the sixth, which is
    // showing, takes the third place.
    expect(strip.drawn()).toStrictEqual([SIX[0]?.docId, SIX[1]?.docId, last]);
    const list = only(strip.view.container, '[data-tab-all]', HTMLButtonElement);
    expect(list.getAttribute('aria-label')).toBe('Show all 6 open documents');

    fireEvent.click(list);
    const listed = [...document.querySelectorAll('[data-tab-listed]')].map((item) => item.getAttribute('data-tab-listed'));
    // EVERY DOCUMENT, in the strip's order, the ones the row left out among them.
    expect(listed).toStrictEqual(SIX.map((tab) => tab.docId));
    const fourth = document.querySelector(`[data-tab-listed="${SIX[3]?.docId ?? ''}"]`);
    if (!(fourth instanceof HTMLElement)) throw new Error('the list draws the fourth document');
    fireEvent.click(fourth);
    expect(selected).toStrictEqual([SIX[3]?.docId]);
  });

  it('CONTROL: a row wide enough draws every tab and no list button', () => {
    const strip = drawnIn(2000, SIX[5]?.docId ?? FIRST);
    expect(strip.drawn()).toStrictEqual(SIX.map((tab) => tab.docId));
    expect(strip.view.container.querySelector('[data-tab-all]')).toBeNull();
  });
});
