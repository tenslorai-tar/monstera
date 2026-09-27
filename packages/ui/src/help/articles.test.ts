import { describe, expect, it } from 'vitest';

import { EN } from '../messages/en.js';
import { type Inline, parseArticle } from './article.js';
import { HELP_ARTICLES, helpFor, searchHelp } from './articles.js';

/**
 * The Help centre's articles, held to the application they describe (ADR-0112 Decision 2). The commands half — every id
 * an article names is one the registry has — needs the registry the application builds, and is `App.test.tsx`'.
 */

/** Every bold word in an article's body. */
function boldWords(article: (typeof HELP_ARTICLES)[number]): string[] {
  const bold = (parts: readonly Inline[]): string[] => parts.filter((part) => part.kind === 'bold').map((part) => part.text);
  return article.blocks.flatMap((block) => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        return bold(block.inline);
      case 'numbered':
      case 'bulleted':
        return block.items.flatMap((item) => [...bold(item.inline), ...item.nested.flatMap(bold)]);
      case 'table':
        return [...block.header, ...block.rows.flat()].flatMap(bold);
    }
  });
}

/**
 * Every form a catalogue message can take on screen: each branch of a `plural` or `select`, with `#` and every
 * `{placeholder}` written as the ellipsis an article uses for "whatever it says here" — *Add … to dictionary*.
 */
function shownForms(message: string): string[] {
  const open = message.indexOf('{');
  if (open === -1) return [message];
  let depth = 0;
  let close = open;
  for (; close < message.length; close += 1) {
    if (message[close] === '{') depth += 1;
    else if (message[close] === '}' && --depth === 0) break;
  }
  const inner = message.slice(open + 1, close);
  const before = message.slice(0, open);
  const after = shownForms(message.slice(close + 1));
  const choice = /^\s*\w+\s*,\s*(?:plural|select)\s*,([\s\S]*)$/u.exec(inner);
  const branches: string[] = [];
  if (choice === null) branches.push('…');
  else {
    const body = choice[1] ?? '';
    for (let at = 0, depthIn = 0, start = -1; at < body.length; at += 1) {
      if (body[at] === '{' && depthIn++ === 0) start = at + 1;
      else if (body[at] === '}' && --depthIn === 0) branches.push(...shownForms(body.slice(start, at).replaceAll('#', '…')));
    }
  }
  return branches.flatMap((branch) => after.map((rest) => `${before}${branch}${rest}`));
}

/**
 * How the catalogue and an article are compared: an ellipsis, a placeholder's empty brackets, the apostrophe's shape
 * and repeated spaces are not a difference in the word.
 */
const normal = (text: string): string =>
  text
    .replace(/…/gu, '')
    .replace(/\(\s*\)/gu, '')
    .replace(/’/gu, "'")
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

/** Every word Monstera shows, in every form. */
const SHOWN = new Set(Object.values(EN).flatMap((text) => shownForms(text).map(normal)));

/**
 * A bold that names a KEY rather than a control — `Ctrl+K`, `F1`, `Esc` — which is not a catalogue word. Matched as a
 * whole, so a control named *Delete pages* is still checked.
 */
const KEY =
  /^(?:(?:(?:ctrl|alt|shift|win)\+)*(?:[a-z0-9]|f\d{1,2}|ctrl|alt|shift|esc|escape|enter|tab|delete|backspace|home|end|page ?up|page ?down|space|plus|arrow ?(?:left|right|up|down)|[=+\-/])|(?:(?:ctrl|alt|shift|win)\+)+(?:click|left|right|up|down))$/iu;

describe('the Help centre’s articles', () => {
  it('load: well over a hundred, each with an id, a title and a summary', () => {
    // A FLOOR, so a glob that matched nothing fails here rather than showing an empty Help centre.
    expect(HELP_ARTICLES.length).toBeGreaterThan(100);
    for (const article of HELP_ARTICLES) expect(article.summary, article.id).not.toBe('');
  });

  it('every BOLD word is a word Monstera shows — a renamed control reddens its article — unless it is named as another application’s', () => {
    const stale = HELP_ARTICLES.flatMap((article) =>
      boldWords(article)
        .filter((term) => !KEY.test(term) && !SHOWN.has(normal(term)) && !article.outside.includes(term))
        .map((term) => `${article.id}: ${term}`),
    );
    // THE LIST IN THE MESSAGE: vitest's diff truncates an array, and every entry is a fix.
    expect(stale, `\n${stale.join('\n')}\n`).toStrictEqual([]);
  });

  it('CONTROL: the check sees a bold word that is not Monstera’s', () => {
    // WITHOUT THIS an empty catalogue or a broken extraction would pass the case above.
    const invented = parseArticle('control.md', '---\nid: c\ntitle: C\nsummary: s\n---\nChoose **Frobnicate everything**.\n');
    expect(boldWords(invented).filter((term) => !SHOWN.has(normal(term)))).toStrictEqual(['Frobnicate everything']);
    expect(SHOWN.has(normal('Save'))).toBe(true);
  });

  it('a message is compared in every form it can take on screen', () => {
    expect(shownForms('{count, plural, one {This page} other {These # pages}}')).toStrictEqual(['This page', 'These … pages']);
    expect(shownForms('Add {word} to dictionary')).toStrictEqual(['Add … to dictionary']);
    expect(shownForms('Plain')).toStrictEqual(['Plain']);
    // CONTROL on the real catalogue: a plural branch and a placeholder form are both present.
    expect(SHOWN.has(normal('This page'))).toBe(true);
    expect(SHOWN.has(normal('Add … to dictionary'))).toBe(true);
    // And a KEY is recognised as a whole, never as a prefix of a control's name.
    expect(KEY.test('Ctrl+Shift+Z')).toBe(true);
    expect(KEY.test('Alt+Left')).toBe(true);
    expect(KEY.test('Left')).toBe(false);
    expect(KEY.test('Delete pages')).toBe(false);
  });

  it('search finds by title first, then by any word, and every word must match', () => {
    const rotate = searchHelp('rotate');
    expect(rotate[0]?.title.toLowerCase()).toContain('rotate');
    expect(searchHelp('rotate zzzz-not-a-word')).toStrictEqual([]);
    expect(searchHelp('')).toHaveLength(HELP_ARTICLES.length);
  });

  it('F1’s lookup: the article for the tool in use, and the articles for the section on show', () => {
    const withTool = helpFor({ tool: 'document.rotate-page', context: 'organize' });
    expect(withTool.article?.commands).toContain('document.rotate-page');
    expect(withTool.related.every((article) => article.contexts.includes('organize'))).toBe(true);
    expect(withTool.related.length).toBeGreaterThan(0);
    // CONTROL: no tool, no article — only the section's list.
    expect(helpFor({ tool: undefined, context: 'organize' }).article).toBeUndefined();
  });
});
