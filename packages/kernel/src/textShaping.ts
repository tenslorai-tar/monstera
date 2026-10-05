import { Blob as HarfBuzzBlob, Buffer, Direction, Face, Font, MetricsTag, Variation, shape } from 'harfbuzzjs';

/**
 * Text shaped into glyphs by HarfBuzz, for every writer that sets text in a font it embeds
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)).
 *
 * ## Only in a host
 *
 * `fontFaces.ts`' rule: a font file is hostile input and HarfBuzz's WebAssembly loads at import, so this module is
 * reachable from the hosts' entries and never from the kernel's barrel.
 *
 * ## Which glyph carries which characters
 *
 * A PDF reader recovers text from the glyphs drawn, through the font's `ToUnicode` map, one code per glyph — measured
 * 2026-10-05, pdf.js ignores `/ActualText`. HarfBuzz groups its output into CLUSTERS, each the glyphs drawn for a
 * stretch of characters, and a cluster is not always one glyph for one character: a ligature is one glyph for two, and
 * Noto Naskh Arabic draws one medial yeh as two glyphs. So a cluster's characters are shared out over its glyphs in
 * reading order, so every character lands on exactly one glyph — and where there are fewer characters than glyphs,
 * over the glyphs that advance before any that do not, so a base carries its letter and a mark drawn with it does not.
 * A glyph left with none carries no text, and its writer draws it as an outline so no reader reads it as a character
 * (`composeFonts.ts`).
 */

/** One glyph as HarfBuzz placed it, in font units. */
export interface ShapedGlyph {
  readonly glyph: number;
  /** How far the pen moves after the glyph. */
  readonly advance: number;
  readonly xOffset: number;
  readonly yOffset: number;
  /** The characters this glyph stands for, `''` for a glyph that stands for none. */
  readonly text: string;
}

/** One command of a glyph's outline, in font units with y up: `M` and `L` take a point, `Q` two, `C` three. */
export interface OutlineCommand {
  readonly type: 'M' | 'L' | 'Q' | 'C' | 'Z';
  readonly values: readonly number[];
}

/** What a PDF font descriptor states about a face, in font units. */
export interface FaceMetrics {
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight: number;
  readonly box: readonly [number, number, number, number];
  readonly italicAngle: number;
}

const OUTLINE_TYPES = new Set(['M', 'L', 'Q', 'C', 'Z']);

/** A face pinned at a point of its variation axes, ready to shape. */
export class ShapingFace {
  readonly unitsPerEm: number;
  readonly #face: Face;
  readonly #font: Font;
  readonly #advances = new Map<number, number>();

  /**
   * @param bytes the font file, a collection or a single face
   * @param faceIndex which face of a collection
   * @param axes where each variation axis is pinned; an axis not named stays at its default
   */
  constructor(bytes: Uint8Array, faceIndex: number, axes: Readonly<Record<string, number>>) {
    this.#face = new Face(new HarfBuzzBlob(bytes), faceIndex);
    if (this.#face.upem === 0) throw new Error('the bytes hold no font face HarfBuzz can read');
    this.unitsPerEm = this.#face.upem;
    this.#font = new Font(this.#face);
    const pins = Object.entries(axes).map(([tag, value]) => new Variation(tag, value));
    if (pins.length > 0) this.#font.setVariations(pins);
  }

  /**
   * `text` shaped, in drawing order left to right.
   *
   * @param rtl the direction to set it in, always given: `bidiOrder.ts` decides it, and a direction HarfBuzz guessed
   *   from the script would be a second opinion about it
   */
  shape(text: string, rtl: boolean): ShapedGlyph[] {
    if (text === '') return [];
    const buffer = new Buffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    // THE DIRECTION IS A CONSTANT, never a string: `setDirection('rtl')` is accepted and shapes nothing (measured
    // 2026-10-05, every glyph stacked at the origin).
    buffer.setDirection(rtl ? Direction.RTL : Direction.LTR);
    shape(this.#font, buffer);
    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    // CLUSTERS ARE UTF-16 OFFSETS: `addText` hands HarfBuzz UTF-16, so a cluster's text is a slice of `text`.
    const starts = [...new Set(infos.map((info) => info.cluster))].sort((left, right) => left - right);
    const endOf = new Map(starts.map((start, at) => [start, starts[at + 1] ?? text.length]));
    const members = new Map<number, number[]>();
    infos.forEach((info, at) => {
      const list = members.get(info.cluster);
      if (list === undefined) members.set(info.cluster, [at]);
      else list.push(at);
    });
    const textOf = new Map<number, string>();
    for (const [cluster, glyphs] of members) {
      // A cluster's glyphs in READING order, which is drawing order reversed in a run set right to left.
      const reading = rtl ? [...glyphs].reverse() : glyphs;
      const characters = Array.from(text.slice(cluster, endOf.get(cluster) ?? text.length));
      // FEWER CHARACTERS THAN GLYPHS: the characters go to the glyphs that ADVANCE first. Noto Sans Arabic draws one
      // ب as a dotless base and a zero-width dot (measured 2026-10-05); the letter given to the dot left the base
      // drawn as an outline, the text skipping its advance after a zero-width glyph, and MuPDF read that gap as a
      // space inside the word. A base carrying the letter and its mark drawn as an outline is read as one letter.
      const carriers =
        characters.length >= reading.length
          ? reading
          : [...reading]
              .sort((left, right) => Number((positions[right]?.xAdvance ?? 0) > 0) - Number((positions[left]?.xAdvance ?? 0) > 0))
              .slice(0, characters.length)
              .sort((left, right) => reading.indexOf(left) - reading.indexOf(right));
      carriers.forEach((glyph, index) => {
        const from = Math.floor((index * characters.length) / carriers.length);
        const to = Math.floor(((index + 1) * characters.length) / carriers.length);
        textOf.set(glyph, characters.slice(from, to).join(''));
      });
    }
    return infos.map((info, at) => ({
      glyph: info.codepoint,
      advance: positions[at]?.xAdvance ?? 0,
      xOffset: positions[at]?.xOffset ?? 0,
      yOffset: positions[at]?.yOffset ?? 0,
      text: textOf.get(at) ?? '',
    }));
  }

  /** The glyph's own advance at this face's pin, which a PDF font's widths state. */
  nominalAdvance(glyph: number): number {
    let advance = this.#advances.get(glyph);
    if (advance === undefined) {
      advance = this.#font.glyphHAdvance(glyph);
      this.#advances.set(glyph, advance);
    }
    return advance;
  }

  /** The face's PostScript name (name 6), `''` where it states none. */
  postscriptName(): string {
    return this.#face.getName(6, 'en');
  }

  /** The glyph the face maps `codePoint` to, `undefined` where it maps none. */
  glyphFor(codePoint: number): number | undefined {
    return this.#font.nominalGlyph(codePoint);
  }

  /** The glyph's outline at this face's pin, empty for a glyph that draws nothing. */
  outline(glyph: number): OutlineCommand[] {
    return this.#font.glyphToJson(glyph).flatMap((command) =>
      OUTLINE_TYPES.has(command.type) ? [{ type: command.type as OutlineCommand['type'], values: command.values }] : [],
    );
  }

  /** What a PDF font descriptor states, read from the face's own tables. */
  metrics(): FaceMetrics {
    const extents = this.#font.hExtents();
    const head = this.#face.referenceTable('head');
    const post = this.#face.referenceTable('post');
    const signed = (table: Uint8Array | undefined, at: number): number => {
      if (table === undefined || table.length < at + 2) return 0;
      const value = ((table[at] ?? 0) << 8) | (table[at + 1] ?? 0);
      return value >= 0x8000 ? value - 0x10000 : value;
    };
    const fixed = (table: Uint8Array | undefined, at: number): number =>
      table === undefined || table.length < at + 4 ? 0 : signed(table, at) + (((table[at + 2] ?? 0) << 8) | (table[at + 3] ?? 0)) / 65536;
    return {
      ascender: extents.ascender,
      descender: extents.descender,
      capHeight: this.#font.getMetricPositionWithFallback(MetricsTag.CAP_HEIGHT),
      box: [signed(head, 36), signed(head, 38), signed(head, 40), signed(head, 42)],
      italicAngle: fixed(post, 4),
    };
  }
}
