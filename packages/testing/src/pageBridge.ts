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
