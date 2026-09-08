// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HIGHLIGHT_ACTIVE,
  HIGHLIGHT_ALL,
  createHighlightPainter,
  platformSink,
  resetSharedPainter,
  sharedPainter,
} from './searchHighlight.js';

/**
 * A sink that records what it was told, so the composition is what is asserted.
 *
 * The painter's whole job is to turn several pages' contributions into two
 * named sets, and the platform registry it normally writes to does not exist in
 * this environment — so a test that could only observe `CSS.highlights` would
 * be a test that never ran. The recording sink is the seam that makes the
 * decision observable rather than the side effect.
 */
function recording(): {
  readonly sink: Parameters<typeof createHighlightPainter>[0];
  readonly shown: Map<string, readonly Range[]>;
  readonly hidden: string[];
} {
  const shown = new Map<string, readonly Range[]>();
  const hidden: string[] = [];
  return {
    shown,
    hidden,
    sink: {
      show: (name, ranges) => {
        shown.set(name, ranges);
        // A NAME THAT WAS SHOWN IS NO LONGER HIDDEN, because the real registry
        // has one entry per name and `set` after `delete` leaves it present.
        // A recorder that kept both would let a case assert "hidden" about a
        // name that is on screen.
        const at = hidden.indexOf(name);
        if (at >= 0) hidden.splice(at, 1);
      },
      hide: (name) => {
        shown.delete(name);
        if (!hidden.includes(name)) hidden.push(name);
      },
    },
  };
}

/** A range standing for one match. Its contents are never read here. */
function someRange(): Range {
  return document.createRange();
}

/**
 * Stands in for the `Highlight` constructor the platform provides.
 *
 * It keeps the ranges it was handed rather than being empty, because the
 * detection under test checks that the global is *constructible* — and a class
 * that discarded its argument would leave the case unable to say the ranges
 * ever reached it, if a later case wanted to.
 */
class FakeHighlight {
  readonly ranges: readonly Range[];

  constructor(...ranges: readonly Range[]) {
    this.ranges = ranges;
  }
}

describe('the highlight painter', () => {
  afterEach(() => {
    resetSharedPainter();
  });

  it('composes EVERY mounted page, rather than the last one to render', () => {
    // The defect this exists for: each text layer knows only its own ranges, so
    // a painter that let each write the registry directly would show whichever
    // page rendered last and erase the rest.
    const { sink, shown } = recording();
    const painter = createHighlightPainter(sink);
    const first = someRange();
    const second = someRange();

    painter.setPage(0, { all: [first], active: [] });
    painter.setPage(1, { all: [second], active: [] });

    expect(shown.get(HIGHLIGHT_ALL)).toStrictEqual([first, second]);
  });

  it('orders by PAGE NUMBER, not by the order the pages mounted', () => {
    // A scroller reaching page 5 and then scrolling back mounts 4 after 5.
    const { sink, shown } = recording();
    const painter = createHighlightPainter(sink);
    const later = someRange();
    const earlier = someRange();

    painter.setPage(5, { all: [later], active: [] });
    painter.setPage(4, { all: [earlier], active: [] });

    expect(shown.get(HIGHLIGHT_ALL)).toStrictEqual([earlier, later]);
  });

  it('drops a page that scrolled away, and keeps the others', () => {
    // The control on the case above: a painter that ignored removal would pass
    // every composition assertion and grow a set of ranges over detached nodes.
    const { sink, shown } = recording();
    const painter = createHighlightPainter(sink);
    const staying = someRange();

    painter.setPage(0, { all: [staying], active: [] });
    painter.setPage(1, { all: [someRange()], active: [] });
    painter.setPage(1, null);

    expect(shown.get(HIGHLIGHT_ALL)).toStrictEqual([staying]);
  });

  it('HIDES a name with nothing in it rather than showing an empty set', () => {
    // An empty `Highlight` is legal and paints nothing, so the two look
    // identical on screen — and a registry holding an entry for a search that
    // ended is a thing the next reader has to work out is inert.
    const { sink, shown, hidden } = recording();
    const painter = createHighlightPainter(sink);

    painter.setPage(0, { all: [someRange()], active: [] });

    expect(shown.has(HIGHLIGHT_ALL)).toBe(true);
    expect(hidden).toContain(HIGHLIGHT_ACTIVE);
  });

  it('keeps the ACTIVE range in both sets, because it is also a match', () => {
    // A reader stepping to a match expects it to stay highlighted, more
    // strongly. Putting it only in the active set would make the stylesheet's
    // two rules mutually exclusive, which is not what the design says.
    const { sink, shown } = recording();
    const painter = createHighlightPainter(sink);
    const current = someRange();
    const other = someRange();

    painter.setPage(0, { all: [other, current], active: [current] });

    expect(shown.get(HIGHLIGHT_ALL)).toStrictEqual([other, current]);
    expect(shown.get(HIGHLIGHT_ACTIVE)).toStrictEqual([current]);
  });

  it('clears everything, and both names go with it', () => {
    const { sink, shown, hidden } = recording();
    const painter = createHighlightPainter(sink);
    painter.setPage(0, { all: [someRange()], active: [someRange()] });

    painter.clear();

    expect(shown.size).toBe(0);
    expect(hidden).toStrictEqual([HIGHLIGHT_ALL, HIGHLIGHT_ACTIVE]);
  });
});

describe('finding the platform registry', () => {
  afterEach(() => {
    resetSharedPainter();
    Reflect.deleteProperty(globalThis, 'CSS');
    Reflect.deleteProperty(globalThis, 'Highlight');
  });

  it('answers NULL where the API is absent, which is this environment', () => {
    // Not a defensive check: happy-dom has neither, and every browser without
    // the API is the same case. The feature has to be silent there rather than
    // throwing on the first search.
    expect(platformSink()).toBeNull();
    expect(sharedPainter()).toBeNull();
  });

  it('CONTROL: it finds a registry when the window has one', () => {
    // Without this, a detection that answered `null` unconditionally would pass
    // the case above perfectly — and the feature would be dead in every
    // browser, reported by nothing.
    const set = vi.fn();
    const remove = vi.fn();
    Reflect.set(globalThis, 'CSS', { highlights: { set, delete: remove } });
    Reflect.set(globalThis, 'Highlight', FakeHighlight);

    const sink = platformSink();
    expect(sink).not.toBeNull();

    const range = someRange();
    sink?.show(HIGHLIGHT_ALL, [range]);
    // THE NAME AND THE FACT IT WAS CONSTRUCTED, rather than the ranges: the
    // registry takes a `Highlight`, not a list, so asserting the list would be
    // asserting something this code does not pass.
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]?.[0]).toBe(HIGHLIGHT_ALL);

    sink?.hide(HIGHLIGHT_ALL);
    expect(remove).toHaveBeenCalledWith(HIGHLIGHT_ALL);
  });

  it('resolves the shared painter ONCE, so pages contribute to the same one', () => {
    // The illegal state is two painters: the second would hold none of the
    // first's pages and would erase them on its first write.
    Reflect.set(globalThis, 'CSS', { highlights: { set: vi.fn(), delete: vi.fn() } });
    Reflect.set(globalThis, 'Highlight', FakeHighlight);

    expect(sharedPainter()).toBe(sharedPainter());
  });
});
