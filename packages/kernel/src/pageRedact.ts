import { MAX_REDACT_MATCHES_PER_PAGE, type PdfRedactImages } from '@monstera/contract/host';
import type * as mupdf from './mupdfRaw.js';

import type { CaptureResult } from './commandLog.js';
import type { Apply, MupdfSession } from './engineSeam.js';
import { pruneEmptyFields } from './formFields.js';
import { withDocument, withDocumentRemoving } from './mupdfWriter.js';
import { redraw } from './pageAnnotations.js';
import { type PageScope, pagesOf } from './pageScope.js';
import { glyphLinesOf, heldToTheirLines } from './redactionQuads.js';

/**
 * Burning redact marks into the document — the other half of D3 row 131's mark.
 *
 * ## Every number here is MuPDF's own, and none of them is guessed
 *
 * `PDFPage.applyRedactions(black_boxes, image_method, line_art_method,
 * text_method)`, read from `mupdf/dist/mupdf.js` on 2026-09-12 and executed the
 * same day. The four constants that matter:
 *
 * | | |
 * |---|---|
 * | `REDACT_IMAGE_NONE` | **0 — never used here.** It leaves the covered image pixels in the file, under a black box |
 * | `REDACT_IMAGE_REMOVE` | 1 |
 * | `REDACT_IMAGE_PIXELS` | 2 |
 * | `REDACT_LINE_ART_REMOVE_IF_COVERED` | 1 |
 * | `REDACT_TEXT_REMOVE` | 0 |
 *
 * ## The two that are NOT choices, and why they are not
 *
 * **Text is always removed.** `REDACT_TEXT_NONE` exists and is the failure this
 * command is for: a redaction that draws a box over text a reader can still
 * select. Offering it would be offering the defect.
 *
 * **Line art is always removed if covered.** MuPDF's third option —
 * `REMOVE_IF_TOUCHED` — deletes a path that merely crosses the mark, which
 * takes away content nobody marked; and `NONE` leaves drawn content under the
 * cover. The middle one is the only one that means *this region*.
 *
 * Both are written as constants with the reason beside them rather than as
 * payload fields nobody would know how to set (B5 over a settings page).
 */

/** MuPDF's `pdf_redact_options` values, by the name the binding gives them. */
const IMAGE_METHOD: Readonly<Record<PdfRedactImages, number>> = {
  remove: 1,
  pixels: 2,
};

/** `REDACT_LINE_ART_REMOVE_IF_COVERED`. See the header. */
const LINE_ART_REMOVE_IF_COVERED = 1;

/** `REDACT_TEXT_REMOVE`. See the header — the other value is the defect. */
const TEXT_REMOVE = 0;

/**
 * The page indices a scope names, against a document that knows its own count.
 *
 * `'all'` stays `'all'` on the wire (invariant L11) and becomes a range here,
 * which is the one place the document's page count is known — so nothing
 * upstream has to hold a number that a command running before it could have
 * changed.
 */
function scopedPages(document: mupdf.PDFDocument, pages: PageScope): readonly number[] {
  // REFUSED rather than clamped, by `pagesOf`'s one refusal. A page index this document does not have is a renderer
  // working from a stale count, and silently skipping it would burn in some marks and report that it burned in all.
  return pagesOf(pages, document.countPages());
}

/**
 * How many redact marks a page carries.
 *
 * Read BEFORE the burn-in, because `applyRedactions` consumes them — measured
 * 2026-09-12: a page with one mark answers zero annotations afterwards. So a
 * count taken after would report every page as having had nothing to do.
 */
function redactMarksOn(page: mupdf.PDFPage): number {
  return page.getAnnotations().filter((annotation) => annotation.getType() === 'Redact').length;
}

/** Whether two rectangles in one frame share any area. */
function overlaps(a: mupdf.Rect, b: mupdf.Rect): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * Removes what the page carries OUTSIDE its content stream under a mark: every other
 * annotation and every form widget whose box overlaps one.
 *
 * `applyRedactions` rewrites the content stream and consumes the marks; it leaves
 * annotations alone — measured 2026-09-17 by `redactionLeaks.test.ts`, where a
 * field's `/V` and its appearance stream and a comment's `/Contents` all survived a
 * mark drawn over them. A burn-in that promises *this region is gone* has to take
 * them too. A deleted widget leaves its field with an empty `/Kids` still holding
 * the value, so the tree is pruned the way `deleteFormFields` prunes it.
 *
 * **Through MuPDF's own calls** — {@link boxOf} answers the marks and the objects in one
 * frame, and `deleteAnnotation` keeps the loaded page's own list in step, which an
 * edit to the raw `/Annots` array would not.
 *
 * ## NOT `getRect` on every annotation, and that was a THROWN command
 *
 * A text markup has no `/Rect`: MuPDF answers `getRect` on a `/Highlight` with *"Highlight
 * annotations have no Rect property"* and throws. This loop asked every annotation for one, so
 * **applying a redaction on any page that also carried a highlight, an underline or a strikeout
 * failed** — the command answered `internal`, the renderer showed *Something went wrong inside
 * Monstera*, and nothing said which object it had tripped over. Found by a live run on 2026-09-20,
 * on a page marked from the selected-text menu; reproduced with the region tool on the same page,
 * so it belongs to the burn-in rather than to either gesture.
 *
 * The page's own read-back already knew — `pageAnnotations.ts` records that `hasRect()` is false on
 * all three markups, which is why the eraser and the select tool see them through `getBounds`. So
 * this asks the same question the same way.
 *
 * **LINKS ARE NOT HERE, because the engine already removes them.** Measured
 * 2026-09-17: with a link-removal loop disabled, and with links also excluded from
 * the loop below, a `/URI` carrying the secret under the mark was still gone after
 * `applyRedactions` — while the control, a mark elsewhere, kept it. A second removal
 * would be a second opinion about what the burn-in already decides.
 */
function removeCoveredObjects(document: mupdf.PDFDocument, page: mupdf.PDFPage, deleted: Set<number>): void {
  const annotations = page.getAnnotations();
  // A TEXT MARK IS ITS QUADS, as the burn-in reads it: its /Rect is their union, which on a mark over several lines
  // spans the unselected starts and ends of its first and last lines, and an annotation there is not under the mark.
  const marks = annotations
    .filter((annotation) => annotation.getType() === 'Redact')
    .flatMap((annotation) => {
      const quads = annotation.getQuadPoints();
      return quads.length === 0 ? [boxOf(annotation)] : quads.map(rectOfQuad);
    });
  const covered = (box: mupdf.Rect): boolean => marks.some((mark) => overlaps(mark, box));

  const remove = (annotation: mupdf.PDFAnnotation | mupdf.PDFWidget): void => {
    const object = annotation.getObject();
    if (object.isIndirect()) deleted.add(object.asIndirect());
    page.deleteAnnotation(annotation);
  };
  for (const annotation of annotations) {
    if (annotation.getType() !== 'Redact' && covered(boxOf(annotation))) remove(annotation);
  }
  for (const widget of page.getWidgets()) {
    if (covered(boxOf(widget))) remove(widget);
  }
  pruneEmptyFields(document);
}

/** The text a structure element or a marked-content property list carries beside the content it tags. */
const TEXT_ALTERNATES = ['Alt', 'ActualText', 'E', 'T'] as const;

/** Each value a number tree holds under `key`, read from `/Nums` and every `/Kids` below (ISO 32000-1 §7.9.7). */
function numberTreeValues(tree: mupdf.PDFObject, key: number): mupdf.PDFObject[] {
  const found: mupdf.PDFObject[] = [];
  const seen = new Set<number>();
  const pending = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (!node.isDictionary() || (node.isIndirect() && seen.has(node.asIndirect()))) continue;
    if (node.isIndirect()) seen.add(node.asIndirect());
    const nums = node.get('Nums');
    for (let at = 0; at + 1 < nums.length; at += 2) {
      if (nums.get(at).asNumber() === key) found.push(nums.get(at + 1));
    }
    node.get('Kids').forEach((kid) => pending.push(kid));
  }
  return found;
}

/** What a page's content is drawn through: each resources dictionary it reads, and each Form XObject it draws. */
interface ContentReads {
  readonly resources: readonly mupdf.PDFObject[];
  /** By object number. */
  readonly forms: ReadonlyMap<number, mupdf.PDFObject>;
}

/** A page the burn-in rewrote, with what its content read before MuPDF's filter ran and what it reads after. */
interface BurnedPage {
  readonly page: mupdf.PDFObject;
  readonly before: ContentReads;
  readonly after: ContentReads;
}

/**
 * The resources `page` is drawn with, its own or the nearest ancestor's (`getInheritable`, ISO 32000-1 §7.7.3.4),
 * and every Form XObject reachable through them with the resources each carries.
 *
 * **Read before the burn-in as well as after, because MuPDF's filter replaces them.** Measured 2026-10-05 against
 * MuPDF 1.28.0: the filter gives the burned page a resources dictionary of its own and a filtered copy of each form it
 * draws, and leaves the dictionaries the page read where they were. Those are the ones that hold a property list's
 * copy of the removed text when it is inherited from `/Pages` or shared with another page, and nothing after the
 * filter leads back to them.
 */
function contentReads(page: mupdf.PDFObject): ContentReads {
  const resources: mupdf.PDFObject[] = [];
  const forms = new Map<number, mupdf.PDFObject>();
  const pending = [page.getInheritable('Resources')];
  for (let dictionary = pending.pop(); dictionary !== undefined; dictionary = pending.pop()) {
    if (!dictionary.isDictionary()) continue;
    resources.push(dictionary);
    dictionary.get('XObject').forEach((xobject) => {
      if (!xobject.isIndirect() || String(xobject.get('Subtype')) !== '/Form' || forms.has(xobject.asIndirect())) return;
      forms.set(xobject.asIndirect(), xobject);
      pending.push(xobject.get('Resources'));
    });
  }
  return { resources, forms };
}

/**
 * Takes every copy of a burned page's text that sits outside its content (ADR-0163 and its 2026-10-05 correction).
 *
 * - **The structure tree's references to an annotation the burn-in deleted**, which kept it alive through the
 *   collection with its `/Contents`; the element that held one counts as tagging the page.
 * - **The text alternates of every element tagging a burned page, and of its ancestors**, found through the parent
 *   tree's entry for each content stream the page drew: its own `/StructParents`, and each Form XObject's, which is how
 *   the format maps marked content inside a form. MuPDF's filter edits these for the characters it removes, and writes
 *   the edited `/ActualText` into `/Alt` (`pdf-op-filter.c` 1.28.0, line 872), so the original stays; which element
 *   held which removed character it does not report, so the page is the unit.
 * - **The element's reference to a form the page no longer draws.** The filter draws a filtered copy carrying the
 *   same `/StructParents`, and an element's `/Stm` naming the original kept that original, removed text and all,
 *   through the collection; it is pointed at the copy, or dropped where the page draws none.
 * - **The alternates in every named property list the page read**, by the same reason, IN PLACE. The filter copies a
 *   list it keeps into the page's new resources as the same object (`copy_resource`, `pdf-op-filter.c`), and drops,
 *   copying nothing, a tag none of whose content it wrote, so a list is reached through the dictionaries read before
 *   the filter as well as after. Those are now read only by other pages, so a copy kept for them kept the removed
 *   text in the file; another page that reads the same list loses its alternates too, which is the stated cost.
 * - **`/PieceInfo`**, the page's and the catalogue's, and **the outline**, which no region maps to.
 */
function removeOtherCopies(document: mupdf.PDFDocument, burned: readonly BurnedPage[], deleted: ReadonlySet<number>): void {
  const root = document.getTrailer().get('Root');
  const tagging: mupdf.PDFObject[] = [];
  const structure = root.get('StructTreeRoot');
  if (structure.isDictionary()) {
    tagging.push(...withoutReferencesTo(structure, deleted));
    for (const { page, before, after } of burned) {
      const tagged: mupdf.PDFObject[] = [];
      for (const stream of [page, ...before.forms.values(), ...after.forms.values()]) {
        const parents = stream.get('StructParents');
        if (!parents.isNumber()) continue;
        for (const value of numberTreeValues(structure.get('ParentTree'), parents.asNumber())) {
          if (value.isArray()) value.forEach((element) => tagged.push(element));
          else tagged.push(value);
        }
      }
      for (const element of tagged) towardsDrawnForms(element, page, before, after);
      tagging.push(...tagged);
    }
  }
  const stripped = new Set<number>();
  for (let element = tagging.pop(); element !== undefined; element = tagging.pop()) {
    if (!element.isDictionary() || String(element.get('Type')) === '/StructTreeRoot') continue;
    if (element.isIndirect()) {
      if (stripped.has(element.asIndirect())) continue;
      stripped.add(element.asIndirect());
    }
    for (const key of TEXT_ALTERNATES) element.delete(key);
    tagging.push(element.get('P'));
  }

  for (const { page, before, after } of burned) {
    page.delete('PieceInfo');
    for (const resources of [...before.resources, ...after.resources]) {
      resources.get('Properties').forEach((list) => {
        if (list.isDictionary()) for (const key of TEXT_ALTERNATES) list.delete(key);
      });
    }
  }
  root.delete('PieceInfo');
  root.delete('Outlines');
  if (String(root.get('PageMode')) === '/UseOutlines') root.delete('PageMode');
}

/**
 * Gives every named destination a neutral name, and every reference to one the same new name, so a destination whose
 * name spells the redacted text no longer does and each link still lands where it did (ADR-0163, the owner's answer
 * of 2026-10-05).
 *
 * **Every name, not the ones that match.** Which names restate the removed text is not known here, as it is not for the
 * outline, so the burn-in renames all of them. The names live in the catalogue's `/Dests` (keys are names) and the
 * `/Names` tree's `/Dests` (keys are strings); a name in both gets one new name in both, and the tree is rebuilt as a
 * single sorted node, which the format allows at any size.
 *
 * **The references are found by walking every object**, because a destination is named from places with no common
 * parent: a link's `/Dest`, a GoTo action's `/D` (on a link, a field, a page's or the document's additional actions,
 * the open action, any `/Next` chain), and the trailer. A reference to a name defined nowhere is renamed too, since it
 * spells its text as well and goes nowhere either way. A **GoToR** or **GoToE** action names a destination in ANOTHER
 * file, so it is left: renaming it would break the link without touching this document's names.
 *
 * The old tree's nodes and the old dictionary are left unreferenced, and the removing save collects them.
 */
function renameDestinations(document: mupdf.PDFDocument): void {
  const root = document.getTrailer().get('Root');
  const renamed = new Map<string, string>();
  const neutral = (name: string): string => {
    const known = renamed.get(name);
    if (known !== undefined) return known;
    const next = `D${String(renamed.size + 1)}`;
    renamed.set(name, next);
    return next;
  };

  const dests = root.get('Dests');
  if (dests.isDictionary()) {
    const fresh = document.newDictionary();
    dests.forEach((value, key) => {
      fresh.put(neutral(String(key)), value);
    });
    root.put('Dests', fresh);
  }
  const names = root.get('Names');
  if (names.isDictionary() && names.get('Dests').isDictionary()) {
    const entries = Object.entries(document.loadNameTree('Dests')).map(([name, value]) => [neutral(name), value] as const);
    // SORTED BY KEY, which a name tree's lookup assumes.
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const flat = document.newArray();
    for (const [name, value] of entries) {
      flat.push(document.newString(name));
      flat.push(value);
    }
    const tree = document.newDictionary();
    tree.put('Names', flat);
    names.put('Dests', tree);
  }

  const renamedValue = (value: mupdf.PDFObject): mupdf.PDFObject | undefined => {
    if (value.isName()) return document.newName(neutral(value.asName()));
    if (value.isString()) return document.newString(neutral(value.asString()));
    return undefined;
  };
  const visit = (object: mupdf.PDFObject): void => {
    if (object.isDictionary()) {
      const dest = renamedValue(object.get('Dest'));
      if (dest !== undefined) object.put('Dest', dest);
      if (String(object.get('S')) === '/GoTo') {
        const target = renamedValue(object.get('D'));
        if (target !== undefined) object.put('D', target);
      }
    }
    // DIRECT CHILDREN ONLY: every indirect object is visited once by the loop below, so following one here would
    // rename its references twice.
    if (object.isDictionary() || object.isArray()) {
      object.forEach((child) => {
        if (!child.isIndirect()) visit(child);
      });
    }
  };
  for (let number = 1; number < document.countObjects(); number += 1) visit(document.newIndirect(number).resolve());
  visit(document.getTrailer());
}

/**
 * Points each marked-content reference of `element` that is on `page`, and names a form the page drew before the
 * burn-in and no longer draws, at the filtered copy carrying the same `/StructParents`. A reference on another page
 * is that page's, and is left.
 *
 * **One with no copy is removed**, and an element left with no content loses its `/K`, so the original is not kept
 * alive. No input reaches that branch on MuPDF 1.28.0, measured 2026-10-05: a form the mark empties entirely is still
 * drawn as a copy of no length that keeps its `/StructParents`. It stays because the original holds the removed text,
 * and a filter that ever drops the form would otherwise keep it through the structure tree.
 */
function towardsDrawnForms(element: mupdf.PDFObject, page: mupdf.PDFObject, before: ContentReads, after: ContentReads): void {
  if (!element.isDictionary()) return;
  const replaced = (kid: mupdf.PDFObject): boolean => {
    if (!kid.isDictionary() || String(kid.get('Type')) !== '/MCR') return false;
    const stream = kid.get('Stm');
    const on = kid.get('Pg').isNull() ? element.get('Pg') : kid.get('Pg');
    return (
      stream.isIndirect() &&
      before.forms.has(stream.asIndirect()) &&
      !after.forms.has(stream.asIndirect()) &&
      on.isIndirect() &&
      on.asIndirect() === page.asIndirect()
    );
  };
  /** The form the page draws now in place of `kid`'s, or `undefined` where it draws none. */
  const copyOf = (kid: mupdf.PDFObject): mupdf.PDFObject | undefined => {
    const parents = kid.get('Stm').get('StructParents');
    if (!parents.isNumber()) return undefined;
    return [...after.forms.values()].find((form) => {
      const own = form.get('StructParents');
      return own.isNumber() && own.asNumber() === parents.asNumber();
    });
  };
  const kids = element.get('K');
  if (kids.isArray()) {
    for (let at = kids.length - 1; at >= 0; at -= 1) {
      const kid = kids.get(at);
      if (!replaced(kid)) continue;
      const copy = copyOf(kid);
      if (copy === undefined) kids.delete(at);
      else kid.put('Stm', copy);
    }
    if (kids.length === 0) element.delete('K');
  } else if (replaced(kids)) {
    const copy = copyOf(kids);
    if (copy === undefined) element.delete('K');
    else kids.put('Stm', copy);
  }
}

/**
 * Removes every object reference (`/OBJR`) in the structure tree to one of `deleted`, and answers the elements that
 * held one. An element left with no content loses its `/K`.
 */
function withoutReferencesTo(structure: mupdf.PDFObject, deleted: ReadonlySet<number>): mupdf.PDFObject[] {
  const held: mupdf.PDFObject[] = [];
  if (deleted.size === 0) return held;
  const names = (kid: mupdf.PDFObject): boolean => {
    const target = kid.get('Obj');
    return String(kid.get('Type')) === '/OBJR' && target.isIndirect() && deleted.has(target.asIndirect());
  };
  const seen = new Set<number>();
  const pending = [structure];
  for (let element = pending.pop(); element !== undefined; element = pending.pop()) {
    if (!element.isDictionary() || (element.isIndirect() && seen.has(element.asIndirect()))) continue;
    if (element.isIndirect()) seen.add(element.asIndirect());
    const kids = element.get('K');
    if (kids.isArray()) {
      let removed = false;
      for (let at = kids.length - 1; at >= 0; at -= 1) {
        const kid = kids.get(at);
        if (kid.isDictionary() && names(kid)) {
          kids.delete(at);
          removed = true;
        } else {
          pending.push(kid);
        }
      }
      if (removed) held.push(element);
      if (kids.length === 0) element.delete('K');
    } else if (kids.isDictionary() && names(kids)) {
      element.delete('K');
      held.push(element);
    } else {
      pending.push(kids);
    }
  }
  return held;
}

/**
 * Where an annotation is, for a kind that may carry no `/Rect`.
 *
 * See {@link removeCoveredObjects} for what asking the wrong way cost. `getBounds` answers for
 * every kind — it is the box MuPDF draws the object in — and for one that does have a rect the two
 * agree, so this is not a second opinion about placement but the one question asked safely.
 */
function boxOf(annotation: mupdf.PDFAnnotation | mupdf.PDFWidget): mupdf.Rect {
  return annotation.hasRect() ? annotation.getRect() : annotation.getBounds();
}

/** The box that contains a quad: MuPDF's `fz_rect_from_quad`, which is how the burn-in reads each one. */
function rectOfQuad(quad: mupdf.Quad): mupdf.Rect {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Burns every redact mark on the scoped pages into the document.
 *
 * **`withDocumentRemoving`**, which is what makes the next serialise collect.
 * §4 puts redaction on the removal row by name, and ADR-0008 rule 1 says why:
 * an incremental save leaves the covered content readable by walking the xref
 * chain. This is the one command where getting that wrong produces a document
 * that looks redacted and is not.
 *
 * ## And the content stream is not the only copy (ADR-0079)
 *
 * The leak corpus measured four other places a redacted secret survived: an
 * annotation or a field under the mark (removed above), a page's `/Thumb`, which is
 * a picture of the page as it was, and the document's XMP packet and Info
 * dictionary. The metadata cannot be matched to a region, so a burn-in removes it
 * whole — see the ADR for what that costs and the question left for the owner.
 * [ADR-0163](../../../docs/DECISIONS/0163-a-burn-in-also-takes-the-outline-the-tags-text-and-private-data.md)
 * measured four more, which {@link removeOtherCopies} takes, and one that only MuPDF can reach: an inline
 * `/ActualText` in the content stream.
 */
export const applyApplyRedactions: Apply<'mupdf', 'applyRedactions'> = (session, command) =>
  withDocumentRemoving(session, (document) => {
    const burnedPages: BurnedPage[] = [];
    const deleted = new Set<number>();
    for (const index of scopedPages(document, command.pages)) {
      const page = document.loadPage(index);
      // A PAGE WITH NO MARKS IS SKIPPED rather than redacted with nothing.
      // `applyRedactions` on a page with no `/Redact` rewrites its content
      // stream for no reason, which on a document-wide pass is every page.
      if (redactMarksOn(page) === 0) continue;
      removeCoveredObjects(document, page, deleted);
      const pageObject = page.getObject();
      const before = contentReads(pageObject);
      page.applyRedactions(
        command.cover === 'solid',
        IMAGE_METHOD[command.images],
        LINE_ART_REMOVE_IF_COVERED,
        TEXT_REMOVE,
      );
      pageObject.delete('Thumb');
      pageObject.delete('Metadata');
      burnedPages.push({ page: pageObject, before, after: contentReads(pageObject) });
    }
    if (burnedPages.length > 0) {
      removeOtherCopies(document, burnedPages, deleted);
      renameDestinations(document);
      // READ BEFORE THE DELETE, and only when it is wanted: `/Title` has to come
      // out of the dictionary this is about to remove.
      const kept = command.keepTitle ? titleOf(document) : undefined;
      document.getTrailer().get('Root').delete('Metadata');
      document.getTrailer().delete('Info');
      // A FRESH INFO CARRYING ONE KEY, never the original kept and pruned. The
      // dictionary a document arrives with may hold entries nothing here names —
      // a producer string, a creation date, a private key — and editing it in
      // place would keep whichever of those this build has not thought about.
      // Building a new one makes the set that survives exactly the set written
      // here, which is the difference between a filter and an allowlist.
      if (kept !== undefined) {
        const info = document.newDictionary();
        info.put('Title', document.newString(kept));
        document.getTrailer().put('Info', document.addObject(info));
      }
    }
  });

/**
 * The document's `/Title`, or `undefined` when it has none worth keeping.
 *
 * `undefined` rather than an empty string for the absent case, so the caller
 * writes no Info at all rather than one carrying an empty title — a dictionary
 * that exists to hold a value it does not have is a difference a reader would
 * have to explain.
 */
function titleOf(document: mupdf.PDFDocument): string | undefined {
  const info = document.getTrailer().get('Info');
  if (info.isNull() || !info.isDictionary()) return undefined;
  const title = info.get('Title');
  if (title.isNull() || !title.isString()) return undefined;
  const text = title.asString();
  return text === '' ? undefined : text;
}

/**
 * A COUNT IS NOT OFFERED, and this is the record of that rather than an
 * omission.
 *
 * *Burn in 4 marks on 2 pages* is a better confirm sentence than *are you
 * sure*, and it is reachable: this module could count the same annotations the
 * apply walks. What it would cost is a query channel of its own — the session
 * is in the contained host — and what it would buy is a number beside a
 * sentence that already says the thing that matters, which is that the content
 * goes and the undo is a checkpoint.
 *
 * So the dialog names the **scope** and what redaction does, and claims no
 * number it cannot support. The trigger for revisiting it is a second caller:
 * the moment anything else needs to know how many marks a document carries,
 * the channel is owed anyway and this becomes free.
 */

/**
 * Marks every occurrence of a term for redaction.
 *
 * ## The geometry comes from MuPDF's OWN search, and that is not a second
 * opinion
 *
 * `textSearch.ts`'s header records that it deliberately does not call MuPDF's
 * `search`, and gives the reason: the application's search spans line breaks
 * and consumes the one structure that export and extraction also consume. It
 * also records that **the two answer different questions** — *where in this
 * document's text*, as a line and an offset, against *where on this page*, as
 * quads.
 *
 * This is the caller that needs the second question. A mark built from a line
 * and an offset would cover the whole **line**, because the substrate reports
 * no per-character geometry — so a search for a name would redact the sentence
 * around it. Measured 2026-09-12: `page.search` answers a hit whose box is
 * x 46.0–91.5 inside a line whose box is x 20 and 333 wide.
 *
 * ## A hit is a LIST of quads, and each one gets its own mark
 *
 * MuPDF answers one hit as an array of quads, because a match that wraps is two
 * boxes on two lines. Marking the union of them would cover everything between,
 * which on a wrap is the right-hand end of one line and the left of the next —
 * and everything in between is the rest of both.
 */
export const applyMarkMatchesForRedaction: Apply<'mupdf', 'markMatchesForRedaction'> = (
  session,
  command,
) =>
  withDocument(session, (document) => {
    // EVERY PAGE IS SEARCHED BEFORE ANY PAGE IS MARKED (GGGGGG-12). This marked
    // page by page until 2026-09-13, so a refusal on page 7 left pages 0–6 marked
    // while its message said *nothing was marked* — true of the page that threw,
    // false of the document, and the apply has no rollback. Two passes make the
    // sentence true of the whole command.
    const searched = scopedPages(document, command.pages).map((index) => {
      const page = document.loadPage(index);
      return { index, page, hits: page.search(command.query, MAX_REDACT_MATCHES_PER_PAGE) };
    });
    for (const { index, hits } of searched) {
      if (hits.length >= MAX_REDACT_MATCHES_PER_PAGE) {
        // REFUSED, NOT TRUNCATED. MuPDF answers up to `max_hits` and says nothing
        // about whether it stopped, so a full result and a capped one are the
        // same value — and for a redaction, *some matches were not marked* is
        // the failure the feature exists to prevent. Marking a prefix would
        // report success.
        throw new Error(
          `page ${String(index)} carries at least ${String(MAX_REDACT_MATCHES_PER_PAGE)} ` +
            `matches for this term, which is the point past which this build cannot tell a ` +
            `complete result from a truncated one. Nothing was marked.`,
        );
      }
    }
    for (const { page, hits } of searched) {
      // HELD TO THEIR LINES (2a), for the text mark's reason: a search quad is its line's full font box, which on
      // closely set text reaches the boxes of the lines beside it. Read only for a page with a match.
      const lines = hits.length === 0 ? [] : glyphLinesOf(page.toStructuredText());
      for (const hit of hits) {
        for (const quad of heldToTheirLines(hit, lines)) {
          const annotation = page.createAnnotation('Redact');
          // THE QUAD'S OWN BOUNDS. MuPDF answers eight numbers — four corners,
          // upper-left first — and a `/Redact` takes a rectangle, so the mark
          // is the box that contains the quad. On an unrotated page they are
          // the same four numbers; on a rotated one the containing box is what
          // a rectangle can say.
          annotation.setRect(rectOfQuad(quad));
          redraw(annotation, document);
        }
      }
    }
  });

/**
 * Reports that marking by search has no prior state worth recording.
 *
 * `addAnnotation` inverts because it adds exactly one annotation and knows
 * where. This adds as many as the document has matches, and an inverse would
 * have to name every one of them in a walk its own creation moved — which is
 * `deleteFormFields`' shape without its bound.
 */
export const captureMarkMatchesForRedaction = (
  session: MupdfSession,
): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'marking by search adds one annotation per match, and an inverse would have to name every ' +
      'one of them in a walk the creation itself moved',
  }));

/** Refuses to invert, for {@link captureMarkMatchesForRedaction}'s reason. */
export const invertMarkMatchesForRedaction = (): never => {
  throw new Error(
    'markMatchesForRedaction is declared non-invertible. Undo restores the checkpoint.',
  );
};

/**
 * Reports that a burn-in's prior state is not recorded.
 *
 * **The one refusal in this codebase where recording would be the defect.**
 * Every other `captured: false` here is about size; this is about what the
 * prior state *is* — the content somebody asked to have removed. A capture is
 * serialised into main's command log, so recording it would put the redacted
 * text back in memory under a command whose whole purpose was taking it out.
 */
export const captureApplyRedactions = (session: MupdfSession): Promise<CaptureResult<never>> =>
  withDocument(session, () => ({
    captured: false,
    reason:
      'a burned-in redaction cannot be recorded as prior state: the prior state is the content ' +
      'that was removed, and a capture is serialised into the command log',
  }));

/**
 * Refuses to invert, for {@link captureApplyRedactions}'s reason.
 *
 * `CommandPrior['applyRedactions']` is `never`, so this is unreachable by
 * construction and exists because the spec table requires the member.
 */
export const invertApplyRedactions = (): never => {
  throw new Error(
    'applyRedactions is declared non-invertible: its prior state is the content it removed, ' +
      'which must never reach the command log. Undo restores the checkpoint.',
  );
};
