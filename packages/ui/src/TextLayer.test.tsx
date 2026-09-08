// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TextLayer, type TextLayerLine } from './TextLayer.js';
import type { HighlightPainter, SearchHighlight } from './searchHighlight.js';

/**
 * What the text layer paints, and where it paints it.
 *
 * ## Why the assertions are about RANGES and not about pixels
 *
 * The CSS Custom Highlight API does not exist in this environment, and would
 * not tell us anything if it did — a painted highlight is a colour over a
 * transparent glyph, and *the wrong words highlighted* looks exactly as correct
 * as the right ones from inside a test. What separates a working feature from a
 * broken one is which nodes and which offsets the ranges cover, which is
 * observable and is what these cases read.
 *
 * The painter is injected for that reason. `sharedPainter()` answers `null` in
 * this environment, so a case that let the component reach for it would pass
 * whatever the component computed — including nothing at all.
 */

/** A line at a plausible box. The geometry is not what these cases are about. */
function lineOf(text: string, row: number): TextLayerLine {
  return { text, box: { x0: 10, y0: row * 20, x1: 200, y1: row * 20 + 16 } };
}

const GEOMETRY = { crop: [0, 0, 300, 400] as const, rotation: 0, zoom: 1 };

/** A painter that records the one page it is given. */
function recording(): {
  readonly painter: HighlightPainter;
  readonly pages: Map<number, { all: readonly Range[]; active: readonly Range[] } | null>;
} {
  const pages = new Map<number, { all: readonly Range[]; active: readonly Range[] } | null>();
  return {
    pages,
    painter: {
      setPage: (page, ranges) => {
        pages.set(page, ranges);
      },
      clear: () => {
        pages.clear();
      },
    },
  };
}

function draw(
  lines: readonly TextLayerLine[],
  search: SearchHighlight | undefined,
  painter: HighlightPainter,
): ReturnType<typeof render> {
  return render(
    <TextLayer geometry={GEOMETRY} lines={lines} page={3} painter={painter} search={search} />,
  );
}

/**
 * Which rendered line one end of a range sits in, by its `data-text-line`.
 *
 * Takes the range rather than a node so a missing range answers `null` instead
 * of needing an assertion at every call — and `null` is a value the cases can
 * fail on, where a non-null assertion would throw and report a different thing.
 */
function lineIndexOf(end: Node | undefined): string | null {
  return end?.parentElement?.getAttribute('data-text-line') ?? null;
}

describe('TextLayer search highlighting', () => {
  const LINES = [lineOf('the quick brown', 0), lineOf('fox jumps over', 1)];

  it('turns a match into a range over the LINE ELEMENT it sits in', () => {
    const { painter, pages } = recording();

    draw(LINES, { query: 'quick', options: {} }, painter);

    const entry = pages.get(3);
    expect(entry?.all).toHaveLength(1);
    const range = entry?.all[0];
    expect(lineIndexOf(range?.startContainer)).toBe('0');
    // THE OFFSETS, not just the node. A range over the right element at 0..0
    // paints nothing and would satisfy a case that only checked the container.
    expect(range?.startOffset).toBe(4);
    expect(range?.endOffset).toBe(9);
  });

  it('CONTROL: a query that is not on the page produces no ranges at all', () => {
    // Without this, a component that emitted one range per line regardless
    // would pass the case above for the wrong reason.
    const { painter, pages } = recording();

    draw(LINES, { query: 'absent', options: {} }, painter);

    expect(pages.get(3)?.all).toStrictEqual([]);
  });

  it('SPANS THE WRAP as ONE range across two line elements', () => {
    // The load-bearing case, and the reason `LineMatch` reports its end as a
    // (line, offset) pair. `brown fox` is on the page and on no line: a
    // per-line highlighter finds nothing here, and a highlighter that clamped
    // the end to the start's line would paint to the end of "brown" and stop.
    const { painter, pages } = recording();

    draw(LINES, { query: 'brown fox', options: {} }, painter);

    const range = pages.get(3)?.all[0];
    expect(range).toBeDefined();
    expect(lineIndexOf(range?.startContainer)).toBe('0');
    expect(lineIndexOf(range?.endContainer)).toBe('1');
    expect(range?.startOffset).toBe(10);
    expect(range?.endOffset).toBe(3);
  });

  it('marks the ACTIVE match, and it stays among the matches too', () => {
    const { painter, pages } = recording();

    draw(
      [lineOf('fox and fox', 0)],
      { query: 'fox', options: {}, active: { page: 3, line: 0, offset: 8 } },
      painter,
    );

    const entry = pages.get(3);
    expect(entry?.all).toHaveLength(2);
    expect(entry?.active).toHaveLength(1);
    expect(entry?.active[0]?.startOffset).toBe(8);
  });

  it('does not mark a match ACTIVE on a page that is not the active one', () => {
    // The control on the case above: comparing only the line and offset would
    // light up the same position on every page of the document.
    const { painter, pages } = recording();

    draw(
      [lineOf('fox and fox', 0)],
      { query: 'fox', options: {}, active: { page: 9, line: 0, offset: 8 } },
      painter,
    );

    expect(pages.get(3)?.active).toStrictEqual([]);
  });

  it('paints nothing for a pattern that does not compile, rather than throwing', () => {
    // A person types `(` on the way to typing `(a)`. A layer that threw would
    // take the page down for a half-written query, and the find bar already has
    // a state that says what happened.
    const { painter, pages } = recording();

    draw(LINES, { query: '(', options: { regex: true } }, painter);

    expect(pages.get(3)).toBeNull();
  });

  it('FORGETS the page when it unmounts, so a scrolled-away page paints nothing', () => {
    // A range over a detached node paints nothing and keeps the nodes alive.
    // The assertion is that `setPage` was called with `null` — the decision —
    // rather than that the registry ended up empty, which it also would if the
    // component had never contributed anything.
    const { painter, pages } = recording();
    const view = draw(LINES, { query: 'quick', options: {} }, painter);
    expect(pages.get(3)?.all).toHaveLength(1);

    view.unmount();

    expect(pages.get(3)).toBeNull();
  });

  it('contributes nothing while no search has been run', () => {
    const { painter, pages } = recording();

    draw(LINES, undefined, painter);

    expect(pages.get(3)).toBeNull();
  });
});
