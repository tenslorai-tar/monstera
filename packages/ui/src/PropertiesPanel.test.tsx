// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { asDocId, asDocVersion } from '@monstera/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnnotationSelection } from './annotations/selectTool.js';
import { STYLE_PRESETS } from './annotations/stylePresets.js';
import { activateCatalogue, i18n } from './i18n.js';
import { DELETE_SELECTION_TITLE, EN, REPLY_SELECTION_TITLE } from './messages/en.js';
import { PropertiesPanel, type StyleChange } from './PropertiesPanel.js';
import { CommandRegistry, type CommandContext, type UiCommand } from './registries/commands.js';
import { SettingsRegistry } from './registries/settings.js';
import { ALL_SETTINGS } from './settings/all.js';
import {
  ANNOTATION_COLOUR_SETTING,
  ANNOTATION_LINE_WIDTH_SETTING,
  ANNOTATION_OPACITY_SETTING,
  STYLE_AS_DEFAULT_SETTING,
} from './settings/editing.js';
import { SettingsStore } from './settingsStore.js';

/**
 * The Properties tab (v5-02, ADR-0102).
 *
 * Every case with marks selected asserts the CHANGE handed to `onRestyle` — the payload's own shape,
 * one property at a time — because that is what reaches the command; `App.test.tsx` proves the
 * dispatch and the carried selection, and the kernel proves the walk is kept. Every case with nothing
 * selected asserts what the STORE holds, which is what the tools read.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

const CONTEXT: CommandContext = {
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(4),
  hasSelection: true,
  dirty: false,
  page: 2,
  pageCount: 5,
  openDocuments: [],
};

const SQUARE = {
  index: 1,
  rect: { x0: 0, y0: 0, x1: 10, y1: 10 },
  kind: 'square' as const,
  contents: 'check the figure',
  style: { colour: [0.2, 0.4, 0.6], opacity: 0.5, borderWidth: 2 },
};

const HIGHLIGHT = {
  ...SQUARE,
  index: 3,
  kind: 'highlight' as const,
  contents: '',
  style: { colour: [1, 0.83, 0], opacity: 1, borderWidth: null },
};

const ONE: AnnotationSelection = { page: 3, version: asDocVersion(4), items: [SQUARE] };

interface Mounted {
  readonly store: SettingsStore;
  readonly restyled: StyleChange[];
  readonly commented: string[];
  readonly ran: string[];
}

function mounted(selection: AnnotationSelection | undefined, foot: readonly UiCommand[] = []): Mounted {
  const store = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const restyled: StyleChange[] = [];
  const commented: string[] = [];
  const ran: string[] = [];
  render(
    <Wrapped>
      <PropertiesPanel
        context={CONTEXT}
        onComment={(chosen, text) => {
          expect(chosen).toBe(selection);
          commented.push(text);
        }}
        onRestyle={(chosen, change) => {
          expect(chosen).toBe(selection);
          restyled.push(change);
        }}
        registry={new CommandRegistry(foot.map((command) => ({ ...command, run: () => void ran.push(command.id) })))}
        selection={selection}
        settings={store}
      />
    </Wrapped>,
  );
  return { store, restyled, commented, ran };
}

describe('PropertiesPanel with marks selected', () => {
  it('names the kind and the page a person reads, 1-based', () => {
    mounted(ONE);
    expect(screen.getByRole('heading', { name: 'Rectangle' })).toBeTruthy();
    expect(screen.getByText('Page 4')).toBeTruthy();
  });

  it('a swatch sends the COLOUR ALONE, so the marks keep their own opacity and width', () => {
    const { restyled } = mounted(ONE);
    const yellow = STYLE_PRESETS[0];
    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }));
    expect(yellow?.hex).toBe('#ffd400');
    // `colourFromHex`'s four places: 0xd4 / 255 is 0.83137…
    expect(restyled).toStrictEqual([{ colour: [1, 0.8314, 0] }]);
  });

  it('and writes it as the default too while *Use as default* is ticked, which it is at first', () => {
    const { store } = mounted(ONE);
    expect(store.get(STYLE_AS_DEFAULT_SETTING.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('#2fbf71');
  });

  it('CONTROL: unticked, the same swatch leaves the default alone', () => {
    const { store, restyled } = mounted(ONE);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use as default for new annotations' }));
    expect(store.get(STYLE_AS_DEFAULT_SETTING.id)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(restyled).toHaveLength(1);
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
  });

  it('the opacity slider sends ONCE, on release, and not while it is dragged', () => {
    const { restyled, store } = mounted(ONE);
    const slider = screen.getByRole('slider', { name: 'Opacity' });
    fireEvent.change(slider, { target: { value: '0.7' } });
    fireEvent.change(slider, { target: { value: '0.8' } });
    expect(restyled).toStrictEqual([]);
    fireEvent.pointerUp(slider);
    expect(restyled).toStrictEqual([{ opacity: 0.8 }]);
    expect(store.get(ANNOTATION_OPACITY_SETTING.id)).toBe(0.8);
  });

  it('CONTROL: a release that changed nothing sends nothing', () => {
    const { restyled } = mounted(ONE);
    fireEvent.pointerUp(screen.getByRole('slider', { name: 'Opacity' }));
    expect(restyled).toStrictEqual([]);
  });

  it('a width segment sends the width alone, and the pressed one sends nothing', () => {
    const { restyled, store } = mounted(ONE);
    fireEvent.click(screen.getByRole('button', { name: '2 pt' }));
    expect(restyled).toStrictEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '5 pt' }));
    expect(restyled).toStrictEqual([{ borderWidth: 5 }]);
    expect(store.get(ANNOTATION_LINE_WIDTH_SETTING.id)).toBe(5);
  });

  it('SAYS a highlight has no line width rather than offering a width that sets nothing', () => {
    mounted({ ...ONE, items: [HIGHLIGHT] });
    expect(screen.queryByRole('group', { name: 'Line width' })).toBeNull();
    expect(screen.getByText('This kind carries no line width.')).toBeTruthy();
  });

  it('the comment is sent when focus leaves it changed, and not when unchanged', () => {
    const { commented } = mounted(ONE);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect((field as HTMLTextAreaElement).value).toBe('check the figure');
    fireEvent.blur(field);
    expect(commented).toStrictEqual([]);
    fireEvent.change(field, { target: { value: 'confirm the rate' } });
    fireEvent.blur(field);
    expect(commented).toStrictEqual(['confirm the rate']);
  });

  it('offers no comment for TWO marks, which have two', () => {
    mounted({ ...ONE, items: [SQUARE, HIGHLIGHT] });
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.getByText('2 selected · page 4')).toBeTruthy();
  });

  it('draws the commands placed at its foot, in order, and runs the one pressed', () => {
    const placed = (id: string, title: typeof REPLY_SELECTION_TITLE, order: number): UiCommand => ({
      id,
      title,
      placements: [{ surface: 'properties', order }],
      run: () => undefined,
    });
    const { ran } = mounted(ONE, [placed('t.delete', DELETE_SELECTION_TITLE, 20), placed('t.reply', REPLY_SELECTION_TITLE, 10)]);
    const foot = screen.getByRole('group', { name: 'Selected annotation' });
    const names = Array.from(foot.querySelectorAll('button')).map((button) => button.textContent);
    expect(names).toStrictEqual(['Reply…', 'Delete selected annotations']);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected annotations' }));
    expect(ran).toStrictEqual(['t.delete']);
  });

  it('CONTROL: a foot command whose `when` is false is not drawn', () => {
    mounted(ONE, [
      { id: 't.reply', title: REPLY_SELECTION_TITLE, placements: [{ surface: 'properties', order: 10 }], when: () => false, run: () => undefined },
    ]);
    expect(screen.queryByRole('group', { name: 'Selected annotation' })).toBeNull();
  });
});

describe('PropertiesPanel with nothing selected', () => {
  it('shows the authoring settings, and *Each tool’s own* is pressed on a fresh install', () => {
    mounted(undefined);
    expect(screen.getByRole('heading', { name: 'New annotations' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Each tool’s own' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a swatch writes the colour setting, and *Each tool’s own* writes `auto` back', () => {
    const { store, restyled } = mounted(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Purple' }));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('#9b6bf2');
    fireEvent.click(screen.getByRole('button', { name: 'Each tool’s own' }));
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
    // NOTHING WAS SENT: with no mark selected there is nothing to restyle.
    expect(restyled).toStrictEqual([]);
  });

  it('offers no comment and no foot, which belong to a mark', () => {
    mounted(undefined, [
      { id: 't.reply', title: REPLY_SELECTION_TITLE, placements: [{ surface: 'properties', order: 10 }], run: () => undefined },
    ]);
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Selected annotation' })).toBeNull();
  });
});
