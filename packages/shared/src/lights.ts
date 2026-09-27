/**
 * The ground's light, turned to follow the accent (ARCHITECTURE §10.2,
 * [ADR-0114](../../../docs/DECISIONS/0114-the-grounds-light-follows-the-accent.md)).
 *
 * ## Here, in `shared`, because two callers must agree
 *
 * `applyAccent` in the renderer writes the turned lights, and `check:tokencontrast` sweeps them. A turning rule in
 * each would be a second opinion about what colour a person sees (B3a), and the check would be proving the floors
 * over lights nobody draws.
 *
 * ## A light takes the accent's HUE, keeps the design's lightness, and is drawn a little weaker
 *
 * `tokens.css` stores every glow and tint the design draws, in green, once per theme. For a chosen accent the light is
 * the design's colour in OKLCH with its hue turned by the accent's hue less the theme accent's, and its chroma scaled by
 * the accent's chroma over the theme accent's (never above one). Lightness stays the design's; the alpha is the design's
 * times {@link TURNED_STRENGTH}, which is where the contrast headroom a turn needs comes from.
 *
 * **That is what makes the contrast floors provable for every accent a person can type.** With lightness and strength
 * fixed, a light can only ever be one of a two-parameter family — a turn and a scale — so `check:tokencontrast` sweeps
 * the family rather than sampling accents, and a pass over the family is a pass over all of them.
 *
 * **A turn of zero and a scale of one are the identity to the byte**, so the theme's own accent draws exactly the
 * design; `lights.test.ts` holds every stored light to that.
 *
 * OKLab is Björn Ottosson's (2020), the space CSS Color 4 names `oklab`; its matrices are his published ones.
 */

import { type Rgb, channelsWithAlpha } from './colour.js';

/**
 * EVERY TOKEN THE ACCENT TURNS, by name without its dashes — the one list, which the renderer writes and the check
 * sweeps. The four glows, every tint and its far stop, the dialog head's wash, the accent's soft fill, and the two
 * colours the design's glow and selection rings are drawn in. NOT text, borders or the page, which carry the contrast
 * obligations the turned lights are held against; NOT the ground's own opaque colours, the base those obligations were
 * solved against to the hundredth — turning an opaque near-black by its hue moves its luminance, and the pairs have no
 * headroom for that (measured below); not the brand tones (ADR-0113); not the accent's solid fills, which
 * `applyAccent` writes itself.
 */
export const ACCENT_LIGHTS = [
  'glow-green',
  'glow-teal',
  'glow-lime',
  'glow-warm',
  'tint-mica',
  'tint-mica-far',
  'tint-start',
  'tint-rail',
  'tint-ribbon',
  'tint-ribbon-far',
  'tint-panel',
  'tint-float',
  'tint-canvas',
  'tint-canvas-far',
  'tint-status',
  'tint-status-far',
  'tint-hero',
  'tint-hero-far',
  'dialog-head-wash',
  'accent-soft',
  'light-ring',
  'light-halo',
] as const;

/** How far the accent moves a light: degrees of hue, and a chroma factor in [0, 1]. */
export interface LightTurn {
  readonly degrees: number;
  readonly scale: number;
}

/** The turn that leaves every light as the design drew it. */
export const NO_TURN: LightTurn = { degrees: 0, scale: 1 };

/**
 * A TURNED light is drawn at this share of the design's alpha; the design's own is drawn at all of it.
 *
 * **Measured, not chosen by eye** (`check:tokencontrast`, 2026-09-27): the design's text and control edges were solved
 * to their floors with no headroom — the tightest pair reads 3.00:1 against 3:1 and several 4.50:1 against 4.5:1 — so a
 * light turned at full strength broke seven pairs by a hundredth, some under a turn of a single degree. Every light
 * here LOWERS contrast in both themes (a glow brightens the dark ground under light text and tints the light ground
 * under dark text), so a turned light a little weaker than the design's is never the worse of the two. The sweep holds
 * every pair under every turn at this strength.
 */
export const TURNED_STRENGTH = 0.75;

interface Lch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const linear = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const encoded = (value: number): number => {
  const unit = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return unit * 255;
};

function toLch([red, green, blue]: Rgb): Lch {
  const r = linear(red);
  const g = linear(green);
  const b = linear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: lightness, c: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

/** Unrounded channels, which may fall outside 0–255 when the colour is outside sRGB. */
function fromLch({ l: lightness, c, h }: Lch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    encoded(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encoded(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encoded(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Half a unit outside the channel range still rounds into it. */
const inGamut = (rgb: readonly number[]): boolean => rgb.every((value) => value > -0.5 && value < 255.5);

/**
 * THE ONE PLACE A TURNED LIGHT MEETS sRGB. A hue turned at the design's lightness and chroma can leave the gamut —
 * a saturated green's chroma does not exist in blue at that lightness — and clipping each channel would move the
 * lightness the contrast check relied on. So chroma is reduced, at the same lightness and hue, until the colour exists.
 */
function inside(lch: Lch): Rgb {
  let rgb = fromLch(lch);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = lch.c;
    for (let step = 0; step < 24; step += 1) {
      const middle = (low + high) / 2;
      if (inGamut(fromLch({ ...lch, c: middle }))) low = middle;
      else high = middle;
    }
    rgb = fromLch({ ...lch, c: low });
  }
  const channel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
  return [channel(rgb[0]), channel(rgb[1]), channel(rgb[2])];
}

/**
 * The turn a chosen accent gives, measured from the theme's own accent.
 *
 * A grey accent has no hue worth reading, and its chroma scale of about zero is what makes that harmless: the lights
 * go neutral whatever angle `atan2` happens to report.
 */
export function turnFor(accent: Rgb, themeAccent: Rgb): LightTurn {
  const chosen = toLch(accent);
  const theme = toLch(themeAccent);
  const scale = theme.c === 0 ? 1 : Math.min(1, chosen.c / theme.c);
  return { degrees: chosen.h - theme.h, scale };
}

/**
 * One light, turned. `design` is the stored CSS colour — `#rrggbb` or `rgba(r, g, b, a)`; the answer carries its alpha
 * at {@link TURNED_STRENGTH}, or unchanged for no turn. `null` for a value that is not a colour this parses, never a
 * guess.
 */
export function turnLight(design: string, turn: LightTurn): string | null {
  const parsed = channelsWithAlpha(design);
  if (parsed === null) return null;
  const [rgb, alpha] = parsed;
  if (turn.degrees === 0 && turn.scale === 1) return formatted(rgb, alpha);
  const lch = toLch(rgb);
  const turned = inside({ l: lch.l, c: lch.c * turn.scale, h: lch.h + turn.degrees });
  // AT THE TURNED STRENGTH, rounded to the thousandth a stylesheet writes, and never above the design's.
  return formatted(turned, Math.round(alpha * TURNED_STRENGTH * 1000) / 1000);
}

function formatted([red, green, blue]: Rgb, alpha: number): string {
  return alpha >= 1
    ? `rgb(${String(red)}, ${String(green)}, ${String(blue)})`
    : `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(alpha)})`;
}
