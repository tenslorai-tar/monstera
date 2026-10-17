import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { channels } from './channels.js';
import { CONVERSION_CHANNELS, unregisteredConversions } from './conversionChannels.js';

/**
 * ADR-0234's check: every conversion registers with the one notice, so a conversion added later cannot forget to. Each
 * failure mode has its own control, built from a channel the check would pass were the rule absent.
 */
describe('every conversion channel is named work', () => {
  it('THE CONTRACT AS IT IS has no conversion that does not register', () => {
    expect(unregisteredConversions(channels, CONVERSION_CHANNELS)).toStrictEqual([]);
  });

  it('the list is not empty and holds the sixteen, so the pass above is not a pass over nothing', () => {
    expect(CONVERSION_CHANNELS).toHaveLength(16);
  });

  const withWork = { params: z.object({ docId: z.string(), work: z.string() }) };
  const withoutWork = { params: z.object({ docId: z.string() }) };
  const optionalWork = { params: z.object({ docId: z.string(), work: z.string().optional() }) };

  it('CONTROL: a listed channel with NO work name is reported', () => {
    expect(unregisteredConversions({ 'document.exportThing': withoutWork }, ['document.exportThing'])).toStrictEqual([
      "document.exportThing is a conversion whose params do not require the work's name",
    ]);
  });

  it('CONTROL: an OPTIONAL work name is reported, which is how the CSV import had one and the rest had none', () => {
    expect(unregisteredConversions({ 'document.newFromThing': optionalWork }, ['document.newFromThing'])).toHaveLength(1);
  });

  it('CONTROL: a conversion added under a converting name, NOT LISTED and without the work name, is reported by its name', () => {
    // WITHOUT the field, so the field rule cannot see it and only the name net can be what reports it.
    expect(unregisteredConversions({ 'document.exportNewFormat': withoutWork }, [])).toStrictEqual([
      'document.exportNewFormat is named like a conversion and is not in CONVERSION_CHANNELS',
    ]);
  });

  it('CONTROL: a listed id that is no channel is reported, so a renamed channel cannot leave the list passing over nothing', () => {
    expect(unregisteredConversions({}, ['document.exportGone'])).toHaveLength(1);
  });

  it('a channel that REQUIRES the work name is a conversion whatever it is called, so one named otherwise and not listed is reported (EEEEEEEE-6)', () => {
    expect(unregisteredConversions({ 'document.renderPoster': withWork }, [])).toStrictEqual([
      "document.renderPoster takes the work's name and is not in CONVERSION_CHANNELS",
    ]);
  });

  it('CONTROL: the work channels themselves take the name and are not conversions', () => {
    expect(unregisteredConversions({ 'work.progress': { params: z.object({ work: z.string() }) } }, [])).toStrictEqual([]);
  });

  it('a channel NOT named like a conversion and not listed passes — the check is about conversions, not every channel', () => {
    expect(unregisteredConversions({ 'document.importAnnotations': withoutWork }, [])).toStrictEqual([]);
  });
});
