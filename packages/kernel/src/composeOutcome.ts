import type { ComposeRefusal } from '@monstera/contract';

/**
 * What every composer and the compose host's handlers share: a refusal, a page size and what a composition answers
 * ([ADR-0060](../../../docs/DECISIONS/0060-an-imported-source-is-parsed-in-a-contained-host-that-holds-no-document.md)).
 *
 * ## Its own module, and why
 *
 * The refusal and the page size sat in `composeLayout.ts` while the layout drew with the standard fonts. The layout
 * now shapes text with HarfBuzz and embeds fonts
 * ([ADR-0172](../../../docs/DECISIONS/0172-one-font-resolver-open-fonts-bundled-by-fingerprint-subsets-made-in-the-host.md)),
 * and a module that only needs to know what a refusal IS — the CSV reader, the image composer, the handlers — would
 * otherwise load a font engine to learn it.
 */

/** A source a composer will not set, named so the channel can say which. */
export class ComposeRefused extends Error {
  constructor(
    readonly reason: ComposeRefusal,
    /** The one-based source line the refusal is about, where there is one. */
    readonly line: number | null,
    message: string,
    /** The one-based position of the picked file the refusal is about, for a multi-file import. */
    readonly item: number | null = null,
  ) {
    super(message);
    this.name = 'ComposeRefused';
  }
}

/** A page's size in points. */
export interface ComposePageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * A character the composed document draws as the missing-character box, and where the source holds it: a one-based
 * line, and a one-based column counted in characters, `null` where the character is not in the source as itself (a
 * Markdown entity such as `&#x13000;` draws one).
 */
export interface BoxedPosition {
  readonly character: string;
  readonly line: number;
  readonly column: number | null;
}

/** What a composer answers: the PDF, and every place a character in it is drawn as the box. */
export interface ComposedSource {
  readonly pdf: Uint8Array;
  readonly boxed: readonly BoxedPosition[];
}

/** A block of the source a composer set, by its one-based lines: `from` to `to`, `to` included. */
export interface SourceBlock {
  readonly from: number;
  readonly to: number;
}

/**
 * Where each boxed character is in the source: every place it occurs as itself within the block it was drawn from,
 * once each, in source order.
 *
 * ## Searched in the source, because a drawing is not a place
 *
 * A layout draws a character more often than it is written — a table's header row is drawn again on every page — and
 * draws it in an order the source does not have, since a right-to-left line is reversed. So the layout reports which
 * character it boxed and the block it came from, and the place is read out of that block's lines, where every
 * occurrence of a character no face carries is one the layout boxed: the faces are the same for the whole document.
 * The one exception is stated rather than hidden: a Markdown image's path is never drawn, so the same character in a
 * path inside a block that also draws it is reported though nothing is boxed there.
 *
 * @param blocks each block's lines, by the line the layout reported for it
 */
export function boxedPositions(
  source: string,
  boxed: readonly { readonly character: string; readonly line: number | null }[],
  blocks: ReadonlyMap<number, SourceBlock>,
): BoxedPosition[] {
  const lines = source.split(/\r\n|\n|\r/u);
  const found = new Map<string, BoxedPosition>();
  const searched = new Set<string>();
  for (const { character, line } of boxed) {
    if (line === null) continue;
    const key = `${String(line)}\u0000${character}`;
    if (searched.has(key)) continue;
    searched.add(key);
    const block = blocks.get(line) ?? { from: line, to: line };
    let any = false;
    for (let number = block.from; number <= block.to; number += 1) {
      const characters = Array.from(lines[number - 1] ?? '');
      for (let at = 0; at < characters.length; at += 1) {
        if (characters[at] !== character) continue;
        any = true;
        found.set(`${String(number)}:${String(at + 1)}`, { character, line: number, column: at + 1 });
      }
    }
    if (!any) found.set(`${String(block.from)}:\u0000${character}`, { character, line: block.from, column: null });
  }
  return [...found.values()].sort((left, right) => left.line - right.line || (left.column ?? 0) - (right.column ?? 0));
}
