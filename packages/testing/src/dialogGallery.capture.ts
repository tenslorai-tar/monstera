import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Page, expect, test } from '@playwright/test';

import { readLongFields } from './longFields.js';
import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';
import { settled } from './settled.js';

/**
 * EVERY REGISTERED DIALOG IN EVERY SAMPLE STATE, photographed in each look for review by eye (`gallery.html`).
 *
 * Not a test, run by hand: `npx vite build --config scripts/build/gallery.vite.config.mjs`, then
 * `npx playwright test --config scripts/test/gallery.config.mjs`. Images and `report.json` go to `CAPTURE_OUT`,
 * which is never committed.
 *
 * THE LIST IS THE REGISTRY'S. The gallery publishes the ids `APPLICATION_DIALOGS` registers and the states each has,
 * and this refuses to capture while any id has no state or any state names an unregistered id. A list derived from
 * the registry agrees with any dialog that stops being registered, so three ids KNOWN to be registered are required
 * as a positive control: an index that read nothing would otherwise capture nothing and say so cleanly.
 *
 * WHAT IS READ, beside the image, is what review by eye must not have to measure: whether the footer is inside the
 * window, whether anything in the dialog scrolls sideways, whether the dialog is taller than the window, and whether
 * a refusal (`role="alert"`) is showing in a state reached by no step — a warning before the person has done anything.
 *
 * AND EVERY FIELD HOLDING A LONG VALUE against its row's width (ADR-0157, `longFields.ts`), which is refused rather
 * than only reported: it is the class by its symptom, so a field missing its `runsLong` is found by its value. At least
 * one such field must have been seen in the look, or an empty list would be a gallery whose samples hold no long value.
 */

const OUT = process.env['CAPTURE_OUT'] ?? join('capture', 'dialogs');
const SIZES = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '760x560', width: 760, height: 560 },
] as const;
const KNOWN = ['dialog.print', 'dialog.donate', 'dialog.settings'];

interface GalleryIndex {
  readonly registered: readonly string[];
  readonly states: Readonly<Record<string, readonly string[]>>;
  readonly unsampled: readonly string[];
  readonly unregistered: readonly string[];
  readonly steps: Readonly<Record<string, readonly Step[]>>;
}

type Step =
  | { readonly kind: 'type'; readonly field: string; readonly text: string }
  | { readonly kind: 'click'; readonly name: string; readonly role: Parameters<Page['getByRole']>[0] };

interface Reading {
  readonly look: string;
  readonly size: string;
  readonly id: string;
  readonly state: string;
  readonly file: string;
  readonly problem: string | null;
  readonly dialog: { width: number; height: number } | null;
  readonly footerInView: boolean | null;
  readonly sideways: readonly string[];
  readonly tallerThanWindow: boolean;
  readonly alertWithoutSteps: boolean;
  /** Fields holding a long value drawn narrower than their row (ADR-0157). */
  readonly longShort: readonly string[];
}

async function indexOf(page: Page, look: Look): Promise<GalleryIndex> {
  await bridgeUnder(page, look);
  await page.goto('/gallery.html');
  return page.evaluate(() => (window as unknown as { __dialogGallery: GalleryIndex }).__dialogGallery);
}

for (const look of LOOKS) {
  test(`${look.name}: every registered dialog, in every sample state`, async ({ context }) => {
    test.setTimeout(3_600_000);
    const index = await indexOf(await context.newPage(), look);
    for (const id of KNOWN) expect(index.registered, `the positive control ${id}`).toContain(id);
    expect(index.unregistered, 'sample states for ids nothing registers').toStrictEqual([]);
    // `GALLERY_ONLY` captures the named ids alone, for a fix being looked at; it is the one run that may leave
    // dialogs out, and it says how many it left.
    const only = process.env['GALLERY_ONLY']?.split(',').filter((id) => id !== '');
    if (only === undefined) expect(index.unsampled, 'registered dialogs with no sample state').toStrictEqual([]);
    else console.log(`GALLERY_ONLY: ${String(only.length)} of ${String(index.registered.length)} dialogs; ${String(index.unsampled.length)} have no sample`);

    const readings: Reading[] = [];
    let longSeen = 0;
    for (const size of SIZES) {
      for (const id of index.registered.filter((one) => only === undefined || only.includes(one))) {
        for (const state of index.states[id] ?? []) {
          // A PAGE PER STATE: the bridge is installed once per page, and a state must not inherit another's.
          const page = await context.newPage();
          await page.setViewportSize({ width: size.width, height: size.height });
          await bridgeUnder(page, look);
          await page.goto(`/gallery.html?dialog=${encodeURIComponent(id)}&state=${encodeURIComponent(state)}`);
          await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
          const problem = await page.locator('body').getAttribute('data-gallery-problem');
          const dialog = page.getByRole('dialog').last();
          const steps = index.steps[`${id}|${state}`] ?? [];
          if (problem === null) {
            await expect(dialog).toBeVisible();
            for (const step of steps) {
              if (step.kind === 'type') await dialog.getByLabel(step.field, { exact: true }).first().fill(step.text);
              else await dialog.getByRole(step.role, { name: step.name, exact: true }).first().click();
            }
            await page.mouse.move(2, 2);
            // THE BODY ARRIVED AND STOPPED MOVING: a registered body is lazy, so the title alone is a dialog with an
            // empty body, and a capture taken then is of a box still growing (hc-dialog-donate on CI, 214 × 92).
            await settled(
              page,
              () =>
                dialog.evaluate((element) => {
                  const box = element.getBoundingClientRect();
                  return { width: Math.round(box.width), height: Math.round(box.height), children: element.querySelectorAll('*').length };
                }),
              (now) => now.children > 3,
              `${id} ${state}`,
            );
            await page.evaluate(() => document.fonts.ready.then(() => undefined));
          }
          const measured = problem !== null
            ? null
            : await dialog.evaluate((element) => {
                const box = element.getBoundingClientRect();
                // THE FOOTER, or where a body draws its own, its last button: either is what a person must reach.
                const buttons = element.querySelectorAll('button');
                const footer = element.querySelector('.m-dialog-footer') ?? buttons[buttons.length - 1] ?? null;
                const footerBox = footer?.getBoundingClientRect();
                const sideways: string[] = [];
                for (const node of [element, ...element.querySelectorAll<HTMLElement>('*')]) {
                  const style = getComputedStyle(node);
                  if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1) {
                    sideways.push(`${node.tagName.toLowerCase()}.${[...node.classList].join('.')} ${String(node.scrollWidth)}>${String(node.clientWidth)}`);
                  }
                }
                // SHOWN, not merely inside the window: a footer the body has scrolled away is clipped by the body and
                // the popup while its box still lies within the window, so the window alone read it as in view. The
                // part shown is the window cut by every clipping box from the footer up to the dialog.
                let shown = { top: 0, bottom: window.innerHeight };
                for (let at = footer?.parentElement ?? null; at !== null; at = at.parentElement) {
                  if (getComputedStyle(at).overflowY !== 'visible') {
                    const clip = at.getBoundingClientRect();
                    shown = { top: Math.max(shown.top, clip.top), bottom: Math.min(shown.bottom, clip.bottom) };
                  }
                  if (at === element) break;
                }
                return {
                  dialog: { width: Math.round(box.width), height: Math.round(box.height) },
                  footerInView:
                    footerBox === undefined ? null : footerBox.bottom <= shown.bottom + 1 && footerBox.top >= shown.top - 1,
                  sideways,
                  tallerThanWindow: box.height > window.innerHeight,
                  // A REFUSAL ON SCREEN, by either role a body speaks it through: an alert, or a status line with words
                  // in it. Alerts alone missed Watermark's *"A watermark needs some text"*, which is a status line.
                  alert:
                    element.querySelector('[role="alert"]') !== null ||
                    [...element.querySelectorAll('[role="status"]')].some((status) => status.textContent.trim() !== ''),
                };
              });
          const long = problem !== null ? { seen: 0, short: [] } : await dialog.evaluate(readLongFields);
          longSeen += long.seen;
          const folder = join(OUT, look.name, size.name);
          mkdirSync(folder, { recursive: true });
          const file = join(folder, `${id.replace(/^dialog\./u, '')}--${state}.png`);
          await page.screenshot({ path: file });
          readings.push({
            look: look.name,
            size: size.name,
            id,
            state,
            file,
            problem,
            dialog: measured?.dialog ?? null,
            footerInView: measured?.footerInView ?? null,
            sideways: measured?.sideways ?? [],
            tallerThanWindow: measured?.tallerThanWindow ?? false,
            alertWithoutSteps: steps.length === 0 && (measured?.alert ?? false),
            longShort: long.short,
          });
          await page.close();
        }
      }
    }
    mkdirSync(join(OUT, look.name), { recursive: true });
    writeFileSync(join(OUT, look.name, 'report.json'), JSON.stringify(readings, null, 2));
    // WRITTEN FIRST, so a refusal below still leaves the readings to look at.
    if (only === undefined) expect(longSeen, 'fields holding a long value seen in the gallery').toBeGreaterThan(0);
    expect(
      readings.flatMap((reading) => reading.longShort.map((field) => `${reading.size} ${reading.id} ${reading.state} › ${field}`)),
      'fields holding a long value narrower than their row (ADR-0157)',
    ).toStrictEqual([]);
  });
}
