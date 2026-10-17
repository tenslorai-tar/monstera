import { useLingui } from '@lingui/react';
import type { FontFamilyEntry } from '@monstera/contract';
import { type MessageKey, SUBSET_TAG } from '@monstera/shared';
import { type ReactElement, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { drawFamilies, facesGiven, previewFamilyOf, subscribeFaces } from './familyFaces.js';
import {
  FONT_GROUP_BUILT_IN,
  FONT_GROUP_BUNDLED,
  FONT_GROUP_COMPUTER,
  FONT_GROUP_DOCUMENT,
  FONT_GROUP_RECENT,
  FONT_LIST_MORE,
  FONT_LIST_READING,
  FONT_LIST_EMPTY,
  FONT_LIST_UNREAD,
  FONT_NONE_MATCH,
  FONT_PICKER_LIST,
  FONT_PICKER_SEARCH,
} from './messages/en.js';
import { Icon } from './primitives/Icon.js';

/**
 * The ONE font picker (the owner's D1 to D4): every place a person chooses a font takes this, so the list and its groups
 * are the same everywhere (B3a).
 *
 * ## The groups, in the owner's order
 *
 * *In this document* (a subset's tag stripped), *Recent* (this session's), *On this computer*, *Included with Monstera*,
 * and *Built into PDF*, which the caller names because what a consumer can set differs: the in-place editor sets
 * Helvetica, Times and Courier through the resolver, and Symbol and ZapfDingbats have no face that stands in for them.
 *
 * ## Just fonts (the owner's N12)
 *
 * A font is its name and nothing more: no sentence beside or under it. A family whose licence forbids embedding is LEFT
 * OUT rather than listed and explained, since choosing it would set a stand-in; a document's own fonts stay under *In this
 * document* whatever they are. A bundled family drawn to another's measure is still FOUND by that other's name (typing
 * *Calibri* finds Carlito), without saying so.
 *
 * ## Inline, never a portal
 *
 * The list opens in place under its field, so the focus stays inside the element that holds the picker. The Properties
 * panel's text section relies on that: a focus moving into it does not close the editor whose words it formats.
 */

/**
 * The fonts a computer's list read, or that none could be (`listed: false`), or `undefined` while it is being read; or
 * {@link BUILT_IN_ONLY}, a consumer whose writer sets the standard faces alone. Two values for two facts (the owner's
 * L5): a list read and found EMPTY is said in words, and a consumer that offers none is not a list that came back empty.
 */
export type FontList =
  | {
      readonly listed: boolean;
      readonly families: readonly FontFamilyEntry[];
      /** Families past the list's bound, the last by name: said under the list, never left out without a word. */
      readonly more: number;
    }
  | typeof BUILT_IN_ONLY
  | undefined;

/** A consumer that offers the standard faces alone (a stamp's writer, a callout's, a field kind the writer cannot draw). */
export const BUILT_IN_ONLY = { builtInOnly: true } as const;

/** A computer's list as main answered it: read, or `listed: false` where it could not be. */
export type ReadFontList = Exclude<FontList, typeof BUILT_IN_ONLY | undefined>;

/** The computer's list where one was read for this consumer; `undefined` while it is read and for {@link BUILT_IN_ONLY}. */
function readList(list: FontList): ReadFontList | undefined {
  return list === undefined || 'builtInOnly' in list ? undefined : list;
}

/** A font a document carries, by the name its program states, and whether it is a subset. */
export interface DocumentFont {
  readonly name: string;
  readonly partial: boolean;
}

/** The standard fonts every PDF reader has, by the names a person knows (PDF 32000-1, 9.6.2.2). */
export const BUILT_INTO_PDF = ['Helvetica', 'Times', 'Courier', 'Symbol', 'ZapfDingbats'] as const;

/**
 * The standard fonts a consumer offers when the font resolver sets its words (the in-place editor, an imported Markdown
 * file): each through the resolver's bundled stand in. Symbol and ZapfDingbats have none, so they are not offered.
 */
export const RESOLVED_BUILT_IN = ['Helvetica', 'Times', 'Courier'] as const;

/** One font the list offers: the name sent and shown, and the family it is drawn to the measure of, which a search finds. */
export interface FontChoice {
  readonly family: string;
  readonly like: string | undefined;
}

export interface FontGroup {
  readonly title: MessageKey;
  readonly choices: readonly FontChoice[];
}

/**
 * A tag of six capitals and a plus, which a subset's name begins with (PDF 32000-1, 9.6.4): `@monstera/shared`'s, the
 * rule the kernel's resolver strips by too (B3a; this file held its own copy until ADR-0250 moved the rule there).
 */
export { SUBSET_TAG };

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
    wanted === '' || choice.family.toLowerCase().includes(wanted) || (choice.like?.toLowerCase().includes(wanted) ?? false);
  const plain = (family: string): FontChoice => ({ family, like: undefined });
  const ofEntry = (entry: FontFamilyEntry): FontChoice => ({ family: entry.name, like: entry.looksLike });
  // ONLY WHAT CAN BE USED: a family that may not be embedded is never offered, in any group the list feeds (N12).
  const families = (readList(list)?.families ?? []).filter((entry) => entry.embedding !== 'never');
  const seen = new Set<string>();
  const document = inDocument.flatMap((font): FontChoice[] => {
    const name = font.name.replace(SUBSET_TAG, '');
    if (seen.has(name.toLowerCase())) return [];
    seen.add(name.toLowerCase());
    return [plain(name)];
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
}

export function FontPicker({ label, value, unset, list, inDocument, builtIn, onPick }: FontPickerProps): ReactElement {
  const { _ } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (at: number): string => `${listId}-${String(at)}`;
  const search = useRef<HTMLInputElement>(null);
  const face = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => fontGroups(list, inDocument, recentlyChosen(), builtIn, query), [list, inDocument, builtIn, query]);
  /** The computer's list as read, or `undefined` while it is read and where the consumer offers none. */
  const read = readList(list);
  // EACH LISTED FAMILY GIVEN ITS FACE as the list is drawn (ADR-0250), once a window (`drawFamilies`), and drawn again
  // when a face arrives: a bundled family's bytes come after the list does.
  useEffect(() => {
    if (read !== undefined) drawFamilies(read.families);
  }, [read]);
  useSyncExternalStore(subscribeFaces, facesGiven);
  /** The face a shown name is drawn in, or `undefined` for the interface font (ADR-0250 Decision 3). */
  const previewOf = (name: string): string | undefined => previewFamilyOf(name, read?.families ?? []);
  const shownIn = (name: string): React.CSSProperties | undefined => {
    const preview = previewOf(name);
    return preview === undefined ? undefined : { fontFamily: `"${preview}"` };
  };
  const flat = groups.flatMap((group) => group.choices);
  const choose = (choice: FontChoice): void => {
    rememberFamily(choice.family);
    // THE FOCUS BACK TO THE FIELD before the list is unmounted, for Escape's reason below; a consumer that wants it
    // elsewhere (the text editor's panel puts it back in the words) moves it on from here.
    face.current?.focus();
    setOpen(false);
    setQuery('');
    onPick(choice.family);
  };
  /** Where each group's first choice falls in the one list the keys walk. */
  const starts = groups.map((_group, index) => groups.slice(0, index).reduce((sum, earlier) => sum + earlier.choices.length, 0));
  return (
    <div className="m-font-picker" data-font-picker="">
      <button
        aria-expanded={open}
        aria-label={`${_(label)}: ${value ?? _(unset)}`}
        className="m-font-picker__face"
        ref={face}
        onClick={() => {
          setOpen((now) => !now);
          setActive(0);
          // THE SEARCH TAKES THE KEYS once the list is open, so a person types a name at once.
          requestAnimationFrame(() => search.current?.focus());
        }}
        type="button"
      >
        {/* THE NAME IN ITS OWN FACE, the field in the interface's (ADR-0250): on the name alone, whose line height is
            fixed, so the field keeps one height whatever family it shows. */}
        <span className="m-font-picker__name" style={value === undefined ? undefined : shownIn(value)}>
          {value ?? _(unset)}
        </span>
        <Icon name="ChevronDown" size="dense" />
      </button>
      {open ? (
        <div className="m-font-picker__open" data-font-picker="">
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
                // AND THE FOCUS GOES BACK TO THE FIELD IT CAME FROM, before the search box it is in is unmounted. Left
                // in the box, it fell to the page's body with no focus event any surface sees, so the panel never learnt
                // it was left and a press on the page did not end the text editor (text-regression 7b, 2026-10-16).
                face.current?.focus();
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
          {read?.listed === false ? <p className="m-font-picker__note">{_(FONT_LIST_UNREAD)}</p> : null}
          {/* A LIST READ AND FOUND EMPTY (the owner's L5), said, never shown as a picker with nothing to say. */}
          {read?.listed === true && read.families.length === 0 ? <p className="m-font-picker__note">{_(FONT_LIST_EMPTY)}</p> : null}
          {read !== undefined && read.more > 0 ? (
            <p className="m-font-picker__note">{_(FONT_LIST_MORE, { count: read.more })}</p>
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
                        {/* EACH NAME IN ITS OWN TYPEFACE, or the face the writer would set it in; where neither can be
                            drawn, in the interface font and said so to a reader of the page (the owner's locked decision 6). */}
                        {previewOf(choice.family) === undefined ? (
                          <span data-font-preview="none">{choice.family}</span>
                        ) : (
                          <span style={shownIn(choice.family)}>{choice.family}</span>
                        )}
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
        </div>
      ) : null}
    </div>
  );
}
