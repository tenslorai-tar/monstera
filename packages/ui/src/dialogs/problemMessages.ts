import type { SERVICE_PROBLEMS } from '@monstera/contract';
import { type EditStep, type FailureDetails, type MessageKey, PDFIUM_PASSWORD_ERROR } from '@monstera/shared';

import {
  ANTHROPIC_OUT_OF_CREDIT,
  EDIT_REFUSED_GENERATE,
  EDIT_REFUSED_MATRIX,
  EDIT_REFUSED_OBJECT,
  EDIT_REFUSED_OPEN,
  EDIT_REFUSED_PAGE,
  EDIT_REFUSED_PASSWORD,
  EDIT_REFUSED_READ_BACK,
  EDIT_REFUSED_SAVE,
  EDIT_REFUSED_SET_TEXT,
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
  PROBLEM_REFERENCE_LABEL,
  PROBLEM_STALE_TARGET,
  TEXT_EDIT_CHARACTERS_LABEL,
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
  | { readonly code: 'text-not-writable'; readonly detail: FailureDetails['text-not-writable'] }
  | { readonly code: 'text-not-in-place' }
  | { readonly code: 'edit-refused'; readonly detail: FailureDetails['edit-refused'] }
  | { readonly code: 'copy-absent' }
  | { readonly code: 'copy-at-capacity' }
  | { readonly code: 'copy-busy' }
  | { readonly code: 'copy-denied' }
  | { readonly code: (typeof SERVICE_PROBLEMS)[number] }
  | { readonly code: 'internal'; readonly incident: string };

/**
 * The sentence for a problem — the ONE reader, called by the problem dialog and by a surface that says a refusal in its
 * own place (the spelling panel, ADR-0156 Decision 5), so a refusal reads the same wherever it is said.
 *
 * A FUNCTION, because one code's sentence is not the code's: `edit-refused` says which step refused (ADR-0169
 * Decision 5), and at `open` PDFium's password number says the document is protected.
 *
 * Its own module rather than the dialog body's, because the body is loaded lazily and a surface that imported this
 * from it would load the body with it.
 */
export function problemMessage(problem: CommandProblem): MessageKey {
  if (problem.code !== 'edit-refused') return CODE_MESSAGE[problem.code];
  const { step, engineError } = problem.detail;
  return step === 'open' && engineError === PDFIUM_PASSWORD_ERROR ? EDIT_REFUSED_PASSWORD : STEP_MESSAGE[step];
}

/**
 * What a person can read or quote beside a problem's sentence, where it has something: the incident `internal` was
 * withheld into, the step and PDFium's number an edit was refused at, or the characters a font cannot show
 * (ADR-0169). Read by every surface that says a problem, so the dialog and the editor show the same thing.
 */
export function problemParticulars(
  problem: CommandProblem,
): { readonly label: MessageKey; readonly value: string } | undefined {
  if (problem.code === 'internal') return { label: PROBLEM_REFERENCE_LABEL, value: problem.incident };
  if (problem.code === 'edit-refused') {
    return { label: PROBLEM_REFERENCE_LABEL, value: `${problem.detail.step} ${String(problem.detail.engineError)}` };
  }
  if (problem.code === 'text-not-writable') {
    // ONE CHARACTER AT A TIME, a space between: an accent and a letter, or two marks, read as one smudge run together.
    const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(problem.detail.characters);
    return { label: TEXT_EDIT_CHARACTERS_LABEL, value: Array.from(graphemes, (part) => part.segment).join(' ') };
  }
  return undefined;
}

/** One sentence per step of a PDFium rewrite, each ending in *so nothing was changed*. */
const STEP_MESSAGE: Readonly<Record<EditStep, MessageKey>> = {
  open: EDIT_REFUSED_OPEN,
  page: EDIT_REFUSED_PAGE,
  object: EDIT_REFUSED_OBJECT,
  'set-text': EDIT_REFUSED_SET_TEXT,
  matrix: EDIT_REFUSED_MATRIX,
  generate: EDIT_REFUSED_GENERATE,
  save: EDIT_REFUSED_SAVE,
  'read-back': EDIT_REFUSED_READ_BACK,
};

/**
 * The sentence for each code whose sentence is the code's.
 *
 * A `Record` keyed by the code, for the reason `SaveProblemBody` uses one: the
 * union comes from the **channels**, so it grows in a file nobody editing this
 * one will open, and a missing key must land on the table rather than on a
 * return path that quietly yields `undefined`.
 */
const CODE_MESSAGE: Readonly<Record<Exclude<CommandProblem['code'], 'edit-refused'>, MessageKey>> = {
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
