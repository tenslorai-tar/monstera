/**
 * The members of `resedit` 3.1.0 that `scripts/release/packageMsix.mjs` calls, as the scripts program sees them.
 *
 * ## Why the package's own declarations are not loaded
 *
 * `resedit` and `pe-library` each declare `/// <reference lib="dom" />` (`dist/util/functions.d.ts`). A file the
 * program loads adds the DOM library to the WHOLE program, and DOM's `fetch` then refuses a Node `Buffer` as a body:
 * measured 2026-10-15, importing the package turned `npm run typecheck` red in five files that never name it. Adding
 * DOM to `tsconfig.scripts.json` would be the same change made on purpose. So `tsconfig.scripts.json`'s `paths` resolves
 * the specifier here, and nothing of the package's declarations is read.
 *
 * ## What keeps this honest
 *
 * Each signature below is copied from 3.1.0's declarations, narrowed to what is called; a resource entry and an icon
 * image are opaque, since the packager only passes them along. A drift between this file and the library is a runtime
 * failure at packaging, and `brandExecutable` reads the icon back and refuses the package unless it is the brand's,
 * byte for byte, so a wrong call cannot ship quietly. Bumping `resedit` means re-reading these four from its own `.d.ts`.
 */

declare const resourceEntry: unique symbol;
declare const iconImage: unique symbol;

/** One entry of an executable's resource section, passed through untouched. */
interface ResourceEntry {
  readonly [resourceEntry]: true;
}

/** One image of an icon, as an `.ico` file holds it. */
interface IconImage {
  readonly [iconImage]: true;
}

export declare class NtExecutable {
  /** `ignoreCert`: parse a signed binary; the signature is dropped on output. */
  static from(bin: ArrayBuffer | ArrayBufferView, options?: { ignoreCert?: boolean }): NtExecutable;
  generate(paddingSize?: number): ArrayBuffer;
}

export declare class NtExecutableResource {
  static from(exe: NtExecutable, ignoreUnparsableData?: boolean): NtExecutableResource;
  entries: ResourceEntry[];
  outputResource(exeDest: NtExecutable, noGrow?: boolean, allowShrink?: boolean): void;
}

export declare namespace Data {
  class IconFile {
    static from(bin: ArrayBuffer | ArrayBufferView): IconFile;
    icons: { data: IconImage }[];
  }
}

export declare namespace Resource {
  class IconGroupEntry {
    static fromEntries(entries: readonly ResourceEntry[]): IconGroupEntry[];
    static replaceIconsForResource(
      destEntries: ResourceEntry[],
      iconGroupID: string | number,
      lang: string | number,
      icons: IconImage[],
    ): void;
    id: string | number;
    lang: string | number;
  }
}
