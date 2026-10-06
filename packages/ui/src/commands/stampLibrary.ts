import { type ContractClient, type LibraryKind, signatureFontOf } from '@monstera/contract';

import type { StampDeps, StampPictures } from '../annotations/stampTool.js';
import { INSERT_IMAGE_PROBLEM_DIALOG_ID } from '../dialogs/insertImageProblem.js';
import type { KeptSignature } from '../dialogs/signDocument.js';
import type { StampPicture } from '../dialogs/stampResult.js';

/** What the library's page side needs: the client, `ask` for a problem worth saying, and `blob:` addresses. */
export interface LibraryPageDeps {
  readonly client: ContractClient;
  readonly ask: (id: string, props: unknown) => Promise<unknown>;
  /** A `blob:` address for bytes, and letting go of one — `URL`'s, injected so a case can count them. */
  readonly urls: { readonly make: (bytes: Uint8Array, type: string) => string; readonly revoke: (url: string) => void };
}

/** The browser's own `blob:` addresses. */
export const BLOB_URLS: LibraryPageDeps['urls'] = {
  make: (bytes, type) => URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type })),
  revoke: (url) => {
    URL.revokeObjectURL(url);
  },
};

/**
 * The kept entries of one kind as a chooser shows them — a picture with a `blob:` address of its bytes, a typed or
 * drawn signature as itself — and how to let go of the addresses once the chooser has closed.
 *
 * ONE READER for both libraries (B3a): the stamp chooser and the signing dialog show the same library the same way.
 * A picture that cannot be read back is left out rather than shown broken, since the list is main's answer about what
 * is kept and the picture is a second read that can fail on its own. A listing that failed is an empty library for
 * this round and says nothing: the person asked to stamp or sign, not to see the library.
 */
export async function keptEntries(
  deps: LibraryPageDeps,
  kind: LibraryKind,
): Promise<{ readonly kept: readonly KeptSignature[]; readonly release: () => void }> {
  const listed = await deps.client['library.list']({ kind });
  const made: string[] = [];
  const kept: KeptSignature[] = [];
  if (listed.ok) {
    for (const entry of listed.value.entries) {
      if (entry.look.kind === 'typed') {
        // IN THE FACE IT IS SHOWN AND PLACED IN: a face retired by ADR-0150 is read as its nearest, here, once.
        kept.push({ id: entry.id, look: { ...entry.look, font: signatureFontOf(entry.look.font) } });
        continue;
      }
      if (entry.look.kind !== 'picture') {
        kept.push({ id: entry.id, look: entry.look });
        continue;
      }
      const picture = await deps.client['library.picture']({ id: entry.id });
      if (!picture.ok || picture.value.kind !== 'found') continue;
      const src = deps.urls.make(picture.value.bytes, picture.value.mediaType);
      made.push(src);
      kept.push({ id: entry.id, look: { kind: 'picture', name: entry.look.name, src } });
    }
  }
  return {
    kept,
    release: () => {
      for (const url of made) deps.urls.revoke(url);
    },
  };
}

/**
 * Keeps a picture the person picks, in one library. Each problem is AWAITED before this settles, so the chooser its
 * opener asks again straight after comes back once the problem has been read.
 */
export async function keepPicture(deps: LibraryPageDeps, kind: LibraryKind): Promise<void> {
  const added = await deps.client['library.addPicture']({ kind });
  if (!added.ok) return;
  const outcome = added.value;
  if (outcome.kind === 'unreadable') await deps.ask(INSERT_IMAGE_PROBLEM_DIALOG_ID, { reason: 'unreadable' });
  if (outcome.kind === 'too-large') {
    await deps.ask(INSERT_IMAGE_PROBLEM_DIALOG_ID, { reason: 'too-large', limitBytes: outcome.limitBytes });
  }
  if (outcome.kind === 'full') await deps.ask(INSERT_IMAGE_PROBLEM_DIALOG_ID, { reason: 'library-full', limit: outcome.limit });
}

/** The stamp tool's library, as the page reaches it: the kept pictures, and keeping and removing one. */
export function stampLibrary(deps: LibraryPageDeps): Omit<StampDeps, 'onPlaceStampPicture'> {
  return {
    stampPictures: async (): Promise<StampPictures> => {
      const { kept, release } = await keptEntries(deps, 'stamp');
      const pictures: StampPicture[] = kept.flatMap((entry) =>
        entry.look.kind === 'picture' ? [{ id: entry.id, name: entry.look.name, src: entry.look.src }] : [],
      );
      return { pictures, release };
    },
    addStampPicture: () => keepPicture(deps, 'stamp'),
    removeStampPicture: async (id: string): Promise<void> => {
      await deps.client['library.remove']({ id });
    },
  };
}
