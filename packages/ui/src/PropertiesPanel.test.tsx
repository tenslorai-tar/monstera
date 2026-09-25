// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { annotationOpacitySchema, MIN_ANNOTATION_OPACITY } from '@monstera/contract';
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
  selectedPages: [],
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
  author: 'Priya Raman',
  created: '2026-09-24T09:38:00.000Z',
  blend: 'normal' as const,
  style: { colour: [0.2, 0.4, 0.6], opacity: 0.5, borderWidth: 2 },
};

const HIGHLIGHT = {
  ...SQUARE,
  index: 3,
  kind: 'highlight' as const,
  contents: '',
  author: '',
  created: null,
  blend: 'multiply' as const,
  style: { colour: [1, 0.83, 0], opacity: 1, borderWidth: null },
};

const ONE: AnnotationSelection = { page: 3, version: asDocVersion(4), items: [SQUARE] };

interface Mounted {
  readonly store: SettingsStore;
  readonly restyled: StyleChange[];
  readonly commented: string[];
  readonly authors: string[];
  readonly ran: string[];
}

function mounted(selection: AnnotationSelection | undefined, foot: readonly UiCommand[] = []): Mounted {
  const store = new SettingsStore(new SettingsRegistry(ALL_SETTINGS));
  const restyled: StyleChange[] = [];
  const commented: string[] = [];
  const authors: string[] = [];
  const ran: string[] = [];
  render(
    <Wrapped>
      <PropertiesPanel
        context={CONTEXT}
        onComment={(chosen, text) => {
          expect(chosen).toBe(selection);
          commented.push(text);
        }}
        onAuthor={(chosen, author) => {
          expect(chosen).toBe(selection);
          authors.push(author);
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
  return { store, restyled, commented, authors, ran };
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

  it('the slider SHOWS the mark’s own opacity, and offers no value the payload would refuse', () => {
    // The mark is at 0.5 and the opacity setting starts at 1, so a slider showing the setting reads differently.
    mounted(ONE);
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' });
    expect(slider.value).toBe('0.5');
    expect(slider.max).toBe('1');
    // Its floor is the LOWEST value the contract accepts: at it, accepted; a hundredth under, refused.
    expect(annotationOpacitySchema.safeParse(Number(slider.min)).success).toBe(true);
    expect(annotationOpacitySchema.safeParse(Number(slider.min) - 0.01).success).toBe(false);
  });

  it('a foreign mark fainter than the floor shows AT the floor, not off the slider’s end', () => {
    // THE READOUT, not the slider's value: happy-dom, like a browser, pulls a range input below its `min` up
    // to it by itself, so the slider reads the floor whether or not the panel clamped. The `<output>` beside
    // it is drawn from the panel's own number and is where a missing clamp shows.
    const readout = (): string | null => document.querySelector('.m-properties__value')?.textContent ?? null;
    mounted({ ...ONE, items: [{ ...SQUARE, style: { ...SQUARE.style, opacity: MIN_ANNOTATION_OPACITY } }] });
    const atFloor = readout();
    cleanup();

    mounted({ ...ONE, items: [{ ...SQUARE, style: { ...SQUARE.style, opacity: 0.05 } }] });
    expect(atFloor).not.toBeNull();
    expect(readout()).toBe(atFloor);
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Opacity' }).value).toBe(String(MIN_ANNOTATION_OPACITY));
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

  it('the AUTHOR is sent when focus leaves it changed, and not when unchanged (ADR-0103)', () => {
    const { authors } = mounted(ONE);
    const field = screen.getByRole('textbox', { name: 'Author' });
    expect((field as HTMLInputElement).value).toBe('Priya Raman');
    fireEvent.blur(field);
    expect(authors).toStrictEqual([]);
    fireEvent.change(field, { target: { value: 'Sam Okafor' } });
    fireEvent.blur(field);
    expect(authors).toStrictEqual(['Sam Okafor']);
  });

  it('shows WHEN the mark was made, read-only, and nothing for a mark with no date', () => {
    mounted(ONE);
    const created = document.querySelector('[data-properties-created]');
    expect(created?.getAttribute('data-properties-created')).toBe('2026-09-24T09:38:00.000Z');
    expect(created?.textContent).toMatch(/^Created /u);
    // READ-ONLY: nothing on the tab edits it.
    expect(screen.queryByRole('textbox', { name: /created/iu })).toBeNull();
    cleanup();
    mounted({ ...ONE, items: [HIGHLIGHT] });
    expect(document.querySelector('[data-properties-created]')).toBeNull();
  });

  it('BLEND shows the mark’s own and sends the other as a restyle, never as a default', () => {
    const { restyled, store } = mounted({ ...ONE, items: [HIGHLIGHT] });
    const multiply = screen.getByRole('button', { name: 'Multiply' });
    expect(multiply.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(multiply);
    // THE PRESSED ONE SENDS NOTHING: no restyle for a document that would not change.
    expect(restyled).toStrictEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
    expect(restyled).toStrictEqual([{ blend: 'normal' }]);
    // *Use as default* is on, and the blend is not one of the settings it writes.
    expect(store.get(ANNOTATION_COLOUR_SETTING.id)).toBe('auto');
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
