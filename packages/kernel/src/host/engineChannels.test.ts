import { ENGINE_ANSWER_FILE_MAX_BYTES, channels } from '@monstera/contract';
import { describe, expect, it } from 'vitest';

import {
  ENGINE_ANNOTATIONS_MAX,
  ENGINE_DESTINATIONS_MAX,
  ENGINE_FORM_FIELDS_MAX,
  ENGINE_LAYERS_MAX,
  ENGINE_PAGE_LINKS_MAX,
  ENGINE_SIGNATURES_MAX,
  SMALLEST_ANNOTATION_BYTES,
  SMALLEST_DESTINATION_BYTES,
  SMALLEST_LAYER_BYTES,
  SMALLEST_LINK_BYTES,
  SMALLEST_FORM_FIELD_BYTES,
  engineChannels,
} from './engineChannels.js';

/**
 * The listed answers' count bounds are DERIVED (ADR-0130 Decision 3): the most items an answer within the
 * 8 MiB answer ceiling could carry at the smallest one serialises to, and a comma, rounded down to a hundred. Each
 * smallest item is built here, ACCEPTED by the channel's own schema — or the figure would be the size of something the
 * wire refuses — and measured; each literal is held to its division, so a field added to a schema or a ceiling moved
 * is a red case rather than a bound that quietly became a guess again.
 */
const derived = (smallest: number): number => Math.floor(ENGINE_ANSWER_FILE_MAX_BYTES / (smallest + 1) / 100) * 100;

describe('the document-wide lists’ hostile-host bounds', () => {
  it('annotations: the smallest annotation the schema accepts, and the bound it derives', () => {
    // The shortest kind name and blend, every list empty, every nullable null, the one flag `true`.
    const smallest = {
      page: 0,
      index: 0,
      rect: null,
      style: { colour: [], opacity: 0, borderWidth: null },
      kind: 'ink',
      contents: '',
      authored: true,
      inReplyTo: null,
      author: '',
      created: null,
      blend: 'normal',
    };
    const answer = { annotations: [smallest], truncated: false };
    expect(engineChannels['engine/annotations'].result.safeParse(answer).success).toBe(true);
    expect(JSON.stringify(smallest).length).toBe(SMALLEST_ANNOTATION_BYTES);
    expect(ENGINE_ANNOTATIONS_MAX).toBe(derived(SMALLEST_ANNOTATION_BYTES));
  });

  it('form fields: the smallest field the schema accepts, and the bound it derives', () => {
    const smallest = {
      page: 0,
      index: 0,
      kind: 'text',
      name: '',
      values: [],
      on: null,
      options: [],
      readOnly: true,
      rect: null,
    };
    const answer = { fields: [smallest], truncated: false };
    expect(engineChannels['engine/form-fields'].result.safeParse(answer).success).toBe(true);
    expect(JSON.stringify(smallest).length).toBe(SMALLEST_FORM_FIELD_BYTES);
    expect(ENGINE_FORM_FIELDS_MAX).toBe(derived(SMALLEST_FORM_FIELD_BYTES));
  });

  it('outline entries: the smallest entry the schema accepts, and the bound it derives', () => {
    const smallest = { title: '', page: null, depth: 0 };
    const answer = { destinations: [smallest], truncated: false };
    expect(engineChannels['engine/destinations'].result.safeParse(answer).success).toBe(true);
    expect(JSON.stringify(smallest).length).toBe(SMALLEST_DESTINATION_BYTES);
    expect(ENGINE_DESTINATIONS_MAX).toBe(derived(SMALLEST_DESTINATION_BYTES));
  });

  it('page links: the smallest link the schema accepts, and the bound it derives', () => {
    const smallest = { kind: 'internal', page: 0, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 } };
    expect(engineChannels['engine/page-links'].result.safeParse({ links: [smallest], truncated: false }).success).toBe(
      true,
    );
    expect(JSON.stringify(smallest).length).toBe(SMALLEST_LINK_BYTES);
    expect(ENGINE_PAGE_LINKS_MAX).toBe(derived(SMALLEST_LINK_BYTES));
  });

  it('CONTROL: the page links bound is enforced — one past it is refused by the channel', () => {
    const link = { kind: 'internal', page: 0, bounds: { x0: 0, y0: 0, x1: 0, y1: 0 } };
    const over = { links: Array.from({ length: ENGINE_PAGE_LINKS_MAX + 1 }, () => link), truncated: true };
    const channel = engineChannels['engine/page-links'].result;
    expect(channel.safeParse({ ...over, links: over.links.slice(1) }).success).toBe(true);
    expect(channel.safeParse(over).success).toBe(false);
  });

  it('layers: the smallest layer the schema accepts, and the bound it derives', () => {
    const smallest = { index: 0, name: '', visible: true };
    expect(engineChannels['engine/layers'].result.safeParse({ layers: [smallest], truncated: false }).success).toBe(true);
    expect(JSON.stringify(smallest).length).toBe(SMALLEST_LAYER_BYTES);
    expect(ENGINE_LAYERS_MAX).toBe(derived(SMALLEST_LAYER_BYTES));
  });

  it('CONTROL: the layers bound is enforced — one past it is refused by the channel', () => {
    const layer = { index: 0, name: '', visible: true };
    const over = { layers: Array.from({ length: ENGINE_LAYERS_MAX + 1 }, () => layer), truncated: true };
    expect(engineChannels['engine/layers'].result.safeParse({ ...over, layers: over.layers.slice(1) }).success).toBe(true);
    expect(engineChannels['engine/layers'].result.safeParse(over).success).toBe(false);
  });

  it('CONTROL: the bound is enforced — one entry past it is refused by the channel', () => {
    // A bound nothing reads is a figure, not a bound: the schema has to refuse the list one past it.
    const entry = { title: '', page: null, depth: 0 };
    const over = { destinations: Array.from({ length: ENGINE_DESTINATIONS_MAX + 1 }, () => entry), truncated: true };
    const at = { destinations: over.destinations.slice(1), truncated: true };
    expect(engineChannels['engine/destinations'].result.safeParse(at).success).toBe(true);
    expect(engineChannels['engine/destinations'].result.safeParse(over).success).toBe(false);
  });
});

/**
 * WHETHER A SAVE KEEPS THE SIGNATURES is asked before every save, and its count was bounded at the signature LIST's
 * 256: a document with more signatures failed every save (JOURNAL, *No document-size refusals*, table A row 14). The
 * count crosses as one number, and the renderer's warning takes it the same way.
 */
describe('a save of a document with more signatures than a list carries', () => {
  it('the count of 300 crosses from the host, and the save’s warning carries it', () => {
    expect(300).toBeGreaterThan(ENGINE_SIGNATURES_MAX);
    expect(engineChannels['engine/signatures-kept'].result.safeParse({ signatures: 300, kept: false }).success).toBe(true);
    expect(channels['document.save'].result.safeParse({ kind: 'breaks-signatures', signatures: 300 }).success).toBe(true);
    // CONTROL: the count is still a count — a fraction or a negative is refused.
    expect(engineChannels['engine/signatures-kept'].result.safeParse({ signatures: -1, kept: false }).success).toBe(false);
  });
});
