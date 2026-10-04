import { MAX_FIELD_NAME, MAX_FIELD_OPTION, MAX_FIELD_OPTIONS } from '@monstera/contract';
import { z } from 'zod';

/**
 * What a create-field dialog answers with, and what a name typed on the page is
 * parsed as — its own module and not for tidiness: each declaration imports its
 * body lazily and the bodies need this type, so declaring it beside an entry
 * would make the two files circular.
 *
 * ## One schema for every way a field is named, and the optional members are the reason
 *
 * A text field and a tick box need a name, typed on the page (ADR-0154). A radio option needs a name and which option it is.
 * A dropdown needs a name and a list. Splitting that into three schemas would
 * mean three result modules and three parses at the tool, all to express *this
 * dialog did not ask that question* — which `undefined` already says.
 *
 * The **tool** is what narrows it, because the tool is what knows which kind it
 * is creating: it reads `option` or `options` and builds the payload's
 * discriminated union from them. A missing member there is a command that does
 * not type-check, which is where the check belongs.
 *
 * ## Every bound is the contract's, imported rather than restated
 *
 * A second number here would be a dialog that accepts what the channel refuses.
 *
 * The **empty-segment rule is deliberately NOT restated**, and that is the one
 * place this schema is looser than the payload. `createFormFieldSchema` refuses
 * `a..b`; the form component refuses it too, in the same words, before the
 * control is usable. Copying the refinement here would be a third statement of
 * one rule, and the two that exist are on the two sides that need it: the
 * boundary that must never accept it, and the control that must explain it.
 */
export const FORM_FIELD_RESULT = z
  .object({
    /** What the field is called. A path — a dot makes a parent in the field tree. */
    name: z.string().trim().min(1).max(MAX_FIELD_NAME),
    /** Which option of a radio group this widget is, when the dialog asked. */
    option: z.string().trim().min(1).max(MAX_FIELD_OPTION).optional(),
    /** What a choice field offers, when the dialog asked. */
    options: z.array(z.string().trim().min(1).max(MAX_FIELD_OPTION)).max(MAX_FIELD_OPTIONS).optional(),
  })
  .strict();

/** A field a person has described but not yet drawn into the document. */
export type FormFieldAnswer = z.infer<typeof FORM_FIELD_RESULT>;
