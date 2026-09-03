// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { type DocId, asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComparePane } from './ComparePane.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const FIRST = asDocId('00000000-0000-4000-8000-0000000000c1');
const SECOND = asDocId('00000000-0000-4000-8000-0000000000c2');

/**
 * How many pages each document has, so the two panes are distinguishable.
 *
 * A fixture where both documents had the same shape could not tell a pane
 * showing the CHOSEN document from one showing the first again — which is the
 * defect a compare pane built on split view's single parser would have.
 */
const PAGES: Readonly<Record<string, number>> = { [FIRST]: 2, [SECOND]: 5 };

/** Every document a view was opened for, in order. */
let parsed: DocId[] = [];

vi.mock('./documentView.js', () => ({
  openDocumentView: ({ docId }: { docId: DocId }) => {
    parsed.push(docId);
    return Promise.resolve({
      document: { numPages: PAGES[docId] ?? 1 },
      close: () => Promise.resolve(),
    });
  },
}));

vi.mock('./renderPage.js', () => ({
  renderPage: () => Promise.resolve({ width: 595, height: 842 }),
}));

const DOCUMENTS = [
  { docId: FIRST, version: asDocVersion(1), byteLength: 1024, name: 'annual.pdf' },
  { docId: SECOND, version: asDocVersion(1), byteLength: 2048, name: 'notes.pdf' },
];

function client(): ContractClient {
  return createClient(channels, (id) => {
    if (id === 'document.readRange') {
      return Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array(8) }));
    }
    if (id === 'document.viewModel') {
      return Promise.resolve(ok({ version: asDocVersion(1), pageCount: 2, rotations: [] }));
    }
    throw new Error(`this fixture has no answer for ${id}`);
  });
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

beforeEach(() => {
  parsed = [];
  const resize: { ResizeObserver: typeof ResizeObserver } = globalThis;
  resize.ResizeObserver = class {
    observe(): void {
      // Nothing here measures a viewport.
    }
    unobserve(): void {
      // Not called by these components.
    }
    disconnect(): void {
      // Recorded by absence.
    }
  };
  const target: { IntersectionObserver: typeof IntersectionObserver } = globalThis;
  target.IntersectionObserver = class {
    observe(): void {
      // Never fired here: what these cases read is which document was parsed.
    }
    unobserve(): void {
      // See above.
    }
    disconnect(): void {
      // See above.
    }
  } as unknown as typeof IntersectionObserver;
});

function pane(against: DocId | undefined, onPick = vi.fn()): ReturnType<typeof render> {
  return render(
    <Wrapped>
      <ComparePane
        client={client()}
        against={DOCUMENTS.find((document) => document.docId === against)}
        others={DOCUMENTS}
        onPick={onPick}
        mode={{ kind: 'scale', scale: 1 }}
        onZoom={vi.fn()}
        loupe={false}
        rulers={false}
        showGrid={false}
        unit="in"
      />
    </Wrapped>,
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ComparePane', () => {
  it('OPENS ITS OWN PARSER for the chosen document', async () => {
    // The cost, asserted rather than assumed. Split view's property is that two
    // viewports cost one parse; comparison cannot have it, because two
    // documents are two parses — and a pane that reported a second document
    // while reading the first's pages through the first's parser would look
    // identical until the page counts differed.
    const { container } = pane(SECOND);
    await settle();

    expect(parsed).toStrictEqual([SECOND]);
    // FIVE SLOTS, which is the second document's page count and not the
    // first's. A pane reusing the first parser would lay out two.
    expect(container.querySelectorAll('.m-page-slot')).toHaveLength(5);
  });

  it('NAMES ITS REGION WITH THE DOCUMENT IN IT', async () => {
    // Two scrollable regions a screen-reader user cannot tell apart is what
    // the split view's label exists to prevent; here they hold different
    // documents, so the name has something true to say and a fixed "second
    // view" would throw it away.
    const { container } = pane(SECOND);
    await settle();

    expect(container.querySelector('.m-page-list')?.getAttribute('aria-label')).toBe(
      'Second view: notes.pdf',
    );
  });

  it('PARSES NOTHING when the choice is this document again', async () => {
    // The control, and it is the one that protects split view. Choosing *this
    // document* must return the pane to a second viewport over the first
    // parser — a pane that opened a view anyway would silently double the
    // renderer's budget for the arrangement that exists not to.
    const { container } = pane(undefined);
    await settle();

    expect(parsed).toStrictEqual([]);
    expect(container.querySelector('.m-page-list')).toBeNull();
    // AND THE PICKER IS STILL THERE, so the case is not passing because the
    // pane rendered nothing at all — which is also what a broken pane does.
    expect(container.querySelector('[data-compare-pick]')).not.toBeNull();
  });

  it('OFFERS EVERY OPEN DOCUMENT, and reports the id rather than the position', async () => {
    // An index and an id agree on the first choice for ever and stop agreeing
    // the moment a document closes — at which point an index-dispatching
    // picker compares against a different file, silently.
    const picked = vi.fn();
    const { container } = pane(undefined, picked);
    await settle();

    const select = container.querySelector('[data-compare-pick]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('the pane renders a picker');
    // THREE OPTIONS: both documents and *this document*, which is a value
    // rather than an absent selection so a reader can return to it.
    expect(select.options).toHaveLength(3);

    fireEvent.change(select, { target: { value: SECOND } });

    expect(picked).toHaveBeenCalledWith(SECOND);

    fireEvent.change(select, { target: { value: '' } });
    expect(picked).toHaveBeenLastCalledWith(undefined);
  });
});
