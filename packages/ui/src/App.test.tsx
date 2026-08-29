// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type ContractClient, channels, createClient } from '@monstera/contract';
import { asDocId, asDocVersion, ok } from '@monstera/shared';
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

/** A client that records every channel it is asked for, and answers `answer`. */
function recordingClient(answer: unknown): {
  readonly client: ContractClient;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const client = createClient(channels, (id) => {
    calls.push(id);
    return Promise.resolve(ok(answer));
  });
  return { client, calls };
}

describe('App', () => {
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

  it('the start screen names no command itself — it renders what the registry holds', () => {
    // §7's rule made observable: the surface has one control because the
    // registry has one command, not because a list in a component says so.
    // `check:secondwiring` is the mechanical half; this is the behavioural one.
    const { client } = recordingClient({ kind: 'cancelled' });
    const { container } = render(<App client={client} settings={freshSettings()} />);

    expect(container.querySelectorAll('.m-start-screen button')).toHaveLength(1);
  });
});
