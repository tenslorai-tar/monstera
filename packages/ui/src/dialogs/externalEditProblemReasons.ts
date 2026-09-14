/**
 * Why a page did not go out to another application, or did not come back (ADR-0062).
 *
 * **Its own module for `replacePageResult.ts`' forced reason**: the dialog entry imports its
 * body lazily and the body needs this list, so declaring it beside the entry would make the
 * two circular.
 *
 * A refused or failed WRITE is not here. It is the same write a copy makes, so it opens the
 * save problem dialog, which already says it — a second sentence for it would be a second
 * opinion about one failure (B3a).
 */
export const EXTERNAL_EDIT_PROBLEMS = [
  'not-pdf',
  'launch-failed',
  'not-watchable',
  'document-changed',
  'open-elsewhere',
  'absent',
  'at-capacity',
] as const;

/** One of {@link EXTERNAL_EDIT_PROBLEMS}. */
export type ExternalEditProblem = (typeof EXTERNAL_EDIT_PROBLEMS)[number];
