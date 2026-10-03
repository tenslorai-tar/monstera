// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import { type PadStroke, SignaturePad } from './SignaturePad.js';

function I18nWrapper({ children }: { readonly children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * The pad while a stroke is being drawn (3a, F-S1).
 *
 * The pad, reporting a fixed on-screen box with a left and top that are not zero, so a point passed through in client
 * pixels reads differently from one in the pad's unit.
 */
function mounted(): { surface: Element; finished: (readonly PadStroke[])[] } {
  const finished: (readonly PadStroke[])[] = [];
  const view = render(
    <I18nWrapper>
      <SignaturePad
        strokes={[]}
        onStrokesChange={(strokes) => {
          finished.push(strokes);
        }}
      />
    </I18nWrapper>,
  );
  const surface = view.container.querySelector('[data-signature-pad]');
  if (surface === null) throw new Error('no signature pad on screen');
  surface.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 300, height: 100, right: 310, bottom: 120, x: 10, y: 20 }) as DOMRect;
  return { surface, finished };
}

describe('SignaturePad', () => {
  it('DRAWS THE STROKE WHILE IT IS BEING DRAWN, before the pointer is released', () => {
    const { surface, finished } = mounted();

    fireEvent.pointerDown(surface, { clientX: 40, clientY: 50 });
    fireEvent.pointerMove(surface, { clientX: 70, clientY: 50 });
    fireEvent.pointerMove(surface, { clientX: 100, clientY: 80 });

    // MID-GESTURE: nothing stored yet, and the line on screen anyway, through the three points in the pad's frame.
    expect(finished).toStrictEqual([]);
    const live = surface.querySelector('[data-signature-live]');
    expect(live?.getAttribute('points')).toBe('30,30 60,30 90,60');
  });

  it('keeps EVERY point of a fast stroke, and stores it on release as it was drawn', () => {
    const { surface, finished } = mounted();

    fireEvent.pointerDown(surface, { clientX: 10, clientY: 20 });
    // A BURST with nothing rendering in between, which is what drops points from a state update per move.
    for (let at = 1; at <= 200; at += 1) fireEvent.pointerMove(surface, { clientX: 10 + at, clientY: 20 + (at % 7) });
    fireEvent.pointerUp(surface);

    expect(finished).toHaveLength(1);
    const [stroke] = finished[0] ?? [];
    expect(stroke).toHaveLength(201);
    // AND THE LIVE LINE IS GONE: the stored stroke is drawn from the strokes the dialog holds.
    expect(surface.querySelector('[data-signature-live]')).toBeNull();
  });
});
