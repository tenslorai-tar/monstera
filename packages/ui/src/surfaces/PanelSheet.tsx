import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';

import type { PanelSide } from '../panelPresence.js';

/**
 * A side panel drawn as a sheet over the page's edge, because the row had no room for it beside the page
 * ([ADR-0146](../../../../docs/DECISIONS/0146-a-narrow-window-keeps-the-page-and-folds-the-chrome.md) Decision 3).
 *
 * ## Drawn from inside the handle, so its place needs no number
 *
 * The sheet is positioned against the reopen handle it opens from, at the handle's inner edge and the row's full
 * height: the left panel's to the handle's right, the right panel's to its left. A sheet placed against the row instead
 * would have to know the handle's width.
 *
 * ## It takes the focus, and gives it back
 *
 * A keyboard user who opened it is put inside it, and Escape closes it, leaving the focus on what held it before —
 * the handle, when that is what opened it. It is not modal: the page under it stays usable, and the sheet stays until
 * it is closed, as a pinned panel does.
 */
export function PanelSheet({
  side,
  width,
  onDismiss,
  children,
}: {
  readonly side: PanelSide;
  /** CSS pixels: the panel's own minimum, the width it is built to hold its content at. */
  readonly width: number;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}): ReactElement {
  const sheet = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (element === null) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // ITS FIRST CONTROL IN THE TAB ORDER — a panel's chosen tab, since its other tabs take -1 — or the sheet itself.
    const first = [...element.querySelectorAll<HTMLElement>('*')].find(
      (candidate) => candidate.tabIndex >= 0 && !candidate.matches(':disabled'),
    );
    (first ?? element).focus();
    return (): void => {
      // ONLY A FOCUS THE SHEET HELD is given back: a person who has moved on to the page keeps where they are.
      if (element.contains(document.activeElement)) before?.focus();
    };
  }, []);

  // ESCAPE, AS IT BUBBLES OUT OF THE PANEL'S OWN CONTROLS, and no further: it closes the sheet rather than reaching
  // Focus mode's Escape behind it. A listener on the element, because the keys are the controls' and the sheet is not
  // a control of its own.
  useLayoutEffect(() => {
    const element = sheet.current;
    if (element === null) return undefined;
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onDismiss();
    };
    element.addEventListener('keydown', key);
    return (): void => {
      element.removeEventListener('keydown', key);
    };
  }, [onDismiss]);

  return (
    <div
      className={`m-panel-sheet m-panel-sheet--${side}`}
      data-panel-sheet={side}
      ref={sheet}
      style={{ inlineSize: width }}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
