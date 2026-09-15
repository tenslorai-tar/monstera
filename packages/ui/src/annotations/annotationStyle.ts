import type { AnnotationColour, AnnotationOpacity } from '@monstera/contract';

// A VALUE IMPORT FROM A TOOL MODULE, and not a cycle: `shapeTools.ts` takes
// `AnnotationStyle` from here as a type only, which the compiler erases.
import { STROKE } from './shapeTools.js';

/**
 * The style a new annotation is drawn in, as a tool reads it.
 *
 * ## Resolved ONCE, above the tools, rather than read by each of them
 *
 * Every tool would otherwise hold a settings store and four setting
 * definitions, and *what colour is a new mark* would have twelve
 * implementations that agree today. This is the one answer, and `annotationTool`
 * deps carry a function returning it — read at commit rather than captured, for
 * `toolCommand`'s reason: a controller is built once and a captured style would
 * be whatever was set at registration for ever.
 *
 * ## `colour` is already resolved, and the tool's OWN colour is the argument
 *
 * The setting is a choice or `'auto'`, and `'auto'` means *each tool's own*. A
 * tool therefore asks for a colour and passes what it would have used, which
 * keeps the tri-state in one place: a tool that read the setting itself would
 * have to know what `'auto'` means, and twelve of them would be twelve chances
 * to read it as black.
 */
export interface AnnotationStyle {
  /**
   * The colour to draw in, given what this tool would use on its own.
   *
   * @param own the tool's own recognisable colour — the highlighter's yellow,
   *   the caret's red — used when the person has not chosen one
   */
  readonly colour: (own: AnnotationColour) => AnnotationColour;
  readonly opacity: AnnotationOpacity;
  /** Stroke width in points, for the tools that draw one. */
  readonly lineWidth: number;
  /** Point size, for the tools that set text. */
  readonly fontSize: number;
}

/**
 * A style that chooses nothing — every tool's own colour, and the defaults the
 * settings ship with.
 *
 * For cases whose subject is not the style. It is the SETTINGS' fallbacks
 * restated, which is a copy — and it is the copy that costs least: the
 * alternative is every tool case building a settings store, and a case that
 * disagrees with the shipped defaults fails about its own fixture rather than
 * about the product.
 */
export const PLAIN_STYLE: AnnotationStyle = {
  colour: (own) => own,
  opacity: 1,
  lineWidth: 2,
  fontSize: 12,
};

/**
 * `#rrggbb` as the three components `/C` holds, or `undefined` for a string
 * this cannot read.
 *
 * The parse is here rather than in the setting's schema because a schema
 * refusing a malformed value is right and a schema TRANSFORMING one puts a
 * conversion where a validation belongs — the stored value is what a person
 * chose, and `/C`'s triple is what the payload takes.
 */
/**
 * The three components as `#rrggbb`, which is what a colour input takes.
 *
 * {@link colourFromHex} backwards, and it exists so the control that starts a
 * person off can offer **the shape tools' own red** without writing it as a
 * literal — `monstera/no-raw-hex` refuses one in a component, correctly, and
 * the value is not a design token: it is another module's constant, so the
 * honest way to reach it is to convert it rather than to retype it.
 */
export function hexFromColour(colour: AnnotationColour): string {
  const part = (value: number): string =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(colour[0])}${part(colour[1])}${part(colour[2])}`;
}

export function colourFromHex(hex: string): AnnotationColour | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/u.exec(hex);
  if (match === null) return undefined;
  const [, r, g, b] = match;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  // DIVIDED BY 255, which is what `/C`'s 0–1 components are. Rounded to four
  // places so the payload carries a number a person could read back rather than
  // 0.8509803921568627 — the annotation is a colour, not a measurement.
  const part = (value: string): number => Math.round((Number.parseInt(value, 16) / 255) * 1e4) / 1e4;
  return [part(r), part(g), part(b)];
}

/**
 * What a colour input offers before a person has chosen a colour.
 *
 * **The shape tools' own red, converted rather than retyped.** A hex literal in a
 * component is refused by `monstera/no-raw-hex` and the refusal is right: this is
 * not a design token, it is another module's constant, and a copy would drift the
 * day that constant moved. Black — what an empty colour input answers — would be
 * worse still: a person who has just said *I want to choose* has not chosen black.
 *
 * One constant for every surface of the setting: the styles panel and the Settings
 * dialog both offer it, through the setting's colour schema.
 */
export const STARTING_STYLE_COLOUR = hexFromColour(STROKE);

/**
 * The style the tools draw in, from the four stored editing settings.
 *
 * ## A stored colour this cannot read is NO CHOICE, and `'auto'` is one of those
 *
 * `colourFromHex` answers `undefined` for anything that is not `#rrggbb`, and
 * `undefined` hands the tool its own colour. So `'auto'` needs no case of its own,
 * and a stored value from a build whose pattern was different falls back to each
 * tool's own colour too — a mark a person recognises, where black would be a silent
 * restyle.
 */
export function styleFrom(stored: {
  readonly colour: string;
  readonly opacity: AnnotationOpacity;
  readonly lineWidth: number;
  readonly fontSize: number;
}): AnnotationStyle {
  const chosen = colourFromHex(stored.colour);
  return {
    colour: (own) => chosen ?? own,
    opacity: stored.opacity,
    lineWidth: stored.lineWidth,
    fontSize: stored.fontSize,
  };
}
