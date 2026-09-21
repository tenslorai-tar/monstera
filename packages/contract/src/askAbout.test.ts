import { describe, expect, it } from 'vitest';

import { askAboutSchema, askPageMarker, citationsIn } from './askAbout.js';

describe('the page frame an ask and its answer share', () => {
  it('ROUND TRIP, off the first page: the page a marker names is the page its citation links to', () => {
    // KERNEL PAGE 4, not 0: at the first page an off-by-one in either direction lands on a
    // page that exists or is refused as page -1, and a mistake in both would cancel.
    const marker = askPageMarker(4);
    expect(marker).toBe('[Page 5]');

    const shown = /\d+/u.exec(marker)?.[0] ?? '';
    const answer = `The deadline is set out there [p. ${shown}].`;
    expect(citationsIn(answer)).toStrictEqual([
      { text: 'The deadline is set out there ' },
      { cited: 4, label: '[p. 5]' },
      { text: '.' },
    ]);
  });

  it('reads the tight spelling and several citations, in order', () => {
    expect(citationsIn('[p.2] and [p. 10]')).toStrictEqual([
      { cited: 1, label: '[p.2]' },
      { text: ' and ' },
      { cited: 9, label: '[p. 10]' },
    ]);
  });

  it('CONTROL: page 0 names no page a person reads, so it stays text rather than becoming a link', () => {
    expect(citationsIn('see [p. 0] here')).toStrictEqual([{ text: 'see [p. 0] here' }]);
  });

  it('an answer with no citation is one piece of text', () => {
    expect(citationsIn('No pages here.')).toStrictEqual([{ text: 'No pages here.' }]);
  });
});

describe('what an ask may be about', () => {
  it('refuses a selection with no text, and a scope it does not name', () => {
    expect(askAboutSchema.safeParse({ scope: 'selection', docId: 'd', page: 0, text: '' }).success).toBe(false);
    expect(askAboutSchema.safeParse({ scope: 'library', docId: 'd' }).success).toBe(false);
  });

  it('CONTROL: accepts each of the three scopes it declares', () => {
    for (const about of [
      { scope: 'selection', docId: 'd', page: 2, text: 'words' },
      { scope: 'page', docId: 'd', page: 2 },
      { scope: 'document', docId: 'd' },
    ]) {
      expect(askAboutSchema.safeParse(about).success, about.scope).toBe(true);
    }
  });

  it('refuses a page field on a document ask, so the renderer cannot believe it narrowed one', () => {
    expect(askAboutSchema.safeParse({ scope: 'document', docId: 'd', page: 3 }).success).toBe(false);
  });
});
