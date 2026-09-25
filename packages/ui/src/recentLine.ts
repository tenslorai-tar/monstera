import type { DisplayLocation, KnownFolder } from '@monstera/contract';
import type { MessageKey } from '@monstera/shared';

import {
  CLOUD_PROVIDER_NAMES,
  RECENT_IN_DESKTOP,
  RECENT_IN_DOCUMENTS,
  RECENT_IN_DOWNLOADS,
  RECENT_META,
  RECENT_TODAY,
  RECENT_WHERE_NESTED,
  RECENT_YESTERDAY,
} from './messages/en.js';

/** What each known folder is called. A `Record`, so a folder added to the contract has no name until it is given one here. */
const KNOWN_FOLDER_NAMES: Readonly<Record<KnownFolder, MessageKey>> = {
  documents: RECENT_IN_DOCUMENTS,
  downloads: RECENT_IN_DOWNLOADS,
  desktop: RECENT_IN_DESKTOP,
  ...CLOUD_PROVIDER_NAMES,
};

/** Translates one key with its values — `i18n._`'s shape, passed in so this module holds no catalogue. */
export type Translate = (key: MessageKey, values?: Readonly<Record<string, string>>) => string;

/**
 * *Today*, *Yesterday* or a short date, for when a recent file was last opened here (ADR-0100) — or `null`
 * for an entry recorded with no time.
 *
 * Days are the reader's CALENDAR days, compared in local time: a file opened at 23:50 is *Yesterday* ten
 * minutes later, which is how a person counts, where a 24-hour window would still say *Today*.
 */
export function recentWhen(openedAt: string | null, now: Date, locale: string, _: Translate): string | null {
  if (openedAt === null) return null;
  const opened = new Date(openedAt);
  if (Number.isNaN(opened.getTime())) return null;
  // ROUNDED, because a local day across a clock change is 23 or 25 hours long.
  const days = Math.round((startOfDay(now) - startOfDay(opened)) / 86_400_000);
  if (days === 0) return _(RECENT_TODAY);
  if (days === 1) return _(RECENT_YESTERDAY);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(opened);
}

/** *Documents › Leases*, *OneDrive*, *Leases*, or `null` where main named neither part. */
export function recentWhere(location: DisplayLocation, _: Translate): string | null {
  const within = location.within === null ? null : _(KNOWN_FOLDER_NAMES[location.within]);
  if (within !== null && location.folder !== null) return _(RECENT_WHERE_NESTED, { within, folder: location.folder });
  return within ?? location.folder;
}

/** The card's second line: when and where, either alone, or `null` for an entry with neither. */
export function recentLine(
  entry: { readonly openedAt: string | null; readonly location: DisplayLocation },
  now: Date,
  locale: string,
  _: Translate,
): string | null {
  const when = recentWhen(entry.openedAt, now, locale, _);
  const where = recentWhere(entry.location, _);
  if (when !== null && where !== null) return _(RECENT_META, { when, where });
  return when ?? where;
}

/**
 * A cloud file's second line: when it last changed and how large it is, joined as a recent card's are.
 *
 * The listing names files by their name alone, and a cloud can hold several with one name — four identical
 * rows was the Stage 9 run's finding. The date is `recentWhen`'s rule, so a file changed today reads as a recent
 * card opened today does; the size is `size`, already formatted by the caller through `byteSize`.
 * `null` where the provider gave neither.
 */
export function cloudFileLine(
  file: { readonly modified: number | null },
  size: string | null,
  now: Date,
  locale: string,
  _: Translate,
): string | null {
  const when = file.modified === null ? null : recentWhen(new Date(file.modified).toISOString(), now, locale, _);
  if (when !== null && size !== null) return _(RECENT_META, { when, where: size });
  return when ?? size;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
