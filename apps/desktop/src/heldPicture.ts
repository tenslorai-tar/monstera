import type { FileHandle } from '@monstera/shared';

/** A picture main picked and read, as the plain Signature holds it between the preview and the click. */
export interface PictureHeld {
  readonly name: string;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly bytes: Uint8Array;
}

/**
 * The ONE picture the plain Signature's dialog previewed (ADR-0133's second correction), held under the handle the
 * renderer was given.
 *
 * The BYTES are held, not the path: the picture placed is the one previewed even if the file changes on disk between
 * the two. One slot, so what main keeps resident is one picture whatever a person does — a new pick replaces it, and a
 * placement releases it. A handle that is not the one held answers `undefined`, which the placement reports as a
 * signature that is no longer there rather than opening a picker in its place.
 */
export interface HeldPicture {
  hold(handle: FileHandle, picture: PictureHeld): void;
  held(handle: FileHandle): PictureHeld | undefined;
  release(handle: FileHandle): void;
}

export function createHeldPicture(): HeldPicture {
  let slot: { readonly handle: FileHandle; readonly picture: PictureHeld } | undefined;
  return {
    hold(handle, picture) {
      slot = { handle, picture };
    },
    held(handle) {
      return slot?.handle === handle ? slot.picture : undefined;
    },
    release(handle) {
      if (slot?.handle === handle) slot = undefined;
    },
  };
}

/** For a composition that places no plain signature picture: holds nothing, so every handle is absent. */
export const NO_HELD_PICTURE: HeldPicture = {
  hold: () => undefined,
  held: () => undefined,
  release: () => undefined,
};
