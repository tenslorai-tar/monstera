// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { answerElements } from './answerMarkdown.js';

/**
 * The answer renderer: Markdown's structure as elements, and nothing the answer could use to
 * reach past the page.
 *
 * Text runs are marked with `data-run` so a case can tell text that went through the panel's
 * citation splitter from text that did not — code must not.
 */
function show(answer: string): HTMLElement {
  const Answer = (): ReactElement => (
    <div>
      {answerElements(answer, (text, key) => (
        <span data-run="" key={key}>
          {text}
        </span>
      ))}
    </div>
  );
  return render(<Answer />).container;
}

describe('answerElements', () => {
  it('renders HEADINGS, LISTS, TABLES and CODE as their elements', () => {
    const shown = show(
      [
        '# Summary',
        '',
        'A **bold** and *quiet* line.',
        '',
        '- first',
        '- second',
        '',
        '3. three',
        '4. four',
        '',
        '| Term | Date |',
        '|---|---|',
        '| Notice | 1 May |',
        '',
        '```',
        'const x = 1;',
        '```',
      ].join('\n'),
    );

    // AN ANSWER'S `#` SITS BELOW THE PANEL'S OWN HEADINGS, so it is re-levelled rather than an h1.
    expect(shown.querySelector('h3')?.textContent).toBe('Summary');
    expect(shown.querySelector('h1')).toBeNull();
    expect(shown.querySelector('strong')?.textContent).toBe('bold');
    expect(shown.querySelector('em')?.textContent).toBe('quiet');
    expect([...shown.querySelectorAll('ul > li')].map((item) => item.textContent)).toStrictEqual(['first', 'second']);
    // An ordered list keeps where it starts: the model's "3." is the reader's 3.
    expect(shown.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(shown.querySelector('table thead th')?.textContent).toBe('Term');
    expect(shown.querySelector('table tbody td')?.textContent).toBe('Notice');
    expect(shown.querySelector('pre > code')?.textContent).toBe('const x = 1;\n');
  });

  it('shows RAW HTML as text, and no element the answer named reaches the page', () => {
    const shown = show(
      [
        '<script>window.hit = 1</script>',
        '',
        'Inline <img src="x" onerror="window.hit = 2"> and <b onclick="x">bold</b>.',
        '',
        '<iframe src="https://example.org/"></iframe>',
      ].join('\n'),
    );

    // THE SEPARATING ASSERTION: a renderer that set HTML would produce these elements.
    expect(shown.querySelector('script, img, b, iframe, [onerror], [onclick]')).toBeNull();
    // And the words are still there, as words — the reader sees what the model wrote.
    expect(shown.textContent).toContain('<script>window.hit = 1</script>');
    expect(shown.textContent).toContain('<img src="x" onerror="window.hit = 2">');
  });

  it('shows LINKS and IMAGES as their words, with no address', () => {
    const shown = show('See [the site](https://example.org/) and ![a chart](https://example.org/c.png).');

    expect(shown.querySelector('a, img, [href], [src]')).toBeNull();
    expect(shown.textContent).toBe('See the site and a chart.');
  });

  it('passes PROSE through the text function, and never CODE', () => {
    const shown = show('Cited [p. 2] here, and `[p. 3]` quoted.\n\n```\n[p. 4]\n```');
    const runs = [...shown.querySelectorAll('[data-run]')].map((run) => run.textContent).join('|');

    // The citation in prose reaches the splitter; the two in code do not.
    expect(runs).toContain('[p. 2]');
    expect(runs).not.toContain('[p. 3]');
    expect(runs).not.toContain('[p. 4]');
    expect(shown.querySelector('code')?.textContent).toBe('[p. 3]');
  });

  it('CONTROL: plain text renders as one paragraph of itself', () => {
    const shown = show('Just a sentence.');

    expect(shown.querySelectorAll('p')).toHaveLength(1);
    expect(shown.textContent).toBe('Just a sentence.');
  });

  it('stays BOUNDED on the nesting that aborted another parser (ADR-0060)', () => {
    // 2,000 levels of list: marked exhausted the heap on this; markdown-it stops at 100 levels.
    const deep = Array.from({ length: 2000 }, (_, level) => `${'  '.repeat(level)}- x`).join('\n');
    const shown = show(deep);

    expect(shown.querySelectorAll('ul').length).toBeLessThanOrEqual(101);
  });
});
