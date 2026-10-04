// @ts-check
/**
 * The owner's logo master, named once for every script that reads it: the committed sizes
 * (`generateAssets.mjs`), the Store's images (`storeAssets.mjs`) and the shape proof.
 *
 * ONE MASTER SINCE 2026-10-04, by the owner's decision recorded in ADR-0002's note of that day: the
 * mark alone, with no wordmark, feeds every output. Each of the three readers used to spell the
 * masters' file names itself, so retiring one was three edits that nothing compared; a name read
 * from here is one.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The master's file name inside `assets/brand`. */
export const MASTER_FILE = 'monstera_logo.png';

/** The master's path in this checkout. */
export const MASTER = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'assets', 'brand', MASTER_FILE);
