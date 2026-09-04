import { describe, expect, it } from 'vitest';

import type { CommandKind } from '@monstera/contract';

import { declaredCommands } from './commandDeclarations.js';
import { writerShapes } from './engineSeam.js';

/**
 * Properties of the declaration table itself, rather than of any command in it.
 *
 * The one case here exists because
 * [ADR-0039](../../../docs/DECISIONS/0039-a-byte-image-writer-round-trips-the-live-session.md)
 * makes a **cost** argument, and a cost argument has a scope. Costs are not
 * type errors, so nothing in the compiler was keeping that scope true.
 */

/** Every declared kind, as the table itself lists them. */
const KINDS = Object.keys(declaredCommands) as readonly CommandKind[];

describe('the declaration table', () => {
  it('CONTROL: it declares both writer shapes, so the case below is not vacuous', () => {
    // Without this, a table that happened to route everything to MuPDF would
    // satisfy the case below by having nothing to check — the reassuring answer
    // arriving through an empty set.
    const shapes = new Set(KINDS.map((kind) => writerShapes[declaredCommands[kind].writer]));
    expect([...shapes].sort()).toStrictEqual(['byte-image', 'live-session']);
  });

  it('every BYTE-IMAGE command is non-invertible, which is what ADR-0039 priced', () => {
    // ## What this guards, and what it deliberately does NOT
    //
    // ADR-0039 argues that refreshing `main`'s canonical image costs nothing per
    // command. The measurement behind that is narrower than the sentence, and
    // this case is where the narrowness is kept honest.
    //
    // Read from the code: `CommandBus.#sessionFor` obtains a byte-image
    // writer's session by calling `ByteImageAccess.current()`, which is a FULL
    // SERIALISE of the live engine session — and it does so for every
    // byte-image command, whatever its invertibility. `pdfLibWriter.serialise`
    // is the identity, so a terminal entry's checkpoint is that same array and
    // costs nothing more.
    //
    // So for a NON-INVERTIBLE byte-image command the serialise doubles as the
    // checkpoint the bus was going to take anyway, and nothing extra is paid.
    // For an INVERTIBLE one there is no checkpoint, and the serialise is a cost
    // its live-session equivalent — `rotatePages`, say — does not pay.
    //
    // ## Why this is a case and NOT a type
    //
    // The type could carry it: the declaration union already discriminates
    // invertible from terminal, and `writer: 'pdf-lib'` could be made to sit
    // only on a non-invertible member. That would be **wrong**, because
    // `docs/ARCHITECTURE.md` §3's matrix assigns *"Form fields: create"* to
    // `@cantoo/pdf-lib` — the one concern MuPDF has no API for — and creating a
    // field is plausibly invertible: its prior state is *the field did not
    // exist*, which is small and serialisable. A compile error here would
    // forbid a Stage 4 command the architecture already anticipates.
    //
    // So the fact is true today and is not a rule. This case is the trigger:
    // the first byte-image command declared `invertible: true` turns it red,
    // and the failure message says what to do rather than what not to.
    //
    // DERIVED from `writerShapes` and the table, never listed — 4c's direction
    // test: the failure feared is a member ARRIVING, so a derived set tracks it
    // and a hand-kept list would not.
    const invertibleByteImage = KINDS.filter(
      (kind) =>
        writerShapes[declaredCommands[kind].writer] === 'byte-image' &&
        declaredCommands[kind].invertible,
    );

    expect(
      invertibleByteImage,
      `${invertibleByteImage.join(', ')} is routed to a byte-image writer and declared ` +
        `invertible. That is LEGITIMATE — ARCHITECTURE §3 assigns form-field creation to ` +
        `@cantoo/pdf-lib and creating a field is invertible — and it falls outside ADR-0039's ` +
        `cost argument, which covers only the non-invertible case. Such a command pays a full ` +
        `serialise of the live session (CommandBus.#sessionFor -> ByteImageAccess.current) that ` +
        `no checkpoint was going to pay for. Amend ADR-0039 to price it, then update this case.`,
    ).toStrictEqual([]);
  });
});
