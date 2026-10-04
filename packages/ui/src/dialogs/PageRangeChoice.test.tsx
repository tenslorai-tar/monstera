// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, PAGE_RANGE_EXPORT_EMPTY } from '../messages/en.js';
import { PageRangeChoice, usePageRange } from './PageRangeChoice.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * The row as a dialog holds it: the state from `usePageRange`, and an action that reads the pages through `proceed`.
 * What `proceed` answered is written where a case can read it, as a dialog's `resolve` would receive it.
 */
function Host({ pageCount, answers }: { readonly pageCount: number; readonly answers: (readonly number[] | undefined)[] }): ReactElement {
  const range = usePageRange(pageCount);
  return (
    <>
      <PageRangeChoice empty={PAGE_RANGE_EXPORT_EMPTY} range={range} />
      <button
        onClick={() => {
          answers.push(range.proceed());
        }}
        type="button"
      >
        Go on
      </button>
    </>
  );
}

function opened(pageCount = 8): (readonly number[] | undefined)[] {
  const answers: (readonly number[] | undefined)[] = [];
  render(<Host answers={answers} pageCount={pageCount} />, { wrapper: Wrapped });
  return answers;
}

const OPTION = (name: string): HTMLElement => screen.getByRole('button', { name });
const FIELD = (): HTMLElement | null => screen.queryByRole('textbox', { name: 'Page numbers' });
const PROBLEM = (): HTMLElement | null => screen.queryByRole('alert');
const GO_ON = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Go on' }));
};

function typed(text: string): void {
  const field = FIELD();
  if (field === null) throw new Error('Select pages showed no Page numbers field');
  fireEvent.change(field, { target: { value: text } });
}

afterEach(() => {
  cleanup();
});

describe('PageRangeChoice — the page range every export asks for', () => {
  it('opens on EVERY PAGE, in a group named Pages, and answers every page', () => {
    const answers = opened(4);

    expect(screen.getByRole('group', { name: 'Pages' })).toBeDefined();
    expect(OPTION('Every page').getAttribute('aria-pressed')).toBe('true');
    expect(OPTION('Select pages').getAttribute('aria-pressed')).toBe('false');
    expect(FIELD()).toBeNull();
    GO_ON();

    expect(answers).toStrictEqual([[0, 1, 2, 3]]);
  });

  it('the second option reads SELECT PAGES, and no option reads These pages', () => {
    opened();

    expect(OPTION('Select pages')).toBeDefined();
    expect(screen.queryByRole('button', { name: /these/iu })).toBeNull();
  });

  it('SELECT PAGES with a range typed answers those pages, zero-based and ascending, and says nothing', () => {
    const answers = opened();

    fireEvent.click(OPTION('Select pages'));
    typed('5, 1-3');
    GO_ON();

    expect(answers).toStrictEqual([[0, 1, 2, 4]]);
    expect(PROBLEM()).toBeNull();
  });

  it('a range the document does not have is refused ONLY ONCE the person tries to go on, naming the part', () => {
    const answers = opened();

    fireEvent.click(OPTION('Select pages'));
    typed('2-12');
    // CONTROL: before the attempt, the same text draws no refusal and the field is not marked — a row that complained
    // as it was typed passes every assertion below and fails these two.
    expect(PROBLEM()).toBeNull();
    expect(FIELD()?.getAttribute('aria-invalid')).not.toBe('true');

    GO_ON();

    expect(answers).toStrictEqual([undefined]);
    expect(PROBLEM()?.textContent).toBe('“2-12” is outside this document, which has 8 pages.');
    expect(FIELD()?.getAttribute('aria-invalid')).toBe('true');

    // ONCE TRIED, IT FOLLOWS THE TEXT: corrected, the refusal goes and the pages are answered.
    typed('2-4');
    expect(PROBLEM()).toBeNull();
    GO_ON();
    expect(answers).toStrictEqual([undefined, [1, 2, 3]]);
  });

  it('nothing typed is refused with the DIALOG’S OWN sentence, once the person tries to go on', () => {
    const answers = opened();

    fireEvent.click(OPTION('Select pages'));
    expect(PROBLEM()).toBeNull();
    GO_ON();

    expect(answers).toStrictEqual([undefined]);
    expect(PROBLEM()?.textContent).toBe('Type the pages to export, for example 1-3, 5.');
  });

  it('CONTROL: back on Every page after a refusal, the refusal goes and every page is answered', () => {
    // The refusal belongs to the typed pages, so it is drawn on their row and leaves with it. Without this, a row that
    // drew it anywhere that stays — kept on screen over an option that types nothing — passes the single-refusal cases.
    const answers = opened(3);

    fireEvent.click(OPTION('Select pages'));
    typed('abc');
    GO_ON();
    expect(PROBLEM()?.textContent).toBe('“abc” is not a page or a page range.');

    fireEvent.click(OPTION('Every page'));

    expect(PROBLEM()).toBeNull();
    expect(FIELD()).toBeNull();
    GO_ON();
    expect(answers).toStrictEqual([undefined, [0, 1, 2]]);
  });
});
