// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { DropTarget } from './DropTarget.js';

afterEach(() => {
  cleanup();
});

/**
 * A drag event as Chromium delivers one, with a `DataTransfer` whose `types` and `files` are stated.
 *
 * Built by hand because happy-dom's `DragEvent` carries no `DataTransfer`; the component reads only
 * `types`, `files` and `dropEffect`, so those are what the fake has.
 */
function dragEvent(type: string, types: readonly string[], files: readonly File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
  return event;
}

function fire(event: Event): Event {
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function mounted(): { readonly received: (readonly File[])[]; readonly overlay: () => Element | null } {
  activateCatalogue('en', EN);
  const received: (readonly File[])[] = [];
  function Host(): ReactElement {
    return (
      <I18nProvider i18n={i18n}>
        <DropTarget onFiles={(files) => received.push(files)} />
      </I18nProvider>
    );
  }
  const { container } = render(<Host />);
  return { received, overlay: () => container.querySelector('.m-drop-overlay') };
}

const A = new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' });
const B = new File(['%PDF-1.7'], 'b.pdf', { type: 'application/pdf' });

describe('DropTarget (ADR-0099)', () => {
  it('shows the overlay while FILES are dragged over the window, and says what a drop does', () => {
    const { overlay } = mounted();
    expect(overlay()).toBeNull();

    fire(dragEvent('dragenter', ['Files']));

    expect(overlay()?.textContent).toBe('Drop to open');
  });

  it('hands over the dropped files IN THEIR ORDER, cancels the drop, and hides the overlay', () => {
    const { overlay, received } = mounted();
    fire(dragEvent('dragenter', ['Files']));

    const drop = fire(dragEvent('drop', ['Files'], [B, A]));

    expect(received).toStrictEqual([[B, A]]);
    // CANCELLED, or Chromium would try to navigate to the file.
    expect(drop.defaultPrevented).toBe(true);
    expect(overlay()).toBeNull();
  });

  it('allows the drop by cancelling dragover, for a file drag only', () => {
    mounted();
    expect(fire(dragEvent('dragover', ['Files'])).defaultPrevented).toBe(true);
    // CONTROL: a text drag inside the page is not this component's and is left as the page had it.
    expect(fire(dragEvent('dragover', ['text/plain'])).defaultPrevented).toBe(false);
  });

  it('CONTROL: a drag that carries no files shows nothing and hands over nothing', () => {
    const { overlay, received } = mounted();

    fire(dragEvent('dragenter', ['text/plain']));
    fire(dragEvent('drop', ['text/plain']));

    expect(overlay()).toBeNull();
    expect(received).toStrictEqual([]);
  });

  it('stays up while the drag crosses inner elements, and goes when it leaves the window', () => {
    // A drag reports every element it crosses: enter the window, enter a child, leave the child.
    const { overlay } = mounted();
    fire(dragEvent('dragenter', ['Files']));
    fire(dragEvent('dragenter', ['Files']));
    fire(dragEvent('dragleave', ['Files']));

    expect(overlay()).not.toBeNull();

    fire(dragEvent('dragleave', ['Files']));
    expect(overlay()).toBeNull();
  });

  it('Escape takes the overlay down', () => {
    const { overlay } = mounted();
    fire(dragEvent('dragenter', ['Files']));

    fire(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(overlay()).toBeNull();
  });

  it('a drop with no files in it hands over nothing', () => {
    const { received } = mounted();
    fire(dragEvent('dragenter', ['Files']));
    fire(dragEvent('drop', ['Files'], []));
    expect(received).toStrictEqual([]);
  });
});
