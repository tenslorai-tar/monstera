// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Input } from './Input.js';

describe('Input', () => {
  it('associates its label with the control', () => {
    render(<Input label="File name" onValueChange={vi.fn()} value="" />);
    // `getByLabelText` reads the association the way an assistive technology
    // does. A visually adjacent label that is not associated fails here and
    // looks identical on screen, which is the whole reason to query this way.
    expect(screen.getByLabelText('File name')).toBeDefined();
  });

  it('gives two instances two associations, not one shared id', () => {
    render(
      <>
        <Input label="First" onValueChange={vi.fn()} value="" />
        <Input label="Second" onValueChange={vi.fn()} value="" />
      </>,
    );
    const first = screen.getByLabelText('First');
    const second = screen.getByLabelText('Second');

    // THE CASE A HAND-WRITTEN htmlFor FAILS. Two instances sharing a generated
    // id both resolve to the first control, so `getByLabelText('Second')` would
    // return the same node — and every other assertion in this file would still
    // pass. This is why the association comes from Base UI's Field rather than
    // from an id this file invents.
    expect(first).not.toBe(second);
    expect(first.id).not.toBe(second.id);
  });

  it('reports what the user typed', () => {
    const onValueChange = vi.fn();
    render(<Input label="File name" onValueChange={onValueChange} value="" />);
    const control = screen.getByLabelText('File name');

    // `fireEvent.change` rather than assigning `.value` and dispatching. React
    // tracks the value through its own property descriptor, so a direct
    // assignment is invisible to it and the handler never runs — which is
    // exactly what the first version of this case observed, and it would have
    // read as a broken component rather than a broken harness.
    fireEvent.change(control, { target: { value: 'report' } });

    // Asserting the ARGUMENT, not that a call happened: a component that fired
    // the callback with nothing would satisfy `toHaveBeenCalled` and lose every
    // keystroke.
    expect(onValueChange).toHaveBeenCalledWith('report');
  });

  it('renders the placeholder as a hint, never as the name', () => {
    render(
      <Input label="File name" onValueChange={vi.fn()} placeholder="untitled" value="" />,
    );
    const control = screen.getByLabelText('File name');
    expect(control.getAttribute('placeholder')).toBe('untitled');
    // The name still comes from the label. A placeholder-as-name disappears the
    // moment anyone types, taking the control's identity with it.
    expect(screen.queryByLabelText('untitled')).toBeNull();
  });

  it('is focusable, and disabled when told', () => {
    const { unmount } = render(<Input label="File name" onValueChange={vi.fn()} value="" />);
    const control = screen.getByLabelText('File name');
    control.focus();
    expect(document.activeElement).toBe(control);
    unmount();

    render(<Input disabled label="File name" onValueChange={vi.fn()} value="" />);
    expect(screen.getByLabelText('File name').hasAttribute('disabled')).toBe(true);
  });
});
