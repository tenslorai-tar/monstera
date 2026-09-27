// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import { SettingsRegistry } from '../registries/settings.js';
import { ALL_SETTINGS } from '../settings/all.js';
import { FLOAT_BAR_POSITION_SETTING, QUICK_TOOLBAR_OPEN_SETTING } from '../settings/layout.js';
import { SettingsStore } from '../settingsStore.js';
import { QuickToolbar } from './QuickToolbar.js';

/**
 * §10.3's floating quick toolbar as a person meets it: a vertical pill of icon buttons, each named
 * by its command, hidden by its own setting and placed on the edge that setting names. Where it sits
 * on screen is the rendered test's — happy-dom lays nothing out.
 */

const ROTATE = messageKey('test.quick.rotate');
const CROP = messageKey('test.quick.crop');

beforeAll(() => {
  activateCatalogue('en', { ...EN, [ROTATE]: 'Rotate page', [CROP]: 'Crop pages' });
});

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 0,
  pageCount: 1,
  openDocuments: [],
};

function drawn(commands: readonly UiCommand[], settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS))): SettingsStore {
  render(
    <Wrapped>
      <QuickToolbar registry={new CommandRegistry(commands)} context={context} settings={settings} />
    </Wrapped>,
  );
  return settings;
}

const rotate = vi.fn();
const COMMANDS: readonly UiCommand[] = [
  { id: 'edit.crop', title: CROP, icon: 'Crop', placements: [{ surface: 'quick-toolbar', order: 20 }], run: vi.fn() },
  { id: 'edit.rotate', title: ROTATE, icon: 'RotateCw', placements: [{ surface: 'quick-toolbar', order: 10 }], run: rotate },
];

describe('QuickToolbar', () => {
  it('draws ICON buttons in order, named by their commands, and a click runs the command', () => {
    drawn(COMMANDS);
    const bar = screen.getByRole('toolbar', { name: 'Float bar' });
    expect(bar.getAttribute('aria-orientation')).toBe('vertical');
    // THE TOOLS, after the grip: the grip is the bar's own control, not a projected command.
    const buttons = [...bar.querySelectorAll('button.m-icon-button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toStrictEqual(['Rotate page', 'Crop pages']);
    // AN ICON AND NO TEXT: the defect was text buttons 150 px wide. Every button draws a glyph at
    // §10.4's primary-control size and carries no text node of its own.
    for (const button of buttons) {
      expect(button.classList.contains('m-icon-button--control')).toBe(true);
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).toBe('');
    }
    const first = buttons[0];
    if (!(first instanceof HTMLElement)) throw new Error('the toolbar has a first button');
    fireEvent.click(first);
    expect(rotate).toHaveBeenCalledWith(context);
  });

  it('is ABSENT when its setting hides it, and returns when the setting shows it again', async () => {
    const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
    settings.set(QUICK_TOOLBAR_OPEN_SETTING.id, false);
    drawn(COMMANDS, settings);
    expect(screen.queryByRole('toolbar')).toBeNull();
    await act(async () => {
      settings.set(QUICK_TOOLBAR_OPEN_SETTING.id, true);
      await Promise.resolve();
    });
    expect(screen.getByRole('toolbar', { name: 'Float bar' })).toBeDefined();
  });

  it('sits DOCKED on the edge its position names, left by default', async () => {
    const settings = drawn(COMMANDS);
    const bar = screen.getByRole('toolbar');
    expect(bar.classList.contains('m-quick-toolbar--start')).toBe(true);
    await act(async () => {
      settings.set(FLOAT_BAR_POSITION_SETTING.id, 'end');
      await Promise.resolve();
    });
    expect(screen.getByRole('toolbar').classList.contains('m-quick-toolbar--end')).toBe(true);
    expect(screen.getByRole('toolbar').classList.contains('m-quick-toolbar--start')).toBe(false);
  });

  describe('MOVABLE by its grip (the owner’s list, item 4)', () => {
    /**
     * happy-dom lays nothing out, so the room is given: a 1000 × 600 page area and a 40 × 400 bar, reported by an
     * observer that answers as soon as it is asked, as a real one does. Where the bar lands on a real screen is the
     * rendered test's.
     */
    const ROOM = { area: [1000, 600], bar: [40, 400] } as const;
    let restore: (() => void) | undefined;

    beforeEach(() => {
      const original = globalThis.ResizeObserver;
      class Immediate {
        readonly #callback: () => void;
        constructor(callback: () => void) {
          this.#callback = callback;
        }
        observe(): void {
          this.#callback();
        }
        disconnect(): void {
          /* nothing to stop: it only ever answers when asked */
        }
      }
      vi.stubGlobal('ResizeObserver', Immediate);
      const sized = (name: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight', index: 0 | 1) =>
        vi.spyOn(HTMLElement.prototype, name, 'get').mockImplementation(function (this: HTMLElement): number {
          if (this.classList.contains('m-quick-toolbar')) return ROOM.bar[index];
          if (this.classList.contains('m-test-area')) return ROOM.area[index];
          return 0;
        });
      const spies = [sized('clientWidth', 0), sized('clientHeight', 1), sized('offsetWidth', 0), sized('offsetHeight', 1)];
      restore = (): void => {
        for (const spy of spies) spy.mockRestore();
        vi.stubGlobal('ResizeObserver', original);
      };
    });

    afterEach(() => {
      restore?.();
    });

    function inArea(commands: readonly UiCommand[], settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS))): SettingsStore {
      render(
        <Wrapped>
          <div className="m-test-area">
            <QuickToolbar registry={new CommandRegistry(commands)} context={context} settings={settings} />
          </div>
        </Wrapped>,
      );
      return settings;
    }

    const grip = (): HTMLElement => screen.getByRole('button', { name: 'Move the Float bar' });

    it('is a named button that says how to move it without a mouse', () => {
      inArea(COMMANDS);
      const help = document.getElementById(grip().getAttribute('aria-describedby') ?? '');
      expect(help?.textContent).toContain('arrow keys');
      expect(grip().getAttribute('aria-pressed')).toBe('false');
    });

    it('an ARROW KEY moves it one grid step and remembers where, as a share of its travel', () => {
      const settings = inArea(COMMANDS);
      // happy-dom draws every box at 0, so the bar starts at the area's corner and one step right is 8 of 960.
      fireEvent.keyDown(grip(), { key: 'ArrowRight' });
      expect(settings.get(FLOAT_BAR_POSITION_SETTING.id)).toStrictEqual({ x: 8 / 960, y: 0 });
      fireEvent.keyDown(grip(), { key: 'ArrowDown', shiftKey: true });
      // STILL READ FROM THE BOX, which happy-dom keeps at 0: the second key is a fresh step from there, down four.
      expect(settings.get(FLOAT_BAR_POSITION_SETTING.id)).toStrictEqual({ x: 0, y: 32 / 200 });
    });

    it('draws a moved bar at its stored place, with no centring on top', () => {
      const settings = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
      settings.set(FLOAT_BAR_POSITION_SETTING.id, { x: 0.5, y: 1 });
      inArea(COMMANDS, settings);
      const bar = screen.getByRole('toolbar');
      expect(bar.classList.contains('m-quick-toolbar--free')).toBe(true);
      expect(bar.style.left).toBe('480px');
      expect(bar.style.top).toBe('200px');
    });

    it('HOME runs Reset Float bar position — the same command the Window menu runs', () => {
      const reset = vi.fn();
      inArea([...COMMANDS, { id: 'view.reset-float-bar', title: CROP, placements: [], run: reset }]);
      fireEvent.keyDown(grip(), { key: 'Home' });
      expect(reset).toHaveBeenCalledWith(context);
    });

    it('a CLICK arms it, and the next press in the page area puts it there, centred — the single-pointer route', () => {
      const settings = inArea(COMMANDS);
      fireEvent.pointerDown(grip(), { button: 0, clientX: 20, clientY: 5, pointerId: 1 });
      fireEvent.pointerUp(grip(), { button: 0, clientX: 20, clientY: 5, pointerId: 1 });
      expect(grip().getAttribute('aria-pressed')).toBe('true');

      const area = document.querySelector('.m-test-area');
      if (!(area instanceof HTMLElement)) throw new Error('the page area is drawn');
      fireEvent.pointerDown(area, { button: 0, clientX: 520, clientY: 300 });
      // CENTRED ON THE PRESS: 520 less half the bar is 500 of 960 across; 300 less half is 100 of 200 down.
      expect(settings.get(FLOAT_BAR_POSITION_SETTING.id)).toStrictEqual({ x: 500 / 960, y: 100 / 200 });
      expect(grip().getAttribute('aria-pressed')).toBe('false');
    });

    it('CONTROL: Escape while armed places nothing, and the next press is the page’s again', () => {
      const settings = inArea(COMMANDS);
      fireEvent.pointerDown(grip(), { button: 0, clientX: 20, clientY: 5, pointerId: 1 });
      fireEvent.pointerUp(grip(), { button: 0, clientX: 20, clientY: 5, pointerId: 1 });
      fireEvent.keyDown(window, { key: 'Escape' });
      const area = document.querySelector('.m-test-area');
      if (!(area instanceof HTMLElement)) throw new Error('the page area is drawn');
      fireEvent.pointerDown(area, { button: 0, clientX: 520, clientY: 300 });
      expect(settings.get(FLOAT_BAR_POSITION_SETTING.id)).toBe('start');
    });

    it('a DRAG moves it with the pointer and stores where it was let go', () => {
      const settings = inArea(COMMANDS);
      fireEvent.pointerDown(grip(), { button: 0, clientX: 20, clientY: 5, pointerId: 1 });
      fireEvent.pointerMove(grip(), { clientX: 120, clientY: 55, pointerId: 1 });
      fireEvent.pointerUp(grip(), { clientX: 120, clientY: 55, pointerId: 1 });
      expect(settings.get(FLOAT_BAR_POSITION_SETTING.id)).toStrictEqual({ x: 100 / 960, y: 50 / 200 });
      // A DRAG IS NOT A CLICK: it does not also arm the click-to-place.
      expect(grip().getAttribute('aria-pressed')).toBe('false');
    });
  });

  it('is absent with nothing placed on it', () => {
    drawn([]);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});
