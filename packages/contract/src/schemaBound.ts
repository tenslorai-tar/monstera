import { z } from 'zod';

import { ANSWER_TOO_LARGE, type ChannelMap } from './channel.js';
import { HOST_CORRELATION_ID_MAX_CHARS, HOST_OUTPUT_NAME_MAX_CHARS } from './hostProtocol.js';

/**
 * The most bytes a value a schema accepts can encode to as JSON — what a channel PROMISES, as against what any document
 * has produced so far.
 *
 * A result schema admitting more than a frame carries is a promise the transport cannot keep: the day a document
 * produces such an answer, the host ends itself with the answer unsent, which is what the owner's install of 0.1.5.0 met
 * on `engine/text-runs` (2026-09-30, ADR-0125). A measurement over a corpus finds the documents in it; the schema says
 * what every document may do.
 *
 * ## Read out of zod's own JSON Schema
 *
 * `z.toJSONSchema` is the library's answer to *what does this schema permit*, and `payloadBounds.test.ts`' L11 sweep
 * reads the same answer; walking zod's internals would be a second opinion about it (B3a). An array is its `maxItems`
 * times its element; a string its `maxLength` times `perChar`; an integer the longer of its bounds written out; any
 * other number the longest a double renders. Anything with no declared maximum — an array or string without one, a
 * record, an `unknown`, a reference, a shape this reader does not know — is `Infinity`: an unrecognised shape reads as
 * unbounded, never as small, so a reader that cannot see answers the alarming figure rather than the reassuring one.
 *
 * `perChar` is 1 for roughly what an honest encoder writes and {@link WORST_BYTES_PER_CHAR} for what a string can cost
 * at most — the length of a `\u` escape — which is the figure a bound has to hold at.
 *
 * `io` is which side of a transform is read. `output` by default, as it always was. `input` is the side the WIRE's
 * JSON is parsed against, and it is the honest reading for a value that crosses as JSON and is branded on arrival — a
 * `DocVersion` is a number on the wire, which `output` cannot represent and so reads as unbounded (measured
 * 2026-10-02: fifteen command kinds were unmeasurable for their `version` alone, item 5c).
 */
export function maxEncodedBytes(schema: z.ZodType, perChar: number, io: 'output' | 'input' = 'output'): number {
  return walk(z.toJSONSchema(schema, { io, unrepresentable: 'any' }), perChar);
}

/** The longest one JSON string character can encode to: `\u0000`. */
export const WORST_BYTES_PER_CHAR = 6;

/** The longest a JavaScript number renders in JSON: `-1.7976931348623157e+308`. */
const NUMBER_CHARS = 24;

/**
 * The UTF-8 length of a string, counted by code point: this package runs where `TextEncoder` is not declared, and the
 * figure is only ever taken of short literals — keys, enum members, envelope templates.
 */
function utf8Length(text: string): number {
  let length = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return length;
}

/** Every caller hands a JSON value — a key, a `const` or `enum` member read out of JSON Schema, an envelope template. */
function encodedLength(value: unknown): number {
  return utf8Length(JSON.stringify(value));
}

type Node = Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOf(node: Node, key: string): number | undefined {
  const value = node[key];
  return typeof value === 'number' ? value : undefined;
}

function nodesOf(node: Node, key: string): Node[] | undefined {
  const value = node[key];
  return Array.isArray(value) ? value.filter(isNode) : undefined;
}

/** A container's members inside its two brackets, with a comma BETWEEN each pair — one fewer than there are members. */
function bracketed(members: readonly number[]): number {
  return 2 + members.reduce((sum, member) => sum + member, 0) + Math.max(members.length - 1, 0);
}

function walk(node: unknown, perChar: number): number {
  if (!isNode(node)) return Infinity;
  if ('const' in node) return encodedLength(node['const']);
  const members = node['enum'];
  if (Array.isArray(members)) return Math.max(...members.map(encodedLength));
  const alternatives = nodesOf(node, 'anyOf') ?? nodesOf(node, 'oneOf');
  if (alternatives !== undefined) return Math.max(...alternatives.map((option) => walk(option, perChar)));

  switch (node['type']) {
    case 'string': {
      const limit = numberOf(node, 'maxLength');
      return limit === undefined ? Infinity : 2 + limit * perChar;
    }
    case 'integer': {
      const lowest = numberOf(node, 'minimum');
      const highest = numberOf(node, 'maximum');
      return lowest === undefined || highest === undefined
        ? NUMBER_CHARS
        : Math.max(String(lowest).length, String(highest).length);
    }
    case 'number':
      return NUMBER_CHARS;
    case 'boolean':
      return 5;
    case 'null':
      return 4;
    case 'array': {
      const fixed = nodesOf(node, 'prefixItems');
      if (fixed !== undefined && node['items'] === undefined) {
        return bracketed(fixed.map((item) => walk(item, perChar)));
      }
      const limit = numberOf(node, 'maxItems');
      if (limit === undefined) return Infinity;
      // ARITHMETIC RATHER THAN A LIST of `limit` equal members, which a large `maxItems` would make an allocation.
      return 2 + limit * walk(node['items'], perChar) + Math.max(limit - 1, 0);
    }
    case 'object': {
      // A RECORD, or an object whose extra keys are allowed, has no bound on its keys: a strict object says
      // `additionalProperties: false`, and anything else may carry more than its declared properties.
      if (node['additionalProperties'] !== false) return Infinity;
      const properties = isNode(node['properties']) ? node['properties'] : {};
      // `"key":value` — the colon is the one byte beside the key.
      return bracketed(Object.entries(properties).map(([key, value]) => encodedLength(key) + 1 + walk(value, perChar)));
    }
    default:
      return Infinity;
  }
}

/**
 * Every array or string in a schema that a caller cannot bound.
 *
 * Read out of zod's own JSON Schema rather than by walking its internals: `toJSONSchema` is the library's answer to
 * *what does this schema permit*, and a second opinion about that is what B3a forbids. It reports `maxItems` for
 * `.max()` on an array and `maxLength` for a string, so an unbounded one shows up as an absence rather than being
 * inferred. Invariant L11's sweep over renderer answers and the engine hosts' request rule both read it.
 */
export function unboundedMembers(schema: z.ZodType, path: string): readonly string[] {
  const found: string[] = [];
  const visit = (node: unknown, at: string): void => {
    if (typeof node !== 'object' || node === null) return;
    const held = node as Record<string, unknown>;
    // A literal or an enum is bounded by its own members, so a length bound
    // would be a second statement of the same fact — and requiring one would
    // put `.max()` on every `kind` discriminant in the contract.
    const enumerated = held['const'] !== undefined || held['enum'] !== undefined;
    // A TUPLE WITH NO REST IS ITS OWN BOUND. zod writes `z.tuple([a, b])` as `prefixItems` with no `items`, and its
    // own parse refuses a third member; a tuple WITH a rest writes `items`, and is read as unbounded like any array.
    const fixedTuple = Array.isArray(held['prefixItems']) && held['items'] === undefined;
    if (held['type'] === 'array' && held['maxItems'] === undefined && !fixedTuple) found.push(`array  ${at}`);
    if (held['type'] === 'string' && held['maxLength'] === undefined && !enumerated) {
      found.push(`string ${at}`);
    }
    for (const [key, value] of Object.entries(held)) visit(value, `${at}.${key}`);
  };

  visit(
    // A branded string reaches JSON Schema through a transform, which has no
    // representation. `any` keeps the walk going rather than throwing on the
    // first one — and a branded id is bounded by its own minting.
    z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }),
    path,
  );
  return found;
}

/** The bytes `null` takes, subtracted where a template stands a `null` in for the body being measured. */
const NULL_BYTES = 4;

/**
 * What a frame spends around an answer: the response `{"id":…,"body":…}` at the longest id written at worst, and the
 * success envelope `{"ok":true,"value":…}` around the result. Measured off the shapes themselves, so the figure cannot
 * drift from a hand-summed constant.
 */
const ANSWER_OVERHEAD_BYTES =
  encodedLength({ id: '', body: { ok: true, value: null } }) - NULL_BYTES + HOST_CORRELATION_ID_MAX_CHARS * WORST_BYTES_PER_CHAR;

/** What a frame spends around one channel's params: the request with its id, its channel's name and an answer's name. */
function requestOverheadBytes(channel: string): number {
  return (
    encodedLength({ id: '', channel, params: null, answerInto: '' }) -
    NULL_BYTES +
    (HOST_CORRELATION_ID_MAX_CHARS + HOST_OUTPUT_NAME_MAX_CHARS) * WORST_BYTES_PER_CHAR
  );
}

/** One channel whose declared route cannot carry what its schema admits, with the figure that decided it. */
export interface RouteViolation {
  readonly channel: string;
  readonly direction: 'answer' | 'request';
  readonly reason: string;
}

/**
 * THE RULE ADR-0125 SETS, over a host's channel map: a channel whose answer crosses in the frame must fit the frame at
 * its schema's worst; a channel whose answer crosses in a file must declare the one failure that route introduces; a
 * channel whose params cross in the frame must fit it too; and, since ADR-0138, a channel whose params cross in a file
 * must fit the file's ceiling. `fileAnswered` adds the failure by construction, so the second clause catches a
 * declaration spelt by hand.
 *
 * Params are read on the side their JSON is parsed against (`io: 'input'`): a branded `DocVersion` is a number there,
 * and an object that is not strict accepts more keys there, so both read as what the wire may actually carry.
 *
 * Failures are left out of the answer figure: a failure body is a code and at most an incident id, bounded by the
 * channel's literal codes rather than by anything a document holds.
 */
export function hostRouteViolations(channels: ChannelMap, frameMaxBytes: number, fileMaxBytes: number): RouteViolation[] {
  const violations: RouteViolation[] = [];
  for (const [name, declared] of Object.entries(channels)) {
    if (declared.answer === 'frame') {
      const worst = ANSWER_OVERHEAD_BYTES + maxEncodedBytes(declared.result, WORST_BYTES_PER_CHAR);
      if (worst > frameMaxBytes) {
        violations.push({
          channel: name,
          direction: 'answer',
          reason: `its result schema admits ${String(worst)} bytes at worst against a ${String(frameMaxBytes)}-byte frame`,
        });
      }
    } else if (!declared.failures.includes(ANSWER_TOO_LARGE)) {
      violations.push({ channel: name, direction: 'answer', reason: `it answers in a file and does not declare ${ANSWER_TOO_LARGE}` });
    }
    if (declared.request === 'frame') {
      const worst = requestOverheadBytes(name) + maxEncodedBytes(declared.params, WORST_BYTES_PER_CHAR, 'input');
      if (worst > frameMaxBytes) {
        violations.push({
          channel: name,
          direction: 'request',
          reason: `its params schema admits ${String(worst)} bytes at worst against a ${String(frameMaxBytes)}-byte frame`,
        });
      }
    } else {
      // THE FILE IS THE PARAMS ALONE: `client.ts` writes `JSON.stringify(params)` and refuses it above the ceiling.
      const worst = maxEncodedBytes(declared.params, WORST_BYTES_PER_CHAR, 'input');
      if (worst > fileMaxBytes) {
        violations.push({
          channel: name,
          direction: 'request',
          reason: `its params schema admits ${String(worst)} bytes at worst against the ${String(fileMaxBytes)}-byte file ceiling`,
        });
      }
    }
  }
  return violations;
}
