import { AI_SETUP_AT_START_SETTING_ID, BRIDGE_KEY, type EventId, type EventPayload, type MonsteraBridge, checkEvent } from '@monstera/contract';
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
  /** `bridge`'s observer, passed through: what the page asked main, for a case about what it sent. */
  observe?: (channel: string, params: unknown) => void,
): Promise<void> {
  await page.emulateMedia({ contrast: look.contrast, reducedMotion: 'reduce' });
  await bridge(page, { ...options, settings: { ...options.settings, 'appearance.theme': look.theme } }, observe);
}

/**
 * @param observe told every channel call the page makes, BEFORE the shim answers it — for a case whose
 *   question is what the renderer SENT (a stamp's author, a command's pages), which no screen shows.
 *   It observes and never answers, so a case cannot use it to stand in for the shim.
 */
export async function bridge(
  page: Page,
  options: Parameters<typeof createBrowserShim>[0] = {},
  observe?: (channel: string, params: unknown) => void,
): Promise<void> {
  // THE PAGE'S OWN EDITS, standing in for main's `webContents[action]()`: they act on whatever has
  // focus or is selected in the page when the channel is called, never on a string the renderer sent.
  // A field is edited through `setRangeText`, anything else through the selection's range — the
  // two standard ways a page changes text, since `execCommand` is deprecated.
  const shim = createBrowserShim({
    edit: (action) =>
      page.evaluate(async (verb) => {
        const focused = document.activeElement;
        const field = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused : null;
        const selection = document.getSelection();
        const selected = (): string =>
          field === null ? (selection?.toString() ?? '') : field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0);
        const replace = (text: string): void => {
          if (field !== null) {
            field.setRangeText(text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
            field.dispatchEvent(new Event('input', { bubbles: true }));
            return;
          }
          const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
          range?.deleteContents();
          if (text !== '') range?.insertNode(document.createTextNode(text));
        };
        // A COPY OR CUT IS FIRST AN EVENT, as main's `webContents.copy()` and `cut()` run the editing command, which fires
        // `copy` or `cut` where the selection starts: a listener that cancels it and sets its own text is what goes on the
        // clipboard (the editor's words, a page selection's lines read with their spaces), and only an unanswered one
        // copies the platform's text of the selection.
        const answered = (kind: 'copy' | 'cut'): string | undefined => {
          const start = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).startContainer : null;
          const target = field ?? (start instanceof Element ? start : (start?.parentElement ?? null)) ?? focused ?? document.body;
          const event = new ClipboardEvent(kind, { clipboardData: new DataTransfer(), bubbles: true, cancelable: true, composed: true });
          target.dispatchEvent(event);
          return event.defaultPrevented ? (event.clipboardData?.getData('text/plain') ?? '') : undefined;
        };
        if (verb === 'copy') await navigator.clipboard.writeText(answered('copy') ?? selected());
        if (verb === 'cut') {
          const text = answered('cut');
          await navigator.clipboard.writeText(text ?? selected());
          if (text === undefined) replace('');
        }
        if (verb === 'paste') replace(await navigator.clipboard.readText());
        if (verb === 'selectAll') {
          if (field !== null) field.select();
          else selection?.selectAllChildren(document.body);
        }
      }, action),
    ...options,
    // A MACHINE WHOSE FIRST RUN IS ANSWERED, unless a case says otherwise. A fresh shim has no AI
    // key, so the first-run AI setup (E5) opens a modal over every screen these cases drive;
    // `false` is what a Skip stores. The first run itself is its own case in `renderedScreen.pw.ts`,
    // which seeds `true`. The id is the contract's, which the setting and the Electron canvas harness
    // take too — one spelling, so no harness can start on the first run by a rename it did not see.
    settings: { [AI_SETUP_AT_START_SETTING_ID]: false, ...options.settings },
  });

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
    observe?.(channel, params);
    return handler(params);
  });

  await page.addInitScript((key: string) => {
    // THE WHOLE BRIDGE, typed as the preload's, so a member the product's bridge gains is a
    // compile error here rather than a page that crashes on its first use of it. This held
    // `invoke` alone until 2026-09-19, while the preload has carried `subscribe` since
    // ADR-0082; nothing subscribed at mount until the close path did, and every Playwright
    // case then failed on a renderer that could not start. `main` pushes nothing to a page
    // served by the shim, so a subscription receives only what a case pushes through
    // {@link pushEvent} — an answer streamed in, which no shim answer can stand for — and
    // the payload is validated on arrival by `subscribeToEvent`, as `main`'s is.
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    Object.defineProperty(window, '__monsteraPush', {
      value: (channel: string, payload: unknown) => {
        for (const listener of listeners.get(channel) ?? []) listener(payload);
      },
    });
    const shape: MonsteraBridge = {
      invoke: (channel: string, params: unknown) =>
        (
          window as unknown as {
            __monsteraInvoke: (c: string, p: unknown) => Promise<unknown>;
          }
        ).__monsteraInvoke(channel, params),
      subscribe: (channel, listener) => {
        const own = listeners.get(channel) ?? new Set<(payload: unknown) => void>();
        listeners.set(channel, own);
        own.add(listener);
        return () => {
          own.delete(listener);
        };
      },
      // A DROP OPENS WHAT A PICK OPENS HERE. The shim holds no files and no paths, and
      // main's dropped handler ends in the same `openPath` as the picker's, so the page
      // is served the shim's `document.open` answer — the same envelope shape.
      openDropped: () =>
        (
          window as unknown as {
            __monsteraInvoke: (c: string, p: unknown) => Promise<unknown>;
          }
        ).__monsteraInvoke('document.open', {}),
    };
    Object.defineProperty(window, key, { value: shape });
  }, BRIDGE_KEY);
}

/**
 * Pushes one declared event into a bridged page, as `main` pushes one: for a streamed answer, which the shim cannot
 * stand for because `ai.ask` only starts one. Checked against the event registry first (`checkEvent`), so a case
 * cannot push a payload `main` could never send.
 */
export async function pushEvent<K extends EventId>(page: Page, id: K, payload: EventPayload<K>): Promise<void> {
  const checked = checkEvent(id, payload);
  await page.evaluate(
    ([channel, sent]) => {
      (window as unknown as { __monsteraPush: (c: string, p: unknown) => void }).__monsteraPush(channel, sent);
    },
    [id, checked] as const,
  );
}
