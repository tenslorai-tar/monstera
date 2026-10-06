import { LINK_SCHEMES, MAX_FIELD_NAME, MAX_LINK_URI } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import {
  FORM_FIELD_NAME_EMPTY,
  FORM_FIELD_NAME_SEGMENT,
  FORM_FIELD_NAME_TOO_LONG,
  LINK_ADDRESS_EMPTY,
  LINK_ADDRESS_SCHEME,
  LINK_ADDRESS_TOO_LONG,
  LINK_PAGE_EMPTY,
  LINK_PAGE_NOT_A_NUMBER,
  LINK_PAGE_TOO_LONG,
} from '../messages/en.js';

/**
 * What a person types for a link or a form field, and what is wrong with it: the message to show, or `undefined` for
 * words that pass. Each is the ONE statement of its rule (B3a) — the on-page line the tools ask for takes it as its
 * `check` (ADR-0154), and the field dialogs that still ask for more than a name take the name's.
 *
 * Every rule reads the TRIMMED words, as the payloads do, and answers its own *empty* message for nothing typed; the
 * field says that one only once the person has tried to finish (`attempt.ts`), so a box does not open complaining.
 */

/**
 * A web link's address: one a reader could follow, by a scheme this build allows (`LINK_SCHEMES`).
 *
 * A string `URL` cannot parse is not a different problem from a scheme this build refuses — both are *that is not an
 * address a reader could follow* — and one sentence naming what IS acceptable is more use than two naming different
 * ways of being wrong.
 */
export function linkAddressProblem(typed: string): MessageKey | undefined {
  const text = typed.trim();
  if (text === '') return LINK_ADDRESS_EMPTY;
  if (text.length > MAX_LINK_URI) return LINK_ADDRESS_TOO_LONG;
  try {
    return (LINK_SCHEMES as readonly string[]).includes(new URL(text).protocol) ? undefined : LINK_ADDRESS_SCHEME;
  } catch {
    return LINK_ADDRESS_SCHEME;
  }
}

/**
 * The page a person typed, as they count pages: from 1, or `undefined` for anything else.
 *
 * A STRICT MATCH RATHER THAN `Number(...)`, which accepts `1e3`, `0x10`, `Infinity` and an empty string — every one of
 * which is a person typing something other than a page number and being taken at a meaning they did not have. Spaces
 * around the digits are trimmed first, as every typed rule here does. The rule below and the link it builds both read
 * this, so what passes is what is built.
 */
export function typedPageNumber(typed: string): number | undefined {
  const text = typed.trim();
  return /^[1-9][0-9]*$/u.test(text) ? Number(text) : undefined;
}

/** A page link's page: one `typedPageNumber` reads. */
export function linkPageProblem(typed: string): MessageKey | undefined {
  const text = typed.trim();
  if (text === '') return LINK_PAGE_EMPTY;
  if (text.length > MAX_LINK_URI) return LINK_PAGE_TOO_LONG;
  return typedPageNumber(text) === undefined ? LINK_PAGE_NOT_A_NUMBER : undefined;
}

/**
 * A form field's name. A dot makes a parent in the field tree, so an empty segment (`a..b`, `.a`, `a.`) asks for a node
 * with no name, which `createFormFieldSchema` refuses; the segment rule is said only of a name within the length.
 */
export function fieldNameProblem(typed: string): MessageKey | undefined {
  const text = typed.trim();
  if (text === '') return FORM_FIELD_NAME_EMPTY;
  if (text.length > MAX_FIELD_NAME) return FORM_FIELD_NAME_TOO_LONG;
  return text.split('.').every((segment) => segment.trim().length > 0) ? undefined : FORM_FIELD_NAME_SEGMENT;
}
