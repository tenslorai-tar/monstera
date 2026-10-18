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
 *
 * ## It measures only a mark the element paints (OOOOOOO-9)
 *
 * A colour property computes on every element whether or not anything is drawn with it: an element with no outline
 * still has an `outline-color`, the text's ink, and dark ink clears 3:1 on white. So a locator that found the wrong
 * element, or a rule that stopped drawing the mark, read as a pass. Each property is measured only where its mark is
 * drawn — an outline or a top border with a style other than `none` and a width above zero, a stroke other than
 * `none`, a caret in a colour other than the element's ink — and anything else is refused. So is a value the probe cannot resolve to
 * a colour, which it would otherwise read as the colour the probe inherits.
 */
export async function againstPaper(element: Locator, property: MarkColour): Promise<number> {
  return element.evaluate((node, name) => {
    const style = getComputedStyle(node);
    const painted: Readonly<Record<string, () => boolean>> = {
      'outline-color': () => style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
      'border-top-color': () => style.borderTopStyle !== 'none' && Number.parseFloat(style.borderTopWidth) > 0,
      stroke: () => style.stroke !== 'none' && style.stroke !== '',
      // NOT `!== 'auto'`: Chromium 151 resolves an unset caret to the text's colour, so `auto` never reads back
      // (measured 2026-10-18, the body's caret answered as its ink). A caret set apart from the ink is one a rule drew.
      'caret-color': () => style.caretColor !== style.color,
    };
    if (painted[name]?.() !== true) throw new Error(`the element paints no ${name}, so there is no mark to measure`);
    const luminance = (css: string, what: string): number => {
      const probe = document.createElement('span');
      probe.style.color = css;
      if (probe.style.color === '') throw new Error(`${what} is ${JSON.stringify(css)}, which is not a colour`);
      document.body.append(probe);
      const parts = getComputedStyle(probe).color.match(/[\d.]+/gu)?.slice(0, 3).map(Number);
      probe.remove();
      if (parts?.length !== 3) throw new Error(`${what} resolved to no colour the probe can read`);
      const [red = 0, green = 0, blue = 0] = parts.map((part) => {
        const channel = part / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const mark = luminance(style.getPropertyValue(name), name);
    const paper = luminance(style.getPropertyValue('--page').trim(), '--page');
    return (Math.max(mark, paper) + 0.05) / (Math.min(mark, paper) + 0.05);
  }, property);
}
