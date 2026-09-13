import { useLingui } from '@lingui/react';
import type { UrlFetchRefusal } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  URL_OPEN_ABSENT,
  URL_OPEN_AT_CAPACITY,
  URL_OPEN_BLOCKED_ADDRESS,
  URL_OPEN_CONTESTED,
  URL_OPEN_CREDENTIALS,
  URL_OPEN_HTTP_ERROR,
  URL_OPEN_NOT_A_PDF,
  URL_OPEN_NOT_HTTPS,
  URL_OPEN_TOO_LARGE,
  URL_OPEN_TOO_MANY_REDIRECTS,
  URL_OPEN_UNREACHABLE,
  URL_OPEN_UNRESOLVABLE,
  URL_OPEN_WRITE_FAILED,
} from '../messages/en.js';
import type { UrlOpenProblem } from './urlOpenProblem.js';

/**
 * Every guard refusal's sentence, in a RECORD keyed by the contract's list.
 *
 * A record rather than a switch with a default, so a reason the guard gains is a compile
 * error here instead of a person told the wrong thing — the defect `importMarkdown.ts`'
 * refusal mapping had while it was an if/else.
 */
const REFUSAL_SENTENCES: Readonly<Record<UrlFetchRefusal, MessageKey>> = {
  'not-https': URL_OPEN_NOT_HTTPS,
  credentials: URL_OPEN_CREDENTIALS,
  'blocked-address': URL_OPEN_BLOCKED_ADDRESS,
  unresolvable: URL_OPEN_UNRESOLVABLE,
  'too-many-redirects': URL_OPEN_TOO_MANY_REDIRECTS,
  'http-error': URL_OPEN_HTTP_ERROR,
  unreachable: URL_OPEN_UNREACHABLE,
  'too-large': URL_OPEN_TOO_LARGE,
  'not-a-pdf': URL_OPEN_NOT_A_PDF,
};

/**
 * The web-address problem dialog's body.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function UrlOpenProblemBody(props: UrlOpenProblem): ReactElement {
  const { _ } = useLingui();
  return (
    <div className="m-url-open-problem">
      <p>{_(sentence(props))}</p>
    </div>
  );
}

function sentence(problem: UrlOpenProblem): MessageKey {
  switch (problem.reason) {
    case 'destination-contested':
      return URL_OPEN_CONTESTED;
    case 'write-failed':
      return URL_OPEN_WRITE_FAILED;
    case 'absent':
      return URL_OPEN_ABSENT;
    case 'at-capacity':
      return URL_OPEN_AT_CAPACITY;
    // EVERY GUARD REASON NAMED, not defaulted: a reason the contract gains is then a
    // lint error here as well as a compile error in the record above.
    case 'not-https':
    case 'credentials':
    case 'blocked-address':
    case 'unresolvable':
    case 'too-many-redirects':
    case 'http-error':
    case 'unreachable':
    case 'too-large':
    case 'not-a-pdf':
      return REFUSAL_SENTENCES[problem.reason];
  }
}
