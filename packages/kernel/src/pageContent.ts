/**
 * A page's own content as the editable PowerPoint export reads it
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * Plain types and no behaviour, so the slide model (`slideModel.ts`) and the file parser
 * (`pageContentFile.ts`) agree on one shape without either importing the other. Every coordinate
 * is in PDF user space, exactly as PDFium states it; the slide model is the one place a page
 * point becomes a slide point, through `PageTransform`.
 */

/** A matrix as the file stores it: `[a b c d e f]`, mapping a unit square (or a path's own space) into the page. */
export type Matrix6 = readonly [number, number, number, number, number, number];

/** The page's frame: its visible box and the quarter turn it is displayed at. */
export interface ContentFrame {
  readonly crop: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly rotation: number;
}

/** One run of text, `engine/text-runs`' fields plus whether it is painted. */
export interface ContentRun {
  readonly index: number;
  readonly last: number;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  /** Text render mode 3 (invisible): the layer recognition writes over a scan. */
  readonly invisible: boolean;
  readonly style: {
    readonly size: number;
    readonly colour: { readonly r: number; readonly g: number; readonly b: number };
    readonly font: string;
    readonly serif: boolean;
    readonly mono: boolean;
    readonly italic: boolean;
    readonly bold: boolean;
    readonly upright: boolean;
  };
}

/** One image object: its place and the bytes the slide embeds. */
export interface ContentImage {
  readonly index: number;
  /** The unit square's map into the page. The image's top row is at y = 1. */
  readonly matrix: Matrix6;
  readonly bounds: ContentBounds;
  readonly width: number;
  readonly height: number;
  /** `jpeg`: the image's own bytes, a plain DCT stream. `bgra`: the decoded bitmap, `width * height * 4` bytes. */
  readonly format: 'jpeg' | 'bgra';
  readonly bytes: Uint8Array;
  /** Whether a clip narrower than the image applies, which a picture cannot say. */
  readonly clipped: boolean;
}

/** An axis box in page space. */
export interface ContentBounds {
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
  readonly top: number;
}

/** A colour with its alpha, each 0 to 255. */
export interface ContentColour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** One path segment in PAGE space (the object's own matrix already applied). */
export type ContentSegment =
  | { readonly kind: 'move'; readonly x: number; readonly y: number }
  | { readonly kind: 'line'; readonly x: number; readonly y: number }
  | {
      readonly kind: 'curve';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: 'close' };

/** One path object. */
export interface ContentPath {
  readonly index: number;
  readonly bounds: ContentBounds;
  readonly segments: readonly ContentSegment[];
  readonly fill: ContentColour | null;
  readonly stroke: (ContentColour & { readonly width: number; readonly cap: 'butt' | 'round' | 'square'; readonly join: 'miter' | 'round' | 'bevel' }) | null;
  /** Whether the engine can state the whole of how this path is painted as a solid fill and a solid line. */
  readonly simple: boolean;
}

/** An object the slide cannot write natively, to be cut from a render with no text in it. */
export interface ContentOpaque {
  readonly index: number;
  readonly bounds: ContentBounds;
}

/** Everything the export reads from one page. */
export interface PageContent {
  readonly frame: ContentFrame;
  readonly runs: readonly ContentRun[];
  readonly images: readonly ContentImage[];
  readonly paths: readonly ContentPath[];
  /** Shadings and anything else the engine names and this export cannot write: cut from the render. */
  readonly opaque: readonly ContentOpaque[];
  /** Characters PDFium extracted that no object holds, after forms were flattened. */
  readonly unaddressable: number;
  /** Whether any list was cut at its bound. */
  readonly truncated: boolean;
}
