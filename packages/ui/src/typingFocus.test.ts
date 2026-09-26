// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { type TypingFocus, createTypingFocus } from './typingFocus.js';

const inMenus = (element: Element): boolean => element.closest('.m-menu-bar') !== null;

function mount(): { readonly field: HTMLInputElement; readonly trigger: HTMLButtonElement; readonly other: HTMLButtonElement } {
  const field = document.createElement('input');
  field.type = 'text';
  const bar = document.createElement('div');
  bar.className = 'm-menu-bar';
  const trigger = document.createElement('button');
  bar.append(trigger);
  const other = document.createElement('button');
  document.body.append(field, bar, other);
  return { field, trigger, other };
}

let tracker: TypingFocus | undefined;
function started(): TypingFocus {
  tracker = createTypingFocus(inMenus);
  tracker.start(document);
  return tracker;
}

afterEach(() => {
  tracker?.stop();
  document.body.replaceChildren();
});

describe('createTypingFocus', () => {
  it('KEEPS the field while the focus moves into the menu bar — the whole reason it exists', () => {
    const { field, trigger } = mount();
    const focus = started();
    field.focus();
    trigger.focus();
    // `document.activeElement` is the trigger now, which is what a menu item would see without this.
    expect(document.activeElement).toBe(trigger);
    expect(focus.field()).toBe(field);
  });

  it('CONTROL: FORGETS it when the focus goes somewhere that is neither a field nor the menu bar', () => {
    const { field, other } = mount();
    const focus = started();
    field.focus();
    other.focus();
    expect(focus.field()).toBeUndefined();
  });

  it('FORGETS it when the focus leaves for nothing — a press on the page, which focuses no element', () => {
    const { field } = mount();
    const focus = started();
    field.focus();
    field.blur();
    expect(focus.field()).toBeUndefined();
  });

  it('answers nothing for a field that has left the document', () => {
    const { field, trigger } = mount();
    const focus = started();
    field.focus();
    trigger.focus();
    field.remove();
    expect(focus.field()).toBeUndefined();
  });

  it('a BUTTON is not a field: focusing one first leaves nothing to act on', () => {
    const { other } = mount();
    const focus = started();
    other.focus();
    expect(focus.field()).toBeUndefined();
  });

  it('STOPPED, it hears nothing and forgets what it had', () => {
    const { field, trigger } = mount();
    const focus = started();
    field.focus();
    trigger.focus();
    focus.stop();
    expect(focus.field()).toBeUndefined();
    field.focus();
    expect(focus.field()).toBeUndefined();
  });
});
