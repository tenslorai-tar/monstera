// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary.js';

/**
 * The one class component this build is permitted (ADR-0036).
 *
 * ## React logs every caught error, and these cases cause them deliberately
 *
 * React's default root handler writes a caught error to `console.error`, so a
 * file whose whole subject is throwing renders several pages of stack into a
 * passing run. It is silenced for the duration and RESTORED afterwards rather
 * than globally: a `console.error` from a case that was not meant to throw is a
 * diagnostic, and silencing the whole suite to tidy this file up would spend it.
 */
let logged: MockInstance;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
});

/** Throws when told to, so one mount can fail and the next succeed. */
function Fragile({ fail }: { readonly fail: unknown }): ReactElement {
  if (fail !== false) throw fail;
  return <p>the view</p>;
}

/** The fallback, as a caller supplies one: text plus the way back. */
function fallback({ reset }: { readonly reset: () => void }): ReactElement {
  return (
    <button type="button" data-retry="true" onClick={reset}>
      try again
    </button>
  );
}

describe('ErrorBoundary', () => {
  it('renders the FALLBACK when its subtree throws, instead of nothing', () => {
    // Finding AAAAAA-4's class at application scale. Without a boundary React
    // unmounts the whole tree — `@types/react:1216` says so — and the reader is
    // left with a blank window and no sentence, which is the defect this
    // component exists to close rather than a lesser version of it.
    const { container } = render(
      <ErrorBoundary fallback={fallback}>
        <Fragile fail={new Error('mid-render')} />
      </ErrorBoundary>,
    );

    expect(container.querySelector('[data-retry]')).not.toBeNull();
    expect(container.textContent).not.toContain('the view');
  });

  it('RENDERS ITS CHILDREN when nothing throws', () => {
    // The control for the case above, and it is not ceremony: a boundary that
    // rendered its fallback unconditionally passes that assertion perfectly and
    // is a shell with no application in it.
    const { container } = render(
      <ErrorBoundary fallback={fallback}>
        <Fragile fail={false} />
      </ErrorBoundary>,
    );

    expect(container.textContent).toContain('the view');
    expect(container.querySelector('[data-retry]')).toBeNull();
  });

  it('CATCHES A THROWN `null`, which a nullable error state cannot', () => {
    // THE BOX'S OWN CASE. `throw null` is valid JavaScript and a rejected
    // promise can carry one, so state shaped `error: unknown | null` cannot
    // tell *nothing was caught* from *null was caught* — it renders the
    // children again, they throw again, and the loop is invisible because the
    // screen never changes.
    //
    // Mutating `caught` back to a bare nullable error reddens this case and
    // nothing else in this file, which is what makes it worth its lines.
    const { container } = render(
      <ErrorBoundary fallback={fallback}>
        <Fragile fail={null} />
      </ErrorBoundary>,
    );

    expect(container.querySelector('[data-retry]')).not.toBeNull();
  });

  it('HANDS THE ERROR to `onError` rather than swallowing it', () => {
    // The other half of AAAAAA-4: a failure that looks like success to every
    // observer. The fallback tells the reader; this tells whoever logs.
    const told = vi.fn();
    const thrown = new Error('mid-render');

    render(
      <ErrorBoundary fallback={fallback} onError={told}>
        <Fragile fail={thrown} />
      </ErrorBoundary>,
    );

    expect(told).toHaveBeenCalledTimes(1);
    // The error ITSELF, not a message string: a boundary that reported
    // `String(error)` would satisfy "was told" and lose the stack.
    expect(told.mock.calls[0]?.[0]).toBe(thrown);
  });

  it('RESETS to the children, so the fallback is not a dead end', () => {
    // A fallback with a control that does nothing is the display-only defect
    // wearing an error state's clothes. The child is repaired between the two
    // renders, because a reset that re-threw immediately is indistinguishable
    // from one that never ran.
    const { container, rerender } = render(
      <ErrorBoundary fallback={fallback}>
        <Fragile fail={new Error('mid-render')} />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary fallback={fallback}>
        <Fragile fail={false} />
      </ErrorBoundary>,
    );
    // Still the fallback: a boundary that cleared itself on any re-render would
    // flicker the broken view back at every unrelated parent update.
    expect(container.textContent).not.toContain('the view');

    const retry = container.querySelector('[data-retry]');
    if (!(retry instanceof HTMLButtonElement)) throw new Error('the fallback renders a control');
    fireEvent.click(retry);

    expect(container.textContent).toContain('the view');
  });
});
