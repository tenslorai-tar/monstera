// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CustomColour } from './ColourChoice.js';

/**
 * The custom colour answers once, when the picker lets go (the owner's O6): every step of a drag in the picker is an
 * `input` event, and answered at each one a drag was dozens of document commands. The CONTROL is the `change` the picker
 * fires when it closes, which must answer, so the cases separate *answers at the end* from *never answers*.
 */
describe('the custom colour', () => {
  function rendered(value = '#000000'): { readonly input: HTMLInputElement; readonly picks: string[]; readonly again: (next: string) => void } {
    const picks: string[] = [];
    const onPick = (hex: string): void => {
      picks.push(hex);
    };
    const view = render(<CustomColour label="Custom colour" value={value} onPick={onPick} />);
    return {
      input: screen.getByLabelText<HTMLInputElement>('Custom colour'),
      picks,
      again: (next) => {
        view.rerender(<CustomColour label="Custom colour" value={next} onPick={onPick} />);
      },
    };
  }

  it('the steps of a drag move what the input shows and answer nothing', () => {
    const { input, picks } = rendered();
    for (const hex of ['#110000', '#220000', '#330000']) fireEvent.input(input, { target: { value: hex } });
    expect(picks).toStrictEqual([]);
    expect(input.value).toBe('#330000');
  });

  it('CONTROL: the picker closing on a colour answers it, once', () => {
    const { input, picks } = rendered();
    fireEvent.input(input, { target: { value: '#110000' } });
    fireEvent.input(input, { target: { value: '#123456' } });
    fireEvent.change(input, { target: { value: '#123456' } });
    expect(picks).toStrictEqual(['#123456']);
  });

  it('a colour from outside, such as another selection’s, is what the input shows', () => {
    const { input, again } = rendered('#000000');
    fireEvent.input(input, { target: { value: '#abcdef' } });
    again('#ff0000');
    expect(input.value).toBe('#ff0000');
  });
});
