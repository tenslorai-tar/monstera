import {
  CLOUD_PROVIDER_IDS,
  type DisplayLocation,
  type KnownFolder,
  MAX_DOCUMENT_NAME_LENGTH,
  displayLocationSchema,
} from '@monstera/contract';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

/** A folder a recent file's location may be named by, and where it is on this machine. */
export interface KnownRoot {
  readonly within: KnownFolder;
  readonly path: string;
  /**
   * Whether a file under this root shows the folder it is in. `false` for a cloud working copy, whose
   * folders are internal ids rather than anything the person named.
   */
  readonly showsFolder: boolean;
}

/**
 * Where a recent file is, for display: the known folder it is under and the folder it is in, never a path
 * ([ADR-0100](../../../docs/DECISIONS/0100-a-recent-file-shows-where-it-is-and-a-preview-both-from-main.md)).
 *
 * ## The DEEPEST known folder wins
 *
 * Folders nest: OneDrive can hold the Documents folder, and a file there is *Documents › Leases* rather
 * than *OneDrive › Leases*. So of the roots containing the file's folder, the longest path names it.
 * Containment is `path.relative`'s answer, which on Windows compares without case, as the filesystem does.
 *
 * ## What is never shown
 *
 * A drive or a path: `folder` is one component, the name of the folder the file is in. A file at a drive's
 * root has none (`basename('C:\\')` is empty), and one directly in a known folder shows that folder alone.
 * A name longer than a path component can be is dropped rather than cut, since a cut name is a wrong one.
 */
export function displayLocationOf(path: string, roots: readonly KnownRoot[]): DisplayLocation {
  const folderPath = dirname(path);
  const root = deepestContaining(folderPath, roots);
  const directlyIn = root !== undefined && relative(root.path, folderPath) === '';
  const shows = root === undefined || (root.showsFolder && !directlyIn);
  return displayLocationSchema.parse({
    within: root?.within ?? null,
    folder: shows ? componentOrNull(basename(folderPath)) : null,
  });
}

/** What {@link knownRoots} is built from: Electron's folder answers, the environment, and the working copies. */
export interface KnownRootSources {
  readonly documents: string;
  readonly downloads: string;
  readonly desktop: string;
  /** The process environment, for the OneDrive client's folder variables. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where cloud working copies go: one folder per provider beneath it (ADR-0091). */
  readonly cloudWorkingDirectory: string;
}

/**
 * The environment variables naming a OneDrive folder. `OneDrive` is the one observed, on the development
 * machine on 2026-09-25 (the only variable there whose name contains it). The consumer and work-or-school
 * variants are read too and were NOT observed; a machine without them costs nothing, since each empty or
 * absent one is skipped. Each non-empty one is a root.
 */
const ONEDRIVE_VARIABLES = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'] as const;

/** The roots a recent file's location is named by, on this machine. */
export function knownRoots(sources: KnownRootSources): readonly KnownRoot[] {
  const onedrive = ONEDRIVE_VARIABLES.map((name) => sources.env[name] ?? '').filter((path) => path !== '');
  return [
    { within: 'documents', path: sources.documents, showsFolder: true },
    { within: 'downloads', path: sources.downloads, showsFolder: true },
    { within: 'desktop', path: sources.desktop, showsFolder: true },
    ...onedrive.map((path): KnownRoot => ({ within: 'onedrive', path, showsFolder: true })),
    ...CLOUD_PROVIDER_IDS.map(
      (provider): KnownRoot => ({ within: provider, path: join(sources.cloudWorkingDirectory, provider), showsFolder: false }),
    ),
  ];
}

function deepestContaining(folderPath: string, roots: readonly KnownRoot[]): KnownRoot | undefined {
  let deepest: KnownRoot | undefined;
  for (const root of roots) {
    // AN EMPTY ROOT IS NO ROOT: `relative('', …)` would measure from the working directory.
    if (root.path === '') continue;
    const inside = relative(root.path, folderPath);
    // `..` AS A WHOLE COMPONENT, so a folder named `..notes` inside the root is still inside it.
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) continue;
    if (deepest === undefined || root.path.length > deepest.path.length) deepest = root;
  }
  return deepest;
}

function componentOrNull(name: string): string | null {
  return name === '' || name.length > MAX_DOCUMENT_NAME_LENGTH ? null : name;
}
