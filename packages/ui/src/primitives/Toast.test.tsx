// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { type ToastMessage, ToastStrip } from './Toast.js';

const SAVED = messageKey('test.toast.saved');
const DISMISS = messageKey('test.toast.dismiss');
activateCatalogue('en', { [SAVED]: 'Saved', [DISMISS]: 'Dismiss' });

/** How long a toast stays in these cases. Short, and stated, so no case waits one out. */
const LIFETIME = 4_000;

/** The strip with a real queue behind it: a dismissal removes the toast, as `toasts.ts` does. */
function Strip(): ReactElement {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([{ id: 1, kind: 'done', message: SAVED }]);
  const onDismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return (
    <I18nProvider i18n={i18n}>
      <ToastStrip dismissLabel={DISMISS} lifetime={LIFETIME} onDismiss={onDismiss} toasts={toasts} />
    </I18nProvider>
  );
}

/** Moves the fake clock, letting React settle what the timers did. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ToastStrip', () => {
  it('a toast whose × HAS FOCUS outlives its lifetime, and focus stays on it', () => {
    render(<Strip />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    act(() => {
      dismiss.focus();
    });

    advance(LIFETIME * 3);

    expect(screen.queryByText('Saved')).not.toBeNull();
    expect(document.activeElement).toBe(dismiss);
  });

  it('CONTROL: the same toast with nothing on it leaves at its lifetime', () => {
    render(<Strip />);
    advance(LIFETIME - 1);
    expect(screen.queryByText('Saved')).not.toBeNull();
    advance(1);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('RESUMES with what was left once focus leaves, rather than starting again', () => {
    render(<Strip />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    advance(LIFETIME - 1_000);
    act(() => {
      dismiss.focus();
    });
    advance(LIFETIME * 2);
    act(() => {
      dismiss.blur();
    });

    // THE SECOND LEFT OVER, not a fresh lifetime: a restart would still be showing it here.
    advance(1_000);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('a toast under the POINTER outlives its lifetime, and leaves once the pointer does', () => {
    render(<Strip />);
    const toast = screen.getByText('Saved').closest('.m-toast');
    if (toast === null) throw new Error('the toast rendered no .m-toast element');
    fireEvent.mouseEnter(toast);
    advance(LIFETIME * 3);
    expect(screen.queryByText('Saved')).not.toBeNull();

    fireEvent.mouseLeave(toast);
    advance(LIFETIME);
    expect(screen.queryByText('Saved')).toBeNull();
  });
});
