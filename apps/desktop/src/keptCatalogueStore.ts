import { join } from 'node:path';

import { isKeptCatalogueName, keptCatalogueName } from '@monstera/kernel';

import type { KeptCatalogueArguments } from './engineHostPrograms.js';
import { type ContainerSid, type UserSid, keptAreaDacl } from './hostDacl.js';
import type { DaclSurface } from './packageDataLock.js';

/**
 * `main`'s half of the kept font catalogue
 * ([ADR-0293](../../../docs/DECISIONS/0293-the-font-catalogue-is-read-once-by-a-host-that-holds-no-document-and-kept.md),
 * with its correction of 2026-11-12).
 *
 * ## `main` places the file and never reads it
 *
 * The catalogue host writes the file into its own area; `main` copies it into the kept area by the name the fingerprint
 * gives it (`keptCatalogueName`, from the kernel's barrel, which reaches no parser) and removes the other fingerprints'
 * files by name. A copy, not a rename, so the new file takes the kept area's ACEs. Nothing here opens a font or reads the
 * file's content: `copy` is bytes from one path to another.
 *
 * ## The area's DACL is applied on every launch and read back
 *
 * The area outlives a run, so a directory an older build made, or one something changed since, must not keep other
 * grants: {@link keptAreaDacl} is written every start, and a write that fails, or a read that does not give it back, leaves
 * no host told of the area. Every failure here leaves the hosts reading their folders, as before ADR-0293: the file can
 * only make a load faster.
 *
 * ## Told only once the file is in place
 *
 * {@link KeptCatalogueHolder.set} is called after the copy, or after finding a file of this fingerprint already there, so a
 * host is never told of an area that holds no file for its fingerprint, which would cost it a failed read for nothing.
 */

/** What the text hosts are told when each starts: set once, by {@link createKeptCatalogue}'s `start`. */
export interface KeptCatalogueHolder {
  readonly known: () => KeptCatalogueArguments | null;
  readonly set: (known: KeptCatalogueArguments) => void;
}

export function keptCatalogueHolder(): KeptCatalogueHolder {
  let known: KeptCatalogueArguments | null = null;
  return {
    known: () => known,
    set: (value) => {
      known = value;
    },
  };
}

/**
 * The files `main` touches, as paths: made, asked about, copied and removed, never read. ASYNCHRONOUS, ADR-0268's rule
 * for `main`'s file work, so none of it holds the event loop.
 */
export interface KeptAreaFiles {
  readonly makeDirectory: (path: string) => Promise<unknown>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly copy: (from: string, to: string) => Promise<void>;
  readonly names: (directory: string) => Promise<readonly string[]>;
  readonly remove: (path: string) => Promise<void>;
}

/** One run of the catalogue host for a fingerprint: `place` is handed the written file's path while its area exists. */
export type RunCatalogueHost = (fingerprint: string, place: (written: string) => Promise<void>) => Promise<'kept' | 'no-faces'>;

export interface KeptCatalogueParts {
  /** The kept area: a directory under the app's session data that survives runs, outside every swept root. */
  readonly area: string;
  readonly user: UserSid;
  /** The principals of the hosts that set text: the ones the area grants read. */
  readonly readers: readonly ContainerSid[];
  readonly dacl: DaclSurface;
  readonly files: KeptAreaFiles;
  /** ADR-0237's fingerprint of the two font folders, as `main` computes it for the font list. */
  readonly fingerprint: () => Promise<string>;
  /** `null` where no catalogue host can be built here: the hosts then read their folders. */
  readonly run: RunCatalogueHost | null;
  readonly holder: KeptCatalogueHolder;
  /** Each step's outcome, for the diagnostics log. */
  readonly report: (line: string) => void;
}

/** The kept catalogue's start: called once a launch, in the background, never on a document's path. */
export function createKeptCatalogue(parts: KeptCatalogueParts): { readonly start: () => Promise<void> } {
  return {
    start: async () => {
      const { area, files, holder, report } = parts;
      const sddl = keptAreaDacl(parts.user, parts.readers);
      try {
        await files.makeDirectory(area);
      } catch (error) {
        report(`the kept font catalogue's area could not be made: ${String(error)}`);
        return;
      }
      if (!parts.dacl.write(area, sddl) || parts.dacl.read(area) === null) {
        report('the kept font catalogue’s area could not be given its DACL, so no host is told of it');
        return;
      }
      const fingerprint = await parts.fingerprint();
      const name = keptCatalogueName(fingerprint);
      const kept = join(area, name);
      if (!(await files.exists(kept))) {
        if (parts.run === null) {
          report('no catalogue host can be built here, so the hosts read their font folders');
          return;
        }
        let outcome: 'kept' | 'no-faces';
        try {
          outcome = await parts.run(fingerprint, async (written) => {
            // BY THE NAME THE FINGERPRINT GIVES, never one the host answered: `main` copies what it named.
            if (!written.endsWith(name)) throw new Error('the catalogue host wrote a file of another name');
            await files.copy(written, kept);
          });
        } catch (error) {
          report(`the catalogue host did not keep the font catalogue, so the hosts read their font folders: ${String(error)}`);
          return;
        }
        if (outcome === 'no-faces') {
          report('the font folders held no face, so nothing was kept and the hosts read the folders');
          return;
        }
        // IN PLACE, or no host is told of it: a host told of an area with no file pays a failed read for nothing.
        if (!(await files.exists(kept))) {
          report('the catalogue host answered, and no kept file is in place, so the hosts read their font folders');
          return;
        }
        for (const other of await files.names(area)) {
          if (other !== name && isKeptCatalogueName(other)) await files.remove(join(area, other));
        }
        report('the font catalogue was read once and kept for this computer’s fonts');
      }
      holder.set({ area, fingerprint });
    },
  };
}
