/** What a second launch needs of the window it brings forward: the four calls, so a case can hand over a stand-in. */
export interface FrontableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}

/**
 * Brings the running window to the front for a second launch.
 *
 * A window that has been destroyed throws on every call that is not `isDestroyed` itself, and the `second-instance`
 * event can arrive between the window's `closed` and the process's quit (CR-SEC-05): the handler already checked the
 * page's contents before sending to them, and these two calls did not. A destroyed window has nothing to bring forward,
 * so this does nothing rather than throw inside an event handler nobody awaits.
 */
export function bringToFront(window: FrontableWindow): void {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}
