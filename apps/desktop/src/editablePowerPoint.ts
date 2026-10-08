import {
  type PageContent,
  type PresentationPage,
  type Raster,
  buildSlide,
  cutFromRaster,
  pictureScale,
  resolveSlide,
} from '@monstera/kernel';

/**
 * The pages of an editable PowerPoint deck
 * ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * `documentCommands.ts` owns the lane, the destination and the write; this owns what one page becomes. Every engine it
 * needs is handed in, so a proof drives it without a host and a fake that made a page unreadable is one object.
 *
 * ## A page the engine cannot read is written as Exact look, and SAID
 *
 * *A person is never refused because of their document.* A page whose read fails, whose content the slide model will not
 * write editable (rotated text, uncounted characters, a picture with no words), or whose picture cannot be made, is that
 * page's one picture, as Exact look draws it, and its number goes in `fellBack`. The export still ends in one file. The cause
 * is kept beside the number, never sent anywhere: a fallback that hid a defect would read as the feature working, so the
 * caller can log it and a proof can assert it.
 */

/** What the engine gives the export for one page. */
export interface EditableSources {
  /** The page as displayed, in points. */
  readonly sizeOf: (page: number) => Promise<{ readonly width: number; readonly height: number }>;
  /** The page's own content, read in the contained host. */
  readonly content: (page: number) => Promise<PageContent>;
  /** The page rendered at an exact pixel size, with its text or without it. */
  readonly render: (page: number, width: number, height: number, withoutText: boolean) => Promise<Raster>;
  /** Exact look's own picture of the page: a PNG at `pictureScale`. */
  readonly pagePicture: (page: number) => Promise<Uint8Array>;
}

/** Which pages fell back, and why each did. */
export interface PowerPointReport {
  /** One-based page numbers, as a person counts. */
  readonly fellBack: number[];
  /** The cause beside each number, for a log and for a proof. Never sent to the renderer. */
  readonly causes: Map<number, string>;
}

/** A report with nothing in it yet. */
export function emptyReport(): PowerPointReport {
  return { fellBack: [], causes: new Map() };
}

/**
 * The deck's pages, one at a time as the zip pulls them.
 *
 * @param chosen zero-based pages, in the order the deck will hold them
 * @param deck the deck's slide size, which every page is fitted to
 * @param report filled as pages fall back; read after the stream is consumed
 */
export async function* editablePages(
  chosen: readonly number[],
  deck: { readonly width: number; readonly height: number },
  sources: EditableSources,
  report: PowerPointReport,
): AsyncIterable<PresentationPage> {
  for (const page of chosen) {
    const size = await sources.sizeOf(page);
    let editable: PresentationPage | undefined;
    try {
      const content = await sources.content(page);
      const built = buildSlide(content, deck);
      if (built.kind === 'fallback') {
        report.fellBack.push(page + 1);
        report.causes.set(page + 1, built.reason);
      } else {
        const scale = pictureScale(size);
        const width = Math.max(1, Math.round(size.width * scale));
        const height = Math.max(1, Math.round(size.height * scale));
        // ONE RENDER WITH NO TEXT per page, made the first time a cut asks and reused by every other.
        let withoutText: Promise<Raster> | undefined;
        const slide = await resolveSlide(built.slide, {
          cut: async (region) => {
            withoutText ??= sources.render(page, width, height, true);
            return cutFromRaster(await withoutText, content.frame, region);
          },
          page: async () => ({ kind: 'embedded', extension: 'png', bytes: await sources.pagePicture(page) }),
        });
        editable = { size, slide };
      }
    } catch (cause) {
      report.fellBack.push(page + 1);
      report.causes.set(page + 1, cause instanceof Error ? cause.message : String(cause));
    }
    yield editable ?? { png: await sources.pagePicture(page), size };
  }
}
