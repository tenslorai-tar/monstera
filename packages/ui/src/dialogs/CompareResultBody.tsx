import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import {
  COMPARE_RESULT_ADDED,
  COMPARE_RESULT_CLIPPED,
  COMPARE_RESULT_EXTRA_HERE,
  COMPARE_RESULT_EXTRA_OTHER,
  COMPARE_RESULT_NONE,
  COMPARE_RESULT_PAGE,
  COMPARE_RESULT_PARTIAL,
  COMPARE_RESULT_REFUSED,
  COMPARE_RESULT_REMOVED,
  COMPARE_RESULT_SUMMARY,
  COMPARE_RESULT_TRUNCATED,
  COMPARE_RESULT_WHAT,
} from '../messages/en.js';

type CompareResultProps =
  | { readonly kind: 'none' }
  | { readonly kind: 'refused' }
  | {
      readonly kind: 'compared';
      readonly otherName: string;
      readonly shared: number;
      readonly compared: number;
      readonly extraPages: number;
      readonly changedLines: number;
      readonly clippedPages: number;
      readonly pages: readonly {
        readonly page: number;
        readonly changes: readonly { readonly kind: 'removed' | 'added'; readonly text: string }[];
      }[];
    };

/**
 * The comparison's findings: what was compared and how, then each page's changed lines.
 *
 * ## The RULE is stated before the answer
 *
 * Page by number, words only. A reader who inserted a page in the middle of one document would
 * otherwise take a list of every later page as the documents disagreeing everywhere, and a
 * reader comparing two scans would take *no lines differ* as the pages being the same.
 *
 * ## Each line says which side it is on, in words and not only in colour
 *
 * `data-change` carries the kind for the stylesheet; the label carries it for a person, and for
 * a screen reader, which cannot see a colour.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CompareResultBody(props: CompareResultProps): ReactElement {
  const { _, i18n } = useLingui();
  const number = new Intl.NumberFormat(i18n.locale);

  if (props.kind === 'none') return <p className="m-compare-result">{_(COMPARE_RESULT_NONE)}</p>;
  if (props.kind === 'refused') return <p className="m-compare-result">{_(COMPARE_RESULT_REFUSED)}</p>;

  const listed = props.pages.reduce((sum, page) => sum + page.changes.length, 0);
  return (
    <div className="m-compare-result">
      <p>{_(COMPARE_RESULT_WHAT, { name: props.otherName })}</p>
      {props.compared < props.shared ? (
        <p data-partial="true">
          {_(COMPARE_RESULT_PARTIAL, { counted: number.format(props.compared), total: number.format(props.shared) })}
        </p>
      ) : (
        <p>{_(COMPARE_RESULT_SUMMARY, { count: props.changedLines, pages: number.format(props.shared) })}</p>
      )}
      {props.extraPages > 0 ? <p>{_(COMPARE_RESULT_EXTRA_HERE, { count: props.extraPages })}</p> : null}
      {props.extraPages < 0 ? (
        <p>{_(COMPARE_RESULT_EXTRA_OTHER, { count: -props.extraPages, name: props.otherName })}</p>
      ) : null}
      {props.clippedPages > 0 ? <p>{_(COMPARE_RESULT_CLIPPED, { count: props.clippedPages })}</p> : null}
      {props.pages.map((page) => (
        <section key={page.page} className="m-compare-result__page">
          <h3>{_(COMPARE_RESULT_PAGE, { page: number.format(page.page) })}</h3>
          <ul className="m-compare-result__changes">
            {page.changes.map((change, at) => (
              // THE POSITION IS THE KEY: a line removed and re-added elsewhere is two entries.
              <li key={at} data-change={change.kind}>
                <span className="m-compare-result__side">
                  {change.kind === 'removed'
                    ? _(COMPARE_RESULT_REMOVED)
                    : _(COMPARE_RESULT_ADDED, { name: props.otherName })}
                </span>
                <span className="m-compare-result__text">{change.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {listed < props.changedLines ? <p>{_(COMPARE_RESULT_TRUNCATED)}</p> : null}
    </div>
  );
}
