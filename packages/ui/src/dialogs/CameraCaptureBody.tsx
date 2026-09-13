import { useLingui } from '@lingui/react';
import { MAX_IMPORT_IMAGES, MAX_IMPORT_IMAGE_BYTES } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  CAMERA_CAPTURE_ABSENT,
  CAMERA_CAPTURE_COUNT,
  CAMERA_CAPTURE_DENIED,
  CAMERA_CAPTURE_DONE,
  CAMERA_CAPTURE_FAILED,
  CAMERA_CAPTURE_FULL,
  CAMERA_CAPTURE_PREVIEW,
  CAMERA_CAPTURE_STARTING,
  CAMERA_CAPTURE_TAKE,
} from '../messages/en.js';
import { Button } from '../primitives/Button.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { CameraCaptureAnswer } from './cameraCapture.js';

/** Where the camera is, as the person is told. `live` is the only state that can take a picture. */
type CameraState = 'starting' | 'live' | 'denied' | 'absent' | 'failed';

/** Each state's sentence, or `null` for the one that shows a picture instead. */
const STATE_SENTENCES: Readonly<Record<CameraState, MessageKey | null>> = {
  starting: CAMERA_CAPTURE_STARTING,
  live: null,
  denied: CAMERA_CAPTURE_DENIED,
  absent: CAMERA_CAPTURE_ABSENT,
  failed: CAMERA_CAPTURE_FAILED,
};

/** JPEG at this quality: a page of text stays legible, and a frame stays well under its bound. */
const JPEG_QUALITY = 0.92;

/**
 * Why `getUserMedia` refused, as one of the states a person can act on.
 *
 * By the `DOMException` NAME the Media Capture specification defines: `NotAllowedError`
 * for a refusal by the person or the operating system, `NotFoundError` for no camera.
 * Anything else — a camera another app holds reads as `NotReadableError` — is `failed`.
 */
function refusedAs(error: unknown): CameraState {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'denied';
  if (name === 'NotFoundError') return 'absent';
  return 'failed';
}

/**
 * The platform's media devices, or `undefined` where it offers none.
 *
 * TYPED WIDER THAN THE DOM LIBRARY, which declares `navigator.mediaDevices` always present.
 * The Media Capture specification exposes it only in a secure context, and happy-dom does
 * not expose it at all — which the body's own no-camera case runs against. Stating the
 * real type once is what lets the absent case be checked rather than assumed away.
 */
function cameraDevices(): MediaDevices | undefined {
  const devices: MediaDevices | undefined = navigator.mediaDevices;
  return devices;
}

/** Stops every track, which is what turns the camera — and its light — off. */
function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * One frame of the preview, as JPEG bytes, or `null` where the platform draws none.
 *
 * NOT EXECUTED BY ANY TEST: happy-dom has neither a camera nor a 2D canvas. It is the
 * platform's own encoder on the platform's own frame, and the row owes one live capture.
 */
async function jpegOf(video: HTMLVideoElement): Promise<Uint8Array | null> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (context === null || canvas.width === 0 || canvas.height === 0) return null;
  context.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });
  return blob === null ? null : new Uint8Array(await blob.arrayBuffer());
}

/**
 * Pictures taken with the camera, one page each.
 *
 * ## The camera is ON only while this dialog is open
 *
 * The stream opens when the body mounts and every track stops when it unmounts —
 * including a stream that arrives after the person already closed the dialog, which
 * would otherwise leave the camera light on behind a closed window.
 *
 * ## The answer is bounded here as the channel bounds it
 *
 * A picture that would take the set past `MAX_IMPORT_IMAGE_BYTES` or `MAX_IMPORT_IMAGES`
 * is not added, and the person is told, so *Make PDF* never answers what the channel's
 * schema refuses.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function CameraCaptureBody({ resolve }: DialogAnswering<CameraCaptureAnswer>): ReactElement {
  const { _ } = useLingui();
  const video = useRef<HTMLVideoElement>(null);
  // DECIDED BEFORE THE EFFECT, so a platform with no media devices renders its sentence
  // on the first paint rather than through a state set inside the effect.
  const [state, setState] = useState<CameraState>(() =>
    cameraDevices() === undefined ? 'absent' : 'starting',
  );
  const [frames, setFrames] = useState<readonly Uint8Array[]>([]);
  const [full, setFull] = useState(false);

  useEffect(() => {
    // THE PLATFORM IS ASKED, not `state`: the effect opens the camera once per mount, and
    // a dependency on the state it sets would close the stream it had just opened.
    const devices = cameraDevices();
    if (devices === undefined) return undefined;
    let closed = false;
    let opened: MediaStream | null = null;
    devices.getUserMedia({ video: true, audio: false }).then(
      (stream) => {
        if (closed) {
          stopAll(stream);
          return;
        }
        opened = stream;
        if (video.current !== null) video.current.srcObject = stream;
        setState('live');
      },
      (error: unknown) => {
        if (!closed) setState(refusedAs(error));
      },
    );
    return () => {
      closed = true;
      if (opened !== null) stopAll(opened);
    };
  }, []);

  const sentence = STATE_SENTENCES[state];
  const total = frames.reduce((sum, frame) => sum + frame.byteLength, 0);

  return (
    <div className="m-camera-capture">
      <video
        aria-label={_(CAMERA_CAPTURE_PREVIEW)}
        autoPlay
        className="m-camera-capture__preview"
        data-camera-preview=""
        hidden={state !== 'live'}
        muted
        playsInline
        ref={video}
      />
      <p className="m-camera-capture__status" role="status">
        {sentence === null ? '' : _(sentence)}
      </p>
      <p className="m-camera-capture__count">{_(CAMERA_CAPTURE_COUNT, { count: frames.length })}</p>
      <p className="m-camera-capture__problem" role="status">
        {full ? _(CAMERA_CAPTURE_FULL) : ''}
      </p>
      <Button
        disabled={state !== 'live' || full}
        label={CAMERA_CAPTURE_TAKE}
        onClick={() => {
          const element = video.current;
          if (element === null) return;
          void jpegOf(element).then((frame) => {
            if (frame === null) return;
            if (frames.length + 1 > MAX_IMPORT_IMAGES || total + frame.byteLength > MAX_IMPORT_IMAGE_BYTES) {
              setFull(true);
              return;
            }
            setFrames([...frames, frame]);
          });
        }}
      />
      <Button
        disabled={frames.length === 0}
        label={CAMERA_CAPTURE_DONE}
        onClick={() => {
          if (frames.length > 0) resolve({ frames: [...frames] });
        }}
        variant="primary"
      />
    </div>
  );
}
