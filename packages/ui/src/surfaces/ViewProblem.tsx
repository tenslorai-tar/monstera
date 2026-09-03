import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { VIEW_PROBLEM_BODY, VIEW_PROBLEM_RETRY, VIEW_PROBLEM_TITLE } from '../messages/en.js';

/**
 * What a reader sees when the document view throws mid-render.
 *
 * ## The strings live here and not in the boundary
 *
 * `ErrorBoundary` is the one class component this build is permitted
 * (ADR-0036) and carries no application concerns, text included. So the
 * fallback is an ordinary function component, its sentences pass through B9's
 * catalogue like every other, and the class stays the mechanism React makes us
 * write and nothing more.
 *
 * ## What it may and may not promise
 *
 * §10.5a's guarantee is that a reader comes back to **the same document, the
 * same page and the same zoom**, and that is true because `App` holds those
 * three above the boundary — a shape, not a restore. So the retry control can
 * honestly say *try again* rather than *reload*, which would suggest losing the
 * place.
 *
 * The error itself is deliberately **not shown**. A React error's message is
 * written for whoever wrote the code, and a reader offered a stack has been
 * handed a job rather than an explanation; §10.5's error state is *what went
 * wrong and what to do next*. Where the error goes instead is the boundary's
 * `onError`, and React's own root handler logs it regardless.
 *
 * `role="alert"` for `StartScreen`'s reason: this appears in response to
 * something the reader just did, and there is nothing else on screen that
 * answers them.
 */
export function ViewProblem({ onRetry }: { readonly onRetry: () => void }): ReactElement {
  const { _ } = useLingui();

  return (
    <div className="m-view-problem" role="alert">
      <p className="m-view-problem-title">{_(VIEW_PROBLEM_TITLE)}</p>
      <p>{_(VIEW_PROBLEM_BODY)}</p>
      <button type="button" data-view-retry="true" onClick={onRetry}>
        {_(VIEW_PROBLEM_RETRY)}
      </button>
    </div>
  );
}
