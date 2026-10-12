import { useLingui } from '@lingui/react';
import type { FontFamilyEntry } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';
import { type ReactElement, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  FONT_GROUP_BUILT_IN,
  FONT_GROUP_BUNDLED,
  FONT_GROUP_COMPUTER,
  FONT_GROUP_DOCUMENT,
  FONT_GROUP_RECENT,
  FONT_LIST_MORE,
  FONT_LIST_READING,
  FONT_LIST_UNREAD,
  FONT_LOOKS_LIKE,
  FONT_NONE_MATCH,
  FONT_NOT_EMBEDDABLE,
  FONT_PARTIAL,
  FONT_PICKER_LIST,
  FONT_PICKER_SEARCH,
} from './messages/en.js';
import { Icon } from './primitives/Icon.js';
import { KEEPS_EDITOR } from './textEditorControl.js';

/**
 * The ONE font picker (the owner's D1 to D4): every place a person chooses a font takes this, so the list, its groups and
 * what it says of a font are the same everywhere (B3a).
 *
 * ## The groups, in the owner's order
 *
 * *In this document* (a subset's tag stripped, and said to be partial), *Recent* (this session's), *On this computer*,
 * *Included with Monstera* (a bundled family is said to LOOK LIKE the one it is drawn to the measure of, never named as
 * it), and *Built into PDF*, which the caller names because what a consumer can set differs: the in-place editor sets
 * Helvetica, Times and Courier through the resolver, and Symbol and ZapfDingbats have no face that stands in for them.
 *
 * ## Inline, never a portal
 *
 * The list opens in place under its field, so the focus stays inside the element that holds the picker. The Properties
 * panel's text section relies on that: a focus moving into it does not close the editor whose words it formats.
 */

/** The fonts a computer's list read, or that none could be (`listed: false`), or `undefined` while it is being read. */
export type FontList =
  | {
      readonly listed: boolean;
      readonly families: readonly FontFamilyEntry[];
      /** Families past the list's bound, the last by name: said under the list, never left out without a word. */
      readonly more: number;
    }
  | undefined;

/** A font a document carries, by the name its program states, and whether it is a subset. */
export interface DocumentFont {
  readonly name: string;
  readonly partial: boolean;
}

/** The standard fonts every PDF reader has, by the names a person knows (PDF 32000-1, 9.6.2.2). */
export const BUILT_INTO_PDF = ['Helvetica', 'Times', 'Courier', 'Symbol', 'ZapfDingbats'] as const;

/** One font the list offers: the name sent, what is said, and what is said beneath it. */
export interface FontChoice {
  readonly family: string;
  readonly label: { readonly key: MessageKey; readonly values: Readonly<Record<string, string>> } | undefined;
  readonly note: MessageKey | undefined;
}

export interface FontGroup {
  readonly title: MessageKey;
  readonly choices: readonly FontChoice[];
}

/** A tag of six capitals and a plus, which a subset's name begins with (PDF 32000-1, 9.6.4). The one copy (B3a). */
export const SUBSET_TAG = /^[A-Z]{6}\+/u;

/** The groups a picker shows for `query`, each without an empty one, in the owner's order. Pure, for its tests. */
export function fontGroups(
  list: FontList,
  inDocument: readonly DocumentFont[],
  recent: readonly string[],
  builtIn: readonly string[],
  query: string,
): FontGroup[] {
  const wanted = query.trim().toLowerCase();
  const matches = (choice: FontChoice): boolean =>
    wanted === '' ||
    choice.family.toLowerCase().includes(wanted) ||
    (choice.label?.values['like']?.toLowerCase().includes(wanted) ?? false);
  const plain = (family: string): FontChoice => ({ family, label: undefined, note: undefined });
  const ofEntry = (entry: FontFamilyEntry): FontChoice => ({
    family: entry.name,
    label: entry.looksLike === undefined ? undefined : { key: FONT_LOOKS_LIKE, values: { name: entry.name, like: entry.looksLike } },
    note: entry.embedding === 'never' ? FONT_NOT_EMBEDDABLE : undefined,
  });
  const families = list?.families ?? [];
  const seen = new Set<string>();
  const document = inDocument.flatMap((font): FontChoice[] => {
    const name = font.name.replace(SUBSET_TAG, '');
    if (seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    return [{ family: name, label: font.partial ? { key: FONT_PARTIAL, values: { name } } : undefined, note: undefined }];
  });
  const known = new Map(families.map((entry) => [entry.name.toLowerCase(), entry]));
  // RECENT IS A SHORTCUT INTO THE OTHER GROUPS, never a group of its own: the list is the session's, shared by every
  // picker, so a family chosen in one consumer that another cannot set (a real font, then a callout's picker) would be
  // offered where choosing it is refused.
  const offered = new Set([...seen, ...known.keys(), ...builtIn.map((family) => family.toLowerCase())]);
  const groups: FontGroup[] = [
    { title: FONT_GROUP_DOCUMENT, choices: document },
    {
      title: FONT_GROUP_RECENT,
      choices: recent
        .filter((family) => offered.has(family.toLowerCase()))
        .map((family) => {
          const entry = known.get(family.toLowerCase());
          return entry === undefined ? plain(family) : ofEntry(entry);
        }),
    },
    { title: FONT_GROUP_COMPUTER, choices: families.filter((entry) => entry.origin === 'installed').map(ofEntry) },
    { title: FONT_GROUP_BUNDLED, choices: families.filter((entry) => entry.origin === 'bundled').map(ofEntry) },
    { title: FONT_GROUP_BUILT_IN, choices: builtIn.map(plain) },
  ];
  return groups.map((group) => ({ ...group, choices: group.choices.filter(matches) })).filter((group) => group.choices.length > 0);
}

/** The families this session chose, latest first: the *Recent* group. A session's, so nothing is written to settings. */
const RECENT_LIMIT = 5;
let recentFamilies: readonly string[] = [];
export function rememberFamily(family: string): void {
  recentFamilies = [family, ...recentFamilies.filter((each) => each.toLowerCase() !== family.toLowerCase())].slice(0, RECENT_LIMIT);
}
export const recentlyChosen = (): readonly string[] => recentFamilies;

export interface FontPickerProps {
  /** What the field is called: *Font*. */
  readonly label: MessageKey;
  /** The family the words are in now, or `undefined` where they are in several or in the page's own. */
  readonly value: string | undefined;
  /** What the closed field reads when {@link value} is `undefined`. */
  readonly unset: MessageKey;
  readonly list: FontList;
  readonly inDocument: readonly DocumentFont[];
  readonly builtIn: readonly string[];
  readonly onPick: (family: string) => void;
  /**
   * The list opens FLOATING over the window, under the button, rather than in the flow: for a picker in a row that
   * clips what grows out of it (the ribbon, ADR-0228 Decision 5). It closes on a press outside it, and is marked as part
   * of the open text editor's surface so a focus moving into it keeps the words being edited.
   */
  readonly floating?: boolean;
}

export function FontPicker({ label, value, unset, list, inDocument, builtIn, onPick, floating = false }: FontPickerProps): ReactElement {
  const { _ } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const face = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /** Where a floating list sits: under the button, read when it opens. */
  const [floatAt, setFloatAt] = useState<{ readonly left: number; readonly top: number; readonly width: number } | undefined>();
  // A FLOATING LIST CLOSES ON A PRESS OUTSIDE IT AND ITS BUTTON, as a menu does; the in-flow list is closed by its own
  // surface, which holds it.
  useEffect(() => {
    if (!floating || !open) return undefined;
    const away = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target !== null && (face.current?.contains(target) === true || panel.current?.contains(target) === true)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', away, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
    };
  }, [floating, open]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (at: number): string => `${listId}-${String(at)}`;
  const search = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => fontGroups(list, inDocument, recentlyChosen(), builtIn, query), [list, inDocument, builtIn, query]);
  const flat = groups.flatMap((group) => group.choices);
  const choose = (choice: FontChoice): void => {
    rememberFamily(choice.family);
    setOpen(false);
    setQuery('');
    onPick(choice.family);
  };
  const said = (choice: FontChoice): string => (choice.label === undefined ? choice.family : _(choice.label.key, choice.label.values));
  /** Where each group's first choice falls in the one list the keys walk. */
  const starts = groups.map((_group, index) => groups.slice(0, index).reduce((sum, earlier) => sum + earlier.choices.length, 0));
  return (
    <div className="m-font-picker" data-font-picker="">
      <button
        aria-expanded={open}
        aria-label={`${_(label)}: ${value ?? _(unset)}`}
        className="m-font-picker__face"
        onClick={() => {
          if (floating && face.current !== null) {
            const box = face.current.getBoundingClientRect();
            setFloatAt({ left: box.left, top: box.bottom + FLOAT_BELOW, width: Math.max(box.width, FLOAT_MIN_WIDTH) });
          }
          setOpen((now) => !now);
          setActive(0);
          // THE SEARCH TAKES THE KEYS once the list is open, so a person types a name at once.
          requestAnimationFrame(() => search.current?.focus());
        }}
        ref={face}
        style={value === undefined ? undefined : { fontFamily: `"${value}"` }}
        type="button"
      >
        <span className="m-font-picker__name">{value ?? _(unset)}</span>
        <Icon name="ChevronDown" size="dense" />
      </button>
      {open ? floated(
        <div
          className={floating ? 'm-font-picker__open m-font-picker__open--floating' : 'm-font-picker__open'}
          data-font-picker=""
          ref={panel}
          {...(floating ? { [KEEPS_EDITOR]: '' } : {})}
          style={
            floating && floatAt !== undefined
              ? { insetInlineStart: floatAt.left, insetBlockStart: floatAt.top, inlineSize: floatAt.width }
              : undefined
          }
        >
          <input
            aria-activedescendant={flat.length === 0 ? undefined : optionId(Math.min(active, flat.length - 1))}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded
            aria-label={_(FONT_PICKER_SEARCH)}
            className="m-font-picker__search"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive((now) => (flat.length === 0 ? 0 : (now + step + flat.length) % flat.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const picked = flat[Math.min(active, flat.length - 1)];
                if (picked !== undefined) choose(picked);
              } else if (event.key === 'Escape') {
                // THE LIST CLOSES and the key goes no further: Escape in the editor would finish the words.
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setQuery('');
              }
            }}
            ref={search}
            role="combobox"
            type="search"
            value={query}
          />
          {list === undefined ? <p className="m-font-picker__note">{_(FONT_LIST_READING)}</p> : null}
          {list?.listed === false ? <p className="m-font-picker__note">{_(FONT_LIST_UNREAD)}</p> : null}
          {list !== undefined && list.more > 0 ? (
            <p className="m-font-picker__note">{_(FONT_LIST_MORE, { count: list.more })}</p>
          ) : null}
          <div aria-label={_(FONT_PICKER_LIST)} className="m-font-picker__list" id={listId} role="listbox">
            {groups.map((group, index) => {
              const headingId = `${listId}-${group.title}`;
              return (
                <div aria-labelledby={headingId} key={group.title} role="group">
                  <p className="m-font-picker__group" id={headingId} role="presentation">
                    {_(group.title)}
                  </p>
                  {group.choices.map((choice, within) => {
                    const place = (starts[index] ?? 0) + within;
                    return (
                      <div
                        aria-selected={place === active}
                        className="m-font-picker__option"
                        data-font-choice={choice.family}
                        id={optionId(place)}
                        key={`${group.title}-${choice.family}`}
                        // THE PRESS KEEPS THE FOCUS where it is; the click chooses.
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          choose(choice);
                        }}
                        role="option"
                      >
                        {/* EACH NAME IN ITS OWN TYPEFACE, where this computer can draw it. */}
                        <span style={{ fontFamily: `"${choice.family}"` }}>{said(choice)}</span>
                        {choice.note === undefined ? null : <span className="m-font-picker__note">{_(choice.note)}</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {flat.length === 0 && list !== undefined ? (
            <p className="m-font-picker__note">{_(FONT_NONE_MATCH, { query })}</p>
          ) : null}
        </div>,
        floating,
      ) : null}
    </div>
  );
}

/** How far below its button a floating list opens, and the narrowest it is drawn: a name and its note fit. */
const FLOAT_BELOW = 4;
const FLOAT_MIN_WIDTH = 260;

/** The open list where it is drawn: in the flow, or carried to the body so no row that clips can cut it. */
function floated(panel: ReactElement, floating: boolean): ReactNode {
  return floating ? createPortal(panel, document.body) : panel;
}
