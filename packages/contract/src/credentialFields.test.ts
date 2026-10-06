import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { channels, preloadChannels } from './channels.js';
import { setDocumentProtectionSchema } from './commands.js';
import { credentialFields } from './credentialFields.js';
import { EVENTS } from './events.js';

/**
 * No answer the renderer is sent has a field that could carry a password
 * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 4:
 * *it must never cross to the renderer*).
 *
 * What crosses from main to the renderer is three sets of schemas: every renderer channel's result, the preload
 * channel's result, and every event's payload. A failure that carries a detail is a member of its channel's result
 * union, so it is read with the result. The params go the other way, renderer to main, and `document.unlock`'s carry
 * the password a person typed by design, so they are not this case's subject.
 *
 * The walk matches a field by its NAME, which is all a schema says about what a string is: a password named as
 * something else is out of its reach.
 */

/** Every credential-named field in what main sends the renderer, by where it is. */
function credentialsSentToTheRenderer(): readonly string[] {
  return [
    ...Object.entries(channels).flatMap(([id, entry]) => credentialFields(entry.result, `${id}.result`)),
    ...Object.entries(preloadChannels).flatMap(([id, entry]) => credentialFields(entry.result, `${id}.result`)),
    ...Object.entries(EVENTS).flatMap(([id, schema]) => credentialFields(schema, id)),
  ];
}

describe('credentialFields — the one walk, read out of zod’s JSON Schema', () => {
  it('POSITIVE CONTROL: finds the protect command’s two passwords', () => {
    expect(credentialFields(setDocumentProtectionSchema, 'protect')).toStrictEqual([
      'protect.userPassword',
      'protect.ownerPassword',
    ]);
  });

  it('finds one nested inside an optional, an array, a union member and a record', () => {
    const nested = z.object({
      outer: z
        .array(
          z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('plain') }),
            z.object({ kind: z.literal('locked'), unlock: z.object({ passphrase: z.string() }).optional() }),
          ]),
        )
        .optional(),
      byName: z.record(z.string(), z.object({ clientSecret: z.string() })),
    });
    expect([...credentialFields(nested, 'x')].sort()).toStrictEqual(['x.byName.*.clientSecret', 'x.outer[].unlock.passphrase']);
  });

  it('CONTROL: a schema with no credential-named field reports nothing', () => {
    expect(credentialFields(z.object({ title: z.string(), pages: z.array(z.number()) }), 'x')).toStrictEqual([]);
  });
});

describe('what main sends the renderer carries no password', () => {
  it('the walk reads every renderer channel, the preload channel and every event', () => {
    // A VACUITY GUARD on the sets themselves: an empty map walks to an empty answer, which is the one hoped for. Each
    // set must hold a member known to be in it, the channel that unlocks a document among them.
    expect(Object.keys(channels)).toContain('document.unlock');
    expect(Object.keys(preloadChannels)).toContain('document.openDropped');
    expect(Object.keys(EVENTS)).toContain('window.close-requested');
  });

  it('no channel answer and no event has a credential-named field', () => {
    expect(credentialsSentToTheRenderer()).toStrictEqual([]);
  });

  it('CONTROL: the same walk reports a real answer once it is given such a field', () => {
    // THE REAL SCHEMA, widened by one member, so the control fails if the walk cannot read this answer's own shape.
    const leaky = z.union([channels['document.unlock'].result, z.object({ kind: z.literal('kept'), password: z.string() })]);
    expect(credentialFields(leaky, 'document.unlock.result')).toStrictEqual(['document.unlock.result.password']);
  });
});
