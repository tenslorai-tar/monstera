// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
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
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

describe('PlaceBarcodeBody', () => {
  it('answers the text typed and the type chosen', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <PlaceBarcodeBody resolve={resolve} />
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
        <PlaceBarcodeBody resolve={resolve} />
      </Wrapped>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add to the page' }));
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'QR Code' })).toHaveProperty('checked', true);
  });

  it('after a refusal, says why and holds the try, so one change is enough', () => {
    const resolve = vi.fn();
    render(
      <Wrapped>
        <PlaceBarcodeBody refused={{ text: 'letters', format: 'EAN13' }} resolve={resolve} />
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
          barcodes={[
            { format: 'QRCode', text: 'https://example.org' },
            { format: 'EAN13', text: '4006381333931' },
          ]}
          truncated
        />
      </Wrapped>,
    );
    expect(screen.getByText('2 barcodes on page 3.')).toBeDefined();
    expect(screen.getAllByRole('row').map((row) => row.textContent)).toStrictEqual([
      'TypeWhat it says',
      'QRCodehttps://example.org',
      'EAN134006381333931',
    ]);
    // A LINK IS SHOWN, NEVER FOLLOWED: nothing in the list is an anchor.
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/Only the first ones are shown/u)).toBeDefined();
  });

  it('CONTROL: an empty page says so rather than showing an empty table', () => {
    render(
      <Wrapped>
        <PageBarcodesBody kind="read" page={1} barcodes={[]} truncated={false} />
      </Wrapped>,
    );
    expect(screen.getByText('No barcodes were found on page 1.')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
