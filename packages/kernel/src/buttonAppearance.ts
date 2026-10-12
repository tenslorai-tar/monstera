import {
  type AppearanceProviderFor,
  type PDFCheckBox,
  type PDFContext,
  PDFName,
  PDFNumber,
  PDFOperator,
  type PDFOperatorNames,
  type PDFRadioGroup,
  type PDFWidgetAnnotation,
  defaultRadioGroupAppearanceProvider,
  rotateInPlace,
} from '@cantoo/pdf-lib';

import { borderStyleOfName, checkStyleOfCharacter, textColourOf } from './fieldActions.js';
import { type Op, borderOps, checkOps } from './fieldMarks.js';

/**
 * A tick box's and a radio's appearance in its border style and check style
 * ([ADR-0230](../../../docs/DECISIONS/0230-a-fields-border-style-and-check-style-are-drawn-by-monstera.md) Decision 3): pdf-lib's
 * own provider draws one solid border and one check mark whatever the widget says (measured), and MuPDF never redraws a
 * button, so this provider, handed to pdf-lib where an edit draws a button, is the button's one writer of those shapes.
 *
 * The shapes are `fieldMarks.ts`', the same data the text field's border is drawn from.
 */

/** pdf-lib's operator for one of `fieldMarks.ts`' operators, a dash's array made in the widget's own document. */
function operatorOf(each: Op, context: PDFContext): PDFOperator {
  const numbers = each.args.map((value) => PDFNumber.of(value));
  if (each.dash === undefined) return PDFOperator.of(each.op as PDFOperatorNames, numbers);
  return PDFOperator.of(each.op as PDFOperatorNames, [context.obj([...each.dash]), ...numbers]);
}

/** Whether a widget names a style of its own (`/BS /S` other than solid, or `/MK /CA`): only then is it drawn here. */
export function namesButtonStyle(widget: PDFWidgetAnnotation): boolean {
  const style = widget.getBorderStyle()?.dict.lookup(PDFName.of('S'));
  const mark = widget.getAppearanceCharacteristics()?.getCaptions().normal;
  return (style instanceof PDFName && borderStyleOfName(style.decodeText()) !== 'solid') || mark !== undefined;
}

/** The box, its border by style, and for `on` the mark by its check style in the text colour. */
function drawn(widget: PDFWidgetAnnotation, defaultAppearance: string | undefined, radio: boolean): { on: PDFOperator[]; off: PDFOperator[] } {
  const rectangle = widget.getRectangle();
  const characteristics = widget.getAppearanceCharacteristics();
  // A QUARTER TURN, the four the format allows: anything else is read as the nearest below, as pdf-lib's own provider does.
  const turn = ([0, 90, 180, 270] as const)[Math.floor(((((characteristics?.getRotation() ?? 0) % 360) + 360) % 360) / 90)] ?? 0;
  const sideways = turn === 90 || turn === 270;
  const width = sideways ? rectangle.height : rectangle.width;
  const height = sideways ? rectangle.width : rectangle.height;
  const style = widget.getBorderStyle()?.dict.lookup(PDFName.of('S'));
  const border = borderOps(
    borderStyleOfName(style instanceof PDFName ? style.decodeText() : undefined),
    width,
    height,
    widget.getBorderStyle()?.getWidth() ?? 0,
    characteristics?.getBorderColor() ?? null,
  );
  const background = characteristics?.getBackgroundColor();
  const fill: Op[] =
    background === undefined || background.length === 0
      ? []
      : [
          { op: 'q', args: [] },
          { op: background.length === 1 ? 'g' : background.length === 4 ? 'k' : 'rg', args: background },
          { op: 're', args: [0, 0, width, height] },
          { op: 'f', args: [] },
          { op: 'Q', args: [] },
        ];
  const caption = characteristics?.getCaptions().normal;
  const mark = checkOps(checkStyleOfCharacter(caption ?? (radio ? 'l' : '4')), width, height, textColourOf(defaultAppearance) ?? [0, 0, 0]);
  const rotate = rotateInPlace({ ...rectangle, rotation: turn });
  const context = widget.dict.context;
  const off = [...rotate, ...[...fill, ...border].map((each) => operatorOf(each, context))];
  return { off, on: [...off, ...mark.map((each) => operatorOf(each, context))] };
}

/** A tick box's provider: pdf-lib's `updateAppearances` takes it in place of its own. */
export const checkBoxAppearance: AppearanceProviderFor<PDFCheckBox> = (checkBox, widget) => {
  const shapes = drawn(widget, widget.getDefaultAppearance() ?? checkBox.acroField.getDefaultAppearance(), false);
  return { normal: shapes, down: shapes };
};

/**
 * A radio's provider: pdf-lib's own circle for the button itself, which a radio's border is, and the mark by its style for
 * `on` (ADR-0230: a radio's border stays a circle, so its Properties offer no border style).
 */
export const radioAppearance: AppearanceProviderFor<PDFRadioGroup> = (radioGroup, widget) => {
  const base = defaultRadioGroupAppearanceProvider(radioGroup, widget);
  const normal = 'normal' in base ? base.normal : base;
  const shapes = drawn(widget, widget.getDefaultAppearance() ?? radioGroup.acroField.getDefaultAppearance(), true);
  const markOnly = shapes.on.slice(shapes.off.length);
  const on = [...normal.off, ...markOnly];
  return { normal: { on, off: normal.off }, down: { on, off: normal.off } };
};
