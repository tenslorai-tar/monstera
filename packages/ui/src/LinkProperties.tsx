import { useLingui } from '@lingui/react';
import type { CommandOfKind, LinkTarget } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useState } from 'react';

import type { LinkSelection } from './annotations/selectTool.js';
import { linkAddressProblem, linkPageProblem, typedPageNumber } from './annotations/typedRules.js';
import type { FollowedLink } from './LinkLayer.js';
import {
  LINK_ADDRESS_LABEL,
  LINK_PAGE_LABEL,
  LINK_PROPERTIES_APPLY,
  LINK_PROPERTIES_FOLLOW,
  LINK_PROPERTIES_GOES_TO,
  LINK_PROPERTIES_HEADING,
  LINK_PROPERTIES_NO_SUCH_PAGE,
  LINK_PROPERTIES_TO_ADDRESS,
  LINK_PROPERTIES_TO_PAGE,
  PROPERTIES_ACTIONS,
} from './messages/en.js';
import { kernelPageOf, pdfjsPageOf } from './pageNumbering.js';
import { Button } from './primitives/Button.js';
import { Input } from './primitives/Input.js';
import { SegmentedControl } from './primitives/SegmentedControl.js';

type Goes = 'page' | 'address';

/**
 * The Properties tab for the link the select tool picked (the owner's O6(c)): where it goes, which can be changed, and a
 * press that follows it.
 *
 * **Where it goes is typed by the rules the link tools type it by** (`typedRules.ts`), and a page by the one 1-based to
 * 0-based conversion (`pageNumbering.ts`), so a link changed here is the link the tools would have made. The change is one
 * `editLink` naming the link's place at the selection's version. Nothing is sent until a person presses the button or
 * Enter, so a half-typed address never reaches the document, and a target that did not change sends nothing.
 *
 * Keyed by the caller on the link and its version, so what is typed belongs to the link it was typed for.
 */
export function LinkProperties({
  selected,
  pageCount,
  onEdit,
  onFollow,
}: {
  readonly selected: LinkSelection;
  /** How many pages the document has, which a page link must name one of. */
  readonly pageCount: number;
  readonly onEdit: (command: CommandOfKind<'editLink'>) => void;
  readonly onFollow: (followed: FollowedLink) => void;
}): ReactElement {
  const { i18n } = useLingui();
  const { link } = selected;
  const [goes, setGoes] = useState<Goes>(link.kind === 'internal' ? 'page' : 'address');
  const [page, setPage] = useState(link.kind === 'internal' ? String(pdfjsPageOf(link.page)) : '');
  const [address, setAddress] = useState(link.kind === 'external' ? link.uri : '');
  const [tried, setTried] = useState(false);

  const typedPage = typedPageNumber(page);
  const problem =
    goes === 'page'
      ? (linkPageProblem(page) ?? (typedPage !== undefined && typedPage > pageCount ? LINK_PROPERTIES_NO_SUCH_PAGE : undefined))
      : linkAddressProblem(address);
  const target: LinkTarget | undefined =
    problem !== undefined
      ? undefined
      : goes === 'page' && typedPage !== undefined
        ? { kind: 'page', page: kernelPageOf(typedPage) }
        : { kind: 'uri', uri: address.trim() };
  // THE SAME TARGET IS NO CHANGE: an undo step for a document that did not change is a step nobody asked for.
  const unchanged =
    target !== undefined &&
    (target.kind === 'page' ? link.kind === 'internal' && link.page === target.page : link.kind === 'external' && link.uri === target.uri);

  const apply = (): void => {
    setTried(true);
    if (target === undefined || unchanged) return;
    onEdit({ kind: 'editLink', page: selected.page, index: selected.index, target, version: selected.version });
  };

  return (
    <section aria-label={i18n._(LINK_PROPERTIES_HEADING)} className="m-properties" data-link-properties={String(selected.index)}>
      <header className="m-properties__head">
        <h2 className="m-properties__title">{i18n._(LINK_PROPERTIES_HEADING)}</h2>
      </header>
      <form
        className="m-properties__section"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <SegmentedControl<Goes>
          label={LINK_PROPERTIES_GOES_TO}
          options={[
            { value: 'page', label: LINK_PROPERTIES_TO_PAGE },
            { value: 'address', label: LINK_PROPERTIES_TO_ADDRESS },
          ]}
          value={goes}
          onChange={(chosen) => {
            setGoes(chosen);
            setTried(false);
          }}
        />
        {goes === 'page' ? (
          <Input invalid={tried && problem !== undefined} label={LINK_PAGE_LABEL} value={page} onValueChange={setPage} />
        ) : (
          <Input invalid={tried && problem !== undefined} label={LINK_ADDRESS_LABEL} runsLong value={address} onValueChange={setAddress} />
        )}
        {tried && problem !== undefined ? (
          <p className="m-properties__meta" role="alert">
            {i18n._(problem, { last: pageCount })}
          </p>
        ) : null}
        <Button disabled={unchanged} label={LINK_PROPERTIES_APPLY} type="submit" variant="primary" />
      </form>
      <div aria-label={i18n._(PROPERTIES_ACTIONS)} className="m-properties__foot" role="group">
        <Button
          label={LINK_PROPERTIES_FOLLOW}
          onClick={() => {
            onFollow({ page: selected.page, index: selected.index, link });
          }}
        />
      </div>
    </section>
  );
}
