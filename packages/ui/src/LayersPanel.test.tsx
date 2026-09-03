// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { LayersPanel } from './LayersPanel.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';

const DOC = asDocId('00000000-0000-4000-8000-0000000000ea');
const OTHER = asDocId('00000000-0000-4000-8000-0000000000eb');
const V1 = asDocVersion(1);

/**
 * Two layers, one hidden, and the INDICES ARE NOT THE ROW POSITIONS.
 *
 * Both halves are deliberate.
 *
 * *One hidden*, because a list where everything is visible cannot tell a panel
 * that read the flag from one that assumed it — and the toggle's payload is
 * derived from that flag.
 *
 * *Indices 3 and 7*, because a panel sending the row's position and a panel
 * sending the layer's index are the same panel on any fixture where the two
 * coincide. `readLayers` emits them contiguously today, so this fixture is a
 * claim about `Layer.index` rather than about that reader: the contract
 * documents it as MuPDF's address for the layer, the command is routed by it,
 * and nothing in the schema ties it to a position. A panel that reads the
 * position is correct only for as long as this list is never filtered or
 * reordered — which is the literal-at-the-call-site hazard the wired pair's
 * blind spot is about, one boundary over.
 */
const LAYERS = [
  { index: 3, name: 'Watermark', visible: true },
  { index: 7, name: 'Draft stamp', visible: false },
];

/**
 * A client answering both channels the panel uses, recording what it was sent.
 *
 * `executed` is the load-bearing half: it is the UI side of the wired-tools
 * pair, and what it proves is that the control dispatches the command the
 * kernel's own proof exercises — not that a checkbox changed on screen.
 */
function clientAnswering(
  layers: readonly unknown[],
  options: { refuse?: boolean } = {},
): { client: ContractClient; asked: unknown[]; executed: unknown[] } {
  const asked: unknown[] = [];
  const executed: unknown[] = [];
  const client = createClient(channels, (id, params) => {
    if (id === 'document.execute') {
      executed.push(params);
      return Promise.resolve(ok({ version: asDocVersion(2), byteLength: 1024, historyDropped: 0 }));
    }
    if (id !== 'document.layers') throw new Error(`unexpected channel ${id}`);
    asked.push(params);
    return Promise.resolve(
      options.refuse === true ? err({ code: 'document-busy' }) : ok({ version: V1, layers }),
    );
  });
  return { client, asked, executed };
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

describe('LayersPanel', () => {
  it('renders every layer with the visibility the DOCUMENT holds', async () => {
    const { client } = clientAnswering(LAYERS);
    const { container } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();

    const boxes = [...container.querySelectorAll('input')];
    expect(boxes).toHaveLength(2);
    // BOTH VALUES, not just the checked one: a panel defaulting every box to
    // checked passes the first assertion on its own.
    expect(boxes.map((box) => box.checked)).toStrictEqual([true, false]);
    expect(container.textContent).toContain('Draft stamp');
  });

  it('THE DISPATCH: toggling sends setLayerVisibility with the LAYERS index', async () => {
    const { client, executed } = clientAnswering(LAYERS);
    const { container } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();

    // The second row, whose index is 7 and whose position is 1. A panel reading
    // the position sends 1, which is a layer this document does not have.
    container.querySelectorAll('input')[1]?.click();
    await settle();

    expect(executed).toStrictEqual([
      { docId: DOC, command: { kind: 'setLayerVisibility', layer: 7, visible: true } },
    ]);
  });

  it('sends the OPPOSITE of what the layer is, so the command is never a no-op', async () => {
    // The control for the case above one axis over. `visible: !layer.visible`
    // and `visible: layer.visible` are both booleans in the right field, and
    // the second produces a command that changes nothing — which is not an
    // error anywhere: it applies, it captures, it inverts, and the document
    // ends where it started. The only way to see it is to toggle a VISIBLE
    // layer and a HIDDEN one and read the two payloads against each other.
    const { client, executed } = clientAnswering(LAYERS);
    const { container } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();

    const boxes = [...container.querySelectorAll('input')];
    boxes[0]?.click();
    boxes[1]?.click();
    await settle();

    expect(executed).toStrictEqual([
      { docId: DOC, command: { kind: 'setLayerVisibility', layer: 3, visible: false } },
      { docId: DOC, command: { kind: 'setLayerVisibility', layer: 7, visible: true } },
    ]);
  });

  it('does NOT flip its own checkbox — what is drawn is what was read', async () => {
    // The panel holds no copy of what is visible. A panel that flipped locally
    // would show a state the document is not in, would keep showing it if the
    // command were refused, and would keep showing it after an undo.
    //
    // The version is held at V1 here, so nothing re-reads: this asserts the
    // absence of a local write, not the presence of a refresh. The case below
    // asserts the refresh.
    const { client } = clientAnswering(LAYERS);
    const { container } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();

    container.querySelectorAll('input')[1]?.click();
    await settle();

    expect([...container.querySelectorAll('input')].map((box) => box.checked)).toStrictEqual([
      true,
      false,
    ]);
  });

  it('RE-READS when the version moves, which is how a toggle reaches the screen', async () => {
    // There is no second refresh path: a command moves the version, and this
    // effect is what runs. So an undo, or a toggle applied from anywhere else,
    // updates the panel through the mechanism that was already there.
    const { client, asked } = clientAnswering(LAYERS);
    const { rerender } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();
    rerender(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={asDocVersion(2)} />
      </Wrapped>,
    );
    await settle();

    expect(asked).toStrictEqual([{ docId: DOC }, { docId: DOC }]);
  });

  it('asks ONCE per version, not once per render', async () => {
    // The control for the case above: without it, "re-reads" is satisfied by a
    // panel that asks on every render, which is a round trip per keystroke
    // elsewhere in the application.
    const { client, asked } = clientAnswering(LAYERS);
    const { rerender } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();
    rerender(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();

    expect(asked).toStrictEqual([{ docId: DOC }]);
  });

  it('says a REFUSAL differently from a document with no layers', async () => {
    const none = clientAnswering([]);
    const { container: empty } = render(
      <Wrapped>
        <LayersPanel client={none.client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();
    expect(empty.querySelector('.m-layers-empty')?.textContent).toBe(
      'This document has no layers.',
    );

    const refused = clientAnswering([], { refuse: true });
    const { container: broken } = render(
      <Wrapped>
        <LayersPanel client={refused.client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();
    expect(broken.querySelector('.m-layers-empty')?.textContent).toBe(
      'The layers could not be read.',
    );
  });

  it('does not show one documents layers over another', async () => {
    // A layer list from a closed document looks exactly like the current one's,
    // and toggling a row of it would name an index in a document that has no
    // such layer — which the kernel refuses, after the user has been shown a
    // control that appeared to work.
    const { client } = clientAnswering(LAYERS);
    const { container, rerender } = render(
      <Wrapped>
        <LayersPanel client={client} docId={DOC} version={V1} />
      </Wrapped>,
    );
    await settle();
    expect(container.querySelectorAll('li')).toHaveLength(2);

    rerender(
      <Wrapped>
        <LayersPanel client={client} docId={OTHER} version={V1} />
      </Wrapped>,
    );
    expect(container.querySelector('.m-layers')).toBeNull();
  });

  it('renders nothing with no document, and asks for nothing', async () => {
    const { client, asked } = clientAnswering(LAYERS);
    const { container } = render(
      <Wrapped>
        <LayersPanel client={client} docId={undefined} version={undefined} />
      </Wrapped>,
    );
    await settle();

    expect(container.querySelector('.m-layers')).toBeNull();
    expect(asked).toStrictEqual([]);
  });
});
