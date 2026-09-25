import { useLingui } from '@lingui/react';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { DROP_OVERLAY } from '../messages/en.js';
import { useOnColor } from '../primitives/useOnColor.js';

export interface DropTargetProps {
  /** The files a drop carried, in the order the drop listed them. Never called with none. */
  readonly onFiles: (files: readonly File[]) => void;
}

/**
 * The whole window as a drop target for files
 * ([ADR-0099](../../../../docs/DECISIONS/0099-a-dropped-file-is-opened-by-the-preload-and-its-path-never-reaches-the-page.md)).
 *
 * ## Files only, so every other drag is left alone
 *
 * A drag whose `DataTransfer` does not list `Files` — text dragged within the page, a mark being moved — is
 * not this component's, and nothing here touches it. For a file drag, `dragover` is cancelled so the drop is
 * allowed, and the drop itself is cancelled so Chromium does not try to navigate to the file, which the
 * navigation guard would refuse anyway.
 *
 * ## A depth count, because a drag reports every element it crosses
 *
 * `dragenter` and `dragleave` fire for each element under the pointer, so the overlay would flicker as a
 * drag crossed the page if it followed them one to one. It shows while the count is above zero. Escape
 * during an operating-system drag cancels the drag, which arrives here as the last `dragleave`; a
 * keydown is honoured too, for a drag the platform lets the page see keys during.
 *
 * ## A picture, hidden from assistive technology
 *
 * The overlay says what a drop will do while one is in progress with a pointer. What the drop does is
 * announced by what it produces — a tab, or the start screen's alert — so the overlay carries no role.
 */
export function DropTarget({ onFiles }: DropTargetProps): ReactElement | null {
  const { _ } = useLingui();
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') === true;
    const enter = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setOver(true);
    };
    const hover = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (event: DragEvent): void => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFiles(files);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || depth === 0) return;
      depth = 0;
      setOver(false);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', hover);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('keydown', escape);
    return (): void => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', hover);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('keydown', escape);
    };
  }, [onFiles]);

  return over ? <DropOverlay label={_(DROP_OVERLAY)} /> : null;
}

/**
 * The overlay itself, its own component so its label's colour is solved when it MOUNTS: `useOnColor` reads
 * the element its ref holds, and a ref on an element that renders later would be read while still empty.
 */
function DropOverlay({ label }: { readonly label: string }): ReactElement {
  const text = useRef<HTMLParagraphElement>(null);
  useOnColor(text, 'color', '--text', ['--accent'], 'text');
  return (
    <div aria-hidden="true" className="m-drop-overlay">
      <p className="m-drop-overlay__label" ref={text}>
        {label}
      </p>
    </div>
  );
}
