import type { MessageKey } from '@monstera/shared';

import {
  START_ABSENT,
  START_AT_CAPACITY,
  START_BUSY,
  START_DENIED,
  START_FAILED,
  START_NO_PATH,
} from '../messages/en.js';

/**
 * Why an open ended with no document and something to say about it.
 *
 * `busy` and `denied` are a file that is there and whose read was refused; `failed` is an open main answered with a
 * fault, which a person is told about too, because an open that ends in nothing on screen and nothing said is the
 * control that appears to do nothing.
 *
 * **Its own module for `externalEditProblemReasons.ts`' reason**: the dialog entry imports its body lazily and the
 * body needs this list, so declaring it beside the entry would make the two circular.
 */
export const OPEN_PROBLEMS = ['absent', 'at-capacity', 'no-path', 'busy', 'denied', 'failed'] as const;

/** One of {@link OPEN_PROBLEMS}. */
export type OpenProblem = (typeof OPEN_PROBLEMS)[number];

/**
 * One open that ended with no document, and the file it was for when the page knows one.
 *
 * `name` is the file's own name, never a path (L2): a drop knows it from the `File`, and main states it for a pick and
 * a launch. It is what lets a person who opened five files be told WHICH one did not open. A single open that has no
 * name to give (a handle from the recent list, say) carries none.
 */
export interface OpenProblemReport {
  readonly reason: OpenProblem;
  readonly name?: string | undefined;
}

/**
 * What each problem says, for the start screen's line and the dialog alike: ONE sentence per problem, wherever it is
 * shown (B3a). A `Record`, so a problem added to the list is a compile error here until it has a sentence.
 */
export const OPEN_PROBLEM_SENTENCE: Readonly<Record<OpenProblem, MessageKey>> = {
  absent: START_ABSENT,
  'at-capacity': START_AT_CAPACITY,
  'no-path': START_NO_PATH,
  busy: START_BUSY,
  denied: START_DENIED,
  failed: START_FAILED,
};
