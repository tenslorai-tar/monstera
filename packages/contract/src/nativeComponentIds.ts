/**
 * The native components a build runs, by the id the manifest, the shell's resolver and the Components dialog share
 * ([ADR-0122](../../../docs/DECISIONS/0122-native-components-one-resolver-a-pinned-manifest-status-and-verify.md)).
 *
 * Its own module so a channel and an event can both name them: `channels.ts` imports `events.ts`, so the list living
 * in `channels.ts` could not be read by an event without a cycle.
 */
export const NATIVE_COMPONENT_IDS = [
  'pdfium',
  'poppler',
  'ghostscript',
  'onlyoffice',
  'mupdf-shim',
  'ocr-models',
  'fonts',
] as const;
export type NativeComponentId = (typeof NATIVE_COMPONENT_IDS)[number];
