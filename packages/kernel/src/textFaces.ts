import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { pageContentStreams } from './pageContent.js';
import { pageFonts } from './pageFonts.js';
import {
  TEXT_FACE_FONTS_MAX,
  TEXT_FACE_RANGES_MAX,
  type TextFace,
  type TextFaceRange,
  type TextFaces,
  boundedFaceName,
} from './textFaceRanges.js';
import { joinedContent, showOperators } from './textOperators.js';

/**
 * Each font's face as its own descriptor states it, and which of PDFium's text objects shows in which
 * ([ADR-0256](../../../docs/DECISIONS/0256-a-type-3-runs-face-is-read-from-its-descriptor-by-mupdf.md)).
 *
 * PDFium reads a Type 3 font as no name and no weight — it has no `/BaseFont` and no program, and PDFium's API reaches no
 * key of its descriptor — so a run in one opened in a plain sans, a bold lead-in not bold. MuPDF reads the descriptor
 * (`pageFonts.ts`, the operator writer's own read), and `textOperators.ts` numbers each showing operator by PDFium's own
 * object index, so the objects named here are the objects PDFium read (B3a: no second numbering).
 *
 * ## Ranges, not one entry per object
 *
 * A page Chromium prints draws a glyph per object, thousands on a page, while its fonts change a handful of times; the
 * answer is the runs of consecutive objects sharing a font, bounded by {@link TEXT_FACE_RANGES_MAX}. Past the bound the
 * answer says `truncated`, and the objects past it keep what PDFium read.
 */
export function readTextFaces(session: MupdfSession, page: number): Promise<TextFaces> {
  return withDocument(session, (document) => {
    const leaf = document.findPage(page);
    const fonts = pageFonts(leaf);
    const named: TextFace[] = [];
    const indexOf = new Map<string, number>();
    const ranges: TextFaceRange[] = [];
    let truncated = false;
    for (const op of showOperators(joinedContent(pageContentStreams(leaf)))) {
      if (op.object === null || op.state.font === null) continue;
      const font = fonts.get(op.state.font);
      if (font === undefined) continue;
      let at = indexOf.get(op.state.font);
      if (at === undefined) {
        if (named.length >= TEXT_FACE_FONTS_MAX) {
          truncated = true;
          continue;
        }
        at = named.push({ face: font.face === null ? null : boundedFaceName(font.face), weight: font.weight }) - 1;
        indexOf.set(op.state.font, at);
      }
      const last = ranges.at(-1);
      if (last?.font === at && last.last + 1 === op.object) {
        ranges[ranges.length - 1] = { ...last, last: op.object };
        continue;
      }
      if (ranges.length >= TEXT_FACE_RANGES_MAX) {
        truncated = true;
        break;
      }
      ranges.push({ first: op.object, last: op.object, font: at });
    }
    return { fonts: named, ranges, truncated };
  });
}
