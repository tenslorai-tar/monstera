// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { messageKey } from '@monstera/shared';
import { fireEvent, render as renderBare, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { SegmentedControl } from './SegmentedControl.js';

const GROUP = messageKey('test.segmented.group');
const ONE = messageKey('test.segmented.one');
const TWO = messageKey('test.segmented.two');
const THREE = messageKey('test.segmented.three');
activateCatalogue('en', { [GROUP]: 'Layout', [ONE]: 'One', [TWO]: 'Two', [THREE]: 'Three' });

function Messages({ children }: { children: ReactNode }): ReactElement {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

type Choice = 'one' | 'two' | 'three';
const OPTIONS = [
  { value: 'one', label: ONE },
  { value: 'two', label: TWO },
  { value: 'three', label: THREE },
] as const;

function drawn(value: Choice, onChange = vi.fn()): { readonly onChange: typeof onChange; readonly rerender: (next: Choice) => void } {
  const { rerender } = renderBare(<SegmentedControl label={GROUP} options={OPTIONS} value={value} onChange={onChange} />, {
    wrapper: Messages,
  });
  return {
    onChange,
    rerender: (next) => {
      rerender(<SegmentedControl label={GROUP} options={OPTIONS} value={next} onChange={onChange} />);
    },
  };
}

const pressed = (): string[] =>
  screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent);

describe('SegmentedControl', () => {
  it('is a group named by its label, with exactly the held value pressed', () => {
    drawn('two');
    expect(screen.getByRole('group', { name: 'Layout' })).toBeDefined();
    // THE SEPARATING FIXTURE: the middle value, so neither "the first is pressed" nor "none is" passes.
    expect(pressed()).toStrictEqual(['Two']);
  });

  it('reports a different segment chosen, once, with its value', () => {
    const { onChange } = drawn('one');
    fireEvent.click(screen.getByRole('button', { name: 'Three' }));
    expect(onChange.mock.calls).toStrictEqual([['three']]);
  });

  it('pressing the PRESSED segment reports nothing and leaves it pressed — a segmented control always holds one', () => {
    // THE CONTROL beside it: the same click on another segment IS reported (the case above), so silence here is the
    // refusal of the group's empty value, not a click that never arrived.
    const { onChange } = drawn('two');
    fireEvent.click(screen.getByRole('button', { name: 'Two' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(pressed()).toStrictEqual(['Two']);
  });

  it('follows the value it is given, since the caller holds it', () => {
    const { rerender } = drawn('one');
    rerender('three');
    expect(pressed()).toStrictEqual(['Three']);
  });
});
