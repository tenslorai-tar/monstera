import type { ChosenSignatureMark, RequestedSignatureMark } from '@monstera/contract';

import type { KeptSignature } from '../dialogs/signDocument.js';
import { outlinedMarkOf } from '../signatureFaces.js';

/**
 * A chosen signature look, as it is sent — for both routes that place one, the plain Signature and *Sign with
 * certificate* (ADR-0150).
 */

/** What stops a typed name before it is sent, as the signature problem dialog says it. */
export type TypedNameProblem =
  | { readonly reason: 'cannot-write'; readonly characters: string }
  | { readonly reason: 'too-long' }
  | { readonly reason: 'blank' };

/**
 * A chosen look as main is asked for it — THE ONE PLACE a typed name becomes its outline before it crosses. Every
 * other look crosses as chosen.
 */
export async function requestedMarkOf(
  mark: ChosenSignatureMark,
): Promise<
  { readonly kind: 'ready'; readonly mark: RequestedSignatureMark } | { readonly kind: 'problem'; readonly problem: TypedNameProblem }
> {
  if (mark.kind !== 'typed') return { kind: 'ready', mark };
  const outlined = await outlinedMarkOf(mark);
  if (outlined.kind === 'ready') return outlined;
  if (outlined.kind === 'missing') {
    return { kind: 'problem', problem: { reason: 'cannot-write', characters: outlined.characters.join(' ') } };
  }
  return { kind: 'problem', problem: { reason: outlined.kind } };
}

/**
 * A kept signature named by a dialog's answer, as the look to place: a TYPED one as its name and face, because its
 * outline is made here and main has none to draw; any other kept look stays named by its id, as main resolves it.
 */
export function chosenOfKept(mark: ChosenSignatureMark, kept: readonly KeptSignature[]): ChosenSignatureMark {
  if (mark.kind !== 'saved') return mark;
  const look = kept.find((entry) => entry.id === mark.id)?.look;
  return look?.kind === 'typed' ? look : mark;
}
