// @vitest-environment happy-dom
import { I18nProvider } from '@lingui/react';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { activateCatalogue, i18n } from '../i18n.js';
import { EN } from '../messages/en.js';
import CameraCaptureBody from './CameraCaptureBody.js';

/**
 * The capture dialog's body, against a stubbed camera.
 *
 * ## What this can and cannot reach
 *
 * happy-dom has no camera and no 2D canvas, so taking a picture is NOT executed here —
 * the row owes a live capture. What IS asserted is everything around it that a person
 * can be hurt by: which sentence a refused camera shows, and that the camera is turned
 * OFF when the dialog closes, including a stream that arrives after it closed.
 */

function Wrapped({ children }: { children: ReactNode }): ReactElement {
  activateCatalogue('en', EN);
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

/**
 * A REAL `MediaStream`, whose one track records being stopped.
 *
 * The window's own class, and not an object shaped like one: happy-dom's `srcObject`
 * setter refuses anything that is not an instance, exactly as a browser does, so a
 * look-alike failed at the setter and made this case about the fixture. Only `getTracks`
 * is replaced, because counting a stop is the one thing the class cannot do.
 */
function stream(): { readonly stream: MediaStream; readonly stopped: () => number } {
  let stops = 0;
  const track = {
    stop: () => {
      stops += 1;
    },
  } as unknown as MediaStreamTrack;
  const media = new MediaStream();
  media.getTracks = () => [track];
  return { stream: media, stopped: () => stops };
}

/** Installs a camera answering `getUserMedia` with `answer`. */
function camera(answer: () => Promise<MediaStream>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: answer },
  });
}

function opened(): { readonly unmount: () => void } {
  const { unmount } = render(
    <Wrapped>
      <CameraCaptureBody resolve={() => undefined} />
    </Wrapped>,
  );
  return { unmount };
}

const TAKE = (): HTMLElement => screen.getByRole('button', { name: 'Take picture' });

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

describe('CameraCaptureBody', () => {
  it('says there is no camera where the platform has none, and CANNOT take a picture', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    opened();
    expect(screen.getByText('No camera was found.')).toBeTruthy();
    expect(TAKE()).toHaveProperty('disabled', true);
  });

  it('names a REFUSED camera and a MISSING one apart, by the error the platform raises', async () => {
    for (const [name, sentence] of [
      ['NotAllowedError', 'This app is not allowed to use the camera.'],
      ['NotFoundError', 'No camera was found.'],
      ['NotReadableError', 'The camera could not be started. Another app may be using it.'],
    ] as const) {
      camera(() => Promise.reject(new DOMException('refused for the case', name)));
      opened();
      await act(async () => {
        await Promise.resolve();
      });
      // THE CAMERA'S OWN STATUS LINE, by its class: the body has two status regions, and the
      // other one speaks only when the set is full.
      expect(document.querySelector('.m-camera-capture__status')?.textContent ?? '', name).toContain(sentence);
      expect(TAKE()).toHaveProperty('disabled', true);
      cleanup();
    }
  });

  it('turns the camera ON only while open: a live stream is stopped when the dialog closes', async () => {
    const live = stream();
    camera(() => Promise.resolve(live.stream));
    const { unmount } = opened();
    await act(async () => {
      await Promise.resolve();
    });
    expect(TAKE()).toHaveProperty('disabled', false);
    expect(live.stopped()).toBe(0);

    unmount();

    expect(live.stopped()).toBe(1);
  });

  it('stops a stream that arrives AFTER the dialog closed, rather than leaving the camera on', async () => {
    // THE DECISION IS THE STOP: a body that only stopped the stream it held when it closed
    // holds none here, and the camera light would stay on behind a closed dialog.
    const late = stream();
    let arrive: (value: MediaStream) => void = () => undefined;
    camera(
      () =>
        new Promise<MediaStream>((resolve) => {
          arrive = resolve;
        }),
    );
    const { unmount } = opened();
    unmount();

    await act(async () => {
      arrive(late.stream);
      await Promise.resolve();
    });

    expect(late.stopped()).toBe(1);
  });
});
