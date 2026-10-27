import type { FaceStyle } from '@monstera/contract';

/**
 * The styles a family really has, as the editor's style choice offers them
 * ([ADR-0271](../../../docs/DECISIONS/0271-the-edit-text-editor-is-rebuilt-on-the-kept-writer.md) section 3, the owner's
 * decision of 2026-10-26): Bold is offered where the family has a bold face, Italic where it has an italic one, and a
 * style it lacks is set in the nearest one it has, which a note names. Pure, for its tests.
 */

/** The style bold and italic name together. */
export function styleOf(bold: boolean, italic: boolean): FaceStyle {
  return bold ? (italic ? 'bold-italic' : 'bold') : italic ? 'italic' : 'regular';
}

/**
 * The style `wanted` is set in among `styles`: itself where the family has it, else the one that keeps its slant, else
 * the one that keeps its weight, else the regular, else the first the family has; `undefined` for a family of none.
 */
export function nearestStyle(wanted: FaceStyle, styles: readonly FaceStyle[]): FaceStyle | undefined {
  if (styles.includes(wanted)) return wanted;
  const bold = wanted === 'bold' || wanted === 'bold-italic';
  const italic = wanted === 'italic' || wanted === 'bold-italic';
  const order = [styleOf(!bold, italic), styleOf(bold, !italic), 'regular' as const];
  return order.find((style) => styles.includes(style)) ?? styles[0];
}

/** Which of Bold and Italic the family can take at all: a toggle with no face to set is not offered. */
export function togglesOf(styles: readonly FaceStyle[]): { readonly bold: boolean; readonly italic: boolean } {
  return {
    bold: styles.includes('bold') || styles.includes('bold-italic'),
    italic: styles.includes('italic') || styles.includes('bold-italic'),
  };
}
