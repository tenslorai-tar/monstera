import type { CommandOfKind } from '@monstera/contract';
import type { PDFDocument, PDFObject } from 'mupdf';

import type { CaptureResult } from './commandLog.js';
import type { Apply, Invert, MupdfSession } from './engineSeam.js';
import { copiedOut, withDocument, withDocuments } from './mupdfWriter.js';
import { pushInheritablesDown } from './pageExtract.js';

/**
 * Optional-content groups — layers — and the command that shows or hides one.
 *
 * ## Reading is a query; toggling is a COMMAND
 *
 * A layer's visibility lives in `/OCProperties`' default configuration, which
 * is part of the document. Turning one off and saving produces a file that
 * opens with it off in every other reader — so the toggle is a mutation, and it
 * goes through the bus with a capture and an inverse like every other one.
 *
 * A visibility held in renderer state would render correctly and vanish on
 * save, which is the wired-tools rule's own example: *done for a tool means
 * end to end — click it, use it on a real document, observable correct effect,
 * survives save and reopen*.
 *
 * ## `setLayerVisible` IS THAT RENDERER STATE, and this module does not use it
 *
 * Measured 2026-09-03, and it is why everything here goes through the object
 * tree instead. `PDFDocument.setLayerVisible` binds `pdf_enable_layer`, which
 * writes the visibility held in the in-memory `pdf_ocg_descriptor`;
 * `isLayerVisible` reads that same field back, so a session agrees with itself
 * immediately. Saving serialises the OBJECT TREE, which nothing wrote — a
 * fixture whose `/OFF` names one group comes back after a toggle and a save
 * with `/OFF` naming the same group, byte for byte, while the session reported
 * the layer visible. The first version of this module was built on that pair
 * and passed six cases; the case that found it is the one the rule above
 * names, *survives save and reopen*.
 *
 * So MuPDF's layer API answers *what is this session drawing?* and the panel
 * asks *what does this document say?* — two questions, and only the second has
 * a writer. `/OCProperties` is the one carrier here, read and written by this
 * module and by nothing else (B3a).
 *
 * MuPDF's own layer order is not `/OCGs` order either — measured the same day,
 * a document listing *Visible* then *Hidden* reports Hidden at layer 0 — so a
 * command carrying a MuPDF layer index could not have addressed an `/OCGs`
 * entry without joining the two enumerations by name, which is a cross-parser
 * identity join over names a document may repeat. **A `Layer.index` is a
 * position in `/OCGs`**, which is the array the command edits.
 *
 * ## The prior state is the layer's OWN visibility, captured before the write
 *
 * ADR-0009 §3 requires prior state restored verbatim, and here that is what the
 * configuration said. **Not the negation of what was asked for**: a command
 * setting a layer to the value it already had must invert to a no-op, and an
 * inverse computed as `!command.visible` would flip it instead.
 *
 * That is the same rule the rotation's inverse follows for a different reason —
 * there the prior value may be absent, here it may be equal — and both come
 * from *capture what was, never derive it from what was asked*.
 */

/** One layer, as a reader sees it. */
export interface Layer {
  /**
   * The group's position in `/OCProperties/OCGs`.
   *
   * A stable address within one document, and the one the command names. It is
   * NOT MuPDF's layer index: see this module's header for the measurement that
   * separates them.
   */
  readonly index: number;
  readonly name: string;
  readonly visible: boolean;
}

/** What the inverse restores: the layer, and what its visibility was. */
export interface PriorLayerVisibility {
  readonly layer: number;
  readonly visible: boolean;
}

/**
 * There is deliberately NO bound applied here; `MAX_LAYERS` is the contract's.
 *
 * This module clamped the count with `Math.min(groups.length, MAX_LAYERS)`,
 * which made two things true and neither was decided. A document with more
 * groups than the bound showed a **subset with nothing saying so** — the reader
 * toggles what they can see and the rest are invisible and unaddressable — and
 * `document.layers`' own `.max(MAX_LAYERS)` became a check that **cannot fail**,
 * since the array reaching it had already been cut to fit.
 *
 * Its two siblings, written in the same range, do the opposite: neither
 * `pageLinks` nor `destinations` clamps, and both bounds' comments say *"the
 * first document refused by this is the evidence the bound is wrong"*. So this
 * one held a second opinion about how a bound is communicated (B3a), and the
 * silent half was the one nobody could observe.
 *
 * A refusal is loud and a truncation is not, and the panel already renders a
 * refusal as its `unavailable` state. `search` reports a `truncated` flag
 * instead — correctly, because there the CALLER states a limit and *exhausted*
 * and *capped* must stay distinguishable. Nothing states a limit here.
 *
 * Found by the stage audit of `87540a5..HEAD`; `payloadBounds.test.ts` proves
 * every result declares a bound and is structurally unable to see one applied
 * before the schema reads it.
 */

/**
 * Follows an indirect reference, and tolerates a missing key.
 *
 * `PDFObject.get` answers a missing key with the shared `PDFObject.Null`, whose
 * `_doc` is null — calling `resolve()` on it throws a `TypeError` about a
 * property of null rather than answering *nothing is there*. So the null check
 * has to happen first, in one place: written at each call site it is six
 * chances to write the crash instead.
 */
function deref(object: PDFObject): PDFObject {
  return object.isNull() ? object : object.resolve();
}

/**
 * The document's optional-content groups, or none.
 *
 * `/OCGs` missing, empty or not an array all mean the same thing to every
 * caller here — this document has no layers — and returning the array only when
 * it is one keeps that decision in a single place.
 */
function groupsOf(document: PDFDocument): PDFObject | null {
  const properties = deref(document.getTrailer().get('Root', 'OCProperties'));
  if (!properties.isDictionary()) return null;
  const groups = deref(properties.get('OCGs'));
  return groups.isArray() ? groups : null;
}

/**
 * The default configuration `/D`, which is what an opening reader applies.
 *
 * The other configurations in `/Configs` are alternatives a user chooses
 * between; a panel showing what this document looks like when opened is asking
 * about `/D`, and a command that edited a configuration nobody selected would
 * change nothing a reader ever sees.
 */
function defaultConfig(document: PDFDocument): PDFObject | null {
  const properties = deref(document.getTrailer().get('Root', 'OCProperties'));
  if (!properties.isDictionary()) return null;
  const config = deref(properties.get('D'));
  return config.isDictionary() ? config : null;
}

/**
 * Where `group` sits in `list`, by object number, or `null`.
 *
 * Identity is the indirect reference and never the dictionary's contents: two
 * groups may carry the same `/Name`, and a document that repeats one would
 * otherwise have both toggled by either row.
 */
function positionIn(list: PDFObject | null, group: PDFObject): number | null {
  if (list?.isArray() !== true) return null;
  if (!group.isIndirect()) return null;
  const wanted = group.asIndirect();
  for (let at = 0; at < list.length; at += 1) {
    const entry = list.get(at);
    if (entry.isIndirect() && entry.asIndirect() === wanted) return at;
  }
  return null;
}

/** A configuration's `/ON` or `/OFF` list, or `null` when it has none. */
function listOf(config: PDFObject | null, key: 'ON' | 'OFF'): PDFObject | null {
  if (config === null) return null;
  const list = deref(config.get(key));
  return list.isArray() ? list : null;
}

/**
 * Whether a group is visible in the default configuration.
 *
 * PDF 32000-1 §8.11.4.3: `/BaseState` is `/ON` unless stated, `/OFF` lists the
 * exceptions to `/ON`, and `/ON` lists the exceptions to `/OFF`. Both
 * directions are implemented because a document that ships `/BaseState /OFF`
 * is the one where reading only `/OFF` reports every layer visible — the
 * reassuring answer, and the one a panel cannot tell from a document with
 * nothing hidden.
 */
function visibilityOf(config: PDFObject | null, group: PDFObject): boolean {
  const baseState = config === null ? null : deref(config.get('BaseState'));
  const base = baseState?.isName() === true ? baseState.asName() : 'ON';
  return base === 'OFF'
    ? positionIn(listOf(config, 'ON'), group) !== null
    : positionIn(listOf(config, 'OFF'), group) === null;
}

/**
 * Reads the document's layers.
 *
 * A QUERY, so it does not go through the bus — nothing is mutated and there is
 * nothing to capture. It reads `/OCGs` in the document's own order, which is
 * the order the indices address.
 */
export function readLayers(session: MupdfSession): Promise<readonly Layer[]> {
  return withDocument(session, (document) => {
    const groups = groupsOf(document);
    if (groups === null) return [];
    const config = defaultConfig(document);

    const layers: Layer[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups.get(index);
      const name = deref(deref(group).get('Name'));
      layers.push({
        index,
        // A group with no `/Name` is malformed and still has to render as a
        // row: dropping it would renumber every layer after it, and the
        // indices are what the command addresses.
        name: name.isString() ? name.asString() : '',
        visible: visibilityOf(config, group),
      });
    }
    return layers;
  });
}

/**
 * Records what the layer's visibility was, before it is changed.
 *
 * Called by the bus in one code path, never by a handler (ADR-0009,
 * 2026-08-19). A layer index outside the document is reported as *not
 * captured* rather than thrown, so the bus answers with a checkpoint instead of
 * the command failing halfway — which is the same treatment a malformed
 * `/Rotate` gets.
 */
export function captureSetLayerVisibility(
  session: MupdfSession,
  command: CommandOfKind<'setLayerVisibility'>,
): Promise<CaptureResult<PriorLayerVisibility>> {
  return withDocument(session, (document) => {
    const groups = groupsOf(document);
    const count = groups === null ? 0 : groups.length;
    if (groups === null || command.layer >= count) {
      return {
        captured: false,
        reason:
          `layer ${String(command.layer)} is outside this document, which has ` +
          `${String(count)} layer(s), so there is no prior visibility to record`,
      };
    }
    return {
      captured: true,
      // THE LAYER'S OWN VALUE, read before anything is written. Deriving it
      // from `command.visible` would make an inverse that flips rather than
      // restores, and the two differ exactly when the command changed nothing.
      prior: {
        layer: command.layer,
        visible: visibilityOf(defaultConfig(document), groups.get(command.layer)),
      },
    };
  });
}

/** Restores a layer's prior visibility. Takes the prior state and nothing else. */
export const invertSetLayerVisibility: Invert<'mupdf', 'setLayerVisibility'> = (
  session: MupdfSession,
  inverse: PriorLayerVisibility,
): Promise<void> =>
  withDocument(session, (document) => {
    setVisibility(document, inverse.layer, inverse.visible);
  });

/**
 * Shows or hides one layer.
 *
 * Validated before the write, so a bad index is a refusal rather than a
 * document MuPDF was asked to address out of range.
 */
export const applySetLayerVisibility: Apply<'mupdf', 'setLayerVisibility'> = (
  session: MupdfSession,
  command: CommandOfKind<'setLayerVisibility'>,
): Promise<void> =>
  withDocument(session, (document) => {
    setVisibility(document, command.layer, command.visible);
  });

/**
 * Writes one layer's visibility into the default configuration.
 *
 * Shared by the command and its inverse because they are the same write with a
 * different boolean — an inverse that reimplemented it would be free to drift
 * from the thing it restores.
 *
 * ## Which list is edited depends on `/BaseState`
 *
 * Under the default `/ON`, `/OFF` holds the exceptions, so hiding adds and
 * showing removes. Under `/BaseState /OFF` the roles swap and `/ON` is edited.
 * Writing to `/OFF` regardless would silently do nothing on a document of the
 * second kind — and *nothing* looks exactly like a layer that was already in
 * the state that was asked for.
 *
 * The other list is left alone. A group named in both is contradictory and the
 * spec's own rule resolves it — the exceptions list for the current base state
 * wins — so removing it from the other one would be this module overruling the
 * format about a document it did not write.
 */
function setVisibility(document: PDFDocument, layer: number, visible: boolean): void {
  const groups = groupsOf(document);
  if (groups === null || layer >= groups.length || layer < 0) {
    throw new RangeError(
      `Layer ${String(layer)} is outside this document, which has ` +
        `${String(groups === null ? 0 : groups.length)} layer(s).`,
    );
  }
  const group = groups.get(layer);

  const properties = deref(document.getTrailer().get('Root', 'OCProperties'));
  let config = defaultConfig(document);
  if (config === null) {
    // A document with `/OCGs` and no `/D` is malformed — the format requires a
    // default configuration — and the reader above treats it as *everything
    // visible*, which is what an empty `/D` means. Writing one is what makes
    // the toggle representable at all; the alternative is refusing to hide a
    // layer in a document a reader will happily show.
    config = document.addObject(document.newDictionary());
    properties.put('D', config);
  }

  const baseState = deref(config.get('BaseState'));
  const exceptions = baseState.isName() && baseState.asName() === 'OFF' ? 'ON' : 'OFF';
  // Listed as an exception means the OPPOSITE of the base state. Under `/ON`
  // that is hidden; under `/OFF` it is shown.
  const listed = exceptions === 'ON' ? visible : !visible;

  let list = listOf(config, exceptions);
  const at = positionIn(list, group);
  if (listed && at === null) {
    if (list === null) {
      list = document.addObject(document.newArray());
      config.put(exceptions, list);
    }
    list.push(group);
  } else if (!listed && at !== null && list !== null) {
    list.delete(at);
  }
}

/**
 * The name a new layer's drawing is registered under in the target page's `/XObject`
 * resources.
 *
 * DETERMINISTIC, from what the page already carries — never a counter, a clock or a
 * random id — because the declaration says `reproducible: true`: replaying the command
 * against the same prior document must produce the same tree. The first free
 * `MonsteraLayer<n>` is the one taken, so an import after an undo lands on the same name.
 */
function freeLayerName(xobjects: PDFObject): string {
  for (let n = 0; ; n += 1) {
    const name = `MonsteraLayer${String(n)}`;
    if (xobjects.get(name).isNull()) return name;
  }
}

/**
 * A page's content streams, joined, read through their INDIRECT references.
 *
 * Measured 2026-09-14 (ADR-0064): `readStream` loads through the object number, and
 * called on `.resolve()`'s result it throws `object is not a stream` — the resolved value
 * is the stream's dictionary and no longer names the object. So the resolve is used only
 * to ask whether `/Contents` is an array.
 *
 * Each part is followed by a newline: PDF 32000-1 §7.8.2 treats an array's streams as one
 * stream split at token boundaries, and joining two with nothing between them could fuse
 * the last operator of one with the first operand of the next.
 */
function joinedContents(leaf: PDFObject): Uint8Array {
  const reference = leaf.get('Contents');
  if (reference.isNull()) return new Uint8Array(0);
  const resolved = reference.resolve();
  const parts: Uint8Array[] = resolved.isArray()
    ? Array.from({ length: resolved.length }, (_, at) => copiedOut(resolved.get(at).readStream()))
    : [copiedOut(reference.readStream())];
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.length + 1, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
    joined[offset] = 0x0a;
    offset += 1;
  }
  return joined;
}

/**
 * Appends one group to `/OCGs` and to the default configuration's `/Order`.
 *
 * Creates `/OCProperties` and its `/D` when the document has none, which is the ordinary
 * case for a document that has never had a layer. `/Order` is appended to only when it
 * exists or is being created: a document whose `/D` deliberately carries no `/Order`
 * shows groups in `/OCGs` order, and inventing one would reorder its existing layers.
 */
function appendGroup(document: PDFDocument, groupRef: PDFObject): void {
  const root = document.getTrailer().get('Root');
  let properties = deref(root.get('OCProperties'));
  if (!properties.isDictionary()) {
    properties = document.newDictionary();
    properties.put('OCGs', document.newArray());
    const config = document.newDictionary();
    config.put('Order', document.newArray());
    properties.put('D', config);
    root.put('OCProperties', properties);
  }
  let groups = deref(properties.get('OCGs'));
  if (!groups.isArray()) {
    groups = document.newArray();
    properties.put('OCGs', groups);
  }
  groups.push(groupRef);

  let config = deref(properties.get('D'));
  if (!config.isDictionary()) {
    config = document.newDictionary();
    config.put('Order', document.newArray());
    properties.put('D', config);
  }
  const order = deref(config.get('Order'));
  if (order.isArray()) order.push(groupRef);
}

/**
 * Places the source document's FIRST page onto one page of the target, as a new
 * optional-content group that is visible by default.
 *
 * ## Which source page, and why only the first
 *
 * The renderer knows no other document's page count — an open-document entry carries an
 * id, a version, a byte length and a name — so it cannot bound a chosen page. That is the
 * gap `replacePage`'s contract note records for *insert selected pages*, and this command
 * takes the same default rather than a blind index the kernel would refuse.
 *
 * ## The group joins `/OCProperties` HERE, in this module
 *
 * `/OCProperties` is read and written by this module and nothing else (its header). A new
 * group is a write to it, so it lives beside `setVisibility`, and the Layers panel lists
 * it and `setLayerVisibility` hides it with no code of its own.
 *
 * ## The steps, in the order ADR-0064's probe measured them
 *
 * 1. Push the source leaf's inheritables down — a leaf inheriting its `/MediaBox` would
 *    otherwise copy without one.
 * 2. One graft map for the command, so resources the source shares are copied once.
 * 3. The joined content becomes a Form XObject with the page's box as `/BBox`, its grafted
 *    `/Resources`, and `/OC` naming the new group.
 * 4. The target page draws it through its own `/XObject` resources and one appended
 *    content stream. Its existing content is not rewritten.
 * 5. The group is appended to `/OCGs` and to `/D/Order`.
 *
 * Validated before any write, so an out-of-range page is a refusal and not a document
 * half-edited.
 */
export const applyImportPageAsLayer: Apply<'mupdf', 'importPageAsLayer', 'one'> = (
  session: MupdfSession,
  command: CommandOfKind<'importPageAsLayer'>,
  source: MupdfSession,
): Promise<void> =>
  withDocuments(session, source, (target, from) => {
    const count = target.countPages();
    if (command.at >= count) {
      throw new RangeError(
        `Page ${String(command.at)} is outside this document, which has ${String(count)} ` +
          'page(s). Page indices are zero-based, and a layer is placed on a page that EXISTS.',
      );
    }
    if (from.countPages() === 0) {
      throw new RangeError('The source document has no page to import as a layer.');
    }

    // READ FROM `from`, WRITTEN INTO `target` — `withDocuments` names its parameters
    // because both are `PDFDocument` and a transposition would type-check.
    const leaf = pushInheritablesDown(from, 0);
    const map = target.newGraftMap();

    const group = target.newDictionary();
    group.put('Type', target.newName('OCG'));
    // THE NAME IS THE PAYLOAD'S. The renderer holds the source tab's name and sends it;
    // this side holds a session and a DocId, and inventing a label here would put a name
    // the person never chose in their Layers panel.
    group.put('Name', target.newString(command.name));
    const groupRef = target.addObject(group);

    const form = target.newDictionary();
    form.put('Type', target.newName('XObject'));
    form.put('Subtype', target.newName('Form'));
    const box = leaf.get('CropBox').isNull() ? leaf.get('MediaBox') : leaf.get('CropBox');
    form.put('BBox', map.graftObject(box));
    const resources = leaf.get('Resources');
    if (!resources.isNull()) form.put('Resources', map.graftObject(resources));
    form.put('OC', groupRef);
    const formRef = target.addStream(joinedContents(leaf), form);

    appendGroup(target, groupRef);

    const page = target.findPage(command.at);
    let pageResources = deref(page.get('Resources'));
    if (!pageResources.isDictionary()) {
      pageResources = target.newDictionary();
      page.put('Resources', pageResources);
    }
    let xobjects = deref(pageResources.get('XObject'));
    if (!xobjects.isDictionary()) {
      xobjects = target.newDictionary();
      pageResources.put('XObject', xobjects);
    }
    const name = freeLayerName(xobjects);
    xobjects.put(name, formRef);

    const drawing = target.addStream(`q /${name} Do Q`, target.newDictionary());
    const existing = page.get('Contents');
    const list = target.newArray();
    if (!existing.isNull()) {
      const resolved = existing.resolve();
      if (resolved.isArray()) {
        for (let at = 0; at < resolved.length; at += 1) list.push(resolved.get(at));
      } else {
        list.push(existing);
      }
    }
    list.push(drawing);
    page.put('Contents', list);
  });

/**
 * Reports that prior state cannot be recorded, always — `captureMergeDocument`'s shape.
 *
 * The prior state is the absence of five structures (the group, its place in `/OCGs` and
 * `/D/Order`, the Form XObject, its `/XObject` entry and the drawing stream), and none
 * has a serialisable form. The bus checkpoints the target; the source is not modified.
 */
export const captureImportPageAsLayer = (): Promise<CaptureResult<never>> =>
  Promise.resolve({
    captured: false,
    reason:
      'importing a page as a layer has no recordable prior state: undoing it removes a group ' +
      'from /OCProperties, a Form XObject, its /XObject entry and a content stream. The ' +
      'checkpoint is of the target; the source is not modified and needs no entry',
  });

/**
 * Unreachable, and it exists because the seam's shape requires it:
 * `CommandPrior['importPageAsLayer']` is `never`, so nothing can call this. It throws
 * rather than returning quietly, so reaching it names the disagreement that did.
 */
export const invertImportPageAsLayer: Invert<'mupdf', 'importPageAsLayer'> = (): Promise<void> => {
  throw new Error(
    'importPageAsLayer is undone by the checkpoint the bus takes, never by an inverse; reaching ' +
      'this means its declaration and its CommandPrior entry disagree',
  );
};
