// @vitest-environment happy-dom
/**
 * The component-test vehicle itself, before anything is built on it.
 *
 * Every case here is about the HARNESS, not about a component. It exists
 * because unit 2 builds four primitives whose whole reason for existing is a
 * focus trap, keyboard handling and an accessible name — and a harness that
 * cannot observe focus, or that leaves a previous test's DOM standing, would
 * let all four ship green while verifying nothing. That is the display-only
 * sin one layer down: the button dispatches into the void, and so does the
 * test.
 *
 * Checklist 4a: an instrument is fed two values that differ by the smallest
 * amount that would change a decision, and must report them as different. For
 * a focus trap the two values are *focus is on A* and *focus is on B*, so that
 * pair is asserted below rather than assumed to work.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('the component-test vehicle', () => {
  it('runs in happy-dom, not in some other DOM that happens to be present', () => {
    // Named rather than inferred from `typeof document`. A silent swap to
    // jsdom — a transitive dependency pulling it in, a config edit — would
    // change the vehicle's behaviour under the primitives with nothing red,
    // and ADR-0004 pins this choice on a measured 7-vs-38 package cost.
    expect('happyDOM' in globalThis.window).toBe(true);
  });

  it('renders React through the library and finds elements by accessible role', () => {
    render(<button type="button">Open</button>);

    // BY ROLE, not by test id. §10.4 puts accessibility in the substrate, and a
    // query that reads the accessibility tree is the one that goes red when a
    // control loses its name — a `data-testid` lookup passes for a div.
    expect(screen.getByRole('button', { name: 'Open' })).toBeDefined();

    // The presence half of the cleanup pair below. Without it, the next case's
    // assertion is satisfied by a vehicle that never rendered anything at all —
    // absence produces exactly the reassuring answer it is looking for.
    expect(document.body.childElementCount).toBeGreaterThan(0);
  });

  it('has unmounted the previous case, without that case asking it to', () => {
    // THE REGISTRATION IS WHAT IS UNDER TEST, not `cleanup` itself. Calling
    // cleanup here and watching the DOM empty would pass even when nothing has
    // registered it — and nothing does register it under `globals: false`,
    // which is how this repository runs. The only observation that separates
    // the two is a later test reading what an earlier test left behind.
    expect(document.body.childElementCount).toBe(0);

    // And the file must not reduce to proving emptiness: rendering still works
    // after a cleanup has run.
    render(<button type="button">Save</button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('reports focus moving between two elements as two different readings', () => {
    render(
      <div>
        <button type="button">First</button>
        <button type="button">Second</button>
      </div>,
    );
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });

    first.focus();
    expect(document.activeElement).toBe(first);

    second.focus();
    expect(document.activeElement).toBe(second);

    // The resolution test proper. The two assertions above both hold in a DOM
    // where `focus()` does nothing and `activeElement` is always `document.body`
    // — they would simply both be `body` — so the separating claim is that the
    // two readings are not each other.
    expect(first).not.toBe(second);
    expect(document.activeElement).not.toBe(first);
  });

  it('dispatches keyboard events to the focused element', () => {
    const seen: string[] = [];
    render(
      <button type="button" onKeyDown={(event): void => void seen.push(event.key)}>
        Close
      </button>,
    );
    const button = screen.getByRole('button', { name: 'Close' });
    button.focus();
    button.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    // A dialog's Escape handling and a focus trap's Tab handling are both this
    // one capability. If it were absent, unit 2's keyboard cases would assert
    // over an array nothing ever pushes to, and every one of them would pass.
    expect(seen).toEqual(['Escape']);
  });
});
