// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import type { CommandOfKind } from '@monstera/contract';
import { asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LinkSelection } from './annotations/selectTool.js';
import { LinkProperties } from './LinkProperties.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { panelControlsOutsideCards } from './propertyCards.js';

afterEach(() => {
  // EVERY VIEW A CASE RENDERED, every property group in a card (Addendum 3, `propertyCards.ts`).
  expect(panelControlsOutsideCards(document)).toStrictEqual([]);
  cleanup();
});

/**
 * The Properties tab for a selected link (the owner's O6(c)): it shows where the link goes, and a change is ONE
 * `editLink` naming the link's place at the selection's version, with the page counted as the kernel counts pages.
 */

const VERSION = asDocVersion(8);
const TO_PAGE_3: LinkSelection = {
  page: 1,
  version: VERSION,
  index: 2,
  link: { kind: 'internal', page: 2, bounds: { x0: 0, y0: 0, x1: 10, y1: 10 }, outline: 'thin' },
};
const TO_SITE: LinkSelection = {
  page: 1,
  version: VERSION,
  index: 0,
  link: { kind: 'external', uri: 'https://example.org/', bounds: { x0: 0, y0: 0, x1: 10, y1: 10 }, outline: 'thin' },
};

function mount(selected: LinkSelection) {
  activateCatalogue('en', EN);
  const onEdit = vi.fn<(command: CommandOfKind<'editLink'>) => void>();
  const onFollow = vi.fn();
  const view = render(
    <I18nProvider i18n={i18n}>
      <LinkProperties onEdit={onEdit} onFollow={onFollow} pageCount={5} selected={selected} />
    </I18nProvider>,
  );
  const apply = () => view.getByRole('button', { name: 'Change where it goes' });
  return { view, onEdit, onFollow, apply };
}

describe('LinkProperties', () => {
  it('SHOWS where a page link goes, as a person counts pages', () => {
    const { view } = mount(TO_PAGE_3);
    expect((view.getByRole('textbox', { name: 'Page number' }) as HTMLInputElement).value).toBe('3');
  });

  it('a page typed and applied sends ONE editLink: that link’s place, its version, the page counted from 0', () => {
    const { view, onEdit, apply } = mount(TO_PAGE_3);
    fireEvent.change(view.getByRole('textbox', { name: 'Page number' }), { target: { value: '5' } });
    fireEvent.click(apply());
    expect(onEdit.mock.calls).toStrictEqual([[{ kind: 'editLink', page: 1, index: 2, target: { kind: 'page', page: 4 }, version: VERSION }]]);
  });

  it('a page link made a WEB link sends the address typed', () => {
    const { view, onEdit, apply } = mount(TO_PAGE_3);
    fireEvent.click(view.getByRole('button', { name: 'A web address' }));
    fireEvent.change(view.getByRole('textbox', { name: 'Address' }), { target: { value: ' https://example.org/new ' } });
    fireEvent.click(apply());
    expect(onEdit.mock.calls).toStrictEqual([[{ kind: 'editLink', page: 1, index: 2, target: { kind: 'uri', uri: 'https://example.org/new' }, version: VERSION }]]);
  });

  it('REFUSES a page the document lacks and an address no reader could follow, in words, and sends nothing', () => {
    const page = mount(TO_PAGE_3);
    fireEvent.change(page.view.getByRole('textbox', { name: 'Page number' }), { target: { value: '6' } });
    fireEvent.click(page.apply());
    expect(page.view.getByRole('alert').textContent).toBe('Choose a page of this document, from 1 to 5.');
    expect(page.onEdit).not.toHaveBeenCalled();
    page.view.unmount();
    const site = mount(TO_SITE);
    fireEvent.change(site.view.getByRole('textbox', { name: 'Address' }), { target: { value: 'not an address' } });
    fireEvent.click(site.apply());
    expect(site.view.getByRole('alert')).toBeTruthy();
    expect(site.onEdit).not.toHaveBeenCalled();
  });

  it('CONTROL: the target it already has is NO change, so the button is off and nothing is sent', () => {
    const { onEdit, apply } = mount(TO_SITE);
    expect((apply() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(apply());
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Follow link hands that link to the one follow route', () => {
    const { view, onFollow } = mount(TO_SITE);
    fireEvent.click(view.getByRole('button', { name: 'Follow link' }));
    expect(onFollow).toHaveBeenCalledWith({ page: 1, index: 0, link: TO_SITE.link });
  });
});
