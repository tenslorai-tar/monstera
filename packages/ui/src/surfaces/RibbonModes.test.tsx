// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, GROUP_ADJUST, GROUP_FILE } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import type { Placement } from '../registries/placement.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { LAYOUT_MODE_SETTING, RIBBON_SECTION_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { Ribbon } from './Ribbon.js';

/**
 * §10.3's rail state and the three chrome modes, as the ribbon presents them: *"The rail's state model is identical in
 * every mode: the active section persists, and selecting a section — including re-selecting the current one — is what
 * opens the overlay in Studio."* `Ribbon.test.tsx` covers what a section shows; these cases cover where the choice
 * lives and how each mode draws it.
 */

const CONTEXT: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

function commandOf(id: string, title: string, placements: readonly Placement[], run = vi.fn()): UiCommand {
  return { id, title: messageKey(title), icon: 'File', placements, run };
}

beforeAll(() => {
  activateCatalogue('en', { ...EN, 'test.modes.save': 'Save', 'test.modes.rotate': 'Rotate' });
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const SAVE_RUN = vi.fn();
const SAVE = commandOf('a.save', 'test.modes.save', [{ surface: 'ribbon', section: 'home', group: GROUP_FILE, order: 10 }], SAVE_RUN);
const ROTATE = commandOf('b.rotate', 'test.modes.rotate', [
  { surface: 'ribbon', section: 'organize', group: GROUP_ADJUST, order: 10 },
]);

function draw(stored: Record<string, unknown> = {}): {
  readonly settings: SettingsStore;
  readonly container: HTMLElement;
  readonly unmount: () => void;
} {
  const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  settings.hydrate(stored);
  const { container, unmount } = render(
    <Wrapped>
      <Ribbon registry={new CommandRegistry([SAVE, ROTATE])} context={CONTEXT} settings={settings} />
    </Wrapped>,
  );
  return { settings, container, unmount };
}

function railButton(container: HTMLElement, section: string): HTMLButtonElement {
  const button = container.querySelector(`[data-ribbon-section="${section}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`the rail has a ${section} entry`);
  return button;
}

const press = (element: Element): void => {
  act(() => {
    fireEvent.click(element);
  });
};

describe('the ribbon’s section and modes', () => {
  it('a rail click WRITES the section setting, which is what the strip then shows', () => {
    const { settings, container } = draw();
    press(railButton(container, 'organize'));
    expect(settings.get(RIBBON_SECTION_SETTING.id)).toBe('organize');
    expect(screen.getByRole('toolbar').getAttribute('data-ribbon-active')).toBe('organize');
  });

  it('a STORED section is where the ribbon opens', () => {
    draw({ [RIBBON_SECTION_SETTING.id]: 'organize' });
    expect(screen.getByRole('toolbar').getAttribute('data-ribbon-active')).toBe('organize');
  });

  it('FOCUS draws neither rail nor strip', () => {
    const { container } = draw({ [LAYOUT_MODE_SETTING.id]: 'focus' });
    expect(container.querySelector('.m-ribbon')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('STUDIO: no strip until a section is selected, and RE-SELECTING the current one opens it too', () => {
    const { container } = draw({ [LAYOUT_MODE_SETTING.id]: 'studio' });
    // THE RAIL STAYS: capability and navigation are unchanged, only the strip is auto-hidden.
    expect(container.querySelector('.m-ribbon__rail')).not.toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
    // Home is already the active section — the case §10.3 names.
    press(railButton(container, 'home'));
    const strip = screen.getByRole('toolbar');
    expect(strip.classList.contains('m-ribbon__tools--overlay')).toBe(true);
    expect(strip.getAttribute('data-ribbon-active')).toBe('home');
  });

  it('STUDIO: a TOOL CHOICE runs the command and dismisses the overlay', () => {
    SAVE_RUN.mockClear();
    const { container } = draw({ [LAYOUT_MODE_SETTING.id]: 'studio' });
    press(railButton(container, 'home'));
    press(screen.getByRole('button', { name: 'Save' }));
    expect(SAVE_RUN).toHaveBeenCalledWith(CONTEXT);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('STUDIO: ESCAPE pressed where focus IS — on the rail button just clicked — dismisses the overlay', () => {
    // WHERE THE KEY LANDS is the property. The first version fired Escape at the overlay, passed here, and failed in the
    // production build: after a rail click, focus is on the rail button, and no real key press reaches the overlay.
    const { container } = draw({ [LAYOUT_MODE_SETTING.id]: 'studio' });
    const home = railButton(container, 'home');
    press(home);
    // CONTROL: a key that is not Escape leaves the overlay open, so a listener closing on any key is caught.
    act(() => {
      fireEvent.keyDown(home, { key: 'a' });
    });
    expect(screen.queryByRole('toolbar')).not.toBeNull();
    act(() => {
      fireEvent.keyDown(home, { key: 'Escape' });
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('STUDIO: ESCAPE from the other two places focus can be — a TOOL in the overlay, and the BODY — dismisses it too', () => {
    // A person who Tabs into the strip presses Escape on a tool; one who clicked something inert presses it with focus
    // on the body. Both are asserted because the overlay's earlier handler heard one position and not the others, and
    // the palette's did the same (2026-09-17) — a route is only covered from every place a key can come from.
    for (const target of ['tool', 'body'] as const) {
      const { container, unmount } = draw({ [LAYOUT_MODE_SETTING.id]: 'studio' });
      press(railButton(container, 'home'));
      const from = target === 'tool' ? screen.getByRole('button', { name: 'Save' }) : document.body;
      act(() => {
        fireEvent.keyDown(from, { key: 'a' });
      });
      // CONTROL, per position: a key that is not Escape leaves it open.
      expect(screen.queryByRole('toolbar'), target).not.toBeNull();
      act(() => {
        fireEvent.keyDown(from, { key: 'Escape' });
      });
      expect(screen.queryByRole('toolbar'), target).toBeNull();
      unmount();
    }
  });

  it('STUDIO: a press OUTSIDE dismisses the overlay; a press on the RAIL does not', () => {
    const { container } = draw({ [LAYOUT_MODE_SETTING.id]: 'studio' });
    press(railButton(container, 'home'));
    act(() => {
      fireEvent.pointerDown(railButton(container, 'organize'));
    });
    expect(screen.queryByRole('toolbar')).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('RIBBON: the strip is in the grid, not an overlay, whatever was clicked', () => {
    const { container } = draw();
    press(railButton(container, 'organize'));
    const strip = screen.getByRole('toolbar');
    expect(strip.classList.contains('m-ribbon__tools--overlay')).toBe(false);
  });
});
