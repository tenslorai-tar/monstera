import { BRIDGE_KEY } from '@monstera/contract';
import type { Page } from '@playwright/test';

import { createBrowserShim } from './browserShim.js';

/**
 * Puts the browser shim behind the page's bridge.
 *
 * ## The shim stays in Node, and the page gets a bridge
 *
 * The renderer reads one global — `window.monstera`, a single
 * `invoke(channel, params)` — which the preload defines in the shipped app.
 * Here `exposeFunction` puts a Node function on the page and the init script
 * wraps it in that shape, so the REAL browser shim answers, unmodified, from
 * the process that can import it.
 *
 * That indirection is not a workaround, it is what the package boundary
 * requires: `packages/ui` may not import `@monstera/testing` and `testing` may
 * not import `ui`, so no source file may compose the App with the shim. Nothing
 * needs to — Playwright drives the BUILT renderer, which is the artefact that
 * ships.
 *
 * ## One module, because two Playwright runs drive the renderer
 *
 * §10.4's accessibility gate and §10.7's visual baselines both bridge a page the
 * same way. A copy in each spec is two opinions about how the renderer reaches
 * the shim, and the day one learns a new channel shape the other would answer
 * the old one (B3a).
 *
 * A function each test calls rather than a `beforeEach`, because the SCREEN a
 * test renders depends on what the shim answers — a start screen with a recent
 * list and a recovery offer is a different composed screen from an empty one.
 */
/**
 * The three looks the shell can be in, in ONE place.
 *
 * §10.7's baselines capture each of them and §10.4's gate must check each of them, so a list in
 * each spec is two opinions about what *the themes* are — and they would drift at exactly the
 * moment one gains a fourth (B3a). `name` is what `data-theme` reads once the look is applied,
 * which is what a case asserts before it captures or analyses anything.
 *
 * **`hc` is `dark` plus a platform request, never a setting.** `appearance.ts` reaches the
 * high-contrast theme from `forced-colors: active` or `prefers-contrast: more` and overrides the
 * chosen theme; offering it as a third value of the theme setting would make an assistive mode
 * look like a preference. So the look carries both halves and the helper below applies both.
 */
export const LOOKS = [
  { name: 'light', theme: 'light', contrast: 'no-preference' },
  { name: 'dark', theme: 'dark', contrast: 'no-preference' },
  { name: 'hc', theme: 'dark', contrast: 'more' },
] as const;

/** One of {@link LOOKS}. */
export type Look = (typeof LOOKS)[number];

/**
 * Bridges the page under `look` — the media emulation and the theme setting, together.
 *
 * The two halves have to be applied as a pair: the setting alone gives `light` or `dark` and the
 * media query alone gives a theme the shell has not been told about. A caller that applied one
 * would render a screen no reader ever sees, and the `data-theme` assertion each caller makes
 * after `goto` is what catches that rather than trust.
 *
 * `reducedMotion` is set for every look because a screen mid-transition is a different screen —
 * for a baseline it is a different image, and for axe it is a control that may not have arrived.
 */
export async function bridgeUnder(
  page: Page,
  look: Look,
  options: Parameters<typeof createBrowserShim>[0] = {},
): Promise<void> {
  await page.emulateMedia({ contrast: look.contrast, reducedMotion: 'reduce' });
  await bridge(page, { ...options, settings: { ...options.settings, 'appearance.theme': look.theme } });
}

export async function bridge(
  page: Page,
  options: Parameters<typeof createBrowserShim>[0] = {},
): Promise<void> {
  const shim = createBrowserShim(options);

  // The client is keyed by channel; the bridge is keyed by string. The cast is
  // that one fact and nothing wider — `any` would also erase the parameter and
  // return types, which is what B7 is protecting.
  const client = shim.client as unknown as Record<string, (params: unknown) => Promise<unknown>>;

  await page.exposeFunction('__monsteraInvoke', async (channel: string, params: unknown) => {
    const handler = client[channel];
    if (handler === undefined) {
      // A CHANNEL THE SHIM DOES NOT HAVE IS A DEFECT, not a null answer. The
      // shim is complete by construction — it fails to compile if the registry
      // grows — so reaching this means the page asked for something that is not
      // in the contract at all.
      throw new Error(`the page invoked an unknown channel: ${channel}`);
    }
    return handler(params);
  });

  await page.addInitScript((key: string) => {
    Object.defineProperty(window, key, {
      value: {
        invoke: (channel: string, params: unknown) =>
          (
            window as unknown as {
              __monsteraInvoke: (c: string, p: unknown) => Promise<unknown>;
            }
          ).__monsteraInvoke(channel, params),
      },
    });
  }, BRIDGE_KEY);
}
