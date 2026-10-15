// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ListCard } from './ListCard.js';

describe('ListCard', () => {
  it('is a list item with the card class beside the list’s own, marked chosen only when selected', () => {
    const { container } = render(
      <ul>
        <ListCard className="m-forms-row" data-form-row-selected="true" selected>
          <span>chosen</span>
        </ListCard>
        <ListCard selected={false}>
          <span>plain</span>
        </ListCard>
      </ul>,
    );
    const [chosen, plain] = [...container.querySelectorAll('li')];
    expect(chosen?.className).toBe('m-list-card m-forms-row');
    expect(chosen?.getAttribute('data-list-card-selected')).toBe('true');
    // A CALLER'S OWN DATA ATTRIBUTE PASSES THROUGH, so its tests and its read of a row are unchanged.
    expect(chosen?.getAttribute('data-form-row-selected')).toBe('true');
    expect(plain?.className).toBe('m-list-card');
    expect(plain?.hasAttribute('data-list-card-selected')).toBe(false);
  });
});
