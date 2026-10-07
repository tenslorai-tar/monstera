import type { ChannelResult } from '@monstera/contract';
import type { DocVersion } from '@monstera/shared';

/**
 * What a document's accessibility tools hold (ADR-0183, ADR-0189), as its store keeps it. Pure types: the reads are
 * `run.ts`'s, and everything here is a function of what the channels answered.
 */

type CheckAnswer = ChannelResult<'document.accessibilityCheck'>;
type OrderAnswer = ChannelResult<'document.pageStructure'>;

/** One automatic rule's answer, as the channel gives it. */
export type AccessibilityRule = CheckAnswer['rules'][number];

/** One item of a page's reading order, as the channel gives it: a standard role, a depth, a count and a box. */
export type OrderItem = OrderAnswer['nodes'][number];

/**
 * Where one thing is, for marking it on the page: the zero-based page, and a box on it in the page's display space at
 * scale 1 — or `null`, which is the page itself.
 */
export interface Spot {
  readonly page: number;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
}

/**
 * The document check. `run` names the check a read belongs to, so one that finishes after another was started writes
 * nothing (`spelling/reviewRun.ts`' rule, for its reason).
 */
export type CheckState =
  | { readonly phase: 'reading'; readonly run: number }
  /** The document refused the read — busy, or no longer open. Said, and never shown as a clean result. */
  | { readonly phase: 'refused'; readonly run: number }
  | {
      readonly phase: 'done';
      readonly run: number;
      /** The version the check read, so a document that has since changed says the result is older than it. */
      readonly version: DocVersion;
      readonly rules: readonly AccessibilityRule[];
      readonly humanChecks: CheckAnswer['humanChecks'];
    };

/** One page's reading order, read for the page a person was on. */
export type OrderState =
  | { readonly phase: 'reading'; readonly run: number; readonly page: number }
  | { readonly phase: 'refused'; readonly run: number; readonly page: number }
  | {
      readonly phase: 'done';
      readonly run: number;
      /** Zero-based, as every page index crossing the contract is. */
      readonly page: number;
      readonly version: DocVersion;
      readonly nodes: readonly OrderItem[];
      readonly truncated: boolean;
      readonly untaggedLines: number;
      readonly images: number;
    };

/** The tab's two sections: the document's check, and the page's reading order. */
export type AccessibilitySection = 'check' | 'order';

export interface AccessibilityView {
  /**
   * Whether the tool is open, which is whether the document panel shows it (ADR-0189). It is the only thing that
   * shows it: the tool has no tab of its own and no setting, so a document that has never opened it, or has closed
   * it, draws nothing and marks nothing.
   */
  readonly open: boolean;
  readonly section: AccessibilitySection;
  readonly check: CheckState | undefined;
  readonly order: OrderState | undefined;
  /**
   * The place marked on the page, or `undefined` for none. `arrival` is a number that changes on every choice, so
   * choosing the same place twice moves the page to it twice — a person who scrolled away and chose it again expects
   * to be taken back.
   */
  readonly marked: { readonly spot: Spot; readonly arrival: number } | undefined;
  /**
   * A counter every check, read and choice takes the next of, so each is distinct from every earlier one: it numbers
   * the runs a late answer is checked against, and it is the `arrival` of a choice.
   */
  readonly sequence: number;
}

/** The view a document starts with: closed, nothing read, nothing marked, the check section showing. */
export const EMPTY_ACCESSIBILITY: AccessibilityView = {
  open: false,
  section: 'check',
  check: undefined,
  order: undefined,
  marked: undefined,
  sequence: 0,
};
