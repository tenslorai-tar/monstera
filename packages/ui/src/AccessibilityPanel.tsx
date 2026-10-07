import { useLingui } from '@lingui/react';
import type { ACCESSIBILITY_HUMAN_CHECKS } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useSyncExternalStore } from 'react';

import { type AccessibilityDeps, clearMark, mark, readOrder, runCheck, showSection } from './accessibility/run.js';
import { RULE_WORDS, ruleKey } from './accessibility/rules.js';
import {
  type AccessibilityRule,
  type AccessibilitySection,
  type AccessibilityView,
  EMPTY_ACCESSIBILITY,
  type OrderItem,
  type OrderState,
  type Spot,
} from './accessibility/view.js';
import type { DocumentStore } from './documentStores.js';
import {
  ACCESSIBILITY_ALL_CLEAR,
  ACCESSIBILITY_COUNT,
  ACCESSIBILITY_FIX_HEADING,
  ACCESSIBILITY_HIDE_MARK,
  ACCESSIBILITY_HUMAN_ALT_TEXT,
  ACCESSIBILITY_HUMAN_COLOUR,
  ACCESSIBILITY_HUMAN_HEADINGS,
  ACCESSIBILITY_HUMAN_LANGUAGE,
  ACCESSIBILITY_HUMAN_LINKS,
  ACCESSIBILITY_HUMAN_READING_ORDER,
  ACCESSIBILITY_HUMAN_TABLES,
  ACCESSIBILITY_INTRO,
  ACCESSIBILITY_NOT_CONFORMANCE,
  ACCESSIBILITY_PASSED_HEADING,
  ACCESSIBILITY_PERSON_HEADING,
  ACCESSIBILITY_PERSON_RESULT_HEADING,
  ACCESSIBILITY_REFUSED,
  ACCESSIBILITY_RULE_UNKNOWN,
  ACCESSIBILITY_RUN,
  ACCESSIBILITY_RUN_AGAIN,
  ACCESSIBILITY_RUNNING,
  ACCESSIBILITY_SECTION_CHECK,
  ACCESSIBILITY_SECTION_ORDER,
  ACCESSIBILITY_SECTIONS_LABEL,
  ACCESSIBILITY_SHOW_PROBLEM,
  ACCESSIBILITY_SHOW_PROBLEM_LABEL,
  ACCESSIBILITY_SHOWN_ON_PAGE,
  ACCESSIBILITY_STALE,
  ACCESSIBILITY_SUMMARY,
  ACCESSIBILITY_UNDECIDED,
  ACCESSIBILITY_WHOLE_FILE,
  CONTEXT_PANEL_TAB_ACCESSIBILITY,
  ORDER_INTRO,
  ORDER_NO_TEXT,
  ORDER_READING,
  ORDER_SHOW_ITEM,
  PAGE_STRUCTURE_IMAGES,
  PAGE_STRUCTURE_LINES,
  PAGE_STRUCTURE_PAGE,
  PAGE_STRUCTURE_REFUSED,
  PAGE_STRUCTURE_TRUNCATED,
  PAGE_STRUCTURE_UNTAGGED,
  PAGE_STRUCTURE_UNTAGGED_LINES,
  STRUCTURE_ROLE_NAME,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';
import { SegmentedControl } from './primitives/SegmentedControl.js';

type HumanCheck = (typeof ACCESSIBILITY_HUMAN_CHECKS)[number];

const HUMAN_WORDS: Readonly<Record<HumanCheck, MessageKey>> = {
  'reading-order': ACCESSIBILITY_HUMAN_READING_ORDER,
  'alternative-text-meaningful': ACCESSIBILITY_HUMAN_ALT_TEXT,
  'headings-reflect-structure': ACCESSIBILITY_HUMAN_HEADINGS,
  'table-headers-correct': ACCESSIBILITY_HUMAN_TABLES,
  'colour-not-sole-means': ACCESSIBILITY_HUMAN_COLOUR,
  'language-of-passages': ACCESSIBILITY_HUMAN_LANGUAGE,
  'link-text-meaningful': ACCESSIBILITY_HUMAN_LINKS,
};

/** Pixels of indentation per level of the reading order, `DestinationsPanel`'s figure; the depth is the data. */
const INDENT = 12;

/**
 * The accessibility tools (ADR-0183), shown in the left document panel while open (ADR-0189): the document check and
 * the page's reading order, beside the page.
 *
 * ## It reads the view and writes none of it
 *
 * What was found, and what is marked on the page, is the document's (`DocumentState.accessibility`), so it survives the
 * tab being switched away from and is dropped with the document; `accessibility/run.ts` is its one writer.
 *
 * ## Choosing a result marks it on the page
 *
 * A problem the engine can place is a button that marks its box; a problem it can place on a page only marks the page;
 * a problem about the whole file says so and offers nothing to press. A reading-order item with text is a button that
 * marks the text it covers. The mark is drawn by `App`, which also takes the page to it.
 */
export interface AccessibilityPanelProps {
  readonly deps: AccessibilityDeps;
  /** The focused document's store, which holds its view and the page and version being looked at. */
  readonly store: DocumentStore;
}

/** The document's view, as its store holds it now. */
export function useAccessibilityView(store: DocumentStore | undefined): AccessibilityView | undefined {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, () => store?.getState().accessibility);
}

function NO_SUBSCRIBE(): () => void {
  return () => undefined;
}

export function AccessibilityPanel({ deps, store }: AccessibilityPanelProps): ReactElement {
  const { i18n } = useLingui();
  const view = useAccessibilityView(store) ?? EMPTY_ACCESSIBILITY;
  const page = useSyncExternalStore(store.subscribe, () => store.getState().page);
  const version = useSyncExternalStore(store.subscribe, () => store.getState().version);
  const section = view.section;

  // THE PAGE'S READING ORDER IS READ AS THE PAGE CHANGES, while that section is the one showing: a person turning pages
  // is reading a structure tree a page at a time, and a list left from the page before would describe another page.
  // Asked of the store at the moment of the effect and not of the render's copy, so a read already under way for this
  // page, or a finished one for this version, is not asked for again; a REFUSED one is not retried here — it would ask
  // for ever of a document that is busy — and has a button.
  useEffect(() => {
    if (section !== 'order') return;
    const held = store.getState().accessibility?.order;
    if (held?.page === page) {
      if (held.phase === 'reading' || held.phase === 'refused') return;
      if (held.version >= version) return;
    }
    void readOrder(deps, store);
  }, [deps, page, section, store, version]);

  const marked = view.marked;
  return (
    <section aria-label={i18n._(CONTEXT_PANEL_TAB_ACCESSIBILITY)} className="m-accessibility">
      <SegmentedControl<AccessibilitySection>
        label={ACCESSIBILITY_SECTIONS_LABEL}
        options={[
          { value: 'check', label: ACCESSIBILITY_SECTION_CHECK },
          { value: 'order', label: ACCESSIBILITY_SECTION_ORDER },
        ]}
        value={section}
        onChange={(next) => {
          showSection(store, next);
        }}
      />
      {section === 'check' ? (
        <CheckSection deps={deps} marked={marked} store={store} view={view} version={version} />
      ) : (
        <OrderSection deps={deps} marked={marked} store={store} order={view.order} />
      )}
      {marked === undefined ? null : (
        <div className="m-accessibility__mark">
          <p aria-live="polite" role="status">
            {i18n._(ACCESSIBILITY_SHOWN_ON_PAGE, { page: pdfjsPageOf(marked.spot.page) })}
          </p>
          <Button
            label={ACCESSIBILITY_HIDE_MARK}
            variant="quiet"
            onClick={() => {
              clearMark(store);
            }}
          />
        </div>
      )}
    </section>
  );
}

/** The places a rule's failures are: its spots, or — where the engine gave only pages — the pages themselves. */
function placesOf(rule: AccessibilityRule): readonly Spot[] {
  return rule.spots.length > 0 ? rule.spots : rule.pages.map((page) => ({ page, box: null }));
}

function CheckSection({
  deps,
  store,
  view,
  version,
  marked,
}: {
  readonly deps: AccessibilityDeps;
  readonly store: DocumentStore;
  readonly view: AccessibilityView;
  readonly version: number;
  readonly marked: AccessibilityView['marked'];
}): ReactElement {
  const { i18n } = useLingui();
  const check = view.check;
  const run = (
    <Button
      label={check === undefined ? ACCESSIBILITY_RUN : ACCESSIBILITY_RUN_AGAIN}
      variant={check === undefined ? 'primary' : 'default'}
      disabled={check?.phase === 'reading'}
      onClick={() => {
        void runCheck(deps, store);
      }}
    />
  );
  if (check === undefined) {
    return (
      <>
        <p>{i18n._(ACCESSIBILITY_INTRO)}</p>
        <p>{i18n._(ACCESSIBILITY_NOT_CONFORMANCE)}</p>
        <div className="m-accessibility__actions">{run}</div>
      </>
    );
  }
  if (check.phase === 'reading') {
    return <p role="status">{i18n._(ACCESSIBILITY_RUNNING)}</p>;
  }
  if (check.phase === 'refused') {
    return (
      <>
        <p role="status">{i18n._(ACCESSIBILITY_REFUSED)}</p>
        <div className="m-accessibility__actions">{run}</div>
      </>
    );
  }

  const failed = check.rules.filter((rule) => rule.verdict === 'failed');
  const undecided = check.rules.filter((rule) => rule.verdict === 'not-determined');
  const passed = check.rules.filter((rule) => rule.verdict === 'passed');
  return (
    <>
      <p role="status">{i18n._(ACCESSIBILITY_SUMMARY, { failed: failed.length, undetermined: undecided.length })}</p>
      {check.version === version ? null : <p className="m-accessibility__stale">{i18n._(ACCESSIBILITY_STALE)}</p>}
      <div className="m-accessibility__actions">{run}</div>
      {failed.length === 0 && undecided.length === 0 ? <p>{i18n._(ACCESSIBILITY_ALL_CLEAR)}</p> : null}
      <RuleList heading={ACCESSIBILITY_FIX_HEADING} marked={marked} rules={failed} store={store} />
      <RuleList heading={ACCESSIBILITY_PERSON_RESULT_HEADING} marked={marked} rules={undecided} store={store} />
      {passed.length === 0 ? null : (
        <details className="m-accessibility__passed">
          <summary>{i18n._(ACCESSIBILITY_PASSED_HEADING, { count: passed.length })}</summary>
          <ul className="m-accessibility__passed-list">
            {passed.map((rule) => {
              const words = RULE_WORDS[ruleKey(rule)];
              return (
                <li key={ruleKey(rule)}>
                  {words === undefined
                    ? i18n._(ACCESSIBILITY_RULE_UNKNOWN, { clause: rule.clause, test: rule.test })
                    : i18n._(words.label)}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      <h3 className="m-accessibility__heading">{i18n._(ACCESSIBILITY_PERSON_HEADING)}</h3>
      <ul className="m-accessibility__human">
        {check.humanChecks.map((each) => (
          <li key={each}>{i18n._(HUMAN_WORDS[each])}</li>
        ))}
      </ul>
    </>
  );
}

function RuleList({
  heading,
  rules,
  store,
  marked,
}: {
  readonly heading: MessageKey;
  readonly rules: readonly AccessibilityRule[];
  readonly store: DocumentStore;
  readonly marked: AccessibilityView['marked'];
}): ReactElement | null {
  const { i18n } = useLingui();
  if (rules.length === 0) return null;
  return (
    <>
      <h3 className="m-accessibility__heading">{i18n._(heading)}</h3>
      <ul className="m-accessibility__rules">
        {rules.map((rule) => {
          const words = RULE_WORDS[ruleKey(rule)];
          const places = placesOf(rule);
          return (
            <li className="m-accessibility__rule" data-verdict={rule.verdict} key={ruleKey(rule)}>
              <p className="m-accessibility__rule-title">
                {words === undefined
                  ? i18n._(ACCESSIBILITY_RULE_UNKNOWN, { clause: rule.clause, test: rule.test })
                  : i18n._(words.label)}
                {rule.verdict === 'failed' && rule.count > 1 ? (
                  <span className="m-accessibility__count">{i18n._(ACCESSIBILITY_COUNT, { count: rule.count })}</span>
                ) : null}
              </p>
              {words === undefined ? null : <p className="m-accessibility__explain">{i18n._(words.explain)}</p>}
              {rule.verdict === 'not-determined' ? (
                <p className="m-accessibility__explain">{i18n._(ACCESSIBILITY_UNDECIDED)}</p>
              ) : null}
              {places.length === 0 ? (
                <p className="m-accessibility__whole">{i18n._(ACCESSIBILITY_WHOLE_FILE)}</p>
              ) : (
                <div className="m-accessibility__places">
                  {places.map((spot, at) => (
                    <button
                      aria-label={i18n._(ACCESSIBILITY_SHOW_PROBLEM_LABEL, {
                        number: at + 1,
                        total: places.length,
                        page: pdfjsPageOf(spot.page),
                      })}
                      aria-pressed={marked?.spot === spot}
                      className="m-accessibility__place"
                      // THE PLACE IS THE KEY: a rule's spots are in the order the walk met them and are never reordered,
                      // and two failures on one page share every field but their box.
                      key={at}
                      onClick={() => {
                        mark(store, spot);
                      }}
                      type="button"
                    >
                      {i18n._(ACCESSIBILITY_SHOW_PROBLEM, { page: pdfjsPageOf(spot.page) })}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function OrderSection({
  deps,
  store,
  order,
  marked,
}: {
  readonly deps: AccessibilityDeps;
  readonly store: DocumentStore;
  readonly order: OrderState | undefined;
  readonly marked: AccessibilityView['marked'];
}): ReactElement {
  const { i18n } = useLingui();
  const format = new Intl.NumberFormat(i18n.locale);
  if (order === undefined || order.phase === 'reading') {
    return (
      <p role="status">
        {i18n._(ORDER_READING, { page: format.format(pdfjsPageOf(order?.page ?? store.getState().page)) })}
      </p>
    );
  }
  const shown = format.format(pdfjsPageOf(order.page));
  if (order.phase === 'refused') {
    return (
      <>
        <p role="status">{i18n._(PAGE_STRUCTURE_REFUSED, { page: shown })}</p>
        <div className="m-accessibility__actions">
          <Button
            label={ACCESSIBILITY_RUN_AGAIN}
            onClick={() => {
              void readOrder(deps, store);
            }}
          />
        </div>
      </>
    );
  }
  return (
    <>
      <p>{i18n._(PAGE_STRUCTURE_PAGE, { page: shown })}</p>
      {order.nodes.length === 0 ? (
        <p data-untagged="true">{i18n._(PAGE_STRUCTURE_UNTAGGED)}</p>
      ) : (
        <>
          <p>{i18n._(ORDER_INTRO)}</p>
          <ol className="m-accessibility__order">
            {order.nodes.map((node, at) => (
              <OrderRow key={at} marked={marked} node={node} page={order.page} store={store} />
            ))}
          </ol>
        </>
      )}
      {order.untaggedLines > 0 ? (
        <p data-untagged-lines="true">{i18n._(PAGE_STRUCTURE_UNTAGGED_LINES, { count: order.untaggedLines })}</p>
      ) : null}
      {order.images > 0 ? <p>{i18n._(PAGE_STRUCTURE_IMAGES, { count: order.images })}</p> : null}
      {order.truncated ? <p data-truncated="true">{i18n._(PAGE_STRUCTURE_TRUNCATED)}</p> : null}
    </>
  );
}

function OrderRow({
  node,
  page,
  store,
  marked,
}: {
  readonly node: OrderItem;
  readonly page: number;
  readonly store: DocumentStore;
  readonly marked: AccessibilityView['marked'];
}): ReactElement {
  const { i18n } = useLingui();
  // THE NAME IS THE TABLE'S, never the engine's string: a type the table does not know is *Other element*.
  const name = i18n._(STRUCTURE_ROLE_NAME, { role: node.role });
  const meta =
    node.lines > 0
      ? i18n._(PAGE_STRUCTURE_LINES, { count: node.lines })
      : node.box === null
        ? i18n._(ORDER_NO_TEXT)
        : null;
  const content = (
    <>
      <span className="m-accessibility__role">{name}</span>
      {meta === null ? null : <span className="m-accessibility__lines">{meta}</span>}
    </>
  );
  const style = { paddingInlineStart: `${String(node.depth * INDENT)}px` };
  // AN ITEM WITH NO TEXT HAS NO PLACE TO SHOW, so it is read and not pressed: a button that marked nothing would be the
  // control that appears to do nothing.
  if (node.box === null) {
    return (
      <li className="m-accessibility__item" data-depth={node.depth} style={style}>
        <span className="m-accessibility__item-body">{content}</span>
      </li>
    );
  }
  const spot: Spot = { page, box: node.box };
  return (
    <li className="m-accessibility__item" data-depth={node.depth} style={style}>
      <button
        aria-label={i18n._(ORDER_SHOW_ITEM, { name })}
        aria-pressed={marked?.spot.page === page && marked.spot.box === node.box}
        className="m-accessibility__item-body m-accessibility__item-button"
        onClick={() => {
          mark(store, spot);
        }}
        type="button"
      >
        {content}
      </button>
    </li>
  );
}
