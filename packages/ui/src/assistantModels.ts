import type { AiModel, AiProviderId } from '@monstera/contract';

/**
 * The model lists the Assistant has been answered this session, by provider.
 *
 * ## Why the answer is kept outside the panel
 *
 * The right panel mounts ONE tab (ADR-0083): the Assistant is torn down when Spelling or Properties is chosen and built
 * again when it is chosen back. Its list lived in the panel's state and began empty each time, so for the length of the
 * read it asked of `main` the panel said *no models are listed for this provider yet* — a sentence that was false, shown
 * at the top of the panel on every return to it and gone a moment later. A list already answered is the better thing to
 * start from, and a provider not yet answered is a state of its own (*listing*), never the empty list.
 *
 * `main` answers `ai.models` from the same key and address rules every time, so what is held here is only ever a copy of
 * its last answer; the panel asks again on every mount and replaces it.
 */
const held = new Map<AiProviderId, readonly AiModel[]>();

/** The list `provider` last answered, or `undefined` before it has answered at all. */
export function heldModels(provider: AiProviderId): readonly AiModel[] | undefined {
  return held.get(provider);
}

/** Keeps `provider`'s answer, replacing the one before. */
export function holdModels(provider: AiProviderId, models: readonly AiModel[]): void {
  held.set(provider, models);
}

/** Forgets every answer — for a case that must start from a window nothing has asked in. */
export function forgetHeldModels(): void {
  held.clear();
}
