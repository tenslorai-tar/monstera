/**
 * The accessibility check's vocabulary, apart from the check itself (ADR-0078): the host channel
 * and `main` name these, and `accessibilityCheck.ts` loads the engine, which `main` must not.
 */

export type AccessibilityVerdict = 'passed' | 'failed' | 'not-applicable' | 'not-determined';

/** One rule's answer: its clause and test number, the verdict, and where it failed. */
export interface AccessibilityRuleResult {
  /** ISO 14289-1's clause, as veraPDF's profile names it — `7.18.3`. */
  readonly clause: string;
  readonly test: number;
  readonly verdict: AccessibilityVerdict;
  /** How many objects the rule found failing (or undecidable), for `failed` and `not-determined`. */
  readonly count: number;
  /** Zero-based pages the first failures are on, up to {@link MAX_REPORTED_PAGES}; empty for a document-wide rule. */
  readonly pages: readonly number[];
}

export const MAX_REPORTED_PAGES = 16;

/**
 * The checks ISO 14289-1 leaves to a person — PDF/UA's human checkpoints — reported on every run
 * so a document with no machine failure is still told what nobody has looked at.
 */
export const HUMAN_CHECKS = [
  'reading-order',
  'alternative-text-meaningful',
  'headings-reflect-structure',
  'table-headers-correct',
  'colour-not-sole-means',
  'language-of-passages',
  'link-text-meaningful',
] as const;

export interface AccessibilityReport {
  readonly rules: readonly AccessibilityRuleResult[];
  readonly humanChecks: typeof HUMAN_CHECKS;
}
