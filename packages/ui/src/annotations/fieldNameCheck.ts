import type { FormFieldKind } from '@monstera/contract';
import { fieldNameClash } from '@monstera/shared';
import type { MessageKey } from '@monstera/shared';
import { z } from 'zod';

import {
  FORM_FIELD_NAME_PARENT,
  FORM_FIELD_NAME_TAKEN,
  FORM_FIELD_OPTION_TAKEN,
} from '../messages/en.js';
import { fieldNameProblem } from './typedRules.js';

/**
 * A field the document already has, as far as a name is concerned: what it is called, what kind it is, and (for a radio
 * button) the choice it stands for.
 */
export const KNOWN_FIELD = z
  .object({
    name: z.string(),
    kind: z.enum(['text', 'checkbox', 'radio', 'dropdown', 'listbox', 'signature', 'button', 'other']),
    options: z.array(z.string()),
  })
  .strict();

export interface KnownField {
  readonly name: string;
  readonly kind: FormFieldKind;
  readonly options: readonly string[];
}

/**
 * Whether a field can be called this, among the fields the document has.
 *
 * ## The same rule the writer refuses with, asked first
 *
 * `fieldNameClash` is the shared answer to *can a field be called this*: an exact repeat, or a name that is the start
 * of another's or has another's for its start, because a dot makes a parent. The create refused with it and the
 * refusal reached the person as *something went wrong inside Monstera*, because an apply's reason does not cross the
 * engine host's boundary. A name the document already has is a known cause, so it is said here, in words, before
 * anything is sent.
 *
 * **A radio option may join a radio group of the same name**, which is what drawing the second option of a group is;
 * a radio named for any other kind of field is the same collision as any other.
 */
export function fieldNameProblemAmong(
  typed: string,
  known: readonly KnownField[],
  joiningRadio: boolean,
): MessageKey | undefined {
  const own = fieldNameProblem(typed);
  if (own !== undefined) return own;
  const name = typed.trim();
  const clash = fieldNameClash(
    known.map((field) => field.name),
    name,
  );
  if (clash === undefined) return undefined;
  if (joiningRadio && clash === name && known.some((field) => field.name === name && field.kind === 'radio')) {
    // EVERY WIDGET OF THE GROUP IS LISTED UNDER ITS NAME, so a clash with the exact name may still be a PARENT clash
    // with another field; only an exact radio match joins.
    return undefined;
  }
  return clash === name ? FORM_FIELD_NAME_TAKEN : FORM_FIELD_NAME_PARENT;
}

/**
 * Whether a radio group already has this choice. Each option of a group has its own value, and two with one value are
 * two widgets that switch on together, which is not a group of choices.
 */
export function optionProblem(
  option: string,
  group: string,
  known: readonly KnownField[],
  usedHere: readonly string[],
): MessageKey | undefined {
  const wanted = option.trim();
  if (wanted === '') return undefined;
  const held = known.filter((field) => field.kind === 'radio' && field.name === group).flatMap((field) => field.options);
  return [...held, ...usedHere].includes(wanted) ? FORM_FIELD_OPTION_TAKEN : undefined;
}
