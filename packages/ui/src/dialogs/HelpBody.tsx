import { useLingui } from '@lingui/react';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import type { Article, Block, Inline } from '../help/article.js';
import { HELP_ARTICLES, helpArticle, searchHelp } from '../help/articles.js';
import { HELP_ALL, HELP_ARTICLE_COUNT, HELP_BACK, HELP_HERE, HELP_NONE, HELP_SEARCH, HELP_SHOW_ME } from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { HelpAnswer } from './help.js';

/** A run of an article's text as elements. An address is text to select and copy, never a link (`article.ts`). */
function inline(parts: readonly Inline[]): ReactNode[] {
  return parts.map((part, index) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'bold':
        return <strong key={index}>{part.text}</strong>;
      case 'code':
        return <code key={index}>{part.text}</code>;
      case 'address':
        return (
          <span className="m-help__address" key={index}>
            {part.text}
          </span>
        );
    }
  });
}

/**
 * One block as elements. The article's title is the view's heading, so an article's own `##` is one level below it and
 * `###` two: a document outline a screen reader can walk.
 */
function block(each: Block, index: number): ReactElement {
  switch (each.kind) {
    case 'heading':
      return each.level === 2 ? <h4 key={index}>{inline(each.inline)}</h4> : <h5 key={index}>{inline(each.inline)}</h5>;
    case 'paragraph':
      return <p key={index}>{inline(each.inline)}</p>;
    case 'numbered':
    case 'bulleted': {
      const items = each.items.map((item, at) => (
        <li key={at}>
          {inline(item.inline)}
          {item.nested.length === 0 ? null : (
            <ul>
              {item.nested.map((nested, n) => (
                <li key={n}>{inline(nested)}</li>
              ))}
            </ul>
          )}
        </li>
      ));
      return each.kind === 'numbered' ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    case 'table':
      return (
        <div className="m-help__table" key={index}>
          <table>
            <thead>
              <tr>
                {each.header.map((cell, at) => (
                  <th key={at} scope="col">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {each.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, c) => (
                    <td key={c}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** A list of articles, each a button naming it and saying what it is for. */
function ArticleList({
  articles,
  onOpen,
}: {
  readonly articles: readonly Article[];
  readonly onOpen: (id: string) => void;
}): ReactElement {
  return (
    <ul className="m-help__list">
      {articles.map((article) => (
        <li key={article.id}>
          <button className="m-help__item" data-article={article.id} 
            onClick={() => {
              onOpen(article.id);
            }}
            type="button"
          >
            <span className="m-help__item-title">{article.title}</span>
            <span className="m-help__item-summary">{article.summary}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Help centre's body
 * ([ADR-0112](../../../../docs/DECISIONS/0112-the-help-centre-is-bundled-articles-and-f1-opens-the-one-for-where-you-are.md)):
 * a search over every article, the list, and one article at a time.
 *
 * ## Where it opens
 *
 * On the article the opener named, when there is one; else on the list, with the articles for the opener's context
 * first under *For what you are doing*. Searching always searches everything.
 *
 * ## *Show me* answers, and the opener rings the control
 *
 * The body cannot reach the ribbon and should not: it answers with the command, the dialog closes, and the command that
 * opened it brings the control to the front. Drawn only for the commands `showable` names, each labelled by the
 * command's own title — a *Show me* whose control is not on screen would ring nothing.
 *
 * ## Focus follows the view
 *
 * Opening an article moves focus to its heading, and going back returns it to the search field, so a keyboard or
 * screen reader user is never left on a control the change removed.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function HelpBody({
  article: initial,
  context,
  showable,
  resolve,
}: {
  readonly article: string | null;
  readonly context: string | null;
  readonly showable: readonly { readonly id: string; readonly title: MessageKey }[];
} & DialogAnswering<HelpAnswer>): ReactElement {
  const { _ } = useLingui();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Article | undefined>(() => (initial === null ? undefined : helpArticle(initial)));
  const heading = useRef<HTMLHeadingElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    // NOT ON FIRST DRAW: the dialog primitive places the first focus, and an article opened by F1 is read from the top.
    if (!moved.current) return;
    if (open !== undefined) heading.current?.focus();
    else list.current?.querySelector('input')?.focus();
  }, [open]);

  const here = useMemo(() => (context === null ? [] : HELP_ARTICLES.filter((each) => each.contexts.includes(context))), [context]);
  const found = useMemo(() => searchHelp(query), [query]);
  const go = (next: Article | undefined): void => {
    moved.current = true;
    setOpen(next);
  };
  const openArticle = (id: string): void => {
    go(helpArticle(id));
  };

  if (open !== undefined) {
    const shows = showable.filter((each) => open.commands.includes(each.id));
    return (
      <article className="m-help__article">
        <Button
          label={HELP_BACK}
          icon="ChevronLeft"
          onClick={() => {
            go(undefined);
          }}
        />
        <h3 ref={heading} tabIndex={-1}>
          {open.title}
        </h3>
        {shows.length === 0 ? null : (
          <div aria-label={_(HELP_SHOW_ME)} className="m-help__show" role="group">
            <span aria-hidden="true">{_(HELP_SHOW_ME)}</span>
            {shows.map((each) => (
              <Button
                key={each.id}
                label={each.title}
                onClick={() => {
                  resolve({ kind: 'show', command: each.id });
                }}
              />
            ))}
          </div>
        )}
        {open.blocks.map(block)}
      </article>
    );
  }

  const searching = query.trim() !== '';
  return (
    <div className="m-help" ref={list}>
      <Input label={HELP_SEARCH} onValueChange={setQuery} value={query} />
      <p className="m-help__count" role="status">
        {searching ? (found.length === 0 ? _(HELP_NONE) : _(HELP_ARTICLE_COUNT, { count: found.length })) : null}
      </p>
      {searching ? (
        <ArticleList articles={found} onOpen={openArticle} />
      ) : (
        <>
          {here.length === 0 ? null : (
            <section aria-labelledby="m-help-here">
              <h3 id="m-help-here">{_(HELP_HERE)}</h3>
              <ArticleList articles={here} onOpen={openArticle} />
            </section>
          )}
          <section aria-labelledby="m-help-all">
            <h3 id="m-help-all">{_(HELP_ALL)}</h3>
            <ArticleList articles={HELP_ARTICLES} onOpen={openArticle} />
          </section>
        </>
      )}
    </div>
  );
}
