import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import { LAYERS_EMPTY, LAYERS_LABEL, LAYERS_UNAVAILABLE } from './messages/en.js';

/**
 * The document's optional-content groups, with a control that turns each one on
 * and off.
 *
 * ## The toggle is a COMMAND, and that is what makes this panel different
 *
 * `setLayerVisible` writes to the document, so hiding a layer is a mutation
 * with a checkpoint and an inverse — not a view preference the renderer keeps.
 * The panel therefore sends `document.execute` and re-reads, rather than
 * holding a local copy of what is visible: a panel that flipped its own
 * checkbox would show a state the document is not in, and would keep showing it
 * after an undo.
 *
 * ## Read once per document VERSION, which is what re-reads after the toggle
 *
 * The effect below is keyed on `version`, and a command moves the version — so
 * the read that follows a toggle is the same read that follows any other
 * mutation. There is no second refresh path, which is the point: an undo of a
 * toggle, or a toggle applied from anywhere else, updates this panel through
 * the mechanism that was already there.
 *
 * ## The index is the layer's, not the row's
 *
 * `layer.index` is sent, never the position in the array. MuPDF's layer order
 * is not the document's `/OCGs` order, and the two coincide often enough that a
 * panel sending a row number would work on most documents.
 */
export function LayersPanel({
  client,
  docId,
  version,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The open document's version. A command moves it, and that re-reads. */
  readonly version: DocVersion | undefined;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    if (docId === undefined || version === undefined) return;
    let cancelled = false;

    void client['document.layers']({ docId }).then(
      (answer) => {
        if (cancelled) return;
        setState(
          answer.ok
            ? { kind: 'layers', docId, layers: answer.value.layers }
            : { kind: 'unavailable', docId },
        );
      },
      () => {
        if (!cancelled) setState({ kind: 'unavailable', docId });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, version]);

  // KEYED ON THE DOCUMENT, for the destinations panel's reason: layers held
  // from a closed document are indistinguishable from the current one's, and
  // toggling one of them would name an index in a document that has no such
  // layer.
  if (docId === undefined || state.kind === 'idle' || state.docId !== docId) return null;

  return (
    <section className="m-layers" aria-label={i18n._(LAYERS_LABEL)}>
      {state.kind === 'unavailable' ? (
        <p className="m-layers-empty">{i18n._(LAYERS_UNAVAILABLE)}</p>
      ) : state.layers.length === 0 ? (
        <p className="m-layers-empty">{i18n._(LAYERS_EMPTY)}</p>
      ) : (
        <ul className="m-layers-list">
          {state.layers.map((layer) => (
            // THE INDEX IS THE KEY and it is the layer's own, which is the one
            // list here where the key is not a positional fallback: a layer's
            // index is its identity in the document, so a re-read that reorders
            // nothing still matches rows to layers.
            <li key={layer.index}>
              <label className="m-layer">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => {
                    void client['document.execute']({
                      docId,
                      command: {
                        kind: 'setLayerVisibility',
                        layer: layer.index,
                        visible: !layer.visible,
                      },
                    });
                  }}
                />
                <span className="m-layer-name">{layer.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One layer, as the contract carries it. */
interface PanelLayer {
  readonly index: number;
  readonly name: string;
  readonly visible: boolean;
}

/**
 * What the panel is showing.
 *
 * Three states rather than a list plus a flag, for `DestinationsPanel`'s
 * reason: a list beside `failed: boolean` makes *refused, and here are no
 * layers* representable, and every reader would have to rule it out.
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unavailable'; readonly docId: DocId }
  | { readonly kind: 'layers'; readonly docId: DocId; readonly layers: readonly PanelLayer[] };
