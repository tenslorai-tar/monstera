// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FieldTextBox } from './FieldControls.js';

/**
 * A text field's box sends what was typed into it once it is left, measured against what it showed (QQQQQQQ-10).
 *
 * The defect was in WHERE the shown value was recorded: an inline `ref` callback, which React calls again on every
 * commit, so a render while the person typed recorded the half-typed value as shown, and the blur compared it with
 * itself and sent nothing. Every case here renders again mid-edit, which is the input the defect needs; a case that
 * never re-rendered would pass against it.
 */
describe('a field box sends what was typed, whatever renders in between', () => {
  const offer = { kind: 'text', held: 'Ada', lines: false } as const;

  it('sends the typed value after a render in the middle of typing', () => {
    const sent: string[] = [];
    const props = { offer, name: 'Name', className: 'm-forms-text', onCommit: (text: string) => sent.push(text) };
    const { container, rerender } = render(<FieldTextBox {...props} />);
    const box = container.querySelector('input');
    if (box === null) throw new Error('no input was drawn');

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'Grace' } });
    // A RENDER WITH THE SAME PROPS, which is what a version moving or a pointer passing does to its parent.
    rerender(<FieldTextBox {...props} />);
    fireEvent.blur(box);

    expect(sent).toStrictEqual(['Grace']);
  });

  it('CONTROL: a box left as it was sends nothing, through the same render', () => {
    const sent: string[] = [];
    const props = { offer, name: 'Name', className: 'm-forms-text', onCommit: (text: string) => sent.push(text) };
    const { container, rerender } = render(<FieldTextBox {...props} />);
    const box = container.querySelector('input');
    if (box === null) throw new Error('no input was drawn');

    fireEvent.focus(box);
    rerender(<FieldTextBox {...props} />);
    fireEvent.blur(box);

    expect(sent).toStrictEqual([]);
  });
});
