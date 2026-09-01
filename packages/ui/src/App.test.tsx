// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { THEME_SETTING } from './settings/appearance.js';
import { SettingsStore } from './settingsStore.js';

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
  return new SettingsStore(new SettingsRegistry([THEME_SETTING]));
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

    expect(calls).toStrictEqual(['document.open']);
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

    expect(calls).toStrictEqual([]);
  });

  it('shows the page surface once a document is open, and stops showing the start screen', async () => {
    // The `opened` answer is what turns the start screen into a document view.
    // Both halves are asserted because a surface that added the canvas WITHOUT
    // removing the start screen is a different defect from one that did neither.
    const { client } = recordingClient({
      kind: 'opened',
      docId: DOC,
      version: asDocVersion(1),
      byteLength: 1024,
    });
    const { container } = render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open a document' }).click();
      await Promise.resolve();
    });

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

    expect(calls).toStrictEqual(['document.open']);
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

    expect(calls).toStrictEqual([]);
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

    expect(container.querySelectorAll('.m-start-screen button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Open a document' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'About' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reveal diagnostics log' })).toBeDefined();
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
