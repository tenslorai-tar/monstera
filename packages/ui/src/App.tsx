import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { openDocumentCommand } from './commands/openDocument.js';
import { type DocumentView, openDocumentView } from './documentView.js';
import { CommandRegistry } from './registries/commands.js';
import { renderPage } from './renderPage.js';
import { StartScreen } from './surfaces/StartScreen.js';

/**
 * The renderer's root component.
 *
 * ## What it is, and what it deliberately is not
 *
 * A start screen that is a **projection of the command registry**, and a canvas
 * that shows page 1 of whatever is open. No ribbon, no toolbar, no palette:
 * those are projections too, and each lands with the commands that populate it
 * rather than as an empty container that looks like a surface under
 * construction (§10.4's wired-tools rule).
 *
 * ## The client is a prop
 *
 * It is built from the preload bridge in `main.tsx` and handed in, so this
 * component is renderable against a client built from the contract in a test.
 * A component that reached for the bridge itself would be untestable and would
 * make the bridge's absence a render-time crash rather than a composition
 * decision.
 */

/** What the renderer knows about the one open document. */
interface OpenDocument {
  readonly docId: DocId;
  readonly version: DocVersion;
  readonly byteLength: number;
}

export interface AppProps {
  readonly client: ContractClient;
}

export function App({ client }: AppProps): ReactElement {
  const [open, setOpen] = useState<OpenDocument | undefined>(undefined);

  const registry = useMemo(
    () => new CommandRegistry([openDocumentCommand({ client, onOpened: setOpen })]),
    [client],
  );

  // The start screen's context: no document focused. `hasSelection` and `dirty`
  // are false because there is nothing to select in and nothing to dirty — not
  // because they are unknown.
  const context = useMemo(
    () => ({
      docId: open?.docId,
      version: open?.version,
      hasSelection: false,
      dirty: false,
    }),
    [open],
  );

  return (
    <main className="m-document-surface">
      {open === undefined ? (
        <StartScreen registry={registry} context={context} />
      ) : (
        <PageCanvas client={client} document={open} onVersionMoved={setOpen} />
      )}
    </main>
  );
}

/**
 * Page 1 of the open document, rasterised.
 *
 * ## The view is owned by an effect, and torn down by its cleanup
 *
 * A parser, a worker and a transport are resources with a lifetime, and the
 * lifetime that matters is *this component is showing this document at this
 * version*. Opening in an effect and closing in its cleanup makes that the
 * language's job rather than a rule somebody follows — including on the paths
 * that are easy to forget: a version bump, an unmount mid-parse, and a second
 * document opened before the first finished.
 *
 * ## `cancelled` exists because `await` has no undo
 *
 * React can unmount between the `await` and the render, and the view opened by
 * an effect that has already been cleaned up would never be closed by anything.
 * The flag is read after every suspension point for that reason.
 */
function PageCanvas({
  client,
  document: open,
  onVersionMoved,
}: {
  readonly client: ContractClient;
  readonly document: OpenDocument;
  readonly onVersionMoved: (next: OpenDocument) => void;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  const moved = useCallback(
    (next: { readonly version: DocVersion; readonly byteLength: number }) => {
      onVersionMoved({ docId: open.docId, version: next.version, byteLength: next.byteLength });
    },
    [onVersionMoved, open.docId],
  );

  useEffect(() => {
    let cancelled = false;
    let view: DocumentView | undefined;

    const show = async (): Promise<void> => {
      try {
        view = await openDocumentView({
          client,
          docId: open.docId,
          version: open.version,
          byteLength: open.byteLength,
          onVersionMoved: moved,
        });
        if (cancelled || canvas.current === null) return;
        await renderPage(view.document, 1, canvas.current, 1);
      } catch {
        // A parse that fails is a document this renderer cannot show. It is not
        // a crash and it is not silence: the surface stays empty and says so
        // through `failed`, and the diagnostic belongs to main, which is the
        // only side that may hold one (ADR-0009 §9).
        if (!cancelled) setFailed(true);
      }
    };

    void show();

    return (): void => {
      cancelled = true;
      void view?.close();
    };
  }, [client, moved, open.byteLength, open.docId, open.version]);

  return <canvas className="m-page" data-failed={failed ? 'true' : undefined} ref={canvas} />;
}
