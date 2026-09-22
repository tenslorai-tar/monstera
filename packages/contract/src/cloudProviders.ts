import { z } from 'zod';

/**
 * The cloud storage providers this build knows
 * ([ADR-0091](../../../docs/DECISIONS/0091-cloud-storage-a-declared-provider-a-build-configured-client-and-a-working-copy.md)).
 *
 * Microsoft and Google first, the owner's order of 2026-09-21; Dropbox and Box are later entries.
 * The ids are the contract's because the renderer names a provider and `main` answers for it; the
 * endpoints, scopes and hosts are the kernel's (`cloudStorage.ts`), because only `main` calls them.
 */
export const CLOUD_PROVIDER_IDS = ['onedrive', 'google-drive'] as const;

export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];

export const cloudProviderSchema = z.enum(CLOUD_PROVIDER_IDS);

/** How many files one listing answers — a page of a person's own PDFs, not their whole drive. */
export const MAX_CLOUD_FILES = 200;

/** A provider's id for a file. Both providers' ids are short opaque strings. */
export const MAX_CLOUD_FILE_ID = 512;

/** A file's name as the provider holds it. */
export const MAX_CLOUD_FILE_NAME = 400;

/** One PDF in a person's cloud storage, as a listing answers it. */
export const cloudFileSchema = z
  .object({
    id: z.string().min(1).max(MAX_CLOUD_FILE_ID),
    name: z.string().min(1).max(MAX_CLOUD_FILE_NAME),
    /** Bytes, where the provider says. */
    size: z.number().int().nonnegative().nullable(),
    /** When it last changed, as epoch milliseconds, where the provider says. */
    modified: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type CloudFile = z.infer<typeof cloudFileSchema>;

/**
 * Where a provider stands on this machine: its client values are not in this build, nobody is
 * signed in, or somebody is.
 */
export const cloudStateSchema = z.enum(['not-configured', 'signed-out', 'signed-in']);

export type CloudState = z.infer<typeof cloudStateSchema>;

/**
 * Why a cloud request did not happen — each a person's situation, named so the surface can say it.
 */
export const CLOUD_REFUSALS = [
  /** The build carries no client values for this provider (ADR-0091 Decision 2). */
  'not-configured',
  /** No secure store is available, so a sign-in could not be kept. */
  'secrets-unavailable',
  'sign-in-cancelled',
  'sign-in-timed-out',
  'sign-in-denied',
  'sign-in-unavailable',
  /** The provider refused the kept sign-in; signing in again is the next step. */
  'unauthorised',
  'unreachable',
  'rejected',
  'unexpected-answer',
  /** The file changed in the cloud since it was opened here; Save back did not overwrite it. */
  'changed-elsewhere',
  /** The document is larger than the provider's simple upload takes. */
  'too-large',
  /** The file is not a PDF, or is larger than a document may be. */
  'not-a-pdf',
] as const;

export type CloudRefusal = (typeof CLOUD_REFUSALS)[number];
