import { join } from 'node:path';

import { isKeptCatalogueName, keptCatalogueName, unmadeCatalogueName } from '@monstera/kernel';

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
 * ## Told as soon as the file is being made, and told when it will not be
 *
 * {@link KeptCatalogueHolder.set} is called once a file of this fingerprint is found, or as the catalogue host starts to
 * make one (ADR-0293's correction of 2026-11-15). Told only once the file was in place, as this said until then, a host
 * started on a first launch was told nothing and read the folders beside the catalogue host. Now it waits for the file,
 * and every path that keeps none leaves the marker `unmadeCatalogueName` names, at which a waiting host stops and reads
 * its folders. A marker from an earlier launch is removed before anything is told.
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
  /** Leaves an empty file at `path`: the marker that a fingerprint's catalogue will not be kept this launch. */
  readonly mark: (path: string) => Promise<void>;
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
      const unmade = join(area, unmadeCatalogueName(fingerprint));
      // A MARKER FROM AN EARLIER LAUNCH says nothing of this one, and a host that saw it would read its folders beside
      // the catalogue host this launch starts.
      await files.remove(unmade);
      if (await files.exists(kept)) {
        holder.set({ area, fingerprint });
        return;
      }
      if (parts.run === null) {
        report('no catalogue host can be built here, so the hosts read their font folders');
        return;
      }
      // NAMED TO THE HOSTS WHILE IT IS MADE (ADR-0293's correction of 2026-11-15): a host started now waits for the file
      // (`keptOrRead`) rather than reading the folders beside the catalogue host. On a first launch the catalogue,
      // compose and MuPDF hosts read them at once, and the font list took 10.9 s and a block's faces 5.3 s (shell log,
      // 2026-11-14). EVERY PATH THAT KEEPS NO FILE leaves the marker, so a waiting host stops and reads its folders.
      holder.set({ area, fingerprint });
      const notKept = async (line: string): Promise<void> => {
        report(line);
        await files.mark(unmade);
      };
      let outcome: 'kept' | 'no-faces';
      try {
        outcome = await parts.run(fingerprint, async (written) => {
          // BY THE NAME THE FINGERPRINT GIVES, never one the host answered: `main` copies what it named.
          if (!written.endsWith(name)) throw new Error('the catalogue host wrote a file of another name');
          await files.copy(written, kept);
        });
      } catch (error) {
        await notKept(`the catalogue host did not keep the font catalogue, so the hosts read their font folders: ${String(error)}`);
        return;
      }
      if (outcome === 'no-faces') {
        await notKept('the font folders held no face, so nothing was kept and the hosts read the folders');
        return;
      }
      if (!(await files.exists(kept))) {
        await notKept('the catalogue host answered, and no kept file is in place, so the hosts read their font folders');
        return;
      }
      for (const other of await files.names(area)) {
        if (other !== name && (isKeptCatalogueName(other) || other.endsWith('.catalogue.json.unmade'))) await files.remove(join(area, other));
      }
      report('the font catalogue was read once and kept for this computer’s fonts');
    },
  };
}
