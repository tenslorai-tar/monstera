import type { ChannelResult, FieldActionTrigger, FieldFormat, FieldRange } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { FORMS_MANY_VALUES, FORMS_NOT_FILLABLE, FORMS_READ_ONLY, FORMS_SIGNED, FORMS_TOO_LONG } from '../messages/en.js';

/** One field as `document.formFields` lists it: the contract's own row, so this cannot drift from the channel. */
export type ListedField = ChannelResult<'document.formFields'>['fields'][number];

/**
 * What a person may do with one field, and the one answer the Forms panel and the page both render from
 * ([ADR-0168](../../../../docs/DECISIONS/0168-a-field-is-filled-where-it-is-on-its-page.md) Decision 2).
 *
 * - `text`: type into it. `lines` when it takes line breaks, or its value holds one however it got there, so it is
 *   edited in a control that keeps them.
 * - `toggle`: set it on or off. `radio` for an option of a group, where a press on the chosen one clears it.
 * - `choice`: choose one of its options, or none.
 * - `none`: nothing here, with the sentence that says why.
 */
export type FillOffer =
  | {
      readonly kind: 'text';
      readonly held: string;
      readonly lines: boolean;
      /** The rules the field's dictionary sets (ADR-0226 Decision 4), enforced where the person types. */
      readonly maxLength: number | null;
      readonly comb: boolean;
      readonly masked: boolean;
      readonly required: boolean;
      readonly format: FieldFormat | null;
      /** The number range it accepts (ADR-0230), checked where it is filled, or `null`. */
      readonly range: FieldRange | null;
    }
  | { readonly kind: 'toggle'; readonly on: boolean; readonly radio: boolean; readonly required: boolean }
  | {
      readonly kind: 'choice';
      readonly held: string;
      /**
       * The empty choice is offered first, because clearing is a fill; then the document's options; then the value
       * the field holds when the document does not offer it, so it is shown rather than read as empty.
       */
      readonly choices: readonly string[];
      /** A dropdown that also takes typing: what is typed is its value, offered or not. */
      readonly editable: boolean;
      /** A list box rather than a dropdown: its rows are shown at the field and a press chooses one (the owner's F2). */
      readonly list: boolean;
      readonly required: boolean;
    }
  | {
      /** A list that takes several values: what it holds, and its options in the document's order (ADR-0226 Decision 5). */
      readonly kind: 'choices';
      readonly held: readonly string[];
      readonly options: readonly string[];
      readonly required: boolean;
    }
  /**
   * A push button (ADR-0259). On each trigger in `runs` a press carries out the button's standard actions, each by its
   * own route; on each in `kept` it holds the document's own content (a script), which opening a document never runs
   * (invariant 24), and the press says so, since a control that pressed and said nothing would be the display-only defect.
   */
  | {
      readonly kind: 'button';
      readonly runs: readonly FieldActionTrigger[];
      readonly kept: readonly FieldActionTrigger[];
    }
  /**
   * An empty signature field (the owner's F8): pressed on the page, it offers the application's own signing — a typed,
   * drawn or picture signature, or a certificate — placed in that field. A signed one is `none`, so it is never signed
   * over.
   */
  | { readonly kind: 'sign' }
  | {
      readonly kind: 'none';
      readonly reason: MessageKey;
      readonly values?: Readonly<Record<string, string>>;
    };

/** A line break in any of the spellings a document's text can hold. */
const LINE_BREAK = /[\r\n]/u;

/**
 * What one field offers, by the rules the panel has carried since it landed and that the page now takes too.
 *
 * Read-only first, because it is the document's own word. A value listed as a slice next, because a fill writes its
 * whole text over the field and an edit started from the slice would save the slice over the rest. A choice holding
 * several values is not offered, because a fill carries one and would silently delete the others; the kernel refuses
 * to capture a prior for it, so there would not even be an undo.
 */
export function fieldFill(field: ListedField): FillOffer {
  if (field.readOnly) return { kind: 'none', reason: FORMS_READ_ONLY };
  if (field.cut === true) return { kind: 'none', reason: FORMS_TOO_LONG };
  if (field.kind === 'text') {
    const held = field.values[0] ?? '';
    return {
      kind: 'text',
      held,
      lines: field.multiline || LINE_BREAK.test(held),
      maxLength: field.maxLength,
      comb: field.comb,
      masked: field.masked,
      required: field.required,
      format: field.format,
      range: field.range ?? null,
    };
  }
  if (field.kind === 'checkbox' || field.kind === 'radio') {
    return { kind: 'toggle', on: field.on === true, radio: field.kind === 'radio', required: field.required };
  }
  // A LIST THAT TAKES SEVERAL is filled with several (ADR-0226 Decision 5); one holding a value it does not offer keeps
  // it, listed after the document's options, for the one-value list's reason below.
  if (field.kind === 'listbox' && field.multiSelect) {
    const unlisted = field.values.filter((value) => !field.options.includes(value));
    return { kind: 'choices', held: field.values, options: [...field.options, ...unlisted], required: field.required };
  }
  if (field.kind === 'dropdown' || field.kind === 'listbox') {
    if (field.values.length > 1) {
      return { kind: 'none', reason: FORMS_MANY_VALUES, values: { values: field.values.join(', ') } };
    }
    const held = field.values[0] ?? '';
    const offered = held === '' || field.options.includes(held);
    return {
      kind: 'choice',
      held,
      choices: ['', ...field.options, ...(offered ? [] : [held])],
      editable: field.kind === 'dropdown' && field.editable,
      list: field.kind === 'listbox',
      required: field.required,
    };
  }
  if (field.kind === 'button') return { kind: 'button', runs: field.actions?.runs ?? [], kept: field.actions?.kept ?? [] };
  if (field.kind === 'signature') return field.signed === true ? { kind: 'none', reason: FORMS_SIGNED } : { kind: 'sign' };
  return { kind: 'none', reason: FORMS_NOT_FILLABLE };
}
