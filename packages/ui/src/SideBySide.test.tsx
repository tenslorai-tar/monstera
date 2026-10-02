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
