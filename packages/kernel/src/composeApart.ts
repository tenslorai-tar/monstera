import type { ComposeRefusal } from '@monstera/contract';

import { type ApartWork, runApart } from './apart.js';
import { type ComposePageSize, ComposeRefused, type ComposedSource } from './composeOutcome.js';
import type { CatalogueFace, FaceSource } from './fontCatalogue.js';

/**
 * A text source composed in a thread that ends with the composition
 * ([ADR-0239](../../../docs/DECISIONS/0239-a-fonts-whole-file-is-read-in-a-thread-that-ends.md) Decision 3): every face
 * it shaped through HarfBuzz, every subset it made and every buffer pdf-lib held go with the thread. The compose host
 * hands these to its handlers in place of `composeMarkdown` and `composeCsv`, whose signature they keep.
 */

/** Which composer the thread runs. */
export type ComposeKind = 'markdown' | 'csv';

/** What the thread is given: the source, and the faces as data, whose files it reads itself. */
export interface ComposeRequest {
  readonly kind: ComposeKind;
  readonly source: Uint8Array;
  readonly page: ComposePageSize;
  readonly faces: readonly CatalogueFace[];
  readonly family: string;
}

/**
 * The thread's answer: the composition, or the composer's named refusal, carried as data because a class does not
 * cross a thread. Anything else the composer throws is the thread's failure, and stays a fault.
 */
export type ComposeOutcome =
  | { readonly kind: 'composed'; readonly composed: ComposedSource }
  | {
      readonly kind: 'refused';
      readonly reason: ComposeRefusal;
      readonly line: number | null;
      readonly item: number | null;
      readonly message: string;
    };

/** The composition's thread, taken by this asker and by `composeWorker.ts`. */
export const COMPOSITION: ApartWork<ComposeRequest, ComposeOutcome> = {
  entry: new URL('./composeWorker.js', import.meta.url),
  label: 'a composition',
};

/** The composer of `kind`, run apart; a refusal is thrown as the same `ComposeRefused` the composer threw. */
export function composerApart(
  kind: ComposeKind,
): (source: Uint8Array, page: ComposePageSize, faces: FaceSource, family: string) => Promise<ComposedSource> {
  return async (source, page, faces, family) => {
    const outcome = await runApart(COMPOSITION, { kind, source, page, faces: faces.faces, family });
    if (outcome.kind === 'refused') throw new ComposeRefused(outcome.reason, outcome.line, outcome.message, outcome.item);
    return outcome.composed;
  };
}
