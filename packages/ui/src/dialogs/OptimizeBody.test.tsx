// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { activateCatalogue } from '../i18n.js';
import { InDialog } from './inDialog.js';
import { EN } from '../messages/en.js';
import OptimizeBody from './OptimizeBody.js';
import type { OptimizeProps } from './optimize.js';

/**
 * The *Save a smaller copy* dialog's body (ADR-0087, ADR-0298). The command's half — that each answer
 * reaches main with the version and step measured — is `commands/documentCommands.test.ts`'; this half is
 * that a SAVE is only ever offered beside a measurement of the choice on show, only when the copy is
 * smaller, and that a size is asked for in the units a person types.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <InDialog>{children}</InDialog>;
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
const MB = 1024 * 1024;
const HIGH = { kind: 'setting', setting: 'high' } as const;
const MEDIUM = { kind: 'setting', setting: 'medium' } as const;

describe('OptimizeBody', () => {
  it('before any check: High chosen, a check offered, and NO save', () => {
    const resolve = shown({ target: HIGH, size: 2 * MB, measured: null });
    expect(screen.getByRole('radio', { name: 'High' })).toHaveProperty('checked', true);
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Low — the smallest file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check the size' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'measure', target: { kind: 'setting', setting: 'low' } });
  });

  it('shows the sizes in the locale’s units and the saving, and answers SAVE for the measurement on show', () => {
    const resolve = shown({ target: MEDIUM, size: 2 * MB, measured: { before: 2_097_152, after: 524_288, fits: true } });
    expect(screen.getByRole('status').textContent).toBe('Now 2 MB. The copy would be 512 kB, 75% smaller.');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'save' });
  });

  it('CONTROL: choosing ANOTHER setting hides the sizes and the save, which belong to the first', () => {
    shown({ target: MEDIUM, size: 2 * MB, measured: { before: 2_097_152, after: 524_288, fits: true } });
    fireEvent.click(screen.getByRole('radio', { name: 'High' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('offers NO save where the copy would not be smaller, and says why', () => {
    shown({ target: HIGH, size: 2 * MB, measured: { before: 1000, after: 1017, fits: true } });
    expect(screen.getByRole('status').textContent).toMatch(/which is not smaller, so it would not be saved/u);
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });

  it('A SIZE I CHOOSE starts at the size last typed, and asks for it in bytes', () => {
    const resolve = shown({ target: HIGH, size: 3 * MB, measured: null });
    fireEvent.click(screen.getByRole('radio', { name: 'A size I choose' }));
    expect(screen.getByRole('textbox', { name: 'Size' })).toHaveProperty('value', '3');
    fireEvent.change(screen.getByRole('textbox', { name: 'Size' }), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check the size' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'measure', target: { kind: 'size', bytes: Math.round(1.5 * MB) } });
  });

  it('reads the size in the unit chosen: 500 KB is not 500 MB', () => {
    const resolve = shown({ target: HIGH, size: 3 * MB, measured: null });
    fireEvent.click(screen.getByRole('radio', { name: 'A size I choose' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Size' }), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'KB' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check the size' }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'measure', target: { kind: 'size', bytes: 500 * 1024 } });
  });

  it('asks for no size it cannot mean: text that is not a number, or past the bounds, offers no check', () => {
    const resolve = shown({ target: HIGH, size: 3 * MB, measured: null });
    fireEvent.click(screen.getByRole('radio', { name: 'A size I choose' }));
    for (const typed of ['2MB', '0', '']) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Size' }), { target: { value: typed } });
      expect(screen.getByRole('button', { name: 'Check the size' })).toHaveProperty('disabled', true);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('where nothing fits, offers the SMALLEST the file can go, and says so plainly', () => {
    const asked = { kind: 'size', bytes: MB } as const;
    const resolve = shown({ target: asked, size: MB, measured: { before: 5 * MB, after: Math.round(3.4 * MB), fits: false } });
    expect(screen.getByRole('status').textContent).toBe('The smallest this file can go is 3.4 MB. Pictures are at their lowest. Save it anyway?');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(resolve).toHaveBeenCalledWith({ kind: 'save' });
  });

  it('CONTROL: another size typed hides the measurement of the first', () => {
    shown({ target: { kind: 'size', bytes: MB }, size: MB, measured: { before: 5 * MB, after: 900_000, fits: true } });
    expect(screen.getByRole('status')).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'Size' }), { target: { value: '2' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
  });
});
