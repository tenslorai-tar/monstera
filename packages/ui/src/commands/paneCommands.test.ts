// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { cyclePane, paneCommands } from './paneCommands.js';

/** Three panes in document order: one with two controls, one with none, one with a field. */
function panes(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = [
    '<button id="outside">Menu</button>',
    '<header data-pane="title-bar"><button id="tab">Tab</button><button id="search">Search</button></header>',
    '<div data-pane="pages" id="pages"><canvas></canvas></div>',
    '<footer data-pane="status-bar"><input id="field" /></footer>',
  ].join('');
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('F6 between panes (item 12)', () => {
  it('moves to the NEXT pane’s first control, wrapping from the last to the first', () => {
    const root = panes();
    document.getElementById('search')?.focus();
    expect(cyclePane(root, 1, document.activeElement)?.dataset['pane']).toBe('pages');
    cyclePane(root, 1, document.activeElement);
    expect(document.activeElement?.id).toBe('field');
    cyclePane(root, 1, document.activeElement);
    expect(document.activeElement?.id).toBe('tab');
  });

  it('Shift+F6 goes BACK, wrapping from the first to the last', () => {
    const root = panes();
    document.getElementById('tab')?.focus();
    cyclePane(root, -1, document.activeElement);
    expect(document.activeElement?.id).toBe('field');
  });

  it('a pane with NO control takes the focus itself, and stays out of the Tab order', () => {
    const root = panes();
    document.getElementById('tab')?.focus();
    cyclePane(root, 1, document.activeElement);
    expect(document.activeElement?.id).toBe('pages');
    expect(document.getElementById('pages')?.getAttribute('tabindex')).toBe('-1');
  });

  it('from OUTSIDE every pane, F6 goes to the first and Shift+F6 to the last', () => {
    const root = panes();
    document.getElementById('outside')?.focus();
    cyclePane(root, 1, document.activeElement);
    expect(document.activeElement?.id).toBe('tab');
    document.getElementById('outside')?.focus();
    cyclePane(root, -1, document.activeElement);
    expect(document.activeElement?.id).toBe('field');
  });

  it('CONTROL: a window with no pane moves nothing, rather than throwing or guessing', () => {
    const root = document.createElement('div');
    expect(cyclePane(root, 1, null)).toBeUndefined();
  });

  it('is two commands on F6 and Shift+F6, so the shortcut map and the palette carry them', () => {
    expect(paneCommands().map((command) => [command.id, command.shortcut])).toStrictEqual([
      ['view.next-pane', 'F6'],
      ['view.previous-pane', 'Shift+F6'],
    ]);
  });
});
