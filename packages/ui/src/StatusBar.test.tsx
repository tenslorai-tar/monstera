// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StatusBar } from './StatusBar.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe('StatusBar', () => {
  it('reports the page number a PERSON reads, not the index that crosses the contract', () => {
    // THE SEPARATING CASE for this surface. Page 4 of 10 is index 3, and a
    // status bar that printed the index would be off by one on every document —
    // silently, because "Page 3 of 10" is a perfectly plausible thing to read.
    const { container } = render(
      <Wrapped>
        <StatusBar page={3} pageCount={10} zoom={1} onGoTo={vi.fn()} />
      </Wrapped>,
    );

    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 4 of 10');
  });

  it('shows the zoom as a percentage, rounded for display', () => {
    // A fit resolves to something like 1.3361, and 133.61% is not a thing a
    // reader wants. The rounding is here rather than upstream so nothing
    // downstream can pick it up — a stored 134% would be a zoom the renderer
    // then draws at.
    const { container } = render(
      <Wrapped>
        <StatusBar page={0} pageCount={1} zoom={1.3361} onGoTo={vi.fn()} />
      </Wrapped>,
    );

    expect(container.querySelector('.m-status-zoom')?.textContent).toBe('134%');
  });

  it('is announced POLITELY, because the page number changes on every scroll', () => {
    // `role="status"` is polite by definition; an assertive region would
    // interrupt a screen-reader user several times a second to tell them
    // something they can ask for. Asserting the role rather than the attribute
    // because the role is what assistive technology reads.
    const { container } = render(
      <Wrapped>
        <StatusBar page={0} pageCount={1} zoom={1} onGoTo={vi.fn()} />
      </Wrapped>,
    );

    const bar = container.querySelector('[role="status"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-live')).toBeNull();
  });

  describe('the go-to field', () => {
    /** Renders the bar over a ten-page document and returns what it dispatched. */
    function withField(): {
      readonly field: HTMLInputElement;
      readonly form: HTMLFormElement;
      readonly went: ReturnType<typeof vi.fn>;
      readonly container: HTMLElement;
    } {
      const went = vi.fn();
      const { container } = render(
        <Wrapped>
          <StatusBar page={3} pageCount={10} zoom={1} onGoTo={went} />
        </Wrapped>,
      );
      const field = container.querySelector('[data-goto-input]');
      const form = container.querySelector('.m-status-goto');
      if (!(field instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        throw new Error('the bar renders a go-to field inside a form');
      }
      return { field, form, went, container };
    }

    it('CONVERTS what the reader typed into the index the kernel wants', () => {
      // The whole reason this control lives beside `pageNumbering.ts`. A reader
      // types 4 and the jump is index 3; a field that dispatched 4 would land a
      // page late on every document, and "went to page 5 when I typed 4" is the
      // shape of defect this build has already shipped once, in a rotate.
      const { field, form, went } = withField();

      fireEvent.change(field, { target: { value: '4' } });
      fireEvent.submit(form);

      expect(went).toHaveBeenCalledWith(3);
    });

    it('REFUSES a page outside the document, and says where it ends', () => {
      // Clamping is right for *next page* at the end and wrong here: 500 in a
      // ten-page document is not "page 10", and answering with page 10 tells
      // the reader their document has 500 pages.
      const { field, form, went, container } = withField();

      fireEvent.change(field, { target: { value: '500' } });
      fireEvent.submit(form);

      expect(went).not.toHaveBeenCalled();
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(container.querySelector('.m-status-problem')?.textContent).toBe(
        'This document has pages 1 to 10.',
      );
    });

    it('refuses page 0, which is the index rather than a page', () => {
      // The off-by-one from the other side, and the one a person hits by
      // knowing too much: a field accepting 0 would send `kernelPageOf(0)`,
      // which is -1.
      const { field, form, went } = withField();

      fireEvent.change(field, { target: { value: '0' } });
      fireEvent.submit(form);

      expect(went).not.toHaveBeenCalled();
    });

    it('refuses what is not a whole number, rather than jumping somewhere', () => {
      const { field, form, went } = withField();

      for (const value of ['', 'four', '2.5']) {
        fireEvent.change(field, { target: { value } });
        fireEvent.submit(form);
      }

      expect(went).not.toHaveBeenCalled();
    });

    it('CLEARS the refusal as soon as the number is edited', () => {
      // A message that stayed while the reader corrected the number would be on
      // screen at the moment they pressed Enter on a page that exists.
      const { field, form, container } = withField();

      fireEvent.change(field, { target: { value: '500' } });
      fireEvent.submit(form);
      expect(container.querySelector('.m-status-problem')).not.toBeNull();

      fireEvent.change(field, { target: { value: '5' } });
      expect(container.querySelector('.m-status-problem')).toBeNull();
      expect(field.getAttribute('aria-invalid')).toBe('false');
    });

    it('EMPTIES itself after a jump, so it is a control and not a second readout', () => {
      // It is deliberately not a box showing the current page: this footer is
      // `role="status"` and announces the page as it changes, and an input
      // whose value React updates fires no text mutation, so that announcement
      // would stop.
      const { field, form } = withField();

      fireEvent.change(field, { target: { value: '4' } });
      fireEvent.submit(form);

      expect(field.value).toBe('');
      // AND THE READOUT IS STILL THE READOUT, which is the half that would be
      // lost by making the field hold the page.
      expect(field.ownerDocument.querySelector('.m-status-page')?.textContent).toBe('Page 4 of 10');
    });
  });
});
