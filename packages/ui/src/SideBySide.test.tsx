// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, fireEvent, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { type DrawComparePage, SideBySide, type SideDocument, type SidePreferences } from './SideBySide.js';

const LEFT = asDocId('00000000-0000-4000-8000-0000000051a1');
const RIGHT = asDocId('00000000-0000-4000-8000-0000000051b2');
const THIRD = asDocId('00000000-0000-4000-8000-0000000051c3');
const VERSION = asDocVersion(1);

const DOCUMENTS: readonly SideDocument[] = [
  { docId: LEFT, version: VERSION, byteLength: 100, name: 'contract-v1.pdf' },
  { docId: RIGHT, version: VERSION, byteLength: 100, name: 'contract-v2.pdf' },
  { docId: THIRD, version: VERSION, byteLength: 100, name: 'notes.pdf' },
];

/** Each half's parse: one page, at the version the half was handed. */
vi.mock('./documentView.js', () => ({
  openDocumentView: ({ version }: { version: unknown }) =>
    Promise.resolve({ document: { numPages: 1 }, version, close: () => Promise.resolve() }),
}));

vi.mock('./renderPage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: () => Promise.resolve({ width: 200, height: 200, crop: [0, 0, 200, 200] as const, rotation: 0 }),
  pageGeometry: () => Promise.resolve({ width: 200, height: 200, crop: [0, 0, 200, 200] as const, rotation: 0 }),
  renderRegion: () => Promise.resolve(),
}));

beforeEach(() => {
  // HAPPY-DOM FIRES NEITHER OBSERVER; the halves' page lists construct both at mount.
  const resize: { ResizeObserver: typeof ResizeObserver } = globalThis;
  resize.ResizeObserver = class {
    observe(): void {
      // Nothing here measures a box.
    }
    unobserve(): void {
      // Not called.
    }
    disconnect(): void {
      // Not asserted.
    }
  };
  const intersection: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  intersection.IntersectionObserver = class {
    observe(): void {
      // No page is reported visible.
    }
    unobserve(): void {
      // Not called.
    }
    disconnect(): void {
      // Not asserted.
    }
  } as unknown as typeof IntersectionObserver;
});

function Messages({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** Each document's one line of text, through the contract's own schemas. */
function clientFor(lines: ReadonlyMap<DocId, string>): { client: ContractClient; read: string[] } {
  const read: string[] = [];
  const client = createClient(channels, (id, params) => {
    const docId = (params as { docId: DocId }).docId;
    if (id === 'document.annotations') return Promise.resolve(ok({ version: VERSION, next: null, truncated: false, annotations: [] }));
    if (id === 'document.viewModel') {
      return Promise.resolve(ok({ version: VERSION, pageCount: 1, rotations: [0] }));
    }
    // NO ENGINE BOXES here: the words are placed by the estimate, which is this surface's concern only in that a mark exists.
    if (id === 'document.pageWordBoxes') return Promise.resolve(ok({ version: VERSION, lines: [], truncated: false }));
    if (id !== 'document.pageTextLayer') throw new Error(`unexpected channel ${id}`);
    read.push(docId);
    const text = lines.get(docId) ?? '';
    return Promise.resolve(
      ok({
        version: VERSION,
        lines: text === '' ? [] : [{ text, box: { x0: 10, y0: 10, x1: 10 + text.length * 5, y1: 20 } }],
        truncated: false,
        kind: 'text' as const,
      }),
    );
  });
  return { client, read };
}

/** A white page for every draw: the comparison's pictures agree, so only words can differ. */
const drawWhite: DrawComparePage = () =>
  Promise.resolve({
    raster: { width: 100, height: 100, pixelsPerPoint: 0.5, luminance: new Uint8Array(100 * 100).fill(255) },
    crop: [0, 0, 200, 200],
    rotation: 0,
  });

const PREFERENCES: SidePreferences = { unit: 'cm', tileAbove: 4, quality: 1, pageBadges: false, smoothScroll: false, zoomStep: 'ladder' };

async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function mount(
  client: ContractClient,
  overrides: Partial<{ left: SideDocument; right: SideDocument }> = {},
): {
  container: HTMLElement;
  picked: [string, DocId][];
  opened: string[];
  closed: number[];
  rerender: (left: SideDocument, right: SideDocument) => void;
} {
  const picked: [string, DocId][] = [];
  const opened: string[] = [];
  const closed: number[] = [];
  const ui = (left: SideDocument, right: SideDocument): ReactElement => (
    <SideBySide
      client={client}
      documents={DOCUMENTS}
      left={left}
      right={right}
      onPick={(side, docId) => picked.push([side, docId])}
      onOpenFile={(side) => opened.push(side)}
      onClose={() => closed.push(1)}
      draw={drawWhite}
      preferences={PREFERENCES}
    />
  );
  const [first, second] = DOCUMENTS;
  if (first === undefined || second === undefined) throw new Error('no fixture documents');
  const { container, rerender } = renderBare(ui(overrides.left ?? first, overrides.right ?? second), { wrapper: Messages });
  return {
    container,
    picked,
    opened,
    closed,
    rerender: (left, right) => {
      rerender(ui(left, right));
    },
  };
}

describe('Side by Side — the owner’s design: a header over two halves, each with its own toolbar', () => {
  it('names itself, lists every open document in each half, and shows the pair it was given', async () => {
    const { client } = clientFor(new Map());
    const { container } = mount(client);
    await settle();
    expect(screen.getByText('Side by Side')).toBeTruthy();
    expect(screen.getByText('Compare two open documents')).toBeTruthy();
    const left = container.querySelector<HTMLSelectElement>('[data-side-pick="left"]');
    const right = container.querySelector<HTMLSelectElement>('[data-side-pick="right"]');
    expect([left?.value, right?.value]).toStrictEqual([LEFT, RIGHT]);
    expect([...(right?.options ?? [])].map((option) => option.textContent)).toStrictEqual([
      'contract-v1.pdf',
      'contract-v2.pdf',
      'notes.pdf',
    ]);
  });

  it('a half’s list picks for THAT half, and its Open another PDF… asks for that half', async () => {
    const { client } = clientFor(new Map());
    const { container, picked, opened } = mount(client);
    await settle();
    const right = container.querySelector('[data-side-pick="right"]');
    if (right === null) throw new Error('no right-hand list');
    fireEvent.change(right, { target: { value: THIRD } });
    expect(picked).toStrictEqual([['right', THIRD]]);
    fireEvent.click(container.querySelector('[data-side-open="left"]') ?? document.body);
    expect(opened).toStrictEqual(['left']);
  });

  it('each half zooms on its own', async () => {
    const { client } = clientFor(new Map());
    const { container } = mount(client);
    await settle();
    const [zoomIn] = screen.getAllByRole('button', { name: 'Zoom in' });
    if (zoomIn === undefined) throw new Error('no zoom control');
    fireEvent.click(zoomIn);
    await settle();
    // FROM THE SHOWN 100% UP ONE STEP OF THE LADDER on the left; the right is still where it was.
    expect(container.querySelector('[data-side-zoom="left"]')?.textContent).toBe('125%');
    expect(container.querySelector('[data-side-zoom="right"]')?.textContent).not.toBe('125%');
  });

  it('Close and Esc both close it', async () => {
    const { client } = clientFor(new Map());
    const { container, closed } = mount(client);
    await settle();
    fireEvent.click(container.querySelector('[data-side-close]') ?? document.body);
    fireEvent.keyDown(container.querySelector('section[data-side-by-side]') ?? document.body, { key: 'Escape' });
    expect(closed).toStrictEqual([1, 1]);
  });
});

describe('Compare — the walk runs when asked, and its list jumps to each change', () => {
  it('Compare reads both documents and lists the changed words, with the pages they are on', async () => {
    const { client, read } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    const { container } = mount(client);
    await settle();
    // NOTHING IS READ FOR A COMPARISON until it is asked for (the page lists read their own text layers, so count
    // after mounting).
    const before = read.length;
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(read.length).toBeGreaterThan(before);
    expect(container.querySelector('[data-side-count]')?.textContent).toBe('1 difference');
    const row = container.querySelector<HTMLButtonElement>('[data-side-row="text"]');
    expect(row?.textContent).toContain('Text changed');
    expect(row?.textContent).toContain('Left page 1 · Right page 1');
    expect(row?.textContent).toContain('“brown” → “red”');

    // CHOSEN: the row says so, and is the one drawn stronger on the pages.
    if (row === null) throw new Error('no row');
    fireEvent.click(row);
    expect(row.getAttribute('aria-current')).toBe('true');
  });

  it('CONTROL: two documents with the same words report no differences', async () => {
    const { client } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick brown fox jumps over'],
      ]),
    );
    mount(client);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(screen.getByText('No differences found.')).toBeTruthy();
  });

  it('says WHAT is compared, and when NO page matches says the documents have nothing in common (the owner’s review, 2026-10-06)', async () => {
    // TWO UNRELATED FILES, as the owner compared: one page each and no words shared, so the alignment matches nothing and
    // the list is one page removed and one added — true, and read as an error without a word of explanation.
    const { client } = clientFor(
      new Map([
        [LEFT, 'Invoice number 4471 for the month of March totals three hundred'],
        [RIGHT, 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod'],
      ]),
    );
    const { container } = mount(client);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(container.querySelector('[data-side-what]')?.textContent).toContain('Pages are matched by what is on them');
    expect(container.querySelector('[data-side-what]')?.textContent).toContain('“Page removed”');
    expect(container.querySelector('[data-side-no-common]')?.textContent).toBe(
      'These documents have no pages in common. They look like different documents.',
    );
    expect(container.querySelectorAll('[data-side-row]').length).toBeGreaterThan(0);
  });

  it('CONTROL: documents that share a page get the explanation of what is compared and NOT the no-pages-in-common sentence', async () => {
    const { client } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    const { container } = mount(client);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(container.querySelector('[data-side-what]')).not.toBeNull();
    expect(container.querySelector('[data-side-no-common]')).toBeNull();
  });

  // THE OWNER'S REVIEW OF 0.1.9.0: the panel had no close, Cancel sat beside Compare, a second Compare walked again,
  // and Esc left Side by Side with the panel still open.
  it('the Differences close hides the panel; Compare then shows the HELD list again without reading anything', async () => {
    const { client, read } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    const { container, closed } = mount(client);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(container.querySelector('[data-side-count]')?.textContent).toBe('1 difference');
    const body = container.querySelector('.m-side__body');
    expect(body?.classList.contains('m-side__body--listed')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close Differences' }));
    await settle();
    expect(container.querySelector('[data-side-differences]')).toBeNull();
    expect(body?.classList.contains('m-side__body--listed')).toBe(false);
    // ONLY THE PANEL: Side by Side itself is still open.
    expect(closed).toStrictEqual([]);
    // THE FOCUS IS BACK ON THE SURFACE, so the next Esc reaches it.
    expect(document.activeElement).toBe(container.querySelector('section[data-side-by-side]'));

    const before = read.length;
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(container.querySelector('[data-side-count]')?.textContent).toBe('1 difference');
    expect(read.length).toBe(before);
  });

  it('Compare is DISABLED while the panel shows the current answer; CONTROL: a new version of either half enables it', async () => {
    const { client, read } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    const { rerender } = mount(client);
    await settle();
    const compare = screen.getByRole('button', { name: 'Compare' });
    expect(compare.getAttribute('aria-disabled')).not.toBe('true');
    compare.focus();
    fireEvent.click(compare);
    await settle();
    // THE SAME BUTTON, disabled AND STILL HOLDING THE FOCUS, so Esc goes on reaching the surface; a click does nothing.
    expect(screen.getByRole('button', { name: 'Compare' })).toBe(compare);
    expect(compare.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(compare);
    const before = read.length;
    fireEvent.click(compare);
    await settle();
    expect(read.length).toBe(before);

    const [first, second] = DOCUMENTS;
    if (first === undefined || second === undefined) throw new Error('no fixture documents');
    rerender(first, { ...second, version: asDocVersion(2) });
    await settle();
    expect(screen.getByRole('button', { name: 'Compare' }).getAttribute('aria-disabled')).not.toBe('true');
  });

  it('ONE DOCUMENT IN BOTH HALVES offers no Compare and says how to choose a second (8a, F-H2); CONTROL: a second enables it', async () => {
    const { client, read } = clientFor(new Map([[LEFT, 'The quick brown fox jumps over']]));
    const [first, second] = DOCUMENTS;
    if (first === undefined || second === undefined) throw new Error('no fixture documents');
    const { container, rerender } = mount(client, { left: first, right: first });
    await settle();

    const compare = screen.getByRole('button', { name: 'Compare' });
    expect(compare.getAttribute('aria-disabled')).toBe('true');
    const hint = container.querySelector('[data-side-alone]');
    expect(hint?.textContent).toBe('Choose a second document on the right, or open another PDF, to compare');
    // DESCRIBED BY THE HINT, so a screen reader that lands on the button hears why it does nothing.
    expect(compare.getAttribute('aria-describedby')).toBe(hint?.id);
    const before = read.length;
    fireEvent.click(compare);
    await settle();
    expect(read.length).toBe(before);

    rerender(first, second);
    await settle();
    expect(screen.getByRole('button', { name: 'Compare' }).getAttribute('aria-disabled')).not.toBe('true');
    expect(container.querySelector('[data-side-alone]')).toBeNull();
    expect(screen.getByText('Compare two open documents')).toBeTruthy();
  });

  it('while comparing, Compare BECOMES Stop in its place, and Stop ends the walk with no panel left', async () => {
    const { client } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    // A DRAW THAT WAITS until it is aborted, so the walk is still running when Stop is pressed.
    const held: DrawComparePage = (_view, _page, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('stopped', 'AbortError'));
        });
      });
    const closed: number[] = [];
    const [first, second] = DOCUMENTS;
    if (first === undefined || second === undefined) throw new Error('no fixture documents');
    const { container } = renderBare(
      <SideBySide
        client={client}
        documents={DOCUMENTS}
        left={first}
        right={second}
        onPick={() => undefined}
        onOpenFile={() => undefined}
        onClose={() => closed.push(1)}
        draw={held}
        preferences={PREFERENCES}
      />,
      { wrapper: Messages },
    );
    await settle();
    const compare = screen.getByRole('button', { name: 'Compare' });
    compare.focus();
    fireEvent.click(compare);
    await settle();
    expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' });
    // THE SAME ELEMENT, so the focus the press put on it stays there: the button before Close in the header.
    expect(stop).toBe(compare);
    expect(document.activeElement).toBe(stop);
    expect(stop.nextElementSibling?.hasAttribute('data-side-close')).toBe(true);
    fireEvent.click(stop);
    await settle();
    expect(screen.getByRole('button', { name: 'Compare' })).toBe(compare);
    expect(document.activeElement).toBe(compare);
    expect(container.querySelector('[data-side-differences]')).toBeNull();
    expect(closed).toStrictEqual([]);
  });

  it('Esc closes the Differences panel FIRST, and only the next Esc closes Side by Side', async () => {
    const { client } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    const { container, closed } = mount(client);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    const surface = container.querySelector('section[data-side-by-side]') ?? document.body;
    fireEvent.keyDown(surface, { key: 'Escape' });
    await settle();
    expect(container.querySelector('[data-side-differences]')).toBeNull();
    expect(closed).toStrictEqual([]);
    fireEvent.keyDown(surface, { key: 'Escape' });
    expect(closed).toStrictEqual([1]);
  });

  it('a different pair drops the list, so a comparison of two other documents is never shown', async () => {
    const { client } = clientFor(
      new Map([
        [LEFT, 'The quick brown fox jumps over'],
        [RIGHT, 'The quick red fox jumps over'],
      ]),
    );
    const { container, rerender } = mount(client);
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    await settle();
    expect(container.querySelector('[data-side-differences]')).not.toBeNull();
    const [first, , third] = DOCUMENTS;
    if (first === undefined || third === undefined) throw new Error('no fixture documents');
    rerender(first, third);
    await settle();
    expect(container.querySelector('[data-side-differences]')).toBeNull();
  });
});
