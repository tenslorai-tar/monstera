import { useLingui } from '@lingui/react';
import { citationsIn } from '@monstera/contract';
import type { ReactElement } from 'react';

import type { ConversationTurn } from './documentStores.js';
import { ASSISTANT_NO_PAGE_CITED, ASSISTANT_WEB_SOURCE, ASSISTANT_WEB_SOURCES, ASSISTANT_WEB_UNUSED } from './messages/en.js';

/**
 * What a finished answer rested on, under it (ADR-0108; work list 2026-09-26, items 5a and 5c).
 *
 * - **No page cited** — an answer about a document that names none of its pages is one a person should check
 *   against the document, and says so. An answer to a question about nothing is not marked: there was no page to cite.
 * - **From the web** — each source the provider's search cited, as a title and a site, opening in the browser by
 *   its place (`ai.openSource`); the address never reaches this page.
 * - **No web search was used** — an answer asked with *Document + web* whose provider reported no search: the web
 *   was offered and not taken, which the person would otherwise assume it was.
 */
export function AnswerGrounding({
  answer,
  question,
  open,
}: {
  readonly answer: ConversationTurn;
  /** The turn that asked it — what it was about. */
  readonly question: ConversationTurn | undefined;
  readonly open: (answer: string, index: number) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const text = answer.text.trim();
  if (text === '') return null;
  const aboutDocument = question?.request?.about !== undefined;
  const citesAPage = citationsIn(answer.text).some((piece) => 'cited' in piece);
  const web = answer.web;
  const uncited = aboutDocument && !citesAPage;
  if (!uncited && web === undefined) return null;

  return (
    <div className="m-assistant__grounding" data-assistant-grounding="">
      {uncited && (
        <p className="m-assistant__uncited" data-assistant-uncited="">
          {i18n._(ASSISTANT_NO_PAGE_CITED)}
        </p>
      )}
      {web !== undefined && web.sources.length > 0 && (
        <div aria-label={i18n._(ASSISTANT_WEB_SOURCES)} className="m-assistant__web" data-assistant-web-sources="" role="group">
          <p className="m-assistant__web-label">{i18n._(ASSISTANT_WEB_SOURCES)}</p>
          <ul className="m-assistant__web-list">
            {web.sources.map((source, index) => (
              <li key={`${source.host}-${String(index)}`}>
                <button
                  className="m-assistant__web-source"
                  data-assistant-web-source={index}
                  onClick={() => {
                    open(web.answer, index);
                  }}
                  type="button"
                >
                  {i18n._(ASSISTANT_WEB_SOURCE, { title: source.title, host: source.host })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {web !== undefined && !web.searched && (
        <p className="m-assistant__uncited" data-assistant-web-unused="">
          {i18n._(ASSISTANT_WEB_UNUSED)}
        </p>
      )}
    </div>
  );
}
