// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { FormLayer, type PageFill } from './FormLayer.js';
import type { ListedField } from './fieldFill.js';

/**
 * The date field's calendar reaches a date far back quickly (the owner's R25: *"imagine I want to pick a date 20 or 30
 * years ago, maybe my date of birth… I have to go back every single month"*), through the real field on the page: the
 * title goes up from the days to the months, the years and the decades, choosing goes back down, and Today picks today.
 * The keyboard does the same from the box, which keeps the focus.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function dateField(values: readonly string[] = []): ListedField {
  return {
    index: 0,
    page: 2,
    kind: 'text',
    name: 'Date of birth',
    values,
    on: null,
    options: [],
    readOnly: false,
    multiline: false,
    rect: { x0: 10, y0: 700, x1: 110, y1: 720 },
    required: false,
    maxLength: null,
    comb: false,
    masked: false,
    multiSelect: false,
    editable: false,
    calculated: false,
    format: { kind: 'date', pattern: 'dd/mm/yyyy' },
  };
}

/** The field drawn, its box open, and the calendar opened from its button: what a person has before the presses counted. */
function openCalendar(values: readonly string[] = []): { container: HTMLElement; fills: PageFill[]; box: HTMLInputElement } {
  const fills: PageFill[] = [];
  const { container } = render(
    <Wrapped>
      <FormLayer
        fields={[dateField(values)]}
        geometry={{ crop: [0, 0, 612, 792], rotation: 0, zoom: 2 }}
        onFill={(fill) => {
          fills.push(fill);
        }}
        page={2}
      />
    </Wrapped>,
  );
  fireEvent.click(must(container.querySelector<HTMLElement>('[data-form-field="0"]')));
  fireEvent.click(must(container.querySelector<HTMLElement>('button[aria-label="Choose a date"]')));
  return { container, fills, box: must(container.querySelector<HTMLInputElement>('input[data-form-field="0"]')) };
}

function must<T>(element: T | null): T {
  if (element === null) throw new Error('the control the case acts on is not there');
  return element;
}

/** A calendar button by its whole accessible name, pressed and counted. */
function presser(container: HTMLElement): { press: (name: string | RegExp) => void; count: () => number } {
  let presses = 0;
  return {
    press: (name) => {
      const found = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => {
        const label = button.getAttribute('aria-label') ?? button.textContent;
        return typeof name === 'string' ? label === name : name.test(label);
      });
      fireEvent.click(must(found ?? null));
      presses += 1;
    },
    count: () => presses,
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

afterEach(() => {
  vi.useRealTimers();
});

describe('the date field’s calendar: months, years and decades (R25)', () => {
  // TODAYS CHOSEN TO SIT ON EACH SIDE OF A CENTURY AND A DECADE, so a page laid out by the century would leave the
  // target off it for one of them (from 2015, 1985 is in the last century).
  for (const now of ['2026-10-21', '2015-06-15', '2030-01-01', '2000-03-09']) {
    it(`from ${now}, a date thirty years back is seven presses: the title three times, the decade, the year, the month, the day`, () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(`${now}T12:00:00`));
      const [year, month, day] = now.split('-').map(Number) as [number, number, number];
      const target = { year: year - 30, month, day };
      const decade = Math.floor(target.year / 10) * 10;
      const { container, fills } = openCalendar();
      const { press, count } = presser(container);
      press(/, Choose a month$/u);
      press(/, Choose a year$/u);
      press(/, Choose ten years$/u);
      press(`${String(decade)}–${String(decade + 9)}`);
      press(String(target.year));
      press(`${MONTHS[target.month - 1] ?? ''} ${String(target.year)}`);
      press(new RegExp(`${MONTHS[target.month - 1] ?? ''} ${String(target.day)}, ${String(target.year)}$`, 'u'));
      expect(count()).toBe(7);
      expect(fills).toStrictEqual([
        { page: 2, index: 0, value: { set: 'text', text: `${pad(target.day)}/${pad(target.month)}/${String(target.year)}` } },
      ]);
    });
  }

  // A YEAR OF PRESSES, read one month at a time, not thirty: each press renders the whole form layer, and 360 of them
  // took 5.4 s alone on Windows (2026-10-22), past the run's limit. What the bound rests on is that the arrow moves ONE
  // month and no more, which every press here is read for; thirty years back is then 360 presses by that step.
  it('CONTROL: without the title, the month arrow moves one month a press, so 30 years back is 360 presses — the bound is the title’s', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00'));
    const { container } = openCalendar();
    const { press, count } = presser(container);
    const title = (): string => must(container.querySelector('.m-date-picker__month')).textContent;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthsSinceZero = (text: string): number => {
      const [name = '', year = ''] = text.split(' ');
      return Number(year) * 12 + months.indexOf(name);
    };
    for (let step = 0; step < 12; step += 1) {
      const before = monthsSinceZero(title());
      press('Previous month');
      expect(monthsSinceZero(title()), title()).toBe(before - 1);
    }
    expect(title()).toBe('October 2025');
    expect(count()).toBe(12);
  });

  it('the KEYBOARD alone, from the box: Ctrl+Up three times, three decades back, Enter down to a day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00'));
    const fills: PageFill[] = [];
    const { container } = render(
      <Wrapped>
        <FormLayer
          fields={[dateField()]}
          geometry={{ crop: [0, 0, 612, 792], rotation: 0, zoom: 2 }}
          onFill={(fill) => {
            fills.push(fill);
          }}
          page={2}
        />
      </Wrapped>,
    );
    fireEvent.click(must(container.querySelector<HTMLElement>('[data-form-field="0"]')));
    const box = must(container.querySelector<HTMLInputElement>('input[data-form-field="0"]'));
    const key = (name: string, ctrlKey = false): void => {
      fireEvent.keyDown(box, { key: name, ctrlKey });
    };
    const view = (): string | null => container.querySelector('[role="dialog"]')?.getAttribute('data-view') ?? null;
    fireEvent.keyDown(box, { key: 'ArrowDown', altKey: true });
    key('ArrowUp', true);
    key('ArrowUp', true);
    key('ArrowUp', true);
    expect(view()).toBe('decades');
    key('ArrowLeft');
    key('ArrowLeft');
    key('ArrowLeft');
    // THE BOX POINTS AT THE DECADE THE KEYBOARD IS ON, so a screen reader names it.
    expect(must(container.ownerDocument.getElementById(must(box.getAttribute('aria-activedescendant')))).getAttribute('aria-label')).toBe('1990–1999');
    key('Enter');
    expect(view()).toBe('years');
    key('Enter');
    expect(view()).toBe('months');
    // HOME AND END in the months: January and December of the year, and back.
    key('Home');
    expect(must(container.ownerDocument.getElementById(must(box.getAttribute('aria-activedescendant')))).textContent).toBe('Jan');
    key('End');
    key('PageUp');
    key('Enter');
    expect(view()).toBe('days');
    expect(must(container.querySelector('.m-date-picker__month')).textContent).toBe('December 1995');
    key('Home');
    key('Enter');
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'text', text: '01/12/1995' } }]);
  });

  it('CONTROL: Escape in an upper view closes the calendar and fills nothing; the box is still open for typing', () => {
    const { container, fills, box } = openCalendar(['07/03/2026']);
    const { press } = presser(container);
    press(/, Choose a month$/u);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('input[data-form-field="0"]')).not.toBeNull();
    expect(fills).toStrictEqual([]);
  });

  it('TODAY picks today, from a calendar opened on a date years away', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T12:00:00'));
    const { container, fills } = openCalendar(['07/03/2001']);
    expect(must(container.querySelector('.m-date-picker__month')).textContent).toBe('March 2001');
    presser(container).press('Today');
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'text', text: '21/10/2026' } }]);
  });

  it('a typed date in the field’s own pattern is still what fills it, with the calendar never opened', () => {
    const fills: PageFill[] = [];
    const { container } = render(
      <Wrapped>
        <FormLayer
          fields={[dateField()]}
          geometry={{ crop: [0, 0, 612, 792], rotation: 0, zoom: 2 }}
          onFill={(fill) => {
            fills.push(fill);
          }}
          page={2}
        />
      </Wrapped>,
    );
    fireEvent.click(must(container.querySelector<HTMLElement>('[data-form-field="0"]')));
    const box = must(container.querySelector<HTMLInputElement>('input[data-form-field="0"]'));
    fireEvent.change(box, { target: { value: '14/02/1990' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.blur(box);
    expect(fills).toStrictEqual([{ page: 2, index: 0, value: { set: 'text', text: '14/02/1990' } }]);
  });
});
