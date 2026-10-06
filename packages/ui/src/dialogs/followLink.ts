import { MAX_LINK_URI_LENGTH, SHOWN_SCHEME_MAX } from '@monstera/contract';
import { lazy } from 'react';
import { z } from 'zod';

import { FOLLOW_LINK_TITLE } from '../messages/en.js';
import { declareDialog } from '../registries/dialogs.js';

/** The id a web link opens before anything leaves the document (ADR-0167 Decision 2). */
export const FOLLOW_LINK_DIALOG_ID = 'dialog.follow-link';

/** The one answer that opens the link. Closing the dialog is keeping the document, so × and Escape open nothing. */
export const FOLLOW_LINK_RESULT = z.object({ open: z.literal(true) }).strict();

/**
 * Asked before a document's web link is opened, from the page and from the Links panel alike: the address as the
 * listing shows it, and whether its scheme is one a person may follow. A scheme that is not says why and offers no way
 * on, so the dialog itself can never be the route a `file:` address takes.
 */
export const FOLLOW_LINK_DIALOG = declareDialog({
  id: FOLLOW_LINK_DIALOG_ID,
  title: FOLLOW_LINK_TITLE,
  props: z
    .object({
      address: z.string().max(MAX_LINK_URI_LENGTH),
      followable: z.boolean(),
      /** The scheme as `shownSchemeOf` says it, for the refusal's sentence; `null` for an address with none. */
      scheme: z.string().max(SHOWN_SCHEME_MAX).nullable(),
    })
    .strict(),
  result: FOLLOW_LINK_RESULT,
  component: lazy(() => import('./FollowLinkBody.js')),
});
