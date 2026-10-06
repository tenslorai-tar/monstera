import type { ChannelResult } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import { FORMS_MANY_VALUES, FORMS_NOT_FILLABLE, FORMS_READ_ONLY, FORMS_TOO_LONG } from '../messages/en.js';

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
  | { readonly kind: 'text'; readonly held: string; readonly lines: boolean }
  | { readonly kind: 'toggle'; readonly on: boolean; readonly radio: boolean }
  | {
      readonly kind: 'choice';
      readonly held: string;
      /**
       * The empty choice is offered first, because clearing is a fill; then the document's options; then the value
       * the field holds when the document does not offer it, so it is shown rather than read as empty.
       */
      readonly choices: readonly string[];
    }
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
    return { kind: 'text', held, lines: field.multiline || LINE_BREAK.test(held) };
  }
  if (field.kind === 'checkbox' || field.kind === 'radio') {
    return { kind: 'toggle', on: field.on === true, radio: field.kind === 'radio' };
  }
  if (field.kind === 'dropdown' || field.kind === 'listbox') {
    if (field.values.length > 1) {
      return { kind: 'none', reason: FORMS_MANY_VALUES, values: { values: field.values.join(', ') } };
    }
    const held = field.values[0] ?? '';
    const offered = held === '' || field.options.includes(held);
    return { kind: 'choice', held, choices: ['', ...field.options, ...(offered ? [] : [held])] };
  }
  return { kind: 'none', reason: FORMS_NOT_FILLABLE };
}
