import type { MessageKey } from '@monstera/shared';
import type { ReactElement } from 'react';

import {
  LINK_PAGE_APPLY,
  LINK_PAGE_EMPTY,
  LINK_PAGE_LABEL,
  LINK_PAGE_NOT_A_NUMBER,
  LINK_PAGE_TOO_LONG,
} from '../messages/en.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import { AnnotationTextForm } from './AnnotationTextForm.js';
import type { LinkTextAnswer } from './annotationLink.js';

/**
 * Which page a link goes to.
 *
 * ## The number a person types is ONE-BASED, and the payload is not
 *
 * Every surface in this application counts pages from 1 and every payload
 * counts from 0; `pageNumbering.ts` is where the two meet. The conversion is
 * the TOOL's here rather than this dialog's, because the dialog collects what
 * was typed and the tool builds the command — which keeps the offset in one
 * place instead of two components each holding half of it.
 *
 * ## It does not know how many pages there are
 *
 * `declareDialog`'s props are `{}` for the sibling dialogs' reason, and this one
 * could carry a count. It deliberately does not: the page count is the
 * document's, it moves while a dialog is open, and the kernel refuses an
 * out-of-range page with a message that names the count it actually has. A
 * bound checked here would be a second opinion about a number that can change
 * between the check and the command.
 *
 * So what this refuses is what it can decide on its own — *that is not a page
 * number* — and the rest is the kernel's refusal, reported where every other
 * one is.
 */
export default function LinkPageBody({ resolve }: DialogAnswering<LinkTextAnswer>): ReactElement {
  return (
    <AnnotationTextForm
      apply={LINK_PAGE_APPLY}
      empty={LINK_PAGE_EMPTY}
      label={LINK_PAGE_LABEL}
      resolve={resolve}
      tooLong={LINK_PAGE_TOO_LONG}
      validate={numbered}
    />
  );
}

/** `undefined` when the value is a page a reader could name. */
function numbered(value: string): MessageKey | undefined {
  // A STRICT MATCH RATHER THAN `Number(...)`, which accepts `1e3`, ` 12 `,
  // `0x10` and `Infinity` — every one of which is a person typing something
  // other than a page number and being taken at a meaning they did not have.
  return /^[1-9][0-9]*$/u.test(value) ? undefined : LINK_PAGE_NOT_A_NUMBER;
}
