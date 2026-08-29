// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

/**
 * The shell's UI-level half. `proof:rendererpolicy` covers the other one — that
 * the built bundle mounts inside a real Chromium under the pinned CSP — and
 * neither counts alone: this file would pass against a bundle that never
 * reaches a browser, and the proof would pass against any component at all
 * provided it rendered something.
 */
describe('App', () => {
  it('renders the document surface as a landmark', () => {
    const { container } = render(<App />);

    const surface = container.querySelector('main.m-document-surface');
    expect(surface).not.toBeNull();
  });

  it('renders no control, because none is wired yet', () => {
    const { container } = render(<App />);

    // THE ASSERTION IS THE WIRED-TOOLS RULE, not tidiness. A control that
    // renders and does nothing is a defect rather than a stepping stone, and the
    // shell is the exact moment somebody reaches for a placeholder toolbar. The
    // day a real button lands this case fails, which is when its reason gets
    // re-read — and it should then be replaced by a case naming the command that
    // button dispatches, never deleted.
    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0);
  });

  it('CONTROL: the query that finds no control would find one', () => {
    // Without this, the case above passes for a render that produced nothing at
    // all — including a component that threw and was caught somewhere, or a
    // selector with a typo in it. An empty result is a broken lookup as often as
    // it is a clean one.
    const { container } = render(
      <main>
        <button type="button" />
      </main>,
    );

    expect(container.querySelectorAll('button, a, input, select, textarea')).toHaveLength(1);
  });
});
