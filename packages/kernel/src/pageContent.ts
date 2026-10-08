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
export type Matrix6 = [number, number, number, number, number, number];

/** The page's frame: its visible box and the quarter turn it is displayed at. */
export interface ContentFrame {
  readonly crop: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly rotation: 0 | 90 | 180 | 270;
}

/**
 * How a run that is not set level is turned: the angle its baseline runs at, counter-clockwise in page space, and the four
 * corners of its own box turned with it, as `[x1 y1 x2 y2 x3 y3 x4 y4]`. Only a pure rotation (one scale, no shear, no
 * mirror) has one; a run set any other way has `turn: null` and is not `upright`.
 */
export interface ContentTurn {
  readonly angle: number;
  readonly quad: [number, number, number, number, number, number, number, number];
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
  /** Set only for a run turned by a pure rotation. `null` for a level run, and for one sheared or mirrored. */
  readonly turn: ContentTurn | null;
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
  /** `jpeg`: the image's own bytes, a plain DCT stream. `png`: the decoded bitmap, encoded. */
  readonly format: 'jpeg' | 'png';
  readonly bytes: Uint8Array;
}

/**
 * An image as the host answers it: where its bytes are in the blob the host wrote beside the answer. `bgra` is the decoded
 * bitmap, `width * height * 4` bytes, which `assemblePageContent` encodes.
 */
export interface ContentImageHeader {
  readonly index: number;
  readonly matrix: Matrix6;
  readonly bounds: ContentBounds;
  readonly width: number;
  readonly height: number;
  readonly format: 'jpeg' | 'bgra';
  readonly offset: number;
  readonly length: number;
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
  // A MUTABLE ARRAY, because the wire's schema is one and this type is what a handler answers with.
  readonly segments: ContentSegment[];
  readonly fill: ContentColour | null;
  readonly stroke: (ContentColour & { readonly width: number; readonly cap: 'butt' | 'round' | 'square'; readonly join: 'miter' | 'round' | 'bevel' }) | null;
}

/**
 * Only a path the engine can state whole, as a solid fill and a solid undashed line, with no clip narrower than itself,
 * is answered as a {@link ContentPath}. Any other painted path is a {@link ContentOpaque}: the host decides once, here,
 * what a shape can be, and nothing downstream has a second opinion.
 */

/**
 * An object the slide cannot write natively (a clipped or dashed or patterned path, a shading, a masked or clipped image, an
 * image past the budget), to be cut from a render with no text in it.
 */
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
