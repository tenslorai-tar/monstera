import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { type ListedFontFamilies, MAX_FONT_FAMILIES, fontFamilySchema } from '@monstera/contract';
import { z } from 'zod';

import type { SettingsSurface } from './settingsFile.js';

/**
 * The font list kept on disk, so an edit starts no compose host
 * ([ADR-0237](../../../docs/DECISIONS/0237-the-font-list-is-kept-on-disk-so-an-edit-starts-no-compose-host.md)).
 *
 * ## What is kept, and what decides whether it still holds
 *
 * The compose host's answer, families and the count past the bound, beside the FINGERPRINT of the folders it read: each
 * file's name, size and modification time. A font installed, removed or replaced changes one of those, so the list is
 * read from the host again. Nothing here opens a font file: the listing is `readdir` and `stat`, and a font is parsed only
 * in the contained host (ADR-0172).
 */

/** The file's name under `userData`. */
export const FONT_LIST_FILE = 'font-families.json';

/** What a folder listing needs: its names, and each one's size and modification time. */
export interface FolderListing {
  readonly names: (folder: string) => readonly string[];
  readonly stat: (path: string) => { readonly size: number; readonly mtimeMs: number; readonly isFile: boolean };
}

/**
 * The fingerprint of `folders`: a digest of every file's name, size and modification time, each folder in the order
 * given and its files by name. A folder that cannot be listed is ABSENT in the digest, so its arriving changes it.
 */
export function fontFoldersFingerprint(folders: readonly (string | null)[], listing: FolderListing): string {
  const hash = createHash('sha256');
  for (const folder of folders) {
    if (folder === null) {
      hash.update('none\n');
      continue;
    }
    let names: readonly string[];
    try {
      names = listing.names(folder);
    } catch {
      hash.update(`absent ${folder}\n`);
      continue;
    }
    hash.update(`folder ${folder}\n`);
    for (const name of [...names].sort()) {
      const stat = listing.stat(join(folder, name));
      if (!stat.isFile) continue;
      hash.update(`${name}\t${String(stat.size)}\t${String(stat.mtimeMs)}\n`);
    }
  }
  return hash.digest('hex');
}

/** The file as written: the fingerprint it was read under, and the host's answer. */
const keptSchema = z
  .object({
    fingerprint: z.string().length(64),
    families: z.array(fontFamilySchema).max(MAX_FONT_FAMILIES),
    more: z.number().int().min(0),
  })
  .strict();

/**
 * The font list: the file's where it was kept under the same fingerprint, else the host's, which is then kept.
 *
 * @param file the JSON file under `userData`
 * @param fingerprint the font folders' fingerprint now ({@link fontFoldersFingerprint})
 * @param fromHost the compose host's read, which starts the host
 */
export async function keptFontFamilies(
  file: SettingsSurface,
  fingerprint: () => string,
  fromHost: () => Promise<ListedFontFamilies>,
): Promise<ListedFontFamilies> {
  const now = fingerprint();
  // A FILE THAT DOES NOT READ AS ONE IS ASKED AGAIN, never trusted in part: it is the app's own file, and a damaged one
  // costs one host start.
  const kept = keptSchema.safeParse(file.read());
  if (kept.success && kept.data.fingerprint === now) return { families: kept.data.families, more: kept.data.more };
  const read = await fromHost();
  file.write({ fingerprint: now, families: read.families, more: read.more });
  return read;
}
