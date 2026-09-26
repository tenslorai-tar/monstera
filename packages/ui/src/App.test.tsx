// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, err, ok } from '@monstera/shared';
import { act, cleanup, fireEvent, render as renderBare, screen, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { DropOpener } from './bridge.js';
import { reportProblem } from './commands/documentCommands.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { REDUCE_MOTION_SETTING, THEME_SETTING } from './settings/appearance.js';
import { FIRST_PAGE } from './pageNumbering.js';
import { SettingsStore } from './settingsStore.js';
import { resetSharedPainter } from './searchHighlight.js';
import { SPLIT_VIEW_SETTING } from './settings/viewing.js';
import { AUTOSAVE_SETTING } from './settings/saving.js';
import { FULL_APP_TEST_TIMEOUT } from './fullAppTestLimit.js';

// THIS FILE RENDERS THE WHOLE APP, whose tests' measured spread crosses Vitest's default limit.
vi.setConfig({ testTimeout: FULL_APP_TEST_TIMEOUT });

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
vi.mock('./renderPage.js', async (importOriginal) => ({
  // THE REAL MODULE UNDER THE STUB, so `RenderCancelledError` is the class callers test against.
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  // THE CROP AND THE ROTATION TOO, which the real one returns and this stub
  // omitted. Without them a slot measures to a size whose `crop` is undefined,
  // and the overlays that convert through it — the text layer among them — are
  // either not mounted or throw on their first conversion. The omission was
  // invisible while nothing in this file looked at an overlay.
  renderPage: () =>
    Promise.resolve({ width: 595, height: 842, crop: [0, 0, 595, 842], rotation: 0 }),
}));

// A PASS-THROUGH SPY, so a case can count how many times App reports a refusal. The dialog host
// shows one dialog at a time and a second replaces the first, which makes the screen blind to the
// count. Every case still gets the real function.
vi.mock('./commands/documentCommands.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./commands/documentCommands.js')>();
  return { ...actual, reportProblem: vi.fn(actual.reportProblem) };
});

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
  // EVERY RECENT CARD ASKS FOR ITS PICTURE (ADR-0100), and a case about something else gets the placeholder.
  'document.recentPreview': { kind: 'none' },
  'document.clearRecent': { cleared: 0 },
  // The start screen asks for this on every mount, so every case that renders
  // one needs an answer. Empty and clean is the first-launch state: a list
  // here would put rows in front of cases that are about something else, and
  // `lastExitClean: false` would put a recovery offer there.
  'document.recent': { entries: [], lastExitClean: true },
  // The shell announces its close subscription on every mount (`windowClose.ts`), so every case
  // here reaches it; without an answer of the channel's own shape the envelope fails validation
  // and each case carries an unhandled rejection.
  'window.closeListening': { acknowledged: true },
  // E3's rating prompt asks once per mount. Not due is every case's position: a banner here would put four
  // buttons in front of cases that are about something else.
  'app.reviewPrompt': { due: false },
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
  // `settings.loadSecrets` joins it (ADR-0056): the cloud tool is hidden until a
  // key is stored, so the registry asks which secrets are stored when the surface
  // loads — an id list, and never something a reader did.
  //
  // `app.info` joins them for the recent list's own reason (design pass H1a):
  // the start screen's footer shows the running build's version, so the shell
  // asks once when it mounts — a surface loading its own data, never a reader
  // using a control.
  // `window.closeListening` joins them, and for the same kind of reason: the shell tells main its
  // close subscription exists (`windowClose.ts`), which is the shell wiring itself up rather than a
  // reader using a control. That it is sent AT ALL is `AppClose.test.tsx`' case, where the
  // announcement is the subject instead of noise to be removed.
  // `app.reviewPrompt` joins them the same way: the shell asks main once whether the rating prompt is due
  // (E3). What the prompt then sends is `ReviewPrompt.test.tsx`' subject.
  return calls.filter(
    (id) =>
      id !== 'document.recent' &&
      id !== 'settings.loadSecrets' &&
      id !== 'app.info' &&
      id !== 'window.closeListening' &&
      id !== 'app.reviewPrompt',
  );
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
  // `OTHER_ANSWERS`' reason: the shell announces its close subscription on every mount, and these
  // fixtures throw on a channel they have no answer for.
  'window.closeListening': { acknowledged: true },
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
  // A SETTING WRITE SUCCEEDS, as it does in the product. `persistSettings` saves every
  // change, and a fixture with no answer here refused every save — which opened the
  // "Preference not saved" dialog behind every case that changed a setting. Cases that
  // counted elements never noticed, because a modal hides nothing from
  // `querySelectorAll`; the case that first chose a document panel by its accessible
  // role did, because a modal hides everything else from role queries.
  'settings.save': { stored: true as const },
  // TWO PAGES AND ONE OF THEM TURNED. An all-zero model is what a dropped array
  // and a flat document produce alike, so a fixture of zeros would make "the
  // renderer used the model" and "the renderer ignored it" the same observation.
  'document.viewModel': { version: asDocVersion(1), pageCount: 2, rotations: [90] },
  // THE SCROLLER ASKS FOR EVERY VISIBLE PAGE'S SELECTABLE TEXT, so a fixture
  // without an answer here rejects on every case that opens a document. Empty
  // rather than seeded: what these cases are about is the shell's dispatch, and
  // the text layer's own assertions live in `PageList.test.tsx` where the boxes
  // can be chosen.
  'document.pageTextLayer': {
    version: asDocVersion(1),
    lines: [],
    truncated: false,
    // `'empty'` and not `'image-only'`: these pages hold nothing, and seeding
    // the other would put a note on every page of every case in this file.
    kind: 'empty' as const,
  },
};

/** Opens a document and settles the effects, leaving the toolbar rendered. */
async function withDocumentOpen(): Promise<void> {
  await act(async () => {
    screen.getByRole('button', { name: 'Open PDF…' }).click();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Shows one of §10.3's document panels by its tab, the way a person does.
 *
 * The panel is ONE AT A TIME since design pass C, so the find field, the outline and the
 * form list are not in the document while another panel shows. The tab is found by its
 * accessible name, which is the panel's name, since there is no title row.
 */
async function openPanel(name: string): Promise<void> {
  await act(async () => {
    screen.getByRole('tab', { name }).click();
    await Promise.resolve();
  });
}

/**
 * Clicks a command's control wherever the ribbon has put it.
 *
 * ## Why the cases stopped being able to say `getByRole` on their own
 *
 * The ribbon renders ONE section at a time — that is what a section rail is —
 * so a control in Organize is not in the document while Home is showing. Before
 * 2026-09-08 every command was on the floating pill, which renders all of them
 * at once, and a case could reach any of them with no navigation.
 *
 * This walks the rail the way a person does: try here, and if the control is
 * not here, select the next section that has anything in it. That makes the
 * cases below assert something STRONGER than they did — a command reachable by
 * a reader, rather than a command in a flat list — and it fails loudly, with
 * the sections it tried, when a command is placed nowhere at all.
 */
async function pressCommand(name: string, section?: string): Promise<void> {
  const tried: string[] = [];
  const found = (): HTMLElement | null => screen.queryByRole('button', { name });

  let control = found();
  if (control === null) {
    // THE NAMED SECTION ALONE when a case names one, for the reason given at the More search below.
    const tabs = section === undefined ? /^(Home|Comment|Edit|Organize|Forms|Review|Protect|Tools)$/u : new RegExp(`^${section}$`, 'u');
    for (const tab of screen.queryAllByRole('button', { name: tabs })) {
      if (tab.hasAttribute('disabled')) continue;
      tried.push(tab.textContent);
      await act(async () => {
        tab.click();
        await Promise.resolve();
      });
      control = found();
      if (control !== null) break;
    }
  }
  if (control === null) {
    // IN A GROUP'S MORE, which is where a SECONDARY tool always is (ADR-0098) and a narrow window
    // puts a primary one: each More opened and read, then closed again. ONLY IN THE SECTION NAMED
    // when a case names one: opening every More in all eight sections is some sixty renders, which
    // is what pushed three cases past their time under the full suite, and naming the section is
    // also the stronger claim — the tool is reachable where the design puts it.
    const sections = section === undefined ? /^(Home|Comment|Edit|Organize|Forms|Review|Protect|Tools)$/u : new RegExp(`^${section}$`, 'u');
    for (const tab of screen.queryAllByRole('button', { name: sections })) {
      if (tab.hasAttribute('disabled')) continue;
      await act(async () => {
        tab.click();
        await Promise.resolve();
      });
      for (const more of screen.queryAllByRole('button', { name: 'More' })) {
        await act(async () => {
          fireEvent.click(more);
          await Promise.resolve();
        });
        const item = screen.queryByRole('menuitem', { name });
        if (item !== null) {
          await act(async () => {
            item.click();
            await Promise.resolve();
          });
          return;
        }
        await act(async () => {
          fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
          await Promise.resolve();
        });
      }
    }
    throw new Error(
      `No control named "${name}" in any ribbon section or any group's More. Tried: ${tried.join(', ') || 'none'}. ` +
        `A command with no placement is reachable only from the palette, which is legitimate — ` +
        `and then this case is asserting the wrong thing rather than finding a defect.`,
    );
  }
  const target = control;
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
}

/**
 * Every lazily-imported dialog body a case in this file waits for, loaded once
 * before any of them runs.
 *
 * ## The defect this closes, diagnosed 2026-09-06 on its second occurrence
 *
 * `declareDialog` takes `lazy(() => import('./XBody.js'))`, so opening a dialog
 * starts a dynamic import — and `findBy*` waits **1000 ms of wall clock** for
 * the content. Under the full suite that import competes with forty-five other
 * files, and the two race. Alone it always wins, which is why the failure
 * passed in isolation and on every re-run, and read as *flaky under load*.
 *
 * The DOM at the moment of failure is what named it rather than any hypothesis:
 * `<body>` carried the scroll lock and the background `div` carried
 * `data-base-ui-inert`, so the dialog was open and its portal was mounted, and
 * the only thing missing was the body React was still importing.
 *
 * ## Why a preload and not a longer timeout
 *
 * A bigger number leaves a test whose passing depends on how many other files
 * the worker happens to be running — the same defect further away. This removes
 * the race: by the time a case clicks, the module is in the registry and
 * `lazy` resolves on the first flush.
 *
 * **Nothing a case proves is weakened.** The registry entry, the real body, the
 * parser and each result schema all still run, and `lazy` is still what mounts
 * them. What has stopped being under test is how long an import takes, which no
 * case here ever meant to assert.
 *
 * ## FIVE SITES, NOT ONE
 *
 * Delete-pages is the one that fired. About, duplicate-pages, crop and the save
 * problem wait on their bodies exactly the same way and were the same latent
 * race — closing one and leaving four is the half-fix Rule 0 names.
 *
 * **This list is hand-kept and cannot be derived**, because a `lazy` payload is
 * not awaitable from outside React. A case added for a dialog missing here gets
 * the old race back, and it will present as this one did: green alone, green on
 * a re-run, red about once in a full suite. That is the cost, written down
 * rather than discovered again.
 */
beforeAll(async () => {
  await Promise.all([
    import('./dialogs/AboutBody.js'),
    import('./dialogs/CropPagesBody.js'),
    import('./dialogs/DeletePagesBody.js'),
    import('./dialogs/DuplicatePagesBody.js'),
    import('./dialogs/SaveProblemBody.js'),
  ]);
});

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

    expect(screen.getByRole('button', { name: 'Open PDF…' })).toBeDefined();
  });

  it('each feature card is NAMED by its title and DESCRIBED by its checked line (v5-01)', () => {
    const { client } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    const card = screen.getByRole('button', { name: 'Export anywhere' });
    const described = document.getElementById(card.getAttribute('aria-describedby') ?? '');
    // The build's claim, not the design's: *fidelity reports* is absent because only PDF/A reports one.
    expect(described?.textContent).toBe('Export to Word, Excel, PowerPoint, images and PDF/A.');
  });

  it('the control DISPATCHES document.open, and nothing else', async () => {
    // The wired-tools requirement, and the second half of the assertion is the
    // one that stops it being vacuous: a component that called every channel it
    // could reach would satisfy "document.open was called".
    const { client, calls } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open PDF…' }).click();
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

  it('*Rate Us* is REGISTERED: the title bar draws it, and it sends the rating answer (E3)', async () => {
    // `rateUs.test.ts` proves the command; this proves the shell registered it, which is the half a
    // tested command beside a missing registration leaves out. The start screen draws the title bar.
    const { client, calls } = recordingClient({ opened: true });
    render(<App client={client} settings={freshSettings()} />);
    await act(async () => {
      await Promise.resolve();
    });
    // NOT DUE here, so the prompt's *Rate now* is absent and this button is the only way to rate — the
    // control for the mounting case below.
    expect(screen.queryByRole('button', { name: 'Rate now' })).toBeNull();

    await act(async () => {
      screen.getByRole('button', { name: 'Rate Us' }).click();
      await Promise.resolve();
    });

    expect(commandCalls(calls)).toStrictEqual(['app.review']);
  });

  it('the rating prompt is MOUNTED, and drawn only when main says one is due', async () => {
    // What each answer sends is `ReviewPrompt.test.tsx`'; this is that the shell mounts it at all, against
    // the not-due answer every other case here gets.
    const client = createClient(channels, (id) =>
      Promise.resolve(ok(id === 'app.reviewPrompt' ? { due: true } : (OTHER_ANSWERS[id] ?? { kind: 'cancelled' }))),
    );
    render(<App client={client} settings={freshSettings()} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Rate now' })).toBeTruthy();
  });

  it('a cloud file DOWNLOADING is said on screen until main answers — the note the shell draws (busyNote.ts)', async () => {
    // `cloudStorage.test.ts` proves the command raises and ends the note; this is that the shell DRAWS it, with
    // main's answer held back so the download is still under way when the case looks.
    let answer: (value: unknown) => void = () => undefined;
    const pending = new Promise((settle) => {
      answer = settle;
    });
    const client = createClient(channels, (id) => {
      if (id === 'cloud.open') return pending.then((value) => ok(value));
      if (id === 'cloud.status') return Promise.resolve(ok({ providers: [{ provider: 'onedrive', state: 'signed-in' }] }));
      if (id === 'cloud.list') {
        return Promise.resolve(ok({ kind: 'listed', files: [{ id: 'f1', name: 'contract.pdf', size: 9, modified: null }] }));
      }
      const known = (OPEN_DOCUMENT_ANSWERS as Record<string, unknown>)[id] ?? OTHER_ANSWERS[id];
      return known === undefined ? Promise.reject(new Error(`no answer for ${id}`)) : Promise.resolve(ok(known));
    });
    render(<App client={client} settings={freshSettings()} />);
    await withDocumentOpen();
    // POLLED INSIDE `act`, one task at a time. The cloud dialog's body is a `React.lazy` import, so when it
    // arrives is a module load rather than a number of promise hops, and `findBy*` — which polls OUTSIDE `act` —
    // never saw it here in three runs of three: this environment is not configured for `act` and draws inside it.
    const until = async <T,>(find: () => T | null, what: string): Promise<T> => {
      for (let tries = 0; tries < 100; tries += 1) {
        const found = find();
        if (found !== null) return found;
        await act(async () => {
          await new Promise((done) => setTimeout(done, 0));
        });
      }
      throw new Error(`${what} never appeared`);
    };

    await pressCommand('Cloud storage…', 'Home');
    (await until(() => screen.queryByRole('button', { name: 'Show my PDFs' }), 'Show my PDFs')).click();
    (await until(() => screen.queryByRole('button', { name: 'Open contract.pdf' }), 'the listed file')).click();

    expect(await until(() => screen.queryByText('Downloading contract.pdf…'), 'the download note')).toBeTruthy();

    // AND IT GOES when main answers — here with a refusal, which reopens the dialog rather than a tab.
    await act(async () => {
      answer({ kind: 'refused', reason: 'unreachable' });
      await pending;
      await Promise.resolve();
    });
    expect(screen.queryByText('Downloading contract.pdf…')).toBeNull();
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
    // THE START SCREEN ITSELF, not the absence of an Open button.
    //
    // That button WAS the proxy, and it stopped being one on 2026-09-08 when
    // the ribbon gained Home › File: opening another document with one already
    // open is a thing a reader does, so the control is correctly present and
    // the old assertion would now fail for a build that is right. The subject
    // is the start screen, so the query names it.
    expect(container.querySelector('.m-start-screen')).toBeNull();
  });

  it('a cancelled pick leaves the start screen alone', async () => {
    // ASSERT THE STATE THAT DID NOT CHANGE. A user dismissing a picker is an
    // outcome, and the App's correct response is to do nothing — which is also
    // what a broken dispatch produces, so the case above is what separates them.
    const { client } = recordingClient({ kind: 'cancelled' });
    const { container } = render(<App client={client} settings={freshSettings()} />);

    await act(async () => {
      screen.getByRole('button', { name: 'Open PDF…' }).click();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Open PDF…' })).toBeDefined();
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

  it('a STORED theme is applied at launch: a hydrate after the first render moves the root attribute', async () => {
    // THE STARTUP ORDER, which the case below does not reach. `main.tsx` fires the hydrate
    // and renders without waiting, so the stored theme lands after `useTheme` first applied
    // the fallback. The notification is `*`, and the effect listened for its own id only.
    // Found by the design pass's screenshot of a stored light theme rendering dark.
    const { client } = recordingClient({ kind: 'cancelled' });
    const settings = freshSettings();
    render(<App client={client} settings={settings} />);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    await act(async () => {
      settings.hydrate({ [THEME_SETTING.id]: 'light' });
      await Promise.resolve();
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('REDUCE MOTION moves the root to data-motion="reduced", and back, including after a hydrate', async () => {
    // The attribute IS the effect: `app.css` stills every motion under it (`reducedMotion.test.ts` holds that list).
    const { client } = recordingClient({ kind: 'cancelled' });
    const settings = freshSettings();
    render(<App client={client} settings={settings} />);
    expect(document.documentElement.dataset['motion']).toBe('full');

    await act(async () => {
      settings.hydrate({ [REDUCE_MOTION_SETTING.id]: true });
      await Promise.resolve();
    });
    expect(document.documentElement.dataset['motion']).toBe('reduced');

    await act(async () => {
      settings.set(REDUCE_MOTION_SETTING.id, false);
      await Promise.resolve();
    });
    expect(document.documentElement.dataset['motion']).toBe('full');
  });

  it('and WINDOWS asking for reduced motion reduces it with the setting off', () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const { client } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    expect(document.documentElement.dataset['motion']).toBe('reduced');
    matchMedia.mockRestore();
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
    const { client } = recordingClient({ version: '1.2.3', installChannel: 'development', userName: 'A. Tester' });
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
    // THE CHANNEL IN WORDS, and the update line that belongs to it (E4).
    expect(await screen.findByText('Development build')).toBeDefined();
    expect(await screen.findByText('A development build. It does not check for updates.')).toBeDefined();
  });

  it('About’s two pages are OPENED BY NAME — the source and the third-party licences — and closing opens nothing', async () => {
    for (const [control, page] of [
      ['Source code', 'source'],
      ['Third-party licences', 'licences'],
    ] as const) {
      const sent: Sent[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'app.info') return Promise.resolve(ok({ version: '1.2.3', installChannel: 'store', userName: 'A. Tester' }));
        if (id === 'app.openWebPage') return Promise.resolve(ok({ opened: true }));
        return Promise.resolve(ok(OTHER_ANSWERS[id] ?? { kind: 'cancelled' }));
      });
      const { unmount } = render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        screen.getByRole('button', { name: 'About' }).click();
        await Promise.resolve();
      });
      // The Store build's own line, against the development one above.
      expect(await screen.findByText(/Updates are managed by the Microsoft Store/u)).toBeDefined();
      await act(async () => {
        (await screen.findByRole('button', { name: control })).click();
        await Promise.resolve();
      });
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 0));
      });
      // THE WHOLE PARAMETER: a place, never an address.
      expect(sent.filter((call) => call.id === 'app.openWebPage'), control).toStrictEqual([
        { id: 'app.openWebPage', params: { page } },
      ]);
      unmount();
    }
  });

  it('CONTROL: nothing is mounted until the dialog is opened', async () => {
    // `DialogHost` renders nothing when none is open — not a hidden dialog — so
    // without this the case above passes for a host that mounts every registered
    // dialog and shows one. A mounted-but-closed dialog keeps its body's state
    // across opens, which is the defect Decision 7's laziness exists for.
    const { client } = recordingClient({ version: '1.2.3', installChannel: 'development', userName: 'A. Tester' });
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

    it('a HIDDEN toolbar is restored by its chord, in the real application (§7)', async () => {
      // The guarantee §7 states: a hidden surface can always be restored. The pill's own controls
      // are gone once it is hidden, so what restores it must be something else — here the chord
      // the registry projects, pressed on the document the application listens to.
      const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();
      expect(screen.getByRole('toolbar', { name: 'Document tools' })).toBeDefined();

      const press = async (): Promise<void> => {
        await act(async () => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Q', ctrlKey: true, shiftKey: true, cancelable: true }));
          await Promise.resolve();
        });
      };
      await press();
      expect(screen.queryByRole('toolbar', { name: 'Document tools' })).toBeNull();
      await press();
      expect(screen.getByRole('toolbar', { name: 'Document tools' })).toBeDefined();
    });

    it('FOCUS from the keyboard and back: Escape returns to the mode left, and an Escape the palette used does not', async () => {
      // §10.3: "Focus (chrome hidden except the title bar, floating toolbar and status bar; Esc returns)". Two
      // properties only the composed application has: the chord reaches `view.layout-focus` from any mode, and an
      // Escape that closed the palette is consumed there — otherwise one key would close the palette AND leave Focus.
      const settings = freshSettings();
      const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
      render(<App client={client} settings={settings} />);
      await withDocumentOpen();
      // SET AFTER THE OPEN, so a hydrate from the client's stored settings cannot put Ribbon back underneath the case.
      await act(async () => {
        settings.set('appearance.layout-mode', 'studio');
        await Promise.resolve();
      });

      const key = async (init: KeyboardEventInit, target: EventTarget = document): Promise<void> => {
        await act(async () => {
          target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
          await Promise.resolve();
        });
      };

      await key({ key: 'F', ctrlKey: true, shiftKey: true });
      expect(settings.get('appearance.layout-mode')).toBe('focus');

      await key({ key: 'k', ctrlKey: true });
      const field = document.querySelector('.m-palette-query');
      if (!(field instanceof HTMLInputElement)) throw new Error('Ctrl+K opened the palette');
      await key({ key: 'Escape' }, field);
      expect(document.querySelector('.m-palette-query')).toBeNull();
      // THE LOAD-BEARING LINE: still Focus after the Escape the palette consumed.
      expect(settings.get('appearance.layout-mode')).toBe('focus');

      await key({ key: 'Escape' });
      // RETURNED TO STUDIO, the mode left — not to the Ribbon default.
      expect(settings.get('appearance.layout-mode')).toBe('studio');
    });

    it('the PALETTE closes on its own chord, pressed where focus is while it is open', async () => {
      // THE TOGGLE ROUTE, which only the composed application holds: the chord reaches the command through the
      // document's shortcut listener, and the command reaches the palette's state through the composition root. It
      // only opened until 2026-09-18, so Ctrl+K and the title bar's search could never shut a palette they had opened.
      const settings = freshSettings();
      const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
      render(<App client={client} settings={settings} />);
      await withDocumentOpen();

      const chord = async (target: EventTarget): Promise<void> => {
        await act(async () => {
          target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'k', ctrlKey: true }));
          await Promise.resolve();
        });
      };

      await chord(document);
      const field = document.querySelector('.m-palette-query');
      if (!(field instanceof HTMLInputElement)) throw new Error('Ctrl+K opened the palette');
      // FROM THE FIELD, where focus is while the palette is open — not the document, which no key press targets then.
      await chord(field);
      expect(document.querySelector('.m-palette-query')).toBeNull();
      // CONTROL: the same chord opens it again, so the line above is a toggle and not a chord that only ever closes.
      await chord(document);
      expect(document.querySelector('.m-palette-query')).not.toBeNull();
    });

    it('the TITLE BAR: its search opens the palette, and Focus chosen on its switcher still returns to the mode left', async () => {
      // §10.3: the title bar holds "the Ctrl+K command search, and the layout switcher". The Escape line is the one only
      // the composed application can separate: a switcher writing the setting itself would also reach Focus, and would
      // leave nothing remembered, so Escape would land on Ribbon.
      const settings = freshSettings();
      const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
      render(<App client={client} settings={settings} />);
      await withDocumentOpen();
      await act(async () => {
        settings.set('appearance.layout-mode', 'studio');
        await Promise.resolve();
      });

      const bar = document.querySelector('.m-title-bar');
      if (bar === null) throw new Error('the title bar is drawn');
      const search = [...bar.querySelectorAll('button')].find((button) => button.textContent.includes('Search commands'));
      if (search === undefined) throw new Error('the title bar carries the command search');
      await act(async () => {
        search.click();
        await Promise.resolve();
      });
      const field = document.querySelector('.m-palette-query');
      if (!(field instanceof HTMLInputElement)) throw new Error('the search opened the palette');
      await act(async () => {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      expect(document.querySelector('.m-palette-query')).toBeNull();

      const focus = [...bar.querySelectorAll('[role="group"] button')].find((button) => button.textContent === 'Focus');
      if (!(focus instanceof HTMLButtonElement)) throw new Error('the switcher offers Focus');
      await act(async () => {
        focus.click();
        await Promise.resolve();
      });
      expect(settings.get('appearance.layout-mode')).toBe('focus');
      // THE TITLE BAR STAYS IN FOCUS — it holds the tabs and the way out.
      expect(document.querySelector('.m-title-bar')).not.toBeNull();

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      expect(settings.get('appearance.layout-mode')).toBe('studio');
    });

    it('the ROTATE control names the SAME page the renderer asked the model about', async () => {
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await pressCommand('Rotate page');

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

    it('the TAB MENU opens on a right-click with the registered tab commands, and Close tab closes (§7)', async () => {
      // THROUGH THE REAL APPLICATION, because the registration lives here: a command that was never
      // registered, or a strip handed the wrong document, passes every unit case and shows no menu.
      const { client } = answeringClient(OPEN_DOCUMENT_ANSWERS);
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      const tab = document.querySelector(`[data-tab-select="${DOC}"]`);
      if (tab === null) throw new Error('no tab for the open document');
      await act(async () => {
        fireEvent.contextMenu(tab, { clientX: 10, clientY: 10 });
        await Promise.resolve();
      });

      const items = await screen.findAllByRole('menuitem');
      // ONE DOCUMENT OPEN, so *Close other tabs* is hidden rather than present and inert.
      expect(items.map((item) => item.getAttribute('data-command'))).toStrictEqual(['document.close-tab']);
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

      // WHAT A PERSON PRESSES, which is the accessible name where the tool is drawn. The quarter
      // turn is a button carrying its ribbon caption; the half and three-quarter turns are
      // SECONDARIES since the owner's v5 design (ADR-0098), so they are menu items in Pages' More,
      // and a menu item is named by the command's full title.
      for (const name of ['Rotate page', 'Rotate page 180°', 'Rotate page 270°']) {
        await pressCommand(name, 'Organize');
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

      await pressCommand('Delete pages…');

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

      await pressCommand('Delete pages…');
      await screen.findByLabelText('Pages to delete');

      await act(async () => {
        screen.getByRole('button', { name: 'Close' }).click();
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.execute')).toHaveLength(0);
    });

    it('THE DUPLICATE FINDER LISTS WHAT THE ENGINE FOUND, and removes the extra copies', async () => {
      // The UI half of the pair, end to end: the read channel, the real dialog,
      // the page-number conversion in its labels, and the delete it dispatches.
      // `pageDuplicates.test.ts` is the kernel half and says the grouping is
      // right; nothing there can say a person can reach it.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.duplicatePages': {
          version: asDocVersion(1),
          groups: [{ pages: [0, 3] }],
          truncated: false,
        },
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      // A SECONDARY in Pages' More (ADR-0098), so its menu item's full title.
      await pressCommand('Find duplicate pages…', 'Organize');

      // ONE-BASED IN THE LABEL. The model's `[0, 3]` reads as pages 1 and 4,
      // and a body that showed the indices would name two pages the reader
      // cannot find.
      await screen.findByText('Pages 1, 4');

      await act(async () => {
        screen.getByRole('button', { name: 'Remove 1 duplicate page(s)' }).click();
        await Promise.resolve();
      });

      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      // THE LATER COPY, and the earlier one survives — asserted because the
      // opposite choice deletes the page the document's order is built around
      // and produces a document that also has no duplicates.
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        command: { kind: 'deletePages', pages: [3] },
      });
    });

    it('THE CROP CONTROL OPENS A DIALOG, and applying it sends the margins typed', async () => {
      // The second argument-collecting command, end to end through the real
      // registry, lazy body and parser. `pageCrop.test.ts` is the kernel half.
      //
      // ONE EDGE IS TYPED AND THREE ARE LEFT EMPTY, which is the ordinary crop
      // and the case that says an empty field means zero rather than blocking.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await pressCommand('Crop pages…');

      const top = await screen.findByLabelText('Top (points)');
      await act(async () => {
        fireEvent.change(top, { target: { value: '12' } });
        await Promise.resolve();
      });
      await act(async () => {
        screen.getByRole('button', { name: 'Crop' }).click();
        await Promise.resolve();
      });

      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect(executed[0]?.params).toStrictEqual({
        docId: DOC,
        command: {
          kind: 'cropPages',
          // `'all'` is the dialog's default scope and it reaches the command
          // unexpanded — a list here would be invariant L11's payload back.
          pages: 'all',
          margins: { top: 12, right: 0, bottom: 0, left: 0 },
        },
      });
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

      // A SECONDARY in Pages' More (ADR-0098), so its menu item's full title.
      await pressCommand('Insert blank page', 'Organize');

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

      await pressCommand('Duplicate page');

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

      await pressCommand('Delete page');

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
          matches: [
            { line: 1, offset: 4, endLine: 1, endOffset: 10, text: 'the needle sits here' },
          ],
          truncated: false,
        },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();
      await openPanel('Search');

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

    it('a search PAINTS its matches on the page, through the whole chain', async () => {
      /*
       * The end-to-end half, and the reason it is here rather than in
       * `TextLayer.test.tsx`. That file proves the layer turns a search into
       * ranges over the right nodes; it hands the layer a painter, so it says
       * nothing about whether a search a person runs ever reaches one. Four
       * components sit between the find field and the glyphs — the bar's
       * effect, App's state, `PageCanvas`, `PageList` — and a prop dropped
       * anywhere in them leaves both halves green and the feature dead.
       *
       * The registry is faked because happy-dom has no Custom Highlight API,
       * and the fake is installed before render for the same reason
       * `sharedPainter` resolves lazily: the module asks the window once.
       */
      const registered = new Map<string, unknown>();
      Reflect.set(globalThis, 'CSS', {
        highlights: {
          set: (name: string, value: unknown) => registered.set(name, value),
          delete: (name: string) => registered.delete(name),
        },
      });
      Reflect.set(
        globalThis,
        'Highlight',
        class {
          readonly ranges: readonly Range[];
          constructor(...ranges: readonly Range[]) {
            this.ranges = ranges;
          }
        },
      );
      resetSharedPainter();

      try {
        const { client } = answeringClient({
          ...OPEN_DOCUMENT_ANSWERS,
          // THE LAYER'S OWN LINES, which is what the highlight is computed
          // from — the channel's match offsets are never used for painting,
          // because they index a string normalised somewhere else.
          'document.pageTextLayer': {
            version: asDocVersion(1),
            lines: [
              { text: 'the needle sits here', box: { x0: 10, y0: 10, x1: 200, y1: 26 } },
            ],
            truncated: false,
            kind: 'text' as const,
          },
          'document.searchPage': {
            version: asDocVersion(1),
            matches: [
              { line: 0, offset: 4, endLine: 0, endOffset: 10, text: 'the needle sits here' },
            ],
            truncated: false,
          },
        });
        render(<App client={client} settings={freshSettings()} />);
        await withDocumentOpen();
        await openPanel('Search');

        const field = screen.getByLabelText('Find on this page');
        await act(async () => {
          fireEvent.change(field, { target: { value: 'needle' } });
          await Promise.resolve();
        });
        // CONTROL, taken before the search: typing alone must paint nothing,
        // or this case would pass against a build that highlighted whatever is
        // in the box — which is a different feature and the wrong one.
        expect(registered.has('monstera-find')).toBe(false);

        await act(async () => {
          screen.getByRole('button', { name: 'Search this page' }).click();
          await Promise.resolve();
        });

        // The layer's own turns: a page is measured, then its text is fetched,
        // then the effect runs.
        await act(async () => {
          for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
        });
        // THE PRECONDITION, asserted rather than assumed. A page with no text
        // layer paints nothing for a reason that has nothing to do with the
        // feature, and the empty registry would read the same either way —
        // which is how this case failed on its first run, against a render stub
        // that returned no crop and so mounted no overlay at all.
        expect(document.querySelectorAll('.m-text-line')).toHaveLength(1);
        const painted = registered.get('monstera-find');
        expect(painted).toBeDefined();
        const ranges = (painted as { ranges: readonly Range[] }).ranges;
        expect(ranges).toHaveLength(1);
        // THE OFFSETS, so this is a highlight over the word and not a range
        // that happens to exist. `needle` starts at 4 in the layer's own line.
        expect(ranges[0]?.startOffset).toBe(4);
        expect(ranges[0]?.endOffset).toBe(10);
      } finally {
        Reflect.deleteProperty(globalThis, 'CSS');
        Reflect.deleteProperty(globalThis, 'Highlight');
        resetSharedPainter();
      }
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
      await openPanel('Search');

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
          matches: [{ line: 0, offset: 0, endLine: 0, endOffset: 1, text: 'a line' }],
          truncated: false,
        },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();
      await openPanel('Search');

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
                  matches: [{ line: 0, offset: 0, endLine: 0, endOffset: 1, text: 'a line' }],
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
      await openPanel('Search');

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
      await openPanel('Search');

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
      await openPanel('Search');

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

      // NOT ON SCREEN BEFORE THE CHORD, and this is stronger than the "not focused" this
      // case asserted before design pass C: the Pages panel shows by default, so the field
      // exists only if the chord opened the Search panel. A command that focused a field
      // it did not first reveal would find nothing to focus.
      expect(screen.queryByLabelText('Find on this page')).toBeNull();

      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true }),
        );
        await Promise.resolve();
        // ONE FRAME: the command focuses after the render its setting causes.
        await new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve(undefined);
          });
        });
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

      await pressCommand('Rotate page');
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

      await pressCommand('Undo');
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

    it('the REDO control dispatches document.redo, and Ctrl+Y dispatches the same', async () => {
      // Undo's pair, one direction along. Redo was built in the kernel from Stage 0 and reachable
      // from nothing until 2026-09-24; the count of two is what says both routes are live.
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.redo': { kind: 'redone' as const, version: asDocVersion(3), byteLength: 900 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await pressCommand('Redo');
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.redo')).toHaveLength(2);
      // AND NEITHER ROUTE REACHED UNDO, which a chord map keyed on the wrong letter would.
      expect(sent.filter((call) => call.id === 'document.undo')).toHaveLength(0);
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
      await pressCommand('Undo');
      await act(async () => {
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'document.readRange')).toHaveLength(before);
    });

    it('FORMS › MANAGE › FLATTEN sends flattenFormFields, the command the Forms panel’s button runs', async () => {
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'document.execute': { version: asDocVersion(2), byteLength: 2048, historyDropped: 0 },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      await pressCommand('Flatten', 'Forms');
      await act(async () => {
        await Promise.resolve();
      });

      const executed = sent.filter((call) => call.id === 'document.execute');
      expect(executed).toHaveLength(1);
      expect((executed[0]?.params as { command: { kind: string } }).command.kind).toBe('flattenFormFields');
    });

    it('the RAIL’S FOOT carries Settings, and pressing it opens the Settings dialog (ADR-0098)', async () => {
      const { client, sent } = answeringClient({
        ...OPEN_DOCUMENT_ANSWERS,
        'settings.loadSecrets': { stored: [], available: true },
      });
      render(<App client={client} settings={freshSettings()} />);
      await withDocumentOpen();

      // INSIDE THE RAIL, by its landmark, so the Tools › Application button of the same name is not
      // what this finds.
      const rail = screen.getByRole('navigation', { name: 'Sections' });
      const gear = within(rail).getByRole('button', { name: 'Settings' });
      // COUNTED FROM HERE: the window asks for the stored secrets at startup too.
      const before = sent.filter((call) => call.id === 'settings.loadSecrets').length;
      await act(async () => {
        gear.click();
        await Promise.resolve();
      });

      expect(sent.filter((call) => call.id === 'settings.loadSecrets')).toHaveLength(before + 1);
      expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeDefined();
    });

    it('the WINDOW TITLE carries the tab’s dot: after an edit, cleared by Save and by Save back to cloud', async () => {
      // THE VERSIONS MOVE AS MAIN'S DO: each edit mints the next, and each save states the one it
      // wrote. A fixed answer would make the second edit land on the version already saved, and
      // the dot could never come back for the save-back half of the case.
      let version = 1;
      const client = createClient(channels, (id) => {
        if (id === 'document.execute') {
          version += 1;
          return Promise.resolve(ok({ version: asDocVersion(version), byteLength: 2048, historyDropped: 0 }));
        }
        if (id === 'document.save') return Promise.resolve(ok({ kind: 'saved' as const, version: asDocVersion(version) }));
        if (id === 'cloud.saveBack') {
          return Promise.resolve(ok({ kind: 'saved-back' as const, version: asDocVersion(version) }));
        }
        const answers: Readonly<Record<string, unknown>> = OPEN_DOCUMENT_ANSWERS;
        const answer = answers[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      const settle = async (): Promise<void> => {
        await act(async () => {
          await Promise.resolve();
        });
      };
      render(<App client={client} settings={freshSettings()} />);
      // THE PRODUCT'S NAME with no document, never "Monstera" alone.
      expect(document.title).toBe('Monstera PDF Editor');

      await withDocumentOpen();
      expect(document.title).toBe('annual.pdf — Monstera PDF Editor');

      await pressCommand('Rotate page', 'Organize');
      await settle();
      expect(document.title).toBe('annual.pdf ● — Monstera PDF Editor');

      await pressCommand('Save', 'Home');
      await settle();
      expect(document.title).toBe('annual.pdf — Monstera PDF Editor');

      await pressCommand('Rotate page', 'Organize');
      await settle();
      expect(document.title).toBe('annual.pdf ● — Monstera PDF Editor');

      await pressCommand('Save back to cloud', 'Home');
      await settle();
      expect(document.title).toBe('annual.pdf — Monstera PDF Editor');
    });

    it('AUTOSAVE saves a changed document on its interval, and with the setting off it never does', async () => {
      // `autosave.test.ts` holds the decision; this is that the shell RUNS it — the setting read, the timer set,
      // the tabs' own dirty rule, and Save's channel. Only the interval is faked, so everything else is real.
      for (const [interval, expected] of [
        ['1', 1],
        ['off', 0],
      ] as const) {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        let version = 1;
        const sent: Sent[] = [];
        const client = createClient(channels, (id, params) => {
          sent.push({ id, params });
          if (id === 'document.execute') {
            version += 1;
            return Promise.resolve(ok({ version: asDocVersion(version), byteLength: 2048, historyDropped: 0 }));
          }
          if (id === 'document.save') return Promise.resolve(ok({ kind: 'saved' as const, version: asDocVersion(version) }));
          const answer = (OPEN_DOCUMENT_ANSWERS as Readonly<Record<string, unknown>>)[id] ?? OTHER_ANSWERS[id];
          if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
          return Promise.resolve(ok(answer));
        });
        const settings = freshSettings();
        settings.set(AUTOSAVE_SETTING.id, interval);
        const { unmount } = render(<App client={client} settings={settings} />);
        await withDocumentOpen();

        // A CHANGE, so there is something to save; a clean document is never autosaved.
        await pressCommand('Rotate page', 'Organize');
        await act(async () => {
          await Promise.resolve();
        });
        expect(document.title, interval).toBe('annual.pdf ● — Monstera PDF Editor');

        await act(async () => {
          vi.advanceTimersByTime(60_000);
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(sent.filter((call) => call.id === 'document.save'), interval).toHaveLength(expected);
        if (expected === 1) expect(document.title).toBe('annual.pdf — Monstera PDF Editor');
        unmount();
        vi.useRealTimers();
      }
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

      await pressCommand('Rotate page');
      await act(async () => {
        await Promise.resolve();
      });

      expect(await screen.findByRole('dialog', { name: 'That could not be done' })).toBeDefined();
      expect(await screen.findByText(/still open and unsaved/u)).toBeDefined();
    });

    it('EDIT TEXT with no editing engine says so ONCE for every page asking, and LEAVES the mode', async () => {
      // THE COMPOSITION'S OWN RULE, which lives in App and nowhere else: every visible page asks
      // for its blocks at once, so without the once-flag a machine with no PDFium raises the same
      // sentence per page. The dialog host shows one dialog at a time and a second replaces the
      // first, so the screen cannot separate once from twice — the CALLS are counted instead.
      vi.mocked(reportProblem).mockClear();
      const blockReads: string[] = [];
      const client = createClient(channels, (id) => {
        if (id === 'document.textBlocks') {
          blockReads.push(id);
          return Promise.resolve(err({ code: 'engine-unavailable' as const }));
        }
        const answers: Readonly<Record<string, unknown>> = OPEN_DOCUMENT_ANSWERS;
        const answer = answers[id];
        if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
        return Promise.resolve(ok(answer));
      });
      // BOTH PAGES ON SCREEN, which happy-dom never reports: it has no IntersectionObserver, so the
      // scroller shows only the page it was seeded with, and one page asking cannot race another.
      // Installed for this case alone and restored, because every other case here was written
      // against the seeded single page.
      const observed: { callback: IntersectionObserverCallback; elements: Element[] }[] = [];
      const host: { IntersectionObserver?: typeof IntersectionObserver } = globalThis;
      const original = host.IntersectionObserver;
      host.IntersectionObserver = class {
        constructor(callback: IntersectionObserverCallback) {
          observed.push({ callback, elements: [] });
        }
        observe(element: Element): void {
          observed[observed.length - 1]?.elements.push(element);
        }
        unobserve(): void {
          // Nothing here reads the unobserved set.
        }
        disconnect(): void {
          // Recorded by absence.
        }
      } as unknown as typeof IntersectionObserver;
      try {
        render(<App client={client} settings={freshSettings()} />);
        await withDocumentOpen();
        await act(async () => {
          for (const { callback, elements } of observed) {
            const slots = elements.filter((element) => element.classList.contains('m-page-slot'));
            if (slots.length === 0) continue;
            callback(
              slots.map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry),
              {} as IntersectionObserver,
            );
          }
          await Promise.resolve();
        });

        // THE SECTION NAMED, because the search through the rail would pass Organize on the way to Edit (ADR-0105's
        // order), and Organize swaps the reading view for the page grid (ADR-0104) — unmounting the slots whose
        // intersections were fired above, which left one page asking and emptied the vacuity guard below.
        await pressCommand('Edit text', 'Edit');
        await act(async () => {
          await Promise.resolve();
        });
      } finally {
        if (original === undefined) delete host.IntersectionObserver;
        else host.IntersectionObserver = original;
      }

      // VACUITY GUARD: once is only a claim when more than one page asked.
      expect(blockReads.length).toBeGreaterThan(1);
      expect(vi.mocked(reportProblem)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(reportProblem).mock.calls[0]?.[1]).toStrictEqual({ code: 'engine-unavailable' });
      expect(await screen.findByText(/cannot edit text in place/u)).toBeDefined();

      // LEFT, asserted by the next press: a mode still on would be turned OFF by it and read
      // nothing, and a mode that was left is turned on again and asks again.
      const before = blockReads.length;
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await Promise.resolve();
      });
      await pressCommand('Edit text');
      await act(async () => {
        await Promise.resolve();
      });
      expect(blockReads.length).toBeGreaterThan(before);
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

    // BY SLOT (ADR-0068), each counted inside its own container so it counts COMMANDS rather than every control on
    // the page: Open is the one primary button, and About, the log and Settings are the footer's.
    expect(container.querySelectorAll('.m-start-primary button')).toHaveLength(1);
    expect(container.querySelectorAll('.m-start-footer button')).toHaveLength(3);
    // AND THE GRID: §10.3's six feature shortcuts.
    expect(container.querySelectorAll('.m-start-shortcuts button')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Open PDF…' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'About' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reveal diagnostics log' })).toBeDefined();
    // SETTINGS, the fourth (ADR-0056): wanted before anything is open, and where a
    // person whose cloud engine is missing its key comes looking.
    expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
  });

  it('F1 lists the REGISTRY’s shortcuts, and the footer names the key only because the registry binds it', async () => {
    // §10.3's footer: "Press F1 for keyboard shortcuts". The separating rows are ones only the finished registry can
    // supply — Open's Ctrl+O, and F1 itself, which is the command that lists them — so a list captured before the
    // registry existed, or a hard-coded one, cannot pass.
    const { client } = recordingClient({ kind: 'cancelled' });
    render(<App client={client} settings={freshSettings()} />);

    expect(screen.getByText('Press F1 for keyboard shortcuts')).toBeDefined();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    const table = await screen.findByRole('table', {}, { timeout: 2000 });
    const rows = [...table.querySelectorAll('tbody tr')].map((row) => row.textContent);
    expect(rows).toContain('Open PDF…Ctrl+O');
    expect(rows).toContain('Keyboard shortcutsF1');
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
        screen.getByRole('button', { name: 'Open PDF…' }).click();
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

  describe('a dropped file (ADR-0099)', () => {
    /** A drop as Chromium delivers one: the window entered, then the drop, both listing `Files`. */
    async function dropOn(files: readonly File[]): Promise<void> {
      for (const type of ['dragenter', 'drop']) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, dropEffect: 'none' } });
        await act(async () => {
          window.dispatchEvent(event);
          await Promise.resolve();
        });
      }
      await act(async () => {
        await Promise.resolve();
      });
    }

    const FIRST = new File(['%PDF-1.7'], 'first.pdf');
    const SECOND = new File(['%PDF-1.7'], 'second.pdf');

    it('hands EACH dropped file to the preload in the drop’s order, and each opens as a tab', async () => {
      const handed: File[] = [];
      const names = new Map([
        [FIRST, 'first.pdf'],
        [SECOND, 'second.pdf'],
      ]);
      const dropOpener: DropOpener = (file) => {
        handed.push(file);
        const docId = asDocId(`00000000-0000-4000-8000-00000000000${String(handed.length)}`);
        return Promise.resolve(
          ok({ kind: 'opened' as const, docId, version: asDocVersion(1), byteLength: 1024, name: names.get(file) ?? '' }),
        );
      };
      const { client } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      render(<App client={client} settings={freshSettings()} dropOpener={dropOpener} />);

      await dropOn([FIRST, SECOND]);

      // THE FILE OBJECTS THEMSELVES, in order — the page hands over what the drop gave it and nothing it made.
      expect(handed).toStrictEqual([FIRST, SECOND]);
      // A TAB EACH, found by the close control the strip gives every open document.
      const strip = within(screen.getByRole('navigation', { name: 'Open documents' }));
      expect(strip.getByRole('button', { name: 'Close first.pdf' })).toBeDefined();
      expect(strip.getByRole('button', { name: 'Close second.pdf' })).toBeDefined();
    });

    it('SAYS SO when the dropped item is not a file on this computer', async () => {
      const dropOpener: DropOpener = () => Promise.resolve(ok({ kind: 'no-path' as const }));
      const { client } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });
      render(<App client={client} settings={freshSettings()} dropOpener={dropOpener} />);

      await dropOn([FIRST]);

      expect(
        screen.getByText(
          'That is not a file on this computer, so it cannot be opened. Drop a PDF from File Explorer instead.',
        ),
      ).toBeDefined();
    });

    it('CONTROL: with no preload behind it, the window is not a drop target at all', () => {
      /** A file drag entering the window, and whether the drop target answered it. */
      function enter(): Event {
        const event = new Event('dragover', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: 'none' } });
        act(() => {
          window.dispatchEvent(event);
        });
        return event;
      }
      const { client } = answeringClient({ ...OPEN_DOCUMENT_ANSWERS });

      // WITH an opener the drag is accepted, which is what makes the case below mean something.
      const accepting = render(<App client={client} settings={freshSettings()} dropOpener={() => Promise.reject(new Error('unused'))} />);
      expect(enter().defaultPrevented).toBe(true);
      accepting.unmount();

      // WITHOUT one it is not: Chromium's default stands, and nothing looks like it took the file.
      render(<App client={client} settings={freshSettings()} />);
      expect(enter().defaultPrevented).toBe(false);
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

      await pressCommand('Split view');

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

    describe('FOCUS FOLLOWS THE PANE — navigation goes to the pane the reader pressed in', () => {
      /**
       * Which pane each scroll-into-view landed in, by the pane's index. The observable is the
       * SCROLL, not the status readout: the readout follows the page an intersection observer
       * reports, which happy-dom never runs, while a go-to request is a scroll this can see.
       */
      async function nextPageLandsIn(press: 0 | 1 | null): Promise<readonly number[]> {
        const { settings } = await withDocument();
        await act(async () => {
          settings.set(SPLIT_VIEW_SETTING.id, true);
          await Promise.resolve();
        });
        const panes = [...document.querySelectorAll('.m-page-list')];
        expect(panes).toHaveLength(2);
        const pressed = press === null ? undefined : panes[press];
        if (pressed !== undefined) {
          await act(async () => {
            fireEvent.pointerDown(pressed);
            await Promise.resolve();
          });
        }
        const landed: number[] = [];
        const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
          landed.push(panes.findIndex((pane) => pane.contains(this)));
        });
        try {
          await pressCommand('Next page');
        } finally {
          spy.mockRestore();
        }
        return landed;
      }

      it('a press in the SECOND pane sends the next page there, and only there', async () => {
        expect(await nextPageLandsIn(1)).toStrictEqual([1]);
      });

      it('CONTROL: with no press, and after a press in the first, it goes to the first pane', async () => {
        // The first pane is the reporter until the reader chooses otherwise — the state a split
        // opens in. Without this pair, a build that always routed to the second pane would pass.
        expect(await nextPageLandsIn(null)).toStrictEqual([0]);
        cleanup();
        expect(await nextPageLandsIn(0)).toStrictEqual([0]);
      });
    });
  });

  describe('the recent list', () => {
    /** A client answering `document.recent` with what a case wants. */
    function withRecent(
      recent: unknown,
      /** A channel answered by the case instead — a refusal or a rejection the defaults never give. */
      answeredBy: Readonly<Record<string, () => Promise<unknown>>> = {},
    ): { readonly client: ContractClient; readonly sent: Sent[] } {
      const sent: Sent[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        const own = answeredBy[id];
        if (own !== undefined) return own();
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

    /** A listed entry as `document.recent` answers one, with no place or time — what these cases are not about. */
    function row(handle: string, name: string): { handle: string; name: string; location: unknown; openedAt: null } {
      return { handle, name, location: { within: null, folder: null }, openedAt: null };
    }

    it('a card shows the picture main kept, asked for by the list’s handle, and the placeholder otherwise', async () => {
      const sent: Sent[] = [];
      const client = createClient(channels, (id, params) => {
        sent.push({ id, params });
        if (id === 'document.recent') {
          return Promise.resolve(
            ok({ entries: [row('handle-a', 'annual.pdf'), row('handle-b', 'notes.pdf')], lastExitClean: true, lastSession: [] }),
          );
        }
        if (id === 'document.recentPreview') {
          const { handle } = params as { handle: string };
          return Promise.resolve(
            ok(handle === 'handle-a' ? { kind: 'picture', jpeg: Uint8Array.of(0xff, 0xd8) } : { kind: 'none' }),
          );
        }
        return Promise.resolve(ok(OTHER_ANSWERS[id] ?? (OPEN_DOCUMENT_ANSWERS as Record<string, unknown>)[id]));
      });
      const created: Blob[] = [];
      const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        created.push(blob as Blob);
        return `blob:picture-${String(created.length)}`;
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      // ASKED BY HANDLE, once per card: the page names the file by the capability it was given, nothing else.
      expect(sent.filter((call) => call.id === 'document.recentPreview').map((call) => call.params)).toStrictEqual([
        { handle: 'handle-a' },
        { handle: 'handle-b' },
      ]);
      const first = screen.getByRole('button', { name: 'annual.pdf' });
      expect(first.querySelector('img')?.getAttribute('src')).toBe('blob:picture-1');
      expect(created[0]?.type).toBe('image/jpeg');
      // THE OTHER CARD HAS NONE, and shows the page's shape with its type rather than an empty box.
      const second = screen.getByRole('button', { name: 'notes.pdf' });
      expect(second.querySelector('img')).toBeNull();
      expect(second.querySelector('.m-recent-item__picture--none')?.textContent).toBe('PDF');
      createObjectURL.mockRestore();
    });

    it('*Clear list* asks main to empty it, and the cards go only when main has', async () => {
      const { client, sent } = withRecent({
        entries: [row('handle-a', 'annual.pdf')],
        lastExitClean: true,
        lastSession: [],
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        screen.getByRole('button', { name: 'Clear list' }).click();
        await Promise.resolve();
      });

      expect(sent.some((call) => call.id === 'document.clearRecent')).toBe(true);
      expect(screen.queryByRole('button', { name: 'annual.pdf' })).toBeNull();
    });

    it('*Clear list* that main REFUSED, or that never arrived, leaves every card where it was', async () => {
      // The other half of *only when main has*: the case above cannot tell a list cleared on main's answer from
      // one cleared on the press, since main answers yes there. Each failure shape is its own mount.
      for (const failing of [
        // WITH ITS INCIDENT, which `failureSchema` requires of `internal`: without one the envelope is malformed,
        // the client throws, and this would be a second rejection rather than a refusal.
        () => Promise.resolve(err({ code: 'internal' as const, incident: 'incident-1' })),
        () => Promise.reject(new Error('the bridge is gone')),
      ]) {
        const { client, sent } = withRecent(
          { entries: [row('handle-a', 'annual.pdf')], lastExitClean: true, lastSession: [] },
          { 'document.clearRecent': failing },
        );
        const { unmount } = render(<App client={client} settings={freshSettings()} />);
        await act(async () => {
          await Promise.resolve();
        });

        await act(async () => {
          screen.getByRole('button', { name: 'Clear list' }).click();
          // A WHOLE TASK, not one microtask: the answer's handler runs a few promise hops after the press, and
          // a card still on screen one hop in is what every version shows, including one that clears on refusal.
          await new Promise((settle) => setTimeout(settle, 0));
        });

        expect(sent.some((call) => call.id === 'document.clearRecent')).toBe(true);
        expect(screen.getByRole('button', { name: /annual\.pdf/u })).toBeTruthy();
        unmount();
      }
    });

    it('a card is NAMED by the file and DESCRIBED by when and where it was opened (ADR-0100)', async () => {
      const { client } = withRecent({
        entries: [
          { handle: 'handle-a', name: 'annual.pdf', location: { within: 'documents', folder: 'Leases' }, openedAt: new Date().toISOString() },
        ],
        lastExitClean: true,
        lastSession: [],
      });
      render(<App client={client} settings={freshSettings()} />);
      await act(async () => {
        await Promise.resolve();
      });

      // BY ITS NAME ALONE: read from content, the name would be the file and the line run together.
      const card = screen.getByRole('button', { name: 'annual.pdf' });
      const described = document.getElementById(card.getAttribute('aria-describedby') ?? '');
      expect(described?.textContent).toBe('Today · Documents › Leases');
    });

    it('OPENS BY THE HANDLE the list carried, and no path is anywhere in reach', async () => {
      // The renderer names a file here, which nothing else in this build does —
      // and what makes it safe is that the value is a capability main minted,
      // not a path. A row that sent a name, or an index, would be a renderer
      // choosing a file.
      const { client, sent } = withRecent({
        entries: [row('handle-a', 'annual.pdf'), row('handle-b', 'notes.pdf')],
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
        entries: [row('handle-a', 'annual.pdf')],
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
        entries: [row('handle-a', 'annual.pdf')],
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
        entries: [row('handle-a', 'annual.pdf')],
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
              entries: [{ handle: 'stale', name: 'annual.pdf', location: { within: null, folder: null }, openedAt: null }],
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

describe('the first-run AI setup (E5 onboarding)', () => {
  /**
   * Mounts the shell with main answering which keys are stored, and with the stored settings
   * either loaded (`hydrate`) or not yet — the two facts the offer waits for.
   */
  async function started(stored: readonly string[], hydrate: Readonly<Record<string, unknown>> | null): Promise<void> {
    const client = createClient(channels, (id) => {
      if (id === 'settings.loadSecrets') return Promise.resolve(ok({ stored, available: true }));
      if (id === 'app.info') return Promise.resolve(ok({ version: '0.0.0', installChannel: 'development', userName: 'A. Tester' }));
      const answer = OTHER_ANSWERS[id];
      if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
      return Promise.resolve(ok(answer));
    });
    const settings = freshSettings();
    if (hydrate !== null) settings.hydrate(hydrate);
    render(<App client={client} settings={settings} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('OFFERS the setup once the settings have loaded and no provider has a key', async () => {
    await started([], {});
    // GET, not find: the same settle the controls below read absence after, so their absence
    // cannot be a dialog that simply had not opened yet.
    expect(screen.getByRole('dialog', { name: 'Set up the AI assistant' })).toBeTruthy();
    // THE BODY IS LAZY (ADR-0029 Decision 7), so its Skip arrives a moment after the frame.
    expect(await screen.findByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('CONTROL: a provider key already stored means no offer', async () => {
    await started(['ai.gemini-key'], {});
    expect(screen.queryByRole('dialog', { name: 'Set up the AI assistant' })).toBeNull();
  });

  it('CONTROL: a person who SKIPPED — the stored false — is not asked again', async () => {
    await started([], { 'ai.setup-at-start': false });
    expect(screen.queryByRole('dialog', { name: 'Set up the AI assistant' })).toBeNull();
  });

  it('CONTROL: before the stored settings load, nothing is offered — the fallback is not a person’s answer', async () => {
    await started([], null);
    expect(screen.queryByRole('dialog', { name: 'Set up the AI assistant' })).toBeNull();
  });

  it('CONTROL: a key that is not an AI provider’s — Azure Document Intelligence — does not count as set up', async () => {
    await started(['editing.azure-di-key'], {});
    expect(await screen.findByRole('dialog', { name: 'Set up the AI assistant' })).toBeTruthy();
  });
});
