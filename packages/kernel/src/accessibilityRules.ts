/**
 * The accessibility check's vocabulary, apart from the check itself (ADR-0078): the host channel
 * and `main` name these, and `accessibilityCheck.ts` loads the engine, which `main` must not.
 */

export type AccessibilityVerdict = 'passed' | 'failed' | 'not-applicable' | 'not-determined';

/**
 * A box in the page's display space at scale 1 — the space the text layer and the links are reported in, which a
 * surface places with the one conversion every engine box takes. Four numbers, because it crosses a channel.
 */
export interface AccessibilitySpotBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Where one failure is, for showing it on the page (ADR-0183): the zero-based page, and the box on it where the engine
 * can place the object — an annotation's own bounds. `null` where it can place the failure on the page only, which a
 * surface draws as the page itself: a figure without alternative text is a place in the tag tree, not on the page.
 */
export interface AccessibilitySpot {
  readonly page: number;
  readonly box: AccessibilitySpotBox | null;
}

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
  /**
   * The first failures, one each, up to {@link MAX_REPORTED_SPOTS}, in the order the walk met them; empty for a
   * document-wide rule, which has no place on any page. `pages` says which pages, and this says where on them.
   */
  readonly spots: readonly AccessibilitySpot[];
}

export const MAX_REPORTED_PAGES = 16;

/** How many failures one rule shows the place of: the contract's bound, named once there (ADR-0183). */
export { MAX_ACCESSIBILITY_SPOTS as MAX_REPORTED_SPOTS } from '@monstera/contract/host';

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
