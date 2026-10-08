/**
 * The PowerPoint export's modes ([ADR-0210](../../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * `editable` writes a page's own text, pictures and shapes as slide objects a person can edit; `exact` is one picture per
 * slide, as ADR-0072 built it, and is what a page falls back to when it cannot be written editable. Required on the
 * channel, not defaulted there: an omitted mode would silently pick one for a caller that forgot to ask.
 */
export const POWERPOINT_MODES = ['editable', 'exact'] as const;

/** One of {@link POWERPOINT_MODES}. */
export type PowerPointMode = (typeof POWERPOINT_MODES)[number];

/**
 * How many fallback page numbers an answer lists. The count is always exact (`fellBackCount`); the list is what a sentence
 * can name, and a document of eight thousand fallbacks does not need eight thousand numbers crossing to say so.
 */
export const POWERPOINT_FALLBACK_LISTED_MAX = 100;
