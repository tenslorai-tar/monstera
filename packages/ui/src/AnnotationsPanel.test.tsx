// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AnnotationsPanel } from './AnnotationsPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000dd');

/**
 * The annotations panel.
 *
 * The client is built from the CONTRACT, so every answer these cases invent
 * goes through the real schemas — a panel expecting a shape the channel cannot
 * carry fails here rather than in the product, and a `kind` outside the closed
 * union cannot be written at all.
 */
function clientAnswering(
  annotations: readonly unknown[],
  options: { refuse?: boolean; truncated?: boolean } = {},
): { client: ContractClient; asked: unknown[] } {
  const asked: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id !== 'document.annotations') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      options.refuse === true
        ? err({ code: 'document-poisoned' })
        : ok({
            version: asDocVersion(1),
            annotations,
            truncated: options.truncated ?? false,
          }),
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

/** Renders the panel over one answer and returns every page it was asked to jump to. */
async function panel(
  annotations: readonly unknown[],
  options: { refuse?: boolean; truncated?: boolean } = {},
): Promise<{ jumps: number[]; asked: unknown[] }> {
  const { client, asked } = clientAnswering(annotations, options);
  const jumps: number[] = [];
  render(
    <Wrapped>
      <AnnotationsPanel
        client={client}
        docId={DOC}
        onJump={(page): void => {
          jumps.push(page);
        }}
        version={asDocVersion(1)}
      />
    </Wrapped>,
  );
  await settle();
  return { jumps, asked };
}

describe('AnnotationsPanel', () => {
  it('names each annotation by its kind and the page a READER counts it as', async () => {
    // PDF.js and every user-facing surface number pages from 1; the channel
    // carries zero-based indices. `pageNumbering.ts` is where the two meet, and
    // a panel that showed the raw index would be off by one on every row — the
    // defect this build has shipped once, in the other direction.
    await panel([
      { page: 0, kind: 'square', contents: '' },
      { page: 4, kind: 'ink', contents: '' },
    ]);

    expect(screen.getByText('Rectangle on page 1')).toBeTruthy();
    expect(screen.getByText('Freehand on page 5')).toBeTruthy();
  });

  it('labels a kind it did not write as an annotation, not as unknown', async () => {
    // A row reading *Unknown* tells a reader the application is confused;
    // *Annotation* tells them a comment is there and which page to look at,
    // which is what the panel is for.
    await panel([{ page: 2, kind: 'other', contents: '' }]);
    expect(screen.getByText('Annotation on page 3')).toBeTruthy();
  });

  it('jumps to the page a row names, zero-based as the shell expects', async () => {
    const { jumps } = await panel([{ page: 4, kind: 'square', contents: '' }]);
    screen.getByRole('button', { name: /page 5/u }).click();
    // FIVE ON SCREEN, FOUR IN THE CALL. The two halves of the correspondence in
    // one case, which is the only place they meet.
    expect(jumps).toStrictEqual([4]);
  });

  it('shows an annotation’s note when it has one', async () => {
    await panel([{ page: 0, kind: 'square', contents: 'check this figure' }]);
    expect(screen.getByText('check this figure')).toBeTruthy();
  });

  it('says the list was CUT rather than showing a short list as complete', async () => {
    // A panel headed *the annotations in this document* that quietly showed
    // some of them is the display-only sin in a list, and the flag exists
    // precisely because the renderer cannot tell *this document has that many*
    // from *you asked for that many*.
    await panel([{ page: 0, kind: 'square', contents: '' }], { truncated: true });
    expect(screen.getByText(/Only the first/u)).toBeTruthy();
  });

  it('CONTROL: an untruncated list says nothing of the kind', async () => {
    // Without this the case above is satisfied by a panel that always shows the
    // notice — which would tell every reader their list is incomplete.
    await panel([{ page: 0, kind: 'square', contents: '' }]);
    expect(screen.queryByText(/Only the first/u)).toBeNull();
  });

  it('separates a document with no annotations from one it could not read', async () => {
    // Collapsing the two makes the second invisible, which is the reassuring
    // answer for a document that is busy or poisoned.
    await panel([]);
    expect(screen.getByText('This document has no annotations.')).toBeTruthy();
  });

  it('says so when the ask was refused', async () => {
    await panel([], { refuse: true });
    expect(screen.getByText(/could not be read/u)).toBeTruthy();
  });

  it('asks about the document rather than a page, which is what the panel lists', async () => {
    const { asked } = await panel([]);
    expect(asked).toStrictEqual([{ docId: DOC }]);
  });

  it('renders nothing at all with no document open', () => {
    const { client } = clientAnswering([]);
    const { container } = render(
      <Wrapped>
        <AnnotationsPanel
          client={client}
          docId={undefined}
          onJump={() => undefined}
          version={undefined}
        />
      </Wrapped>,
    );
    expect(container.querySelector('.m-annotations-panel')).toBeNull();
  });
});
