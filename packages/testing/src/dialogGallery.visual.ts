import { type Page, expect, test } from '@playwright/test';

import { LOOKS, type Look, bridgeUnder } from './pageBridge.js';
import { settled } from './settled.js';

/**
 * §10.7's visual baselines for EVERY REGISTERED DIALOG the application's own route does not already photograph
 * (the owner's D4, addendum 4's item 2): each one in its first sample state, opened by the dialog gallery
 * (`gallery.html`, `packages/ui/src/gallery`), which opens a dialog by the application's own `ask` with sample props.
 *
 * ## The list is written here, and HELD TO THE REGISTRY in both directions
 *
 * The cases are declared one per dialog, so each has a name a report can list; `@monstera/testing` may not import the
 * UI package, so the ids are written below rather than read from it. That makes this a hand-kept list, which fails
 * loudly on growth and is blind to shrinkage by itself (CLAUDE.md, item 4c). The first case per look is the anchor:
 * the gallery's own index of registered ids must equal {@link THROUGH_THE_APPLICATION} and {@link FROM_THE_GALLERY}
 * together, exactly, so a dialog registered later and photographed nowhere turns this red by name, and so does an id
 * here that nothing registers.
 *
 * ## Images are made on Windows only (cloud rule 5)
 *
 * A missing baseline makes Playwright write the image and fail the case. The `*-win32.png` files are made by the
 * Windows session; nothing here is made on Linux or committed from it.
 */

/** Dialogs `designBaselines.visual.ts` photographs through the application's own route, by the command a person uses. */
const THROUGH_THE_APPLICATION = [
  'dialog.about',
  'dialog.ai-setup',
  'dialog.bates-number',
  'dialog.components',
  'dialog.convert-scan',
  'dialog.delete-pages',
  'dialog.donate',
  'dialog.header-footer',
  'dialog.insert-blank-page',
  'dialog.insert-markdown',
  'dialog.keyboard-shortcuts',
  'dialog.new-from-text',
  'dialog.page-marks-notice',
  'dialog.pdfa-level',
  'dialog.rate-us',
  'dialog.signature',
  'dialog.watermark-pages',
  'dialog.wordCount',
] as const;

/** Every other registered dialog, photographed here. Read from the gallery's samples, 2026-10-15: 89 ids, 107 in all. */
const FROM_THE_GALLERY = [
  'dialog.apply-redactions',
  'dialog.boxed-characters',
  'dialog.camera-capture',
  'dialog.close-unsaved',
  'dialog.cloud-outcome',
  'dialog.cloud-storage',
  'dialog.cloud-view-only',
  'dialog.command-problem',
  'dialog.component-cannot-start',
  'dialog.crop-pages',
  'dialog.delete-fields',
  'dialog.document-password',
  'dialog.docusign-notice',
  'dialog.docusign-send',
  'dialog.duplicate-pages',
  'dialog.enhance-outcome',
  'dialog.export-excel',
  'dialog.export-layout-text',
  'dialog.export-page-images',
  'dialog.export-powerpoint',
  'dialog.export-text',
  'dialog.export-word',
  'dialog.external-edit-problem',
  'dialog.extract-pages',
  'dialog.field-copy',
  'dialog.flat-fields',
  'dialog.flatten-form',
  'dialog.follow-link',
  'dialog.generate-toc',
  'dialog.held-copies',
  'dialog.help',
  'dialog.history-trimmed',
  'dialog.import-annotations-problem',
  'dialog.import-annotations-result',
  'dialog.import-form-data-problem',
  'dialog.import-form-data-result',
  'dialog.import-page-as-layer',
  'dialog.import-settings-result',
  'dialog.import-skipped',
  'dialog.insert-from-pdf',
  'dialog.insert-image-problem',
  'dialog.insert-images',
  'dialog.kept-backups',
  'dialog.markdown-import-problem',
  'dialog.merge-document',
  'dialog.ocr',
  'dialog.ocr-outcome',
  'dialog.open-from-url',
  'dialog.open-problem',
  'dialog.optimize',
  'dialog.page-background',
  'dialog.page-barcodes',
  'dialog.page-transition',
  'dialog.pdfa-removals',
  'dialog.pending-redactions',
  'dialog.permission-password-replaced',
  'dialog.place-barcode',
  'dialog.powerpoint-outcome',
  'dialog.print',
  'dialog.protect-document',
  'dialog.read-only-file',
  'dialog.redact-matches',
  'dialog.region-read',
  'dialog.reimport-external-edit',
  'dialog.replace-page',
  'dialog.resize-pages',
  'dialog.restore-version',
  'dialog.sanitize-document',
  'dialog.save-problem',
  'dialog.save-too-deep',
  'dialog.scan-outcome',
  'dialog.security-update',
  'dialog.service-refused',
  'dialog.settings',
  'dialog.settings-problem',
  'dialog.sign-again',
  'dialog.sign-document',
  'dialog.sign-problem',
  'dialog.signature-break',
  'dialog.signature-problem',
  'dialog.signatures',
  'dialog.signed-edit',
  'dialog.split-document',
  'dialog.stamp',
  'dialog.straighten-outcome',
  'dialog.tab-order',
  'dialog.translate-page',
  'dialog.unsealed-copies',
  'dialog.url-open-problem',
  'dialog.workbook-incomplete',
] as const;

/** Where `visual.config.mjs` serves the gallery, beside the application. */
const GALLERY = process.env['MONSTERA_GALLERY_ORIGIN'] ?? 'http://localhost:4175';

interface GalleryIndex {
  readonly registered: readonly string[];
  readonly states: Readonly<Record<string, readonly string[]>>;
}

async function indexOf(page: Page, look: Look): Promise<GalleryIndex> {
  await bridgeUnder(page, look);
  await page.goto(`${GALLERY}/gallery.html`);
  return page.evaluate(() => (window as unknown as { __dialogGallery: GalleryIndex }).__dialogGallery);
}

for (const look of LOOKS) {
  test(`${look.name}: every registered dialog is photographed, here or through the application, and nothing else is listed`, async ({ page }) => {
    const index = await indexOf(page, look);
    // THE POSITIVE CONTROL: an index that read nothing would make the comparison below one of two empty lists.
    expect(index.registered.length).toBeGreaterThan(100);
    expect([...index.registered].sort()).toStrictEqual([...THROUGH_THE_APPLICATION, ...FROM_THE_GALLERY].sort());
  });

  for (const id of FROM_THE_GALLERY) {
    test(`${look.name}: ${id} matches its baseline`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const state = (await indexOf(page, look)).states[id]?.[0];
      expect(state, `${id} has a sample state`).toBeDefined();
      await page.goto(`${GALLERY}/gallery.html?dialog=${encodeURIComponent(id)}&state=${encodeURIComponent(state ?? '')}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', look.name);
      expect(await page.locator('body').getAttribute('data-gallery-problem')).toBeNull();
      const dialog = page.getByRole('dialog').last();
      await expect(dialog).toBeVisible();
      await page.mouse.move(2, 2);
      // THE BODY ARRIVED AND STOPPED MOVING, the capture's wait and its reason: a registered body is lazy, so the title
      // alone is a dialog with an empty body.
      await settled(
        page,
        () =>
          dialog.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { width: Math.round(box.width), height: Math.round(box.height), children: element.querySelectorAll('*').length };
          }),
        (now) => now.children > 3,
        id,
      );
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await expect(dialog).toHaveScreenshot(`${look.name}-gallery-${id.replace(/^dialog\./u, '')}.png`);
    });
  }
}
