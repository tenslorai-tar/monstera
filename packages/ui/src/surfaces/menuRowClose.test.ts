// @vitest-environment happy-dom
import type { Menu } from '@base-ui/react/menu';
import { describe, expect, it } from 'vitest';

import { GIVES_FOCUS_BACK, cancelsAnotherMenu } from './menuRowClose.js';

/** A close as Base UI reports it: a reason, the native event behind it, and the closing menu's title. */
function close(reason: Menu.Root.ChangeEventReason, target: Element, trigger: Element): Menu.Root.ChangeEventDetails {
  const event = new MouseEvent('mouseup', { bubbles: true });
  target.dispatchEvent(event);
  const details = { reason, event, trigger, isCanceled: false, isPropagationAllowed: false, cancel: () => undefined, allowPropagation: () => undefined };
  return details as unknown as Menu.Root.ChangeEventDetails;
}

/** A row: two titles, an open menu with one item, and a stretch of page outside them. */
function row(): { file: Element; edit: Element; item: Element; page: Element } {
  document.body.innerHTML =
    '<div role="menubar"><button id="file"><span id="file-name">File</span></button><button id="edit">Edit</button></div>' +
    '<div role="menu"><div role="menuitem" id="item">Open</div></div><main id="page"></main>';
  const at = (id: string): Element => {
    const element = document.getElementById(id);
    if (element === null) throw new Error(`the row draws #${id}`);
    return element;
  };
  return { file: at('file'), edit: at('edit'), item: at('item'), page: at('page') };
}

describe('a cancel-open raised for another menu of the row (menuRowClose.ts)', () => {
  it('is REFUSED for a release on the closing menu’s own title, or a part of it, or inside an open menu', () => {
    const { file, item } = row();
    const name = document.getElementById('file-name');
    if (name === null) throw new Error('the title draws its name');
    expect(cancelsAnotherMenu(close('cancel-open', file, file))).toBe(true);
    expect(cancelsAnotherMenu(close('cancel-open', name, file))).toBe(true);
    expect(cancelsAnotherMenu(close('cancel-open', item, file))).toBe(true);
  });

  it('CONTROL: a release outside the closing menu’s title and every menu is a real cancel, and is let through', () => {
    const { file, edit, page } = row();
    // On ANOTHER title: Base UI's own listener for File would cancel here, and so does this.
    expect(cancelsAnotherMenu(close('cancel-open', edit, file))).toBe(false);
    expect(cancelsAnotherMenu(close('cancel-open', page, file))).toBe(false);
  });

  it('CONTROL: only a cancel-open is ever refused — every other reason closes, wherever the event landed', () => {
    const { file } = row();
    const others = (Object.keys(GIVES_FOCUS_BACK) as Menu.Root.ChangeEventReason[]).filter((reason) => reason !== 'cancel-open');
    expect(others.length).toBe(12);
    for (const reason of others) expect(cancelsAnotherMenu(close(reason, file, file)), reason).toBe(false);
  });
});

describe('which closes give the focus back (menuRowClose.ts)', () => {
  it('only a close that ENDS the bar’s use gives it back; going elsewhere leaves the focus there', () => {
    const back = (Object.keys(GIVES_FOCUS_BACK) as Menu.Root.ChangeEventReason[]).filter((reason) => GIVES_FOCUS_BACK[reason]).sort();
    expect(back).toStrictEqual(['cancel-open', 'close-press', 'escape-key', 'imperative-action', 'item-press', 'none', 'trigger-press']);
    // THE ONE THAT CLOSED THE NEXT MENU: a menu closed because a sibling opened must leave the focus with the sibling.
    expect(GIVES_FOCUS_BACK['sibling-open']).toBe(false);
  });
});
