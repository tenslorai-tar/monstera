import {
  type BoxLook,
  type Family,
  type Rgb,
  type TextRun,
  DEFAULT_LOOK,
  MAX_LINE_HEIGHT,
  MAX_PADDING,
  MIN_LINE_HEIGHT,
} from './textBoxStyle.js';

/**
 * A text box's styled runs as `/RC` and its own style as `/DS`
 * ([ADR-0211](../../../docs/DECISIONS/0211-a-text-box-with-styled-words-has-an-appearance-monstera-writes-itself.md) Decision 1):
 * the XHTML subset PDF 32000 §12.7.3.4 and §12.5.6.6 define — `<p>`, `<span>` with `font-weight`, `font-style`,
 * `text-decoration`, `color` — and the default style string.
 *
 * **It reads only what it writes.** A box Monstera did not style carries no marker (`textBoxAppearance.ts`) and its `/RC` is
 * never parsed here (Decision 4): a foreign box's rich text is KEPT, and shown in the readers that draw it. The parser is
 * tolerant of the shapes Acrobat and this module produce and answers `undefined` for anything else, so a box it cannot read
 * keeps the plain words and says so rather than guessing.
 */

const FAMILY_NAME: Readonly<Record<Family, string>> = { sans: 'Helvetica', serif: 'Times New Roman', mono: 'Courier New' };

const hex = (colour: Rgb): string =>
  `#${colour.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0')).join('')}`;

const colourOfHex = (text: string): Rgb | undefined => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(text.trim());
  if (match === null) return undefined;
  return [parseInt(match[1] ?? '0', 16) / 255, parseInt(match[2] ?? '0', 16) / 255, parseInt(match[3] ?? '0', 16) / 255];
};

const escapeXml = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

const unescapeXml = (text: string): string =>
  text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, '&');

/** The box's `/DS`: every field of the look the appearance reads, so `/DS` alone rebuilds it. */
export function styleStringOf(look: BoxLook): string {
  return [
    `font: ${FAMILY_NAME[look.family]} ${String(look.size)}pt`,
    `font-weight: ${look.bold ? 'bold' : 'normal'}`,
    `font-style: ${look.italic ? 'italic' : 'normal'}`,
    `text-decoration: ${[look.underline ? 'underline' : '', look.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`,
    `text-align: ${look.align}`,
    `color: ${hex(look.colour)}`,
    `line-height: ${String(look.lineHeight)}`,
    // THE PADDING LIVES HERE AND NOT IN `/RD`: MuPDF's `update()` applies `/RD` to the annotation's rectangle and zeroes it
    // (measured 2026-10-08, 1.28.0: a 4-point `/RD` shrank `/Rect` by 4 on every side), so the margin would eat the box.
    `padding: ${String(look.padding)}pt`,
  ].join('; ');
}

/** The properties of a style string, by name, lower-cased. */
function propertiesOf(style: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of style.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    found.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return found;
}

/** `base` with what a `/DS` says over it; a property it does not know or cannot read leaves the base's. */
export function lookOfStyleString(style: string, base: BoxLook = DEFAULT_LOOK): BoxLook {
  const properties = propertiesOf(style);
  const font = properties.get('font');
  const sizeMatch = font === undefined ? null : /(\d+(?:\.\d+)?)\s*pt/iu.exec(font);
  const lower = (font ?? '').toLowerCase();
  const family: Family = lower.includes('courier') ? 'mono' : lower.includes('times') ? 'serif' : lower.includes('helvetica') ? 'sans' : base.family;
  const decoration = properties.get('text-decoration') ?? '';
  const align = properties.get('text-align');
  const lineHeight = Number(properties.get('line-height'));
  const colour = colourOfHex(properties.get('color') ?? '');
  const padding = /^(\d+(?:\.\d+)?)\s*pt$/iu.exec(properties.get('padding') ?? '');
  return {
    ...base,
    padding: padding === null ? base.padding : Math.min(MAX_PADDING, Number(padding[1])),
    family,
    size: sizeMatch === null ? base.size : Number(sizeMatch[1]),
    bold: properties.has('font-weight') ? /bold|[6-9]00/iu.test(properties.get('font-weight') ?? '') : base.bold,
    italic: properties.has('font-style') ? /italic|oblique/iu.test(properties.get('font-style') ?? '') : base.italic,
    underline: properties.has('text-decoration') ? decoration.includes('underline') : base.underline,
    strike: properties.has('text-decoration') ? decoration.includes('line-through') : base.strike,
    align: align === 'left' || align === 'center' || align === 'right' || align === 'justify' ? (align) : base.align,
    lineHeight: Number.isFinite(lineHeight) && lineHeight >= MIN_LINE_HEIGHT && lineHeight <= MAX_LINE_HEIGHT ? lineHeight : base.lineHeight,
    colour: colour ?? base.colour,
  };
}

/** One run's `<span>`, carrying only what it says over the box's own style. */
function spanOf(run: TextRun, look: BoxLook): string {
  const parts: string[] = [];
  if (run.bold !== undefined && run.bold !== look.bold) parts.push(`font-weight:${run.bold ? 'bold' : 'normal'}`);
  if (run.italic !== undefined && run.italic !== look.italic) parts.push(`font-style:${run.italic ? 'italic' : 'normal'}`);
  const underline = run.underline ?? look.underline;
  const strike = run.strike ?? look.strike;
  if (underline !== look.underline || strike !== look.strike) {
    parts.push(`text-decoration:${[underline ? 'underline' : '', strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`);
  }
  if (run.colour !== undefined && hex(run.colour) !== hex(look.colour)) parts.push(`color:${hex(run.colour)}`);
  const text = escapeXml(run.text);
  return parts.length === 0 ? text : `<span style="${parts.join(';')}">${text}</span>`;
}

/** The runs as `/RC`: a paragraph for each hard break, a span for each run that says something of its own. */
export function richTextOf(runs: readonly TextRun[], look: BoxLook): string {
  const paragraphs: string[][] = [[]];
  for (const run of runs) {
    const pieces = run.text.split(/\r\n|\n|\r/u);
    pieces.forEach((piece, at) => {
      if (at > 0) paragraphs.push([]);
      if (piece !== '') paragraphs.at(-1)?.push(spanOf({ ...run, text: piece }, look));
    });
  }
  const body = paragraphs.map((spans) => `<p dir="ltr">${spans.join('')}</p>`).join('');
  return (
    '<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/" ' +
    `xfa:APIVersion="Acrobat:8.0.0" xfa:spec="2.0.2" style="${escapeXml(styleStringOf(look))}">${body}</body>`
  );
}

/** The runs a `/RC` this module wrote holds, or `undefined` for a shape it does not read. */
export function runsOfRichText(rich: string): TextRun[] | undefined {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/u.exec(rich);
  if (body === null) return undefined;
  const runs: TextRun[] = [];
  const paragraphs = [...(body[1] ?? '').matchAll(/<p\b[^>]*?(?:\/>|>([\s\S]*?)<\/p>)/gu)];
  if (paragraphs.length === 0 && (body[1] ?? '').trim() !== '') return undefined;
  paragraphs.forEach((paragraph, at) => {
    if (at > 0) runs.push({ text: '\n' });
    const inner = paragraph[1] ?? '';
    let cursor = 0;
    for (const span of inner.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gu)) {
      if (span.index > cursor) runs.push({ text: unescapeXml(inner.slice(cursor, span.index).replace(/<[^>]*>/gu, '')) });
      const properties = propertiesOf(/style="([^"]*)"/u.exec(span[1] ?? '')?.[1] ?? '');
      const decoration = properties.get('text-decoration');
      const colour = colourOfHex(properties.get('color') ?? '');
      runs.push({
        text: unescapeXml((span[2] ?? '').replace(/<[^>]*>/gu, '')),
        ...(properties.has('font-weight') ? { bold: /bold|[6-9]00/iu.test(properties.get('font-weight') ?? '') } : {}),
        ...(properties.has('font-style') ? { italic: /italic|oblique/iu.test(properties.get('font-style') ?? '') } : {}),
        ...(decoration === undefined
          ? {}
          : { underline: decoration.includes('underline'), strike: decoration.includes('line-through') }),
        ...(colour === undefined ? {} : { colour }),
      });
      cursor = span.index + span[0].length;
    }
    if (cursor < inner.length) runs.push({ text: unescapeXml(inner.slice(cursor).replace(/<[^>]*>/gu, '')) });
  });
  return runs.filter((run) => run.text !== '');
}

/** The runs with their equal neighbours joined, so a restyle of a stretch that already matched does not split a word in two. */
export function normalisedRuns(runs: readonly TextRun[]): TextRun[] {
  const joined: TextRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = joined.at(-1);
    const same =
      last !== undefined &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.underline === run.underline &&
      last.strike === run.strike &&
      (last.colour === undefined ? run.colour === undefined : run.colour !== undefined && hex(last.colour) === hex(run.colour));
    if (same) joined[joined.length - 1] = { ...last, text: last.text + run.text };
    else joined.push(run);
  }
  return joined;
}
