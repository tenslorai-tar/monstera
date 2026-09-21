import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import type { MessageKey } from '@monstera/shared';

import {
  DIALOG_PROBLEM_BODY,
  DIALOG_PROBLEM_TITLE,
  VIEW_PROBLEM_BODY,
  VIEW_PROBLEM_RETRY,
  VIEW_PROBLEM_TITLE,
  WINDOW_PROBLEM_BODY,
  WINDOW_PROBLEM_TITLE,
} from '../messages/en.js';

/**
 * Where the boundary that caught the failure sits, which decides what survived.
 *
 * - `document`: the page area's boundary; the reader's document, page and zoom live above it.
 * - `window`: the application's outermost boundary, inside `App`, so the open tabs survive.
 * - `dialog`: one dialog's body. There is no retry, because React caches a lazy body's failed
 *   import and a second mount fails identically; the dialog's own close button is the way out.
 */
export type ProblemScope = 'document' | 'window' | 'dialog';

const TEXT: Readonly<Record<ProblemScope, { readonly title: MessageKey; readonly body: MessageKey }>> = {
  document: { title: VIEW_PROBLEM_TITLE, body: VIEW_PROBLEM_BODY },
  window: { title: WINDOW_PROBLEM_TITLE, body: WINDOW_PROBLEM_BODY },
  dialog: { title: DIALOG_PROBLEM_TITLE, body: DIALOG_PROBLEM_BODY },
};

/**
 * What a reader sees when part of the window throws mid-render — the document view, the window
 * around it, or one dialog's body ({@link ProblemScope}). The paragraphs below were written for
 * the view and hold for the window; a dialog offers no retry.
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
export function ViewProblem(
  props:
    | { readonly scope?: 'document' | 'window'; readonly onRetry: () => void }
    | { readonly scope: 'dialog' },
): ReactElement {
  const { _ } = useLingui();
  const scope = props.scope ?? 'document';
  const text = TEXT[scope];

  return (
    <div className="m-view-problem" role="alert" data-problem-scope={scope}>
      <p className="m-view-problem-title">{_(text.title)}</p>
      <p>{_(text.body)}</p>
      {'onRetry' in props ? (
        <button type="button" data-view-retry="true" onClick={props.onRetry}>
          {_(VIEW_PROBLEM_RETRY)}
        </button>
      ) : null}
    </div>
  );
}
