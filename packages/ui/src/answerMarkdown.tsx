import MarkdownIt, { type Token } from 'markdown-it';
import { Fragment, createElement, type ReactNode } from 'react';

/**
 * An assistant's answer, as Markdown, turned into React elements — never into HTML.
 *
 * ## Why no HTML string exists anywhere on this path
 *
 * The answer is text a remote model chose, so it is untrusted input to the renderer. The usual
 * route — a Markdown library's `render()` into `innerHTML` — makes safety a property of a
 * sanitiser's allowlist, which fails open the day it misses a shape. Here `markdown-it` only
 * TOKENISES, and each token becomes an element from {@link TAGS}; a tag not listed there
 * contributes its children as text and nothing else. There is no attribute copied from the
 * answer, so no `href`, `src`, `style` or `on…` can reach the page (B5: the unsafe output cannot
 * be expressed, rather than being caught).
 *
 * `html: false` and `linkify: false` are markdown-it's defaults, spelt so the parser and this file
 * agree — but THEY ARE NOT THE GUARD, and that was measured: with `html: true` the raw-HTML case
 * still passes, because an `html_inline` or `html_block` token is shown as text below like any
 * other. The guard is that no token becomes an element outside {@link TAGS}.
 *
 * ## Why markdown-it, measured rather than chosen
 *
 * ADR-0060 ran three parsers against hostile input, one per process: `marked` exhausted the heap
 * and aborted Node on 2,000 nested list levels and took 18 s on 100,000 unclosed `*a`, while
 * markdown-it answered every case in under half a second, its `maxNesting` of 100 stopping the
 * descent. A renderer that hung on a crafted answer would hang the window, so the parser that
 * stays bounded is the one this uses — and it is already in the tree, for the import host.
 *
 * ## Links and images are shown as their text
 *
 * A link in an answer would navigate the window, which the navigation guard refuses, or open a
 * site the model named — neither is something a reader asked the assistant for. An image would
 * fetch, which the CSP refuses. So both render the words they carry.
 */
const PARSER = new MarkdownIt('default', { html: false, linkify: false });

/**
 * The elements an answer may produce. Headings are absent: they are re-levelled by
 * {@link headingOf} so an answer's `#` sits below the panel's own headings.
 */
const TAGS: ReadonlySet<string> = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'strong',
  'em',
  's',
]);

/** An answer's `#` is a section of the answer, which is itself inside the panel's heading. */
function headingOf(tag: string): string | null {
  const level = /^h([1-6])$/u.exec(tag)?.[1];
  return level === undefined ? null : `h${String(Math.min(6, Number(level) + 2))}`;
}

/** How a run of plain text is shown — the panel splits citations out of it. */
export type AnswerText = (text: string, key: string) => ReactNode;

interface Frame {
  readonly tag: string | null;
  readonly start: string | null;
  readonly children: ReactNode[];
}

/**
 * The answer as elements, with every run of plain text passed through `text`.
 *
 * Code is never passed through `text`, so a `[p. 3]` inside a code span stays literal — it is
 * code the model quoted, not a reference it made.
 */
export function answerElements(answer: string, text: AnswerText): ReactNode[] {
  const root: Frame = { tag: null, start: null, children: [] };
  const stack: Frame[] = [root];
  let key = 0;
  const next = (): string => String((key += 1));
  const top = (): Frame => stack[stack.length - 1] ?? root;

  const visit = (token: Token): void => {
    if (token.nesting === 1) {
      const heading = headingOf(token.tag);
      stack.push({
        tag: heading ?? (TAGS.has(token.tag) ? token.tag : null),
        start: token.tag === 'ol' ? (token.attrGet('start')?.toString() ?? null) : null,
        children: [],
      });
      return;
    }
    if (token.nesting === -1) {
      const frame = stack.pop();
      if (frame === undefined || frame === root) return;
      top().children.push(
        frame.tag === null
          ? createElement(Fragment, { key: next() }, ...frame.children)
          : createElement(
              frame.tag,
              frame.start === null ? { key: next() } : { key: next(), start: Number(frame.start) },
              ...frame.children,
            ),
      );
      return;
    }
    switch (token.type) {
      case 'inline':
        for (const child of token.children ?? []) visit(child);
        return;
      case 'text':
      case 'html_inline':
      case 'html_block':
        top().children.push(text(token.content, next()));
        return;
      case 'image':
        // The alt text, which markdown-it keeps as the image's content.
        top().children.push(text(token.content, next()));
        return;
      case 'code_inline':
        top().children.push(createElement('code', { key: next() }, token.content));
        return;
      case 'fence':
      case 'code_block':
        top().children.push(
          createElement('pre', { key: next() }, createElement('code', null, token.content)),
        );
        return;
      case 'softbreak':
        top().children.push('\n');
        return;
      case 'hardbreak':
        top().children.push(createElement('br', { key: next() }));
        return;
      case 'hr':
        top().children.push(createElement('hr', { key: next() }));
        return;
      default:
        // A token type this renderer does not know contributes its text, never its markup.
        if (token.content !== '') top().children.push(text(token.content, next()));
    }
  };

  for (const token of PARSER.parse(answer, {})) visit(token);
  return root.children;
}
