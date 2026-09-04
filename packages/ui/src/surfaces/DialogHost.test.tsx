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

/**
 * A dialog that ANSWERS, which the rename one above cannot
 * ([ADR-0038](../../../../docs/DECISIONS/0038-a-dialog-answers-the-command-that-opened-it.md)).
 *
 * Two controls, because the gate needs both directions: one resolves a value
 * the schema accepts, the other resolves one it refuses. A body that could only
 * answer correctly would leave the validation on the way out unexercised, and
 * the schema would be a claim rather than a check.
 *
 * The refusing control is why `resolve` is typed against the result schema and
 * the body still has to cast: the whole point of the case is a body that
 * answers wrongly, which the type is supposed to make hard.
 */
const pickEntry = declareDialog({
  id: 'dialog.pick',
  title: messageKey('dialog.pick.title'),
  props: z.object({ limit: z.number().int().positive() }),
  result: z.object({ chosen: z.number().int().nonnegative() }),
  component: lazy(() =>
    Promise.resolve({
      default: ({
        limit,
        resolve,
      }: {
        limit: number;
        resolve: (result: { chosen: number }) => void;
      }) => (
        <>
          <p>{`picking under ${String(limit)}`}</p>
          <button
            type="button"
            onClick={() => {
              resolve({ chosen: 2 });
            }}
          >
            Choose
          </button>
          <button
            type="button"
            onClick={() => {
              // DELIBERATELY WRONG, and it type-checks: the result schema
              // refines `number` with `nonnegative()`, which zod cannot carry
              // into the inferred type. That is the finding this case pins —
              // **a schema says more than its type does**, so the runtime check
              // is not redundant with the compiler and removing it would leave
              // exactly this value unguarded.
              resolve({ chosen: -1 });
            }}
          >
            Choose badly
          </button>
        </>
      ),
    }),
  ),
});

const registry = new DialogRegistry([renameEntry, pickEntry]);

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
const PICK_TITLE = messageKey('dialog.pick.title');
const CLOSE = messageKey('action.close.label');
activateCatalogue('en', {
  [RENAME_TITLE]: 'Rename document',
  [PICK_TITLE]: 'Pick a page',
  [CLOSE]: 'Close',
});

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
function Harness({
  id,
  props,
  onAnswer,
}: {
  id: string;
  props: unknown;
  /** What the dialog settled with, for the cases about the answer. */
  onAnswer?: (answer: unknown) => void;
}): ReactElement {
  const { open, ask, close, resolve } = useDialogHost(registry);
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          try {
            // THE PROMISE IS CONSUMED, because a dropped one is the state
            // ADR-0038's dismissal path would hide: `ask` settles `undefined`
            // on close, and a harness that ignored it could not tell a dialog
            // that answered from one that never settled.
            void ask(id, props).then(
              (answer) => {
                onAnswer?.(answer);
              },
              (thrown: unknown) => {
                setError(String(thrown));
              },
            );
          } catch (thrown) {
            setError(String(thrown));
          }
        }}
      >
        Open
      </button>
      {error === undefined ? null : <p>{error}</p>}
      <DialogHost
        registry={registry}
        closeLabel={CLOSE}
        open={open}
        onClose={close}
        onResolve={resolve}
      />
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

  /**
   * ADR-0038's seam: opening a dialog is a question.
   *
   * Every case here asserts what the promise SETTLED WITH, because that is the
   * value a command turns into an argument — and it is the only observable
   * difference between the paths. The dialog closes either way.
   */
  describe('answering', () => {
    it('SETTLES WITH THE PARSED RESULT when the body resolves', async () => {
      const answers: unknown[] = [];
      render(
        <Harness
          id="dialog.pick"
          props={{ limit: 4 }}
          onAnswer={(answer) => answers.push(answer)}
        />,
      );
      screen.getByRole('button', { name: 'Open' }).click();
      await screen.findByText('picking under 4');

      await act(async () => {
        screen.getByRole('button', { name: 'Choose' }).click();
        await Promise.resolve();
      });

      // THE VALUE, not merely that something settled. A host that answered
      // `undefined` on every path would close the dialog exactly as correctly.
      expect(answers).toStrictEqual([{ chosen: 2 }]);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('CONTROL: SETTLES undefined when the dialog is dismissed', async () => {
      // The gate, at the seam. Same fixture, same dialog, different exit — and
      // the pair is what separates a working gate from one that can never
      // answer at all.
      const answers: unknown[] = [];
      render(
        <Harness
          id="dialog.pick"
          props={{ limit: 4 }}
          onAnswer={(answer) => answers.push(answer)}
        />,
      );
      screen.getByRole('button', { name: 'Open' }).click();
      await screen.findByText('picking under 4');

      await act(async () => {
        screen.getByRole('button', { name: 'Close' }).click();
        await Promise.resolve();
      });

      expect(answers).toStrictEqual([undefined]);
    });

    it('REFUSES an answer the result schema rejects, rather than passing it on', async () => {
      // The value becomes a command's argument, so it is checked on the way out
      // for the same reason props are checked on the way in. Without this the
      // result schema is a declaration nothing reads.
      render(<Harness id="dialog.pick" props={{ limit: 4 }} />);
      screen.getByRole('button', { name: 'Open' }).click();
      await screen.findByText('picking under 4');

      await act(async () => {
        screen.getByRole('button', { name: 'Choose badly' }).click();
        await Promise.resolve();
      });

      expect(await screen.findByText(/DialogResultRejected/u)).toBeDefined();
    });

    it('CONTROL: an informational dialog settles undefined and nothing else', async () => {
      // `renameEntry` declares no result, so its body has a `resolve` taking
      // `never` and cannot answer. This is what makes the default structural:
      // every existing caller's promise is a dismissal or nothing.
      const answers: unknown[] = [];
      render(
        <Harness
          id="dialog.rename"
          props={{ name: 'chapter one' }}
          onAnswer={(answer) => answers.push(answer)}
        />,
      );
      screen.getByRole('button', { name: 'Open' }).click();
      await screen.findByRole('dialog');

      await act(async () => {
        screen.getByRole('button', { name: 'Close' }).click();
        await Promise.resolve();
      });

      expect(answers).toStrictEqual([undefined]);
    });
  });
});
