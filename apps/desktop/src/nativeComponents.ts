import { join } from 'node:path';

import { NATIVE_COMPONENT_IDS, type NativeComponentId } from '@monstera/contract';

/**
 * Where each native component is — the ONE resolver
 * ([ADR-0122](../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 *
 * Six readers each read their own launcher variable and answered *absent* otherwise, so a packaged build found none
 * of its components. This table is the one place that knows, for each component, the variable the development
 * launcher sets and the file the package holds under `resources/native/<component>/`; every reader asks here.
 *
 * ## The source is told ONCE, by `entry.ts`
 *
 * Only `entry.ts` may ask Electron whether the application is packaged and where its resources are
 * (`no-install-root-writes`), and it tells this module before anything resolves a component. Until then — and in
 * every unit test — the source is the launcher's variables, which is the development build's answer.
 */

/** The components, as the manifest and the Components dialog name them — the contract's one list. */
export { NATIVE_COMPONENT_IDS, type NativeComponentId };

/**
 * For each component: the variable `scripts/launch.mjs` sets in development, and the path under its packaged folder
 * the application runs — `null` where the component IS the folder (the OCR models, the bundled fonts).
 */
export const NATIVE_COMPONENTS: Readonly<
  Record<NativeComponentId, { readonly variable: string; readonly runs: string | null }>
> = {
  pdfium: { variable: 'MONSTERA_PDFIUM_LIBRARY', runs: 'pdfium.dll' },
  poppler: { variable: 'MONSTERA_POPPLER_EXECUTABLE', runs: 'pdftotext.exe' },
  ghostscript: { variable: 'MONSTERA_GHOSTSCRIPT_EXECUTABLE', runs: 'gswin64c.exe' },
  onlyoffice: { variable: 'MONSTERA_ONLYOFFICE_EXECUTABLE', runs: 'x2t.exe' },
  'mupdf-shim': { variable: 'MONSTERA_MUPDF_SHIM', runs: 'monstera_mupdf.dll' },
  'ocr-models': { variable: 'MONSTERA_TESSDATA_DIRECTORY', runs: null },
  fonts: { variable: 'MONSTERA_FONTS_DIRECTORY', runs: null },
};

/** Where components are found: the package's `resources/native` folder, or the launcher's variables. */
export type NativeSource =
  | { readonly kind: 'packaged'; readonly folder: string }
  | { readonly kind: 'development'; readonly environment: Readonly<Record<string, string | undefined>> };

let source: NativeSource = { kind: 'development', environment: process.env };

/** Tells the resolver where components are. `entry.ts`, once, before any component is resolved. */
export function setNativeSource(next: NativeSource): void {
  source = next;
}

/** The source in force — for the Components dialog, which verifies where the components are. */
export function nativeSource(): NativeSource {
  return source;
}

/**
 * The path the application runs for `id` — a library, a program, or the models' folder — or `null` where this build
 * has none. EMPTY IS ABSENT in development: a shell expanding an unset variable produces `''`.
 */
export function nativeComponentPath(id: NativeComponentId, from: NativeSource = source): string | null {
  const component = NATIVE_COMPONENTS[id];
  if (from.kind === 'packaged') {
    const folder = join(from.folder, id);
    return component.runs === null ? folder : join(folder, component.runs);
  }
  const supplied = from.environment[component.variable];
  return supplied === undefined || supplied.length === 0 ? null : supplied;
}

/**
 * Where the manifest is: beside the components when packaged, or where the launcher generated it
 * (`MONSTERA_NATIVE_MANIFEST`) in development — `null` for a launch that generated none.
 */
export function nativeManifestPath(from: NativeSource = source): string | null {
  if (from.kind === 'packaged') return join(from.folder, 'manifest.json');
  const supplied = from.environment['MONSTERA_NATIVE_MANIFEST'];
  return supplied === undefined || supplied.length === 0 ? null : supplied;
}

/**
 * The folder a component's manifest paths are relative to: its packaged folder, or — in development — the folder the
 * launcher's path sits in (a program's `bin/`, the models' own folder).
 */
export function nativeComponentFolder(id: NativeComponentId, from: NativeSource = source): string | null {
  if (from.kind === 'packaged') return join(from.folder, id);
  const path = nativeComponentPath(id, from);
  if (path === null) return null;
  return NATIVE_COMPONENTS[id].runs === null ? path : join(path, '..');
}
