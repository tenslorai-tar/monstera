import { useLingui } from '@lingui/react';
import { MAX_TOC_ENTRIES, MAX_TOC_TITLE_CHARACTERS } from '@monstera/contract';
import type { ReactElement } from 'react';
import { useRef, useState } from 'react';

import {
  GENERATE_TOC_ADD,
  GENERATE_TOC_ADD_PAGE,
  GENERATE_TOC_ADD_TITLE,
  GENERATE_TOC_APPLY,
  GENERATE_TOC_DELETE,
  GENERATE_TOC_EMPTY,
  GENERATE_TOC_INDENT,
  GENERATE_TOC_INTRO,
  GENERATE_TOC_LIST,
  GENERATE_TOC_MOVE_DOWN,
  GENERATE_TOC_MOVE_UP,
  GENERATE_TOC_OUTDENT,
  GENERATE_TOC_PAGE,
  GENERATE_TOC_PROBLEM_NO_ROWS,
  GENERATE_TOC_PROBLEM_PAGE,
  GENERATE_TOC_PROBLEM_TITLE_EMPTY,
  GENERATE_TOC_PROBLEM_TITLE_LONG,
  GENERATE_TOC_TITLE_FIELD,
  GENERATE_TOC_TOO_LONG,
} from '../messages/en.js';
import { kernelPageOf, pdfjsPageOf } from '../pageNumbering.js';
import { useAttempt } from '../primitives/attempt.js';
import { Button } from '../primitives/Button.js';
import { DialogFooter, DialogRow, DialogScroll } from '../primitives/Dialog.js';
import { Input } from '../primitives/Input.js';
import type { DialogAnswering } from '../registries/dialogs.js';
import type { GenerateTocAnswer } from './generateToc.js';

/** How deep a row may nest: `tocEntrySchema`'s bound, one spelling. */
const DEPTH_MAX = 16;

/** One row under a key of its own, so a row removed or moved keeps the text typed into the ones around it. */
interface Row {
  readonly key: number;
  readonly title: string;
  /** The page as a person types it, from 1; empty is a row that points nowhere. */
  readonly page: string;
  readonly depth: number;
}

/**
 * The contents page before it is written: the entries it will use — title, page and level — each one editable, movable, one
 * level in or out, deletable, with a place to add one, and *Insert* or *Cancel* (the owner's order of 2026-10-07).
 *
 * **Nothing is written here.** The body answers the rows as the command's own shape (pages from zero), and the command sends
 * them as ONE `generateToc`, so one Undo takes the page away. A row that cannot be written is said on its own line and the
 * button goes no further, so nothing is dropped or guessed.
 *
 * A default export because `declareDialog` takes a `lazy()` component.
 */
export default function GenerateTocBody({
  entries,
  pageCount,
  tooLong,
  resolve,
}: {
  readonly entries: readonly { readonly title: string; readonly page: number | null; readonly depth: number }[];
  readonly pageCount: number;
  readonly tooLong: boolean;
} & DialogAnswering<GenerateTocAnswer>): ReactElement {
  const { _ } = useLingui();
  const nextKey = useRef(entries.length);
  const [rows, setRows] = useState<readonly Row[]>(() =>
    entries.map((entry, key) => ({
      key,
      title: entry.title,
      page: entry.page === null ? '' : String(pdfjsPageOf(entry.page)),
      depth: Math.min(entry.depth, DEPTH_MAX),
    })),
  );
  const [addTitle, setAddTitle] = useState('');
  const [addPage, setAddPage] = useState('');
  const attempt = useAttempt();

  /** A row's page read against the document: a page it has, none, or what is wrong. */
  const readPage = (text: string): { readonly ok: true; readonly page: number | null } | { readonly ok: false } => {
    if (text.trim() === '') return { ok: true, page: null };
    if (!/^\d+$/u.test(text.trim())) return { ok: false };
    const shown = Number(text.trim());
    return shown >= 1 && shown <= pageCount ? { ok: true, page: kernelPageOf(shown) } : { ok: false };
  };

  const change = (key: number, patch: Partial<Row>): void => {
    setRows((now) => now.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };
  const move = (from: number, to: number): void => {
    setRows((now) => {
      const next = [...now];
      const [taken] = next.splice(from, 1);
      if (taken === undefined) return now;
      next.splice(to, 0, taken);
      return next;
    });
  };
  const addable = addTitle.trim() !== '' && readPage(addPage).ok && addPage.trim() !== '' && rows.length < MAX_TOC_ENTRIES;

  const problemOf = (row: Row, number: number): string => {
    if (row.title.trim() === '') return _(GENERATE_TOC_PROBLEM_TITLE_EMPTY, { number });
    if (row.title.trim().length > MAX_TOC_TITLE_CHARACTERS) return _(GENERATE_TOC_PROBLEM_TITLE_LONG, { number, limit: MAX_TOC_TITLE_CHARACTERS });
    if (!readPage(row.page).ok) return _(GENERATE_TOC_PROBLEM_PAGE, { number, last: pageCount });
    return '';
  };
  const noRows = attempt.tried && rows.length === 0;

  // AN OUTLINE PAST WHAT CAN BE REVIEWED HERE is written as it stands: nothing to edit, and Insert answers no rows.
  if (tooLong) {
    return (
      <div className="m-generate-toc">
        <p className="m-generate-toc__intro">{_(GENERATE_TOC_TOO_LONG, { limit: MAX_TOC_ENTRIES, characters: MAX_TOC_TITLE_CHARACTERS })}</p>
        <DialogFooter>
          <Button
            label={GENERATE_TOC_APPLY}
            variant="primary"
            onClick={() => {
              resolve({});
            }}
          />
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="m-generate-toc">
      <p className="m-generate-toc__intro">{_(GENERATE_TOC_INTRO)}</p>
      <DialogScroll label={_(GENERATE_TOC_LIST)}>
        {rows.length === 0 ? (
          <p className="m-generate-toc__empty">{_(GENERATE_TOC_EMPTY)}</p>
        ) : (
          <ol className="m-generate-toc__rows">
            {rows.map((row, at) => {
              const number = at + 1;
              const problem = attempt.tried ? problemOf(row, number) : '';
              return (
                <li key={row.key} className="m-generate-toc__row" data-toc-row={String(number)}>
                  <span
                    className="m-generate-toc__fields"
                    // THE LEVEL AS INDENT, a value the person set and not a style the stylesheet could hold.
                    style={{ paddingInlineStart: `calc(${String(row.depth)} * var(--space-16))` }}
                  >
                    <Input
                      invalid={problem !== '' && row.title.trim() === ''}
                      label={GENERATE_TOC_TITLE_FIELD}
                      labelShownBeside
                      value={row.title}
                      onValueChange={(title) => {
                        change(row.key, { title });
                      }}
                    />
                    <span className="m-generate-toc__page">
                      <Input
                        invalid={problem !== '' && row.title.trim() !== ''}
                        label={GENERATE_TOC_PAGE}
                        labelShownBeside
                        value={row.page}
                        onValueChange={(page) => {
                          change(row.key, { page });
                        }}
                      />
                    </span>
                  </span>
                  <span className="m-generate-toc__actions">
                    <Button
                      label={GENERATE_TOC_OUTDENT}
                      values={{ number }}
                      icon="ChevronLeft"
                      iconOnly
                      disabled={row.depth === 0}
                      onClick={() => {
                        change(row.key, { depth: row.depth - 1 });
                      }}
                    />
                    <Button
                      label={GENERATE_TOC_INDENT}
                      values={{ number }}
                      icon="ChevronRight"
                      iconOnly
                      disabled={row.depth >= DEPTH_MAX}
                      onClick={() => {
                        change(row.key, { depth: row.depth + 1 });
                      }}
                    />
                    <Button
                      label={GENERATE_TOC_MOVE_UP}
                      values={{ number }}
                      icon="MoveUp"
                      iconOnly
                      disabled={at === 0}
                      onClick={() => {
                        move(at, at - 1);
                      }}
                    />
                    <Button
                      label={GENERATE_TOC_MOVE_DOWN}
                      values={{ number }}
                      icon="MoveDown"
                      iconOnly
                      disabled={at === rows.length - 1}
                      onClick={() => {
                        move(at, at + 1);
                      }}
                    />
                    <Button
                      label={GENERATE_TOC_DELETE}
                      values={{ number }}
                      icon="Trash2"
                      iconOnly
                      onClick={() => {
                        setRows((now) => now.filter((each) => each.key !== row.key));
                      }}
                    />
                  </span>
                  {problem === '' ? null : (
                    <span className="m-generate-toc__problem" role="alert">
                      {problem}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </DialogScroll>
      <DialogRow label={GENERATE_TOC_ADD}>
        <span className="m-generate-toc__add">
          <Input label={GENERATE_TOC_ADD_TITLE} labelShownBeside value={addTitle} onValueChange={setAddTitle} />
          <span className="m-generate-toc__page">
            <Input label={GENERATE_TOC_ADD_PAGE} labelShownBeside value={addPage} onValueChange={setAddPage} />
          </span>
          <Button
            label={GENERATE_TOC_ADD}
            icon="Plus"
            disabled={!addable}
            onClick={() => {
              const read = readPage(addPage);
              if (!read.ok) return;
              nextKey.current += 1;
              const key = nextKey.current;
              setRows((now) => [...now, { key, title: addTitle.trim(), page: addPage.trim(), depth: 0 }]);
              setAddTitle('');
              setAddPage('');
            }}
          />
        </span>
      </DialogRow>
      {noRows ? (
        <p className="m-generate-toc__problem" role="alert">
          {_(GENERATE_TOC_PROBLEM_NO_ROWS)}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          label={GENERATE_TOC_APPLY}
          variant="primary"
          onClick={() => {
            attempt.attempt();
            if (rows.length === 0) return;
            // EVERY ROW MUST BE WRITABLE, or none is written: a title left empty or a page the document lacks is said on its
            // row and the dialog stays.
            const written = rows.map((row) => {
              const read = readPage(row.page);
              return problemOf(row, 0) !== '' || !read.ok ? undefined : { title: row.title.trim(), page: read.page, depth: row.depth };
            });
            if (written.some((row) => row === undefined)) return;
            resolve({ entries: written.filter((row): row is NonNullable<typeof row> => row !== undefined) });
          }}
        />
      </DialogFooter>
    </div>
  );
}
