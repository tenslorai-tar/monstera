import type { Locator } from '@playwright/test';

/**
 * Whether a drop-down draws its longest choice whole: the widest option's text, measured in the drop-down's own face,
 * against the room inside it once its padding and its arrow are taken off. One measurement for every case that asks,
 * so the Actions editor and the Options layout cannot disagree about what "whole" means.
 */
export async function showsWholeChoice(select: Locator): Promise<boolean> {
  return select.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('not a drop-down');
    const style = getComputedStyle(element);
    const context = document.createElement('canvas').getContext('2d');
    if (context === null) throw new Error('no canvas to measure with');
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const widest = Math.max(...[...element.options].map((option) => context.measureText(option.text).width));
    const arrow = 16;
    const room = element.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - arrow;
    return room >= widest;
  });
}
