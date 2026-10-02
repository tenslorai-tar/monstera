import { describe, expect, it } from 'vitest';

import { MAX_ASK_DOCUMENTS, askAboutSchema, askCitation, askPageMarker, askShareOf, citationsIn } from './askAbout.js';
import { channels } from './channels.js';

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
    // A comment carries its text as a selection does, so it is refused without one too.
    expect(askAboutSchema.safeParse({ scope: 'comment', docId: 'd', page: 0 }).success).toBe(false);
  });

  it('a picture names a page and carries nothing else — no bytes cross from the renderer (ADR-0090)', () => {
    expect(askAboutSchema.safeParse({ scope: 'page-image', docId: 'd', page: 1 }).success).toBe(true);
    expect(askAboutSchema.safeParse({ scope: 'page-image', docId: 'd', page: 1, png: 'x' }).success).toBe(false);
    expect(askAboutSchema.safeParse({ scope: 'page-image', docId: 'd' }).success).toBe(false);
  });

  it('CONTROL: accepts each of the five scopes it declares', () => {
    for (const about of [
      { scope: 'selection', docId: 'd', page: 2, text: 'words' },
      { scope: 'comment', docId: 'd', page: 2, text: 'a note' },
      { scope: 'page', docId: 'd', page: 2 },
      { scope: 'document', docId: 'd' },
      { scope: 'comments', docId: 'd' },
    ]) {
      expect(askAboutSchema.safeParse(about).success, about.scope).toBe(true);
    }
  });

  it('refuses a page field on a document ask, so the renderer cannot believe it narrowed one', () => {
    expect(askAboutSchema.safeParse({ scope: 'document', docId: 'd', page: 3 }).success).toBe(false);
  });
});

describe('two documents side by side (ADR-0089)', () => {
  it('ROUND TRIP per side: a side-named marker and its citation name the same page on the same side', () => {
    expect(askPageMarker(4, 'right')).toBe('[Right page 5]');
    expect(askCitation(4, 'right')).toBe('[Right p. 5]');
    expect(citationsIn(`compare ${askCitation(4, 'left')} with ${askCitation(1, 'right')}`)).toStrictEqual([
      { text: 'compare ' },
      { cited: 4, label: '[Left p. 5]', side: 'left' },
      { text: ' with ' },
      { cited: 1, label: '[Right p. 2]', side: 'right' },
    ]);
  });

  it('CONTROL: a one-document citation carries NO side, so it links in the document it was asked of', () => {
    expect(citationsIn('[p. 3]')).toStrictEqual([{ cited: 2, label: '[p. 3]' }]);
  });

  const request = (about: unknown, alongside: unknown): boolean =>
    channels['ai.ask'].params.safeParse({
      subscription: 's1-abc',
      provider: 'anthropic',
      model: 'm',
      messages: [{ role: 'user', text: 'which is later?' }],
      about,
      alongside,
      // REQUIRED since ADR-0108: without it every request here fails, and the refusal cases below would pass for
      // that reason rather than their own.
      web: false,
    }).success;

  it('pairs a different document in the same page or document scope', () => {
    expect(request({ scope: 'page', docId: 'a', page: 1 }, { scope: 'page', docId: 'b', page: 4 })).toBe(true);
    expect(request({ scope: 'document', docId: 'a' }, { scope: 'document', docId: 'b' })).toBe(true);
  });

  it('REFUSES the same document twice, mixed scopes, a carried scope, and a second with no first', () => {
    expect(request({ scope: 'document', docId: 'a' }, { scope: 'document', docId: 'a' })).toBe(false);
    expect(request({ scope: 'page', docId: 'a', page: 1 }, { scope: 'document', docId: 'b' })).toBe(false);
    expect(
      request({ scope: 'selection', docId: 'a', page: 0, text: 'x' }, { scope: 'selection', docId: 'b', page: 0, text: 'y' }),
    ).toBe(false);
    expect(request(undefined, { scope: 'document', docId: 'b' })).toBe(false);
    expect(request({ scope: 'comments', docId: 'a' }, { scope: 'comments', docId: 'b' })).toBe(false);
  });

  it('CONTROL: an ask with no second document is unchanged', () => {
    expect(request({ scope: 'selection', docId: 'a', page: 0, text: 'x' }, undefined)).toBe(true);
  });
});

describe('every open document (ADR-0134)', () => {
  it('ROUND TRIP per document: a placed marker and its citation name the same page in the same document', () => {
    // THE THIRD DOCUMENT, PAGE 5, so neither the place nor the page can be off by one and still agree.
    expect(askPageMarker(4, 2)).toBe('[Doc 3 page 5]');
    expect(askCitation(4, 2)).toBe('[Doc 3 p. 5]');
    expect(citationsIn(`see ${askCitation(4, 2)} and ${askCitation(0, 0)}`)).toStrictEqual([
      { text: 'see ' },
      { cited: 4, label: '[Doc 3 p. 5]', document: 2 },
      { text: ' and ' },
      { cited: 0, label: '[Doc 1 p. 1]', document: 0 },
    ]);
  });

  it('a citation of Doc 0 names no document, and stays text as [p. 0] does', () => {
    expect(citationsIn('[Doc 0 p. 3]')).toStrictEqual([{ text: '[Doc 0 p. 3]' }]);
  });

  it('CONTROL: the side and plain spellings parse as before, so the one parser still reads all three', () => {
    expect(citationsIn('[Left p. 2] [p. 2]')).toStrictEqual([
      { cited: 1, label: '[Left p. 2]', side: 'left' },
      { text: ' ' },
      { cited: 1, label: '[p. 2]' },
    ]);
  });

  const ids = (count: number): string[] => Array.from({ length: count }, (_, at) => `d${String(at)}`);
  const request = (about: unknown, alongside: unknown): boolean =>
    channels['ai.ask'].params.safeParse({
      subscription: 's1-abc',
      provider: 'anthropic',
      model: 'm',
      messages: [{ role: 'user', text: 'what do they say?' }],
      about,
      alongside,
      web: false,
    }).success;

  it(`takes two to ${String(MAX_ASK_DOCUMENTS)} different documents, and refuses one, more, or the same twice`, () => {
    expect(request({ scope: 'documents', docIds: ids(2) }, undefined)).toBe(true);
    expect(request({ scope: 'documents', docIds: ids(MAX_ASK_DOCUMENTS) }, undefined)).toBe(true);
    expect(request({ scope: 'documents', docIds: ids(1) }, undefined)).toBe(false);
    expect(request({ scope: 'documents', docIds: ids(MAX_ASK_DOCUMENTS + 1) }, undefined)).toBe(false);
    expect(request({ scope: 'documents', docIds: ['d0', 'd1', 'd0'] }, undefined)).toBe(false);
  });

  it('never pairs: a second document beside every open document is refused', () => {
    expect(request({ scope: 'documents', docIds: ids(2) }, { scope: 'document', docId: 'x' })).toBe(false);
  });

  it('each document’s share is the bound divided by how many, the one number main applies and the turn states', () => {
    expect(askShareOf(3)).toBe(33_333);
    expect(askShareOf(MAX_ASK_DOCUMENTS)).toBe(6_250);
  });
});
