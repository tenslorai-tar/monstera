import type { I18n } from '@lingui/core';

import { STATUS_SIZE_KB, STATUS_SIZE_MB } from './messages/en.js';

const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * 1024;

/**
 * A file's size as a person reads it: whole KB under a megabyte, MB to one decimal above, as v5-02's
 * *"2.4 MB"*. The number goes through the catalogue's ICU `number`, so the decimal separator is the
 * reader's language's and not JavaScript's.
 *
 * **One answer for every surface that shows a size** — the status bar's document and the cloud list's
 * files — so the two never round the same file differently.
 */
export function byteSize(i18n: I18n, bytes: number): string {
  if (bytes < MEGABYTE) return i18n._(STATUS_SIZE_KB, { size: Math.max(1, Math.round(bytes / KILOBYTE)) });
  return i18n._(STATUS_SIZE_MB, { size: Math.round((bytes / MEGABYTE) * 10) / 10 });
}
