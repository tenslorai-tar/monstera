import type { FormFieldKind } from '@monstera/contract';
import { fieldNameClash } from '@monstera/shared';
import type { MessageKey } from '@monstera/shared';

import { FORM_FIELD_NAME_PARENT, FORM_FIELD_NAME_TAKEN } from '../messages/en.js';
import { fieldNameProblem } from './typedRules.js';

/**
 * A field the document already has, as far as a name is concerned: what it is called, what kind it is, and (for a radio
 * button) the choice it stands for.
 */
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
 * **A typed name never joins a radio group.** Joining one is what the radio tool's run does with the group name it chose
 * itself (`nextFieldName`, ADR-0226 Decision 11), never a name a person types; a rename to another group's name is the
 * same collision as any other. The allowance this once took for a typed radio name lost its last caller with the name
 * line (BBBBBBBB-10), and a branch no caller reaches is a rule nothing checks.
 */
export function fieldNameProblemAmong(typed: string, known: readonly KnownField[]): MessageKey | undefined {
  const own = fieldNameProblem(typed);
  if (own !== undefined) return own;
  const name = typed.trim();
  const clash = fieldNameClash(
    known.map((field) => field.name),
    name,
  );
  if (clash === undefined) return undefined;
  return clash === name ? FORM_FIELD_NAME_TAKEN : FORM_FIELD_NAME_PARENT;
}
