// @vitest-environment happy-dom
import type { Menu } from '@base-ui/react/menu';
import { describe, expect, it } from 'vitest';

import { arrivesByArrowKey, firstItem } from './menuRowKeys.js';

/** An open as Base UI reports it: a reason and the native event behind it. */
function opened(reason: Menu.Root.ChangeEventReason, target: Element): Menu.Root.ChangeEventDetails {
  const event = new FocusEvent('focusin', { bubbles: true });
  target.dispatchEvent(event);
  const details = { reason, event, trigger: target, isCanceled: false, isPropagationAllowed: false, cancel: () => undefined, allowPropagation: () => undefined };
  return details as unknown as Menu.Root.ChangeEventDetails;
}

describe('a row menu brought by the arrow keys (menuRowKeys.ts)', () => {
  it('is a trigger-focus open whose title is :focus-visible; CONTROL: the same open with a pointer-focused title is not', () => {
    // THE BROWSER'S FOCUS MODALITY, which happy-dom does not compute: one title as the arrow key leaves it, one as a
    // click or a hover does.
    const title = (keyboard: boolean): Element => {
      const element = document.createElement('button');
      Object.defineProperty(element, 'matches', { value: (selector: string) => keyboard && selector === ':focus-visible' });
      document.body.append(element);
      return element;
    };
    expect(arrivesByArrowKey(opened('trigger-focus', title(true)))).toBe(true);
    expect(arrivesByArrowKey(opened('trigger-focus', title(false)))).toBe(false);
    // A HOVER OR A PRESS is never one, whatever the focus looks like.
    for (const reason of ['trigger-hover', 'trigger-press', 'list-navigation'] as const) {
      expect(arrivesByArrowKey(opened(reason, title(true))), reason).toBe(false);
    }
  });

  it('its focus goes to the FIRST item that can run, past a disabled one by either mark; none when none can', () => {
    document.body.innerHTML =
      '<div role="menu" id="m"><span role="group"><div role="menuitem" aria-disabled="true">Undo</div>' +
      '<div role="menuitem" data-disabled="">Redo</div><div role="menuitemcheckbox" id="go">Ruler</div><div role="menuitem">Cut</div></span></div>' +
      '<div role="menu" id="none"><div role="menuitem" aria-disabled="true">Nothing</div></div>';
    const menu = document.getElementById('m');
    const none = document.getElementById('none');
    if (menu === null || none === null) throw new Error('the popups are drawn');
    expect(firstItem(menu)?.id).toBe('go');
    expect(firstItem(none)).toBeNull();
  });
});
