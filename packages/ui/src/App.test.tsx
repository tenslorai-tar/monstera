// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, fireEvent, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { THEME_SETTING } from './settings/appearance.js';
import { FIRST_PAGE } from './pageNumbering.js';
import { SettingsStore } from './settingsStore.js';
import { SPLIT_VIEW_SETTING } from './settings/viewing.js';

/**
 * The UI-level half of the wired-tools pair for `document.open`.
 *
 * §10.4: *"a control that renders but does nothing is a defect"*, and the pair
 * is what proves otherwise — this file asserts the button **dispatches exactly
 * that command**, and the kernel side asserts the command has an effect. Neither
 * counts alone: this one runs against a client whose handler is a stub, so on
 * its own it proves a button dispatches into the void.
 *
 * The rasterised page is not asserted here. happy-dom implements no canvas and
 * no worker, so PDF.js cannot parse — `proof:rendererpolicy` is where pixels are
 * read, in real Chromium.
 */
activateCatalogue('en', EN);

/**
 * THE PARSER IS STUBBED HERE, and continuous scroll is why.
 *
 * These cases are about dispatch and about surfaces: which command a control
 * sends, with what, and what the document surface renders. None is about PDF.js.
 *
 * The single-page version drew into a canvas that existed whether or not the
 * parse finished, so a stub was unnecessary — under happy-dom the parse never
 * finishes, and the cases asserted around it. The scroller cannot: **how many
 * slots a document has is the PARSER's answer**, so a surface with no parser has
 * no shape, and every case here would assert about an empty container.
 *
 * That is the seam being honest rather than a testing inconvenience. What it
 * costs is stated in `AppViewLifetime.test.tsx`'s own header — a mock is per
 * file, not per case — and what it buys is that these cases keep asking their
 * own question instead of PDF.js's.
 */
vi.mock('./documentView.js', () => ({
  openDocumentView: () =>
    Promise.resolve({
      // TWO PAGES, matching the view-model fixture below. A one-page stub would
      // make "a slot per page" and "a slot" the same observation.
      document: { numPages: 2 },
      close: () => Promise.resolve(),
    }),
}));

// MOCKED FOR THE VIEW'S REASON: happy-dom implements no 2d context, so the real
// `renderPage` refuses before it draws — which these cases would then have to
// treat as a failure rather than as the environment.
vi.mock('./renderPage.js', () => ({
  renderPage: () => Promise.resolve({ width: 595, height: 842 }),
}));

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function render(ui: ReactElement): ReturnType<typeof renderBare> {
  return renderBare(ui, { wrapper: Messages });
}

const DOC = asDocId('doc-1');

/**
 * A store per case, because a shared one carries the previous case's writes.
 *
 * `SettingsStore` is not React state and does not reset between renders, so a
 * case that assumed the default would pass in file order and fail alone.
 */
function freshSettings(): SettingsStore {
  // THE SHIPPED LIST, not a hand-picked subset. `App` reads four settings and
  // `SettingsStore.get` throws for an unregistered id, so a subset here is a
  // store the component under test cannot run against — and a subset that
  // happened to be enough today is one that silently stops matching `main.tsx`.
  return new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
}

// The root element is shared by every case in this file, and the theme cases
// write to it. Without this, "no attribute at the default" would pass only while
// it happened to run before the case that sets one — a case whose result depends
// on file order is one that passes for a reason it does not claim.
afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

/**
 * A client that records every channel it is asked for, and answers `answer`.
 *
 * ## One answer for every channel, and the exceptions are declared
 *
 * `createClient` parses what comes back through the real result schema, so an
 * answer shaped for `document.open` is REFUSED by any channel that declares
 * something else — as a rejected promise, from inside a floating handler, which
 * surfaces as an unhandled rejection rather than as a failing case. It passed
 * here and reddened CI.
 *
 * So a channel whose result cannot be `answer` gets its own entry below. The map
 * is the honest shape: this helper's contract is *"one answer unless the schema
 * says otherwise"*, and leaving it implicit is what made the next channel a
 * defect rather than a decision.
 */
const OTHER_ANSWERS: Partial<Record<string, unknown>> = {
  // Takes no parameters and answers a boolean. Nothing else in this file's
  // fixtures is shaped like it.
  'log.reveal': { revealed: false },
  // The start screen asks for this on every mount, so every case that renders
  // one needs an answer. Empty and clean is the first-launch state: a list
  // here would put rows in front of cases that are about something else, and
  // `lastExitClean: false` would put a recovery offer there.
  'document.recent': { entries: [], lastExitClean: true },
};

function recordingClient(answer: unknown): {
  readonly client: ContractClient;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const client = createClient(channels, (id) => {
    calls.push(id);
    return Promise.resolve(ok(OTHER_ANSWERS[id] ?? answer));
  });
  return { client, calls };
}

/**
 * The calls a COMMAND made, with the start screen's own read taken out.
 *
 * The recent list reads `document.recent` when it mounts, so *nothing was
 * dispatched* is no longer *no channel was called* — and the cases below are
 * about what a control does, not about whether a surface loads its own data.
 * Named rather than filtered inline so the exclusion is one decision with a
 * reason on it rather than four `.filter`s that read as noise.
 */
function commandCalls(calls: readonly string[]): readonly string[] {
  return calls.filter((id) => id !== 'document.recent');
}

/** One recorded call, with what the renderer sent. */
interface Sent {
  readonly id: string;
  readonly params: unknown;
}

/**
 * A client that answers each channel differently, and records the PARAMS.
 *
 * The document commands need this and `recordingClient` cannot give it: one
 * answer for every channel is enough to assert *which* command was dispatched,
 * and the wired-tools rule wants *which command with what* — a rotate that sent
 * `quarterTurns: 0` dispatches `document.execute` exactly as correctly as one
 * that rotates.
 *
 * Answers travel through the real schemas: `createClient` parses what comes
 * back, so an answer these cases invent that the contract would refuse fails
 * here rather than teaching a component a shape nothing ships.
 */
function answeringClient(answers: Readonly<Record<string, unknown>>): {
  readonly client: ContractClient;
  readonly sent: Sent[];
} {
  const sent: Sent[] = [];
  const client = createClient(channels, (id, params) => {
    sent.push({ id, params });
    const answer = answers[id];
    if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
    return Promise.resolve(ok(answer));
  });
  return { client, sent };
}

/** The answers a case needs to reach a document with the toolbar showing. */
const OPEN_DOCUMENT_ANSWERS = {
  'document.open': {
    kind: 'opened' as const,
    docId: DOC,
    version: asDocVersion(1),
    byteLength: 1024,
    name: 'annual.pdf',
  },
  // A parse never completes under happy-dom — no canvas, no worker — so the
  // range answer only has to be well formed. What these cases are about is the
  // dispatch, and the pixels have their own proof in real Chromium.
  'document.readRange': { kind: 'bytes' as const, bytes: new Uint8Array(8) },
  // TWO PAGES AND ONE OF THEM TURNED. An all-zero model is what a dropped array
  // and a flat document produce alike, so a fixture of zeros would make "the
  // renderer used the model" and "the renderer ignored it" the same observation.
  'document.viewModel': { version: asDocVersion(1), pageCount: 2, rotations: [90] },
};

/** Opens a document and settles the effects, leaving the toolbar rendered. */
async function withDocumentOpen(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Open a document' }).click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('App', () => {
  it('renders the document surface as a landmark', () => {
    // RESTORED, finding KKKKK-1. This assertion existed, was deleted when `App`
    // gained its props and the file was rewritten around the registry, and the
    // property survived only in `proof:rendererpolicy` — which needs a
    // provisioned Electron and reports UNVERIFIABLE on the job that installs
    // nothing. A misspelt class went from reddening every runner to reddening
    // half of them, in a commit that said nothing about the exchange.
    //
    // NOT REDUNDANT WITH THE HARNESS, and the difference is the subject: this
    // says `App` renders the landmark, and the harness says the SHIPPED BUNDLE
    // does under the pinned policy. The second is the stronger claim and it is
    // the one that cannot run everywhere, which is exactly why the cheap one
    // belongs here too.
    const { client } = recordingClient({ kind: 'cancelled' });

    const { container } = render(<App client={client} settings={freshSettings()} />);

    // `main` is the landmark role B9 requires of the document surface, and the
    // class is what `app.css` and the harness both key on — so the query is the
    // conjunction rather than either half, which is what the harness asks too.
    expect(container.querySelector('main.m-document-surface')).not.toBeNull();
  });

  it('renders the start screen from the REGISTRY, with the command’s resolved title', () => {
    // Queried by the English name rather than the key: a surface that leaked the
    // key would satisfy a query for `command.open-document.title`, which is the
    // defect the resolver exists to prevent.
    const { client } = recordingClient({ kind: 'cancelled' });

    render(<App client={client} settings={freshSettings()} />);

    expect(screen.getByRole('button', { name: 'Open a document' })).toBeDefined();
  });

  it('the control DISPATCHES document.open, and nothing else', async () => {
    // The wired-tools requirement, and the second half of the assertion is the
    // one that stops it being vacuous: a component that called every channel it
    // could reach would satisfy "document.open was called".
    const { client, calls } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open a document' }).click();
      await Promise.resolve();
    });

    expect(commandCalls(calls)).toStrictEqual(['document.open']);
  });

  it('CONTROL: nothing is dispatched until the control is used', async () => {
    // Without this, the case above passes for an App that opens a document on
    // mount — which would also produce exactly one `document.open` call, and is
    // a different program.
    const { client, calls } = recordingClient({ kind: 'cancelled' });

    render(<App client={client} settings={freshSettings()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(commandCalls(calls)).toStrictEqual([]);
  });

  it('shows the page surface once a document is open, and stops showing the start screen', async () => {
    // The `opened` answer is what turns the start screen into a document view.
    // Both halves are asserted because a surface that added the pages WITHOUT
    // removing the start screen is a different defect from one that did neither.
    //
    // `answeringClient` rather than `recordingClient` since continuous scroll:
    // the list's LENGTH comes from the view model's page count, so a client that
    // answers every channel the same way cannot produce a document with pages.
    // That is the scroller's shape being real rather than a test detail — a
    // surface built from a count has to be given one.
    const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
    const { container } = render(<App client={client} settings={freshSettings()} />);

    await withDocumentOpen();

    // TWO PAGES, because the fixture's model says two. A list that rendered one
    // slot per document, or a fixed number, passes `not.toBeNull()` and fails
    // this — which is the difference between *a surface appeared* and *the
    // document's shape appeared*.
    expect(container.querySelectorAll('.m-page-slot')).toHaveLength(2);
    // And the first page has a canvas: slots exist for every page, a canvas only
    // for the ones in view.
    expect(container.querySelector('canvas.m-page')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Open a document' })).toBeNull();
  });

  it('a cancelled pick leaves the start screen alone', async () => {
    // ASSERT THE STATE THAT DID NOT CHANGE. A user dismissing a picker is an
    // outcome, and the App's correct response is to do nothing — which is also
    // what a broken dispatch produces, so the case above is what separates them.
    const { client } = recordingClient({ kind: 'cancelled' });
    const { container } = render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open a document' }).click();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Open a document' })).toBeDefined();
    expect(container.querySelector('canvas.m-page')).toBeNull();
  });

  it('the registered CHORD dispatches the same command the button does', async () => {
    // Exit clause 8. The chord is a property of the command — the shortcut map
    // is a projection of the registry — so this asserts the projection reaches a
    // real key press, not that a keymap file has an entry.
    const { client, calls } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(commandCalls(calls)).toStrictEqual(['document.open']);
  });

  it('CONTROL: an UNREGISTERED chord dispatches nothing and is left to the browser', async () => {
    // Both halves matter. Without the first, the case above passes for a handler
    // that runs the one command on any key at all. The second is the rule
    // `dispatchChord` exists for: a chord no command claims must not be
    // swallowed, because an application that eats a shortcut to run nothing is
    // the report nobody can reproduce.
    const { client, calls } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    const event = new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(commandCalls(calls)).toStrictEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('the claimed chord IS prevented, so the browser does not act on it too', async () => {
    const { client } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    const event = new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it('the registered SETTING is read, and changing it moves the root attribute', async () => {
    // Exit clause 7, and the assertion is the whole point of it: a registered
    // key nothing reads is the display-only sin one layer down. `tokens.css`
    // remaps every token under `[data-theme]`, so the attribute IS the effect —
    // no component consults this value again.
    const { client } = recordingClient({ kind: 'cancelled' });
    const settings = freshSettings();
    render(<App client={client} settings={settings} />);

    // `system` is a value, not an absence: the bare `:root` block is what it
    // resolves to, so the attribute is removed rather than spelt `system`.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    await act(async () => {
      settings.set(THEME_SETTING.id, 'dark');
      await Promise.resolve();
    });

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('CONTROL: a value the schema refuses does NOT move it', async () => {
    // Without this, the case above passes for a component that writes whatever
    // it is handed — and the registry's validation would then be decoration.
    // `set` refuses, so the attribute must still say what the last valid write
    // said rather than following the rejected one.
    const { client } = recordingClient({ kind: 'cancelled' });
    const settings = freshSettings();
    render(<App client={client} settings={settings} />);

    await act(async () => {
      settings.set(THEME_SETTING.id, 'dark');
      await Promise.resolve();
    });
    expect(() => {
      settings.set(THEME_SETTING.id, 'chartreuse');
    }).toThrow();

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('the registered DIALOG opens with what main said, through the one mount point', async () => {
    // Exit clause 6, and the content is the point: this dialog shows the running
    // application's real version and channel, so it is wrong the moment anything
    // about it breaks — rather than a dialog that renders correctly whatever the
    // application is doing.
    const { client } = recordingClient({ version: '1.2.3', installChannel: 'development' });
    render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'About' }).click();
      await Promise.resolve();
    });

    // The TITLE arrives with the dialog and the BODY arrives with its chunk —
    // Decision 7's laziness — so finding the dialog and then reading its text
    // asserts on the Suspense fallback. Measured, exactly that: `textContent`
    // was "About Monstera" and nothing else. Waiting for the content is the
    // assertion; the dialog it sits in is checked by the query's own ancestry.
    expect(await screen.findByRole('dialog', { name: 'About Monstera' })).toBeDefined();
    expect(await screen.findByText('1.2.3')).toBeDefined();
    expect(await screen.findByText('development')).toBeDefined();
  });

  it('CONTROL: nothing is mounted until the dialog is opened', async () => {
    // `DialogHost` renders nothing when none is open — not a hidden dialog — so
    // without this the case above passes for a host that mounts every registered
    // dialog and shows one. A mounted-but-closed dialog keeps its body's state
    // across opens, which is the defect Decision 7's laziness exists for.
    const { client } = recordingClient({ version: '1.2.3', installChannel: 'development' });
    render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('the document commands, and the toolbar that projects them', () => {
    it('the toolbar is ABSENT until a document is open', async () => {
      // §10.4's rule one layer up from a dead button: an empty container that
      // looks like a surface under construction. Every command placed here
      // declares `when`, so the model is empty and `QuickToolbar` renders null —
      // and this is what says the `when` is doing the work rather than the
      // component checking application state, which would be the surface
      // deciding its own contents.
      const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
      render(<App client={client} settings={freshSettings()} />);

      expect(screen.queryByRole('toolbar')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Rotate page' })).toBeNull();

      await withDocumentOpen();

      expect(screen.getByRole('toolbar', { name: 'Document tools' })).toBeDefined();
    });

    it('the ROTATE control names the SAME page the renderer asked the model about', async () => {
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Rotate page' }).click();
        await Promise.resolve();
      });

      // THE PARAMS, not just the channel. A rotate that sent `quarterTurns: 0`
      // or an empty page list dispatches `document.execute` exactly as
      // correctly as one that rotates, so asserting the id alone would pass for
      // a control that does nothing to the document.
      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
      });

      // AND THE CORRESPONDENCE, which is the half a literal cannot carry. This
      // command shipped as `pages: [1]` — PDF.js numbers pages from 1 and the
      // document model indexes from 0 — so it rotated the page after the one on
      // screen, on a build with no navigation, where nothing could disagree. The
      // two call sites are now required to name the same index, and asserting
      // `[0]` above without this would pin the constant and not the property.
      const asked = sent.filter((call) => call.id === 'document.viewModel');
      expect(asked).not.toHaveLength(0);
      expect(asked[0]?.params).toStrictEqual({ docId: DOC, pages: [0] });
    });

    it('THE THREE ROTATIONS SEND THREE DIFFERENT ANGLES, not one control three times', async () => {
      // D2's rotate row is a surface over the command Stage 0 declared, and the
      // whole of what a surface can get wrong is the argument. A factory that
      // ignored its parameter would put three buttons on the toolbar, pass
      // every existing case, and turn every page 90° — which is the display-only
      // defect with two extra controls on it.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      for (const name of ['Rotate page', 'Rotate page 180°', 'Rotate page 270°']) {
        await act(async () => {
          screen.getByRole('button', { name }).click();
          await Promise.resolve();
        });
      }

      expect(
        sent
          .filter((call) => call.id === 'document.execute')
          .map((call) => (call.params as { command: { quarterTurns: number } }).command.quarterTurns),
      ).toStrictEqual([1, 2, 3]);
    });

    it('THE DELETE-PAGES CONTROL OPENS A DIALOG, and applying it sends the parsed range', async () => {
      // The mutation-dialog gate, end to end through the REAL dialog: the
      // registry entry, the lazy body, the parser and the result schema. The
      // command-level cases stub `ask` and cannot say the dialog exists; the
      // seam's own cases use a fixture dialog and cannot say this one is
      // registered. This is the case that needs all three to be true.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Delete pages…' }).click();
        await Promise.resolve();
      });

      const field = await screen.findByLabelText('Pages to delete');
      await act(async () => {
        fireEvent.change(field, { target: { value: '1' } });
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Delete pages' }).click();
        await Promise.resolve();
      });

      // ONE-BASED IN, ZERO-BASED OUT, and the conversion happened once. A
      // command re-converting what the dialog answered would send `[-1]`, which
      // the contract refuses; one that did not convert at all would send `[1]`
      // and delete the second page.
      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        command: { kind: 'deletePages', pages: [0] },
      });
    });

    it('CONTROL: dismissing the delete-pages dialog sends nothing', async () => {
      // The gate at application scale. Same control, same dialog, closed
      // instead of applied — and the assertion is the call that was not made,
      // because the document is untouched either way.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Delete pages…' }).click();
        await Promise.resolve();
      });
      await screen.findByLabelText('Pages to delete');

      await act(async () => {
        screen.getByRole('button', { name: 'Close' }).click();
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.execute')).toHaveLength(0);
    });

    it('THE INSERT-BLANK CONTROL SENDS at ONE PAST the page on screen', async () => {
      // The UI half of insert blank's pair; `pageOrder.test.ts` says the page
      // lands there and takes its neighbour's geometry.
      //
      // `at: 1` from a document showing page 0 — and the +1 is the assertion,
      // because a command sending `at: context.page` inserts BEFORE the page
      // being read and moves it out from under the reader, which looks like a
      // scroll rather than a bug.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Insert blank page' }).click();
        await Promise.resolve();
      });

      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        command: { kind: 'insertBlankPage', at: 1 },
      });
    });

    it('THE DUPLICATE CONTROL SENDS duplicatePage FOR THE PAGE ON SCREEN', async () => {
      // The UI half of duplicate's pair; `pageOrder.test.ts` is the kernel half
      // and says the copy lands after the source and is a separate page object.
      //
      // The two page commands sit next to each other in the toolbar and carry
      // the same argument, so each case asserts the KIND as well as the index —
      // a control wired to its neighbour dispatches just as correctly.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Duplicate page' }).click();
        await Promise.resolve();
      });

      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        command: { kind: 'duplicatePage', page: 0 },
      });
    });

    it('THE DELETE CONTROL SENDS deletePages FOR THE PAGE ON SCREEN', async () => {
      // The UI half of delete's wired pair. The kernel half is
      // `pageOrder.test.ts`, which reads a saved document back with pdf-lib and
      // says the right pages went; this says a person can reach it and that the
      // index it carries is the one being displayed.
      //
      // THE COMMAND KIND IS PART OF THE ASSERTION. A control wired to
      // `rotatePages` dispatches `document.execute` just as correctly, and the
      // toolbar would look identical — which is what the pair exists to
      // separate.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Delete page' }).click();
        await Promise.resolve();
      });

      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        // ZERO, and it is the KERNEL frame — `SHOWN_PAGE`'s correspondence
        // again, on the command where getting it wrong deletes the wrong page.
        command: { kind: 'deletePages', pages: [0] },
      });
    });

    /**
     * The UI half of SEARCH's wired pair.
     *
     * The kernel half lives in `apps/desktop/src/documentCommands.test.ts` and
     * says a search finds text that is really in a document. This says a person
     * can reach it: type, submit, and `document.searchPage` goes out with the
     * query that was typed and the page that is on screen.
     *
     * Neither half alone counts. A field that dispatched into a handler
     * answering nothing would pass this; a command that searched perfectly with
     * no way to invoke it would pass the other.
     */
    it('the FIND control sends the typed query for the page on screen', async () => {
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.searchPage': {
          version: asDocVersion(1),
          matches: [{ line: 1, offset: 4, text: 'the needle sits here' }],
          truncated: false,
        },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      const field = screen.getByLabelText('Find on this page');
      await act(async () => {
        fireEvent.change(field, { target: { value: 'needle' } });
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Search this page' }).click();
        await Promise.resolve();
      });

      // THE PARAMS, not the channel. A bar that sent an empty query, or the
      // wrong page, dispatches `document.searchPage` exactly as correctly as one
      // that searches — which is the whole reason this asserts four fields.
      const searched = sent.filter((call) => call.id === 'document.searchPage');
      expect(searched).toHaveLength(1);
      expect(searched[0]?.params).toStrictEqual({
        docId: DOC,
        page: FIRST_PAGE.kernel,
        query: 'needle',
        limit: 100,
        // THE FLAGS THE BAR IS SHOWING, sent explicitly rather than omitted
        // when unset. A bar that dropped them would look identical here while
        // the checkboxes on screen said something else — the flags are what the
        // user set, and what was asked for is what must cross.
        caseSensitive: false,
        wholeWord: false,
        regex: false,
      });

      // AND THE CORRESPONDENCE, taken from the same place the surface takes it
      // from rather than written as `0` here. Three numbers cross this boundary
      // — a page, a line and an offset — and only the page changes meaning on
      // the other side; asserting a literal would pin the constant instead of
      // the property, which is exactly how the rotate shipped wrong.
      //
      // A document that has just opened is scrolled to the top, so the current
      // page is the first one. What this pins is that the bar sends the page the
      // reader is on, not that the reader is on page 0.
      const asked = sent.filter((call) => call.id === 'document.viewModel');
      expect(asked[0]?.params).toStrictEqual({ docId: DOC, pages: [FIRST_PAGE.kernel] });

      // The matched line reaches the screen, so this is not a dispatch into a
      // void that happens to be well formed.
      expect(screen.getByText('the needle sits here')).toBeDefined();
    });

    it('a TOGGLED option reaches the channel, and only the one that was toggled', async () => {
      // The other half of the case above. That one pins that the flags cross;
      // this pins that they carry what the user set — a bar sending three
      // constants passes the first and none of this.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.searchPage': { version: asDocVersion(1), matches: [], truncated: false },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        fireEvent.change(screen.getByLabelText('Find on this page'), {
          target: { value: 'ne+dle' },
        });
        screen.getByLabelText('Regular expression').click();
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Search this page' }).click();
        await Promise.resolve();
      });

      const searched = sent.filter((call) => call.id === 'document.searchPage');
      expect(searched[0]?.params).toStrictEqual({
        docId: DOC,
        page: FIRST_PAGE.kernel,
        query: 'ne+dle',
        limit: 100,
        caseSensitive: false,
        wholeWord: false,
        regex: true,
      });
    });

    it('SEARCHES EVERY PAGE when asked, one page at a time', async () => {
      // The whole-document walk, which is `document.searchPage` per page —
      // ADR-0035 keeps a document's text out of `main`, so there is no channel
      // that could answer this in one call.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.searchPage': {
          version: asDocVersion(1),
          matches: [{ line: 0, offset: 0, text: 'a line' }],
          truncated: false,
        },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        fireEvent.change(screen.getByLabelText('Find on this page'), {
          target: { value: 'needle' },
        });
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Search all pages' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // The fixture's document has two pages, and the walk asked for both —
      // in order, and by the kernel's numbering rather than the reader's.
      expect(
        sent
          .filter((call) => call.id === 'document.searchPage')
          .map((call) => (call.params as { page: number }).page),
      ).toStrictEqual([0, 1]);
      // TWO MATCHES, one per page, reported as a document total. A walk that
      // published the last page's answer alone would say one.
      expect(screen.getByText('2 matches in this document')).toBeDefined();
    });

    it('CANCELLING a whole-document search keeps NOTHING it had already found', async () => {
      // The property the walk exists for, asserted where a reader meets it. A
      // partial count is indistinguishable from a complete one on screen — it
      // says "one match" about a document holding two — so the cancelled state
      // has no matches to show rather than an empty list it chose not to show.
      //
      // The answers are DEFERRED so the walk can be caught mid-flight. With an
      // immediately-resolving client the two-page walk finishes before any
      // click could land, and the case would assert about a completed search.
      const pending: (() => void)[] = [];
      const client = createClient(channels, (id, _params) => {
        if (id === 'document.searchPage') {
          return new Promise((resolve) => {
            pending.push(() => {
              resolve(
                ok({
                  version: asDocVersion(1),
                  matches: [{ line: 0, offset: 0, text: 'a line' }],
                  truncated: false,
                }),
              );
            });
          });
        }
        const answer = (OPEN_DOCUMENT_ANSWERS as Record<string, unknown>)[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        fireEvent.change(screen.getByLabelText('Find on this page'), {
          target: { value: 'needle' },
        });
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Search all pages' }).click();
        await Promise.resolve();
      });

      // Page 0 is in flight and nothing has been answered yet.
      expect(pending).toHaveLength(1);

      await act(async () => {
        screen.getByRole('button', { name: 'Cancel' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        // The answer to page 0 arrives AFTER the cancel, which is the ordering
        // that matters: it is an answer to a question the reader withdrew.
        pending[0]?.();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText('Search cancelled. No results were kept.')).toBeDefined();
      // NO COUNT, of any size. `1 match` and `2 matches` are both wrong here,
      // and asserting the absence of the string is what separates *published
      // nothing* from *published the part it had*.
      expect(screen.queryByText(/matches in this document/u)).toBeNull();
      // AND IT STOPPED ASKING. Page 1 was never requested, so the cancel
      // reached the walk rather than only the surface.
      expect(pending).toHaveLength(1);
    });

    it('an UNPARSEABLE pattern says so, rather than "this page could not be searched"', async () => {
      // The one refusal on this channel that is about what the user typed. A
      // person types `(` on the way to `(a)`, and telling them the document is
      // unavailable is both wrong and unactionable.
      const client = createClient(channels, (id, _params) => {
        if (id === 'document.searchPage') {
          return Promise.resolve(err({ code: 'search-pattern-invalid' }));
        }
        const answer = (OPEN_DOCUMENT_ANSWERS as Record<string, unknown>)[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        fireEvent.change(screen.getByLabelText('Find on this page'), { target: { value: '(' } });
        screen.getByLabelText('Regular expression').click();
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Search this page' }).click();
        await Promise.resolve();
      });

      expect(screen.getByText('That is not a valid regular expression.')).toBeDefined();
      // AND NOT THE OTHER SENTENCE. Without this the case passes for a bar that
      // shows both, which is the state a reader cannot act on.
      expect(screen.queryByText('This page could not be searched just now.')).toBeNull();
    });

    it('CONTROL: an empty query dispatches NOTHING', async () => {
      // Without this the case above passes for a bar that searches on every
      // render, or on focus — and an empty query is the state the box starts in,
      // so that bar would search the document before the user typed anything.
      const { client, sent } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Search this page' }).click();
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.searchPage')).toStrictEqual([]);
    });

    it('the find CHORD takes the caret to the field the bar renders', async () => {
      // The command's whole effect, asserted as the effect rather than as a
      // dispatch: `document.find` sends no channel, so a case counting calls
      // would find none and prove nothing.
      const { client } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      expect(document.activeElement).not.toBe(screen.getByLabelText('Find on this page'));

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true }),
        );
        await Promise.resolve();
      });

      expect(document.activeElement).toBe(screen.getByLabelText('Find on this page'));
    });

    it('the GO-TO chord takes the caret to the status bar field', async () => {
      // The command's whole effect, asserted as the effect: `view.go-to`
      // carries no page number and sends no channel, for `document.find`'s
      // reason — a registered command's `run` takes no arguments, so the number
      // belongs to the surface and the command's job is to get the reader
      // there.
      //
      // `Ctrl+Shift+G` rather than `Ctrl+G`, which `view.toggle-grid` holds —
      // the shortcut map refused the collision on the first run rather than
      // dispatching to whichever registration came last.
      //
      // WHAT IS NOT ASSERTED HERE: that submitting the field moves the reader.
      // The status readout follows `currentPage`, which the SCROLLER reports
      // from an intersection observer that happy-dom never runs — so a case
      // asserting "Page 2 of 2" fails for the environment rather than for the
      // wiring. The conversion and the dispatch are `StatusBar.test.tsx`'s,
      // against `onGoTo`; what stays uncovered by both is one line in `App`
      // handing that prop `navigator.jumpTo`, which is the same prop three
      // other jump surfaces are wired with in the same block.
      const { client } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      const field = screen.getByLabelText('Go to page');
      expect(document.activeElement).not.toBe(field);

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'G',
            ctrlKey: true,
            shiftKey: true,
            cancelable: true,
          }),
        );
        await Promise.resolve();
      });

      expect(document.activeElement).toBe(field);
    });

    /*
     * WHAT IS NOT ASSERTED HERE, and where it is instead.
     *
     * That the view is rebuilt against the new byte length is the half a
     * dispatch assertion cannot see, and happy-dom cannot see it either: it
     * implements no canvas and no worker, so PDF.js never starts and the
     * transport is never driven — a case reading the range requests found
     * **zero** of them, and its own vacuity guard is what said so rather than
     * letting it pass on an empty lookup.
     *
     * So the claim is split across the levels that can hold it:
     *
     *   - `commands/documentCommands.test.ts` — the command hands `onApplied`
     *     both scalars, and does not call it for an outcome that changed
     *     nothing;
     *   - `documentTransport.test.ts` — a transport is bound to one version and
     *     refuses bytes for another;
     *   - `proof:canvaspixels` — a real Chromium, where a page actually draws.
     *
     * Splitting it is not the same as covering it, and the link that had no test
     * of its own — that `App` feeds the command's answer back into the open
     * document — is finding PPPPP-1 and is covered by the case below. It was
     * found by deleting `onApplied` from both commands and watching 19 of 19
     * cases stay green.
     */

    it('a rotate that MOVED the version makes the renderer read the view model again', async () => {
      // PPPPP-1, and it is the positive direction three neighbouring cases were
      // missing. They all assert a call that was NOT made — an exhausted undo
      // does not rebuild, a save does not rebuild — and a component that could
      // not rebuild at all satisfies every one of them. This asserts the call
      // that MUST be made.
      //
      // The view model is the observable because it is the one thing the
      // renderer asks for per version that happy-dom does not swallow: the
      // canvas never draws here and the transport is never driven, so range
      // requests cannot carry this claim.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      const before = sent.filter((call) => call.id === 'document.viewModel').length;
      expect(before).toBeGreaterThan(0);

      await act(async () => {
        screen.getByRole('button', { name: 'Rotate page' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      // The chain this asserts, end to end inside the renderer: the command's
      // answer reaches `onApplied`, `onApplied` moves the open document's
      // version, the moved version re-runs the canvas effect, and the effect
      // re-reads the geometry the kernel now holds. Break any link and the count
      // does not move.
      expect(sent.filter((call) => call.id === 'document.viewModel').length).toBeGreaterThan(before);
    });

    it('the UNDO control dispatches document.undo, and its chord dispatches the same', async () => {
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.undo': { kind: 'undone' as const, version: asDocVersion(2), byteLength: 900 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Undo' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
        await Promise.resolve();
      });

      // TWICE, from two routes, and the count is the assertion. §7 makes the
      // shortcut map a projection of the same registry, so a chord that reached
      // a different command — or no command — is what this separates. One call
      // would mean one of the two routes is dead.
      expect(sent.filter((call) => call.id === 'document.undo')).toHaveLength(2);
    });

    it('an exhausted undo changes nothing, so the view is not rebuilt', async () => {
      // ASSERT THE CALL THAT WAS NOT MADE. `nothing-to-undo` is a success, and a
      // renderer that treated it as a move would reopen the document — a visible
      // reparse for a key press that did nothing. The tidy end state is the same
      // either way, so the range requests are what separate them.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.undo': { kind: 'nothing-to-undo' as const },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      const before = sent.filter((call) => call.id === 'document.readRange').length;
      await act(async () => {
        screen.getByRole('button', { name: 'Undo' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.readRange')).toHaveLength(before);
    });

    it('the SAVE control dispatches document.save, and does NOT rebuild the view', async () => {
      // A save changes the file, not the document. The version bumps — §4 bumps
      // it for every applied mutation — and the canonical image is the same
      // bytes the renderer is already showing, so reopening would reparse a
      // document that has not changed.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.save': { kind: 'saved' as const, version: asDocVersion(2) },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      const before = sent.filter((call) => call.id === 'document.readRange').length;
      await act(async () => {
        screen.getByRole('button', { name: 'Save' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.save')).toHaveLength(1);
      expect(sent.filter((call) => call.id === 'document.readRange')).toHaveLength(before);
      // AND NO DIALOG. A save-problem dialog on the successful path is one the
      // user meets every time they press Ctrl+S.
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('a REFUSED save opens the dialog, and it leads with the work being intact', async () => {
      // Invariant 18's obligation read forwards: *"never by a dialog whose only
      // option discards their edits"* is a prohibition, and the thing it implies
      // is that the user must be TOLD their work survived. Until 2026-08-30 a
      // refusal was silent, which is indistinguishable from success.
      //
      // The assertion is the sentence rather than the dialog's presence: a
      // dialog headed "The document was not saved" with an empty body is the
      // shape that renders and says nothing.
      const { client } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.save': { kind: 'refused' as const, reason: 'target-absent' as const },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Save' }).click();
        await Promise.resolve();
      });
      // Twice: once for the save's answer, once for the lazy body's chunk. The
      // body is `lazy()` per ADR-0029 Decision 7, so reading its text without
      // waiting asserts on the Suspense fallback.
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      // WAITING FOR THE CONTENT, not for the dialog. `findByRole('dialog')`
      // resolves as soon as the chrome mounts, and at that moment the body is
      // still the Suspense fallback — so a case that read the text there would
      // assert on an empty dialog. The About case learned the same thing.
      expect(await screen.findByRole('dialog', { name: 'The document was not saved' })).toBeDefined();
      expect(await screen.findByText(/Nothing has been lost/u)).toBeDefined();
      // AND THE REASON, because five refusals share one dialog and the whole
      // value of `reason` crossing the boundary is that the user is told which.
      expect(await screen.findByText(/no longer there/u)).toBeDefined();
    });

    it('a POISONED document is told about, and the sentence is invariant 18 clause (i)', async () => {
      // Clause (i) — retain the log, leave the file untouched, refuse rather
      // than close, **tell the user** — binds today, and the last of those four
      // had no mechanism: the code reached the renderer and met a bare
      // `if (!ok) return`. A user whose document the supervisor has given up on
      // saw a control that did nothing.
      //
      // The sentence matters more than the dialog. Refusing is what STRANDS the
      // work rather than destroying it, so a message that only reported a
      // failure would invite the one action that loses it.
      const client = createClient(channels, (id) => {
        if (id === 'document.execute') {
          return Promise.resolve(err({ code: 'document-poisoned' as const }));
        }
        // Read through a string-keyed view rather than `as keyof typeof`. The
        // cast would tell the compiler every id is present, which makes the
        // guard below "always false" — and deleting the guard because a cast
        // said so is how a fixture starts answering `undefined` to a channel
        // nobody added an answer for.
        const answers: Readonly<Record<string, unknown>> = OPEN_DOCUMENT_ANSWERS;
        const answer = answers[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await act(async () => {
        screen.getByRole('button', { name: 'Rotate page' }).click();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(await screen.findByRole('dialog', { name: 'That could not be done' })).toBeDefined();
      expect(await screen.findByText(/still open and unsaved/u)).toBeDefined();
    });
  });

  it('the start screen names no command itself — it renders what the registry holds', () => {
    // §7's rule made observable: the surface has these controls because the
    // registry has these commands, not because a list in a component says so.
    // `check:secondwiring` is the mechanical half; this is the behavioural one.
    //
    // Asserted by NAME rather than by count, and the count is a literal beside
    // them rather than `registry.available(...).length` — a count derived from
    // the registry agrees with any registry, which is 4c's shape in a test.
    // This case earned its keep when the second command landed: it failed, which
    // is what a surface following its registry is supposed to do.
    const { client } = recordingClient({ kind: 'cancelled' });
    const { container } = render(<App client={client} settings={freshSettings()} />);

    // `.m-start-actions`, not `.m-start-screen`: the screen now holds a
    // problem region as well, and scoping to the projection's own container is
    // what keeps this counting COMMANDS rather than every control on the page.
    expect(container.querySelectorAll('.m-start-actions button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open a document' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'About' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reveal diagnostics log' })).toBeDefined();
  });

  describe('the start screen reports an open that produced no document', () => {
    /** A client whose `document.open` answers one outcome. */
    function openAnswering(outcome: unknown): ContractClient {
      return createClient(channels, (id) => {
        if (id === 'document.open') return Promise.resolve(ok(outcome));
        const answer = OTHER_ANSWERS[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
    }

    /** Picks a document and settles, returning nothing. */
    async function pick(): Promise<void> {
      await act(async () => {
        screen.getByRole('button', { name: 'Open a document' }).click();
        await Promise.resolve();
      });
    }

    it('SAYS SO when the file has gone, where it used to say nothing at all', async () => {
      // The defect this closes: every outcome that was not a document returned
      // silently, so picking a moved file produced no feedback of any kind — a
      // control that appears to do nothing, behind a dispatch that worked.
      render(<App client={openAnswering({ kind: 'absent' })} settings={freshSettings()} />);
      await pick();

      expect(
        screen.getByText('That file could not be opened. It may have been moved, renamed or deleted.'),
      ).toBeDefined();
    });

    it('says something DIFFERENT when there is no room, because the answer is different', async () => {
      // Two outcomes, two next actions: one is *find the file*, the other is
      // *close a document*. One message for both would be a sentence that helps
      // with neither.
      render(
        <App
          client={openAnswering({ kind: 'at-capacity', wouldHold: 4096, ceiling: 2048 })}
          settings={freshSettings()}
        />,
      );
      await pick();

      expect(
        screen.getByText('There is not enough room to open that document. Close another one first.'),
      ).toBeDefined();
    });

    it('CONTROL: a cancelled pick says nothing', async () => {
      // A person changing their mind is not an error, and a screen that
      // reported one would train the reader to ignore the region entirely.
      const { container } = render(
        <App client={openAnswering({ kind: 'cancelled' })} settings={freshSettings()} />,
      );
      await pick();

      expect(container.querySelector('.m-start-problem')).toBeNull();
    });

    it('is announced ASSERTIVELY, because nothing else answers the reader', async () => {
      // `role="alert"` rather than the status bar's polite region: this appears
      // in response to something they just did, and a polite region would queue
      // behind whatever a screen reader was already saying.
      const { container } = render(
        <App client={openAnswering({ kind: 'absent' })} settings={freshSettings()} />,
      );
      await pick();

      expect(container.querySelector('.m-start-problem')?.getAttribute('role')).toBe('alert');
    });
  });

  describe('the split view', () => {
    /** Opens a document and returns the settings store driving the surface. */
    async function withDocument(): Promise<{ readonly settings: SettingsStore }> {
      const { client } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      const settings = freshSettings();
      render(<App client={client} settings={settings} />);
      await withDocumentOpen();
      return { settings };
    }

    it('shows ONE viewport by default, and TWO once the setting is on', async () => {
      const { settings } = await withDocument();

      expect(document.querySelectorAll('.m-page-list')).toHaveLength(1);

      await act(async () => {
        settings.set(SPLIT_VIEW_SETTING.id, true);
        await Promise.resolve();
      });

      // TWO SCROLLERS, over one document. The count is the observation because
      // a second pane that failed to mount and a setting that was not read
      // produce the same screen.
      expect(document.querySelectorAll('.m-page-list')).toHaveLength(2);
    });

    it('gives the second viewport a NAME, and leaves the first without one', async () => {
      // Two unnamed scrollable regions are two a screen-reader user cannot tell
      // apart, which is the whole of what the split is for. The first keeps no
      // name because with one pane there is nothing to distinguish it from.
      const { settings } = await withDocument();
      await act(async () => {
        settings.set(SPLIT_VIEW_SETTING.id, true);
        await Promise.resolve();
      });

      const panes = [...document.querySelectorAll('.m-page-list')];
      expect(panes.map((pane) => pane.getAttribute('aria-label'))).toStrictEqual([
        null,
        'Second view of this document',
      ]);
    });

    it('THE CONTROL DISPATCHES, and the setting is what it writes', async () => {
      // The UI half of the wired pair. The other half is the setting itself: a
      // registered definition with a schema and a fallback, which
      // `settings.test.ts` covers, and the surface above, which renders it.
      const { settings } = await withDocument();

      await act(async () => {
        screen.getByRole('button', { name: 'Split view' }).click();
        await Promise.resolve();
      });

      expect(settings.get(SPLIT_VIEW_SETTING.id)).toBe(true);
      expect(document.querySelectorAll('.m-page-list')).toHaveLength(2);
    });

    it('opens NO SECOND PARSER — both panes render through the same view', async () => {
      // The property the feature rests on. A pane that opened its own view
      // would parse the document twice, start a second worker and hold a second
      // copy of every page it drew — invisible on screen and doubled in memory.
      //
      // Read as the number of RANGE READS: a second parser fetches the
      // document's tail to find its trailer, so a second view is a second burst
      // of `document.readRange`. Under happy-dom no parse completes, so what
      // this asserts is that the split adds no new reads at all.
      const { client, sent } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      const settings = freshSettings();
      render(<App client={client} settings={settings} />);
      await withDocumentOpen();
      const before = sent.filter((call) => call.id === 'document.readRange').length;

      await act(async () => {
        settings.set(SPLIT_VIEW_SETTING.id, true);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.readRange')).toHaveLength(before);
      // AND THE SECOND PANE IS REALLY THERE, so the case is not passing because
      // nothing was added at all.
      expect(document.querySelectorAll('.m-page-list')).toHaveLength(2);
    });
  });

  describe('the recent list', () => {
    /** A client answering `document.recent` with what a case wants. */
    function withRecent(recent: unknown): { readonly client: ContractClient; readonly sent: Sent[] } {
      const sent: Sent[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'document.recent') return Promise.resolve(ok(recent));
        if (id === 'document.openRecent') {
          return Promise.resolve(
            ok({
              kind: 'opened' as const,
              docId: DOC,
              version: asDocVersion(1),
              byteLength: 1024,
              name: 'annual.pdf',
            }),
          );
        }
        const answer = (OPEN_DOCUMENT_ANSWERS as Record<string, unknown>)[id] ?? OTHER_ANSWERS[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      return { client, sent };
    }

    it('OPENS BY THE HANDLE the list carried, and no path is anywhere in reach', async () => {
      // The renderer names a file here, which nothing else in this build does —
      // and what makes it safe is that the value is a capability main minted,
      // not a path. A row that sent a name, or an index, would be a renderer
      // choosing a file.
      const { client, sent } = withRecent({
        entries: [
          { handle: 'handle-a', name: 'annual.pdf' },
          { handle: 'handle-b', name: 'notes.pdf' },
        ],
        lastExitClean: true,
        lastSession: [],
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        screen.getByRole('button', { name: 'notes.pdf' }).click();
        await Promise.resolve();
      });

      // THE SECOND ROW'S HANDLE, so a surface that always sent the first one
      // fails — which is the shape a list built from an index rather than from
      // the row's own datum produces.
      expect(sent.filter((call) => call.id === 'document.openRecent')).toStrictEqual([
        { id: 'document.openRecent', params: { handle: 'handle-b' } },
      ]);
    });

    it('shows an EMPTY list as empty rather than as nothing', async () => {
      const { client } = withRecent({ entries: [], lastExitClean: true, lastSession: [] });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText('Nothing opened yet.')).toBeDefined();
    });

    it('OFFERS TO REOPEN EVERY DOCUMENT the recorded session held', async () => {
      // The crash-recovery clause, and its subject changed with tabs. Both
      // halves still have to be true — a previous run that did not reach its
      // shutdown, and something to reopen — but the second half is now main's
      // RECORD of what was on screen rather than the head of the recent list.
      //
      // THE FIXTURE MAKES THOSE TWO DISAGREE, which is the whole case: the
      // session holds two documents and NEITHER is the newest recent entry. A
      // surface still inferring the offer from `entries[0]` would offer
      // `annual.pdf`, which is not in the session at all.
      const { client, sent } = withRecent({
        entries: [{ handle: 'handle-a', name: 'annual.pdf' }],
        lastExitClean: false,
        lastSession: [
          { handle: 'handle-b', name: 'draft.pdf' },
          { handle: 'handle-c', name: 'notes.pdf' },
        ],
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText('Monstera closed unexpectedly. These documents were open:')).toBeDefined();
      // BOTH, named. One control per document, each carrying the file it
      // reopens — a column of buttons all called "Reopen" is a column a
      // screen-reader user cannot tell apart.
      expect(screen.getByRole('button', { name: 'Reopen draft.pdf' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Reopen notes.pdf' })).toBeDefined();
      expect(screen.queryByRole('button', { name: 'Reopen annual.pdf' })).toBeNull();

      await act(async () => {
        screen.getByRole('button', { name: 'Reopen notes.pdf' }).click();
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.openRecent')).toStrictEqual([
        { id: 'document.openRecent', params: { handle: 'handle-c' } },
      ]);
    });

    it('CONTROL: an unclean run with NOTHING RECORDED offers nothing', async () => {
      // A run that died before opening anything. Without this case, the offer
      // could be driven by `lastExitClean` alone — and a reader who launched
      // the application and lost it would be shown a recovery prompt with no
      // rows under it, which reads as a defect rather than as *nothing to
      // recover*.
      const { client } = withRecent({
        entries: [{ handle: 'handle-a', name: 'annual.pdf' }],
        lastExitClean: false,
        lastSession: [],
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.queryByText('Monstera closed unexpectedly. These documents were open:'),
      ).toBeNull();
      expect(screen.getByRole('button', { name: 'annual.pdf' })).toBeDefined();
    });

    it('CONTROL: a clean previous run offers nothing, on the same list', async () => {
      // Without this, the case above passes for a surface that offers recovery
      // on every launch — which is the version a reader would learn to dismiss.
      // A SESSION IS SUPPLIED HERE, which is what makes this a control over
      // `lastExitClean` rather than over emptiness. Main clears the record on
      // a clean exit, so this fixture is one main would not produce — and that
      // is deliberate: a control whose input the correct build also refuses
      // for a second reason separates nothing.
      const { client } = withRecent({
        entries: [{ handle: 'handle-a', name: 'annual.pdf' }],
        lastExitClean: true,
        lastSession: [{ handle: 'handle-b', name: 'draft.pdf' }],
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByRole('button', { name: 'Reopen draft.pdf' })).toBeNull();
      // AND THE ROW IS STILL THERE, so the case is not passing because the list
      // failed to render at all.
      expect(screen.getByRole('button', { name: 'annual.pdf' })).toBeDefined();
    });

    it('CONTROL: an unclean run with NOTHING to reopen offers nothing', async () => {
      // The other half of the conjunction. An offer with no document behind it
      // is a control that cannot work — the display-only defect, arriving as a
      // message rather than as a button.
      const { client } = withRecent({ entries: [], lastExitClean: false });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    });

    it('says so when a row cannot be opened, and drops it', async () => {
      // A handle from a list held across a reload resolves to nothing this run
      // minted. The reader gets a sentence and the dead row goes.
      const sent: Sent[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'document.recent') {
          return Promise.resolve(
            ok({
              entries: [{ handle: 'stale', name: 'annual.pdf' }],
              lastExitClean: true,
              lastSession: [],
            }),
          );
        }
        if (id === 'document.openRecent') return Promise.resolve(err({ code: 'unknown-handle' }));
        const answer = (OPEN_DOCUMENT_ANSWERS as Record<string, unknown>)[id] ?? OTHER_ANSWERS[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        screen.getByRole('button', { name: 'annual.pdf' }).click();
        await Promise.resolve();
      });

      expect(
        screen.getByText('That document could not be opened. It may have been moved or renamed.'),
      ).toBeDefined();
    });
  });

  /**
   * The UI half of the wired-tools pair for `log.reveal`. The other half is
   * `shellLog.test.ts`, where a reveal reaches the platform with the log's own
   * directory, and `contractHandlers.test.ts`, where the handler asks once.
   */
  it('the REVEAL LOG control dispatches log.reveal, and nothing else', async () => {
    const { client, calls } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    // `act` with a promise it can settle: the click dispatches an async `run`,
    // and without something for React to flush the assertion below reads the
    // call list before the command has reached the client.
    await act(() => {
      screen.getByRole('button', { name: 'Reveal diagnostics log' }).click();
      return Promise.resolve();
    });

    // THE WHOLE CALL LIST, not `toContain`. A control that also opened a
    // document, or dispatched twice, satisfies a containment assertion
    // perfectly — and dispatching twice is what a reveal wired into a render
    // rather than a click would do.
    expect(calls.filter((call) => call === 'log.reveal')).toEqual(['log.reveal']);
    expect(calls).not.toContain('document.open');
  });
});
