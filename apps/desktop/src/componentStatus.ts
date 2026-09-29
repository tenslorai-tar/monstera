import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { NATIVE_COMPONENT_IDS, type NativeComponentId } from '@monstera/contract';

import { type NativeSource, nativeComponentFolder, nativeManifestPath, nativeSource } from './nativeComponents.js';

/**
 * What the Components dialog shows for each native component
 * ([ADR-0122](../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 *
 * - `absent` — this build has no such component: no folder, or no manifest entry.
 * - `present` — every file the manifest names is there. Not hashed: what the dialog opens with.
 * - `verified` — every file hashed and equal to the manifest (and, packaged, nothing unpinned beside them).
 * - `changed` — something differs, counted: `missing`, `altered`, `extra`.
 */
export interface ComponentStatus {
  readonly id: NativeComponentId;
  readonly name: string;
  readonly version: string;
  readonly state: 'present' | 'verified' | 'absent' | 'changed';
  readonly missing: number;
  readonly altered: number;
  readonly extra: number;
}

/** One component's manifest entry, as `scripts/release/nativeManifest.mjs` writes it. */
interface ManifestComponent {
  readonly name: string;
  readonly version: string;
  readonly files: Readonly<Record<string, string>>;
}

/** The manifest, or `null` where there is none or it does not parse as one. */
async function readManifest(path: string | null): Promise<Readonly<Record<string, ManifestComponent>> | null> {
  if (path === null) return null;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    // NO MANIFEST IS A STATE, and the dialog says so per component (`absent`): a development launch that wrote none.
    // Anything else — a manifest that cannot be read, or one that does not parse below — is thrown, because showing
    // a damaged package's components as merely absent would be the reassuring answer to the question Verify asks.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || !('components' in parsed)) return null;
  const components = parsed.components;
  return typeof components === 'object' && components !== null
    ? (components as Record<string, ManifestComponent>)
    : null;
}

/** A file's SHA-256, streamed so a large one is never held whole. */
function digestOf(path: string): Promise<string> {
  return new Promise((settle, fail) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => {
        settle(hash.digest('hex'));
      });
  });
}

/** Every file under `folder`, as manifest paths (forward slashes, relative to it). */
async function filesUnder(folder: string): Promise<readonly string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).replace(/\\/gu, '/'));
}

/** Whether a file exists — `stat`'s absence, never a read. */
async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Each component's status. With `verify`, every file is hashed against the manifest; a PACKAGED folder must also hold
 * nothing the manifest does not name — in development a component's folder is a provisioned tree that legitimately
 * holds more (a build's own records beside the shim), so extras are counted only where the package decides the set.
 */
export async function componentStatuses(options: {
  readonly verify: boolean;
  readonly source?: NativeSource;
}): Promise<readonly ComponentStatus[]> {
  const from = options.source ?? nativeSource();
  const manifest = await readManifest(nativeManifestPath(from));
  const statuses: ComponentStatus[] = [];
  for (const id of NATIVE_COMPONENT_IDS) {
    const entry = manifest?.[id];
    const folder = nativeComponentFolder(id, from);
    if (entry === undefined || folder === null) {
      statuses.push({ id, name: entry?.name ?? id, version: entry?.version ?? '—', state: 'absent', missing: 0, altered: 0, extra: 0 });
      continue;
    }
    let missing = 0;
    let altered = 0;
    for (const [path, digest] of Object.entries(entry.files)) {
      const file = join(folder, path);
      if (!(await exists(file))) missing += 1;
      else if (options.verify && (await digestOf(file)) !== digest) altered += 1;
    }
    const pinned = new Set(Object.keys(entry.files));
    const extra =
      options.verify && from.kind === 'packaged'
        ? (await filesUnder(folder)).filter((path) => !pinned.has(path)).length
        : 0;
    const changed = missing + altered + extra > 0;
    statuses.push({
      id,
      name: entry.name,
      version: entry.version,
      state: changed ? 'changed' : options.verify ? 'verified' : 'present',
      missing,
      altered,
      extra,
    });
  }
  return statuses;
}
