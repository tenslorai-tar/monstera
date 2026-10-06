import type { Locator } from '@playwright/test';

/** The colour properties a mark drawn over a page is painted with. */
export type MarkColour = 'outline-color' | 'border-top-color' | 'caret-color' | 'stroke';

/**
 * WCAG 2's contrast ratio between the colour an element COMPUTES for `property` and the paper it is drawn on, `--page`.
 *
 * Every mark the application draws over a page — an outline, a handle, a caret, a preview's stroke — sits on the
 * paper rather than on the application's surfaces, and a boundary needs 3:1 against what it sits on. Measured
 * 2026-10-04: the accent itself is 3.30:1 on white in light, 2.54:1 in dark and 1.49:1 in high contrast, so a mark
 * left in the token fails in two of the three looks.
 *
 * Both colours are resolved by the browser, through a probe element's `color`, so a `var()` or a named colour reads
 * as what is painted. The luminance is WCAG 2's relative luminance, sRGB's 0.04045 knee.
 */
export async function againstPaper(element: Locator, property: MarkColour): Promise<number> {
  return element.evaluate((node, name) => {
    const luminance = (css: string): number => {
      const probe = document.createElement('span');
      probe.style.color = css;
      document.body.append(probe);
      const parts = getComputedStyle(probe).color.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      probe.remove();
      const [red = 0, green = 0, blue = 0] = parts.map((part) => {
        const channel = part / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const style = getComputedStyle(node);
    const mark = luminance(style.getPropertyValue(name));
    const paper = luminance(style.getPropertyValue('--page').trim());
    return (Math.max(mark, paper) + 0.05) / (Math.min(mark, paper) + 0.05);
  }, property);
}
