import type { SERVICE_PROBLEMS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import {
  ANTHROPIC_OUT_OF_CREDIT,
  PROBLEM_SERVICE_ADDRESS,
  PROBLEM_SERVICE_NO_KEY,
  PROBLEM_SERVICE_REFUSED,
  PROBLEM_SERVICE_UNAUTHORISED,
  PROBLEM_SERVICE_UNAVAILABLE,
  PROBLEM_BUSY,
  PROBLEM_COMMENT_TOO_LONG,
  PROBLEM_COPY_ABSENT,
  PROBLEM_COPY_AT_CAPACITY,
  PROBLEM_COPY_BUSY,
  PROBLEM_COPY_DENIED,
  PROBLEM_ENGINE_UNAVAILABLE,
  PROBLEM_RASTER_TOO_LARGE,
  PROBLEM_NOT_COPYABLE,
  PROBLEM_INTERNAL,
  PROBLEM_NOT_OPEN,
  PROBLEM_POISONED,
  PROBLEM_STALE_TARGET,
  TEXT_EDIT_NOT_WRITABLE,
  TEXT_NOT_IN_PLACE,
} from '../messages/en.js';

/** Every failure code a document command can hand a renderer. */
export type CommandProblem =
  | { readonly code: 'document-not-open' }
  | { readonly code: 'document-busy' }
  | { readonly code: 'document-poisoned' }
  | { readonly code: 'stale-target' }
  | { readonly code: 'engine-unavailable' }
  | { readonly code: 'raster-too-large' }
  | { readonly code: 'not-copyable' }
  | { readonly code: 'comment-too-long' }
  | { readonly code: 'text-not-writable' }
  | { readonly code: 'text-not-in-place' }
  | { readonly code: 'copy-absent' }
  | { readonly code: 'copy-at-capacity' }
  | { readonly code: 'copy-busy' }
  | { readonly code: 'copy-denied' }
  | { readonly code: (typeof SERVICE_PROBLEMS)[number] }
  | { readonly code: 'internal'; readonly incident: string };

/**
 * The sentence for each code — the ONE table, read by the problem dialog and by a surface that says a refusal in its
 * own place (the spelling panel, ADR-0156 Decision 5), so a refusal reads the same wherever it is said.
 *
 * A `Record` keyed by the code, for the reason `SaveProblemBody` uses one: the
 * union comes from the **channels**, so it grows in a file nobody editing this
 * one will open, and a missing key must land on the table rather than on a
 * return path that quietly yields `undefined`.
 *
 * Its own module rather than the dialog body's, because the body is loaded lazily and a surface that imported the table
 * from it would load the body with it.
 */
export const PROBLEM_MESSAGE: Readonly<Record<CommandProblem['code'], MessageKey>> = {
  'document-not-open': PROBLEM_NOT_OPEN,
  'document-busy': PROBLEM_BUSY,
  'document-poisoned': PROBLEM_POISONED,
  'stale-target': PROBLEM_STALE_TARGET,
  'engine-unavailable': PROBLEM_ENGINE_UNAVAILABLE,
  'raster-too-large': PROBLEM_RASTER_TOO_LARGE,
  'not-copyable': PROBLEM_NOT_COPYABLE,
  'comment-too-long': PROBLEM_COMMENT_TOO_LONG,
  'text-not-writable': TEXT_EDIT_NOT_WRITABLE,
  'text-not-in-place': TEXT_NOT_IN_PLACE,
  'copy-absent': PROBLEM_COPY_ABSENT,
  'copy-at-capacity': PROBLEM_COPY_AT_CAPACITY,
  'copy-busy': PROBLEM_COPY_BUSY,
  'copy-denied': PROBLEM_COPY_DENIED,
  'service-no-key': PROBLEM_SERVICE_NO_KEY,
  'service-unauthorised': PROBLEM_SERVICE_UNAUTHORISED,
  'service-address': PROBLEM_SERVICE_ADDRESS,
  'service-out-of-credit': ANTHROPIC_OUT_OF_CREDIT,
  'service-unavailable': PROBLEM_SERVICE_UNAVAILABLE,
  'service-refused': PROBLEM_SERVICE_REFUSED,
  internal: PROBLEM_INTERNAL,
};
