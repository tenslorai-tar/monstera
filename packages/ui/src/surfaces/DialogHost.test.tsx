// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { act, render as renderBare, screen } from '@testing-library/react';
import { lazy, useState, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { activateCatalogue, i18n } from '../i18n.js';
import { DialogRegistry, declareDialog } from '../registries/dialogs.js';
import { DialogHost, useDialogHost } from './DialogHost.js';

/**
 * A dialog body that renders its props, so a case can tell the VALIDATED props
 * from the raw ones. A body rendering fixed text would pass identically whether
 * the schema's output or the caller's object reached it.
 */
// NO CAST, and its absence is the assertion (finding EEEEE-2). This used to end
// `as DialogEntry`, which is what an object literal needs when the registry's
// storage type has severed the tie between the schema and the component.
// `declareDialog` infers `Schema` from `props` and requires the component to
// take exactly that output, so a body whose props disagree fails HERE — in the
// feature's own diff — rather than being erased at the mount point.
const renameEntry = declareDialog({
  id: 'dialog.rename',
  title: messageKey('dialog.rename.title'),
  props: z.object({ name: z.string().min(1) }),
  component: lazy(() =>
    Promise.resolve({
      default: ({ name }: { name: string }) => <p>{`renaming ${name}`}</p>,
    }),
  ),
});

const registry = new DialogRegistry([renameEntry]);

/**
 * A real catalogue, because the host no longer takes a resolver.
 *
 * It used to be handed an identity function, and the dialog's accessible name
 * was therefore the KEY — `dialog.rename.title` — which is precisely the thing
 * `messages.ts` calls worse than English. The queries below now ask for the
 * resolved name, so a host that leaked a key past the primitives would fail
 * here rather than read as passing.
 */
const RENAME_TITLE = messageKey('dialog.rename.title');
const CLOSE = messageKey('action.close.label');
activateCatalogue('en', { [RENAME_TITLE]: 'Rename document', [CLOSE]: 'Close' });

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

/**
 * The smallest thing that owns the host's state — which is what a real shell
 * will be. The host takes `open` and `onClose` as props rather than owning
 * them, so a command can open a dialog without reaching into a component.
 */
function Harness({ id, props }: { id: string; props: unknown }): ReactElement {
  const { open, show, close } = useDialogHost(registry);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          try {
            show(id, props);
          } catch (thrown) {
            setError(String(thrown));
          }
        }}
      >
        Open
      </button>
      {error === undefined ? null : <p>{error}</p>}
      <DialogHost registry={registry} closeLabel={CLOSE} open={open} onClose={close} />
    </>
  );
}

describe('DialogHost', () => {
  it('renders NOTHING until a dialog is shown', async () => {
    render(<Harness id="dialog.rename" props={{ name: 'chapter one' }} />);

    // A mounted-but-closed dialog would keep its body's state across opens and
    // cost its lazy chunk on first paint, so absence is the assertion — and it
    // is asserted by role, which a hidden-but-present dialog would still expose
    // to the accessibility tree in some implementations.
    expect(screen.queryByRole('dialog')).toBeNull();
    await Promise.resolve();
  });

  it('mounts the registered body with the VALIDATED props, inside the one Dialog', async () => {
    render(<Harness id="dialog.rename" props={{ name: 'chapter one' }} />);

    screen.getByRole('button', { name: 'Open' }).click();

    // By role and accessible name, never by test id: §10.4 puts accessibility
    // in the substrate, and this query is the one that goes red when the
    // dialog loses its name.
    const dialog = await screen.findByRole('dialog', { name: 'Rename document' });
    // The body rendered, and rendered the props that came back from the schema
    // rather than the caller's object.
    const body = await screen.findByText('renaming chapter one');

    // INSIDE the dialog, which is the host's actual responsibility. The focus
    // trap, the Escape handler and the inert-ing are the primitive's and are
    // proven there; what a host can get wrong is rendering the body somewhere
    // the primitive does not govern, and that failure is invisible to every
    // assertion above.
    expect(dialog.contains(body)).toBe(true);
  });

  it('refuses props the schema rejects BEFORE anything opens', async () => {
    render(<Harness id="dialog.rename" props={{ name: '' }} />);

    screen.getByRole('button', { name: 'Open' }).click();

    // Both halves. The throw is what a caller sees; the absent dialog is what
    // makes "before anything opens" true rather than "closed again straight
    // after", and only the second distinguishes a refusal at the open call from
    // a body that crashed on bad props.
    expect(await screen.findByText(/DialogPropsRejected/u)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears its own state when the primitive asks to close', async () => {
    render(<Harness id="dialog.rename" props={{ name: 'chapter one' }} />);
    screen.getByRole('button', { name: 'Open' }).click();
    await screen.findByRole('dialog');

    // Wrapped in `act` because this assertion needs the RE-RENDER, unlike the
    // primitive's own close case, which asserts a spy and never needed one.
    await act(async () => {
      screen.getByRole('button', { name: 'Close' }).click();
      await Promise.resolve();
    });

    // About the HOST, not the primitive: a host that ignored `onOpenChange`
    // would leave its state saying a dialog is open while the primitive had
    // closed, and the next open of a DIFFERENT dialog would then do nothing.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
