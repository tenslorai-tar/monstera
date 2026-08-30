import type { MupdfSession } from './engineSeam.js';
import { withDocument } from './mupdfWriter.js';
import { snapRotation } from './rotatePages.js';

/**
 * The geometry half of the view model (`docs/ARCHITECTURE.md` §2), read from a
 * live session.
 *
 * ## Why this exists at all, and it is not an optimisation
 *
 * Finding OOOOO-1, measured 2026-08-30: a `DocumentRecord`'s bytes are
 * `readonly` and a command never replaces them. A mutation lands in the engine
 * session; main's canonical image stays what was opened; `document.readRange`
 * therefore serves the **pre-command** document. So no amount of rebinding a
 * transport can make a rotation visible — the bytes the renderer reads do not
 * contain it.
 *
 * §2 names two things crossing, not one: *"The renderer receives a **view
 * model** (page count, page sizes and transforms, annotations, form fields,
 * outline — structured data, bounded size) **and** no document bytes at all
 * until it asks for them."* A rotation is a page transform. §3.2 says the same
 * from the other side — *PDF.js is never a source of truth. It renders.* The
 * effect had nowhere to go because half of §2 had never been built.
 *
 * ## The read is SCOPED to named pages, which is invariant L11
 *
 * A rotation per page scales with the document, and a renderer that re-read the
 * whole vector after every command would be the payload-scales-with-document
 * shape L11 forbids — arriving as a per-operation cost rather than as a big
 * file. So a caller names the pages it is about to draw, exactly as
 * `document.readRange` names the bytes it is about to parse.
 *
 * The page **count** is a scalar and always crosses: a viewer that cannot say
 * how many pages a document has cannot show a scrollbar, and one number is not
 * a payload.
 *
 * ## What it carries, and the larger thing it deliberately does NOT
 *
 * Rotations. **Not page sizes**, and that is B3a rather than an unfinished
 * list: a page's rendering box comes from its `/MediaBox`, its `/CropBox`, an
 * inherited `/Rotate` and the intersection rules between them, and PDF.js
 * already implements all of that in `page.getViewport`. `renderPage.ts` states
 * the same rule about the same question. Computing sizes here would be a second
 * opinion that agrees with the parser most of the time, which is the shape B3a
 * names as dangerous.
 *
 * Rotation is different in exactly the way that matters: it is the one piece of
 * geometry the parser reads from **stale bytes**, so it is the one piece that
 * has to come from the writer of record. Everything else PDF.js derives is
 * derived from bytes whose geometry has not moved.
 *
 * Annotations, form fields and the outline are §2's other members and are not
 * here for §10.4's reason — a field nothing reads is the display-only sin one
 * layer down. They land with the features that read them.
 *
 * ## The rotation is the EFFECTIVE one, snapped, and both halves are load-bearing
 *
 * Effective — `getInheritable`, not `get` — because the renderer draws what the
 * user sees, and a page that inherits `/Rotate 90` from its `/Pages` node is
 * drawn turned. Own-state is the *inverse's* business (ADR-0009 §3) and reading
 * it here would report `0` for a page that is plainly on its side.
 *
 * Snapped through {@link snapRotation}, which is MuPDF's own rule ported once,
 * because `applyRotatePages` rotates from that base. A raw `45` renders as `90`
 * and rotating it once gives `180`; a view model reporting `45` would put the
 * renderer a half-quarter-turn away from the engine on every such document.
 * Reusing the function rather than normalising here is the whole of B3a: one
 * answer to *what rotation is this page at*, with callers.
 *
 * ## Absolute, because that is what the consumer takes
 *
 * `page.getViewport({ scale, rotation })` **replaces** the page's own rotation
 * rather than adding to it — `rotation = this.rotate` is the default, measured
 * by `proof:viewportrotation` rather than read off the declaration. So the
 * number here is where the page has ended up, never the turns a command applied.
 */

/** How many pages a document has, and the rotation of the ones that were asked for. */
export interface PageGeometry {
  readonly pageCount: number;
  /**
   * Degrees, snapped to a quarter turn, **in the order the pages were named**.
   *
   * Positionally aligned with the request rather than keyed by page number, for
   * the reason `document.readRange` answers bytes rather than offsets: the
   * caller already knows what it asked for, and a second copy of that on the
   * wire is a second thing that can disagree with the first.
   */
  readonly rotations: readonly number[];
}

/**
 * How a process reads {@link PageGeometry} from a session it holds.
 *
 * Named so the engine host's handlers can take it as a parameter without
 * importing {@link readPageGeometry} — the same injection `CommandExecution`
 * gets, and for the same reason: a handler proof must be able to drive the
 * channel without a parsed document, and `packages/kernel` is the host body, so
 * its proofs must not need a native library to decide whether a handler is
 * correct.
 */
export type PageGeometryReader = (
  session: MupdfSession,
  pages: readonly number[],
) => Promise<PageGeometry>;

/**
 * Reads the named pages' effective rotations, and the document's page count.
 *
 * One pass inside one `withDocument`. A per-page call would be one native round
 * trip each, and through the remote writer one **message** each.
 *
 * @param pages zero-based indices, as `commands.ts` declares them. An index
 *   outside the document is a `RangeError` rather than a `0`: a plausible
 *   upright rotation is the reassuring answer here, and a caller that asked
 *   about a page that does not exist has a bug its renderer would draw.
 */
export function readPageGeometry(
  session: MupdfSession,
  pages: readonly number[],
): Promise<PageGeometry> {
  return withDocument(session, (document) => {
    const pageCount = document.countPages();
    // VALIDATED IN FULL BEFORE THE FIRST READ, the way `applyRotatePages`
    // validates before its first write. A half-read answer is an array whose
    // length matches the request and whose contents describe a different set of
    // pages, which nothing downstream can detect.
    for (const page of pages) {
      if (!Number.isInteger(page) || page < 0 || page >= pageCount) {
        throw new RangeError(
          `Page ${String(page)} is outside this document, which has ${String(pageCount)} ` +
            'page(s). Page indices are zero-based.',
        );
      }
    }

    const rotations = pages.map((page) => {
      const inherited = document.loadPage(page).getObject().getInheritable('Rotate');
      return inherited.isNumber() ? snapRotation(inherited.asNumber()) : 0;
    });
    return { pageCount, rotations };
  });
}
