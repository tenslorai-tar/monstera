import { describe, expect, it } from 'vitest';

import { type Inline, inlineOf, parseArticle, searchTextOf } from './article.js';
import { HELP_ARTICLES } from './articles.js';

const SOURCE = [
  '---',
  'id: rotate-pages',
  'title: Rotate pages',
  'summary: Turn pages a quarter at a time.',
  'keywords: [rotate, turn]',
  'commands: [document.rotate-page, document.rotate-left]',
  'contexts: [organize]',
  'outside: [Keys and Endpoint]',
  '---',
  '# Rotate pages',
  'Rotating changes the page,',
  'not just the view.',
  '',
  '## Steps',
  '',
  '1. Choose **Rotate** in `Organize`.',
  '   - once for a quarter turn;',
  '   - twice for a half turn.',
  '2. Save, see <https://example.com/help>.',
  '',
  '![A rotated page](screenshot:rotate-1)',
  '',
  '| Key | Does |',
  '|---|---|',
  '| **Ctrl+R** | Rotate right |',
  '',
  '<!--',
  'Screenshot notes, never shown.',
  '-->',
].join('\r\n');

describe('a Help article', () => {
  const article = parseArticle('rotate.md', SOURCE);

  it('reads its front matter, lists included', () => {
    expect(article.id).toBe('rotate-pages');
    expect(article.title).toBe('Rotate pages');
    expect(article.keywords).toStrictEqual(['rotate', 'turn']);
    expect(article.commands).toStrictEqual(['document.rotate-page', 'document.rotate-left']);
    expect(article.contexts).toStrictEqual(['organize']);
    expect(article.outside).toStrictEqual(['Keys and Endpoint']);
  });

  it('reads the body into blocks: the top title dropped, a wrapped paragraph joined, nested items, a table', () => {
    expect(article.blocks.map((block) => block.kind)).toStrictEqual(['paragraph', 'heading', 'numbered', 'table']);
    expect(article.blocks[0]).toStrictEqual({ kind: 'paragraph', inline: [{ kind: 'text', text: 'Rotating changes the page, not just the view.' }] });
    const steps = article.blocks[2];
    expect(steps?.kind === 'numbered' ? steps.items.map((item) => item.nested.length) : undefined).toStrictEqual([2, 0]);
    const table = article.blocks[3];
    expect(table?.kind === 'table' ? table.rows : undefined).toStrictEqual([
      [[{ kind: 'bold', text: 'Ctrl+R' }], [{ kind: 'text', text: 'Rotate right' }]],
    ]);
  });

  it('drops a screenshot not yet captured and the author’s notes, so neither reaches the page', () => {
    const text = searchTextOf(article);
    expect(text).not.toContain('screenshot');
    expect(text).not.toContain('never shown');
  });

  it('reads bold, code and a web address, and leaves an address as text rather than a link', () => {
    expect(inlineOf('Choose **Rotate** in `Organize`, see <https://example.com/a>.')).toStrictEqual<Inline[]>([
      { kind: 'text', text: 'Choose ' },
      { kind: 'bold', text: 'Rotate' },
      { kind: 'text', text: ' in ' },
      { kind: 'code', text: 'Organize' },
      { kind: 'text', text: ', see ' },
      { kind: 'address', text: 'https://example.com/a' },
      { kind: 'text', text: '.' },
    ]);
    // ONLY https: anything else in angle brackets is text, so no article can name another scheme.
    expect(inlineOf('<javascript:alert(1)>')).toStrictEqual([{ kind: 'text', text: '<javascript:alert(1)>' }]);
  });

  it('refuses an article with no front matter, or none naming its id and title', () => {
    expect(() => parseArticle('bare.md', 'Just text.')).toThrow(/bare\.md/u);
    expect(() => parseArticle('half.md', '---\ntitle: T\n---\nText.')).toThrow(/half\.md/u);
  });

  it('every real article parses to text with no Markdown left in it', () => {
    // WHAT THE PARSER DOES NOT UNDERSTAND SHOWS as its raw marks — a stray `**`, a `[link](…)`, an autolink it did not
    // read — so their absence across the real set is what says the subset is the one the articles are written in.
    const residue = HELP_ARTICLES.filter((each) => /\*\*|\]\(|<https?:|(?:^| )##? /u.test(searchTextOf(each)));
    expect(residue.map((each) => each.id)).toStrictEqual([]);
    // CONTROL: the same test sees the marks it looks for.
    expect(/\*\*|\]\(|<https?:/u.test(searchTextOf(parseArticle('c.md', '---\nid: c\ntitle: C\n---\nA **b and [c](d)\n')))).toBe(true);
  });
});
