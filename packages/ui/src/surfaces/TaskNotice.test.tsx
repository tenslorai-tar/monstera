// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { CSV_CONVERTING, EN, WORD_COUNT_PROGRESS } from '../messages/en.js';
import { ToastStrip } from '../primitives/Toast.js';
import { TaskNotice } from './TaskNotice.js';

/**
 * The one place work in progress is shown (the owner's O9): in the toast strip, which is on screen over the start screen
 * too, where no status bar is. These cases were the status bar's while the task lived there.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function drawn(task: Parameters<typeof TaskNotice>[0]['task']): HTMLElement {
  return render(
    <Wrapped>
      <ToastStrip toasts={[]} dismissLabel={WORD_COUNT_PROGRESS} onDismiss={() => undefined} lifetime={1000}>
        <TaskNotice task={task} />
      </ToastStrip>
    </Wrapped>,
  ).container;
}

describe('the work-in-progress notice', () => {
  it('is ABSENT with nothing running, rather than an empty row', () => {
    expect(drawn(undefined).querySelector('[data-task-notice]')).toBeNull();
  });

  it('names WHAT is running before the numbers, and both of them, in the strip that is on screen without a document', () => {
    const container = drawn({ label: WORD_COUNT_PROGRESS, done: 12, total: 400, cancel: vi.fn(), stoppable: true });
    const notice = container.querySelector('.m-toasts [data-task-notice]');
    expect(notice?.textContent).toContain('Counting words — 12 of 400');
  });

  it('CONTROL: work that has not said how many parts it has shows its label, never "0 of 0"', () => {
    const container = drawn({ label: CSV_CONVERTING, done: 0, total: 0, cancel: vi.fn(), stoppable: true });
    const text = container.querySelector('[data-task-notice]')?.textContent ?? '';
    expect(text).toContain('Converting CSV to PDF…');
    expect(text).not.toContain('0 of 0');
  });

  it('the CANCEL dispatches the task’s own cancel, not a lookup at press time', () => {
    const cancelled = vi.fn();
    const container = drawn({ label: WORD_COUNT_PROGRESS, done: 12, total: 400, cancel: cancelled, stoppable: true });
    const button = container.querySelector('[data-task-notice] button');
    if (!(button instanceof HTMLButtonElement)) throw new Error('the notice offers a cancel');
    fireEvent.click(button);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it('work that RUNS TO THE END shows its label and NO Cancel (ADR-0234) — CONTROL: the case above, which stops, has one', () => {
    const container = drawn({ label: CSV_CONVERTING, done: 0, total: 0, cancel: vi.fn(), stoppable: false });
    expect(container.querySelector('[data-task-notice]')?.textContent).toContain('Converting CSV to PDF…');
    expect(container.querySelector('[data-task-notice] button')).toBeNull();
  });
});
