import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { PAGES_LEFT_MORE, PAGES_LEFT_SAID } from '../messages/en.js';
import type { PagesLeft } from './pagesLeft.js';

/** The most pages named one by one; past it the rest are counted, so a long document gives a sentence, not a page. */
const NAMED = 50;

/**
 * The pages a command left because they display nothing (ADR-0254): one sentence naming them as the person counts them,
 * from 1, and how many more. A default export because `declareDialog` takes a `lazy()` component.
 */
export default function PagesLeftBody({ pages }: PagesLeft): ReactElement {
  const { _ } = useLingui();
  const named = pages.slice(0, NAMED).map((page) => String(page + 1));
  const more = pages.length - named.length;
  return (
    <>
      <p className="m-pages-left__said" data-pages-left={pages.length}>
        {_(PAGES_LEFT_SAID, { pages: named.join(', ') })}
      </p>
      {more > 0 ? <p className="m-pages-left__more">{_(PAGES_LEFT_MORE, { count: more })}</p> : null}
    </>
  );
}
