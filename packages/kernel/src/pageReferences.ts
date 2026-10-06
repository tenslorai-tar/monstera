import type { PDFDocument, PDFObject } from './mupdfRaw.js';

/**
 * How deep the walks that follow NESTING go: the outline, the structure tree, an action's `/Next` and a name tree.
 *
 * A bound rather than none, for `destinations.ts`' reason: the document is hostile by invariant 25's premise, and a
 * nesting a walk recurses into is one stack frame per level, so a crafted one runs out of stack and the delete throws.
 * Past the bound a walk leaves what is below as it is, and the null walk, which is a worklist and has no depth, still
 * frees the page. 256 is far past any authored outline or tagged document; the length of a list is not depth and is
 * not bounded.
 */
const MAX_NESTING = 256;

/**
 * What a document holds of pages it no longer has: nothing
 * ([ADR-0155](../../../docs/DECISIONS/0155-a-page-that-leaves-takes-every-reference-to-it.md); the owner's 12a
 * follow-up and L1).
 *
 * ## Why every reference, and not only the page tree
 *
 * A page delete rewrites `/Kids`, and a collecting save drops only what nothing reaches. Measured 2026-10-04 with
 * MuPDF 1.28.0: each of twenty-two kinds of reference (an outline entry, a link, a named destination, `/OpenAction`,
 * a structure element's `/Pg`, a thread bead, a reply's `/IRT`, a GoTo inside another action's `/Next` and the rest
 * of ADR-0155's table) kept the deleted page and the text it draws in the saved file. And each one a person can see
 * is drawn and goes nowhere. So a page is not gone until every structure that names it has let go of it, each the way
 * its own structure says.
 *
 * ## Outside means outside the TREE, so one rule serves every command
 *
 * A page is outside when it is a page dictionary that is neither a leaf of the page tree nor a named template
 * (`/Names /Templates`, whose pages are outside the tree by the format's own design). That is the same question after
 * a delete, a replace, a merge whose grafted links named pages it did not take, the undo of an insert, and an
 * extract's new file, so they all call this, after the tree is rewritten.
 *
 * ## The order is the dependencies'
 *
 * Named destinations are read whole first, so a link by name is judged against the names as they were. Threads go
 * before annotations, because a Thread action names a bead. Annotations go before structure, because an object
 * reference to a link that went must go too. Structure goes before the outline, the catalog and the second pass over
 * the annotations' actions, because a GoTo's `/SD` and an outline's `/SE` name structure elements. The null walk is
 * last and catches whatever no step names.
 *
 * @param successors a page outside the tree that another now stands for, by object number: for *Replace page* the page
 *   that took a replaced page's place, and for every graft the page placed for a source page's stray copy. A
 *   destination naming one names its successor instead (ADR-0155 decision 3 and its correction); everything else that
 *   named it is cleared as for a delete
 */
export function releasePagesOutsideTree(
  document: PDFDocument,
  successors: ReadonlyMap<number, PDFObject> = new Map(),
): void {
  const root = document.getTrailer().get('Root');
  if (!root.isDictionary()) return;

  const keptPages: PDFObject[] = [];
  const kept = new Set<number>();
  for (let index = 0; index < document.countPages(); index += 1) {
    const page = document.findPage(index);
    keptPages.push(page);
    kept.add(page.asIndirect());
  }
  const names = root.get('Names');
  const templates = new Set<number>();
  if (names.isDictionary()) {
    eachEntry(names.get('Templates'), 'Names', (value) => {
      if (value.isIndirect()) templates.add(value.asIndirect());
    });
  }
  const verdicts = new Map<number, boolean>();
  /** Is this a reference to a page the document no longer holds? */
  const outside = (value: PDFObject): boolean => {
    if (!value.isIndirect()) return false;
    const number = value.asIndirect();
    const known = verdicts.get(number);
    if (known !== undefined) return known;
    const verdict = !kept.has(number) && !templates.has(number) && nameOf(value.get('Type')) === 'Page';
    verdicts.set(number, verdict);
    return verdict;
  };

  // THE NAMES AS THEY WERE, before any entry is removed, so a destination by name is judged by what it named.
  const named = new Map<string, PDFObject>();
  const dests = root.get('Dests');
  if (dests.isDictionary()) {
    dests.forEach((value, key) => {
      named.set(String(key), value);
    });
  }
  if (names.isDictionary()) {
    eachEntry(names.get('Dests'), 'Names', (value, key) => {
      named.set(String(key), value);
    });
  }

  /** The page a destination names: an explicit array's first entry, through a name, or a dictionary's `/D`. */
  const target = (dest: PDFObject, depth = 0): PDFObject | undefined => {
    if (depth > 2) return undefined;
    if (dest.isArray()) {
      const page = dest.get(0);
      return page.isDictionary() ? page : undefined;
    }
    if (dest.isString() || dest.isName()) {
      const value = named.get(dest.isString() ? dest.asString() : dest.asName());
      return value === undefined ? undefined : target(value, depth + 1);
    }
    if (dest.isDictionary()) return target(dest.get('D'), depth + 1);
    return undefined;
  };
  /** Writes `successor` where `dest`'s explicit array names its page, however `dest` reaches that array. */
  const repoint = (dest: PDFObject, successor: PDFObject, depth = 0): void => {
    if (depth > 2) return;
    if (dest.isArray()) dest.put(0, successor);
    else if (dest.isString() || dest.isName()) {
      const value = named.get(dest.isString() ? dest.asString() : dest.asName());
      if (value !== undefined) repoint(value, successor, depth + 1);
    } else if (dest.isDictionary()) repoint(dest.get('D'), successor, depth + 1);
  };
  /**
   * Does this destination name a page the document no longer holds? A replaced page's destination is pointed at its
   * successor first, and then it does not.
   */
  const leadsOutside = (dest: PDFObject): boolean => {
    const page = target(dest);
    if (page === undefined || !outside(page)) return false;
    const successor = successors.get(page.asIndirect());
    if (successor === undefined) return true;
    repoint(dest, successor);
    return false;
  };

  const annotationsOf = (page: PDFObject): PDFObject => page.get('Annots');
  const onKeptPages = new Set<number>();
  for (const page of keptPages) {
    const annots = annotationsOf(page);
    if (!annots.isArray()) continue;
    for (let at = 0; at < annots.length; at += 1) {
      const annotation = annots.get(at);
      if (annotation.isIndirect()) onKeptPages.add(annotation.asIndirect());
    }
  }
  /**
   * Did this annotation leave with its page? It is not on a kept page, and its `/P`, where it has one, is not a kept
   * page either. A dictionary that is not an annotation (a field, an XObject) never left by this rule.
   */
  const left = (value: PDFObject): boolean => {
    if (!value.isIndirect() || !isAnnotation(value) || onKeptPages.has(value.asIndirect())) return false;
    const page = value.get('P');
    return page.isNull() || !(page.isIndirect() && kept.has(page.asIndirect()));
  };

  const removedBeads = new Set<number>();
  const removedThreads = new Set<number>();
  const removedElements = new Set<number>();

  /** Is this action one that names what left: a GoTo to an outside page, a Thread to a removed bead, a Hide of none? */
  const drops = (action: PDFObject): boolean => {
    const type = nameOf(action.get('S'));
    if (type === 'GoTo') {
      const structure = action.get('SD');
      if (structure.isArray() && structure.get(0).isIndirect() && removedElements.has(structure.get(0).asIndirect())) {
        action.delete('SD');
      }
      return leadsOutside(action.get('D'));
    }
    if (type === 'Thread') {
      const bead = action.get('B');
      if (bead.isIndirect() && (removedBeads.has(bead.asIndirect()) || outside(bead.get('P')))) return true;
      const thread = action.get('D');
      return thread.isIndirect() && removedThreads.has(thread.asIndirect());
    }
    if (type === 'Hide') {
      const targets = action.get('T');
      if (!targets.isArray()) return left(targets);
      for (let at = targets.length - 1; at >= 0; at -= 1) if (left(targets.get(at))) targets.delete(at);
      return targets.length === 0;
    }
    // EVERY OTHER ACTION names no page this decides about: a URI, a launch, a named action, a remote GoTo.
    return false;
  };
  const chain = (action: PDFObject): Pruned => pruneChain(document, action, drops, new Set(), 0);
  /** Prunes `key`'s chain on `holder`, deleting the key when nothing is left; answers whether it had one and lost it. */
  const pruneKey = (holder: PDFObject, key: string): boolean => {
    const action = holder.get(key);
    if (action.isNull()) return false;
    const result = chain(action);
    if (result.kind === 'gone') holder.delete(key);
    else if (result.kind === 'replaced') holder.put(key, result.by);
    return result.kind === 'gone';
  };
  /** Every additional action on `holder` (`/AA`), and the dictionary itself once it holds none. */
  const pruneAdditional = (holder: PDFObject): void => {
    const additional = holder.get('AA');
    if (!additional.isDictionary()) return;
    const keys: string[] = [];
    additional.forEach((_value, key) => {
      keys.push(String(key));
    });
    let remaining = keys.length;
    for (const key of keys) if (pruneKey(additional, key)) remaining -= 1;
    if (remaining === 0) holder.delete('AA');
  };

  // THREADS: a bead on an outside page is unlinked, and a thread with none left goes. A bead marks an area of the old
  // page's content, so a replaced page's beads do not follow its successor.
  const threads = root.get('Threads');
  if (threads.isArray()) {
    for (let at = threads.length - 1; at >= 0; at -= 1) {
      const thread = threads.get(at);
      if (!thread.isDictionary()) continue;
      const beads: PDFObject[] = [];
      const seen = new Set<number>();
      for (let bead = thread.get('F'); bead.isIndirect() && !seen.has(bead.asIndirect()); bead = bead.get('N')) {
        seen.add(bead.asIndirect());
        beads.push(bead);
      }
      const staying = beads.filter((bead) => !outside(bead.get('P')));
      if (staying.length === beads.length) continue;
      for (const bead of beads) if (!staying.includes(bead)) removedBeads.add(bead.asIndirect());
      if (staying.length === 0) {
        if (thread.isIndirect()) removedThreads.add(thread.asIndirect());
        threads.delete(at);
        continue;
      }
      staying.forEach((bead, index) => {
        bead.put('N', staying[(index + 1) % staying.length]);
        bead.put('V', staying[(index - 1 + staying.length) % staying.length]);
      });
      const first = staying[0];
      if (first !== undefined) {
        thread.put('F', first);
        first.put('T', thread);
      }
    }
    if (threads.length === 0) root.delete('Threads');
  }

  // ANNOTATIONS ON THE PAGES THAT STAY. A link that goes nowhere goes, by MuPDF's own rule (`pdf-clean-file.c`'s link
  // loop); a popup whose parent left goes; a reply to a comment that left stays as a comment of its own; a `/P` naming
  // an outside page names the page that holds it.
  const removedAnnotations = new Set<number>();
  for (const page of keptPages) {
    const annots = annotationsOf(page);
    if (!annots.isArray()) continue;
    for (let at = annots.length - 1; at >= 0; at -= 1) {
      const annotation = annots.get(at);
      if (!annotation.isDictionary()) continue;
      const subtype = nameOf(annotation.get('Subtype'));
      let goes = false;
      if (subtype === 'Link') {
        const dest = annotation.get('Dest');
        const lostAction = pruneKey(annotation, 'A');
        goes = (!dest.isNull() && leadsOutside(dest)) || (lostAction && dest.isNull());
      } else if (subtype === 'Popup') {
        goes = left(annotation.get('Parent'));
      }
      if (goes) {
        if (annotation.isIndirect()) removedAnnotations.add(annotation.asIndirect());
        annots.delete(at);
        continue;
      }
      if (subtype !== 'Link') pruneKey(annotation, 'A');
      pruneAdditional(annotation);
      if (left(annotation.get('IRT'))) {
        annotation.delete('IRT');
        annotation.delete('RT');
      }
      if (outside(annotation.get('P'))) annotation.put('P', page);
    }
  }
  /** Did this annotation leave, with its page or as a link that went nowhere? */
  const gone = (value: PDFObject): boolean =>
    value.isIndirect() && (removedAnnotations.has(value.asIndirect()) || left(value));

  // THE STRUCTURE TREE: a content item on an outside page goes, and an element left holding no content goes with its
  // `/ParentTree` and `/IDTree` entries. An element that keeps content elsewhere loses only a `/Pg` naming an outside
  // page, since its remaining items carry their own.
  const structure = root.get('StructTreeRoot');
  if (structure.isDictionary()) {
    const seen = new Set<number>();
    const stays = (element: PDFObject, page: PDFObject | undefined, depth: number): boolean => {
      // NOT AN ELEMENT (a null in `/K`, a number at the root), so nothing here to judge: `get` on the shared Null throws.
      if (depth > MAX_NESTING || !element.isDictionary()) return true;
      if (element.isIndirect()) {
        if (seen.has(element.asIndirect())) return true;
        seen.add(element.asIndirect());
      }
      const own = element.get('Pg');
      const onPage = own.isNull() ? page : own;
      const kids = element.get('K');
      const keepsKid = (kid: PDFObject): boolean => {
        if (kid.isNumber()) return onPage === undefined || !outside(onPage);
        if (!kid.isDictionary()) return true;
        const type = nameOf(kid.get('Type'));
        if (type === 'MCR' || type === 'OBJR') {
          const kidPage = kid.get('Pg').isNull() ? onPage : kid.get('Pg');
          if (kidPage !== undefined && outside(kidPage)) return false;
          return !(type === 'OBJR' && gone(kid.get('Obj')));
        }
        return stays(kid, onPage, depth + 1);
      };
      let holdsContent = true;
      if (kids.isArray()) {
        const had = kids.length;
        for (let at = kids.length - 1; at >= 0; at -= 1) if (!keepsKid(kids.get(at))) kids.delete(at);
        holdsContent = had === 0 || kids.length > 0;
      } else if (!kids.isNull()) {
        holdsContent = keepsKid(kids);
        if (!holdsContent) element.delete('K');
      }
      if (!holdsContent) {
        if (element.isIndirect()) removedElements.add(element.asIndirect());
        return false;
      }
      if (!own.isNull() && outside(own)) element.delete('Pg');
      return true;
    };
    const top = structure.get('K');
    if (top.isArray()) {
      for (let at = top.length - 1; at >= 0; at -= 1) if (!stays(top.get(at), undefined, 0)) top.delete(at);
    } else if (top.isDictionary() && !stays(top, undefined, 0)) {
      structure.delete('K');
    }
    if (removedElements.size > 0) {
      const removed = (value: PDFObject): boolean => value.isIndirect() && removedElements.has(value.asIndirect());
      pruneTree(document, structure.get('ParentTree'), 'Nums', (value) => {
        if (!value.isArray()) return removed(value) ? null : undefined;
        let any = false;
        for (let at = 0; at < value.length; at += 1) {
          if (removed(value.get(at))) value.put(at, null);
          else if (!value.get(at).isNull()) any = true;
        }
        return any ? undefined : null;
      });
      pruneTree(document, structure.get('IDTree'), 'Names', (value) => (removed(value) ? null : undefined));
    }
  }

  // THE OUTLINE, by MuPDF's own rule (`pdf-clean-file.c`'s `strip_outline`): an entry that goes nowhere goes, and one
  // with children stays as a heading with no destination, so the children are kept.
  const outlines = root.get('Outlines');
  if (outlines.isDictionary()) {
    stripOutline(document, outlines, 0, new Set(), (item) => {
      let had = false;
      let has = false;
      const dest = item.get('Dest');
      if (!dest.isNull()) {
        had = true;
        if (leadsOutside(dest)) item.delete('Dest');
        else has = true;
      }
      if (!item.get('A').isNull()) {
        had = true;
        if (!pruneKey(item, 'A')) has = true;
      }
      const element = item.get('SE');
      if (element.isIndirect() && removedElements.has(element.asIndirect())) item.delete('SE');
      return had && !has;
    });
  }

  // THE CATALOG'S OWN: the open action, the document's additional actions, and both forms of named destination.
  const opening = root.get('OpenAction');
  if (opening.isArray() || opening.isString() || opening.isName()) {
    if (leadsOutside(opening)) root.delete('OpenAction');
  } else if (opening.isDictionary()) {
    pruneKey(root, 'OpenAction');
  }
  pruneAdditional(root);
  if (dests.isDictionary()) {
    const gone: string[] = [];
    dests.forEach((value, key) => {
      if (leadsOutside(value)) gone.push(String(key));
    });
    for (const key of gone) dests.delete(key);
  }
  if (names.isDictionary()) {
    pruneTree(document, names.get('Dests'), 'Names', (value) => (leadsOutside(value) ? null : undefined));
    pruneTree(document, names.get('Pages'), 'Names', (value) => {
      if (!outside(value)) return undefined;
      return successors.get(value.asIndirect()) ?? null;
    });
  }

  // THE ACTIONS LEFT: each kept page's own, every field's, and a second pass over the annotations' chains, which the
  // structure step may since have given a removed `/SD` to drop.
  for (const page of keptPages) {
    pruneAdditional(page);
    const annots = annotationsOf(page);
    if (!annots.isArray()) continue;
    for (let at = 0; at < annots.length; at += 1) {
      const annotation = annots.get(at);
      if (!annotation.isDictionary()) continue;
      pruneKey(annotation, 'A');
      pruneAdditional(annotation);
    }
  }
  const form = root.get('AcroForm');
  if (form.isDictionary()) {
    const seen = new Set<number>();
    const visit = (field: PDFObject): void => {
      if (!field.isDictionary()) return;
      if (field.isIndirect()) {
        if (seen.has(field.asIndirect())) return;
        seen.add(field.asIndirect());
      }
      pruneKey(field, 'A');
      pruneAdditional(field);
      const kids = field.get('Kids');
      if (kids.isArray()) for (let at = 0; at < kids.length; at += 1) visit(kids.get(at));
    };
    const fields = form.get('Fields');
    if (fields.isArray()) for (let at = 0; at < fields.length; at += 1) visit(fields.get(at));
  }

  // ANYTHING ELSE: a walk of every object from the trailer replaces a reference still naming an outside page with null
  // (12b's walk, now the last step). A kind this file does not name can keep what it names, never the page.
  nullEveryReference(document, outside);
}

/** How an action chain came out of {@link pruneChain}. */
type Pruned = { readonly kind: 'same' } | { readonly kind: 'gone' } | { readonly kind: 'replaced'; readonly by: PDFObject };

const SAME: Pruned = { kind: 'same' };
const GONE: Pruned = { kind: 'gone' };

/**
 * Takes the actions `drops` names out of a chain, keeping the order of the rest.
 *
 * An action is followed by its `/Next`, a dictionary or an array of them (PDF 32000-1 §12.6.2), so a dropped action is
 * replaced by what followed it. An array that has to stand where one action stood becomes its first action, with the
 * rest run after that action's own `/Next`: the order the format runs them in is unchanged.
 */
function pruneChain(
  document: PDFDocument,
  action: PDFObject,
  drops: (action: PDFObject) => boolean,
  seen: Set<number>,
  depth: number,
): Pruned {
  if (depth > MAX_NESTING) return SAME;
  if (action.isArray()) {
    let changed = false;
    for (let at = action.length - 1; at >= 0; at -= 1) {
      const result = pruneChain(document, action.get(at), drops, seen, depth + 1);
      if (result.kind === 'gone') {
        action.delete(at);
        changed = true;
      } else if (result.kind === 'replaced') {
        action.put(at, result.by);
        changed = true;
      }
    }
    if (action.length === 0) return GONE;
    return changed ? { kind: 'replaced', by: action } : SAME;
  }
  if (!action.isDictionary()) return SAME;
  if (action.isIndirect()) {
    if (seen.has(action.asIndirect())) return SAME;
    seen.add(action.asIndirect());
  }
  const next = action.get('Next');
  if (!next.isNull()) {
    const result = pruneChain(document, next, drops, seen, depth + 1);
    if (result.kind === 'gone') action.delete('Next');
    else if (result.kind === 'replaced') action.put('Next', result.by);
  }
  if (!drops(action)) return SAME;
  const after = action.get('Next');
  if (after.isNull()) return GONE;
  if (!after.isArray()) return { kind: 'replaced', by: after };
  const first = after.get(0);
  if (after.length === 1) return { kind: 'replaced', by: first };
  const rest = document.newArray();
  const own = first.get('Next');
  if (own.isArray()) for (let at = 0; at < own.length; at += 1) rest.push(own.get(at));
  else if (!own.isNull()) rest.push(own);
  for (let at = 1; at < after.length; at += 1) rest.push(after.get(at));
  first.put('Next', rest);
  return { kind: 'replaced', by: first };
}

/**
 * Strips the outline items under `parent` that `goesNowhere` reports, keeping an item with children as a heading, and
 * recounts what changed.
 *
 * **`/Count` by the format's definition** (PDF 32000-1 §12.3.3): an open item's count is how many of its descendants
 * are visible, a closed one's is the negative of how many would be, and the outline's own is every visible item. MuPDF
 * writes the number of direct children instead; this keeps each item's sign, open or closed, and writes the number
 * only where the subtree under it changed, so an outline nothing named is left byte for byte as it was.
 *
 * @returns how many items stay directly under `parent`, how many of its descendants are visible were it open, and
 *   whether anything under it changed
 */
function stripOutline(
  document: PDFDocument,
  parent: PDFObject,
  depth: number,
  seen: Set<number>,
  goesNowhere: (item: PDFObject) => boolean,
): { readonly kept: number; readonly visible: number; readonly changed: boolean } {
  if (depth > MAX_NESTING) {
    // LEFT AS IT IS below the bound: it has children if it names a first one, and its count is its own.
    const own = parent.get('Count');
    return { kept: parent.get('First').isDictionary() ? 1 : 0, visible: own.isNumber() ? Math.abs(own.asNumber()) : 0, changed: false };
  }
  const staying: PDFObject[] = [];
  let visible = 0;
  let changed = false;
  let removedHere = false;
  for (let item = parent.get('First'); item.isDictionary(); ) {
    if (item.isIndirect()) {
      if (seen.has(item.asIndirect())) break;
      seen.add(item.asIndirect());
    }
    const next = item.get('Next');
    const below = stripOutline(document, item, depth + 1, seen, goesNowhere);
    if (below.changed) changed = true;
    if (goesNowhere(item) && below.kept === 0) {
      changed = true;
      removedHere = true;
    } else {
      staying.push(item);
      const count = item.get('Count');
      visible += 1 + (count.isNumber() && count.asNumber() > 0 ? below.visible : 0);
    }
    item = next;
  }
  if (!changed) return { kept: staying.length, visible, changed };

  const first = staying[0];
  const last = staying[staying.length - 1];
  if (first === undefined || last === undefined) {
    parent.delete('First');
    parent.delete('Last');
    parent.delete('Count');
    return { kept: 0, visible: 0, changed };
  }
  if (removedHere) {
    staying.forEach((item, index) => {
      const before = staying[index - 1];
      const after = staying[index + 1];
      if (before === undefined) item.delete('Prev');
      else item.put('Prev', before);
      if (after === undefined) item.delete('Next');
      else item.put('Next', after);
    });
    parent.put('First', first);
    parent.put('Last', last);
  }
  const count = parent.get('Count');
  if (depth === 0) parent.put('Count', document.newInteger(visible));
  else if (count.isNumber()) parent.put('Count', document.newInteger(count.asNumber() < 0 ? -visible : visible));
  return { kept: staying.length, visible, changed };
}

/**
 * Removes the entries of a name tree or number tree that `decide` answers `null` for, replaces those it answers an
 * object for, and keeps `/Limits` right on every node that changed (PDF 32000-1 §7.9.6 and §7.9.7).
 *
 * A node whose entries and kids all went is removed from its parent. The root stays, since the catalog entry naming it
 * is the document's and not this function's to take, and it is left holding an empty entry array: a root must hold
 * entries or kids, and an empty array is the tree with nothing in it.
 */
function pruneTree(
  document: PDFDocument,
  root: PDFObject,
  leafKey: 'Names' | 'Nums',
  decide: (value: PDFObject) => PDFObject | null | undefined,
): void {
  const seen = new Set<number>();
  /** A key at one end of a node: its own entries' first or last key, or else its end kid's `/Limits`. */
  const end = (entries: PDFObject, kids: PDFObject, last: boolean): PDFObject | undefined => {
    if (entries.isArray() && entries.length > 0) return entries.get(last ? entries.length - 2 : 0);
    if (!kids.isArray() || kids.length === 0) return undefined;
    const limits = kids.get(last ? kids.length - 1 : 0).get('Limits');
    return limits.isArray() && limits.length === 2 ? limits.get(last ? 1 : 0) : undefined;
  };
  const prune = (node: PDFObject, depth: number): { readonly empty: boolean } => {
    if (depth > MAX_NESTING || !node.isDictionary()) return { empty: false };
    if (node.isIndirect()) {
      if (seen.has(node.asIndirect())) return { empty: false };
      seen.add(node.asIndirect());
    }
    let changed = false;
    const entries = node.get(leafKey);
    if (entries.isArray()) {
      for (let at = entries.length - 2; at >= 0; at -= 2) {
        const verdict = decide(entries.get(at + 1));
        if (verdict === null) {
          entries.delete(at + 1);
          entries.delete(at);
          changed = true;
        } else if (verdict !== undefined) {
          entries.put(at + 1, verdict);
        }
      }
    }
    const kids = node.get('Kids');
    if (kids.isArray()) {
      for (let at = kids.length - 1; at >= 0; at -= 1) {
        if (prune(kids.get(at), depth + 1).empty) {
          kids.delete(at);
          changed = true;
        }
      }
    }
    const empty = (!entries.isArray() || entries.length === 0) && (!kids.isArray() || kids.length === 0);
    if (changed && !empty && node.get('Limits').isArray()) {
      const low = end(entries, kids, false);
      const high = end(entries, kids, true);
      if (low === undefined || high === undefined) {
        node.delete('Limits');
      } else {
        const limits = document.newArray();
        limits.push(low);
        limits.push(high);
        node.put('Limits', limits);
      }
    }
    return { empty };
  };
  if (!root.isDictionary()) return;
  if (prune(root, 0).empty) {
    root.delete('Kids');
    if (!root.get(leafKey).isArray()) root.put(leafKey, document.newArray());
  }
}

/** Calls `visit` with each value of a name tree or number tree, and its key, without changing it. */
function eachEntry(root: PDFObject, leafKey: 'Names' | 'Nums', visit: (value: PDFObject, key: string | number) => void): void {
  const seen = new Set<number>();
  const walk = (node: PDFObject, depth: number): void => {
    if (depth > MAX_NESTING || !node.isDictionary()) return;
    if (node.isIndirect()) {
      if (seen.has(node.asIndirect())) return;
      seen.add(node.asIndirect());
    }
    const entries = node.get(leafKey);
    if (entries.isArray()) {
      for (let at = 0; at + 1 < entries.length; at += 2) {
        const key = entries.get(at);
        visit(entries.get(at + 1), key.isString() ? key.asString() : key.isNumber() ? key.asNumber() : String(key));
      }
    }
    const kids = node.get('Kids');
    if (kids.isArray()) for (let at = 0; at < kids.length; at += 1) walk(kids.get(at), depth + 1);
  };
  walk(root, 0);
}

/**
 * Replaces every reference `outside` reports, anywhere under the trailer, with null. Each object is visited once.
 *
 * **A worklist, never recursion.** A document's graph is as long as its content: a chain of 2,000 outline entries,
 * each naming the next, recursed one frame per entry and ran out of stack (measured 2026-10-04, `RangeError: Maximum
 * call stack size exceeded`), which would refuse a person a delete because of their document.
 */
function nullEveryReference(document: PDFDocument, outside: (value: PDFObject) => boolean): void {
  const seen = new Set<number>();
  const pending: PDFObject[] = [document.getTrailer()];
  for (let object = pending.pop(); object !== undefined; object = pending.pop()) {
    if (object.isIndirect()) {
      const number = object.asIndirect();
      if (seen.has(number)) continue;
      seen.add(number);
    }
    const holder = object;
    holder.forEach((value, key) => {
      if (outside(value)) holder.put(key, null);
      else if (value.isDictionary() || value.isArray()) pending.push(value);
    });
  }
}

/** A name's text, or `undefined` for anything else. */
function nameOf(value: PDFObject): string | undefined {
  return value.isName() ? value.asName() : undefined;
}

/**
 * Is this an annotation dictionary? It names a `/Subtype` and a `/Rect` and is not a stream, which tells it from a
 * form or image XObject (a stream with a `/Subtype`) and from a field (no `/Rect` unless it is also a widget).
 */
function isAnnotation(value: PDFObject): boolean {
  return value.isDictionary() && !value.isStream() && value.get('Subtype').isName() && value.get('Rect').isArray();
}
