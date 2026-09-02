// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { LinksPanel } from './LinksPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000cc');

/**
 * The links panel.
 *
 * The client is built from the CONTRACT, so every answer these cases invent
 * goes through the real schemas — a panel that expected a shape the channel
 * cannot carry would fail here rather than in the product.
 */
function clientAnswering(
  links: readonly unknown[],
  options: { refuse?: boolean } = {},
): { client: ContractClient; asked: unknown[] } {
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.pageLinks') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      options.refuse === true
        ? err({ code: 'document-busy' })
        : ok({ version: asDocVersion(1), links }),
    );
  });
  return { client, asked };
}

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const INTERNAL = { kind: 'internal', page: 4, bounds: { x0: 1, y0: 2, x1: 3, y1: 4 } };
const EXTERNAL = {
  kind: 'external',
  uri: 'https://example.org/thing',
  bounds: { x0: 5, y0: 6, x1: 7, y1: 8 },
};

describe('LinksPanel', () => {
  it('asks for the page the READER is on, not a fixed one', async () => {
    const { client, asked } = clientAnswering([]);
    render(
      <Wrapped>
        <LinksPanel client={client} docId={DOC} page={7} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    // A panel that sent a literal would pass every case below and describe the
    // wrong page for every reader not on it — the same off-by-one class the
    // rotate command shipped with, arriving in a request rather than an index.
    expect(asked).toStrictEqual([{ docId: DOC, page: 7 }]);
  });

  it('OFFERS A JUMP for an internal link, with the zero-based page', async () => {
    // The UI half of this feature's pair. The kernel's half proves the engine
    // resolves a destination; this proves the panel dispatches that page.
    const jump = vi.fn();
    const { client } = clientAnswering([INTERNAL]);
    const { container } = render(
      <Wrapped>
        <LinksPanel client={client} docId={DOC} page={0} onJump={jump} />
      </Wrapped>,
    );
    await settle();

    const button = container.querySelector('.m-links-item');
    // LABELLED 5, DISPATCHES 4. A person reads 1-based page numbers and the
    // contract carries 0-based indices, and asserting both in one case is what
    // makes the conversion visible — either alone reads as correct.
    expect(button?.textContent).toBe('Go to page 5');
    (button as HTMLButtonElement | null)?.click();
    expect(jump).toHaveBeenCalledWith(4);
  });

  it('gives an external link NO CONTROL, which is invariant 24 rather than a gap', async () => {
    // "No external fetch until the user asks, for that item." A button that
    // quietly did nothing would be the display-only defect; a button that
    // opened a browser is a separate decision with its own confirmation. So
    // there is no button, and the URI is shown.
    const { client } = clientAnswering([EXTERNAL]);
    const { container } = render(
      <Wrapped>
        <LinksPanel client={client} docId={DOC} page={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('.m-links-external')?.textContent).toBe(
      'Opens https://example.org/thing',
    );
  });

  it('CONTROL: with both kinds present, exactly the internal one is a control', async () => {
    // Without this, "no buttons" is satisfied by a panel that renders no
    // controls at all — including for the internal links it is supposed to
    // offer. The mixed list is what separates *the split is honoured* from
    // *nothing is clickable*.
    const { client } = clientAnswering([INTERNAL, EXTERNAL]);
    const { container } = render(
      <Wrapped>
        <LinksPanel client={client} docId={DOC} page={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelectorAll('.m-links-external')).toHaveLength(1);
  });

  it('says a REFUSAL differently from an empty page', async () => {
    // "This page has no links" and "we could not ask" are different things to
    // tell a reader, and collapsing them hides the second — which is the
    // reassuring answer for a document that is busy or poisoned.
    const empty = clientAnswering([]);
    const { container: emptyPanel } = render(
      <Wrapped>
        <LinksPanel client={empty.client} docId={DOC} page={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(emptyPanel.querySelector('.m-links-empty')?.textContent).toBe(
      'This page has no links.',
    );

    const refused = clientAnswering([], { refuse: true });
    const { container: refusedPanel } = render(
      <Wrapped>
        <LinksPanel client={refused.client} docId={DOC} page={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(refusedPanel.querySelector('.m-links-empty')?.textContent).toBe(
      'The links on this page could not be read.',
    );
  });

  it('renders NOTHING with no document, and asks for nothing', async () => {
    const { client, asked } = clientAnswering([INTERNAL]);
    const { container } = render(
      <Wrapped>
        <LinksPanel client={client} docId={undefined} page={undefined} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    expect(container.querySelector('.m-links-panel')).toBeNull();
    expect(asked).toStrictEqual([]);
  });

  it('does not show the PREVIOUS pages links while the next answer is in flight', async () => {
    // Stale links look exactly like current ones, which is why the state
    // carries the page it describes. A panel that kept the old list would
    // offer a reader a jump computed from a page they have left.
    const { client } = clientAnswering([INTERNAL]);
    const { container, rerender } = render(
      <Wrapped>
        <LinksPanel client={client} docId={DOC} page={0} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(container.querySelectorAll('.m-links-item')).toHaveLength(1);

    // Re-rendered on a new page WITHOUT letting the answer land.
    rerender(
      <Wrapped>
        <LinksPanel client={client} docId={DOC} page={1} onJump={vi.fn()} />
      </Wrapped>,
    );
    expect(container.querySelector('.m-links-panel')).toBeNull();
  });
});
