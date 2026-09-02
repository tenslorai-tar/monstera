// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DestinationsPanel } from './DestinationsPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000dd');
const OTHER = asDocId('00000000-0000-4000-8000-0000000000de');
const V1 = asDocVersion(1);

/** The outline the kernel case builds, as it crosses. */
const OUTLINE = [
  { title: 'Chapter one', page: 1, depth: 0 },
  { title: 'A section', page: 2, depth: 1 },
  { title: 'Somewhere unresolvable', page: null, depth: 0 },
];

function clientAnswering(
  destinations: readonly unknown[],
  options: { refuse?: boolean } = {},
): { client: ContractClient; asked: unknown[] } {
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.destinations') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      options.refuse === true
        ? err({ code: 'document-busy' })
        : ok({ version: V1, destinations }),
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

describe('DestinationsPanel', () => {
  it('renders the outline in the DOCUMENTS order, indented by depth', async () => {
    const { client } = clientAnswering(OUTLINE);
    const { container } = render(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    const rows = [...container.querySelectorAll('li')];
    expect(rows).toHaveLength(3);
    // NOTHING SORTS. An outline's order is authored, and a panel that ordered
    // by title or by page would overrule the author — which is invisible unless
    // a case states the order it expects.
    expect(rows.map((row) => row.textContent.startsWith('Chapter one'))).toStrictEqual([
      true,
      false,
      false,
    ]);
    // The indent is the depth and nothing else; the tree is not rebuilt.
    expect(rows.map((row) => row.style.paddingInlineStart)).toStrictEqual(['0px', '12px', '0px']);
  });

  it('JUMPS to the entrys own page, with the zero-based index', async () => {
    const jump = vi.fn();
    const { client } = clientAnswering(OUTLINE);
    const { container } = render(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={jump} />
      </Wrapped>,
    );
    await settle();

    const buttons = [...container.querySelectorAll('button')];
    buttons[1]?.click();
    // PAGE 2 ZERO-BASED, shown as 3. Asserting both in one case is what makes
    // the conversion visible; either alone reads as correct.
    expect(jump).toHaveBeenCalledWith(2);
    expect(buttons[1]?.textContent).toContain('3');
  });

  it('shows an unresolvable entry WITHOUT a control', async () => {
    // A gap in a table of contents is more confusing than an entry that cannot
    // be followed, and a button that did nothing would be the display-only
    // defect. So the entry is there and there is nothing to press.
    const { client } = clientAnswering(OUTLINE);
    const { container } = render(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    // TWO BUTTONS FOR THREE ENTRIES, which is the assertion that separates
    // *the unresolvable one is inert* from *nothing is clickable*.
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(container.querySelector('.m-destination-unresolved')?.textContent).toBe(
      'Somewhere unresolvable (goes nowhere)',
    );
  });

  it('says a REFUSAL differently from a document with no outline', async () => {
    const none = clientAnswering([]);
    const { container: empty } = render(
      <Wrapped>
        <DestinationsPanel client={none.client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(empty.querySelector('.m-destinations-empty')?.textContent).toBe(
      'This document has no outline.',
    );

    const refused = clientAnswering([], { refuse: true });
    const { container: broken } = render(
      <Wrapped>
        <DestinationsPanel client={refused.client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(broken.querySelector('.m-destinations-empty')?.textContent).toBe(
      'The outline could not be read.',
    );
  });

  it('asks ONCE per document, not once per render', async () => {
    // An outline is a property of the document. Re-asking on every render would
    // be the same round trip for the same answer, and the effect's dependencies
    // are the only thing that says so.
    const { client, asked } = clientAnswering(OUTLINE);
    const { rerender } = render(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    rerender(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();

    expect(asked).toStrictEqual([{ docId: DOC }]);
  });

  it('RE-READS when the document moves, because a command can change a page', async () => {
    // The control for the case above: without it, "asks once" is satisfied by a
    // panel that never re-reads at all — and an outline describing the previous
    // version sends a reader to the wrong page with nothing to show it had.
    const { client, asked } = clientAnswering(OUTLINE);
    const { rerender } = render(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    rerender(
      <Wrapped>
        <DestinationsPanel
          client={client}
          docId={DOC}
          version={asDocVersion(2)}
          onJump={vi.fn()}
        />
      </Wrapped>,
    );
    await settle();

    expect(asked).toHaveLength(2);
  });

  it('does not show one documents outline over another', async () => {
    // Headings from a file the reader closed look exactly like the current
    // one's, which is why the state carries the document it describes.
    const { client } = clientAnswering(OUTLINE);
    const { container, rerender } = render(
      <Wrapped>
        <DestinationsPanel client={client} docId={DOC} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    await settle();
    expect(container.querySelectorAll('li')).toHaveLength(3);

    rerender(
      <Wrapped>
        <DestinationsPanel client={client} docId={OTHER} version={V1} onJump={vi.fn()} />
      </Wrapped>,
    );
    expect(container.querySelector('.m-destinations')).toBeNull();
  });

  it('renders nothing with no document, and asks for nothing', async () => {
    const { client, asked } = clientAnswering(OUTLINE);
    const { container } = render(
      <Wrapped>
        <DestinationsPanel
          client={client}
          docId={undefined}
          version={undefined}
          onJump={vi.fn()}
        />
      </Wrapped>,
    );
    await settle();

    expect(container.querySelector('.m-destinations')).toBeNull();
    expect(asked).toStrictEqual([]);
  });
});
