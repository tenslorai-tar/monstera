// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import OptimizeBody from './OptimizeBody.js';
import type { OptimizeProps } from './optimize.js';

/**
 * The *Save a smaller copy* dialog's body (ADR-0087). The command's half — that each answer
 * reaches main with the version measured — is `commands/documentCommands.test.ts`'; this half is
 * that a SAVE is only ever offered beside a measurement of the setting on show, and only when the
 * copy is smaller.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

afterEach(() => {
  cleanup();
});

function shown(props: OptimizeProps): ReturnType<typeof vi.fn> {
  const resolve = vi.fn();
  render(
    <Wrapped>
      <OptimizeBody {...props} resolve={resolve} update={() => undefined} />
    </Wrapped>,
  );
  return resolve;
}

const SAVE = 'Choose where to save…';

describe('OptimizeBody', () => {
  it('before any check: High chosen, a check offered, and NO save', () => {
    const resolve = shown({ setting: 'high', measured: null });
    expect(screen.getByRole('radio', { name: 'High' })).toHaveProperty('checked', true);
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Low — the smallest file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check the size' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'measure', setting: 'low' });
  });

  it('shows the sizes in the locale’s units and the saving, and SAVES the setting measured', () => {
    const resolve = shown({ setting: 'medium', measured: { before: 2_097_152, after: 524_288 } });
    expect(screen.getByRole('status').textContent).toBe('Now 2 MB. The copy would be 512 kB, 75% smaller.');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'save', setting: 'medium' });
  });

  it('CONTROL: choosing ANOTHER setting hides the sizes and the save, which belong to the first', () => {
    shown({ setting: 'medium', measured: { before: 2_097_152, after: 524_288 } });
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('offers NO save where the copy would not be smaller, and says why', () => {
    shown({ setting: 'high', measured: { before: 1000, after: 1017 } });
    expect(screen.getByRole('status').textContent).toMatch(/which is not smaller, so it would not be saved/u);
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });
});
