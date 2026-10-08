// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PageBarcodesBody from './PageBarcodesBody.js';
import { InDialog } from './inDialog.js';
import { PAGE_BARCODES_REPORT } from './pageBarcodes.js';

/**
 * The barcode list's rows (the owner's item 5.2): every row can be shown on the page, a contact card can be saved, and
 * each press reports the barcode by its page and place — never its text or where it is, which the command holds.
 */
afterEach(() => {
  cleanup();
});

const CARD = 'BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEND:VCARD';

function listed(): { readonly update: ReturnType<typeof vi.fn> } {
  const update = vi.fn();
  render(
    <InDialog>
      <PageBarcodesBody
        kind="read"
        page={2}
        all={false}
        pageCount={4}
        truncated={false}
        barcodes={[
          { format: 'QRCode', text: 'https://example.org/menu', page: 2, index: 0 },
          { format: 'QRCode', text: CARD, page: 2, index: 1 },
        ]}
        resolve={vi.fn()}
        update={update}
      />
    </InDialog>,
  );
  return { update };
}

describe('PageBarcodesBody rows', () => {
  it('SHOW ON THE PAGE reports the row’s page and place, and marks the row in the list', () => {
    const { update } = listed();
    fireEvent.click(screen.getByRole('button', { name: 'Show barcode 2 on the page' }));
    expect(PAGE_BARCODES_REPORT.parse(update.mock.calls[0]?.[0])).toStrictEqual({ kind: 'show', page: 2, index: 1 });
    expect(document.querySelectorAll('tr[data-marked="true"]')).toHaveLength(1);
    // THE OTHER ROW IS NOT MARKED: pressing a second one moves the mark rather than adding to it.
    fireEvent.click(screen.getByRole('button', { name: 'Show barcode 1 on the page' }));
    expect(document.querySelectorAll('tr[data-marked="true"]')).toHaveLength(1);
    expect(PAGE_BARCODES_REPORT.parse(update.mock.calls[1]?.[0])).toStrictEqual({ kind: 'show', page: 2, index: 0 });
  });

  it('SAVE CONTACT is offered on a contact card only, and reports its place', () => {
    const { update } = listed();
    expect(screen.queryByRole('button', { name: 'Save the contact in barcode 1…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save the contact in barcode 2…' }));
    expect(PAGE_BARCODES_REPORT.parse(update.mock.calls[0]?.[0])).toStrictEqual({ kind: 'save-contact', page: 2, index: 1 });
  });
});
