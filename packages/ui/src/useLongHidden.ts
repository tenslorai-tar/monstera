import { useEffect, useState } from 'react';

/**
 * How long the window may be hidden (minimised, or covered on a platform that reports it) before the page area gives its
 * pixels back: the owner's run 4 item 13d, after PDF-XChange's documented *"about 30 s after the window is minimised"*.
 * NOT MEASURED HERE: the figure is the reference application's, not a reading of this one.
 */
export const HIDDEN_RELEASE_MS = 30_000;

/**
 * Whether the window has been hidden for `after` ms or longer, by the page's own `visibilitychange`: Chromium reports a
 * minimised Electron window as `hidden`. `false` again the moment it is shown, so the pages it gave back are drawn
 * before anybody can see them missing.
 */
export function useLongHidden(after: number = HIDDEN_RELEASE_MS): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(() => {
          setLong(true);
        }, after);
      } else {
        setLong(false);
      }
    };
    // A WINDOW ALREADY HIDDEN when this mounts starts its wait now; a shown one has nothing to wait for.
    if (document.visibilityState === 'hidden') {
      timer = setTimeout(() => {
        setLong(true);
      }, after);
    }
    document.addEventListener('visibilitychange', changed);
    return (): void => {
      document.removeEventListener('visibilitychange', changed);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [after]);
  return long;
}
