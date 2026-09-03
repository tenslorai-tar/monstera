import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  applySetLayerVisibility,
  captureSetLayerVisibility,
  invertSetLayerVisibility,
  readLayers,
} from './layers.js';
import { mupdfWriter } from './mupdfWriter.js';

/**
 * Layers, and the command that shows or hides one.
 *
 * ## The fixture writes `/OCProperties` as the format spells it
 *
 * pdf-lib has no optional-content helper, so the groups and the default
 * configuration are written directly: `/OCGs` lists every group, `/D` is the
 * default configuration, and `/OFF` lists the ones that start hidden. That last
 * part is what makes the visibility here a document property rather than a
 * default — a fixture where everything starts visible cannot tell *read the
 * document* from *return true*.
 */
async function documentWithLayers(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  const context = document.context;

  const group = (name: string): ReturnType<typeof context.register> =>
    context.register(context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of(name) }));

  const visible = group('Visible layer');
  const hidden = group('Hidden layer');

  const all = PDFArray.withContext(context);
  all.push(visible);
  all.push(hidden);

  // ONE STARTS OFF, which is the whole point of the fixture.
  const off = PDFArray.withContext(context);
  off.push(hidden);

  document.catalog.set(
    PDFName.of('OCProperties'),
    context.obj({
      OCGs: all,
      D: context.obj({ Order: all, OFF: off }),
    }),
  );

  return document.save({ useObjectStreams: false });
}

/**
 * The same two groups under `/BaseState /OFF`, where `/ON` holds the exceptions.
 *
 * The inverted document, and it exists because every branch keyed on
 * `/BaseState` is a branch nothing else here arrives at — a reader that only
 * consults `/OFF` reports **every layer visible** on this fixture, which is the
 * reassuring answer and indistinguishable from a document with nothing hidden.
 *
 * `configuration` chooses whether the default configuration is written at all:
 * a document carrying `/OCGs` and no `/D` is malformed, and it is the input
 * that separates *the write edits a configuration* from *the write assumes one
 * is there*.
 */
async function documentWithBaseStateOff(
  options: { configuration?: 'none' } = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  const context = document.context;

  const group = (name: string): ReturnType<typeof context.register> =>
    context.register(context.obj({ Type: PDFName.of('OCG'), Name: PDFString.of(name) }));

  const shown = group('Shown layer');
  const dark = group('Dark layer');

  const all = PDFArray.withContext(context);
  all.push(shown);
  all.push(dark);

  // EVERYTHING STARTS OFF, and `/ON` names the one exception.
  const on = PDFArray.withContext(context);
  on.push(shown);

  document.catalog.set(
    PDFName.of('OCProperties'),
    context.obj(
      options.configuration === 'none'
        ? { OCGs: all }
        : { OCGs: all, D: context.obj({ Order: all, BaseState: PDFName.of('OFF'), ON: on }) },
    ),
  );

  return document.save({ useObjectStreams: false });
}

describe('readLayers', () => {
  it('reads each layers name and its ACTUAL visibility', async () => {
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      const layers = await readLayers(session);

      // THE DOCUMENT'S OWN ORDER, and the assertion is worth making rather
      // than obvious: MuPDF's layer enumeration reports **Hidden at index 0**
      // for this fixture, measured 2026-09-03, so a reader built on
      // `countLayers`/`getLayerName` — which this one was, until the round-trip
      // case below found what that API does not persist — answers these two
      // rows the other way round.
      expect(layers.map((layer) => layer.name)).toStrictEqual([
        'Visible layer',
        'Hidden layer',
      ]);
      expect(layers[0]?.visible).toBe(true);
      // HIDDEN, which the document says and a reader returning a constant
      // `true` would get wrong while passing any fixture where everything is
      // visible.
      expect(layers[1]?.visible).toBe(false);

      // The indices are the positions in `/OCGs`, which is what makes them the
      // addresses the command edits.
      expect(layers.map((layer) => layer.index)).toStrictEqual([0, 1]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('reads /BaseState OFF, where /ON holds the exceptions', async () => {
    const session = await mupdfWriter.open(await documentWithBaseStateOff());
    try {
      const layers = await readLayers(session);
      // A reader that consulted `/OFF` alone answers `[true, true]` here, and
      // there is no `/OFF` key in this document at all — so it is not a
      // question the reader gets partly right.
      expect(layers.map((layer) => [layer.name, layer.visible])).toStrictEqual([
        ['Shown layer', true],
        ['Dark layer', false],
      ]);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('CONTROL: a document with no layers answers with none', async () => {
    const bare = await PDFDocument.create();
    bare.addPage([200, 200]);
    const session = await mupdfWriter.open(await bare.save({ useObjectStreams: false }));
    try {
      expect(await readLayers(session)).toStrictEqual([]);
    } finally {
      await mupdfWriter.close(session);
    }
  });
});

/**
 * The index MuPDF gives a layer, found by its name.
 *
 * Every case below needs *the hidden one* or *the visible one*, and the
 * fixture's own order is not MuPDF's — see the reader's case above. Looking it
 * up keeps each case about the property it is testing rather than about an
 * enumeration order none of them are claims about.
 */
async function indexOf(session: Parameters<typeof readLayers>[0], name: string): Promise<number> {
  const found = (await readLayers(session)).find((layer) => layer.name === name);
  if (found === undefined) throw new Error(`the fixture should carry a layer named "${name}"`);
  return found.index;
}

/** One layer's visibility, by name. */
async function visibilityOf(
  session: Parameters<typeof readLayers>[0],
  name: string,
): Promise<boolean> {
  const found = (await readLayers(session)).find((layer) => layer.name === name);
  if (found === undefined) throw new Error(`the fixture should carry a layer named "${name}"`);
  return found.visible;
}

describe('the setLayerVisibility command', () => {
  it('applies, and the change is OBSERVABLE through the reader', async () => {
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      const hidden = await indexOf(session, 'Hidden layer');
      await applySetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: hidden,
        visible: true,
      });

      expect(await visibilityOf(session, 'Hidden layer')).toBe(true);
      // AND THE OTHER LAYER IS UNTOUCHED, without which "it applied" is
      // satisfied by a command that turned everything on.
      expect(await visibilityOf(session, 'Visible layer')).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('captures the layers OWN state, not the negation of the command', async () => {
    // ADR-0009 §3's rule on a new axis. The rotation's inverse exists because a
    // prior value may be ABSENT; this one exists because a prior value may be
    // EQUAL to what was asked for — and an inverse derived as `!command.visible`
    // is wrong in exactly that case.
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      // Already visible; ask for visible again.
      const layer = await indexOf(session, 'Visible layer');
      const captured = await captureSetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer,
        visible: true,
      });

      expect(captured.captured).toBe(true);
      // TRUE, which is what it WAS. A derived inverse would carry `false` here
      // and would hide a layer the command never touched.
      expect(captured.captured && captured.prior).toStrictEqual({ layer, visible: true });
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('THE INVERSE RESTORES, including for a command that changed nothing', async () => {
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      const layer = await indexOf(session, 'Visible layer');
      const command = { kind: 'setLayerVisibility', layer, visible: true } as const;
      const captured = await captureSetLayerVisibility(session, command);
      if (!captured.captured) throw new Error('the fixture should capture');

      await applySetLayerVisibility(session, command);
      await invertSetLayerVisibility(session, captured.prior);

      // Still visible — the state it was in before a command that asked for the
      // state it was already in. A flipping inverse leaves it hidden.
      expect(await visibilityOf(session, 'Visible layer')).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('the inverse restores a REAL change too', async () => {
    // The control for the case above: without it, an inverse that did nothing
    // at all satisfies "a no-op command inverts to a no-op" perfectly.
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      const layer = await indexOf(session, 'Hidden layer');
      const command = { kind: 'setLayerVisibility', layer, visible: true } as const;
      const captured = await captureSetLayerVisibility(session, command);
      if (!captured.captured) throw new Error('the fixture should capture');

      await applySetLayerVisibility(session, command);
      expect(await visibilityOf(session, 'Hidden layer')).toBe(true);

      await invertSetLayerVisibility(session, captured.prior);
      expect(await visibilityOf(session, 'Hidden layer')).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('a layer outside the document is NOT CAPTURED rather than thrown', async () => {
    // An outcome the bus answers with a checkpoint, the same treatment a
    // malformed /Rotate gets — not a failure that strands the command halfway.
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      const captured = await captureSetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: 9,
        visible: true,
      });
      expect(captured.captured).toBe(false);
      expect(!captured.captured && captured.reason).toContain('outside this document');
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('and APPLYING to one throws, because that is a caller getting it wrong', async () => {
    // The two differ deliberately: a capture that cannot record prior state is
    // an outcome, and an apply asked to address a layer that is not there is a
    // defect. Collapsing them would make the second silent.
    const session = await mupdfWriter.open(await documentWithLayers());
    try {
      await expect(
        applySetLayerVisibility(session, { kind: 'setLayerVisibility', layer: 9, visible: true }),
      ).rejects.toBeInstanceOf(RangeError);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('edits /ON under /BaseState OFF, rather than an /OFF nothing consults', async () => {
    // The branch the fixture above exists for. Writing to `/OFF` regardless
    // would add a key this document's base state ignores: the layer would stay
    // exactly as it was, and *nothing happened* is indistinguishable from a
    // layer that was already in the state that was asked for.
    const session = await mupdfWriter.open(await documentWithBaseStateOff());
    try {
      await applySetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: await indexOf(session, 'Dark layer'),
        visible: true,
      });
      await applySetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: await indexOf(session, 'Shown layer'),
        visible: false,
      });

      expect(await visibilityOf(session, 'Dark layer')).toBe(true);
      expect(await visibilityOf(session, 'Shown layer')).toBe(false);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('writes a default configuration into a document that carries none', async () => {
    // `/OCGs` with no `/D` is malformed, and the reader treats it the way an
    // empty `/D` reads: everything visible. Refusing to hide a layer in a
    // document a reader will happily show would be a state the panel can
    // display and not act on.
    const session = await mupdfWriter.open(
      await documentWithBaseStateOff({ configuration: 'none' }),
    );
    try {
      expect((await readLayers(session)).map((layer) => layer.visible)).toStrictEqual([true, true]);

      await applySetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: await indexOf(session, 'Dark layer'),
        visible: false,
      });

      expect(await visibilityOf(session, 'Dark layer')).toBe(false);
      // AND ONLY THAT ONE. A configuration written with both groups in `/OFF`
      // satisfies the assertion above and hides half the document.
      expect(await visibilityOf(session, 'Shown layer')).toBe(true);
    } finally {
      await mupdfWriter.close(session);
    }
  });

  it('SURVIVES SAVE AND REOPEN, which is what makes the toggle a command', async () => {
    // The wired-tools rule's own sentence: *done for a tool means end to end —
    // click it, use it on a real document, observable correct effect, survives
    // save and reopen*. A visibility that lived in renderer state would pass
    // every case above and fail this one, and it is the failure a user meets
    // rather than a test.
    //
    // BOTH LAYERS MOVE, in opposite directions. A save that dropped
    // `/OCProperties` entirely leaves MuPDF reporting every layer visible,
    // which agrees with a fixture that only turned one on.
    const session = await mupdfWriter.open(await documentWithLayers());
    let written;
    try {
      await applySetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: await indexOf(session, 'Hidden layer'),
        visible: true,
      });
      await applySetLayerVisibility(session, {
        kind: 'setLayerVisibility',
        layer: await indexOf(session, 'Visible layer'),
        visible: false,
      });
      written = await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }

    const reopened = await mupdfWriter.open(written);
    try {
      expect(await visibilityOf(reopened, 'Hidden layer')).toBe(true);
      expect(await visibilityOf(reopened, 'Visible layer')).toBe(false);
    } finally {
      await mupdfWriter.close(reopened);
    }

    // AND READ BACK BY A DIFFERENT LIBRARY, for `rotatePages`' reason and one
    // sharper here: the reader above is this module's own parse of
    // `/OCProperties`, so a round trip verified through it proves this file is
    // self-consistent and nothing else. pdf-lib is asked what the bytes say.
    const byPdfLib = await PDFDocument.load(written, { updateMetadata: false });
    const properties = byPdfLib.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const off = properties.lookup(PDFName.of('D'), PDFDict).lookup(PDFName.of('OFF'), PDFArray);
    const namesOff = off
      .asArray()
      .map((entry) => String(byPdfLib.context.lookup(entry, PDFDict).get(PDFName.of('Name'))));
    // The lists swapped, which is the assertion an untouched `/OFF` fails. The
    // first version of this module left it at `[(Hidden layer)]` — the exact
    // bytes the fixture wrote — while reporting the change in session.
    expect(namesOff).toStrictEqual(['(Visible layer)']);
  });
});
