import type { ContractClient } from '@monstera/contract';
import { useEffect } from 'react';

/** What `window.titleBarOverlay` takes: the bar's background, its text colour, and its height in whole pixels. */
export interface TitleBarOverlayRequest {
  readonly color: string;
  readonly symbolColor: string;
  readonly height: number;
}

/** The channel's own bound on the height, stated beside the only caller that has to respect it. */
const HEIGHT = { min: 24, max: 64 } as const;

/**
 * A computed colour as `#rrggbb`, or `undefined` for anything that is not an opaque `rgb()`.
 *
 * `getComputedStyle` answers `rgb(r, g, b)` for an opaque colour and `rgba(…, a)` for a translucent one, whatever
 * the stylesheet spelt. A translucent bar has no single colour for three opaque buttons to match, so it is refused
 * rather than rounded to one.
 */
export function hexOf(computed: string): string | undefined {
  const match = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/u.exec(computed);
  if (match === null) return undefined;
  const [, r, g, b, alpha] = match;
  if (alpha !== undefined && Number(alpha) !== 1) return undefined;
  const channels = [r, g, b].map(Number);
  if (channels.some((channel) => channel > 255)) return undefined;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * What the title bar asks main to paint, read off the bar itself — or `undefined` when it cannot be stated.
 *
 * **Read, never looked up in `tokens.css`.** The bar's colours are resolved against the theme, the user's accent
 * and the platform's contrast state, and the computed style is the one place all three have already been applied.
 */
export function overlayOf(bar: Element): TitleBarOverlayRequest | undefined {
  const style = getComputedStyle(bar);
  const color = hexOf(style.backgroundColor);
  const symbolColor = hexOf(style.color);
  const height = Math.round(bar.getBoundingClientRect().height);
  if (color === undefined || symbolColor === undefined) return undefined;
  if (height < HEIGHT.min || height > HEIGHT.max) return undefined;
  return { color, symbolColor, height };
}

/**
 * Keeps the window's controls painted like the title bar they sit over (§10.3's Window Controls Overlay).
 *
 * ## When it asks
 *
 * On mount, when the root's attributes change — which is how the theme, the accent and high contrast are applied
 * (`applyAppearance`, `applyAccent`) — and when the bar changes size. It sends only a request that differs from the
 * last one it sent, so a re-render that changed nothing crosses nothing.
 *
 * ## The answer is not needed, and a refusal is not a fault
 *
 * `applied: false` is a shell with no window attached. A REJECTED call is a window whose shell registered no
 * handlers at all — `rendererHarness.ts` creates exactly that — and the title bar is correct either way; only the
 * three buttons beside it keep the system's colours. So the promise's outcome is dropped deliberately.
 */
export function useWindowControlsOverlay(client: ContractClient): void {
  useEffect(() => {
    const bar = document.querySelector('.m-title-bar');
    if (bar === null) return undefined;
    let sent = '';
    const report = (): void => {
      const overlay = overlayOf(bar);
      if (overlay === undefined) return;
      const key = `${overlay.color}${overlay.symbolColor}${String(overlay.height)}`;
      if (key === sent) return;
      sent = key;
      // DROPPED ON PURPOSE — see the header: no answer changes what the renderer draws.
      client['window.titleBarOverlay'](overlay).then(
        () => undefined,
        () => undefined,
      );
    };
    report();
    const attributes = new MutationObserver(report);
    attributes.observe(document.documentElement, { attributes: true });
    const size = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(report);
    size?.observe(bar);
    return (): void => {
      attributes.disconnect();
      size?.disconnect();
    };
  }, [client]);
}
