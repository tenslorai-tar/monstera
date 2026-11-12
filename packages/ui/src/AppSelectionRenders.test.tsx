// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
import { act, cleanup, fireEvent, render as renderBare, screen } from '@testing-library/react';
import { Profiler, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { editorIsOpen } from './editorKit/openEditor.js';
import { activateCatalogue, i18n } from './i18n.js';
import { EN } from './messages/en.js';
import type { CommandContext, CommandRegistry } from './registries/commands.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import { SettingsStore } from './settingsStore.js';
import { menuBarModel, ribbonModel } from './surfaces/projections.js';
import type { TextSelection } from './TextLayer.js';
import { applyFullAppLimits } from './fullAppTestLimit.js';

// THIS FILE RENDERS THE WHOLE APP: the case limit and the wait window of `fullAppTestLimit.ts`.
applyFullAppLimits();

/**
 * A TEXT SELECTION RENDERS NO PART OF THE SHELL (`textSelectionStore.ts`). Until 2026-11-01 the selection was `App`'s
 * state: each change rendered `App`, rebuilt the command registry the selected-text commands were made over, and so
 * rebuilt every projection of it, the menu bar's and the ribbon's models among them.
 *
 * ## What is counted, and why each
 *
 * - **`App`'s renders**: `editorIsOpen`, the snapshot of a store only `App` reads during render, counted through a
 *   pass-through spy. React reads a snapshot on every render of the component that holds it, and nothing else here
 *   reads this one, so zero calls is zero renders of `App`. A React Profiler reports a subtree and cannot say this.
 * - **The registry's builds**: `onRegistries`, which `App` calls with each registry it builds.
 * - **The ribbon's and the menu bar's models**: `ribbonModel` and `menuBarModel`, through pass-through spies, which each
 *   surface builds again when it renders with a new registry or a moved answer: the work the 56 ms was.
 * - **Every commit under `App`**: a React Profiler around it, for the case where nothing drawn moves.
 *
 * ## Why the selection is stubbed
 *
 * happy-dom lays nothing out, so a real selection has no rectangles and `readTextSelection` answers none. The reader
 * is replaced; the `selectionchange` event that drives it is the document's own.
 */
activateCatalogue('en', EN);

let selected: TextSelection | undefined;

vi.mock('./TextLayer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./TextLayer.js')>()),
  readTextSelection: () => selected,
}));

vi.mock('./editorKit/openEditor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./editorKit/openEditor.js')>();
  return { ...actual, editorIsOpen: vi.fn(actual.editorIsOpen) };
});

vi.mock('./surfaces/projections.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./surfaces/projections.js')>();
  return { ...actual, ribbonModel: vi.fn(actual.ribbonModel), menuBarModel: vi.fn(actual.menuBarModel) };
});

vi.mock('./documentView.js', () => ({
  openDocumentView: () => Promise.resolve({ document: { numPages: 1 }, version: asDocVersion(1), close: () => Promise.resolve() }),
  createParserWorker: () => ({ destroy: () => undefined }),
}));

vi.mock('./renderPage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./renderPage.js')>()),
  renderPage: () => Promise.resolve({ width: 595, height: 842, crop: [0, 0, 595, 842] as const, rotation: 0 }),
}) satisfies Partial<typeof import('./renderPage.js')>);

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/** Each open answers a new document, so a second open is a second tab. */
function answeringClient(): ContractClient {
  let opened = 0;
  const document = (): unknown => {
    opened += 1;
    const docId = asDocId(`doc-${String(opened)}`);
    const name = `file-${String(opened)}.pdf`;
    return { opened: [{ name, outcome: { kind: 'opened' as const, docId, version: asDocVersion(1), byteLength: 1024, name } }] };
  };
  const answers: Readonly<Record<string, () => unknown>> = {
    'document.openSeveral': document,
    'document.viewModel': () => ({ version: asDocVersion(1), pageCount: 1, rotations: [0], direction: 'L2R' as const }),
    'document.readRange': () => ({ kind: 'bytes' as const, bytes: new Uint8Array(8) }),
    'document.pageTextLayer': () => ({ version: asDocVersion(1), lines: [], truncated: false, kind: 'empty' as const }),
    'window.closeListening': () => ({ acknowledged: true }),
    'app.rendererEnded': () => ({ kind: 'none' }),
    'document.held': () => ({ documents: [] }),
    'document.fileAccess': () => ({ access: 'writable' }),
    'document.certification': () => ({ certification: null, signed: false }),
    'document.adoptOldBackups': () => ({ kind: 'adopted', moved: 0 }),
    'app.prepareEditing': () => ({ started: true }),
  };
  return createClient(channels, (id) => {
    const answer = answers[id];
    if (answer === undefined) throw new Error(`this fixture has no answer for ${id}`);
    return Promise.resolve(ok(answer()));
  });
}

/** A selection on page 0 of `text`, starting at `x`. */
function selection(text: string, x: number): TextSelection {
  return { page: 0, text, from: { x, y: 700 }, to: { x: x + 40, y: 700 }, boxes: [{ x, y: 80, width: 40, height: 12 }] };
}

const counts = { app: 0, registries: 0, ribbon: 0, menuBar: 0, commits: 0 };
let registry: CommandRegistry | undefined;

function counted(): typeof counts {
  return {
    ...counts,
    app: vi.mocked(editorIsOpen).mock.calls.length,
    ribbon: vi.mocked(ribbonModel).mock.calls.length,
    menuBar: vi.mocked(menuBarModel).mock.calls.length,
  };
}

/** The counts `act` moved them by. */
async function across(step: () => void): Promise<typeof counts> {
  const before = counted();
  await act(async () => {
    step();
    await Promise.resolve();
  });
  const after = counted();
  return {
    app: after.app - before.app,
    registries: after.registries - before.registries,
    ribbon: after.ribbon - before.ribbon,
    menuBar: after.menuBar - before.menuBar,
    commits: after.commits - before.commits,
  };
}

/** The selection the document reports from now, announced the way the browser announces one. */
function select(next: TextSelection | undefined): void {
  selected = next;
  document.dispatchEvent(new Event('selectionchange'));
}

/** Opens a document: from the start screen, or once one is open, from the tab row. */
async function openOne(): Promise<void> {
  const another = screen.queryByRole('button', { name: 'Open another document' });
  await act(async () => {
    (another ?? screen.getByRole('button', { name: 'Open PDF…' })).click();
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  });
}

function mount(): void {
  renderBare(
    <Profiler
      id="shell"
      onRender={() => {
        counts.commits += 1;
      }}
    >
      <App
        client={answeringClient()}
        settings={new SettingsStore(new SettingsRegistry(ALL_SETTINGS))}
        onRegistries={(built) => {
          counts.registries += 1;
          registry = built.commands;
        }}
      />
    </Profiler>,
    { wrapper: Messages },
  );
}

/** The command context of a document focused on page 0, which the predicates under test read nothing else of. */
const FOCUSED = { docId: asDocId('doc-1'), version: asDocVersion(1), hasSelection: false, dirty: false, page: 0, pageCount: 1, openDocuments: [], selectedPages: [] } as unknown as CommandContext;

beforeEach(() => {
  selected = undefined;
  counts.registries = 0;
  counts.commits = 0;
  registry = undefined;
  vi.mocked(editorIsOpen).mockClear();
  vi.mocked(ribbonModel).mockClear();
  vi.mocked(menuBarModel).mockClear();
});

afterEach(() => {
  cleanup();
});

describe('a text selection renders no part of the shell', () => {
  it('a selection that moves without moving any answer commits nothing under App, nor builds a registry or a model', async () => {
    mount();
    await openOne();
    await across(() => {
      select(selection('Garden', 72));
    });
    // A DRAG'S NEXT STEP: still a selection on the same page, so no command's answer moves.
    const moved = await across(() => {
      select(selection('Garden club', 72));
    });
    expect(moved).toStrictEqual({ app: 0, registries: 0, ribbon: 0, menuBar: 0, commits: 0 });
  });

  it('a selection made and cleared renders App zero times and builds no registry, while Copy and Highlight follow it', async () => {
    mount();
    await openOne();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      await Promise.resolve();
    });
    const copy = (): Element | null => document.querySelector('.m-ribbon [data-command="edit.copy"]');
    expect(copy()).toBeNull();
    const made = await across(() => {
      select(selection('Garden', 72));
    });
    expect(made.app).toBe(0);
    expect(made.registries).toBe(0);
    // COPY ON THE RIBBON'S EDIT SECTION, shown by its answer moving, and HIGHLIGHT OFFERED for the menu over the page.
    expect(copy()).not.toBeNull();
    expect(registry?.available(FOCUSED).map((command) => command.id)).toContain('text.highlight');
    const cleared = await across(() => {
      select(undefined);
    });
    expect(cleared.app).toBe(0);
    expect(cleared.registries).toBe(0);
    expect(copy()).toBeNull();
    expect(registry?.available(FOCUSED).map((command) => command.id)).not.toContain('text.highlight');
  });

  it('A ZOOM STEP, the same shape: the scale it shows moves and the registry is not built again', async () => {
    mount();
    await openOne();
    const shown = (): string | null => document.querySelector('.m-status-bar')?.textContent ?? null;
    const before = shown();
    const zoomIn = registry?.availableById('view.zoom-in', FOCUSED);
    if (zoomIn === undefined) throw new Error('no zoom-in command');
    const stepped = await across(() => {
      void zoomIn.run(FOCUSED);
    });
    // THE STEP LANDED: the status bar reads another scale, so the case is not a step that changed nothing.
    expect(shown()).not.toBe(before);
    expect(stepped.registries).toBe(0);
  });

  it('CONTROL: opening a document and switching tabs still render App and build the registry', async () => {
    mount();
    const before = counted();
    await openOne();
    await openOne();
    const opened = counted();
    expect(opened.app - before.app).toBeGreaterThan(0);
    expect(opened.registries - before.registries).toBeGreaterThan(0);
    expect(document.querySelectorAll('.m-tab')).toHaveLength(2);
    const first = document.querySelector('[data-tab-select="doc-1"]');
    if (!(first instanceof HTMLElement)) throw new Error('no tab for the first document');
    const switched = await across(() => {
      first.click();
    });
    expect(switched.app).toBeGreaterThan(0);
    expect(switched.registries).toBeGreaterThan(0);
  });
});
