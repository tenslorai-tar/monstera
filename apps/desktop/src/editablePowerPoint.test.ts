import type { PageContent, PresentationPage, Raster } from '@monstera/kernel';
import { describe, expect, it, vi } from 'vitest';

import { type EditableSources, editablePages, emptyReport } from './editablePowerPoint.js';

/**
 * What one page becomes in an editable deck, driven with no host: the engine's four answers are objects here
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 * The slide model's own rules are proved in `packages/kernel` (`editablePresentation.test.ts`); this proves the sequence
 * around it: which engine answer is asked for when, what falls back, and that a fall back is said.
 */

const SIZE = { width: 612, height: 792 };
const DECK = SIZE;
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 7);
const FRAME: PageContent['frame'] = { crop: { x0: 0, y0: 0, x1: 612, y1: 792 }, rotation: 0 };

const STYLE = { size: 12, colour: { r: 0, g: 0, b: 0 }, font: 'Arial', serif: false, mono: false, italic: false, bold: false, orientation: 'upright' as const };

function run(index: number, text: string, invisible = false): PageContent['runs'][number] {
  return { index, last: index, text, left: 72, right: 200, bottom: 700 - index * 20, top: 712 - index * 20, invisible, turn: null, style: STYLE };
}

function content(over: Partial<PageContent>): PageContent {
  return { frame: FRAME, runs: [run(0, 'Hello')], images: [], paths: [], opaque: [], unaddressable: 0, truncated: false, ...over };
}

function sources(pages: readonly PageContent[], over: Partial<EditableSources> = {}): EditableSources & {
  readonly render: ReturnType<typeof vi.fn<EditableSources['render']>>;
  readonly pagePicture: ReturnType<typeof vi.fn<EditableSources['pagePicture']>>;
} {
  const render = vi.fn<EditableSources['render']>((_page, width, height) =>
    Promise.resolve({ width, height, bgra: new Uint8Array(width * height * 4).fill(200) } satisfies Raster),
  );
  const pagePicture = vi.fn<EditableSources['pagePicture']>(() => Promise.resolve(PNG));
  return {
    sizeOf: () => Promise.resolve(SIZE),
    content: (page: number) => {
      const found = pages[page];
      return found === undefined ? Promise.reject(new Error(`no page ${String(page)}`)) : Promise.resolve(found);
    },
    render,
    pagePicture,
    ...over,
  } as never;
}

async function collect(iterable: AsyncIterable<PresentationPage>): Promise<PresentationPage[]> {
  const out: PresentationPage[] = [];
  for await (const page of iterable) out.push(page);
  return out;
}

describe('editablePages', () => {
  it('a page with text is a slide of boxes, asks for no picture and no render, and reports nothing', async () => {
    const engine = sources([content({})]);
    const report = emptyReport();
    const [page] = await collect(editablePages([0], DECK, engine, report));
    expect(page !== undefined && 'slide' in page && page.slide.objects.map((object) => object.kind)).toStrictEqual(['text']);
    expect(engine.pagePicture).not.toHaveBeenCalled();
    expect(engine.render).not.toHaveBeenCalled();
    expect(report.fellBack).toStrictEqual([]);
  });

  it('a recognised scan is the page picture under text boxes, and the picture is asked for ONCE', async () => {
    const engine = sources([content({ runs: [run(0, 'Invoice', true), run(1, 'Total', true)] })]);
    const report = emptyReport();
    const [page] = await collect(editablePages([0], DECK, engine, report));
    if (page === undefined || !('slide' in page)) throw new Error('expected an editable page');
    const kinds = page.slide.objects.map((object) => object.kind);
    expect(kinds[0], 'the picture is at the back').toBe('picture');
    expect(kinds.slice(1).every((kind) => kind === 'text')).toBe(true);
    const picture = page.slide.objects[0];
    expect(picture?.kind === 'picture' && [...picture.source.bytes]).toStrictEqual([...PNG]);
    expect(engine.pagePicture).toHaveBeenCalledTimes(1);
    expect(report.fellBack).toStrictEqual([]);
  });

  it('cuts every object a slide cannot say from ONE render with no text, at the page’s own scale', async () => {
    const opaque = [
      { index: 4, bounds: { left: 100, bottom: 100, right: 200, top: 200 } },
      { index: 5, bounds: { left: 300, bottom: 300, right: 400, top: 400 } },
    ];
    const engine = sources([content({ opaque })]);
    const [page] = await collect(editablePages([0], DECK, engine, emptyReport()));
    if (page === undefined || !('slide' in page)) throw new Error('expected an editable page');
    expect(page.slide.objects.filter((object) => object.kind === 'picture')).toHaveLength(2);
    // ONE render for two cuts, and it is the render WITH NO TEXT: a render that kept the words would draw them twice.
    expect(engine.render).toHaveBeenCalledTimes(1);
    const [, width, height, withoutText] = engine.render.mock.calls[0] ?? [];
    expect(withoutText).toBe(true);
    // 150 dpi of 612 x 792 pt.
    expect([width, height]).toStrictEqual([1275, 1650]);
  });

  it('a page that cannot be read is Exact look, named by its number, with the cause kept; its neighbours stay editable', async () => {
    const engine = sources([content({}), content({}), content({})], {
      content: (page) => (page === 1 ? Promise.reject(new Error('PDFium refused the document')) : Promise.resolve(content({}))),
    });
    const report = emptyReport();
    const pages = await collect(editablePages([0, 1, 2], DECK, engine, report));
    expect(pages.map((page) => ('slide' in page ? 'editable' : 'exact'))).toStrictEqual(['editable', 'exact', 'editable']);
    expect(report.fellBack).toStrictEqual([2]);
    expect(report.causes.get(2)).toBe('PDFium refused the document');
    // THE EXACT PAGE IS THE PAGE'S OWN PICTURE.
    const exact = pages[1];
    expect(exact !== undefined && 'png' in exact && [...exact.png]).toStrictEqual([...PNG]);
  });

  it('a page the slide model will not write editable falls back with ITS reason, and a page of pictures and no words is one', async () => {
    const tilted = content({ runs: [{ ...run(0, 'tilted'), style: { ...STYLE, orientation: 'slanted' as const } }] });
    const picture = content({
      runs: [],
      images: [
        { index: 1, matrix: [100, 0, 0, 100, 10, 10], bounds: { left: 10, bottom: 10, right: 110, top: 110 }, width: 1, height: 1, format: 'png', bytes: PNG },
      ],
    });
    const report = emptyReport();
    const pages = await collect(editablePages([0, 1, 2], DECK, sources([tilted, picture, content({})]), report));
    expect(report.fellBack).toStrictEqual([1, 2]);
    expect([...report.causes.values()]).toStrictEqual(['text-not-upright', 'picture-without-text']);
    expect(pages.map((page) => ('slide' in page ? 'editable' : 'exact'))).toStrictEqual(['exact', 'exact', 'editable']);
  });

  it('a picture that cannot be made falls the page back instead of writing a slide with a hole', async () => {
    const engine = sources([content({ opaque: [{ index: 4, bounds: { left: 0, bottom: 0, right: 50, top: 50 } }] })], {
      render: () => Promise.reject(new Error('no render')),
    });
    const report = emptyReport();
    const [page] = await collect(editablePages([0], DECK, engine, report));
    expect(page !== undefined && 'png' in page).toBe(true);
    expect(report.causes.get(1)).toBe('no render');
  });
});
