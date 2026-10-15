import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from './mupdfRaw.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { activeContentIn, applySanitizeDocument, captureSanitizeDocument } from './documentSanitize.js';
import type { ByteImage, MupdfSession } from './engineSeam.js';
import { mupdfWriter, withDocument } from './mupdfWriter.js';

/**
 * Sanitising a document — Stage 7's sanitize/flatten row.
 *
 * ## The fixture CARRIES active content, because a clean one proves nothing
 *
 * *No JavaScript in this document* is what a correct sanitise answers and also
 * what a document that never had any answers, and also what a reader that
 * cannot recognise JavaScript answers. So the fixture is built with each thing
 * in it, the control asserts they are there, and every removal is measured
 * against that.
 *
 * ## It reads the SAVED bytes
 *
 * Deleting a key from the catalogue unlinks the object; a plain save writes it
 * back out, readable to anything walking the cross-reference table. So a case
 * that asked the live session would pass for a command that left the
 * JavaScript in the file — which is the whole of ADR-0045's measurement,
 * arriving in a second row.
 */
let plain: ByteImage;

beforeAll(async () => {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([400, 600]).drawText('Ordinary text', { font, size: 18, x: 20, y: 540 });
  plain = await document.save();
});

/** The fixture, with each thing a sanitise removes planted in it. */
async function loaded(): Promise<ByteImage> {
  const session = await mupdfWriter.open(plain);
  try {
    await withDocument(session, (document) => {
      const root = document.getTrailer().get('Root');

      const openAction = document.addObject(document.newDictionary());
      openAction.put('S', document.newName('JavaScript'));
      openAction.put('JS', 'app.alert("hello");');
      root.put('OpenAction', openAction);

      const names = document.addObject(document.newDictionary());
      const scripts = document.addObject(document.newDictionary());
      scripts.put('Names', document.newArray());
      names.put('JavaScript', scripts);
      const files = document.addObject(document.newDictionary());
      files.put('Names', document.newArray());
      names.put('EmbeddedFiles', files);
      root.put('Names', names);

      // AN ANNOTATION WITH A SUBMIT ACTION, and one with a plain link beside
      // it. The second is the control inside the fixture: a sanitise that
      // deleted every `/A` would take the link with it, and no assertion about
      // the submit action would notice.
      // THE RECT GOES ON THE OBJECT, not through `setRect`: MuPDF 1.28.0
      // answers `setRect` on a Link with *"Link annotations have no Rect
      // property"* — measured 2026-09-12, and the same shape as the Redact's
      // refusal of `setBorderWidth`. The key is in the dictionary either way;
      // what the binding refuses is its own setter.
      const page = document.loadPage(0);
      const submit = page.createAnnotation('Link');
      const submitObject = submit.getObject();
      submitObject.put('Rect', document.newArray());
      for (const value of [20, 20, 120, 40]) submitObject.get('Rect').push(value);
      const submitAction = document.addObject(document.newDictionary());
      submitAction.put('S', document.newName('SubmitForm'));
      submitObject.put('A', submitAction);
      submit.update();

      const link = page.createAnnotation('Link');
      const linkObject = link.getObject();
      linkObject.put('Rect', document.newArray());
      for (const value of [140, 20, 240, 40]) linkObject.get('Rect').push(value);
      const uri = document.addObject(document.newDictionary());
      uri.put('S', document.newName('URI'));
      uri.put('URI', 'https://example.org/');
      linkObject.put('A', uri);
      link.update();

      // A THIRD ANNOTATION THAT IS DRAWN, because the two above are not.
      // `bake` writes an annotation's APPEARANCE into the page content and
      // removes it; a `/Link` has no appearance, so baking leaves it — measured
      // 2026-09-12. Without a drawn one in the fixture, the flatten case would
      // be asserting about annotations flattening cannot reach.
      const note = page.createAnnotation('Square');
      note.setRect([260, 20, 360, 40]);
      note.update();
    });
    return await mupdfWriter.serialise(session);
  } finally {
    await mupdfWriter.close(session);
  }
}

/** What the SAVED bytes of a session still carry. */
async function savedContent(session: MupdfSession): Promise<ReturnType<typeof activeContentIn>> {
  const bytes = await mupdfWriter.serialise(session);
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
  try {
    return activeContentIn(document);
  } finally {
    document.destroy();
  }
}

/** Whether a URI link survived, read separately from the counter. */
async function linkSurvives(session: MupdfSession): Promise<boolean> {
  const bytes = await mupdfWriter.serialise(session);
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
  try {
    // READ FROM `/Annots`, not from `getAnnotations()`, for the reason
    // `annotationObjects` records: MuPDF filters Links out of that reader, so a
    // check written through it would answer *the link is gone* for a link that
    // is in the file.
    const annots = document.loadPage(0).getObject().get('Annots');
    if (annots.isNull()) return false;
    let found = false;
    annots.forEach((value) => {
      if (!value.isDictionary()) return;
      const action = value.get('A');
      if (action.isDictionary() && String(action.get('S')) === '/URI') found = true;
    });
    return found;
  } finally {
    document.destroy();
  }
}

/**
 * A document whose outline is `count` bookmarks in one `/Next` chain, with a JavaScript action on the LAST alone,
 * written by pdf-lib rather than by the engine the sanitise runs in.
 */
async function longOutline(count: number): Promise<ByteImage> {
  const document = await PDFDocument.load(plain);
  const { context } = document;
  const outlines = context.nextRef();
  const items = Array.from({ length: count }, () => context.nextRef());
  items.forEach((ref, at) => {
    const item = context.obj({ Title: PDFString.of(`Bookmark ${String(at + 1)}`), Parent: outlines });
    const next = items[at + 1];
    if (next !== undefined) item.set(PDFName.of('Next'), next);
    if (at === count - 1) item.set(PDFName.of('A'), context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }));
    context.assign(ref, item);
  });
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined) throw new Error('an outline needs a bookmark');
  context.assign(outlines, context.obj({ Type: 'Outlines', First: first, Last: last, Count: count }));
  document.catalog.set(PDFName.of('Outlines'), outlines);
  return document.save({ useObjectStreams: false });
}

/**
 * The saved outline read by pdf-lib, NOT by `activeContentIn`, which walks the way the removal does and so would share
 * any place it stops: how many bookmarks the `/Next` chain holds, and how many carry a JavaScript action.
 */
async function outlineReadIndependently(bytes: ByteImage): Promise<{ readonly items: number; readonly javascript: number }> {
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const outlines = document.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  let item = outlines?.lookupMaybe(PDFName.of('First'), PDFDict);
  let items = 0;
  let javascript = 0;
  while (item !== undefined) {
    items += 1;
    const action = item.lookupMaybe(PDFName.of('A'), PDFDict);
    if (action?.lookupMaybe(PDFName.of('S'), PDFName) === PDFName.of('JavaScript') || action?.has(PDFName.of('JS')) === true) {
      javascript += 1;
    }
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return { items, javascript };
}

/**
 * How many dictionaries a `/Next` chain holds from `head`, and how many of them (or of their `/A`) are JavaScript, read
 * in the open session by a plain loop: not by `activeContentIn`, which walks the way the removal does, and not from a
 * SAVED file. MuPDF's own save recurses down a chain like this one, `garbage` marking each link, and overflows the
 * native stack: measured 2026-10-15 in this cloud session's Linux container (8 MB stack), saved at 15,313 links and
 * segfaulted at 15,469, with no sanitise at all (`chainProbe.mjs`, the scratch probe, open and save only). Windows
 * gives a thread far less stack, so the depth there is lower and not yet measured.
 */
function chainInSession(head: mupdf.PDFObject, via: 'A' | null): { readonly links: number; readonly javascript: number } {
  let links = 0;
  let javascript = 0;
  for (let link = head; link.isDictionary(); link = link.get('Next')) {
    links += 1;
    const action = via === null ? link : link.get('A');
    if (action.isDictionary() && (String(action.get('S')) === '/JavaScript' || !action.get('JS').isNull())) javascript += 1;
  }
  return { links, javascript };
}

describe('a sanitise walks the WHOLE document (addendum 5, X2)', () => {
  /** Sanitises `bytes` for JavaScript, then reads the chain `at` names in the same session, before any save. */
  async function sanitisedChain(
    bytes: ByteImage,
    at: (root: mupdf.PDFObject) => mupdf.PDFObject,
    via: 'A' | null,
  ): Promise<{ readonly links: number; readonly javascript: number }> {
    const session = await mupdfWriter.open(bytes);
    try {
      await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: ['javascript'] });
      return await withDocument(session, (document) => chainInSession(at(document.getTrailer().get('Root')), via));
    } finally {
      await mupdfWriter.close(session);
    }
  }

  it('an /OpenAction chain of 20,001 page jumps with JavaScript LAST keeps every jump and loses the script', async () => {
    // THE CHAIN SHAPE: the action walks recursed down `/Next` and stopped at 10,000 seen; they are iterative now.
    const count = 20_001;
    const document = await PDFDocument.load(plain);
    const { context } = document;
    const page = document.getPage(0).ref;
    const refs = Array.from({ length: count }, () => context.nextRef());
    refs.forEach((ref, at) => {
      const action =
        at === count - 1
          ? context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })
          : context.obj({ S: 'GoTo', D: [page, 'Fit'] });
      const next = refs[at + 1];
      if (next !== undefined) action.set(PDFName.of('Next'), next);
      context.assign(ref, action);
    });
    const head = refs[0];
    if (head === undefined) throw new Error('a chain needs an action');
    document.catalog.set(PDFName.of('OpenAction'), head);

    /** The chain from `/OpenAction`, read by pdf-lib: how many jumps, and how many scripts. */
    const chain = async (bytes: ByteImage): Promise<{ jumps: number; scripts: number }> => {
      const read = await PDFDocument.load(bytes);
      let action = read.catalog.lookupMaybe(PDFName.of('OpenAction'), PDFDict);
      let jumps = 0;
      let scripts = 0;
      while (action !== undefined) {
        const type = action.lookupMaybe(PDFName.of('S'), PDFName);
        if (type === PDFName.of('GoTo')) jumps += 1;
        if (type === PDFName.of('JavaScript')) scripts += 1;
        action = action.lookupMaybe(PDFName.of('Next'), PDFDict);
      }
      return { jumps, scripts };
    };
    const before = await document.save({ useObjectStreams: false });
    // THE FIXTURE CARRIES IT, read by pdf-lib from the file.
    expect(await chain(before)).toStrictEqual({ jumps: count - 1, scripts: 1 });
    // AND THE SANITISE REMOVED IT, read in the session: every jump kept, and the script, the chain's last link, gone.
    expect(await sanitisedChain(before, (root) => root.get('OpenAction'), null)).toStrictEqual({ links: count - 1, javascript: 0 });
  }, 120_000);

  // ONE PAST, AND ONE SHORT OF, the count the walks used to stop at.
  for (const count of [10_001, 9_999]) {
    it(`${count === 10_001 ? '' : 'CONTROL: '}${String(count)} bookmarks, JavaScript on the last: none survives, every bookmark does`, async () => {
      const before = await longOutline(count);
      // THE FIXTURE CARRIES IT, read by the same independent reader.
      expect(await outlineReadIndependently(before)).toStrictEqual({ items: count, javascript: 1 });
      expect(await sanitisedChain(before, (root) => root.get('Outlines').get('First'), 'A')).toStrictEqual({ links: count, javascript: 0 });
    }, 120_000);
  }
});

describe('sanitizeDocument', () => {
  it('CONTROL: the fixture carries all of it before anything runs', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      const before = await savedContent(session);
      expect(before.javascript).toBeGreaterThan(0);
      expect(before.embeddedFiles).toBe(1);
      expect(before.external).toBe(1);
      // THREE: two links and a drawn square. Only the square can be flattened.
      expect(before.annotations).toBe(3);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('removes JavaScript from the SAVED bytes, not just from the catalogue', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['javascript'],
      });
      expect((await savedContent(session)).javascript).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: removing JavaScript leaves the attachments and the link alone', async () => {
    // The part list is the one thing this payload decides, and a command that
    // ignored it and did everything would pass every removal case above.
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['javascript'],
      });
      const after = await savedContent(session);
      expect(after.embeddedFiles).toBe(1);
      expect(after.annotations).toBe(3);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('removes attachments', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['embedded-files'],
      });
      expect((await savedContent(session)).embeddedFiles).toBe(0);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('removes a SUBMIT action and KEEPS the link beside it', async () => {
    // The load-bearing case. A sanitise that deleted every `/A` would answer
    // `external: 0` exactly as correctly and take every link in the document
    // with it — which is the removal reading as success.
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, {
        kind: 'sanitizeDocument',
        parts: ['external-actions'],
      });
      expect((await savedContent(session)).external).toBe(0);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('FLATTENS a drawn annotation into the page, and leaves the links', async () => {
    // MEASURED 2026-09-12, and it is the honest reading of what flattening is:
    // `bake` writes an annotation's APPEARANCE into the content and removes it,
    // and a `/Link` has no appearance. So a flattened document still has
    // clickable links — which is right, and is why the *external actions* part
    // exists separately. Asserting `0` here would have been asserting something
    // flattening cannot do.
    const session = await mupdfWriter.open(await loaded());
    try {
      await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: ['flatten'] });
      expect((await savedContent(session)).annotations).toBe(2);
      expect(await linkSurvives(session)).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  describe('the places an action hides (CR-DOC-13)', () => {
    /** One action dictionary, indirect so a chain can loop back to it. */
    function action(document: mupdf.PDFDocument, type: string, entries: Record<string, string> = {}): mupdf.PDFObject {
      const made = document.addObject(document.newDictionary());
      made.put('S', document.newName(type));
      // `newString`, because the binding reads a bare JavaScript string as a NAME.
      for (const [key, value] of Object.entries(entries)) made.put(key, document.newString(value));
      return made;
    }

    /** A link on page 1 whose `/A` is `head`, read back from `/Annots` by its `/Contents`. */
    function link(document: mupdf.PDFDocument, name: string, head: mupdf.PDFObject): void {
      const annotation = document.loadPage(0).createAnnotation('Link');
      const object = annotation.getObject();
      object.put('Rect', document.newArray());
      for (const value of [20, 60, 120, 80]) object.get('Rect').push(value);
      object.put('Contents', document.newString(name));
      object.put('A', head);
      annotation.update();
    }

    /**
     * Each place the walk used to miss, with something a person would keep beside each: a `/GoTo` whose `/Next` runs
     * JavaScript; a JavaScript head whose `/Next` is a `/URI`; a `/Rendition`; a `/Next` loop through JavaScript; a
     * `/GoToE`; a parent field's keystroke script; an outline item's script beside an outline item's `/GoTo`; and a
     * file attachment annotation.
     */
    async function hiding(): Promise<ByteImage> {
      const session = await mupdfWriter.open(plain);
      try {
        await withDocument(session, (document) => {
          const root = document.getTrailer().get('Root');

          const goTo = action(document, 'GoTo', { D: 'chapter' });
          goTo.put('Next', action(document, 'JavaScript', { JS: 'app.alert(1);' }));
          link(document, 'goto-then-script', goTo);

          const script = action(document, 'JavaScript', { JS: 'app.alert(2);' });
          script.put('Next', action(document, 'URI', { URI: 'https://example.org/next' }));
          link(document, 'script-then-uri', script);

          link(document, 'rendition', action(document, 'Rendition', { JS: 'app.alert(3);' }));

          const looping = action(document, 'GoTo', { D: 'loop' });
          const inLoop = action(document, 'JavaScript', { JS: 'app.alert(4);' });
          looping.put('Next', inLoop);
          inLoop.put('Next', looping);
          link(document, 'loop', looping);

          link(document, 'embedded', action(document, 'GoToE', { D: 'inside' }));

          const triggers = document.newDictionary();
          triggers.put('K', action(document, 'JavaScript', { JS: 'AFNumber_Keystroke();' }));
          const parent = document.addObject(document.newDictionary());
          parent.put('T', 'total');
          parent.put('FT', document.newName('Tx'));
          parent.put('AA', triggers);
          const child = document.addObject(document.newDictionary());
          child.put('T', 'part');
          child.put('Parent', parent);
          parent.put('Kids', document.newArray());
          parent.get('Kids').push(child);
          const acroForm = document.newDictionary();
          acroForm.put('Fields', document.newArray());
          acroForm.get('Fields').push(parent);
          root.put('AcroForm', acroForm);

          const outlines = document.addObject(document.newDictionary());
          const scripted = document.addObject(document.newDictionary());
          const kept = document.addObject(document.newDictionary());
          scripted.put('Title', 'scripted');
          scripted.put('Parent', outlines);
          scripted.put('A', action(document, 'JavaScript', { JS: 'app.alert(5);' }));
          scripted.put('Next', kept);
          kept.put('Title', 'kept');
          kept.put('Parent', outlines);
          kept.put('Prev', scripted);
          kept.put('A', action(document, 'GoTo', { D: 'kept' }));
          outlines.put('First', scripted);
          outlines.put('Last', kept);
          root.put('Outlines', outlines);

          const attachment = document.loadPage(0).createAnnotation('FileAttachment');
          attachment.setRect([300, 300, 320, 320]);
          attachment.update();
        });
        return await mupdfWriter.serialise(session);
      } finally {
        await mupdfWriter.close(session);
      }
    }

    /** What a saved session holds at each planted place, read from the object model and from nothing this module exports. */
    async function places(session: MupdfSession): Promise<Record<string, string>> {
      const bytes = await mupdfWriter.serialise(session);
      const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
      if (!(document instanceof mupdf.PDFDocument)) throw new Error('the output is not a PDF');
      try {
        /** A chain's types in order, as far as six steps: enough to see a loop without following it. */
        const chain = (head: mupdf.PDFObject): string => {
          const types: string[] = [];
          for (let at = head; at.isDictionary() && types.length < 6; at = at.get('Next')) types.push(String(at.get('S')));
          return types.join(' ');
        };
        const found: Record<string, string> = {};
        let attachments = 0;
        document.loadPage(0).getObject().get('Annots').forEach((value) => {
          if (String(value.get('Subtype')) === '/FileAttachment') attachments += 1;
          const name = value.get('Contents');
          if (name.isString()) found[name.asString()] = chain(value.get('A'));
        });
        found['attachments'] = String(attachments);
        const root = document.getTrailer().get('Root');
        // A PATH, which the binding walks natively and answers null for a missing step: a flatten removes the form.
        found['field triggers'] = String(!root.get('AcroForm', 'Fields', 0, 'AA').isNull());
        found['outline scripted'] = chain(root.get('Outlines', 'First', 'A'));
        found['outline kept'] = chain(root.get('Outlines', 'First', 'Next', 'A'));
        return found;
      } finally {
        document.destroy();
      }
    }

    it('CONTROL: the fixture carries each hidden action, and the counter sees every one', async () => {
      const session = await mupdfWriter.open(await hiding());
      try {
        expect(await places(session)).toStrictEqual({
          'goto-then-script': '/GoTo /JavaScript',
          'script-then-uri': '/JavaScript /URI',
          rendition: '/Rendition',
          loop: '/GoTo /JavaScript /GoTo /JavaScript /GoTo /JavaScript',
          embedded: '/GoToE',
          attachments: '1',
          'field triggers': 'true',
          'outline scripted': '/JavaScript',
          'outline kept': '/GoTo',
        });
        // FIVE running actions, one of them inside a loop that is counted once, and the parent field's `/AA`.
        expect(await savedContent(session)).toMatchObject({ javascript: 6, embeddedFiles: 2, external: 0 });
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('takes out every running action and trigger, and keeps each link and the order it ran in', async () => {
      const session = await mupdfWriter.open(await hiding());
      try {
        await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: ['javascript'] });
        expect(await places(session)).toStrictEqual({
          'goto-then-script': '/GoTo',
          // THE FOLLOWER TAKES THE REMOVED HEAD'S PLACE: the link still opens its address.
          'script-then-uri': '/URI',
          rendition: '',
          // THE LOOP ENDS rather than closing on the action it came back to.
          loop: '/GoTo',
          // An attached file is the next part's, and the JavaScript part leaves it.
          embedded: '/GoToE',
          attachments: '1',
          'field triggers': 'false',
          'outline scripted': '',
          'outline kept': '/GoTo',
        });
        expect((await savedContent(session)).javascript).toBe(0);
      } finally {
        await mupdfWriter.close(session);
      }
    });

    it('takes out the attachment annotation and the action that opens one', async () => {
      const session = await mupdfWriter.open(await hiding());
      try {
        await applySanitizeDocument(session, { kind: 'sanitizeDocument', parts: ['embedded-files', 'flatten'] });
        const after = await places(session);
        expect(after).toMatchObject({ embedded: '', attachments: '0', 'goto-then-script': '/GoTo /JavaScript' });
        expect((await savedContent(session)).embeddedFiles).toBe(0);
      } finally {
        await mupdfWriter.close(session);
      }
    });
  });

  it('refuses to record prior state', async () => {
    const session = await mupdfWriter.open(await loaded());
    try {
      const captured = await captureSanitizeDocument(session);
      expect(captured.captured).toBe(false);
      expect(captured.captured ? '' : captured.reason).toContain('catalogue');
    } finally {
      await mupdfWriter.close(session);
    }
  });
});
