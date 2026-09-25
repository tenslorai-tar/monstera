import { displayLocationSchema } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import { i18n, activateCatalogue } from './i18n.js';
import { EN } from './messages/en.js';
import { type Translate, cloudFileLine, recentLine, recentWhen, recentWhere } from './recentLine.js';

activateCatalogue('en', EN);
const _: Translate = (key, values) => i18n._(key, values);

// LOCAL TIMES, built from parts, so the calendar-day cases mean the same in every runner's zone.
const NOW = new Date(2026, 8, 25, 0, 10);
const local = (day: number, hour: number, minute = 0): string => new Date(2026, 8, day, hour, minute).toISOString();
const where = (within: string | null, folder: string | null) => displayLocationSchema.parse({ within, folder });

describe('recentWhen (ADR-0100)', () => {
  it('says Today for this calendar day, and Yesterday for the one before, by the reader’s clock', () => {
    expect(recentWhen(local(25, 0, 5), NOW, 'en', _)).toBe('Today');
    // TWENTY MINUTES AGO, and still Yesterday: a calendar day, not a 24-hour window.
    expect(recentWhen(local(24, 23, 50), NOW, 'en', _)).toBe('Yesterday');
  });

  it('gives an older opening a short date in the reader’s locale', () => {
    expect(recentWhen(local(18, 12), NOW, 'en', _)).toBe('Sep 18');
  });

  it('says nothing for an entry recorded without a time, rather than inventing one', () => {
    expect(recentWhen(null, NOW, 'en', _)).toBeNull();
  });
});

describe('recentWhere (ADR-0100)', () => {
  it('names the known folder in the reader’s language and the folder as the person wrote it', () => {
    expect(recentWhere(where('documents', 'Leases'), _)).toBe('Documents › Leases');
    expect(recentWhere(where('onedrive', 'Legal'), _)).toBe('OneDrive › Legal');
  });

  it('shows either part alone, and nothing for neither', () => {
    expect(recentWhere(where('downloads', null), _)).toBe('Downloads');
    expect(recentWhere(where(null, 'Q3'), _)).toBe('Q3');
    expect(recentWhere(where(null, null), _)).toBeNull();
  });
});

describe('recentLine', () => {
  it('is v5-01’s line: when · where', () => {
    expect(recentLine({ openedAt: local(25, 0, 5), location: where('documents', 'Leases') }, NOW, 'en', _)).toBe(
      'Today · Documents › Leases',
    );
  });

  it('drops the separator when a half is missing', () => {
    expect(recentLine({ openedAt: null, location: where('google-drive', null) }, NOW, 'en', _)).toBe('Google Drive');
    expect(recentLine({ openedAt: local(24, 9), location: where(null, null) }, NOW, 'en', _)).toBe('Yesterday');
    expect(recentLine({ openedAt: null, location: where(null, null) }, NOW, 'en', _)).toBeNull();
  });
});

describe('cloudFileLine', () => {
  const modified = (day: number, hour: number): number => new Date(2026, 8, day, hour).getTime();

  it('is when it changed · how large it is, by the recent cards’ date rule', () => {
    expect(cloudFileLine({ modified: modified(24, 9) }, '1.2 MB', NOW, 'en', _)).toBe('Yesterday · 1.2 MB');
    // A DATE FURTHER BACK is the short date, as a recent card's is — the same rule, not a second one.
    expect(cloudFileLine({ modified: modified(18, 9) }, '640 KB', NOW, 'en', _)).toBe('Sep 18 · 640 KB');
  });

  it('shows the half the provider gave, and nothing when it gave neither', () => {
    expect(cloudFileLine({ modified: null }, '640 KB', NOW, 'en', _)).toBe('640 KB');
    expect(cloudFileLine({ modified: modified(25, 0) }, null, NOW, 'en', _)).toBe('Today');
    expect(cloudFileLine({ modified: null }, null, NOW, 'en', _)).toBeNull();
  });
});
