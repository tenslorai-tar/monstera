// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { X } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { IconButton } from './IconButton.js';
import { ICON_SIZES } from './iconSize.js';

describe('IconButton', () => {
  it('takes its accessible name from the label, not from the glyph', () => {
    render(<IconButton icon={X} label="Close" size="control" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
  });

  it('hides the glyph from the accessibility tree, so the name is announced once', () => {
    render(<IconButton icon={X} label="Close" size="control" />);
    const svg = screen.getByRole('button', { name: 'Close' }).querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('carries the size as a class, since the pixel value lives in the stylesheet', () => {
    // Deliberately not an assertion about 16 px. `iconSize.ts` holds no numbers
    // — `tokens.css` does — so a component test with no stylesheet loaded cannot
    // observe the size without building the second copy that arrangement exists
    // to refuse. What it CAN observe is that the use reaches the DOM.
    render(<IconButton icon={X} label="Close" size="ribbon" />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button.className).toContain('m-icon-button--ribbon');
  });

  it('emits a distinct class for every one of §10.4s four sizes', () => {
    // The roster is the tuple, which a fifth size cannot silently join. Without
    // this, four uses all rendering the same class would pass the case above.
    const classes = ICON_SIZES.map((size) => {
      const { unmount } = render(<IconButton icon={X} label="Close" size={size} />);
      const found = screen.getByRole('button', { name: 'Close' }).className;
      unmount();
      return found;
    });
    expect(new Set(classes).size).toBe(ICON_SIZES.length);
  });

  it('calls onClick when activated, and not when disabled', () => {
    const onClick = vi.fn();
    const { unmount } = render(<IconButton icon={X} label="Close" onClick={onClick} size="dense" />);
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();

    render(<IconButton disabled icon={X} label="Close" onClick={onClick} size="dense" />);
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is focusable from the keyboard', () => {
    render(<IconButton icon={X} label="Close" size="chrome" />);
    const button = screen.getByRole('button', { name: 'Close' });
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});
