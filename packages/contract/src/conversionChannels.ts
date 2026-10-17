import type { ChannelId } from './channels.js';

/**
 * EVERY CONVERSION CHANNEL (ADR-0234): each takes the work's name, required, and main begins the work under it once the
 * input is chosen, so the one notice shows from then until the result. `conversionChannels.test.ts` fails a listed channel
 * whose params do not require the name, and a channel whose name says it converts that is not listed here.
 */
export const CONVERSION_CHANNELS = [
  'document.newFromMarkdown',
  'document.newFromCsv',
  'document.newFromOffice',
  'document.newFromImages',
  'document.newFromCapture',
  'document.openFromUrl',
  'document.appendMarkdown',
  'document.insertImage',
  'document.exportPageImages',
  'document.exportFormData',
  'document.exportText',
  'document.exportWord',
  'document.exportPowerPoint',
  'document.exportExcel',
  'document.exportPdfa',
  'document.exportAnnotations',
] as const satisfies readonly ChannelId[];

/** A channel that converts, and so carries the work's name. */
export type ConversionChannel = (typeof CONVERSION_CHANNELS)[number];

/** A name that says the channel converts: a new document from a file, an export, a fetch, or pages composed into one. */
export const CONVERTS_BY_NAME = /^document\.(?:newFrom|export|openFromUrl$|appendMarkdown$|insertImage$)/u;

/** What the check reads of a channel: its params schema's fields, where it has an object of them. */
interface ParamsOf {
  readonly params: { readonly shape?: Readonly<Record<string, { safeParse: (value: unknown) => { success: boolean } }>> };
}

/**
 * Every way a channel map breaks ADR-0234, as sentences, EMPTY where none does: a listed channel whose params do not
 * REQUIRE the work's name, a listed id that is no channel, and a channel named like a conversion that is not listed.
 */
export function unregisteredConversions(
  channels: Readonly<Record<string, ParamsOf>>,
  listed: readonly string[],
): readonly string[] {
  const problems: string[] = [];
  for (const id of listed) {
    const channel = channels[id];
    if (channel === undefined) {
      problems.push(`${id} is listed as a conversion and is no channel`);
      continue;
    }
    const work = channel.params.shape?.['work'];
    // REQUIRED, read by refusing its absence: an optional name is how every conversion but one came to have none.
    if (work === undefined || work.safeParse(undefined).success) {
      problems.push(`${id} is a conversion whose params do not require the work's name`);
    }
  }
  for (const [id, channel] of Object.entries(channels)) {
    if (listed.includes(id)) continue;
    // BY WHAT IT TAKES (EEEEEEEE-6): a channel that requires the work's name is a conversion, whatever it is called, so
    // one named otherwise is found here. The `work.` channels take it because they are ABOUT the work, not one of it.
    const work = channel.params.shape?.['work'];
    if (!id.startsWith('work.') && work !== undefined && !work.safeParse(undefined).success) {
      problems.push(`${id} takes the work's name and is not in CONVERSION_CHANNELS`);
    } else if (CONVERTS_BY_NAME.test(id)) {
      // AND BY ITS NAME, for the conversion that forgot the field as well as the listing: the one shape the field rule
      // cannot see, and the reason this net stays.
      problems.push(`${id} is named like a conversion and is not in CONVERSION_CHANNELS`);
    }
  }
  return problems;
}
