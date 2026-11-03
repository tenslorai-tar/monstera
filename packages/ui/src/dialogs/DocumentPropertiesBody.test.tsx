// @vitest-environment happy-dom
import type { DocumentInformation } from '@monstera/contract';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DocumentPropertiesBody from './DocumentPropertiesBody.js';
import { shownDate, typedDate } from './documentProperties.js';
import { InDialog } from './inDialog.js';

afterEach(() => {
  cleanup();
});

const INFORMATION: DocumentInformation = {
  fields: { title: 'Report', author: 'Ada', subject: '', keywords: '', created: '2026-10-01T09:30:00+01:00', modified: null },
  has: { info: true, xmp: true },
  creator: 'A word processor',
  producer: null,
  format: 'PDF-1.7',
  encryption: 'Standard V2 R3 128-bit RC4',
  permissions: { print: true, copy: false, edit: true, annotate: true },
  pageCount: 2,
  firstPage: { width: 595.28, height: 841.89 },
};

function shown(answered: unknown[] = []): void {
  render(
    <InDialog>
      <DocumentPropertiesBody
        information={INFORMATION}
        fonts={[{ name: 'Arial', partial: true }]}
        fontsTruncated={false}
        bytes={2048}
        resolve={(result) => answered.push(result)}
        update={() => undefined}
      />
    </InDialog>,
  );
}

describe('dates as the window shows and reads them (ADR-0283)', () => {
  it('shows the PDF’s own wall-clock time and offset, never moved into this computer’s zone', () => {
    expect(shownDate('2026-10-01T09:30:00+01:00')).toBe('2026-10-01 09:30:00 +01:00');
    expect(shownDate('2026-10-01T09:30:00Z')).toBe('2026-10-01 09:30:00 UTC');
    expect(shownDate('2026-10-01T09:30:00')).toBe('2026-10-01 09:30:00');
    expect(shownDate(null)).toBe('');
  });

  it('reads what is typed back to the same date, seconds and zone optional, and nothing for empty', () => {
    for (const iso of ['2026-10-01T09:30:00+01:00', '2026-10-01T09:30:00Z', '2026-10-01T09:30:00']) expect(typedDate(shownDate(iso))).toBe(iso);
    expect(typedDate('2026-11-01 09:30')).toBe('2026-11-01T09:30:00');
    expect(typedDate('  ')).toBeNull();
  });

  it('CONTROL: a date that does not exist, or is not a date, is refused rather than rolled or guessed', () => {
    expect(typedDate('2026-02-30 10:00')).toBeUndefined();
    expect(typedDate('2026-10-01 24:00')).toBeUndefined();
    expect(typedDate('the first of May')).toBeUndefined();
  });
});

describe('DocumentPropertiesBody', () => {
  it('says the dates are the PDF’s own and Windows’ are not changed, and shows what the document is', () => {
    shown();
    expect(screen.getByText(/dates written inside the PDF\. The file’s dates in Windows are not changed/u)).toBeTruthy();
    expect(screen.getByText('A word processor')).toBeTruthy();
    expect(screen.getByText('Not stated')).toBeTruthy();
    expect(screen.getByText(/2 pages, the first 210 × 297 mm/u)).toBeTruthy();
    expect(screen.getByText(/Encrypted \(Standard V2 R3 128-bit RC4\)\. Not allowed: copying\./u)).toBeTruthy();
    expect(screen.getByText('Arial')).toBeTruthy();
  });

  it('labels the size as the document now, and says it includes unsaved changes, beside the size itself', () => {
    shown();
    const label = screen.getByText('Size now');
    expect(label.tagName).toBe('DT');
    const value = label.nextElementSibling;
    expect(value?.tagName).toBe('DD');
    expect(value?.textContent).toMatch(/^2(?:\.0)?\s?KB/u);
    expect(value?.textContent).toContain('Includes changes that are not saved yet, so it can differ from the size File Explorer shows.');
  });

  // THE MERGED WALK OF 2026-11-03: the dialog's baseline showed "2026-10-01 09:30:00 +01:0", the offset's last digit cut
  // off by a field of the browser's twenty characters, in all three looks.
  it('gives each date the long field a timestamp takes (ADR-0157), so its zone is not cut off', () => {
    shown();
    const kind = (label: string): string | undefined => screen.getByLabelText(label).closest('.m-field')?.className;
    expect(kind('Created')).toBe('m-field m-field--long');
    expect(kind('Modified')).toBe('m-field m-field--long');
    // CONTROL: the title is a name, and keeps the browser's width, so the case is not every field made long.
    expect(kind('Title')).toBe('m-field');
  });

  it('draws its facts in the dialogs’ shared grid, never the browser’s own list', () => {
    shown();
    expect(screen.getByText('Size now').closest('dl')?.className).toBe('m-dialog-facts');
  });

  it('answers the six as edited, the dates as the command carries them', () => {
    const answered: unknown[] = [];
    shown(answered);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New report' } });
    fireEvent.change(screen.getByLabelText('Modified'), { target: { value: '2026-11-01 12:00 UTC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(answered).toStrictEqual([
      { fields: { title: 'New report', author: 'Ada', subject: '', keywords: '', created: '2026-10-01T09:30:00+01:00', modified: '2026-11-01T12:00:00Z' } },
    ]);
  });

  it('CONTROL: a date typed wrong is said beside it and holds Apply back', () => {
    const answered: unknown[] = [];
    shown(answered);
    fireEvent.change(screen.getByLabelText('Created'), { target: { value: 'the first of May' } });
    expect(screen.getByText(/Write the date as year-month-day/u)).toBeTruthy();
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply.hasAttribute('disabled') || apply.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(apply);
    expect(answered).toStrictEqual([]);
  });
});
