// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue } from '../i18n.js';
import { InDialog } from './inDialog.js';
import { EN } from '../messages/en.js';
import PlaceBarcodeBody from './PlaceBarcodeBody.js';
import PageBarcodesBody from './PageBarcodesBody.js';

/**
 * The barcode dialogs' bodies. The command's half — that the answer reaches
 * `document.placeBarcode` unchanged — is `commands/barcodes.test.ts`'; this half is that what a
 * person types and chooses is what the dialog answers.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <InDialog>{children}</InDialog>;
}

afterEach(() => {
  cleanup();
});

describe('PlaceBarcodeBody', () => {
  it('answers the text typed and the type chosen', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <PlaceBarcodeBody resolve={resolve} update={() => undefined} />
      </Wrapped>,
    );
    fireEvent.change(screen.getByLabelText('Text or link'), { target: { value: 'MONSTERA-0042' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Code 128' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the page' }));
    expect(resolve).toHaveBeenCalledWith({ text: 'MONSTERA-0042', format: 'Code128' });
  });

  it('CONTROL: with no text it cannot answer, and a QR code is the type chosen first', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <PlaceBarcodeBody resolve={resolve} update={() => undefined} />
      </Wrapped>,
    );
    // QUIET UNTIL PRESSED, then says what is missing (`attempt.ts`), and opens in the field it asks for.
    expect(screen.queryByText('Type the text or link the barcode should hold.')).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText('Text or link'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the page' }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('Type the text or link the barcode should hold.');
    expect(screen.getByRole('radio', { name: 'QR Code' })).toHaveProperty('checked', true);
  });

  it('after a refusal, says why and holds the try, so one change is enough', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <PlaceBarcodeBody refused={{ text: 'letters', format: 'EAN13' }} resolve={resolve} update={() => undefined} />
      </Wrapped>,
    );
    expect(screen.getByRole('alert').textContent).toContain('cannot hold this text');
    fireEvent.click(screen.getByRole('radio', { name: 'QR Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to the page' }));
    expect(resolve).toHaveBeenCalledWith({ text: 'letters', format: 'QRCode' });
  });
});

describe('PageBarcodesBody', () => {
  it('lists each barcode’s type and text, and says when the list was stopped', () => {
    render(
      <Wrapped>
        <PageBarcodesBody
          kind="read"
          page={3}
          all={false}
          pageCount={5}
          barcodes={[
            { format: 'QRCode', text: 'https://example.org', page: 3, index: 0 },
            { format: 'EAN13', text: '4006381333931', page: 3, index: 1 },
          ]}
          truncated
          resolve={() => undefined}
          update={() => undefined}
        />
      </Wrapped>,
    );
    expect(screen.getByText('2 barcodes on page 3.')).toBeDefined();
    // THE TYPE BY ITS EVERYDAY NAME, and what each text IS above it.
    const rows = screen.getAllByRole('row').map((row) => row.textContent);
    expect(rows[1]).toContain('QR code');
    expect(rows[1]).toContain('Web linkhttps://example.org');
    expect(rows[2]).toContain('EAN-13');
    expect(rows[2]).toContain('4006381333931');
    // A LINK IS SHOWN, NEVER FOLLOWED: nothing in the list is an anchor.
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Only the first ones are shown/u)).toBeDefined();
  });

  describe('actions and content (the owner’s list of 2026-10-07)', () => {
    const CARD = 'BEGIN:VCARD\nFN:Dr. Ada Okafor\nTITLE:Head of Design\nORG:Monstera Labs\nTEL:+44 20 7946 0958\nEMAIL:ada@example.org\nEND:VCARD';
    const draw = (props: { all?: boolean; pageCount?: number }): ReturnType<typeof vi.fn> => {
      const update = vi.fn();
      render(
        <Wrapped>
          <PageBarcodesBody
            kind="read"
            page={1}
            all={props.all ?? false}
            pageCount={props.pageCount ?? 4}
            barcodes={[
              { format: 'QRCode', text: 'https://example.org/menu', page: 1, index: 0 },
              { format: 'QRCode', text: CARD, page: 2, index: 0 },
              { format: 'Code128', text: 'TICKET-77', page: 2, index: 1 },
            ]}
            truncated={false}
            resolve={() => undefined}
            update={update}
          />
        </Wrapped>,
      );
      return update;
    };

    it('shows a contact card as name, title, company, phone and email lines, never its markup', () => {
      draw({});
      expect(screen.getByText('Dr. Ada Okafor')).toBeDefined();
      expect(screen.getByText('Head of Design')).toBeDefined();
      expect(screen.getByText('+44 20 7946 0958')).toBeDefined();
      expect(document.body.textContent).not.toContain('BEGIN:VCARD');
      expect(screen.getByText('Contact card')).toBeDefined();
    });

    it('offers OPEN LINK on the web link alone, and a press reports it by page and place — CONTROL: no other row has one', () => {
      const update = draw({});
      expect(screen.getAllByRole('button', { name: /^Open the link in barcode/u })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Open the link in barcode 1' }));
      expect(update).toHaveBeenCalledWith({ kind: 'open', page: 1, index: 0 });
    });

    it('COPY reports that row’s text — a contact card as its readable lines — and COPY ALL the list', () => {
      const update = draw({});
      fireEvent.click(screen.getByRole('button', { name: 'Copy barcode 3' }));
      expect(update).toHaveBeenLastCalledWith({ kind: 'copy', text: 'TICKET-77' });
      fireEvent.click(screen.getByRole('button', { name: 'Copy barcode 2' }));
      expect(update).toHaveBeenLastCalledWith({
        kind: 'copy',
        text: 'Dr. Ada Okafor\nHead of Design\nMonstera Labs\n+44 20 7946 0958\nada@example.org',
      });
      fireEvent.click(screen.getByRole('button', { name: 'Copy all' }));
      expect(update).toHaveBeenLastCalledWith({ kind: 'copy-all' });
    });

    it('offers READ ON ALL PAGES for a document of several pages, and says each row’s page once it has', () => {
      const update = draw({});
      fireEvent.click(screen.getByRole('button', { name: 'Read barcodes on all pages' }));
      expect(update).toHaveBeenLastCalledWith({ kind: 'read-all' });
      expect(screen.queryByRole('columnheader', { name: 'Page' })).toBeNull();
      cleanup();
      draw({ all: true });
      // CONTROL: every page already read, so the button is gone and the pages are shown.
      expect(screen.queryByRole('button', { name: 'Read barcodes on all pages' })).toBeNull();
      expect(screen.getByRole('columnheader', { name: 'Page' })).toBeDefined();
      cleanup();
      draw({ pageCount: 1 });
      expect(screen.queryByRole('button', { name: 'Read barcodes on all pages' })).toBeNull();
    });
  });

  it('CONTROL: an empty page says so rather than showing an empty table', () => {
    render(
      <Wrapped>
        <PageBarcodesBody
          kind="read"
          page={1}
          all={false}
          pageCount={1}
          barcodes={[]}
          truncated={false}
          resolve={() => undefined}
          update={() => undefined}
        />
      </Wrapped>,
    );
    expect(screen.getByText('No barcodes were found on page 1.')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
