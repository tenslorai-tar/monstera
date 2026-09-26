// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { type MessageKey, asDocId, asDocVersion, messageKey } from '@monstera/shared';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN, STATUS_UNSAVED, WORD_COUNT_PROGRESS } from '../messages/en.js';
import { CommandRegistry, type CommandContext, type UiCommand } from '../registries/commands.js';
import type { Placement } from '../registries/placement.js';
import type { RunningTask } from '../runningTask.js';
import { savedState, type SavedState } from '../savedState.js';
import type { ZoomMode } from '../zoom.js';
import { StatusBar } from './StatusBar.js';

const NAV_FIRST = messageKey('test.status.first');
const NAV_NEXT = messageKey('test.status.next');
const ZOOM_OUT = messageKey('test.status.zoom-out');
const ZOOM_IN = messageKey('test.status.zoom-in');
const FIT = messageKey('test.status.fit');
const TOGGLE = messageKey('test.status.toggle');

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', {
    ...EN,
    [NAV_FIRST]: 'First page',
    [NAV_NEXT]: 'Next page',
    [ZOOM_OUT]: 'Zoom out',
    [ZOOM_IN]: 'Zoom in',
    [FIT]: 'Fit width',
    [TOGGLE]: 'Show the floating toolbar',
  });
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const context: CommandContext = {
  selectedPages: [],
  docId: asDocId('00000000-0000-4000-8000-000000000001'),
  version: asDocVersion(1),
  hasSelection: false,
  dirty: false,
  page: 3,
  pageCount: 10,
  openDocuments: [],
};

function command(id: string, title: UiCommand['title'], placement: Placement, run = vi.fn()): UiCommand {
  return { id, title, icon: 'File', placements: [placement], run };
}

interface Drawn {
  readonly container: HTMLElement;
  readonly went: ReturnType<typeof vi.fn>;
  readonly zoomed: ReturnType<typeof vi.fn>;
}

function drawn(
  over: {
    readonly page?: number;
    readonly zoom?: number;
    readonly name?: string;
    readonly task?: RunningTask | undefined;
    readonly commands?: readonly UiCommand[];
    readonly saved?: SavedState;
    readonly byteLength?: number;
    readonly mode?: MessageKey;
  } = {},
): Drawn {
  const went = vi.fn();
  const zoomed = vi.fn();
  const { container } = render(
    <Wrapped>
      <StatusBar
        name={over.name ?? 'annual.pdf'}
        page={over.page ?? 3}
        pageCount={10}
        zoom={over.zoom ?? 1}
        onGoTo={went}
        onZoom={zoomed}
        registry={new CommandRegistry(over.commands ?? [])}
        context={context}
        byteLength={over.byteLength ?? 2_516_582}
        mode={over.mode}
        task={over.task}
        // THE DEFAULT IS THE DIRTY ONE, deliberately: every case that does not care renders a
        // document with unsaved changes, so a bar that dropped the cell shows it in none of
        // them. A clean default would make the absent cell and the empty string look alike.
        saved={over.saved ?? { message: STATUS_UNSAVED, values: {}, dirty: true }}
      />
    </Wrapped>,
  );
  return { container, went, zoomed };
}

describe('StatusBar', () => {
  it('announces the page number a PERSON reads, not the index that crosses the contract', () => {
    // THE SEPARATING CASE for this surface. Page 4 of 10 is index 3, and a bar that printed the
    // index would be off by one on every document — silently, because "Page 3 of 10" reads fine.
    const { container } = drawn();
    expect(container.querySelector('.m-status-page')?.textContent).toBe('Page 4 of 10');
  });

  it('shows the document NAME main stated, and nothing of a path', () => {
    const { container } = drawn({ name: 'annual report.pdf' });
    const shown = container.querySelector('.m-status-name');
    expect(shown?.textContent).toBe('annual report.pdf');
    // The whole name is on the element too, because the visible one is ellipsed when narrow.
    expect(shown?.getAttribute('title')).toBe('annual report.pdf');
  });

  it('says WHERE THE DOCUMENT STANDS against its file, in the words for that age', () => {
    // The owner's report: Ctrl+S saved and nothing on screen changed. This is the cell that
    // is still there a minute later, and the owner's document export draws it as
    // "Saved 2 min ago" — so the case asserts the SENTENCE and not just that a cell exists.
    //
    // Three states, driven through the real `savedState` rather than hand-built props: a
    // fixture that spelt the message key itself would pass against a bar wired to a different
    // one, which is the assertion reading its own input back (`saved` is the component's prop,
    // and the interesting question is which sentence the RULE produces).
    const at = 1_700_000_000_000;
    const dirty = drawn({ saved: savedState(4, 3, at, at) });
    expect(dirty.container.querySelector('.m-status-saved')?.textContent).toBe('Unsaved changes');
    // AND THE STATE IS ON THE ELEMENT, not only in the words: the stylesheet colours the cell
    // from it, and a reader who cannot see the colour still has the sentence.
    expect(dirty.container.querySelector('.m-status-saved')?.getAttribute('data-dirty')).toBe('true');

    const justSaved = drawn({ saved: savedState(4, 4, at, at + 1_000) });
    expect(justSaved.container.querySelector('.m-status-saved')?.textContent).toBe('Saved just now');

    // TWO MINUTES, the export's own figure. A bar that interpolated nothing renders the
    // placeholder, and one that passed the wrong argument renders "Saved NaN min ago" — both
    // of which the plain "is the cell there" assertion above would pass.
    const older = drawn({ saved: savedState(4, 4, at, at + 125_000) });
    expect(older.container.querySelector('.m-status-saved')?.textContent).toBe('Saved 2 min ago');
  });

  it('the DOCUMENT LINE reads name · pages · size · saved, as v5-02 draws it', () => {
    const { container } = drawn({ byteLength: 2_516_582 });
    const line = container.querySelector('.m-status-document')?.textContent ?? '';
    // 2,516,582 bytes is 2.4 MB to one decimal; ten pages from the helper's page count. The saved
    // state ends the line and is the helper's own, asserted by the case above.
    expect(line.startsWith('annual.pdf·10 pages·2.4 MB·')).toBe(true);
    // UNDER A MEGABYTE it reads in whole KB, never "0.0 MB".
    const small = drawn({ byteLength: 51_200 }).container.querySelector('.m-status-document')?.textContent ?? '';
    expect(small).toContain('50 KB');
  });

  it('names the TOOL THAT IS ON beside the page field, and nothing when none is', () => {
    const on = drawn({ mode: messageKey('command.hand-tool.title') });
    expect(on.container.querySelector('.m-status-mode')?.textContent).toBe('Hand — drag to move the pages');
    // CONTROL: with no tool, no line at all rather than an empty one.
    expect(drawn().container.querySelector('.m-status-mode')).toBeNull();
  });

  it('shows the zoom as a percentage, rounded for display', () => {
    const { container } = drawn({ zoom: 1.3361 });
    expect(container.querySelector('.m-status-zoom')?.textContent).toBe('134%');
  });

  it('is announced POLITELY, because the page number changes on every scroll', () => {
    const { container } = drawn();
    const bar = container.querySelector('[role="status"]');
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-live')).toBeNull();
  });

  describe('the projected buttons (ADR-0067)', () => {
    it('renders each command in its cluster and side, around the value controls, and dispatches it', () => {
      const first = vi.fn();
      const next = vi.fn();
      const { container } = drawn({
        commands: [
          command('view.page-next', NAV_NEXT, { surface: 'status-bar', cluster: 'navigation', side: 'after', order: 1 }, next),
          command('view.page-first', NAV_FIRST, { surface: 'status-bar', cluster: 'navigation', side: 'before', order: 1 }, first),
          command('view.fit-width', FIT, { surface: 'status-bar', cluster: 'zoom', side: 'after', order: 1 }),
          command('view.zoom-in', ZOOM_IN, { surface: 'status-bar', cluster: 'zoom', side: 'between', order: 1 }),
          command('view.zoom-out', ZOOM_OUT, { surface: 'status-bar', cluster: 'zoom', side: 'before', order: 1 }),
        ],
      });

      const field = container.querySelector('[data-goto-input]');
      const slider = container.querySelector('.m-status-zoom-slider');
      const percentage = container.querySelector('.m-status-zoom');
      const byName = (name: string): Element | null => container.querySelector(`button[aria-label="${name}"]`);
      const firstButton = byName('First page');
      const nextButton = byName('Next page');
      const zoomOut = byName('Zoom out');
      const zoomIn = byName('Zoom in');
      const fit = byName('Fit width');
      expect([field, slider, percentage, firstButton, nextButton, zoomOut, zoomIn, fit].every((node) => node !== null)).toBe(
        true,
      );

      // POSITION, which is the whole of `side`: first before the field, next after it; and §10.3's
      // zoom order EXACTLY — zoom-out · slider · zoom-in · percentage · fit. Every adjacent pair is
      // asserted, because the order built before 2026-09-15 (percentage before zoom-in) satisfies
      // "zoom-in after the slider" and "fit after zoom-in" and fails only the pair in the middle.
      const precedes = (a: Element | null, b: Element | null): boolean =>
        a !== null && b !== null && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      expect(precedes(firstButton, field)).toBe(true);
      expect(precedes(field, nextButton)).toBe(true);
      expect(precedes(zoomOut, slider)).toBe(true);
      expect(precedes(slider, zoomIn)).toBe(true);
      expect(precedes(zoomIn, percentage)).toBe(true);
      expect(precedes(percentage, fit)).toBe(true);

      // AND THE BUTTON RUNS ITS COMMAND with the bar's context — the UI half of the wired pair.
      if (!(nextButton instanceof HTMLButtonElement)) throw new Error('next page is a button');
      fireEvent.click(nextButton);
      expect(next).toHaveBeenCalledWith(context);
      expect(first).not.toHaveBeenCalled();
    });

    it('renders NO button a command did not place here', () => {
      const { container } = drawn({
        commands: [command('a.ribbon-only', NAV_FIRST, { surface: 'ribbon', section: 'organize', group: messageKey('group.g'), order: 1 })],
      });
      expect(container.querySelectorAll('.m-status-cluster button')).toHaveLength(0);
    });

    it('the CHROME group holds its commands under its own name, and is absent when it holds none', () => {
      const toggled = vi.fn();
      const withToggle = drawn({
        commands: [command('view.toggle-x', TOGGLE, { surface: 'status-bar', cluster: 'chrome', order: 1 }, toggled)],
      });
      const group = withToggle.container.querySelector('[role="group"][aria-label="Panels and toolbars"]');
      const button = group?.querySelector('button[aria-label="Show the floating toolbar"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('the chrome group holds the toggle');
      fireEvent.click(button);
      expect(toggled).toHaveBeenCalledWith(context);

      const without = drawn();
      expect(without.container.querySelector('[aria-label="Panels and toolbars"]')).toBeNull();
    });
  });

  describe('the zoom slider', () => {
    it('shows the scale shown, and moving it asks for THAT scale through the zoom setter', () => {
      const { container, zoomed } = drawn({ zoom: 1.25 });
      const slider = container.querySelector('.m-status-zoom-slider');
      if (!(slider instanceof HTMLInputElement)) throw new Error('the bar renders a zoom slider');
      expect(slider.value).toBe('1.25');

      fireEvent.change(slider, { target: { value: '2' } });
      expect(zoomed).toHaveBeenCalledTimes(1);
      // THE MODE IT ASKS FOR, from any shown scale: a scale, not a fit, and the one chosen.
      const next = zoomed.mock.calls[0]?.[0] as ((shown: number) => ZoomMode) | undefined;
      expect(next?.(1.25)).toStrictEqual({ kind: 'scale', scale: 2 });
    });
  });

  describe('the page field', () => {
    function field(container: HTMLElement): { readonly input: HTMLInputElement; readonly form: HTMLFormElement } {
      const input = container.querySelector('[data-goto-input]');
      const form = container.querySelector('.m-status-goto');
      if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
        throw new Error('the bar renders a page field inside a form');
      }
      return { input, form };
    }

    it('SHOWS the page a person reads, with the total beside it (§10.3: "page ⁄ total")', () => {
      const { container } = drawn();
      const { input } = field(container);
      expect(input.value).toBe('4');
      expect(container.querySelector('.m-status-total')?.textContent).toBe('/ 10');
    });

    it('and the ANNOUNCEMENT is still text in the status region, visually hidden rather than removed', () => {
      // The reason the field was empty until 2026-09-14: an input React updates fires no text mutation,
      // so a field holding the page would stop the page being announced. The readout stays.
      const { container } = drawn();
      const readout = container.querySelector('[role="status"] .m-status-page');
      expect(readout?.textContent).toBe('Page 4 of 10');
      expect(readout?.classList.contains('m-visually-hidden')).toBe(true);
    });

    it('CONVERTS what the reader typed into the index the kernel wants', () => {
      const { container, went } = drawn();
      const { input, form } = field(container);
      fireEvent.change(input, { target: { value: '7' } });
      fireEvent.submit(form);
      expect(went).toHaveBeenCalledWith(6);
    });

    it('REFUSES a page outside the document, and says where it ends', () => {
      const { container, went } = drawn();
      const { input, form } = field(container);
      fireEvent.change(input, { target: { value: '500' } });
      fireEvent.submit(form);
      expect(went).not.toHaveBeenCalled();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(container.querySelector('.m-status-problem')?.textContent).toBe('This document has pages 1 to 10.');
    });

    it('refuses page 0, which is the index rather than a page', () => {
      const { container, went } = drawn();
      const { input, form } = field(container);
      fireEvent.change(input, { target: { value: '0' } });
      fireEvent.submit(form);
      expect(went).not.toHaveBeenCalled();
    });

    it('refuses what is not a whole number, rather than jumping somewhere', () => {
      const { container, went } = drawn();
      const { input, form } = field(container);
      for (const value of ['', 'four', '2.5']) {
        fireEvent.change(input, { target: { value } });
        fireEvent.submit(form);
      }
      expect(went).not.toHaveBeenCalled();
    });

    it('CLEARS the refusal as soon as the number is edited', () => {
      const { container } = drawn();
      const { input, form } = field(container);
      fireEvent.change(input, { target: { value: '500' } });
      fireEvent.submit(form);
      expect(container.querySelector('.m-status-problem')).not.toBeNull();
      fireEvent.change(input, { target: { value: '5' } });
      expect(container.querySelector('.m-status-problem')).toBeNull();
      expect(input.getAttribute('aria-invalid')).toBe('false');
    });

    it('SUBMITTING UNTOUCHED jumps nowhere: the page shown is where the reader already is', () => {
      const { container, went } = drawn();
      const { form } = field(container);
      fireEvent.submit(form);
      expect(went).not.toHaveBeenCalled();
    });
  });

  describe('a running task', () => {
    it('is ABSENT with nothing running, rather than an empty region', () => {
      const { container } = drawn();
      expect(container.querySelector('.m-status-task')).toBeNull();
    });

    it('names WHAT is running before the numbers, and both of them', () => {
      const { container } = drawn({ task: { label: WORD_COUNT_PROGRESS, done: 12, total: 400, cancel: vi.fn() } });
      expect(container.querySelector('.m-status-task')?.textContent).toContain('Counting words — 12 of 400');
    });

    it('the CANCEL dispatches the task’s own cancel, not a lookup at press time', () => {
      const cancelled = vi.fn();
      const { container } = drawn({ task: { label: WORD_COUNT_PROGRESS, done: 12, total: 400, cancel: cancelled } });
      const button = container.querySelector('.m-status-cancel');
      if (!(button instanceof HTMLButtonElement)) throw new Error('the task offers a cancel');
      fireEvent.click(button);
      expect(cancelled).toHaveBeenCalledTimes(1);
    });
  });
});
